import { useEffect, useRef, useState } from 'react';
import { newProject as newDraft, type StudioProject as StudioDraft } from './project';
import { readStudioDraft, saveStudioDraft } from './repository';

export function useStudioDraft(trackId: string, audioName: string, seed?: StudioDraft) {
  const [draft, setDraft] = useState<StudioDraft>();
  const current = useRef<StudioDraft | undefined>(undefined);
  const [status, setStatus] = useState('Loading draft…');
  const [error, setError] = useState('');
  const [historySize, setHistorySize] = useState(0);
  const history = useRef<StudioDraft[]>([]), group = useRef('');
  const future = useRef<StudioDraft[]>([]);
  const [futureSize, setFutureSize] = useState(0);
  const revision = useRef(0), alive = useRef(true);
  const [loadRevision, setLoadRevision] = useState(0);
  const name = useRef(audioName); name.current = audioName;
  useEffect(() => {
    let cancelled = false; alive.current = true;
    current.current = undefined; setDraft(undefined); setError(''); setStatus('Loading draft…');
    history.current = []; future.current = []; setFutureSize(0); setHistorySize(0); group.current = ''; revision.current++;
    readStudioDraft(trackId).then(value => {
      if (cancelled) return;
      const next = value || (seed ? { ...seed, trackId, audioName: name.current, updatedAt: Date.now() } : newDraft(trackId, name.current));
      current.current = next; setDraft(next); setStatus(value ? 'Draft restored' : 'Ready to edit');
      persist(next);
    }).catch(() => { if (!cancelled) { setError('The saved draft could not be read. Retry before editing to protect your previous work.'); setStatus('Draft unavailable'); } });
    return () => { cancelled = true; alive.current = false; revision.current++; };
  }, [trackId, loadRevision]);
  const persist = (next: StudioDraft) => {
    const request = ++revision.current; setStatus('Saving draft…'); setError('');
    void saveStudioDraft(next).then(() => { if (alive.current && request === revision.current) setStatus('Draft saved'); })
      .catch(() => { if (alive.current && request === revision.current) { setStatus('Draft not saved'); setError('Draft could not be saved. Check browser storage and retry, or export your work before leaving.'); } });
  };
  const commit = (change: (previous: StudioDraft) => StudioDraft, editGroup = '') => {
    const previous = current.current; if (!previous) return;
    if (editGroup === 'word-selection') { const next = change(previous); current.current = next; setDraft(next); group.current = ''; return; }
    const next = { ...change(previous), updatedAt: Math.max(Date.now(), previous.updatedAt + 1) };
    future.current = []; setFutureSize(0);
    if (!editGroup || editGroup !== group.current) { history.current = [...history.current.slice(-39), previous]; setHistorySize(history.current.length); }
    group.current = editGroup; current.current = next; setDraft(next); persist(next);
  };
  const select = (selectedId: string) => {
    if (!current.current || current.current.selectedId === selectedId) return;
    const next = { ...current.current, selectedId }; current.current = next; setDraft(next); group.current = '';
  };
  const undo = () => {
    const previous = history.current.pop(); if (!previous || !current.current) return;
    future.current.push(current.current); setFutureSize(future.current.length);
    const next = { ...previous, updatedAt: Math.max(Date.now(), current.current.updatedAt + 1) };
    group.current = ''; current.current = next; setDraft(next); setHistorySize(history.current.length); persist(next);
  };
  const redo = () => {
    const value = future.current.pop(); if (!value || !current.current) return;
    history.current.push(current.current); setHistorySize(history.current.length); setFutureSize(future.current.length);
    const next = { ...value, updatedAt: Math.max(Date.now(), current.current.updatedAt + 1) };
    group.current = ''; current.current = next; setDraft(next); persist(next);
  };
  useEffect(() => {
    if (!error && status !== 'Saving draft…') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [error, status]);
  return { draft, current, commit, select, undo, redo, canRedo: futureSize > 0, canUndo: historySize > 0, status, error,
    retry: () => current.current ? persist(current.current) : setLoadRevision(value => value + 1) };
}
