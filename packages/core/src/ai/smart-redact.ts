import type { TokenClassificationPipeline } from "@huggingface/transformers";
import { detectStructuredPii, type PiiMatch, type PiiType } from "./pii-detect";
import { loadPipeline, type ModelLoadProgressCallback } from "./model-loader";

const NER_MODEL_ID = "Xenova/bert-base-NER";

export type NamedEntityType = "person" | "organization" | "location";

export interface SmartRedactOptions {
  /** Which structured-PII categories to include (default: all four). */
  structuredTypes?: PiiType[];
  /** Which NER entity categories to include (default: person only — organizations/locations are opt-in since flagging every business/place name would over-redact ordinary document content). */
  namedEntityTypes?: NamedEntityType[];
  onProgress?: (info: { stage: "loading-model"; detail: Parameters<ModelLoadProgressCallback>[0] } | { stage: "detecting" }) => void;
  /** Below this confidence, a NER match is discarded rather than flagged — avoids a low-confidence guess creating a redaction box the user didn't ask for. Default 0.85. */
  minEntityScore?: number;
}

export interface SmartRedactMatch {
  category: "structured" | "namedEntity";
  type: PiiType | NamedEntityType;
  text: string;
  startIndex: number;
  endIndex: number;
}

const ENTITY_GROUP_TO_TYPE: Record<string, NamedEntityType | undefined> = {
  PER: "person",
  ORG: "organization",
  LOC: "location",
};

/**
 * Locates every occurrence of `needle` within `text`, in order — grouped
 * BIO/BIOES NER output only gives back the reconstructed entity text, not
 * reliable character offsets (verified directly: this model/pipeline
 * version leaves `start`/`end` undefined despite the type declaring them
 * optional), so this reconstructs positions the same way search() already
 * does elsewhere in the engine. An entity that can't be located this way
 * is silently skipped rather than guessed at.
 */
export function findEntityOffsets(text: string, entities: { word: string; entity_group?: string; score: number }[], namedEntityTypes: Set<NamedEntityType>, minScore: number): SmartRedactMatch[] {
  const matches: SmartRedactMatch[] = [];
  let cursor = 0;
  for (const entity of entities) {
    const type = entity.entity_group ? ENTITY_GROUP_TO_TYPE[entity.entity_group] : undefined;
    if (!type || !namedEntityTypes.has(type) || entity.score < minScore) continue;

    const idx = text.indexOf(entity.word, cursor);
    if (idx === -1) continue; // Reconstruction mismatch (rare) — skip rather than guess.
    matches.push({ category: "namedEntity", type, text: entity.word, startIndex: idx, endIndex: idx + entity.word.length });
    cursor = idx + entity.word.length;
  }
  return matches;
}

/**
 * Detects PII in a block of text — structured formats (email/phone/SSN/
 * credit card) via regex, unstructured entities (person names, and
 * optionally organizations/locations) via a small local NER model. Returns
 * character-offset matches within `text`; the caller (UI layer, which has
 * access to a rendered/loaded PdfDocument) maps these to on-page rects via
 * PdfDocument.findTextRects and feeds them into the existing manual-
 * redaction pipeline (redactBoxes / applyRedactions) — this module only
 * detects, it doesn't touch the PDF at all.
 */
export async function detectPii(text: string, options?: SmartRedactOptions): Promise<SmartRedactMatch[]> {
  const structuredTypes = options?.structuredTypes;
  const namedEntityTypes = new Set(options?.namedEntityTypes ?? (["person"] as NamedEntityType[]));
  const minEntityScore = options?.minEntityScore ?? 0.85;
  const onProgress = options?.onProgress;

  const structuredMatches: SmartRedactMatch[] = detectStructuredPii(text)
    .filter((m) => !structuredTypes || structuredTypes.includes(m.type))
    .map((m: PiiMatch) => ({ category: "structured" as const, type: m.type, text: m.text, startIndex: m.startIndex, endIndex: m.endIndex }));

  if (namedEntityTypes.size === 0 || !text.trim()) {
    return structuredMatches.sort((a, b) => a.startIndex - b.startIndex);
  }

  const ner = await loadPipeline("token-classification", NER_MODEL_ID, {
    dtype: "q8",
    ...(onProgress ? { onProgress: (detail: Parameters<ModelLoadProgressCallback>[0]) => onProgress({ stage: "loading-model", detail }) } : {}),
  });

  onProgress?.({ stage: "detecting" });
  const output = await (ner as TokenClassificationPipeline)(text, { aggregation_strategy: "simple" });
  const entities = (Array.isArray(output) ? output : [output]) as { word: string; entity_group?: string; score: number }[];
  const namedEntityMatches = findEntityOffsets(text, entities, namedEntityTypes, minEntityScore);

  // Structured matches take priority over an overlapping NER guess (a
  // regex-matched email/phone/SSN is exact; an NER span that happens to
  // overlap one is almost always a mis-tokenization, not new information).
  const merged = [...structuredMatches];
  for (const nm of namedEntityMatches) {
    const overlapsStructured = structuredMatches.some((sm) => nm.startIndex < sm.endIndex && nm.endIndex > sm.startIndex);
    if (!overlapsStructured) merged.push(nm);
  }

  return merged.sort((a, b) => a.startIndex - b.startIndex);
}
