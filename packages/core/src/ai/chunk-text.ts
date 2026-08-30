/**
 * Splits text into word-bounded chunks no larger than maxWordsPerChunk,
 * breaking on paragraph/sentence boundaries where possible so each chunk
 * reads coherently on its own — used to keep summarization/embedding input
 * under a model's context window without cutting words in half.
 */
export function chunkText(text: string, maxWordsPerChunk: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (maxWordsPerChunk <= 0) throw new Error("chunkText: maxWordsPerChunk must be positive");

  // Prefer paragraph breaks, then sentence breaks, then plain words — each
  // unit is atomic (never split mid-word) and units are packed greedily
  // into chunks up to the word limit.
  const paragraphs = trimmed.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const units: string[] = paragraphs.length > 1 ? paragraphs : splitIntoSentences(trimmed);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWordCount = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join(" ").trim());
      current = [];
      currentWordCount = 0;
    }
  };

  for (const unit of units) {
    const unitWordCount = countWords(unit);
    if (unitWordCount > maxWordsPerChunk) {
      // A single paragraph/sentence is itself too big — fall back to
      // word-level splitting for just this unit so nothing is ever dropped.
      flush();
      for (const wordChunk of splitByWords(unit, maxWordsPerChunk)) chunks.push(wordChunk);
      continue;
    }
    if (currentWordCount + unitWordCount > maxWordsPerChunk) flush();
    current.push(unit);
    currentWordCount += unitWordCount;
  }
  flush();

  return chunks;
}

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

function splitIntoSentences(text: string): string[] {
  // Simple, dependency-free sentence boundary heuristic: split after
  // ./!/? followed by whitespace, keeping the punctuation attached.
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  return sentences.length > 0 ? sentences : [text];
}

function splitByWords(text: string, maxWordsPerChunk: number): string[] {
  const words = text.match(/\S+/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += maxWordsPerChunk) {
    out.push(words.slice(i, i + maxWordsPerChunk).join(" "));
  }
  return out;
}
