import type { IAudioMetadata } from 'music-metadata';

export interface AudioAnalysisMetadata {
  duration?: number; sampleRate?: number; channels?: number; codec?: string;
  bitrate?: number; bitsPerSample?: number; technicalVersion?: number;
  tags: { bpm?: number; key?: string; trackGainDb?: number; albumGainDb?: number; trackPeak?: number; albumPeak?: number };
}
export function analysisMetadata({ common, format }: IAudioMetadata): AudioAnalysisMetadata {
  const finite = (value?: number) => Number.isFinite(value) ? value : undefined;
  return { duration: finite(format.duration), sampleRate: finite(format.sampleRate), channels: format.numberOfChannels, codec: format.codec,
    bitrate: finite(format.bitrate), bitsPerSample: finite(format.bitsPerSample), technicalVersion: 1,
    tags: { bpm: finite(common.bpm), key: common.key?.trim() || undefined,
      trackGainDb: finite(common.replaygain_track_gain?.dB), albumGainDb: finite(common.replaygain_album_gain?.dB),
      trackPeak: finite(common.replaygain_track_peak?.ratio), albumPeak: finite(common.replaygain_album_peak?.ratio) } };
}
