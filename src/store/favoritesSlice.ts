import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { VideoItem } from '../types';

export type FavoritesState = {
  byId: Record<string, VideoItem>;
};

const initialState: FavoritesState = {
  byId: {},
};

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState,
  reducers: {
    setFavorites(state, action: PayloadAction<VideoItem[]>) {
      state.byId = Object.fromEntries(action.payload.map(v => [v.videoId, v]));
    },
    toggleFavorite(state, action: PayloadAction<VideoItem>) {
      const v = action.payload;
      if (state.byId[v.videoId]) {
        delete state.byId[v.videoId];
      } else {
        state.byId[v.videoId] = v;
      }
    }
  }
});

export const { setFavorites, toggleFavorite } = favoritesSlice.actions;
export default favoritesSlice.reducer;
