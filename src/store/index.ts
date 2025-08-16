import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';

import favoritesReducer from './favoritesSlice';

// Central Redux store: add new slices to the reducer map below
export const store = configureStore({
  reducer: {
    favorites: favoritesReducer,
  },
});

// Inferred types for state and dispatch
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Typed hooks for convenient usage across the app
export const useAppDispatch: () => AppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
