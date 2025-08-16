import React from 'react';
import type { VideoItem } from '../types';
import { useAppDispatch, useAppSelector } from '../store';
import { toggleFavorite } from '../store/favoritesSlice';
import { saveFavorite, removeFavorite } from '../api';
import { useToast } from './ToastProvider';

// Convert raw numeric view counts into short, human-readable labels
function formatViews(v?: string | null): string | null {
  if (!v) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B views';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M views';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K views';

  return n.toLocaleString() + ' views';
}

export const VideoCard: React.FC<{ item: VideoItem; onClick?: () => void }> = ({ item, onClick }) => {
  const dispatch = useAppDispatch();
  const isFav = useAppSelector(s => Boolean(s.favorites.byId[item.videoId]));
  const views = formatViews(item.viewCount);
  const { error: notifyError, success: notifySuccess } = useToast();

  return (
    <div className="text-left w-full group">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800 shadow-card">
        {item.thumbnailUrl ? (
          <button
            type="button"
            className="w-full h-full"
            onClick={onClick}
            aria-label={item.title || 'Open video'}
          >
            <img
              src={item.thumbnailUrl}
              alt={item.title || 'Video'}
              className="w-full h-full object-cover cursor-pointer transform transition-transform duration-300 ease-out group-hover:scale-[1.03]"
              loading="lazy"
              decoding="async"
            />
          </button>
        ) : (
          <button
            type="button"
            className="w-full h-full"
            onClick={onClick}
            aria-label={item.title || 'Open video'}
          />
        )}
        {views && (
          <div className="absolute bottom-2 left-2 text-[11px] px-2 py-1 rounded-full bg-black/60 text-white backdrop-blur-sm">
            {views}
          </div>
        )}
        <button
          className={`absolute top-2 right-2 text-xs px-2 py-1 rounded-full border transition ${isFav ? 'bg-brand-secondary text-white border-brand-secondary' : 'bg-white/80 text-gray-800 border-gray-300 hover:bg-white/90 dark:bg-gray-900/80 dark:text-gray-100 dark:border-gray-700'}`}
          onClick={async () => {
            dispatch(toggleFavorite(item));

            try {
              if (isFav) {
                await removeFavorite(item.videoId);
                notifySuccess('Removed from favorites');
              } else {
                await saveFavorite(item);
                notifySuccess('Saved to favorites');
              }
            } catch (e: any) {
              notifyError('Could not sync favorite with the server. Your change is only local.');
            }
          }}
          aria-pressed={isFav}
        >
          {isFav ? 'Saved' : 'Save'}
        </button>
      </div>
      <div className="mt-3">
        <button className="font-medium line-clamp-2 hover:underline" onClick={onClick}>{item.title}</button>
      </div>
    </div>
  );
};
