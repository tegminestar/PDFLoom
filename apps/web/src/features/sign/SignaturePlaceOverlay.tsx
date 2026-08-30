import type { PdfDocument } from "@pdfloom/core";
import { useLoomStore } from "../../app/store";

export interface SignaturePlaceOverlayProps {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
}

const BASE_HEIGHT: Record<string, number> = { signature: 56, initials: 42, date: 20, timestamp: 56 };

/** Single-click placement for whatever signPlacementKind is currently armed — mirrors the stamp tool's click gesture in AnnotationDrawOverlay. */
export function SignaturePlaceOverlay({ doc, pageNumber, scale, rotation }: SignaturePlaceOverlayProps) {
  const signOpen = useLoomStore((s) => s.signOpen);
  const kind = useLoomStore((s) => s.signPlacementKind);
  const activeSignature = useLoomStore((s) => s.activeSignature);
  const activeInitials = useLoomStore((s) => s.activeInitials);
  const isPlacing = useLoomStore((s) => s.isPlacingSignature);
  const placeSignatureAt = useLoomStore((s) => s.placeSignatureAt);

  if (!signOpen || !kind) return null;
  const asset = kind === "signature" ? activeSignature : kind === "initials" ? activeInitials : null;
  if ((kind === "signature" || kind === "initials") && !asset) return null;

  const height = BASE_HEIGHT[kind] ?? 48;
  const width = asset?.kind === "image" && asset.aspectRatio ? height * asset.aspectRatio : kind === "timestamp" ? 190 : kind === "date" ? 130 : height * 2.6;

  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair"
      onPointerDown={async (e) => {
        e.preventDefault();
        if (isPlacing) return;
        const container = e.currentTarget.getBoundingClientRect();
        const screenX = e.clientX - container.left - width / 2;
        const screenY = e.clientY - container.top - height / 2;
        const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, screenX, screenY);
        const p2 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, screenX + width, screenY + height);
        const rect = {
          x: Math.min(p1.x, p2.x),
          y: Math.min(p1.y, p2.y),
          width: Math.abs(p2.x - p1.x),
          height: Math.abs(p2.y - p1.y),
        };
        await placeSignatureAt(pageNumber - 1, rect);
      }}
    />
  );
}
