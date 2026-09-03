import { captionImage, getPdfWorkerClient, preloadCaptionModel, type PageImageInfo } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useEffect, useRef, useState } from "react";
import { useLoomStore } from "../../app/store";

interface CaptionedImage extends PageImageInfo {
  caption: string;
  thumbnailUrl: string | null;
  skipped: boolean;
}

/**
 * Generates AI alt-text suggestions for images in the document and writes
 * them onto each image's /Alt entry — a genuine, if partial, accessibility
 * improvement (screen readers that support /Alt on the image object will
 * announce it), explicitly NOT full PDF/UA structure-tree tagging (reading
 * order, headings, tab order). Building a correct structure tree needs a
 * content-stream parser/rewriter this app doesn't have — attempting a
 * half-correct one would risk producing a document that *claims* to be
 * tagged without actually being reliably navigable, which is worse than
 * being honest about the narrower scope. See accessibility.ts.
 *
 * Only JPEG-encoded images can be captioned (browser-native decoding —
 * see accessibility.ts's PageImageInfo.decodable) — other formats
 * (FlateDecode raw samples, CCITT, JBIG2, JPX) are listed but skipped
 * with an honest note rather than a guessed caption.
 */
export function AccessibilityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [isScanning, setIsScanning] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [images, setImages] = useState<CaptionedImage[] | null>(null);
  const [skippedFormatCount, setSkippedFormatCount] = useState(0);

  // Thumbnails are object URLs (see handleScan). Tracked separately from
  // `images` state (which changes on every caption edit/skip toggle,
  // reusing the same URLs) so revocation only happens for a genuinely new
  // scan's stale URLs, or on unmount — not on every keystroke.
  const thumbnailUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      thumbnailUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // The captioning model is only needed once an actual undescribed image
  // turns up mid-scan, but starting its download immediately on open — in
  // parallel with the page-image scan itself — means it's often ready
  // before the first image that needs it.
  useEffect(() => {
    if (open) void preloadCaptionModel();
  }, [open]);

  const handleScan = async () => {
    if (!doc || !meta) return;
    setIsScanning(true);
    setImages(null);
    thumbnailUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    thumbnailUrlsRef.current = [];
    try {
      const client = await getPdfWorkerClient();
      const bytes = await doc.getRawBytes();
      const perPage = await client.listAllPageImages(bytes);

      const decodableImages: PageImageInfo[] = [];
      let skippedFormats = 0;
      perPage.forEach((pageImages) => {
        for (const img of pageImages) {
          if (img.decodable) decodableImages.push(img);
          else skippedFormats++;
        }
      });
      setSkippedFormatCount(skippedFormats);

      if (decodableImages.length === 0) {
        setImages([]);
        return;
      }

      const captioned: CaptionedImage[] = [];
      for (let i = 0; i < decodableImages.length; i++) {
        const img = decodableImages[i]!;
        const blob = new Blob([img.decodable!.bytes as BlobPart], { type: img.decodable!.mimeType });
        const thumbnailUrl = URL.createObjectURL(blob);
        thumbnailUrlsRef.current.push(thumbnailUrl);

        // Already has alt text (e.g. from a previous run) — show it as-is
        // rather than spending time regenerating a guess the user may have
        // already reviewed; they can still edit or clear it manually.
        if (img.existingAltText) {
          captioned.push({ ...img, caption: img.existingAltText, thumbnailUrl, skipped: false });
          continue;
        }

        setStatus(`Captioning image ${i + 1} of ${decodableImages.length}…`);
        try {
          const caption = await captionImage(blob, {
            onProgress: (info) => {
              if (info.stage === "loading-model") {
                const d = info.detail;
                setStatus(d.stage === "downloading" ? `Downloading AI model… ${Math.round(d.progressPct)}%` : "Preparing the AI model…");
              } else {
                setStatus(`Captioning image ${i + 1} of ${decodableImages.length}…`);
              }
            },
          });
          captioned.push({ ...img, caption, thumbnailUrl, skipped: false });
        } catch (error) {
          captioned.push({ ...img, caption: "", thumbnailUrl, skipped: true });
          toast.error(`Couldn't caption an image on page ${img.pageIndex + 1}`, error instanceof Error ? error.message : undefined);
        }
      }
      setImages(captioned);
    } catch (error) {
      toast.error("Couldn't scan this document for images", error instanceof Error ? error.message : undefined);
    } finally {
      setIsScanning(false);
      setStatus(null);
    }
  };

  const updateCaption = (index: number, caption: string) => {
    setImages((prev) => (prev ? prev.map((img, i) => (i === index ? { ...img, caption } : img)) : prev));
  };
  const toggleSkip = (index: number) => {
    setImages((prev) => (prev ? prev.map((img, i) => (i === index ? { ...img, skipped: !img.skipped } : img)) : prev));
  };

  const handleApply = async () => {
    if (!doc || !images) return;
    const updates = images.filter((img) => !img.skipped && img.caption.trim()).map((img) => ({ pageIndex: img.pageIndex, resourceName: img.resourceName, altText: img.caption.trim() }));
    if (updates.length === 0) return;
    setIsApplying(true);
    try {
      const client = await getPdfWorkerClient();
      const bytes = await client.applyImageAltText(await doc.getRawBytes(), updates);
      await applyPdfMutation(new Uint8Array(bytes));
      toast.success(`Added alt text to ${updates.length} image${updates.length === 1 ? "" : "s"}`);
      onOpenChange(false);
      setImages(null);
    } catch (error) {
      toast.error("Couldn't apply alt text", error instanceof Error ? error.message : undefined);
    } finally {
      setIsApplying(false);
    }
  };

  const applyCount = images?.filter((img) => !img.skipped && img.caption.trim()).length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Accessibility: image alt text"
      description="Generates AI descriptions for images and attaches them so screen readers can describe pictures — a genuine, but partial, accessibility improvement, not full PDF/UA tagging (reading order, headings, and tab order aren't attempted)."
      width={520}
      footer={
        images === null ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isScanning}>
              Cancel
            </Button>
            <Button variant="ai" size="sm" disabled={isScanning} onClick={() => void handleScan()}>
              {isScanning ? "Scanning…" : "Scan for images"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isApplying}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={applyCount === 0 || isApplying} onClick={() => void handleApply()}>
              {isApplying ? "Applying…" : `Apply to ${applyCount} image${applyCount === 1 ? "" : "s"}`}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {status && <p className="text-xs text-ai">{status}</p>}

        {images !== null && images.length === 0 && skippedFormatCount === 0 && <p className="text-sm text-text-faint">No images found in this document.</p>}
        {images !== null && images.length === 0 && skippedFormatCount > 0 && (
          <p className="text-sm text-text-faint">
            Found {skippedFormatCount} image{skippedFormatCount === 1 ? "" : "s"}, but none in a format this can read (only JPEG-encoded images are supported).
          </p>
        )}

        {images !== null && images.length > 0 && (
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
            {images.map((img, i) => (
              <div key={`${img.pageIndex}-${img.resourceName}`} className="flex gap-3 rounded-[--radius-md] border border-border bg-surface p-2.5">
                {img.thumbnailUrl && <img src={img.thumbnailUrl} alt="" className="h-16 w-16 shrink-0 rounded-[--radius-sm] object-cover" />}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-xs text-text-faint">Page {img.pageIndex + 1}</span>
                  <input
                    value={img.caption}
                    onChange={(e) => updateCaption(i, e.target.value)}
                    disabled={img.skipped}
                    placeholder="Alt text…"
                    className="h-8 rounded-[--radius-sm] border border-border-strong bg-bg px-2 text-sm text-text outline-none disabled:opacity-50"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-text-muted">
                    <input type="checkbox" checked={img.skipped} onChange={() => toggleSkip(i)} />
                    Skip this image
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
        {images !== null && skippedFormatCount > 0 && images.length > 0 && (
          <p className="text-xs text-text-faint">
            {skippedFormatCount} additional image{skippedFormatCount === 1 ? "" : "s"} in an unsupported format {skippedFormatCount === 1 ? "was" : "were"} skipped automatically.
          </p>
        )}
      </div>
    </Dialog>
  );
}
