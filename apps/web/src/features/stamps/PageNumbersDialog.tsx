import { getPdfWorkerClient, type PageNumberPosition } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

type Mode = "numbers" | "bates";

const POSITIONS: { id: PageNumberPosition; label: string }[] = [
  { id: "bottom-center", label: "Bottom center" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
  { id: "top-center", label: "Top center" },
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
];

export function PageNumbersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [mode, setMode] = useState<Mode>("numbers");
  const [position, setPosition] = useState<PageNumberPosition>("bottom-center");
  const [format, setFormat] = useState("Page {page} of {total}");
  const [startAt, setStartAt] = useState(1);
  const [batesPrefix, setBatesPrefix] = useState("");
  const [batesStart, setBatesStart] = useState(1);
  const [batesDigits, setBatesDigits] = useState(6);
  const [isApplying, setIsApplying] = useState(false);

  const handleApply = async () => {
    if (!doc) return;
    setIsApplying(true);
    try {
      const client = await getPdfWorkerClient();
      const bytes =
        mode === "numbers"
          ? await client.addPageNumbers(await doc.getRawBytes(), { position, format, startAt })
          : await client.addBatesNumbers(await doc.getRawBytes(), {
              position,
              startNumber: batesStart,
              digits: batesDigits,
              ...(batesPrefix.trim() && { prefix: batesPrefix.trim() }),
            });
      await applyPdfMutation(bytes);
      toast.success(mode === "numbers" ? "Page numbers added" : "Bates numbering added");
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't add numbering", error instanceof Error ? error.message : undefined);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Page numbers & Bates numbering"
      width={460}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={isApplying} onClick={() => void handleApply()}>
            {isApplying ? "Applying…" : "Add to every page"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
          <button
            type="button"
            onClick={() => setMode("numbers")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${mode === "numbers" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            Page numbers
          </button>
          <button
            type="button"
            onClick={() => setMode("bates")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${mode === "bates" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            Bates numbering
          </button>
        </div>

        <label className="flex flex-col gap-1.5 text-sm text-text">
          Position
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as PageNumberPosition)}
            className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 outline-none"
          >
            {POSITIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {mode === "numbers" ? (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-text">
              Format
              <input
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 outline-none"
              />
              <span className="text-xs text-text-faint">Use {"{page}"} and {"{total}"}.</span>
            </label>
            <label className="flex items-center justify-between gap-2 text-sm text-text">
              Start at
              <input
                type="number"
                min={1}
                value={startAt}
                onChange={(e) => setStartAt(Number.parseInt(e.target.value, 10) || 1)}
                className="h-8 w-20 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-right outline-none"
              />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-text">
              Prefix
              <input
                value={batesPrefix}
                onChange={(e) => setBatesPrefix(e.target.value)}
                placeholder="e.g. ABC-"
                className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 outline-none placeholder:text-text-faint"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm text-text">
              Start number
              <input
                type="number"
                min={0}
                value={batesStart}
                onChange={(e) => setBatesStart(Number.parseInt(e.target.value, 10) || 0)}
                className="h-8 w-24 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-right outline-none"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm text-text">
              Digits (zero-padded)
              <input
                type="number"
                min={1}
                max={12}
                value={batesDigits}
                onChange={(e) => setBatesDigits(Number.parseInt(e.target.value, 10) || 6)}
                className="h-8 w-20 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-right outline-none"
              />
            </label>
            <p className="text-xs text-text-faint">
              Preview: {batesPrefix}
              {String(batesStart).padStart(batesDigits, "0")}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
