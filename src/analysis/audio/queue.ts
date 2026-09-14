import type { AnalysisInput } from '../types';
import { audioAlgorithm, audioSettings } from './config';
import { decodeAnalysisAudio } from './decode';
import { audioCacheMatches, readAudioResult, saveAudioResult, saveAudioTask, type AudioRecord } from './repository';
import type { AudioJobKind, AudioTask, AudioTaskStatus, AudioWorkerRequest, AudioWorkerResponse } from './types';
import { runLoudnessAnalysis } from '../loudness/run';
import { saveLoudnessResults } from '../loudness/repository';

export const audioTaskKey = (trackId: string, kind: AudioJobKind) => JSON.stringify([trackId, kind]);
export const audioTaskActive = (task?: AudioTask) => !!task && ['queued', 'decoding', 'analyzing', 'saving', 'cancelling'].includes(task.status);
interface Job { task: AudioTask; input: AnalysisInput; force: boolean; controller: AbortController; writes: Promise<void>; saveError?: unknown }

function runWorker(request: AudioWorkerRequest, signal: AbortSignal): Promise<AudioWorkerResponse> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timeout); worker.terminate(); signal.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Analysis exceeded the five-minute runtime limit. No partial result was saved.')); }, 300000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<AudioWorkerResponse>) => {
      const data = event.data;
      if (data.id !== request.id || data.trackId !== request.trackId || data.kind !== request.kind) return;
      cleanup(); if ('error' in data) reject(new Error(data.error)); else resolve(data);
    };
    worker.onerror = event => { event.preventDefault(); cleanup(); reject(new Error(`The local analysis worker failed: ${event.message || 'WASM could not start.'}`)); };
    try { worker.postMessage(request, [request.pcm.buffer as ArrayBuffer]); }
    catch (error) { cleanup(); reject(error); }
  });
}

class AudioAnalysisQueue {
  private waiting: Job[] = [];
  private jobs = new Map<string, Job>();
  private states = new Map<string, AudioTask>();
  private listeners = new Set<() => void>();
  private processing = false;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get = (trackId: string, kind: AudioJobKind) => this.states.get(audioTaskKey(trackId, kind));
  private set(job: Job, status: AudioTaskStatus, message: string) {
    job.task = { ...job.task, status, message, updatedAt: Date.now() };
    const key = audioTaskKey(job.task.trackId, job.task.kind);
    if (this.jobs.get(key) === job) { this.states.set(key, job.task); this.listeners.forEach(listener => listener()); }
    const snapshot = job.task;
    job.writes = job.writes.then(() => saveAudioTask(snapshot, status === 'queued')).catch(error => { job.saveError = error; });
  }
  enqueue(input: AnalysisInput, kind: AudioJobKind, force = false) {
    const key = audioTaskKey(input.track.id, kind);
    if (audioTaskActive(this.get(input.track.id, kind))) return;
    const job: Job = { task: { id: crypto.randomUUID(), trackId: input.track.id, kind, status: 'queued', message: '', updatedAt: Date.now() },
      input, force, controller: new AbortController(), writes: Promise.resolve() };
    this.jobs.set(key, job); this.set(job, 'queued', 'Waiting for the local analyzer…');
    this.waiting.push(job); void this.drain();
  }
  cancel(trackId: string, kind: AudioJobKind) {
    const job = this.jobs.get(audioTaskKey(trackId, kind));
    if (!job || !['queued', 'decoding', 'analyzing'].includes(job.task.status)) return;
    const decoding = job.task.status === 'decoding';
    job.controller.abort();
    this.set(job, decoding ? 'cancelling' : 'cancelled', decoding ? 'Cancelling. Waiting for the browser decoder to release its buffer…' : 'Cancelled. Previous results are kept.');
  }
  private async drain() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.waiting.length) {
        const job = this.waiting.shift()!, { task: original, input, controller } = job;
        const { signal } = controller;
        try {
          await job.writes; if (job.saveError) throw job.saveError;
          signal.throwIfAborted();
          await input.readAudio(); signal.throwIfAborted();
          if (original.kind === 'loudness') {
            const records = await runLoudnessAnalysis(input, original.kind, original.id, job.force, signal,
              (status, message) => { if (!signal.aborted) this.set(job, status, message); });
            signal.throwIfAborted();
            if (records.length) {
              this.set(job, 'saving', 'Saving loudness and ReplayGain results…'); await job.writes;
              if (job.saveError) throw job.saveError;
              await saveLoudnessResults(records, original.trackId, original.kind, original.id);
            }
            this.set(job, 'complete', records.length ? 'Full scan saved. ReplayGain is available for measurable audio.' : 'Using saved loudness and ReplayGain results.');
            await job.writes; if (job.saveError) throw job.saveError;
            continue;
          }
          const cached = await readAudioResult(original.trackId, original.kind);
          signal.throwIfAborted();
          if (!job.force && audioCacheMatches(cached, input, original.kind)) {
            this.set(job, 'complete', 'Using the saved result for this audio and these parameters.'); await job.writes;
            if (job.saveError) throw job.saveError;
            continue;
          }
          this.set(job, 'decoding', 'Reading local audio…');
          const decoded = await decodeAnalysisAudio(input, signal, message => { if (!signal.aborted) this.set(job, 'decoding', message); });
          signal.throwIfAborted(); this.set(job, 'analyzing', 'Analyzing the full track in a local worker…');
          const response = await runWorker({ id: original.id, trackId: original.trackId, kind: original.kind, ...decoded }, signal);
          signal.throwIfAborted();
          if (!('result' in response)) throw new Error('The worker returned no result.');
          this.set(job, 'saving', 'Saving the result on this device…'); await job.writes;
          if (job.saveError) throw job.saveError;
          const record = { schemaVersion: 1, trackId: original.trackId, kind: original.kind, analyzedAt: Date.now(),
            input: { audio: { [original.trackId]: input.versions.audio![original.trackId] } }, algorithm: audioAlgorithm(original.kind),
            settings: audioSettings(original.kind), result: response.result, task: { id: original.id, status: 'complete' } } as AudioRecord;
          await saveAudioResult(record, original.id);
          this.set(job, 'complete', response.result.outcome === 'estimated' ? 'Full-track analysis saved.' : 'Analysis saved. Unable to determine reliably.');
          await job.writes;
          if (job.saveError) throw job.saveError;
        } catch (error) {
          this.set(job, signal.aborted ? 'cancelled' : 'failed', signal.aborted ? 'Cancelled. Previous results are kept.'
            : error instanceof Error ? error.message : 'Analysis failed. Previous results are kept.');
          await job.writes;
        } finally {
          const key = audioTaskKey(original.trackId, original.kind);
          if (this.jobs.get(key) === job) this.jobs.delete(key);
        }
      }
    } finally { this.processing = false; }
  }
}
export const audioAnalysisQueue = new AudioAnalysisQueue();
