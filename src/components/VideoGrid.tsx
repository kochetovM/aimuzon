import React from 'react';
import type { VideoItem } from '../types';
import { VideoCard } from './VideoCard';

type Props = {
  items: VideoItem[];
  loading?: boolean;
  onSelect: (v: VideoItem) => void;
  onLoadMore?: () => void;
};

const VideoGrid: React.FC<Props> = ({ items, loading, onSelect, onLoadMore }) => {
  // Masonry-like responsive grid for video cards
  return (
    <div>
      {items.length === 0 && !loading && (
        <div className="text-sm text-text-secondary dark:text-gray-400">No results yet. Try searching for AI music.</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
        {items.map((it) => (
          <VideoCard key={it.videoId} item={it} onClick={() => onSelect(it)} />
        ))}
      </div>
      <div className="flex justify-center py-4">
        {loading ? (
          <div className="text-sm text-text-secondary">Loading…</div>
        ) : onLoadMore ? (
          <button onClick={onLoadMore} className="px-4 py-2 rounded-md border border-divider dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900">
            Load more
          </button>
        ) : null}
      </div>
    </div>
  );
};
