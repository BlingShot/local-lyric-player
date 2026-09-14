import { useEffect, useRef, useState } from 'react';
import { getLocalAudioElement, getLocalPlayer } from '../player/runtime';
import { previousWord, recordWord } from './recordWord';
export { recordWord } from './recordWord';
import type { useStudioDraft } from './useStudioDraft';
import { markSync } from './sync';

const inputTarget = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable=true],[role=combobox],[role=menu],[role=menuitem],[role=dialog]');
export function useWordRecording(edit: ReturnType<typeof useStudioDraft>, enabled: boolean, blocked: boolean, message: (value: string) => void, mode?: 'line' | 'word') {
  const held = useRef<{ lineId: string; unitId: string; start: number; src: string; key: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const cancel = () => { held.current = null; setRecording(false); };
  const begin = (key = 'pointer') => {
    if (held.current || !enabled || blocked) return;
    const p = edit.current.current, line = p?.lines.find(l => l.id === p.selectedId);
    const w = line?.units.find(w => w.id === p?.selectedUnitId) || line?.units.find(w => w.kind === 'word');
    if (!line || !w || w.kind !== 'word') { message('Select a singing fragment first.'); return; }
    const audio = getLocalAudioElement();
    if (audio.paused || audio.ended) { message('Play the audio, then hold T to record a word.'); return; }
    held.current = { lineId: line.id, unitId: w.id, start: Math.round(audio.currentTime * 1000), src: audio.currentSrc, key }; setRecording(true);
  };
  const end = () => {
    const value = held.current; if (!value) return; cancel();
    const audio = getLocalAudioElement(), stop = Math.round(audio.currentTime * 1000);
    if (value.src !== audio.currentSrc || stop <= value.start) { message('Recording cancelled: no valid media-time interval.'); return; }
    edit.commit(p => recordWord(p, value.lineId, value.unitId, value.start, stop));
    message('Word recorded. The next fragment is selected.');
  };
  const markLine = (direction: -1 | 1 = 1) => {
    const p = edit.current.current; if (!p || !enabled) return;
    const audio = getLocalAudioElement();
    edit.commit(v => markSync(v, Math.round(audio.currentTime * 1000), direction));
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (blocked || e.repeat || e.isComposing || inputTarget(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); cancel(); e.shiftKey ? edit.redo() : edit.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); cancel(); edit.redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const word = (mode ?? edit.current.current?.settings.mode) === 'word', arrows = edit.current.current?.settings.wordArrowKeys;
      if ((e.code === 'KeyT' || arrows && e.code === 'ArrowRight') && word) { e.preventDefault(); begin(e.code); return; }
      if (arrows && word && e.code === 'ArrowLeft') { e.preventDefault(); cancel(); edit.commit(previousWord, 'word-selection'); return; }
      if (['ArrowDown', 'ArrowUp'].includes(e.code)) { e.preventDefault(); cancel(); markLine(e.code === 'ArrowUp' ? -1 : 1); }
      if (e.code === 'Space' && enabled && !(e.target instanceof Element && e.target.closest('button,a,summary,[role=button]'))) { e.preventDefault(); getLocalPlayer().toggle(); }
    };
    const up = (e: KeyboardEvent) => { if (held.current?.key === e.code) { e.preventDefault(); if (inputTarget(e.target) || blocked) cancel(); else end(); } };
    const hidden = () => { if (document.hidden) cancel(); };
    document.addEventListener('keydown', down); document.addEventListener('keyup', up); window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', hidden);
    const audio = getLocalAudioElement(); audio.addEventListener('seeking', cancel); audio.addEventListener('pause', cancel);
    return () => { document.removeEventListener('keydown', down); document.removeEventListener('keyup', up); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden); audio.removeEventListener('seeking', cancel); audio.removeEventListener('pause', cancel); };
  });
  return { recording, activeWordId: held.current?.unitId, begin, end, cancel, markLine };
}
