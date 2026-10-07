import { diagnosticLog } from '../desktop/diagnostics';
import { useEffect, useState } from 'react';
import type { LocalTrack } from '../library/importFiles';
import { resolveRemoteLyrics } from '../integrations/lyricflow/resolve';
import { store, useAppSelector } from '../store/store';
import { useSavedLyrics } from './useSavedLyrics';

interface Job { trackId: string; controller: AbortController; listeners: Set<(text: string) => void>; status: string; done: boolean; until: number; dismiss?: ReturnType<typeof setTimeout>; expire?: ReturnType<typeof setTimeout> }
const jobs = new Map<string, Job>();
function clearJobs() { for (const job of jobs.values()) { clearTimeout(job.dismiss); clearTimeout(job.expire); job.controller.abort(); } jobs.clear(); }
window.addEventListener('spotify-session-updated', clearJobs);
window.addEventListener('lyricflow-preferences-updated', clearJobs);
let currentTrackId = store.getState().player.currentId;
const unsubscribe = store.subscribe(() => {
  const next = store.getState().player.currentId;
  if (next === currentTrackId) return;
  currentTrackId = next;
  // Cancel synchronously with playback selection, before React effect cleanup.
  for (const [key, job] of jobs) if (job.trackId !== next) { job.controller.abort(); clearTimeout(job.dismiss); clearTimeout(job.expire); jobs.delete(key); }
});
import.meta.hot?.dispose(unsubscribe);
window.addEventListener('local-cache-cleared', () => { for (const [key, job] of jobs) if (job.done && !job.listeners.size) { clearTimeout(job.dismiss); clearTimeout(job.expire); jobs.delete(key); } });
function pruneJobs() {
  for (const [key, job] of jobs) if (job.done && !job.listeners.size && (job.until < Date.now() || jobs.size >= 64)) { clearTimeout(job.dismiss); clearTimeout(job.expire); jobs.delete(key); }
}
export function useResolvedLyrics(track?: LocalTrack) {
  const currentId = useAppSelector(state => state.player.currentId);
  const saved = useSavedLyrics(track?.id, track?.embeddedLyricsChecked);
  const [remote, setRemote] = useState({ id: '', status: '' }), [revision, setRevision] = useState(0);
  useEffect(() => { const update = () => setRevision(value => value + 1); window.addEventListener('spotify-session-updated', update); window.addEventListener('lyricflow-preferences-updated', update); return () => { window.removeEventListener('spotify-session-updated', update); window.removeEventListener('lyricflow-preferences-updated', update); }; }, []);
  useEffect(() => {
    if (!track || track.id !== currentId || !track.embeddedLyricsChecked || track.unavailable) return;
    pruneJobs();
    const key = JSON.stringify([track.id, track.name, track.artist, track.album, track.duration, track.isrc, track.spotifyId, track.audioRevision, track.metadataRevision]);
    let job = jobs.get(key);
    if (!job || job.controller.signal.aborted || job.done && job.until < Date.now()) {
      if (job) { clearTimeout(job.dismiss); clearTimeout(job.expire); }
      job = { trackId: track.id, controller: new AbortController(), listeners: new Set(), status: '', done: false, until: 0 }; jobs.set(key, job);
      const current = job;
      const notify = (text: string) => { if (current.controller.signal.aborted) return; current.status = text; current.listeners.forEach(listener => listener(text)); };
      void resolveRemoteLyrics(track, current.controller.signal, notify).catch(error => { if (!current.controller.signal.aborted) { diagnosticLog('warn', 'lyrics.remote', 'Remote lyric lookup failed.'); notify(error instanceof Error ? error.message : 'Remote lyric search failed. Using local lyrics.'); } })
        .finally(() => {
          current.done = true; current.until = Date.now() + 60000;
          if (jobs.get(key) === current && !current.controller.signal.aborted) current.expire = setTimeout(() => { if (jobs.get(key) === current && !current.listeners.size) { clearTimeout(current.dismiss); jobs.delete(key); } }, 60001);
          // One deadline per shared request: mounting the sidebar must not restart the toast.
          if (current.status && !current.controller.signal.aborted) current.dismiss = setTimeout(() => notify(''), 3000);
        });
    }
    const current = job, listener = (status: string) => setRemote({ id: track.id, status });
    current.listeners.add(listener); listener(current.status);
    return () => { current.listeners.delete(listener); if (!current.listeners.size && current.done) pruneJobs(); if (!current.listeners.size && !current.done) { current.controller.abort(); clearTimeout(current.dismiss); clearTimeout(current.expire); if (jobs.get(key) === current) jobs.delete(key); } };
  }, [currentId, track?.id, track?.name, track?.artist, track?.album, track?.duration, track?.isrc, track?.spotifyId, track?.audioRevision, track?.metadataRevision, track?.embeddedLyricsChecked, track?.unavailable, revision]);
  const retryRemote = () => { clearJobs(); window.dispatchEvent(new Event('spotify-session-updated')); };
  return { ...saved, remoteStatus: remote.id === track?.id ? remote.status : '', retryRemote };
}
