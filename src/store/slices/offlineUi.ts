import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { defaultLyricsAppearance, type LyricsAppearance } from '../../lyrics/appearance';

const uiSlice = createSlice({
  name: 'ui',
  initialState: { libraryCollapsed: false, libraryDrawerOpen: false, detailsOpen: false, detailsMode: 'details' as 'details' | 'lyrics', importOpen: false, queueOpen: false, importMessage: '', importNoticeId: 0, playbackMemoryError: '', lyricsFullscreen: false, lyricsMotion: null as 'enter' | 'exit' | 'return' | null, settingsOpen: false, lyricsAppearance: defaultLyricsAppearance },
  reducers: {
    toggleLibrary(state) { state.libraryCollapsed = !state.libraryCollapsed; },
    openLibraryDrawer(state) { state.libraryDrawerOpen = true; },
    closeLibraryDrawer(state) { state.libraryDrawerOpen = false; },
    setDetailsMode(state, action: PayloadAction<'details' | 'lyrics'>) { state.detailsMode = action.payload; },
    toggleDetails(state) { state.detailsOpen = !state.detailsOpen; },
    openImport(state) { state.importOpen = true; state.libraryDrawerOpen = false; },
    closeImport(state) { state.importOpen = false; },
    toggleQueue(state) { state.queueOpen = !state.queueOpen; },
    setLyricsFullscreen(state, action: PayloadAction<boolean>) { state.lyricsFullscreen = action.payload; },
    setLyricsMotion(state, action: PayloadAction<'enter' | 'exit' | 'return' | null>) { state.lyricsMotion = action.payload; },
    setSettingsOpen(state, action: PayloadAction<boolean>) { state.settingsOpen = action.payload; },
    setLyricsAppearance(state, action: PayloadAction<LyricsAppearance>) { state.lyricsAppearance = action.payload; },
    setImportMessage(state, action: PayloadAction<string>) { state.importMessage = action.payload; state.importNoticeId++; },
    setPlaybackMemoryError(state, action: PayloadAction<string>) { state.playbackMemoryError = action.payload; },
  },
});
export const uiActions = uiSlice.actions;
export default uiSlice.reducer;
