import { detectPii, type NamedEntityType, type PiiType } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

const STRUCTURED_TOGGLES: { key: PiiType; label: string }[] = [
  { key: "email", label: "Email addresses" },
  { key: "phone", label: "Phone numbers" },
  { key: "ssn", label: "Social Security numbers" },
  { key: "creditCard", label: "Credit card numbers" },
];

const ENTITY_TOGGLES: { key: NamedEntityType; label: string; hint: string }[] = [
  { key: "person", label: "Person names", hint: "Recommended — the most common thing to redact" },
  { key: "organization", label: "Organization names", hint: "Off by default — often part of the document's own legitimate content" },
  { key: "location", label: "Locations", hint: "Off by default — same reasoning" },
];

/**
 * AI-assisted PII detection: scans every page's real text for structured
 * formats (regex — email/phone/SSN/credit card) and, optionally, named
 * entities (a small local NER model — person/organization/location names).
 * Deliberately does NOT redact anything itself — it only *suggests* boxes
 * by feeding the exact same redactBoxes/addRedactBox state the manual
 * "drag a box" flow uses, so the user reviews (and can remove) every
 * AI-suggested box in RedactOverlay before Apply redactions runs the one,
 * already-verified redaction engine.
 */
export function SmartRedactDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const addRedactBox = useLoomStore((s) => s.addRedactBox);

  const [structuredTypes, setStructuredTypes] = useState<Set<PiiType>>(new Set(["email", "phone", "ssn", "creditCard"]));
  const [entityTypes, setEntityTypes] = useState<Set<NamedEntityType>>(new Set(["person"]));
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const toggleStructured = (key: PiiType) =>
    setStructuredTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleEntity = (key: NamedEntityType) =>
    setEntityTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleRun = async () => {
    if (!doc || !meta) return;
    setIsRunning(true);
    let foundCount = 0;
    try {
      for (let pageNumber = 1; pageNumber <= meta.pageCount; pageNumber++) {
        setStatus(`Scanning page ${pageNumber} of ${meta.pageCount}…`);
        const text = await doc.getFullPageText(pageNumber);
        if (!text.trim()) continue;

        const matches = await detectPii(text, {
          structuredTypes: [...structuredTypes],
          namedEntityTypes: [...entityTypes],
          onProgress: (info) => {
            if (info.stage === "loading-model") {
              const d = info.detail;
              setStatus(d.stage === "downloading" ? `Downloading AI model… ${Math.round(d.progressPct)}%` : "Preparing the AI model…");
            } else {
              setStatus(`Scanning page ${pageNumber} of ${meta.pageCount}…`);
            }
          },
        });

        for (const match of matches) {
          const rects = await doc.findTextRects(pageNumber, match.startIndex, match.endIndex);
          for (const rect of rects) addRedactBox(pageNumber - 1, rect);
          if (rects.length > 0) foundCount++;
        }
      }

      onOpenChange(false);
      if (foundCount === 0) {
        toast.info("Nothing found", "No matches for the selected categories — you can still mark boxes manually.");
      } else {
        toast.success(`Found ${foundCount} possible match${foundCount === 1 ? "" : "es"}`, "Review the highlighted boxes, remove any false positives, then Apply redactions.");
      }
    } catch (error) {
      toast.error("Couldn't run smart detection", error instanceof Error ? error.message : undefined);
    } finally {
      setIsRunning(false);
      setStatus(null);
    }
  };

  const nothingSelected = structuredTypes.size === 0 && entityTypes.size === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Smart detect"
      description="Scans this document's real text for likely sensitive content and suggests redaction boxes for you to review — nothing is redacted until you click Apply redactions."
      width={440}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isRunning}>
            Cancel
          </Button>
          <Button variant="ai" size="sm" disabled={isRunning || nothingSelected} onClick={() => void handleRun()}>
            {isRunning ? "Scanning…" : "Scan document"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-text">Structured formats</span>
          {STRUCTURED_TOGGLES.map((t) => (
            <label key={t.key} className="flex items-center gap-2 text-sm text-text-muted">
              <input type="checkbox" checked={structuredTypes.has(t.key)} onChange={() => toggleStructured(t.key)} disabled={isRunning} />
              {t.label}
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-text">Named entities (AI)</span>
          {ENTITY_TOGGLES.map((t) => (
            <label key={t.key} className="flex items-start gap-2 text-sm text-text-muted">
              <input type="checkbox" checked={entityTypes.has(t.key)} onChange={() => toggleEntity(t.key)} disabled={isRunning} className="mt-0.5" />
              <span>
                {t.label}
                <span className="block text-xs text-text-faint">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-text-faint">
          Named-entity detection uses a small AI model (~45MB, downloads once and is cached for offline reuse) — everything runs on your device.
        </p>
        {status && <p className="text-xs text-ai">{status}</p>}
      </div>
    </Dialog>
  );
}
