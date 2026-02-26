import type { SearchResponse, VideoItem } from './types';

// In-memory session cache for search results and in-flight requests
// Resets only on full page reload
const searchCache: Map<string, SearchResponse> = new Map();
const inFlightSearch: Map<string, Promise<SearchResponse>> = new Map();

type SearchOptions = {
  order?: 'date' | 'viewCount' | 'relevance';
  maxResults?: number;
  publishedAfter?: string;
  publishedBefore?: string;
  kidFriendlyOnly?: boolean;
  videoCategoryId?: string;
  videoDuration?: 'short' | 'medium' | 'long';
  videoSyndicated?: boolean;
};

// Date window helpers for YouTube API
export type DateWindow = { publishedAfter: string; publishedBefore: string };

function toIsoUTC(input?: string | Date): string | undefined {
  if (!input) return undefined;
  try {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

export function getDefaultDateWindow(): DateWindow {
  const now = new Date();
  const after = new Date(now);
  after.setMonth(after.getMonth() - 1); // 1 month ago
  return { publishedAfter: after.toISOString(), publishedBefore: now.toISOString() };
}

export function getNextWindowByMonths(current: DateWindow, monthsBack = 1): DateWindow {
  const before = new Date(current.publishedAfter); // next window's end is previous window's start
  const after = new Date(before);
  after.setMonth(after.getMonth() - monthsBack);
  return { publishedAfter: after.toISOString(), publishedBefore: before.toISOString() };
}

function normalizeSearchOptions(opts?: SearchOptions): SearchOptions {
  const o = { ...(opts || {}) } as SearchOptions;
  // Compute defaults
  const def = getDefaultDateWindow();
  const afterIso = toIsoUTC(o.publishedAfter) || def.publishedAfter;
  const beforeIso = toIsoUTC(o.publishedBefore) || def.publishedBefore;

  // Validate ordering
  const afterDate = new Date(afterIso);
  const beforeDate = new Date(beforeIso);
  if (!(afterDate.getTime() < beforeDate.getTime())) {
    throw new Error('publishedAfter must be before publishedBefore');
  }

  o.publishedAfter = afterIso;
  o.publishedBefore = beforeIso;
  return o;
}

function stableStringify(obj: unknown): string {
  // stable stringify to ensure consistent cache keys regardless of property order
  const seen = new WeakSet<object>();
  return JSON.stringify(obj, function (key, value) {
    if (value && typeof value === 'object') {
      const objVal = value as Record<string, unknown>;
      if (seen.has(objVal)) return; // avoid cycles
      seen.add(objVal);
      if (!Array.isArray(objVal)) {
        const sorted: Record<string, unknown> = {};
        Object.keys(objVal).sort().forEach(k => { sorted[k] = objVal[k]; });
        return sorted;
      }
    }
    return value;
  });
}

function makeSearchKey(args: { q: string; pageToken?: string; opts?: SearchOptions; mode: 'yt' | 'proxy' }): string {
  return stableStringify({
    q: args.q,
    pageToken: args.pageToken || '',
    opts: args.opts || {},
    mode: args.mode,
  });
}

function deepClone<T>(val: T): T {
  // Prefer structuredClone if available, otherwise fallback to JSON
  const g = globalThis as unknown as { structuredClone?: <U>(v: U) => U };
  if (typeof g.structuredClone === 'function') {
    return g.structuredClone(val);
  }
  return JSON.parse(JSON.stringify(val));
}

// Global content blocklist for YouTube search results (case-insensitive, substring match)
// Keep this list easily extendable in the future
const CONTENT_BLOCKLIST = [
  // Previously provided examples
  'sanwariya', 'pajama', 'naked', 'sex',
  // Sexual
  'sexual','nsfw','xxx','porn','erotic','18+','x-rated','nude','nudity','fetish','bdsm',
  // Violence
  'violent','violence','murder','kill','killing','blood','gore','weapon','gun','shoot','shooting','stab','stabbing','war','fight','assault','suicide',
  // Explicit language
  'explicit','swear','profanity','fuck','shit','bitch','asshole','cunt','dick','bastard',
  // Age restriction indicators
  'age restricted'
];
const isTitleBlocked = (title?: string): boolean => {
  const t = (title || '').toLowerCase();
  return CONTENT_BLOCKLIST.some(w => t.includes(w));
};

// Helper to determine maximum allowed age from env (client side)
const getMaxAllowedAge = (): number => {
  const cra = process.env.REACT_APP_MAX_ALLOWED_AGE;
  const val = parseInt((cra ?? '').toString(), 10);
  if (Number.isFinite(val) && val > 0) return val;
  return 14; // default: suitable for users below this age
};

const getBaseUrl = (): string => {
  // Prefer explicit env first
  const cra = process.env.REACT_APP_API_BASE_URL;
  const explicit = (cra || '').toString().trim();
  if (explicit) return explicit.replace(/\/$/, '');

  // If running in a browser, use same-origin so CRA dev proxy can forward /api in development
  // and to avoid mixed content/CORS in production
  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin.replace(/\/$/, '');
  }

  // Fallback for non-browser environments (SSR/tests)
  return 'http://localhost:4000';
};

// Prefer client-side YouTube Data API if a public key is provided
const getYouTubeKey = (): string => {
  // Prefer the new env var name, but keep backward compatibility with the old one
  const primary = process.env.REACT_APP_YOUTUBE_API_KEY; // do not hardcode keys
  const legacy = process.env.REACT_APP_YT_API_KEY; // backward compatible
  const key = (primary || legacy || '').toString().trim();
  return key;
};

type YTSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    channelId?: string;
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { medium?: { url?: string }, default?: { url?: string } };
    description?: string;
  };
};

type YTVideoDetails = {
  id: string;
  contentDetails?: { duration?: string; contentRating?: { ytRating?: string } };
  statistics?: { viewCount?: string };
  status?: { madeForKids?: boolean };
  snippet?: { tags?: string[]; categoryId?: string };
};

type YTChannel = {
  id: string;
  statistics?: { subscriberCount?: string };
};

/**
 * Perform a YouTube Data API v3 search and enrich with videos.list + channels.list.
 *
 * Request (search.list):
 * - part=snippet
 * - q (string): search query
 * - type=video
 * - safeSearch=strict
 * - order: date | viewCount | relevance
 * - maxResults: default 30; clamped to [1..30] (YouTube allows up to 50, but we cap at 30 by design)
 * - publishedAfter / publishedBefore: RFC3339/ISO 8601 timestamps
 * - videoCategoryId (optional)
 * - videoDuration (optional): short | medium | long
 * - videoSyndicated (optional): true
 *
 * Error handling:
 * - 403 quotaExceeded/forbidden: throws an Error with a user-friendly message
 * - 400 badRequest/invalidParameter: throws an Error with a user-friendly message
 * - All errors log details to console (no keys are logged)
 */
async function fetchYouTubeDirect(q: string, pageToken?: string, opts?: SearchOptions): Promise<SearchResponse> {
  const key = getYouTubeKey();
  if (!key) throw new Error('YouTube API key is not configured. Please set REACT_APP_YOUTUBE_API_KEY in your .env.');

  // 1) search endpoint
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('key', key);
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('q', q);
  // Cap at 30 per requirements (YouTube allows up to 50)
  const requested = typeof opts?.maxResults === 'number' ? opts.maxResults : 30;
  const maxResults = Math.max(1, Math.min(30, requested));
  searchUrl.searchParams.set('maxResults', String(maxResults));
  searchUrl.searchParams.set('type', 'video');
  // Enforce family-friendly filter via API
  searchUrl.searchParams.set('safeSearch', 'strict');
  // Optional narrowing filters
  if (opts?.videoCategoryId) searchUrl.searchParams.set('videoCategoryId', String(opts.videoCategoryId));
  if (opts?.videoDuration) searchUrl.searchParams.set('videoDuration', opts.videoDuration);
  if (typeof opts?.videoSyndicated === 'boolean' && opts.videoSyndicated) searchUrl.searchParams.set('videoSyndicated', 'true');
  // Freshness preferred: order by date by default
  const order = opts?.order ?? 'date';
  searchUrl.searchParams.set('order', order);
  // Normalize/validate date window (defensive; fetchSearch already normalized)
  const def = getDefaultDateWindow();
  const afterIso = toIsoUTC(opts?.publishedAfter) || def.publishedAfter;
  const beforeIso = toIsoUTC(opts?.publishedBefore) || def.publishedBefore;
  if (new Date(afterIso) >= new Date(beforeIso)) {
    throw new Error('publishedAfter must be before publishedBefore');
  }
  searchUrl.searchParams.set('publishedAfter', afterIso);
  searchUrl.searchParams.set('publishedBefore', beforeIso);
  if (pageToken) searchUrl.searchParams.set('pageToken', pageToken);

  const searchResp = await fetch(searchUrl.toString());
  if (!searchResp.ok) {
    let body: any = null;
    try { body = await searchResp.json(); } catch { body = await searchResp.text(); }
    const status = searchResp.status;
    const reason = typeof body === 'object' ? body?.error?.errors?.[0]?.reason : undefined;
    const message = typeof body === 'object' ? (body?.error?.message || JSON.stringify(body)) : String(body);
    console.error('[YouTube Search] HTTP error', { status, reason, message });
    if (status === 403 || reason === 'quotaExceeded' || String(message).toLowerCase().includes('quota')) {
      const err = new Error('YouTube API quota reached or access forbidden. Please try again later.');
      throw err;
    }
    if (status === 400 || reason === 'badRequest') {
      const err = new Error('Invalid YouTube API request. Please adjust filters or try again.');
      throw err;
    }
    throw new Error(`YouTube search failed: ${status} ${message || ''}`);
  }
  const searchData = await searchResp.json();
  const items = (searchData.items || []) as YTSearchItem[];
  const nextPageToken = (searchData.nextPageToken || null) as string | null;

  const ids = items.map(i => i?.id?.videoId).filter(Boolean) as string[];
  const channelIds = Array.from(new Set(items.map(i => i?.snippet?.channelId).filter(Boolean))) as string[];
  let detailsMap = new Map<string, YTVideoDetails>();
  let channelMap = new Map<string, YTChannel>();
  if (ids.length > 0) {
    const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    detailsUrl.searchParams.set('key', key);
    // include snippet to access tags for better filtering
    detailsUrl.searchParams.set('part', 'contentDetails,statistics,status,snippet');
    detailsUrl.searchParams.set('id', ids.join(','));
    detailsUrl.searchParams.set('maxResults', '24');

    const detResp = await fetch(detailsUrl.toString());
    if (detResp.ok) {
      const detData = await detResp.json();
      const detItems = (detData.items || []) as YTVideoDetails[];
      detailsMap = new Map(detItems.map((d) => [d.id, d]));
    }
  }

  // Fetch channel statistics to approximate verification/established channels
  if (channelIds.length > 0) {
    const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    channelUrl.searchParams.set('key', key);
    channelUrl.searchParams.set('part', 'statistics,snippet');
    channelUrl.searchParams.set('id', channelIds.join(','));
    // Note: channels.list supports up to 50 ids per request
    const chResp = await fetch(channelUrl.toString());
    if (chResp.ok) {
      const chData = await chResp.json();
      const chItems = (chData.items || []) as YTChannel[];
      channelMap = new Map(chItems.map((c) => [c.id, c]));
    }
  }

  // Kid-friendly filtering based on provided policy (title, description, tags, age restriction)
  function isKidFriendly(sn: YTSearchItem['snippet'], det: YTVideoDetails | undefined): boolean {
    try {
      const maxAge = getMaxAllowedAge();
      const title: string = (sn?.title || '').toLowerCase();
      const desc: string = (sn?.description || '').toLowerCase();
      const tags: string[] = ((det?.snippet?.tags || []) as string[]).map((t) => String(t).toLowerCase());
      const rating = det?.contentDetails?.contentRating?.ytRating;
      // Exclude explicit age restriction for audiences below 18
      if (maxAge < 18 && rating === 'ytAgeRestricted') return false;
      // Block if any blocklisted word appears in title, description, or tags
      const textHit = CONTENT_BLOCKLIST.some(k => title.includes(k) || desc.includes(k));
      if (textHit) return false;
      if (tags.length > 0 && CONTENT_BLOCKLIST.some(k => tags.some(t => t.includes(k)))) return false;
      return true;
    } catch {
      return true;
    }
  }

  // Always apply kid-friendly filtering
  const filteredItems = items.filter((i) => {
    const vid = i?.id?.videoId as string;
    const sn = i?.snippet;
    const d = detailsMap.get(vid);
    return isKidFriendly(sn, d);
  });

  // Prioritize: 1) made for kids, 2) established channels (heuristic: subscriberCount >= 100k)
  const prioritizedItems = filteredItems.slice().sort((a, b) => {
    const da = detailsMap.get(a?.id?.videoId as string);
    const db = detailsMap.get(b?.id?.videoId as string);
    const mka = da?.status?.madeForKids ? 1 : 0;
    const mkb = db?.status?.madeForKids ? 1 : 0;

    if (mkb !== mka) return mkb - mka;

    const cha = channelMap.get(a?.snippet?.channelId as string);
    const chb = channelMap.get(b?.snippet?.channelId as string);
    const subA = parseInt(cha?.statistics?.subscriberCount || '0', 10) || 0;
    const subB = parseInt(chb?.statistics?.subscriberCount || '0', 10) || 0;
    const verifiedA = subA >= 100000 ? 1 : 0;
    const verifiedB = subB >= 100000 ? 1 : 0;
    if (verifiedB !== verifiedA) return verifiedB - verifiedA;

    // Fall back to more recent if order === 'date'
    if ((opts?.order ?? 'date') === 'date') {
      const pa = new Date(a?.snippet?.publishedAt || 0).getTime();
      const pb = new Date(b?.snippet?.publishedAt || 0).getTime();
      return pb - pa;
    }

    return 0;
  });

  // Deduplicate across the session per query to avoid showing duplicates in further batches
  const seenKey = q.toLowerCase();
  const seenMap: Map<string, Set<string>> = (fetchYouTubeDirect as any)._seenMap || new Map();
  (fetchYouTubeDirect as any)._seenMap = seenMap;
  const seen = seenMap.get(seenKey) || new Set<string>();

  const results: VideoItem[] = prioritizedItems.map((i) => {
    const vid = i?.id?.videoId as string;
    const sn = i?.snippet;
    const d = detailsMap.get(vid);
    return {
      videoId: vid,
      title: sn?.title,
      channelTitle: sn?.channelTitle,
      thumbnailUrl: sn?.thumbnails?.medium?.url || sn?.thumbnails?.default?.url,
      publishedAt: sn?.publishedAt,
      duration: d?.contentDetails?.duration || null,
      viewCount: d?.statistics?.viewCount || null,
      description: sn?.description,
      tags: (d?.snippet?.tags || []).map((t) => String(t)),
      videoCategoryId: d?.snippet?.categoryId || null,
      madeForKids: Boolean(d?.status?.madeForKids),
    } as VideoItem;
  })
  // Ensure valid items and apply title blocklist filter
    .filter(v => v.videoId && !isTitleBlocked(v.title));

  // Filter out already seen IDs for this query and update the seen cache
  const unique = results.filter(v => {
    if (!v.videoId) return false;
    if (seen.has(v.videoId)) return false;
    seen.add(v.videoId);
    return true;
  });
  seenMap.set(seenKey, seen);

  return { q, items: unique, nextPageToken };
}

/**
 * Public search wrapper with caching, in-flight dedupe, and defensive filtering.
 * - Prevents duplicate calls on re-renders using inFlightSearch map
 * - Caches results in-memory and in sessionStorage (15 min TTL)
 * - Applies title blocklist, per-query seen ID dedupe
 */
// Fetch via backend proxy when no client key is configured
async function fetchViaProxy(q: string, pageToken?: string, opts?: SearchOptions): Promise<SearchResponse> {
  const base = getBaseUrl();
  const url = new URL(`${base}/api/search`);
  url.searchParams.set('q', q);
  const requested = typeof opts?.maxResults === 'number' ? opts.maxResults : 30;
  const maxResults = Math.max(1, Math.min(30, requested));
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('type', 'video');
  url.searchParams.set('order', opts?.order ?? 'date');
  if (opts?.publishedAfter) url.searchParams.set('publishedAfter', opts.publishedAfter);
  if (opts?.publishedBefore) url.searchParams.set('publishedBefore', opts.publishedBefore);
  if (opts?.videoCategoryId) url.searchParams.set('videoCategoryId', String(opts.videoCategoryId));
  if (opts?.videoDuration) url.searchParams.set('videoDuration', opts.videoDuration);
  if (typeof opts?.videoSyndicated === 'boolean' && opts.videoSyndicated) url.searchParams.set('videoSyndicated', 'true');
  if (pageToken) url.searchParams.set('pageToken', pageToken);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    let body: any = null;
    try { body = await resp.json(); } catch { body = await resp.text(); }
    throw new Error(`Proxy search failed: ${resp.status} ${typeof body === 'string' ? body : (body?.error || '')}`);
  }
  return resp.json();
}

export async function fetchSearch(q: string, pageToken?: string, opts?: SearchOptions): Promise<SearchResponse> {
  // Sanitize query
  const qSan = (q || '').trim().replace(/\s+/g, ' ');
  if (!qSan) throw new Error('Query is empty');

  // Normalize options (ISO UTC + defaults + validation)
  const normOpts = normalizeSearchOptions(opts);

  const hasClientKey = Boolean(getYouTubeKey());
  const mode: 'yt' | 'proxy' = hasClientKey ? 'yt' : 'proxy';

  const cacheKey = makeSearchKey({ q: qSan, pageToken, opts: normOpts, mode });

  // 1) In-memory cache first
  const cachedMem = searchCache.get(cacheKey);
  if (cachedMem) {
    const res = deepClone(cachedMem);
    res.cached = true;
    console.log(`[Search][cache:memory][${mode}] hit`, { q: qSan, pageToken: pageToken || null, opts: normOpts || {}, items: res.items?.length || 0 });
    return Promise.resolve(res);
  }

  // 2) sessionStorage cache
  try {
    const key = `yt_cache:${cacheKey}`;
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as { at: number; data: SearchResponse };
      const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes TTL
      if ((Date.now() - parsed.at) < MAX_AGE_MS) {
        const res = deepClone(parsed.data);
        res.cached = true;
        console.log(`[Search][cache:session][${mode}] hit`, { q: qSan, pageToken: pageToken || null, opts: normOpts || {}, items: res.items?.length || 0 });
        // Warm in-memory cache
        searchCache.set(cacheKey, deepClone(res));
        return Promise.resolve(res);
      } else {
        sessionStorage.removeItem(key);
      }
    }
  } catch (e) {
    // sessionStorage may be unavailable (privacy mode), ignore
  }

  // Share in-flight request for the same key
  const inFlight = inFlightSearch.get(cacheKey);
  if (inFlight) {
    console.log('[Search] dedup: sharing in-flight request', { q: qSan, pageToken: pageToken || null, mode });
    return inFlight;
  }

  const promise = (async (): Promise<SearchResponse> => {
    try {
      console.log('[Search] fetch', { q: qSan, pageToken: pageToken || null, opts: normOpts || {}, mode });
      let result: SearchResponse;
      if (hasClientKey) {
        result = await fetchYouTubeDirect(qSan, pageToken, normOpts);
      } else {
        result = await fetchViaProxy(qSan, pageToken, normOpts);
      }
      // Apply blocklist filter defensively before caching
      result.items = (result.items || []).filter(v => v && v.videoId && !isTitleBlocked(v.title));
      // Log response for debugging
      console.log('[Search] response', { q: qSan, nextPageToken: result.nextPageToken || null, items: result.items.length, mode });
      // Cache and return a deep clone to keep the cached value immutable from callers
      const toCache = deepClone(result);
      searchCache.set(cacheKey, deepClone(toCache));
      try {
        sessionStorage.setItem(`yt_cache:${cacheKey}`, JSON.stringify({ at: Date.now(), data: toCache }));
      } catch { /* ignore */ }
      return deepClone(toCache);
    } catch (err: any) {
      // Graceful error logging for visibility during development and production
      console.error('[Search] Error:', err?.message || err);
      throw err;
    } finally {
      // Ensure in-flight request is cleaned up
      inFlightSearch.delete(cacheKey);
    }
  })();

  inFlightSearch.set(cacheKey, promise);
  return promise;
}

export async function fetchRecentSearches(): Promise<{ q: string; at: string }[]> {
  const resp = await fetch(`${getBaseUrl()}/api/recent-searches`);
  if (!resp.ok) throw new Error('Failed to load recent searches');
  return resp.json();
}

export async function fetchFavorites(): Promise<VideoItem[]> {
  const resp = await fetch(`${getBaseUrl()}/api/favorites`);
  if (!resp.ok) throw new Error('Failed to load favorites');
  return resp.json();
}

export async function saveFavorite(payload: VideoItem): Promise<void> {
  const resp = await fetch(`${getBaseUrl()}/api/favorites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error('Failed to save favorite');
}

export async function removeFavorite(videoId: string): Promise<void> {
  const resp = await fetch(`${getBaseUrl()}/api/favorites/${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
  });
  if (!resp.ok) throw new Error('Failed to remove favorite');
}
