export type VideoItem = {
  videoId: string;
  title?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
  duration?: string | null;
  viewCount?: string | null;
  // Extended metadata for category classification
  description?: string;
  tags?: string[];
  videoCategoryId?: string | null; // YouTube category id (string from API)
  madeForKids?: boolean;
};

export type SearchResponse = {
  q: string;
  items: VideoItem[];
  nextPageToken?: string | null;
  cached?: boolean;
};

export type Category = {
  title: string;
};
