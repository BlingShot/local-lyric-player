import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import createEssentia from 'essentia.js/dist/essentia-wasm.web.js';
import wasmUrl from 'essentia.js/dist/essentia-wasm.web.wasm?url';
import { AUDIO_ANALYSIS_RATE, BPM_PARAMETERS, KEY_PARAMETERS } from './config';
import type { AudioWorkerRequest, AudioWorkerResponse, BpmResult, KeyResult } from './types';

interface Vector { size(): number; get(index: number): number; delete(): void }
let wasm: Promise<unknown> | undefined;
self.onmessage = async (event: MessageEvent<AudioWorkerRequest>) => {
  const { id, trackId, kind, pcm, range, sourceMetadata } = event.data;
  let engine: Essentia | undefined;
  const vectors = new Set<Vector>();
  const array = (vector: Vector): number[] => { vectors.add(vector); return Array.from({ length: vector.size() }, (_, i) => vector.get(i)); };
  const respond = (data: AudioWorkerResponse) => self.postMessage(data);
  try {
    if (range.analysisSampleRate !== AUDIO_ANALYSIS_RATE || pcm.length !== range.analysisFrames) throw new Error('Invalid PCM sample rate or frame count.');
    let peak = 0;
    for (const value of pcm) { if (!Number.isFinite(value)) throw new Error('The decoded PCM contains invalid samples.'); peak = Math.max(peak, Math.abs(value)); }
    // Keep the WASM binary as one local asset instead of a large base64 JS string.
    // The analysis queue still owns this single-use worker and its cancellation.
    engine = new Essentia(await (wasm ||= createEssentia({ locateFile: () => wasmUrl })));
    const base = { range, sourceMetadata, engineVersion: engine.version };
    if (peak <= 1e-7 || range.end < 3) {
      respond({ id, trackId, kind, result: { ...base, outcome: 'unreliable', raw: null,
        reason: peak <= 1e-7 ? 'Silent or near-silent audio (application guard: peak ≤ 0.0000001). No estimate was generated.' : 'Less than 3 seconds of audio (application guard). No reliable full-track estimate.' } });
      return;
    }
    const input: Vector = engine.arrayToVector(pcm); vectors.add(input);
    if (kind === 'bpm') {
      const p = BPM_PARAMETERS, output = engine.RhythmExtractor2013(input, p.maxTempo, p.method, p.minTempo);
      const raw = { bpm: output.bpm as number, ticks: array(output.ticks), estimates: array(output.estimates),
        bpmIntervals: array(output.bpmIntervals), confidence: Number.isFinite(output.confidence) ? output.confidence as number : undefined };
      const valid = Number.isFinite(raw.bpm) && raw.bpm > 0 && raw.ticks.length >= 2 && raw.ticks.every((tick, i) => Number.isFinite(tick) && tick >= 0 && tick <= range.end && (!i || tick > raw.ticks[i - 1]));
      const result: BpmResult = { ...base, raw, outcome: valid ? 'estimated' : 'unreliable', reason: valid ? undefined : 'The algorithm did not return a usable tempo and beat sequence.' };
      respond({ id, trackId, kind, result });
    } else {
      const p = KEY_PARAMETERS;
      const output = engine.KeyExtractor(input, p.averageDetuningCorrection, p.frameSize, p.hopSize, p.hpcpSize, p.maxFrequency,
        p.maximumSpectralPeaks, p.minFrequency, p.pcpThreshold, p.profileType, range.analysisSampleRate, p.spectralPeaksThreshold,
        p.tuningFrequency, p.weightType, p.windowType);
      const valid = /^[A-G](?:#|b)?$/.test(output.key) && ['major', 'minor'].includes(output.scale) && Number.isFinite(output.strength);
      const usable = valid && output.strength > 0;
      const result: KeyResult = { ...base, outcome: usable ? 'estimated' : 'unreliable',
        raw: valid ? { tonic: output.key, mode: output.scale, strength: output.strength } : null,
        reason: usable ? undefined : 'No positive key-profile match (application reliability rule), or invalid algorithm output.' };
      respond({ id, trackId, kind, result });
    }
  } catch (error) { respond({ id, trackId, kind, error: error instanceof Error ? error.message : `Essentia could not analyze this audio (error ${String(error)}).` }); }
  finally { for (const vector of vectors) vector.delete(); engine?.shutdown(); engine?.delete(); }
};
