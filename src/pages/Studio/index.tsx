import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppMenu } from '../../components/AppMenu';
import { StudioWorkspace } from '../../components/Studio/StudioWorkspace';
import { store, useAppSelector } from '../../store/store';
import { resetLyricsFullscreen } from '../../lyrics/fullscreen';
import { lastStudioTrack, studioRecoveries, discardStudioRecovery } from '../../studio/repository';
import type { StudioProject } from '../../studio/project';

export function StudioPage() {
  const ready = useAppSelector(state => state.library.ready);
  const [params, setParams] = useSearchParams();
  const [trackId, setTrackId] = useState<string | null>(() => params.get('trackId') || store.getState().player.currentId);
  const [recoveries, setRecoveries] = useState(studioRecoveries), [recoveryVersion, setRecoveryVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setRecoveries(studioRecoveries());
    window.addEventListener('storage', refresh); window.addEventListener('local-studio-recovery-updated', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('local-studio-recovery-updated', refresh); };
  }, []);
  const [seed, setSeed] = useState<StudioProject>();
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const requestedTrack = params.get('trackId');
  useEffect(() => { if (requestedTrack && requestedTrack !== trackId) { setSeed(undefined); setTrackId(requestedTrack); } }, [requestedTrack]);
  useEffect(() => { resetLyricsFullscreen(); }, []);
  useEffect(() => {
    if (!ready || trackId) return;
    let cancelled = false; setError('');
    lastStudioTrack().then(id => { if (!cancelled) setTrackId(id || 'untitled'); }).catch(() => { if (!cancelled) setError('The previous studio session could not be read. Check browser storage and retry.'); });
    return () => { cancelled = true; };
  }, [ready, trackId, retry]);
  if (!ready || !trackId) return <div className='offline-app studio-page'><header className='studio-header'><AppMenu /><h1>{t("Lyric Studio")}</h1><Link to='/'>{t("Back to player")}</Link></header><main className='studio-empty'>{error || t("Opening your local workspace…")}{error && <button onClick={() => setRetry(v => v + 1)}>{t("Retry")}</button>}</main></div>;
  return <>{recoveries.length > 0 && <details className='studio-recovery-list'>
    <summary>{t('Unsaved recovery drafts')} ({recoveries.length})</summary>
    {recoveries.map(entry => <div key={entry.key}><span>{entry.draft.audioName || entry.draft.trackId}</span>
      <button onClick={() => { setSeed(undefined); setTrackId(entry.draft.trackId); setRecoveryVersion(v => v + 1); setParams({ trackId: entry.draft.trackId }, { replace: true }); }}>{t('Restore draft')}</button>
      <button onClick={() => { if (window.confirm(t('Discard this recovery copy? Export any needed work first.'))) { try { discardStudioRecovery(entry); } catch { setError('Recovery copy could not be removed.'); } } }}>{t('Discard recovery')}</button>
    </div>)}{error && <p role='alert'>{error}</p>}
  </details>}<StudioWorkspace key={`${trackId}:${recoveryVersion}`} trackId={trackId} seed={seed} changeTrack={(id, previous) => { setSeed(previous); setTrackId(id); setParams({ trackId: id }, { replace: true }); }} /></>;
}
