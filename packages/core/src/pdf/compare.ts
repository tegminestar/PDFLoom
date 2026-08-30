/**
 * Pure, framework-agnostic diff logic for the Compare/diff feature (tamper
 * and change detection between two PDFs). Text extraction (pdf.js) and page
 * rendering happen in the UI layer, which then hands already-extracted
 * strings/pixel buffers in here — keeping this module Node-testable with no
 * browser/pdf.js dependency, same split as ocr-overlay.ts/ocr-client.ts.
 */

export type WordDiffOpType = "equal" | "insert" | "delete";

export interface WordDiffOp {
  type: WordDiffOpType;
  text: string;
}

export interface PageTextDiffResult {
  ops: WordDiffOp[];
  /** True if the two texts differ at all. */
  changed: boolean;
  /**
   * True if the page text was too large for a full token-level diff and we
   * fell back to a single whole-page equal/changed comparison instead —
   * still correct about *whether* something changed, just not *where*.
   */
  truncated: boolean;
}

// Word-level tokens keep whitespace as its own token so ops can be
// concatenated back into the exact original text — the same convention
// most word-diff tools (git --word-diff, diff-match-patch) use.
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

// Above this many DP cells, an O(n*m) table gets too slow/memory-heavy for
// a UI interaction — fall back to a whole-page changed/unchanged result
// rather than hanging the tab on a single huge page.
const MAX_DP_CELLS = 4_000_000;

/** Classic LCS-backtrack word diff, O(n*m) time and space. */
function diffTokens(a: string[], b: string[]): WordDiffOp[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = length of the LCS of a[i..n) and b[j..m)
  const dp: Int32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  // Safe: i/j range over [0,n) and [0,m), and dp was allocated with n+1/m+1 rows/columns above, so every index here is in bounds.
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const ops: WordDiffOp[] = [];
  const push = (type: WordDiffOpType, text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    // Safe: i<n and j<m are the loop condition, so a[i]/b[j] are always in bounds here.
    const tokenA = a[i]!;
    const tokenB = b[j]!;
    if (tokenA === tokenB) {
      push("equal", tokenA);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push("delete", tokenA);
      i++;
    } else {
      push("insert", tokenB);
      j++;
    }
  }
  while (i < n) push("delete", a[i++]!);
  while (j < m) push("insert", b[j++]!);
  return ops;
}

export function diffPageText(textA: string, textB: string): PageTextDiffResult {
  if (textA === textB) {
    return { ops: textA ? [{ type: "equal", text: textA }] : [], changed: false, truncated: false };
  }

  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);

  if (tokensA.length * tokensB.length > MAX_DP_CELLS) {
    const ops: WordDiffOp[] = [];
    if (textA) ops.push({ type: "delete", text: textA });
    if (textB) ops.push({ type: "insert", text: textB });
    return { ops, changed: true, truncated: true };
  }

  const ops = diffTokens(tokensA, tokensB);
  return { ops, changed: ops.some((op) => op.type !== "equal"), truncated: false };
}

export interface PageComparisonSummary {
  /** 0-based page index. */
  pageIndex: number;
  existsInA: boolean;
  existsInB: boolean;
  textChanged: boolean;
}

export interface ComparisonSummary {
  pageCountA: number;
  pageCountB: number;
  pages: PageComparisonSummary[];
  changedPageCount: number;
}

/** Page-by-page changed/unchanged summary, keyed by page index (not diffed content) — cheap to compute for the whole document up front, used to drive a per-page navigation strip before the user opens any single page's detailed diff. */
export function summarizeTextComparison(pageTextsA: string[], pageTextsB: string[]): ComparisonSummary {
  const pageCount = Math.max(pageTextsA.length, pageTextsB.length);
  const pages: PageComparisonSummary[] = [];
  let changedPageCount = 0;

  for (let i = 0; i < pageCount; i++) {
    const existsInA = i < pageTextsA.length;
    const existsInB = i < pageTextsB.length;
    const textChanged = !existsInA || !existsInB || pageTextsA[i] !== pageTextsB[i];
    if (textChanged) changedPageCount++;
    pages.push({ pageIndex: i, existsInA, existsInB, textChanged });
  }

  return { pageCountA: pageTextsA.length, pageCountB: pageTextsB.length, pages, changedPageCount };
}

export interface PixelDiffOptions {
  /** Per-channel absolute difference below this counts as unchanged, to absorb anti-aliasing/render jitter rather than flagging every edge pixel. Default 32 (of 255). */
  threshold?: number;
}

export interface PixelDiffResult {
  /** Same length/layout as the input RGBA buffers — unchanged pixels dimmed, changed pixels painted solid red, for use directly as an overlay image. */
  overlay: Uint8ClampedArray;
  changedPixelCount: number;
  totalPixelCount: number;
  changedRatio: number;
}

const DEFAULT_PIXEL_THRESHOLD = 32;

/** Compares two same-size RGBA pixel buffers (as produced by canvas getImageData) and produces a visual diff overlay plus a changed-pixel ratio. */
export function diffPixelsRgba(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number, options?: PixelDiffOptions): PixelDiffResult {
  const threshold = options?.threshold ?? DEFAULT_PIXEL_THRESHOLD;
  const totalPixelCount = width * height;
  if (a.length !== totalPixelCount * 4 || b.length !== totalPixelCount * 4) {
    throw new Error(`diffPixelsRgba: buffer length doesn't match width*height*4 (expected ${totalPixelCount * 4}, got a=${a.length} b=${b.length})`);
  }

  const overlay = new Uint8ClampedArray(a.length);
  let changedPixelCount = 0;

  // Safe: p<totalPixelCount and both buffers were checked equal to totalPixelCount*4 above, so o..o+3 are always in bounds.
  for (let p = 0; p < totalPixelCount; p++) {
    const o = p * 4;
    const ar = a[o]!, ag = a[o + 1]!, ab = a[o + 2]!;
    const br = b[o]!, bg = b[o + 1]!, bb = b[o + 2]!;
    const dr = Math.abs(ar - br);
    const dg = Math.abs(ag - bg);
    const db = Math.abs(ab - bb);
    const changed = dr > threshold || dg > threshold || db > threshold;

    if (changed) {
      changedPixelCount++;
      overlay[o] = 235;
      overlay[o + 1] = 40;
      overlay[o + 2] = 60;
      overlay[o + 3] = 255;
    } else {
      // Dim + desaturate the unchanged base image so the red diff pixels pop visually.
      const gray = (ar + ag + ab) / 3;
      overlay[o] = gray * 0.55 + 255 * 0.45;
      overlay[o + 1] = gray * 0.55 + 255 * 0.45;
      overlay[o + 2] = gray * 0.55 + 255 * 0.45;
      overlay[o + 3] = 255;
    }
  }

  return { overlay, changedPixelCount, totalPixelCount, changedRatio: totalPixelCount === 0 ? 0 : changedPixelCount / totalPixelCount };
}
