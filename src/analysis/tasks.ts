import type { AnalysisAdapter, AnalysisInput, AnalysisKind, AnalysisProgress, AnalysisRecord, LoudnessResult, LyricsInsights } from './types.ts';

export interface AnalysisTaskState { status: 'idle' | 'running' | 'saving' | 'complete' | 'cancelled' | 'error'; message: string; progress?: number }
const idle: AnalysisTaskState = { status: 'idle', message: '' };
export class AnalysisTasks {
  private states = new Map<string, AnalysisTaskState>();
  private running = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get = (key: string) => this.states.get(key) || idle;
  private set(key: string, state: AnalysisTaskState) { this.states.set(key, state); this.listeners.forEach(listener => listener()); }
  cancel(key: string) {
    if (this.get(key).status !== 'running') return;
    this.running.get(key)?.abort(); this.running.delete(key);
    this.set(key, { status: 'cancelled', message: 'Cancelled. The previous saved result is kept.' });
  }
  async run<K extends AnalysisKind>(key: string, adapter: AnalysisAdapter<K>, input: AnalysisInput,
    settings: AnalysisRecord<K>['settings'], save: (record: AnalysisRecord<K>) => Promise<void>, remote?: { provider: 'deepseek' }) {
    if (this.running.has(key)) return;
    if (adapter.execution !== 'local' && !(adapter.execution === 'deepseek' && adapter.kind === 'lyrics' && remote?.provider === 'deepseek'))
      throw new Error('Only explicitly configured local analyzers are allowed without a user-requested DeepSeek lyric run.');
    const controller = new AbortController(); this.running.set(key, controller);
    const active = () => this.running.get(key) === controller && !controller.signal.aborted;
    this.set(key, { status: 'running', message: adapter.execution === 'local' ? 'Running locally…' : 'Waiting for DeepSeek…' });
    try {
      if (adapter.kind === 'lyrics' && !input.lyrics?.lines.some(line => line.text.trim())) throw new Error('Import or edit lyrics for this song first.');
      const progress = (update: AnalysisProgress) => {
        if (active()) this.set(key, { status: 'running', message: update.message,
          progress: typeof update.fraction === 'number' && Number.isFinite(update.fraction) ? Math.max(0, Math.min(1, update.fraction)) : undefined });
      };
      const result = await adapter.run(input, { signal: controller.signal, settings, progress });
      if (!active()) return;
      let participants = [input.track.id];
      if (adapter.kind === 'loudness') {
        const scope = (result as LoudnessResult).scope;
        if (!scope || !scope.trackIds.length || new Set(scope.trackIds).size !== scope.trackIds.length || !scope.trackIds.includes(input.track.id)) throw new Error('Loudness results must identify the actual participating songs.');
        const requested = input.audioScope || { kind: 'track', trackIds: [input.track.id] };
        if (scope.kind !== 'track' || scope.kind !== requested.kind || scope.trackIds.length !== requested.trackIds.length || scope.trackIds.some(id => !requested.trackIds.includes(id))) throw new Error('The loudness result does not match the requested song scope.');
        participants = scope.trackIds;
      }
      if (['bpm-key', 'loudness'].includes(adapter.kind) && participants.some(id => !input.versions.audio?.[id])) throw new Error('The audio source is unavailable. Restore it before analyzing.');
      if (adapter.kind === 'lyrics') {
        const insights = result as LyricsInsights;
        if (insights.basis !== 'lyrics-text-only' || insights.authorIntent !== 'interpretation' || insights.advisorySource !== 'ai') throw new Error('Lyrics insights must identify their text-only basis and AI interpretation.');
        if (insights.themes.some(theme => !theme.evidence.length || theme.evidence.some(evidence => !evidence.quote.trim() || !input.lyrics?.lines.some(line => line.id === evidence.lineId && line.text.includes(evidence.quote))))) throw new Error('Theme evidence must quote the actual selected lyrics.');
      }
      const versions = adapter.kind === 'lyrics' ? { lyrics: input.versions.lyrics }
        : adapter.kind === 'metadata' ? { metadata: input.versions.metadata }
        : { audio: Object.fromEntries(participants.map(id => [id, input.versions.audio![id]])) };
      this.set(key, { status: 'saving', message: 'Saving result locally…' });
      await save({ trackId: input.track.id, kind: adapter.kind, schemaVersion: 1, analyzedAt: Date.now(), input: versions, algorithm: adapter.algorithm, settings, result });
      if (active()) this.set(key, { status: 'complete', message: 'Result saved on this device.' });
    } catch (error) {
      if (active()) this.set(key, { status: 'error', message: error instanceof Error ? error.message : 'Analysis failed. The previous result is kept.' });
    } finally { if (this.running.get(key) === controller) this.running.delete(key); }
  }
}
export const analysisTasks = new AnalysisTasks();
export const analysisTaskKey = (trackId: string, kind: AnalysisKind) => JSON.stringify([trackId, kind]);
