import React from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import { toggleFavorite } from '../store/favoritesSlice';
import type { VideoItem } from '../types';

export const Favorites: React.FC<{ onSelect: (v: VideoItem) => void }> = ({ onSelect }) => {
  const favs = useAppSelector(s => Object.values(s.favorites.byId));
  const dispatch = useAppDispatch();

  // Early return for empty state
  if (favs.length === 0) {
    return (
      <div>
        <div className="text-sm font-medium mb-2">Favorites</div>
        <div className="text-sm text-text-secondary">No favorites yet.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-sm font-medium mb-2">Favorites</div>
      <ul className="space-y-2">
        {favs.map(v => (
          <li key={v.videoId} className="flex items-center gap-2">
            {v.thumbnailUrl && (
              <img src={v.thumbnailUrl} className="w-12 h-8 object-cover rounded" alt="thumb" />
            )}
            <button className="flex-1 text-left text-sm hover:underline" onClick={() => onSelect(v)}>{v.title}</button>
            <button className="text-xs px-2 py-1 rounded border border-divider dark:border-gray-700" onClick={() => dispatch(toggleFavorite(v))}>Unsave</button>
          </li>
        ))}
      </ul>
    </div>
  );
};
