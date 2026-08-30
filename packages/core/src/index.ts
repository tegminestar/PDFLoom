export { PdfDocument } from "./pdf/document";
export type { RenderPageOptions, RenderTextLayerOptions, PageDimensions } from "./pdf/document";
export type { TextLayer } from "pdfjs-dist";

export { getPdfWorkerClient } from "./workers/pdf-worker-client";
export type { PdfWorkerApi } from "./workers/pdf-worker-client";
export type { PageRange, RotationDelta, CropBox } from "./pdf/organize";
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
export { diffPageText, summarizeTextComparison, diffPixelsRgba } from "./pdf/compare";
export type { WordDiffOp, WordDiffOpType, PageTextDiffResult, PageComparisonSummary, ComparisonSummary, PixelDiffResult } from "./pdf/compare";

export { detectAiCapabilities, isWebgpuAdapterAvailable } from "./ai/capabilities";
export type { AiCapabilities } from "./ai/capabilities";
export { chunkText } from "./ai/chunk-text";
export { loadPipeline } from "./ai/model-loader";
export type { ModelLoadStage, ModelLoadProgressCallback, LoadPipelineOptions } from "./ai/model-loader";
export { summarizeText } from "./ai/summarize";
export type { SummarizeStage, SummarizeOptions, SummarizeResult } from "./ai/summarize";
export { detectStructuredPii } from "./ai/pii-detect";
export type { PiiType, PiiMatch } from "./ai/pii-detect";
export { detectPii } from "./ai/smart-redact";
export type { NamedEntityType, SmartRedactOptions, SmartRedactMatch } from "./ai/smart-redact";
export { recognizeImage, terminateOcrWorker } from "./ocr/ocr-client";
export type { OcrWord, OcrLanguage, OcrProgress } from "./ocr/ocr-client";

export { WebStorageAdapter } from "./storage/web-storage-adapter";
export { recentsStore } from "./storage/recents-store";
export type { StorageAdapter, StorageCapabilities, OpenedFile } from "./storage/types";

export type { PageViewport, OutlineNode, SearchMatch, RecentFileEntry } from "./types";
