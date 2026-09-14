import { useEffect, useState } from 'react';
import { readLyrics } from './repository';
import type { SavedLyrics } from './types';

export function useSavedLyrics(trackId: string | undefined, embeddedChecked?: boolean) {
  const [state, setState] = useState<{ trackId?: string; saved?: SavedLyrics; loading: boolean; error?: string }>({ loading: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const updated = (event: Event) => { if ((event as CustomEvent<string>).detail === trackId) setRevision(value => value + 1); };
    window.addEventListener('local-lyrics-updated', updated);
    return () => window.removeEventListener('local-lyrics-updated', updated);
  }, [trackId]);
  useEffect(() => {
    let cancelled = false;
    if (!trackId) { setState({ loading: false }); return; }
    setState(previous => previous.trackId === trackId && previous.saved ? { ...previous, loading: false } : { trackId, loading: true });
    readLyrics(trackId).then(saved => {
      if (!cancelled) setState({ trackId, saved, loading: false });
    }).catch(error => {
      if (!cancelled) setState({ trackId, loading: false, error: `Saved lyrics could not be read. ${error instanceof Error ? error.message : 'Check browser storage.'}` });
    });
    return () => { cancelled = true; };
  }, [trackId, revision, embeddedChecked]);
  return { ...(state.trackId === trackId ? state : { loading: !!trackId }), reload: () => setRevision(value => value + 1) };
}
