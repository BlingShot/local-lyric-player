import { useEffect, useMemo, useRef, useState } from 'react';
import { getLocalAudioElement, getLocalPlayer } from '../player/runtime';
import { previousWord, recordWord } from './recordWord';
import { adjacentVoiceWord, recordingVoices, voiceCursorAt, type VoiceCursor } from './recordingVoices';
import type { StudioProject } from './project';
import type { useStudioDraft } from './useStudioDraft';
import { LYRIC_START, markSync } from './sync';
export { recordWord } from './recordWord';

const inputTarget = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable=true],[role=combobox],[role=menu],[role=menuitem],[role=dialog]');
interface HeldWord extends VoiceCursor { voiceId: string; start: number; src: string }
export interface SyncTarget { lineId: string; revision: number }

export function useWordRecording(edit: ReturnType<typeof useStudioDraft>, enabled: boolean, blocked: boolean, message: (value: string) => void, mode?: 'line' | 'word') {
  const held = useRef(new Map<string, HeldWord>()), cursors = useRef(new Map<string, VoiceCursor | null>());
  const selection = useRef(''), track = useRef('');
  const [, setCursorRevision] = useState(0);
  const [activeWordIds, setActiveWordIds] = useState<string[]>([]);
  const [syncTarget, setSyncTarget] = useState<SyncTarget>();
  const voices = useMemo(() => edit.draft ? recordingVoices(edit.draft) : [], [edit.draft?.lines, edit.draft?.performers]);
  const refresh = () => { setActiveWordIds([...held.current.values()].map(word => word.unitId)); setCursorRevision(value => value + 1); };
  const cancel = () => { held.current.clear(); refresh(); };
  const focusSync = (lineId: string) => setSyncTarget(previous => ({ lineId, revision: (previous?.revision || 0) + 1 }));
  const rememberSelection = (project: StudioProject) => {
    if (track.current !== project.trackId) { track.current = project.trackId; cursors.current.clear(); held.current.clear(); selection.current = ''; }
    const key = JSON.stringify([project.trackId, project.selectedId, project.selectedUnitId]);
    if (selection.current === key) return;
    selection.current = key;
    if (project.selectedId === LYRIC_START) { cursors.current.clear(); return; }
    const line = project.lines.find(line => line.id === project.selectedId);
    const word = line?.units.find(word => word.id === project.selectedUnitId && word.kind === 'word') || line?.units.find(word => word.kind === 'word');
    const voice = word && recordingVoices(project).find(voice => voice.words.some(cursor => cursor.unitId === word.id));
    if (line && word && voice) {
      cursors.current.set(voice.id, { lineId: line.id, unitId: word.id });
      const anchor = word.startMs ?? line.startMs ?? Math.round(getLocalAudioElement().currentTime * 1000);
      for (const other of recordingVoices(project)) {
        if (other.id === voice.id || [...held.current.values()].some(held => held.voiceId === other.id)) continue;
        const cursor = voiceCursorAt(project, other, anchor);
        cursors.current.set(other.id, cursor || null);
      }
    }
  };
  const begin = (key = 'pointer', voiceId?: string) => {
    if (held.current.has(key) || !enabled || blocked) return;
    const project = edit.current.current; if (!project) return;
    rememberSelection(project);
    const lanes = recordingVoices(project);
    let cursor: VoiceCursor | undefined;
    if (voiceId) {
      const voice = lanes.find(voice => voice.id === voiceId); if (!voice) return;
      const saved = cursors.current.get(voiceId);
      if (saved === null) { message('This voice is complete. Select a fragment to record it again.'); return; }
      cursor = saved && voice.words.find(word => word.lineId === saved.lineId && word.unitId === saved.unitId);
      cursor ??= voiceCursorAt(project, voice, Math.round(getLocalAudioElement().currentTime * 1000));
    } else {
      const line = project.lines.find(line => line.id === project.selectedId);
      const word = line?.units.find(word => word.id === project.selectedUnitId && word.kind === 'word') || line?.units.find(word => word.kind === 'word');
      if (line && word) cursor = { lineId: line.id, unitId: word.id };
    }
    const voice = cursor && lanes.find(voice => voice.words.some(word => word.unitId === cursor!.unitId));
    if (!cursor || !voice) { message('Select a singing fragment first.'); return; }
    if (cursors.current.get(voice.id) === null) { message('This voice is complete. Select a fragment to record it again.'); return; }
    if ([...held.current.values()].some(word => word.voiceId === voice.id)) return;
    const audio = getLocalAudioElement();
    if (audio.paused || audio.ended) { message('Play the audio, then hold T to record a word.'); return; }
    held.current.set(key, { ...cursor, voiceId: voice.id, start: Math.round(audio.currentTime * 1000), src: audio.currentSrc });
    refresh();
  };
  const end = (key = 'pointer') => {
    const value = held.current.get(key); if (!value) return;
    held.current.delete(key); refresh();
    const audio = getLocalAudioElement(), stop = Math.round(audio.currentTime * 1000);
    if (value.src !== audio.currentSrc || stop <= value.start) { message('Recording cancelled: no valid media-time interval.'); return; }
    edit.commit(project => {
      const line = project.lines.find(line => line.id === project.selectedId);
      const selected = line?.units.find(word => word.id === project.selectedUnitId && word.kind === 'word') || line?.units.find(word => word.kind === 'word');
      const ownsSelection = line?.id === value.lineId && selected?.id === value.unitId;
      const next = recordWord(project, value.lineId, value.unitId, value.start, stop);
      if (next === project) return project;
      const cursor = adjacentVoiceWord(project, value.lineId, value.unitId, 1);
      cursors.current.set(value.voiceId, cursor || null);
      if (ownsSelection) {
        // An automatic advance is not a manual selection of all voice cursors.
        selection.current = JSON.stringify([next.trackId, next.selectedId, next.selectedUnitId]);
        focusSync(next.selectedId); return next;
      }
      return { ...next, selectedId: project.selectedId, selectedUnitId: project.selectedUnitId };
    });
    refresh();
    message('Word recorded. This voice is ready for its next fragment.');
  };
  const markLine = (direction: -1 | 1 = 1) => {
    if (!edit.current.current || !enabled || blocked) return;
    const time = Math.round(getLocalAudioElement().currentTime * 1000);
    edit.commit(project => { const next = markSync(project, time, direction); focusSync(next.selectedId); return next; });
  };
  useEffect(() => { if (edit.draft) { rememberSelection(edit.draft); refresh(); } }, [edit.draft?.trackId, edit.draft?.selectedId, edit.draft?.selectedUnitId]);
  useEffect(() => { if (!enabled || blocked) cancel(); }, [enabled, blocked]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (blocked || event.repeat || event.isComposing || inputTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); cancel(); event.shiftKey ? edit.redo() : edit.undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); cancel(); edit.redo(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const word = (mode ?? edit.current.current?.settings.mode) === 'word', arrows = edit.current.current?.settings.wordArrowKeys;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
      if (word && digit && !event.shiftKey) {
        const project = edit.current.current;
        const voice = project && recordingVoices(project)[Number(digit[1]) - 1];
        if (voice) { event.preventDefault(); begin(event.code, voice.id); }
        return;
      }
      if ((event.code === 'KeyT' || arrows && event.code === 'ArrowRight') && word) { event.preventDefault(); begin(event.code); return; }
      if (arrows && word && event.code === 'ArrowLeft') { event.preventDefault(); cancel(); edit.commit(previousWord, 'word-selection'); return; }
      if (['ArrowDown', 'ArrowUp'].includes(event.code)) { event.preventDefault(); cancel(); markLine(event.code === 'ArrowUp' ? -1 : 1); }
      if (event.code === 'Space' && enabled && !(event.target instanceof Element && event.target.closest('button,a,summary,[role=button]'))) { event.preventDefault(); getLocalPlayer().toggle(); }
    };
    const up = (event: KeyboardEvent) => {
      if (!held.current.has(event.code)) return;
      event.preventDefault();
      if (inputTarget(event.target) || blocked) { held.current.delete(event.code); refresh(); } else end(event.code);
    };
    const hidden = () => { if (document.hidden) cancel(); };
    document.addEventListener('keydown', down); document.addEventListener('keyup', up);
    window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', hidden);
    const audio = getLocalAudioElement();
    const reposition = () => { cursors.current.clear(); cancel(); };
    audio.addEventListener('seeking', reposition); audio.addEventListener('emptied', reposition); audio.addEventListener('pause', cancel);
    return () => {
      document.removeEventListener('keydown', down); document.removeEventListener('keyup', up);
      window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden);
      audio.removeEventListener('seeking', reposition); audio.removeEventListener('emptied', reposition); audio.removeEventListener('pause', cancel);
    };
  });
  const voiceStates = voices.map(voice => {
    const project = edit.draft, heldWord = [...held.current.values()].find(word => word.voiceId === voice.id);
    const stored = cursors.current.get(voice.id);
    const cursor = heldWord || (stored === null ? undefined : stored || (project && voiceCursorAt(project, voice, Math.round(getLocalAudioElement().currentTime * 1000))));
    const line = project?.lines.find(line => line.id === cursor?.lineId), word = line?.units.find(word => word.id === cursor?.unitId);
    return { ...voice, cursor, wordText: word?.text || '', completed: stored === null, lineText: line?.text || '' };
  });
  return { recording: activeWordIds.length > 0, activeWordIds, voices: voiceStates, syncTarget, clearSyncTarget: () => setSyncTarget(undefined), begin, end, cancel, markLine };
}
