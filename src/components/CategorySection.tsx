import React, { useEffect, useRef } from 'react';
import type { VideoItem } from '../types';
import { VideoCard } from './VideoCard';

export const CategorySection: React.FC<{
  title: string;
  items: VideoItem[];
  onSelect: (v: VideoItem) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loading?: boolean;
}> = ({ title, items, onSelect, onLoadMore, hasMore = false, loadingMore = false, loading = false }) => {
  const sectionRef = useRef<HTMLElement | null>(null);

  // Lightweight scroll logger: logs date-time when this section is in view during window scroll
  useEffect(() => {
    let lastLog = 0;
    const onScroll = (): void => {
      const now = Date.now();
      if (now - lastLog < 1000) return; // throttle to 1s
      const el = sectionRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const inView = r.bottom > 0 && r.top < window.innerHeight;
      if (inView) {
        lastLog = now;
        console.log(`[CategorySection] "${title}" visible on scroll at ${new Date(now).toISOString()}`);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [title]);

  // Preserve incoming order (App already shuffles/dedupes)
  const parsed = [...(items || [])];

  // Refs for horizontal scroll and trigger target (10th-from-end)
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Preserve horizontal scroll position per category via sessionStorage
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const key = `cat-scroll-${title}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      const x = parseInt(saved, 10);
      if (!Number.isNaN(x)) el.scrollLeft = x;
    }
    const onScroll = (): void => {
      sessionStorage.setItem(key, String(el.scrollLeft));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [title]);

  // IntersectionObserver on the 10th-from-end card using the horizontal scroller as root
  useEffect(() => {
    if (!onLoadMore || !hasMore) return;
    const root = scrollerRef.current;
    const target = triggerRef.current;
    if (!root || !target) return;
    let pending = false;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && !pending && !loadingMore) {
        pending = true;
        Promise.resolve(onLoadMore()).finally(() => {
          pending = false;
        });
      }
    }, { root: root, rootMargin: '0px 200px 0px 0px' });
    io.observe(target);
    return () => io.disconnect();
  }, [onLoadMore, hasMore, loadingMore, parsed.length]);

  // Compute index for the 10th-from-end; if fewer items, use last item
  const triggerIndex = Math.max(0, parsed.length - 10);

  return (
    <section ref={sectionRef} className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>

      {/* Netflix-like horizontal row with lazy-loaded cards */}
      {parsed.length > 0 ? (
        <div ref={scrollerRef} className="overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700">
          <div className="flex gap-4 pr-2">
            {parsed.map((it, idx) => (
              <div
                key={it.videoId}
                className="shrink-0 w-[280px] sm:w-[320px]"
                ref={idx === triggerIndex ? triggerRef : null}
              >
                <VideoCard item={it} onClick={() => onSelect(it)} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        loading ? (
          <div className="w-full">
            <div
              className="h-2 w-full rounded-full overflow-hidden bg-divider/60"
              role="progressbar"
              aria-label="Loading category"
            >
              <div className="h-full w-1/3 bg-gradient-apple animate-pulse" />
            </div>
          </div>
        ) : (
          <div className="text-sm text-text-secondary">No videos yet.</div>
        )
      )}

      {loadingMore && <div className="text-sm text-text-secondary">Loading more…</div>}
    </section>
  );
};
