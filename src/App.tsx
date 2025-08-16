import React, { useCallback, useEffect, useRef, useState } from 'react';
import './index.css';
import { fetchSearch } from './api';
import type { VideoItem, Category } from './types';
import { VideoPlayer } from './components/VideoPlayer';
import { Favorites } from './components/Favorites';
import { CategorySection } from './components/CategorySection';
import { useToast } from './components/ToastProvider';

function App(): React.JSX.Element {
  const { error: notifyError } = useToast();
  const [selected, setSelected] = useState<VideoItem | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0); // 0..1
  const [error, setError] = useState<string | null>(null);

  // Pool of all fetched AI videos (deduped across keywords)
  const [allVideos, setAllVideos] = useState<VideoItem[]>([]);
  const [categoryVideos, setCategoryVideos] = useState<Record<string, VideoItem[]>>({});
  // Global "load more" state to prevent concurrent fetches
  const loadingMoreRef = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Global dedupe hub across session
  const globalDisplayedIdsRef = useRef<Set<string>>(new Set());

  // AI keywords to fetch
  const AI_KEYWORDS = useRef<string[]>([
    'ai music video',
    'ai song',
    'ai ethnic music',
    'ai music',
  ]);

  // Row definitions per requirement
  const ROWS: Category[] = [
    { title: 'Top Most Views' },
    { title: 'Top 10 of Newest' },
    { title: 'Music' },
    { title: 'Sports' },
    { title: 'Kids' },
    { title: 'News' },
    { title: 'Entertainment' },
    { title: 'Educational' },
  ];

  // Date helpers for sliding windows
  const toRFC3339 = (d: Date): string => d.toISOString();
  const now = (): Date => new Date();
  const minusMonths = (d: Date, months: number): Date => {
    const dt = new Date(d);
    const day = dt.getDate();
    dt.setMonth(dt.getMonth() - months);
    if (dt.getDate() !== day) dt.setDate(0);

    return dt;
  };

  const BATCH_SIZE = 30;
  const MONTH_CAP = 12;

  // Sliding window state per keyword
  const oldestPublishedDateRef = useRef<string>('');
  const monthsBackCounterRef = useRef<Record<string, number>>({});
  const keywordIndexRef = useRef<number>(0); // round-robin keyword index

  function shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }

    return a;
  }

  function computeNextMonthWindow(offsetMonths: number): { after: string; before: string } {
    const oldest = oldestPublishedDateRef.current ? new Date(oldestPublishedDateRef.current) : now();
    const windowEndDate = minusMonths(oldest, offsetMonths - 1);
    const windowStartDate = minusMonths(oldest, offsetMonths);

    return { after: toRFC3339(windowStartDate), before: toRFC3339(windowEndDate) };
  }

  // Category computation by metadata
  function computeCategoriesPool(pool: VideoItem[]): Record<string, VideoItem[]> {
    const byId = new Set<string>();
    const safe = (s?: string): string => (s || '').toLowerCase();
    const hasAny = (hay: string, words: string[]): boolean => words.some(w => hay.includes(w));

    // Prepare base arrays
    const topViews = pool
      .slice()
      .sort((a, b) => (Number(b.viewCount || '0') - Number(a.viewCount || '0')));

    const newest = pool
      .slice()
      .sort((a, b) => (
        (new Date(b.publishedAt || 0).getTime()) - (new Date(a.publishedAt || 0).getTime())
      ))
      .slice(0, 10);

    const music: VideoItem[] = [];
    const sports: VideoItem[] = [];
    const kids: VideoItem[] = [];
    const news: VideoItem[] = [];
    const entertainment: VideoItem[] = [];
    const educational: VideoItem[] = [];

    function pushUnique(arr: VideoItem[], v: VideoItem): void {
      if (!v || !v.videoId) return;
      const seen = (arr as any)._seen as Set<string> || new Set<string>();
      if (!(arr as any)._seen) (arr as any)._seen = seen;
      if (seen.has(v.videoId)) return;
      seen.add(v.videoId);
      arr.push(v);
    }

    for (const v of pool) {
      const t = safe(v.title);
      const d = safe(v.description);
      const tags = (v.tags || []).map(x => String(x).toLowerCase());
      const cat = (v.videoCategoryId || '').toString();
      const madeForKids = Boolean(v.madeForKids);
      const hay = `${t}\n${d}\n${tags.join(' ')}`;

      // Music (category 10 or keywords)
      if (cat === '10' || hasAny(hay, ['music', 'song', 'instrumental', 'track', 'lyrics'])) {
        pushUnique(music, v);
      }
      // Sports (category 17 or keywords)
      if (cat === '17' || hasAny(hay, ['sport', 'football', 'soccer', 'basketball', 'cricket', 'highlights', 'match', 'nba', 'nfl'])) {
        pushUnique(sports, v);
      }
      // Kids (madeForKids or keywords)
      if (madeForKids || hasAny(hay, ['kids', 'kid', 'children', 'child', 'nursery', 'cartoon', 'family', 'baby'])) {
        pushUnique(kids, v);
      }
      // News (category 25 or keywords)
      if (cat === '25' || hasAny(hay, ['news', 'breaking', 'headline', 'update', 'report'])) {
        pushUnique(news, v);
      }
      // Entertainment (category 24 or keywords)
      if (cat === '24' || hasAny(hay, ['entertainment', 'funny', 'comedy', 'prank', 'viral', 'trending', 'meme'])) {
        pushUnique(entertainment, v);
      }
      // Educational (category 27 or keywords)
      if (cat === '27' || hasAny(hay, ['tutorial', 'how to', 'lesson', 'learn', 'education', 'science', 'diy', 'explained'])) {
        pushUnique(educational, v);
      }
    }

    return {
      'Top Most Views': topViews,
      'Top 10 of Newest': newest,
      'Music': music,
      'Sports': sports,
      'Kids': kids,
      'News': news,
      'Entertainment': entertainment,
      'Educational': educational,
    };
  }

  // Initial load: fetch last 6 months for each AI keyword and build pool
  const didInitRef = useRef(false);
  useEffect(() => {
    // Guard against React.StrictMode double-invocation in development
    if (didInitRef.current) return;
    didInitRef.current = true;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadProgress(0);
      setError(null);
      try {
        const nowDate = now();
        const afterDate = new Date(nowDate);
        afterDate.setMonth(afterDate.getMonth() - 6);
        const afterIso = toRFC3339(afterDate);
        const beforeIso = toRFC3339(nowDate);
        oldestPublishedDateRef.current = afterIso || toRFC3339(nowDate);

        const keywords = AI_KEYWORDS.current;
        const total = keywords.length;
        const pool: VideoItem[] = [];
        const seen = new Set<string>();

        for (let i = 0; i < keywords.length; i++) {
          try {
            const kw = keywords[i];
            const resp = await fetchSearch(kw, undefined, { order: 'date', maxResults: BATCH_SIZE, publishedAfter: afterIso, publishedBefore: beforeIso, kidFriendlyOnly: true });
            const items = (resp.items || []).filter(v => v && v.videoId && !seen.has(v.videoId));
            items.forEach(v => {
              seen.add(v.videoId);
              pool.push(v);
            });
            monthsBackCounterRef.current[kw] = 1;
          } catch (e: any) {
            const msg = e?.message || 'We couldn’t load some videos. Please try again.';
            if (!error) setError(msg);
            notifyError(msg);
          } finally {
            if (!cancelled) setLoadProgress(Math.min(1, (i + 1) / total));
          }
        }

        if (!cancelled) {
          // Update global hub and state
          pool.forEach(v => globalDisplayedIdsRef.current.add(v.videoId));
          setAllVideos(pool);
          setCategoryVideos(computeCategoriesPool(pool));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Fetch the next non-empty month window for the next keyword round-robin
  async function fetchNextMonthWindowGlobal(): Promise<VideoItem[]> {
    const keywords = AI_KEYWORDS.current;
    // pick next keyword
    const idx = keywordIndexRef.current % keywords.length;
    const kw = keywords[idx];
    keywordIndexRef.current = (idx + 1) % keywords.length;

    let counter = monthsBackCounterRef.current[kw] || 1;
    let attempts = 0;
    while (attempts < MONTH_CAP) {
      const { after, before } = computeNextMonthWindow(counter);
      const resp = await fetchSearch(kw, undefined, { order: 'date', maxResults: BATCH_SIZE, publishedAfter: after, publishedBefore: before, kidFriendlyOnly: true });
      const filtered = (resp.items || []).filter(v => v && v.videoId && !globalDisplayedIdsRef.current.has(v.videoId));
      if (filtered.length > 0) {
        monthsBackCounterRef.current[kw] = counter + 1;

        return filtered;
      }
      counter += 1;
      attempts += 1;
      monthsBackCounterRef.current[kw] = counter;
    }

    return [];
  }

  const loadMoreForAny = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const items = await fetchNextMonthWindowGlobal();
      if (items && items.length > 0) {
        items.forEach(v => globalDisplayedIdsRef.current.add(v.videoId));
        setAllVideos(prev => {
          const combined = [...prev, ...items];
          setCategoryVideos(computeCategoriesPool(combined));
          return combined;
        });
      }
    } catch (e) {
      const msg = 'Failed to load more items. Please try again later.';
      if (!error) setError(msg);
      notifyError(msg);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [error]);

  return (
    <div className="min-h-screen">
      {/* Top loading bar */}
      {loading && (
        <div className="fixed top-0 left-0 right-0 h-2 z-50 pointer-events-none">
          <div
            className="h-full bg-gradient-apple transition-all duration-300"
            style={{ width: `${Math.floor((loadProgress || 0) * 100)}%` }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor((loadProgress || 0) * 100)}
            aria-label="Loading videos"
          />
        </div>
      )}
      <header className="border-b border-divider/80 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-gray-800 dark:bg-gray-900/80 sticky top-0 z-40">
        <div className="container-app py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-full bg-gradient-apple" aria-hidden />
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">AI Muzon</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-sm text-text-secondary">YouTube mode</span>
            <button
              onClick={() => setMenuOpen(true)}
              className="px-3 py-1.5 text-sm rounded-full border border-divider hover:bg-gray-50 transition dark:border-gray-700 dark:hover:bg-gray-800"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
            >
              Menu
            </button>
          </div>
        </div>
      </header>

      <section className="bg-gradient-apple">
        <div className="container-app py-10 sm:py-14">
          <div className="max-w-3xl mx-auto text-center space-y-4">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-white">Discover AI Music</h2>
            <p className="text-white/90">
              Curated categories from YouTube. Top videos by views, updated live.
            </p>
            {error && <div className="mt-2 text-sm text-red-100 text-left px-3">{error}</div>}
          </div>
        </div>
      </section>

      <main className="container-app py-10 space-y-12">
        {ROWS.map((cat, idx) => {
          const isLast = idx === ROWS.length - 1;
          return (
            <CategorySection
              key={cat.title}
              title={cat.title}
              items={categoryVideos[cat.title] || []}
              onSelect={(v) => setSelected(v)}
              onLoadMore={isLast ? loadMoreForAny : undefined}
              hasMore={isLast}
              loadingMore={isLast ? loadingMore : false}
              loading={loading}
            />
          );
        })}
      </main>

      {/* Slide-over Menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            role="button"
            tabIndex={0}
            onClick={() => setMenuOpen(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setMenuOpen(false); } }}
          />
          <aside className="absolute right-0 top-0 h-full w-full sm:w-[420px] bg-white dark:bg-gray-900 shadow-card p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4 border-b border-divider dark:border-gray-800 pb-3">
              <div className="text-lg font-medium">Menu</div>
              <button onClick={() => setMenuOpen(false)} className="px-3 py-1.5 text-sm rounded-md border border-divider hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Close</button>
            </div>
            <div className="space-y-6">
              <div className="border-t border-divider dark:border-gray-800 pt-4">
                <Favorites onSelect={(v) => { setSelected(v); setMenuOpen(false); }} />
              </div>
            </div>
          </aside>
        </div>
      )}

      <VideoPlayer video={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export default App;
