import { summarizeText, type SummarizeStage } from "./summarize";

export interface HighlightContent {
  title: string;
  bullets: string[];
}

export interface ExtractHighlightsOptions {
  onProgress?: (info: SummarizeStage) => void;
  /** How many bullet points to extract, at most. Default 4. */
  maxBullets?: number;
}

/**
 * Extracts a short title + a handful of bullet points from a document's
 * text, for Quick Create's flyer/social/slide templates. Deliberately
 * reuses summarize.ts's already-verified model/pipeline rather than
 * standing up a second text-generation model for a very similar task —
 * a short summary IS the content, just needs splitting into bullet-sized
 * pieces and a title line pulled out.
 */
export async function extractHighlights(text: string, title: string, options?: ExtractHighlightsOptions): Promise<HighlightContent> {
  const trimmed = text.trim();
  const maxBullets = options?.maxBullets ?? 4;
  if (!trimmed) return { title, bullets: [] };

  const onProgress = options?.onProgress;
  const { summary } = await summarizeText(trimmed, { targetLengthWords: 50, ...(onProgress ? { onProgress } : {}) });

  // Split the summary into sentence-sized bullets — simple, dependency-free
  // sentence splitting (same heuristic as chunk-text.ts), capped at
  // maxBullets so a template with limited space doesn't overflow.
  const bullets = summary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, maxBullets);

  return { title, bullets: bullets.length > 0 ? bullets : [summary] };
}
