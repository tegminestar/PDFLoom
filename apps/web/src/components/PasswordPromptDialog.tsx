import { Button, Dialog } from "@pdfloom/ui";
import { useEffect, useState } from "react";
import { useLoomStore } from "../app/store";

export function PasswordPromptDialog() {
  const open = useLoomStore((s) => s.passwordPromptOpen);
  const pendingOpenFile = useLoomStore((s) => s.pendingOpenFile);
  const passwordError = useLoomStore((s) => s.passwordError);
  const isLoading = useLoomStore((s) => s.isLoading);
  const submitPassword = useLoomStore((s) => s.submitPassword);
  const cancelPasswordPrompt = useLoomStore((s) => s.cancelPasswordPrompt);

  const [password, setPassword] = useState("");

  useEffect(() => {
    if (open) setPassword("");
  }, [open]);

  const handleSubmit = () => {
    if (!password) return;
    void submitPassword(password);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) cancelPasswordPrompt();
      }}
      title="Password required"
      description={pendingOpenFile ? `"${pendingOpenFile.name}" is password-protected.` : "This document is password-protected."}
      width={380}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={cancelPasswordPrompt} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!password || isLoading} onClick={handleSubmit}>
            {isLoading ? "Checking…" : "Open"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="Enter password"
          className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
        />
        {passwordError && <p className="text-xs text-danger">{passwordError}</p>}
        <p className="text-xs text-text-faint">Checked entirely on your device — nothing is ever uploaded.</p>
      </div>
    </Dialog>
  );
}
