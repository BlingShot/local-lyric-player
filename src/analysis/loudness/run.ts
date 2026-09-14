import { decodeOriginalAudio } from '../audio/decode';
import type { AnalysisInput } from '../types';
import type { AudioTaskStatus } from '../audio/types';
import { loudnessAlgorithm, loudnessSettings, LOUDNESS_PCM_LIMIT } from './config';
import { loudnessCacheMatches, readLoudnessResult } from './repository';
import { summarizeScans } from './results';
import type { LoudnessKind, LoudnessRecord, LoudnessScan, LoudnessWorkerRequest, LoudnessWorkerResponse } from './types';

function workerScan(request: LoudnessWorkerRequest, signal: AbortSignal): Promise<LoudnessScan> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./loudness.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timeout); worker.terminate(); signal.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Full-track loudness analysis exceeded five minutes. No partial result was saved.')); }, 300000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<LoudnessWorkerResponse>) => {
      if (event.data.id !== request.id || event.data.trackId !== request.trackId) return;
      cleanup(); if ('error' in event.data) reject(new Error(event.data.error)); else resolve(event.data.scan);
    };
    worker.onerror = event => { event.preventDefault(); cleanup(); reject(new Error(event.message || 'The loudness worker failed.')); };
    try { worker.postMessage(request, request.channels.map(c => c.buffer as ArrayBuffer)); }
    catch (error) { cleanup(); reject(error); }
  });
}
export async function runLoudnessAnalysis(input: AnalysisInput, kind: LoudnessKind, id: string, force: boolean, signal: AbortSignal,
  stage: (status: AudioTaskStatus, message: string) => void): Promise<LoudnessRecord[]> {
  const track = input.track;
  const cached = await readLoudnessResult(track.id, kind); signal.throwIfAborted();
  // Cached analysis never hides an inaccessible audio copy.
  await input.readAudio(track.id); signal.throwIfAborted();
  if (!force && loudnessCacheMatches(cached, input, kind)) return [];
  const { decoded, sourceMetadata } = await decodeOriginalAudio(input, signal, message => stage('decoding', message), LOUDNESS_PCM_LIMIT);
  if (decoded.sampleRate !== sourceMetadata.sampleRate) throw new Error('The decoder changed the sample rate. Original-rate loudness measurement was not performed.');
  signal.throwIfAborted(); stage('analyzing', 'Measuring full-track loudness and true peak…');
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i).slice());
  const scan = await workerScan({ id, trackId: track.id, channels, sourceMetadata,
    range: { kind: 'full-track', start: 0, end: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels,
      frames: decoded.length, mix: 'original-channels', resampler: 'none' } }, signal);
  signal.throwIfAborted();
  return [{ schemaVersion: 1, trackId: track.id, kind, analyzedAt: Date.now(),
    input: { audio: { [track.id]: input.versions.audio![track.id] } }, algorithm: loudnessAlgorithm, settings: loudnessSettings,
    result: summarizeScans([scan], { kind: 'track', trackIds: [track.id] }, { [track.id]: track.name }), task: { id, status: 'complete' } }];
}
