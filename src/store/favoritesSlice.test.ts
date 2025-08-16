import favoritesReducer, { toggleFavorite, setFavorites, FavoritesState } from './favoritesSlice';
import type { VideoItem } from '../types';

test('toggleFavorite adds and removes items', () => {
  const v: VideoItem = { videoId: 'abc', title: 'Song' };
  const state: FavoritesState = { byId: {} };

  const added = favoritesReducer(state, toggleFavorite(v));
  expect(added.byId['abc']).toBeTruthy();

  const removed = favoritesReducer(added, toggleFavorite(v));
  expect(removed.byId['abc']).toBeUndefined();
});

test('setFavorites replaces map', () => {
  const v1: VideoItem = { videoId: '1', title: 'A' };
  const v2: VideoItem = { videoId: '2', title: 'B' };
  const state: FavoritesState = { byId: { x: { videoId: 'x' } as VideoItem } };
  const next = favoritesReducer(state, setFavorites([v1, v2]));
  expect(Object.keys(next.byId)).toEqual(['1', '2']);
});
