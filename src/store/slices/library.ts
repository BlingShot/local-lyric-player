import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { LocalTrack } from '../../library/importFiles';
import { defaultTrackColumns, type LocalPlaylist, type TrackColumns } from '../../library/database';

interface LibraryState {
  tracks: LocalTrack[]; selectedId: string | null; playlists: LocalPlaylist[];
  ready: boolean; busy: string; storageError: string;
  columns: TrackColumns;
}
const initialState: LibraryState = { tracks: [], selectedId: null, playlists: [], ready: false, busy: 'Restoring local library…', storageError: '', columns: defaultTrackColumns };

const librarySlice = createSlice({
  name: 'library',
  initialState,
  reducers: {
    restore(state, action: PayloadAction<{ tracks: LocalTrack[]; playlists: LocalPlaylist[] }>) {
      state.tracks = action.payload.tracks; state.playlists = action.payload.playlists; state.ready = true;
    },
    updateTracks(state, action: PayloadAction<LocalTrack[]>) {
      const updates = new Map(action.payload.map(track => [track.id, track]));
      state.tracks = state.tracks.map(track => updates.get(track.id) ?? track);
    },
    setBusy(state, action: PayloadAction<string>) { state.busy = action.payload; },
    setStorageError(state, action: PayloadAction<string>) { state.storageError = action.payload; },
    setColumns(state, action: PayloadAction<TrackColumns>) { state.columns = action.payload; },
    addTracks(state, action: PayloadAction<LocalTrack[]>) {
      const known = new Set(state.tracks.map(track => track.id));
      for (const track of action.payload) {
        if (!known.has(track.id)) { state.tracks.push(track); known.add(track.id); }
      }
    },
    selectTrack(state, action: PayloadAction<string>) {
      if (state.tracks.some(track => track.id === action.payload)) state.selectedId = action.payload;
    },
    removeTrack(state, action: PayloadAction<string>) {
      state.tracks = state.tracks.filter(track => track.id !== action.payload);
      if (state.selectedId === action.payload) state.selectedId = null;
      for (const playlist of state.playlists) playlist.trackIds = playlist.trackIds.filter(id => id !== action.payload);
    },
    setDuration(state, action: PayloadAction<{ id: string; duration: number }>) {
      const track = state.tracks.find(item => item.id === action.payload.id);
      if (track) { track.duration = action.payload.duration; delete track.error; }
    },
    setError(state, action: PayloadAction<{ id: string; error: string }>) {
      const track = state.tracks.find(item => item.id === action.payload.id);
      if (track) track.error = action.payload.error;
    },
    clear: () => initialState,
  },
});
export const libraryActions = librarySlice.actions;
export default librarySlice.reducer;
