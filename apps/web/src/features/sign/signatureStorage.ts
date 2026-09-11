const KEY_PREFIX = "pdfloom.saved-signature-asset.";

// Best-effort convenience, not core functionality — a private-browsing
// context or a full storage quota can throw here, and losing "remember my
// signature" silently is the right failure mode (redraw/retype still
// works). Shared between SignatureCaptureModal (recipient-side signing)
// and SignatureCreatorDialog (owner's self-sign flow) so a signature saved
// in one place is offered again in the other.
export function getSavedSignatureDataUrl(kind: "signature" | "initials"): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + kind);
  } catch {
    return null;
  }
}

export function setSavedSignatureDataUrl(kind: "signature" | "initials", dataUrl: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + kind, dataUrl);
  } catch {
    // Ignored — see getSavedSignatureDataUrl.
  }
}
