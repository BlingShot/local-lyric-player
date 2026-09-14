import type { AudioAnalysisMetadata } from '../../library/analysisMetadata';
import { MAX_AUDIO_DURATION, MAX_AUDIO_FILE_BYTES, MAX_DECODED_BYTES } from './config.ts';

/** Reject unsafe full scans before native decoding allocates the PCM buffer. */
export function checkAnalysisBudget(fileBytes: number, metadata?: AudioAnalysisMetadata) {
  if (fileBytes > MAX_AUDIO_FILE_BYTES) throw new Error('This file exceeds the 160 MiB analysis limit. No partial scan was performed.');
  if (!metadata) return;
  const { duration, sampleRate, channels } = metadata;
  if (!duration || duration < 0 || !sampleRate || sampleRate < 0 || !Number.isFinite(duration) || !Number.isFinite(sampleRate))
    throw new Error('The full audio duration and format could not be read safely. Restore a supported audio file.');
  if (!channels || !Number.isInteger(channels) || channels > 2 || channels < 1) throw new Error('Local audio analysis currently supports mono or stereo audio only.');
  if (duration > MAX_AUDIO_DURATION || duration * sampleRate * channels * 4 > MAX_DECODED_BYTES)
    throw new Error('The full decoded audio exceeds the analysis memory limit (192 MiB PCM / 15 minutes). No partial scan was performed.');
}
