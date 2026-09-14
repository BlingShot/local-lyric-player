import { measurePeaks, integratedLoudness, loudnessRange } from './math';
import { r128Windows } from './r128';
import { loudnessAlgorithm } from './config';
import type { LoudnessWorkerRequest, LoudnessScan } from './types';

export function measureLoudness({ trackId, channels, range, sourceMetadata }: LoudnessWorkerRequest): LoudnessScan {
  if (channels.length < 1 || channels.length > 2 || channels.some(c => c.length !== range.frames) || range.sampleRate < 44100 || range.sampleRate > 192000)
    throw new Error('Loudness and true peak support original mono/stereo audio at 44.1–192 kHz. This format is not supported.');
  const peaks = measurePeaks(channels);
  const { momentary, shortTerm } = r128Windows(channels, range.sampleRate);
  return { trackId, range, sourceMetadata, engineVersion: loudnessAlgorithm.version, momentary, shortTerm,
    engineRaw: { integratedLufs: integratedLoudness(momentary) ?? -Infinity, rangeLu: loudnessRange(shortTerm) ?? 0 }, ...peaks };
}
