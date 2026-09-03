export { PdfDocument } from "./pdf/document";
export type { RenderPageOptions, RenderTextLayerOptions, PageDimensions } from "./pdf/document";
export type { TextLayer } from "pdfjs-dist";

export { getPdfWorkerClient } from "./workers/pdf-worker-client";
export type { PdfWorkerApi } from "./workers/pdf-worker-client";
export type { PageRange, RotationDelta, CropBox, PageSize, NUpOptions } from "./pdf/organize";
export { STANDARD_PAGE_SIZES } from "./pdf/organize";
export type { Quad, Point, Rect, RgbColor, StampPreset } from "./pdf/annotations";
export type {
  TextWatermarkOptions,
  ImageWatermarkOptions,
  HeaderFooterOptions,
  PageNumberOptions,
  PageNumberPosition,
  BatesNumberOptions,
} from "./pdf/stamps";
export type {
  FormFieldInfo,
  FormFieldType,
  FormFieldValue,
  FieldRect,
  FlattenFormOptions,
  CreateTextFieldOptions,
  CreateCheckBoxOptions,
  CreateRadioGroupOptions,
  CreateDropdownOptions,
  AddRadioOptionOptions,
} from "./pdf/forms";
export type { ReplaceImageAreaOptions } from "./pdf/edit";
export type { SourceImage, ImagePageSizing } from "./pdf/convert";
export type { RasterizedPage } from "./pdf/compress";
export type { InlineRun, DocBlock, CreateDocumentOptions } from "./pdf/create-document";
export type { OcrWordPlacement } from "./pdf/ocr-overlay";
export type { PdfPermissions, EncryptOptions, DecryptResult } from "./pdf/crypto/standard-security-handler";
export type { RedactPageInput } from "./pdf/redact";
export type { TypedSignatureOptions, SignedTimestampOptions } from "./pdf/signature";
export type { SanitizeOptions, SanitizeReport } from "./pdf/sanitize";
export type { PageImageInfo, ImageAltTextUpdate } from "./pdf/accessibility";
export { diffPageText, summarizeTextComparison, diffPixelsRgba } from "./pdf/compare";
export type { WordDiffOp, WordDiffOpType, PageTextDiffResult, PageComparisonSummary, ComparisonSummary, PixelDiffResult } from "./pdf/compare";

export { detectAiCapabilities, isWebgpuAdapterAvailable } from "./ai/capabilities";
export type { AiCapabilities } from "./ai/capabilities";
export { chunkText } from "./ai/chunk-text";
export { parseCsv } from "./utils/csv";
export {
  createReviewSession,
  addReviewComment,
  removeReviewComment,
  listReviewComments,
  onReviewCommentsChange,
  applyRemoteUpdate,
  onLocalDocUpdate,
  encodeFullState,
  generateSessionCode,
} from "./collab/review-session";
export type { ReviewComment, ReviewSession } from "./collab/review-session";
export { loadPipeline } from "./ai/model-loader";
export type { ModelLoadStage, ModelLoadProgressCallback, LoadPipelineOptions } from "./ai/model-loader";
export { summarizeText, preloadSummarizeModel } from "./ai/summarize";
export type { SummarizeStage, SummarizeOptions, SummarizeResult } from "./ai/summarize";
export { detectStructuredPii } from "./ai/pii-detect";
export type { PiiType, PiiMatch } from "./ai/pii-detect";
export { detectPii, preloadSmartRedactModel } from "./ai/smart-redact";
export type { NamedEntityType, SmartRedactOptions, SmartRedactMatch } from "./ai/smart-redact";
export { translateText, TRANSLATION_LANGUAGES, preloadTranslateModel } from "./ai/translate";
export type { TranslationLanguage, TranslateStage, TranslateOptions, TranslateResult } from "./ai/translate";
export { explainClause, preloadExplainClauseModel } from "./ai/explain-clause";
export type { ExplainClauseStage, ExplainClauseOptions } from "./ai/explain-clause";
export { captionImage, preloadCaptionModel } from "./ai/caption-image";
export type { CaptionImageOptions } from "./ai/caption-image";
export { chunkPagesForRag, cosineSimilarity, findRelevantChunks, embedChunks, embedQuery, buildRagSystemPrompt, preloadEmbeddingModel } from "./ai/rag";
export type { DocumentChunk, EmbeddedChunk, EmbedOptions } from "./ai/rag";
export { isChatAvailable, sendChatMessage, preloadChatModel } from "./ai/webllm-chat";
export type { ChatMessage, ChatLoadStage, WebLlmChatOptions } from "./ai/webllm-chat";
export { buildCommandPrompt, extractJsonObject, validateCommand, describeCommand } from "./ai/command-bar";
export type { CommandOperation, ValidationSuccess, ValidationFailure } from "./ai/command-bar";
export { extractHighlights } from "./ai/quick-create-content";
export type { HighlightContent, ExtractHighlightsOptions } from "./ai/quick-create-content";
export { recognizeImage, terminateOcrWorker } from "./ocr/ocr-client";
export type { OcrWord, OcrLanguage, OcrProgress } from "./ocr/ocr-client";

export { WebStorageAdapter } from "./storage/web-storage-adapter";
export { recentsStore } from "./storage/recents-store";
export type { StorageAdapter, StorageCapabilities, OpenedFile } from "./storage/types";

export type { PageViewport, OutlineNode, SearchMatch, RecentFileEntry } from "./types";
