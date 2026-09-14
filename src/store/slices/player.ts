import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { initialPlaybackState, type PlaybackState } from '../../player/LocalAudioPlayer';

const playerSlice = createSlice({
  name: 'player',
  initialState: initialPlaybackState,
  reducers: {
    update: (_state, action: PayloadAction<PlaybackState>) => action.payload,
  },
});
export const playerActions = playerSlice.actions;
export default playerSlice.reducer;
