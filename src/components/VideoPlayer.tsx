import React from 'react';
import type { VideoItem } from '../types';

// Lightweight modal YouTube player; renders nothing if no video provided
export const VideoPlayer: React.FC<{ video: VideoItem | null; onClose: () => void }> = ({ video, onClose }) => {
  if (!video) return null;

  // Build embed URL from the selected video's ID
  const src = `https://www.youtube.com/embed/${video.videoId}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-card w-full max-w-4xl">
        <div className="flex items-center justify-between p-3 border-b border-divider dark:border-gray-800">
          <div className="truncate pr-3">
            <div className="font-medium">{video.title}</div>
          </div>
          <button onClick={onClose} className="px-2 py-1 text-sm rounded-md border border-divider dark:border-gray-700">Close</button>
        </div>
        <div className="aspect-video w-full">
          <iframe
            width="100%"
            height="100%"
            src={src}
            title={video.title || 'YouTube video player'}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
};
