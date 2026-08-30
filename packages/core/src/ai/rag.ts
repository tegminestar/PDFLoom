import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { chunkText } from "./chunk-text";
import { loadPipeline, type ModelLoadProgressCallback } from "./model-loader";

const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
// Smaller than summarization's chunk size — good retrieval granularity
// wants focused passages, not whole pages, so a question can match the one
// paragraph that actually answers it rather than a diluted page-sized blob.
const MAX_WORDS_PER_CHUNK = 200;

export interface DocumentChunk {
  text: string;
  pageNumber: number;
}

export interface EmbeddedChunk extends DocumentChunk {
  embedding: number[];
}

/** Splits per-page text into retrieval-sized chunks, tagging each with the page it came from (for citing "page N" in an answer). */
export function chunkPagesForRag(pageTexts: { pageNumber: number; text: string }[]): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  for (const { pageNumber, text } of pageTexts) {
    for (const chunk of chunkText(text, MAX_WORDS_PER_CHUNK)) {
      chunks.push({ text: chunk, pageNumber });
    }
  }
  return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`cosineSimilarity: vectors must be the same length (got ${a.length} and ${b.length})`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Returns the topK chunks most semantically similar to the query embedding, highest similarity first. */
export function findRelevantChunks(queryEmbedding: number[], chunks: EmbeddedChunk[], topK: number): (EmbeddedChunk & { score: number })[] {
  return chunks
    .map((chunk) => ({ ...chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export interface EmbedOptions {
  onProgress?: (info: { stage: "loading-model"; detail: Parameters<ModelLoadProgressCallback>[0] } | { stage: "embedding"; index: number; total: number }) => void;
}

async function embed(pipeline: FeatureExtractionPipeline, text: string): Promise<number[]> {
  const output = await pipeline(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/** Embeds every chunk (for building the retrieval index) with a small local sentence-embedding model. */
export async function embedChunks(chunks: DocumentChunk[], options?: EmbedOptions): Promise<EmbeddedChunk[]> {
  const onProgress = options?.onProgress;
  const pipeline = await loadPipeline("feature-extraction", EMBEDDING_MODEL_ID, {
    ...(onProgress ? { onProgress: (detail: Parameters<ModelLoadProgressCallback>[0]) => onProgress({ stage: "loading-model", detail }) } : {}),
  });

  const embedded: EmbeddedChunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({ stage: "embedding", index: i + 1, total: chunks.length });
    const embedding = await embed(pipeline as FeatureExtractionPipeline, chunks[i]!.text);
    embedded.push({ ...chunks[i]!, embedding });
  }
  return embedded;
}

/** Embeds a single query string with the same model/settings used for the chunk index, so the vectors are comparable. */
export async function embedQuery(query: string): Promise<number[]> {
  const pipeline = await loadPipeline("feature-extraction", EMBEDDING_MODEL_ID, {});
  return embed(pipeline as FeatureExtractionPipeline, query);
}

/** Builds the system prompt that grounds the chat model's answer in the retrieved excerpts, rather than letting a ~360M-parameter model answer from its own (unreliable, at that size) general knowledge. */
export function buildRagSystemPrompt(relevantChunks: (DocumentChunk & { score: number })[]): string {
  if (relevantChunks.length === 0) {
    return "You are answering questions about a PDF document, but no relevant passages were found for this question. Say plainly that you couldn't find anything relevant in the document, rather than guessing.";
  }
  const excerpts = relevantChunks.map((c, i) => `[Excerpt ${i + 1}, page ${c.pageNumber}]\n${c.text}`).join("\n\n");
  return [
    "You are answering questions about a PDF document using ONLY the excerpts below.",
    "If the excerpts don't contain the answer, say so plainly rather than guessing or using outside knowledge.",
    "When you use an excerpt, mention which page it came from.",
    "",
    excerpts,
  ].join("\n");
}
