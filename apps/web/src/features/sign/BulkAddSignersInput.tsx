import { Button, toast } from "@pdfloom/ui";
import { useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BulkSignerEntry {
  email: string;
  name: string;
}

/** Parses "email" or "email, name" (or "email\tname") per line, one signer per line — Adobe's "Send in bulk" equivalent for adding many recipients at once instead of one row at a time. */
function parseBulkSigners(raw: string): BulkSignerEntry[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [emailPart, ...rest] = line.split(/[,\t]/);
      const email = (emailPart ?? "").trim();
      const name = rest.join(",").trim();
      return { email, name };
    })
    .filter((entry) => EMAIL_RE.test(entry.email));
}

export function BulkAddSignersInput({ onAdd }: { onAdd: (entries: BulkSignerEntry[]) => void }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");

  const handleAdd = () => {
    const entries = parseBulkSigners(raw);
    if (entries.length === 0) {
      toast.warning("No valid email addresses found", "One per line, e.g. \"jane@example.com, Jane Doe\".");
      return;
    }
    onAdd(entries);
    toast.success(`Added ${entries.length} signer${entries.length === 1 ? "" : "s"}`);
    setRaw("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="self-start">
        Paste a list of emails…
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[--radius-sm] border border-border-strong bg-surface p-2.5">
      <textarea
        autoFocus
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={"One per line:\njane@example.com, Jane Doe\njohn@example.com"}
        rows={4}
        className="resize-none rounded-[--radius-sm] border border-border-strong bg-bg px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
      />
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={handleAdd}>
          Add these signers
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
