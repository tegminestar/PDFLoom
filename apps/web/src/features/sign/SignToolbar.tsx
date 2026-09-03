import { IconButton, Separator, TopBar, TopBarSection } from "@pdfloom/ui";
import { CalendarDays, PenLine, Send, Stamp, Type, X } from "lucide-react";
import { useState } from "react";
import { useLoomStore } from "../../app/store";
import { PageNumberField } from "../viewer/PageNumberField";
import { ZoomControls } from "../viewer/ZoomControls";
import { RequestSignaturesDialog } from "./RequestSignaturesDialog";
import { SignatureCreatorDialog } from "./SignatureCreatorDialog";

export function SignToolbar() {
  const kind = useLoomStore((s) => s.signPlacementKind);
  const setSignPlacementKind = useLoomStore((s) => s.setSignPlacementKind);
  const activeSignature = useLoomStore((s) => s.activeSignature);
  const activeInitials = useLoomStore((s) => s.activeInitials);
  const signerName = useLoomStore((s) => s.signerName);
  const setSignerName = useLoomStore((s) => s.setSignerName);
  const includeIntegrityHash = useLoomStore((s) => s.includeIntegrityHash);
  const setIncludeIntegrityHash = useLoomStore((s) => s.setIncludeIntegrityHash);
  const setSignOpen = useLoomStore((s) => s.setSignOpen);
  const isPlacing = useLoomStore((s) => s.isPlacingSignature);

  const [creatorSlot, setCreatorSlot] = useState<"signature" | "initials" | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  const hint =
    kind === "timestamp"
      ? "Click the page to place the timestamp"
      : kind
        ? "Click the page to place it"
        : "Create a signature, then place it";

  return (
    <TopBar>
      <TopBarSection>
        <span className="mr-2 text-sm font-semibold text-text">Sign</span>
        <PageNumberField />
        <Separator orientation="vertical" className="mx-1.5 h-6" />
        <ZoomControls />
      </TopBarSection>

      <TopBarSection align="center">
        <span className="mr-2 hidden text-xs text-text-faint lg:inline">{hint}</span>

        <IconButton
          icon={<PenLine />}
          label={activeSignature ? "Signature (click to place)" : "Create signature"}
          variant={kind === "signature" ? "active" : "default"}
          onClick={() => (activeSignature ? setSignPlacementKind("signature") : setCreatorSlot("signature"))}
        />
        <IconButton
          icon={<Type />}
          label={activeInitials ? "Initials (click to place)" : "Create initials"}
          variant={kind === "initials" ? "active" : "default"}
          onClick={() => (activeInitials ? setSignPlacementKind("initials") : setCreatorSlot("initials"))}
        />
        <IconButton
          icon={<CalendarDays />}
          label="Add today's date"
          variant={kind === "date" ? "active" : "default"}
          onClick={() => setSignPlacementKind("date")}
        />
        <IconButton
          icon={<Stamp />}
          label="Signed timestamp — a visual mark, not a legally-binding digital signature"
          variant={kind === "timestamp" ? "active" : "default"}
          onClick={() => setSignPlacementKind("timestamp")}
        />

        {kind === "timestamp" && (
          <>
            <Separator orientation="vertical" className="mx-1.5 h-6" />
            <input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Signer name"
              className="h-8 w-36 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
            />
            <label className="ml-2 flex items-center gap-1.5 text-xs text-text-faint">
              <input type="checkbox" checked={includeIntegrityHash} onChange={(e) => setIncludeIntegrityHash(e.target.checked)} />
              Integrity hash
            </label>
          </>
        )}
      </TopBarSection>

      <TopBarSection align="end">
        {kind === "timestamp" && (
          <span className="hidden max-w-[220px] text-right text-[11px] leading-tight text-text-faint xl:inline">
            Visual attestation only — not a certified, legally-binding signature.
          </span>
        )}
        {isPlacing && <span className="text-xs text-text-faint">Placing…</span>}
        <IconButton icon={<Send />} label="Request signatures from others" onClick={() => setRequestOpen(true)} />
        <Separator orientation="vertical" className="mx-1.5 h-6" />
        <IconButton icon={<X />} label="Exit sign mode" onClick={() => setSignOpen(false)} showTooltip={false} />
      </TopBarSection>

      {creatorSlot && (
        <SignatureCreatorDialog open={creatorSlot !== null} onOpenChange={(open) => !open && setCreatorSlot(null)} slot={creatorSlot} />
      )}
      <RequestSignaturesDialog open={requestOpen} onOpenChange={setRequestOpen} />
    </TopBar>
  );
}
