// Verified against Electron 44.3.0 / Chromium 152.0.7977.78 media_switches.cc
// and CDP Media.playerPropertiesChanged, not inferred from ffmpeg.dll's presence.
// Disabling the alternative decoders selects the bundled native FFmpeg decoder.
// No CLI process, full-song PCM cache, resampling or re-encoding is introduced.
export function useNativeFfmpeg(commandLine) {
  const disabled = new Set(commandLine.getSwitchValue('disable-features').split(',').filter(Boolean));
  for (const name of ['SymphoniaAudioDecoding', 'SymphoniaMp3Decoding', 'SymphoniaPcmDecoding', 'SymphoniaVorbisDecoding']) disabled.add(name);
  commandLine.appendSwitch('disable-features', [...disabled].join(','));
}
