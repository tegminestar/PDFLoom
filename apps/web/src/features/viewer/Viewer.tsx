import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLoomStore } from "../../app/store";
import { PageCanvas } from "./PageCanvas";

const PAGE_GAP_PX = 24;
const HORIZONTAL_PADDING_PX = 48;

export function Viewer() {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const zoom = useLoomStore((s) => s.zoom);
  const fitMode = useLoomStore((s) => s.fitMode);
  const fitWidthScale = useLoomStore((s) => s.fitWidthScale);
  const setFitWidthScale = useLoomStore((s) => s.setFitWidthScale);
  const viewRotation = useLoomStore((s) => s.viewRotation);
  const currentPage = useLoomStore((s) => s.currentPage);
  const pageNavigationNonce = useLoomStore((s) => s.pageNavigationNonce);
  const syncVisiblePage = useLoomStore((s) => s.syncVisiblePage);
  const activeSearchResult = useLoomStore((s) =>
    s.activeSearchIndex >= 0 ? s.searchResults[s.activeSearchIndex] ?? null : null,
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Recompute the "fit width" scale from page 1's intrinsic size and the
  // scroll container's available width; re-runs on container resize. Stored
  // centrally so the zoom-percentage readout in the toolbar stays accurate
  // even while fit-to-width (not manual zoom) is driving the actual scale.
  useEffect(() => {
    if (!doc || !scrollRef.current) return;
    const container = scrollRef.current;

    const recompute = async () => {
      const dims = await doc.getPageDimensions(1);
      const widthPt = viewRotation === 90 || viewRotation === 270 ? dims.heightPt : dims.widthPt;
      const availableWidth = container.clientWidth - HORIZONTAL_PADDING_PX * 2;
      setFitWidthScale(Math.max(0.1, availableWidth / widthPt));
    };

    void recompute();
    const resizeObserver = new ResizeObserver(() => void recompute());
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [doc, viewRotation, setFitWidthScale]);

  const effectiveScale = fitMode === "width" ? fitWidthScale : zoom;

  // Determine "current page" directly from scroll geometry — the page
  // whose rendered rect has the greatest overlap with the container's
  // visible area — rather than from IntersectionObserver, whose callbacks
  // are eventually-consistent and can lag a scroll by a frame or more.
  // Geometry is synchronous with the DOM at the moment it's read, so this
  // can't race a scroll animation or land on a stale page.
  const updateCurrentPageFromScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const pageEls = container.querySelectorAll<HTMLElement>("[data-page-number]");
    let bestPage: number | null = null;
    let bestOverlap = -1;
    for (const el of pageEls) {
      const rect = el.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestPage = Number(el.dataset.pageNumber);
      }
    }
    if (bestPage !== null) syncVisiblePage(bestPage);
  }, [syncVisiblePage]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateCurrentPageFromScroll();
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    updateCurrentPageFromScroll();
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [updateCurrentPageFromScroll, doc]);

  const scrollToPage = useCallback((pageNumber: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
    // Instant, not smooth: explicit navigation (page-number entry,
    // thumbnail/outline click, search jump) should land on the requested
    // page immediately, matching Acrobat/Preview/Chrome's PDF viewer —
    // animating through every intermediate page for a large jump is both
    // slower and makes the displayed page number transiently wrong while
    // the animation is still catching up.
    target?.scrollIntoView({ behavior: "instant", block: "start" });
  }, []);

  // Scroll only on *explicit* navigation (nonce bump) — never as a reaction
  // to `currentPage` itself, since that value also changes continuously
  // while the user is scrolling manually (see updateCurrentPageFromScroll
  // above), and re-triggering scrollIntoView from that would fight the
  // user's own scroll on every page-boundary crossing.
  const lastHandledNonce = useRef(pageNavigationNonce);
  useEffect(() => {
    if (lastHandledNonce.current === pageNavigationNonce) return;
    lastHandledNonce.current = pageNavigationNonce;
    scrollToPage(currentPage);
    // currentPage intentionally excluded: this effect must fire exactly
    // once per navigation nonce, not on every currentPage change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNavigationNonce, scrollToPage]);

  // Rotation and zoom both reflow every page's dimensions without firing a
  // `scroll` event (scrollTop in pixels is unchanged), so left alone,
  // whichever page happens to now occupy the old scrollTop silently becomes
  // "current" — which can drift to a different page than the one the user
  // was actually reading (observed: 5 zoom-in clicks could drift the
  // tracked page by one). Re-anchor to the page they were on, instantly,
  // once the new layout has painted. Trade-off: this snaps to that page's
  // top rather than preserving the exact scroll offset within it — fine
  // for now; a zoom-anchored-to-viewport-center refinement can come later.
  const lastAnchorKey = useRef(`${viewRotation}:${effectiveScale}`);
  useEffect(() => {
    const key = `${viewRotation}:${effectiveScale}`;
    if (lastAnchorKey.current === key) return;
    lastAnchorKey.current = key;
    const raf = requestAnimationFrame(() => scrollToPage(currentPage));
    return () => cancelAnimationFrame(raf);
    // currentPage intentionally excluded: re-anchor to whichever page was
    // current *before* this change, not a value already updated by a
    // post-reflow scroll-tracking pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRotation, effectiveScale, scrollToPage]);

  const pageNumbers = useMemo(
    () => (meta ? Array.from({ length: meta.pageCount }, (_, i) => i + 1) : []),
    [meta],
  );

  if (!doc || !meta) return null;

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="region"
      aria-label="Document pages"
      className="h-full w-full overflow-y-auto overflow-x-hidden bg-bg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--color-focus-ring]"
    >
      <div
        className="mx-auto flex flex-col items-center py-8"
        style={{ gap: PAGE_GAP_PX, paddingLeft: HORIZONTAL_PADDING_PX, paddingRight: HORIZONTAL_PADDING_PX }}
      >
        {pageNumbers.map((pageNumber) => (
          <PageCanvas
            key={pageNumber}
            doc={doc}
            pageNumber={pageNumber}
            scale={effectiveScale}
            rotation={viewRotation}
            isActiveSearchResult={activeSearchResult?.pageNumber === pageNumber}
          />
        ))}
      </div>
    </div>
  );
}
