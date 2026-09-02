import PptxGenJS from "pptxgenjs";

/**
 * pptxgenjs pulls in image-size, which has two open, currently unpatched
 * DoS advisories (CVE-2025-71329/71330) in its ICNS/JXL/HEIF parsers. Not
 * exploitable here: the only image this module ever hands to pptxgenjs is
 * a PNG data URL this app renders itself (see canvasToPngBlob below) — the
 * vulnerable parsers are never reached. Re-check this note if that ever
 * changes (e.g. accepting a user-supplied image file for export).
 */

/**
 * Every Quick Create export format is built from the exact same rendered
 * canvas — what's in the preview is what you get, in every format, rather
 * than three separate re-implementations of the same layout (one for a
 * canvas, one for PPTX text boxes, one for a PDF page) that could each
 * subtly disagree with each other.
 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't export this canvas as an image"))), "image/png");
  });
}

/** One slide, sized to match the canvas's own aspect ratio, filled edge-to-edge with the rendered image. */
export async function buildImagePptx(pngDataUrl: string, widthPx: number, heightPx: number): Promise<Blob> {
  const pptx = new PptxGenJS();
  const inchesWide = 10;
  const inchesHigh = (heightPx / widthPx) * inchesWide;
  pptx.defineLayout({ name: "QUICK_CREATE", width: inchesWide, height: inchesHigh });
  pptx.layout = "QUICK_CREATE";
  const slide = pptx.addSlide();
  slide.addImage({ data: pngDataUrl, x: 0, y: 0, w: inchesWide, h: inchesHigh });
  const blob = await pptx.write({ outputType: "blob" });
  return blob as Blob;
}
