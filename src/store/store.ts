import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import library from './slices/library';
import ui from './slices/offlineUi';
import player from './slices/player';

// Only local file descriptions and presentation state. No accounts, tokens, API cache or SDK.
export const store = configureStore({ reducer: { library, ui, player } });
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
