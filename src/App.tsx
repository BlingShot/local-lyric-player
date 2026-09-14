import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useLanguage } from './i18n';
import { lazy, Suspense } from 'react';
import { Provider } from 'react-redux';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { FollowPlayingTrack } from './components/FollowPlayingTrack';
import { AppLayout } from './components/Layout';
import { ImportDialog } from './components/Import/ImportDialog';
import { FileDropZone } from './components/Import/FileDropZone';
import { LibraryPage } from './pages/Library';
import { AlbumPage, AlbumsPage } from './pages/Albums';
import { LyricsPage } from './pages/Lyrics';
import { store } from './store/store';
import { useAppTheme } from './theme';
import './styles/App.scss';
import './styles/offline.scss';
import './styles/lyrics.scss';
import './styles/studio.scss';
import './styles/analysis.scss';
import './styles/audio-analysis.scss';
import './styles/theme.scss';
import './styles/motion.scss';
import './styles/menus.scss';
import './styles/mini-lyrics.scss';
import './styles/desktop.scss';
import './styles/glass.scss';
import './styles/studio-sync.scss';

const StudioPage = lazy(() => import('./pages/Studio').then(module => ({ default: module.StudioPage })));
const AnalyzePage = lazy(() => import('./pages/Analyze').then(module => ({ default: module.AnalyzePage })));

export default function App() {
  const { language } = useLanguage();
  const { mode } = useAppTheme();
  return (
    <ConfigProvider locale={language === 'zh-CN' ? zhCN : enUS} theme={{
      algorithm: mode === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm,
      token: { colorPrimary: '#1ed760', fontFamily: 'var(--app-font-family, system-ui, sans-serif)',
        motionDurationFast: '0.12s', motionDurationMid: '0.18s', motionDurationSlow: '0.22s' },
    }}>
      <Provider store={store}>
        <BrowserRouter>
          <FollowPlayingTrack />
          <FileDropZone>
          <Routes><Route path='/studio' element={<Suspense fallback={<div className='offline-app studio-page route-loading' role='status'>Opening Lyric Studio…</div>}><StudioPage /></Suspense>} /><Route path='*' element={
          <AppLayout>
            <Routes>
              <Route path='/' element={<LibraryPage />} />
              <Route path='/collection/tracks' element={<LibraryPage />} />
              <Route path='/search' element={<LibraryPage searching />} />
              <Route path='/collection/albums' element={<AlbumsPage />} />
              <Route path='/album/:albumId' element={<AlbumPage />} />
              <Route path='/lyrics' element={<LyricsPage />} />
              <Route path='/analyze/:trackId' element={<Suspense fallback={<div className='route-loading' role='status'>Opening Analyze…</div>}><AnalyzePage /></Suspense>} />
              <Route path='*' element={<Navigate to='/' replace />} />
            </Routes>
          </AppLayout>
          } /></Routes>
          <ImportDialog />
          </FileDropZone>
        </BrowserRouter>
      </Provider>
    </ConfigProvider>
  );
}
