import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import axios from 'axios';
import { getPrisma } from './db.js';

// Load environment variables from root .env (when running from project root)
// and from server/.env (when running from project root without a root .env)
// Calling dotenv.config multiple times is safe; later calls won't override existing vars.
dotenv.config();
// Try server/.env (when running from project root)
dotenv.config({ path: './server/.env' });
// Also try common local overrides and example in development for convenience
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: './server/.env.local' });
  dotenv.config({ path: './server/.env.example' });
}

const app = express();
const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CORS_ORIGIN || '*';
// Fallback to REACT_APP_YOUTUBE_API_KEY if server-specific key is not provided
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || process.env.REACT_APP_YOUTUBE_API_KEY || '';
const CACHE_TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10);
const MAX_ALLOWED_AGE = parseInt(process.env.MAX_ALLOWED_AGE || '14', 10);

app.use(helmet({
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(limiter);

// Cache remains in-memory; persistence uses Prisma (SQLite)
const cache = new Map(); // key -> { data, expiresAt }

function setCache(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
}
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

app.get('/api/recent-searches', async (req, res) => {
  const prisma = getPrisma();
  const rows = await prisma.searchEntry.findMany({ orderBy: { at: 'desc' }, take: 10 });
  res.json(rows.map(r => ({ q: r.q, at: r.at })));
});

app.get('/api/favorites', async (req, res) => {
  const prisma = getPrisma();
  const rows = await prisma.favorite.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(rows);
});

app.post('/api/favorites', async (req, res) => {
  const prisma = getPrisma();
  const { videoId, title, channelTitle, thumbnailUrl, publishedAt } = req.body || {};
  if (!videoId) return res.status(400).json({ error: 'videoId is required' });
  await prisma.favorite.upsert({
    where: { videoId },
    update: { title, channelTitle, thumbnailUrl, publishedAt },
    create: { videoId, title, channelTitle, thumbnailUrl, publishedAt },
  });
  res.json({ ok: true });
});

app.delete('/api/favorites/:videoId', async (req, res) => {
  const prisma = getPrisma();
  const { videoId } = req.params;
  await prisma.favorite.delete({ where: { videoId } }).catch(() => {});
  res.json({ ok: true });
});

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const pageToken = (req.query.pageToken || '').toString();
  // Optional filters
  const videoCategoryId = (req.query.videoCategoryId || '').toString().trim();
  const videoDuration = (req.query.videoDuration || '').toString().trim(); // short|medium|long
  const videoSyndicated = (req.query.videoSyndicated || '').toString().trim(); // 'true' to enable
  let order = (req.query.order || '').toString().trim();
  const maxResults = (req.query.maxResults || '').toString().trim();
  let publishedAfter = (req.query.publishedAfter || '').toString().trim();
  let publishedBefore = (req.query.publishedBefore || '').toString().trim();

  if (!q) return res.status(400).json({ error: 'q is required' });
  // Allow providing API key via header or query param as a fallback (public API key)
  const headerKey = (req.get('x-youtube-key') || '').trim();
  const queryKey = String(req.query.key || '').trim();
  const apiKey = (YOUTUBE_API_KEY || headerKey || queryKey || '').trim();
  if (!apiKey) return res.status(400).json({ error: 'Missing YOUTUBE_API_KEY on server' });

  // cache key will be computed after sanitization

  try {
    // Sanitize and normalize params that can cause YouTube API validation errors
    const nowIso = new Date().toISOString();

    // Validate order
    const allowedOrders = new Set(['date', 'rating', 'relevance', 'title', 'videoCount', 'viewCount']);
    if (order && !allowedOrders.has(order)) {
      order = 'date';
    }

    // Helpers for date validation
    const parseIso = (s) => {
      if (!s) return null;
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    let dAfter = parseIso(publishedAfter);
    let dBefore = parseIso(publishedBefore);

    // Clamp publishedBefore to now if in the future
    const now = new Date();
    if (dBefore && dBefore.getTime() > now.getTime()) {
      dBefore = now;
    }

    // If both provided and order invalid, fix: ensure after < before
    if (dAfter && dBefore && dAfter.getTime() >= dBefore.getTime()) {
      // Move publishedAfter to one second before publishedBefore
      dAfter = new Date(dBefore.getTime() - 1000);
    }

    // Reassign normalized strings
    publishedAfter = dAfter ? dAfter.toISOString() : '';
    publishedBefore = dBefore ? dBefore.toISOString() : '';

    // After date/order normalization, compute cache key and check
    const cacheKey = `yt:${q}:${pageToken}:${videoCategoryId}:${videoDuration}:${videoSyndicated}:${order}:${maxResults}:${publishedAfter}:${publishedBefore}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    // Search videos
    const searchUrl = 'https://www.googleapis.com/youtube/v3/search';
    const searchParams = new URLSearchParams({
      key: apiKey,
      part: 'snippet',
      q,
      maxResults: maxResults && /^\d+$/.test(maxResults) ? String(Math.max(1, Math.min(50, parseInt(maxResults, 10)))) : '24',
      type: 'video',
      safeSearch: 'strict',
    });
    if (pageToken) searchParams.set('pageToken', pageToken);
    if (order) searchParams.set('order', order);
    if (publishedAfter) searchParams.set('publishedAfter', publishedAfter);
    if (publishedBefore) searchParams.set('publishedBefore', publishedBefore);
    if (videoCategoryId) searchParams.set('videoCategoryId', videoCategoryId);
    if (videoDuration) searchParams.set('videoDuration', videoDuration);
    if (videoSyndicated === 'true') searchParams.set('videoSyndicated', 'true');

    const searchResp = await axios.get(`${searchUrl}?${searchParams.toString()}`);
    const items = searchResp.data.items || [];
    const nextPageToken = searchResp.data.nextPageToken || null;

    // Enrich with video details (duration, stats)
    const ids = items.map((i) => i.id.videoId).filter(Boolean);
    const channelIds = Array.from(new Set(items.map((i) => i?.snippet?.channelId).filter(Boolean)));
    let detailsMap = new Map();
    let channelMap = new Map();
    if (ids.length > 0) {
      const detailsUrl = 'https://www.googleapis.com/youtube/v3/videos';
      const detailsParams = new URLSearchParams({
        key: apiKey,
        // include status and snippet to access age rating and tags
        part: 'contentDetails,statistics,status,snippet',
        id: ids.join(','),
        maxResults: '24'
      });
      const detailsResp = await axios.get(`${detailsUrl}?${detailsParams.toString()}`);
      const detailsItems = detailsResp.data.items || [];
      detailsMap = new Map(detailsItems.map((d) => [d.id, d]));
    }

    // Fetch channel statistics to approximate verification/established channels
    if (channelIds.length > 0) {
      const channelsUrl = 'https://www.googleapis.com/youtube/v3/channels';
      const channelsParams = new URLSearchParams({
        key: apiKey,
        part: 'statistics,snippet',
        id: channelIds.join(',')
      });
      const channelsResp = await axios.get(`${channelsUrl}?${channelsParams.toString()}`);
      const chItems = channelsResp.data.items || [];
      channelMap = new Map(chItems.map((c) => [c.id, c]));
    }

    // Content blocklist for server-side filtering (case-insensitive substring)
    const BLOCKLIST = [
      'sanwariya','pajama','naked','sex',
      'sexual','nsfw','xxx','porn','erotic','18+','x-rated','nude','nudity','fetish','bdsm',
      'violent','violence','murder','kill','killing','blood','gore','weapon','gun','shoot','shooting','stab','stabbing','war','fight','assault','suicide',
      'explicit','swear','profanity','fuck','shit','bitch','asshole','cunt','dick','bastard',
      'age restricted'
    ];
    function isBlocked(sn, det) {
      const title = (sn?.title || '').toLowerCase();
      const desc = (sn?.description || '').toLowerCase();
      const tags = ((det?.snippet?.tags || []).map((t) => String(t).toLowerCase()));
      const rating = det?.contentDetails?.contentRating?.ytRating;
      if (MAX_ALLOWED_AGE < 18 && rating === 'ytAgeRestricted') return true;
      if (BLOCKLIST.some(k => title.includes(k) || desc.includes(k))) return true;
      if (tags.length && BLOCKLIST.some(k => tags.some(t => t.includes(k)))) return true;
      return false;
    }

    const filtered = items.filter((i) => {
      const vid = i.id.videoId;
      const sn = i.snippet;
      const details = detailsMap.get(vid) || {};
      return !isBlocked(sn, details);
    });

    // Prioritize: 1) made for kids, 2) established channels (heuristic: subscriberCount >= 100k)
    const prioritized = filtered.slice().sort((a, b) => {
      const da = detailsMap.get(a.id.videoId) || {};
      const db = detailsMap.get(b.id.videoId) || {};
      const mka = da?.status?.madeForKids ? 1 : 0;
      const mkb = db?.status?.madeForKids ? 1 : 0;
      if (mkb !== mka) return mkb - mka;

      const cha = channelMap.get(a?.snippet?.channelId) || {};
      const chb = channelMap.get(b?.snippet?.channelId) || {};
      const subA = parseInt(cha?.statistics?.subscriberCount || '0', 10) || 0;
      const subB = parseInt(chb?.statistics?.subscriberCount || '0', 10) || 0;
      const verifiedA = subA >= 100000 ? 1 : 0;
      const verifiedB = subB >= 100000 ? 1 : 0;
      if (verifiedB !== verifiedA) return verifiedB - verifiedA;

      if ((order || 'date') === 'date') {
        const pa = new Date(a?.snippet?.publishedAt || 0).getTime();
        const pb = new Date(b?.snippet?.publishedAt || 0).getTime();
        return pb - pa;
      }
      return 0;
    });

    const results = prioritized.map((i) => {
      const vid = i.id.videoId;
      const sn = i.snippet;
      const details = detailsMap.get(vid) || {};
      return {
        videoId: vid,
        title: sn?.title,
        channelTitle: sn?.channelTitle,
        thumbnailUrl: sn?.thumbnails?.medium?.url || sn?.thumbnails?.default?.url,
        publishedAt: sn?.publishedAt,
        duration: details?.contentDetails?.duration || null,
        viewCount: details?.statistics?.viewCount || null,
        description: sn?.description,
        tags: (details?.snippet?.tags || []).map((t) => String(t)),
        videoCategoryId: details?.snippet?.categoryId || null,
        madeForKids: Boolean(details?.status?.madeForKids),
      };
    });

    const payload = { q, items: results, nextPageToken };
    setCache(cacheKey, payload);

    // Track recent searches in DB
    try {
      const prisma = getPrisma();
      await prisma.searchEntry.create({ data: { q } });
    } catch (e) {
      // best effort, do not fail the request
    }

    res.json(payload);
  } catch (err) {
    const status = err?.response?.status || 500;
    // If YouTube rejected due to client-provided parameters, prefer 400
    const ytError = err?.response?.data;
    const isClientParamIssue = status >= 400 && status < 500;
    const outStatus = isClientParamIssue ? status : 502; // treat upstream failures as bad gateway
    res.status(outStatus).json({ error: 'Upstream YouTube API error', status: status, details: ytError || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`AI Muzon server running on http://localhost:${PORT}`);
});
