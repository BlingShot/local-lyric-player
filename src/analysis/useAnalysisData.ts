import { useEffect, useRef, useState } from 'react';
import type { LocalTrack } from '../library/importFiles';
import { readAnalysisResults } from './repository';
import { readAnalysisSources } from './sources';
import { audioVersion } from './versions';

export function useAnalysisData(track: LocalTrack, tracks: LocalTrack[]) {
  const latest = useRef({ track, tracks }); latest.current = { track, tracks };
  const [revision, refresh] = useState(0);
  const [data, setData] = useState<{ sources: Awaited<ReturnType<typeof readAnalysisSources>>; saved: Awaited<ReturnType<typeof readAnalysisResults>> }>();
  const [error, setError] = useState('');
  const signature = JSON.stringify([track.id, track.name, track.artist, track.album, track.albumArtist, track.trackNumber, track.discNumber,
    track.releaseDate, track.artworkSource, track.coverUrl, tracks.map(item => [item.id, audioVersion(item), !!item.unavailable])]);
  useEffect(() => {
    let cancelled = false; setError('');
    const current = latest.current;
    Promise.all([readAnalysisSources(current.track, current.tracks), readAnalysisResults(current.track.id)])
      .then(([sources, saved]) => { if (!cancelled) setData({ sources, saved }); })
      .catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : 'Local analysis data could not be read.'); });
    return () => { cancelled = true; };
  }, [signature, revision]);
  useEffect(() => {
    const updated = (event: Event) => { if ((event as CustomEvent<string>).detail === track.id) refresh(value => value + 1); };
    const focused = () => refresh(value => value + 1);
    const events = ['local-lyrics-updated', 'local-studio-draft-updated', 'local-analysis-updated'];
    events.forEach(name => window.addEventListener(name, updated)); window.addEventListener('focus', focused);
    return () => { events.forEach(name => window.removeEventListener(name, updated)); window.removeEventListener('focus', focused); };
  }, [track.id]);
  return { data, error, refresh: () => refresh(value => value + 1) };
}
