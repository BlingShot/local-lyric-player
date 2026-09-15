import { initializeTypography } from './theme/typography';
import { initializeAudioOutput } from './player/audioOutput';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initializeLibrary } from './player/runtime';
import { initializeFolderImport } from './library/folderImport';
import './index.css';
import { initializeDeepSeekConfig } from './analysis/deepseek/config';
import { initializeThemeConfig } from './theme';
import { initializeSurfaceConfig } from './theme/surface';
import { initializeDesktopZoom } from './desktop/zoom';
import { initializeLocalFonts } from './theme/fonts';
import { initializeLanguage } from './i18n';

void initializeDeepSeekConfig();
void initializeThemeConfig();
void initializeSurfaceConfig();
initializeDesktopZoom();
void initializeLanguage();
void initializeLocalFonts();
void initializeTypography();
void initializeLibrary().then(ready => { if (ready) { void initializeFolderImport(); void initializeAudioOutput(); } });
createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
);
