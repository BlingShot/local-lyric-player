import { useLyricsImmersion } from '../../lyrics/useLyricsImmersion';
import '../../styles/immersive-lyrics.css';
import { t } from '../../i18n';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Drawer } from 'antd';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Library } from './components/Library';
import PlayingBar from './components/PlayingBar';
import { GlobalDebugOverlay } from '../Debug/DebugOverlays';
import { FileDetails } from '../LocalTracks/FileDetails';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { uiActions } from '../../store/slices/offlineUi';
import { exitLyricsFullscreen, resetLyricsFullscreen } from '../../lyrics/fullscreen';

import { usePageEntrance } from '../usePageEntrance';

function useViewport() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(frame); };
  }, []);
  return { mobile: width < 768, tablet: width < 950 };
}

export function AppLayout({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  usePageEntrance(mainRef, location.pathname);
  const ui = useAppSelector(state => state.ui);
  const playbackFailed = useAppSelector(state => !!state.player.error);
  useLyricsImmersion(ui.lyricsFullscreen && location.pathname === '/lyrics', ui.settingsOpen || ui.queueOpen || ui.importOpen || ui.detailsOpen || playbackFailed);
  const { mobile, tablet } = useViewport();
  const compact = ui.libraryCollapsed;
  const libraryPanel = usePanelRef();
  const detailsPanel = usePanelRef();
  const expandedLibrarySize = useRef(22);
  const expandedDetailsSize = useRef(25);
  const desktopDetailsOpen = ui.detailsOpen && !tablet && !ui.lyricsFullscreen;
  const [resizingPanels, setResizingPanels] = useState(false);
  useEffect(() => {
    const changed = () => { if (!document.fullscreenElement) void exitLyricsFullscreen(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !ui.detailsOpen && !ui.settingsOpen && !ui.queueOpen && !ui.importOpen) void exitLyricsFullscreen(); };
    document.addEventListener('fullscreenchange', changed); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('fullscreenchange', changed); document.removeEventListener('keydown', escape); };
  }, [dispatch, ui.detailsOpen, ui.settingsOpen, ui.queueOpen, ui.importOpen]);
  useEffect(() => {
    if (location.pathname === '/lyrics' || !ui.lyricsFullscreen) return;
    resetLyricsFullscreen();
  }, [location.pathname, ui.lyricsFullscreen, dispatch]);
  useLayoutEffect(() => {
    if (mobile) return;
    const target = compact ? 85 : `${Math.max(tablet ? 25 : 20, expandedLibrarySize.current)}%`;
    const frame = requestAnimationFrame(() => libraryPanel.current?.resize(target));
    return () => cancelAnimationFrame(frame);
  }, [compact, mobile, tablet, ui.detailsOpen, libraryPanel]);
  useLayoutEffect(() => {
    if (mobile) return;
    const frame = requestAnimationFrame(() => detailsPanel.current?.resize(desktopDetailsOpen ? `${expandedDetailsSize.current}%` : 0));
    return () => cancelAnimationFrame(frame);
  }, [desktopDetailsOpen, mobile, detailsPanel]);
  useEffect(() => {
    document.querySelector('.Main-section')?.scrollTo(0, 0);
    document.querySelector('.offline-table-scroll')?.scrollTo(0, 0);
  }, [location.pathname]);
  const trackPage = ['/', '/collection/tracks', '/search'].includes(location.pathname) || location.pathname.startsWith('/album/');
  const main = <main ref={mainRef} className={`Main-section ${trackPage ? 'offline-fixed-track-page' : ''} ${location.pathname === '/lyrics' ? 'offline-lyrics-page' : ''}`} id='main-content'>{children}</main>;
  return (
    <div className='offline-app' data-lyrics-fullscreen={ui.lyricsFullscreen || undefined} data-lyrics-immersive={ui.lyricsFullscreen && ui.lyricsImmersive || undefined} data-lyrics-motion={ui.lyricsMotion || undefined}>
      <a className='offline-skip-link' href='#main-content'>{t("Skip to tracks")}</a>
      <div className='main-container offline-shell'>
        <Navbar />
        <div className='offline-panels'>
          {mobile ? main : <Group orientation='horizontal' className='offline-panel-group' data-resizing={resizingPanels || undefined}
            onLayoutChanged={(layout, meta) => {
              if (resizingPanels && meta.isUserInteraction && !compact && layout.left) expandedLibrarySize.current = layout.left;
              if (resizingPanels && meta.isUserInteraction && desktopDetailsOpen && layout.details) expandedDetailsSize.current = layout.details;
            }}
            onPointerDownCapture={event => { if (event.target instanceof Element && event.target.closest('[data-separator]')) setResizingPanels(true); }}
            onPointerUpCapture={() => setResizingPanels(false)}
            onPointerCancelCapture={() => setResizingPanels(false)}
            style={{ height: '100%', width: '100%', contain: 'size layout' }}>
            <Panel id='left' panelRef={libraryPanel} minSize={compact ? 85 : tablet ? '25%' : '20%'}
              maxSize={compact ? 85 : '32%'} defaultSize={compact ? 85 : '22%'} style={{ overflow: 'hidden' }}>
              <Library compact={compact} />
            </Panel>
            <Separator className='resize-handler' aria-label={t("Resize library")} />
            <Panel id='center' minSize='35%' style={{ overflow: 'hidden' }}>{main}</Panel>
            <Separator className='resize-handler offline-details-separator' aria-label={t("Resize details")}
              disabled={!desktopDetailsOpen} aria-hidden={!desktopDetailsOpen} data-closed={!desktopDetailsOpen || undefined} />
            <Panel id='details' panelRef={detailsPanel} minSize={desktopDetailsOpen ? '23%' : 0}
              maxSize={desktopDetailsOpen ? '30%' : 0} defaultSize={desktopDetailsOpen ? '25%' : 0}
              style={{ overflow: 'hidden' }}>
              <div className='offline-details-content' aria-hidden={!desktopDetailsOpen} inert={!desktopDetailsOpen}><FileDetails visible={desktopDetailsOpen && !ui.lyricsFullscreen} /></div>
            </Panel>
          </Group>}
        </div>
      </div>
      <PlayingBar />
      <GlobalDebugOverlay />

      <Drawer title={t("Your library")} open={mobile && ui.libraryDrawerOpen && !ui.lyricsFullscreen} placement='left' width={300}
        onClose={() => dispatch(uiActions.closeLibraryDrawer())}><Library drawer /></Drawer>
      <Drawer title={t("File details")} open={(tablet || ui.lyricsFullscreen) && ui.detailsOpen} placement='right' width={320}
        onClose={() => dispatch(uiActions.toggleDetails())}><FileDetails visible={(tablet || ui.lyricsFullscreen) && ui.detailsOpen} /></Drawer>
    </div>
  );
}
