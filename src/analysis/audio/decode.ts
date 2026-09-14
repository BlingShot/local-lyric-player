import type { AnalysisInput } from '../types';
import { readAudioAnalysisMetadata } from '../../library/metadata';
import { AUDIO_ANALYSIS_RATE, MAX_AUDIO_DURATION, MAX_DECODED_BYTES } from './config';
import { checkAnalysisBudget } from './limits';
import type { AudioRange } from './types';

export async function decodeOriginalAudio(input: AnalysisInput, signal: AbortSignal, stage: (text: string) => void, maxBytes = MAX_DECODED_BYTES) {
  signal.throwIfAborted();
  const blob = await input.readAudio();
  signal.throwIfAborted();
  checkAnalysisBudget(blob.size);
  stage('Reading local audio format…');
  const sourceMetadata = await readAudioAnalysisMetadata(new File([blob], input.track.fileName || input.track.name, { type: blob.type }), signal);
  checkAnalysisBudget(blob.size, sourceMetadata);
  const duration = sourceMetadata.duration!, sampleRate = sourceMetadata.sampleRate!;
  if (duration * sampleRate * sourceMetadata.channels! * 4 > maxBytes) throw new Error(`The full audio exceeds this analyzer's ${maxBytes / 1048576} MiB PCM limit. No partial scan was performed.`);
  signal.throwIfAborted(); stage('Decoding full audio…');
  const decoder = new OfflineAudioContext(1, 1, sampleRate);
  // Native decode cannot be aborted. The queue waits for it to settle, then discards
  // cancelled output, so repeated cancellation cannot accumulate native decodes.
  const encoded = await blob.arrayBuffer(); signal.throwIfAborted();
  let decoded: AudioBuffer;
  try { decoded = await decoder.decodeAudioData(encoded); }
  catch { signal.throwIfAborted(); throw new Error('This audio could not be decoded for analysis. The file may be damaged or unsupported by this browser.'); }
  signal.throwIfAborted();
  if (decoded.numberOfChannels > 2 || decoded.length * decoded.numberOfChannels * 4 > maxBytes || decoded.duration > MAX_AUDIO_DURATION) throw new Error('The actual decoded audio exceeds the full-track analysis limit.');
  if (Math.abs(decoded.duration - duration) > Math.max(.5, duration * .01)) throw new Error('Decoded duration differs from the file duration. A partial decode will not be reported as full-track analysis.');
  return { decoded, sourceMetadata };
}

export async function decodeAnalysisAudio(input: AnalysisInput, signal: AbortSignal, stage: (text: string) => void) {
  const { decoded, sourceMetadata } = await decodeOriginalAudio(input, signal, stage);
  const sampleRate = sourceMetadata.sampleRate!;
  stage('Preparing mono audio at 44,100 Hz…');
  const length = Math.ceil(decoded.length * AUDIO_ANALYSIS_RATE / decoded.sampleRate);
  const renderer = new OfflineAudioContext(1, length, AUDIO_ANALYSIS_RATE);
  const source = renderer.createBufferSource(); source.buffer = decoded;
  source.channelInterpretation = 'speakers'; source.connect(renderer.destination); source.start();
  const stop = () => { try { source.stop(); } catch { /* Rendering may have completed. */ } };
  signal.addEventListener('abort', stop, { once: true });
  let mono: AudioBuffer;
  try { mono = await renderer.startRendering(); }
  finally { source.disconnect(); source.buffer = null; signal.removeEventListener('abort', stop); }
  signal.throwIfAborted();
  if (mono.sampleRate !== AUDIO_ANALYSIS_RATE || Math.abs(mono.duration - decoded.duration) > 2 / AUDIO_ANALYSIS_RATE) throw new Error('Audio resampling did not preserve the full-track time base.');
  const range: AudioRange = { kind: 'full-track', start: 0, end: decoded.duration, sourceSampleRate: sampleRate,
    decodedSampleRate: decoded.sampleRate, analysisSampleRate: mono.sampleRate, sourceChannels: decoded.numberOfChannels,
    decodedFrames: decoded.length, analysisFrames: mono.length, mix: decoded.numberOfChannels === 1 ? 'mono' : 'stereo-average',
    resampler: decoded.sampleRate === mono.sampleRate ? 'none' : 'Web Audio OfflineAudioContext' };
  return { pcm: mono.getChannelData(0).slice(), range, sourceMetadata };
}
