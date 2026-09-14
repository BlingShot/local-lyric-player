import { useEffect, useState } from 'react';
import { getLocalAudioElement, getLocalPlayer, setLocalPlaybackRate } from '../player/runtime';

export function useStudioAudio() {
  const [rate, setRate] = useState(() => getLocalAudioElement().playbackRate);
  useEffect(() => {
    const audio = getLocalAudioElement(), originalRate = audio.playbackRate;
    // Editing stays on this song even if the library queue has more songs or repeat enabled.
    // Capture runs before the existing player's listeners and pauses through its public API.
    const stop = () => getLocalPlayer().pause();
    const changed = () => setRate(audio.playbackRate);
    audio.addEventListener('ended', stop, true); audio.addEventListener('error', stop, true);
    audio.addEventListener('ratechange', changed);
    return () => {
      audio.removeEventListener('ended', stop, true); audio.removeEventListener('error', stop, true);
      audio.removeEventListener('ratechange', changed); setLocalPlaybackRate(originalRate);
    };
  }, []);
  return { rate, changeRate: setLocalPlaybackRate };
}
