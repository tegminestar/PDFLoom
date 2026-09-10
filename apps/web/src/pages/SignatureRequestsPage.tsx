import { Button, Dialog, IconButton, cn, toast } from "@pdfloom/ui";
import { Check, Copy, Download, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "../app/auth";
import { apiUrl, isAuthConfigured, supabase } from "../app/supabase";
import { AccountDialog } from "../features/account/AccountDialog";

interface RequestSigner {
  email: string;
  name: string | null;
  status: "pending" | "signed" | "declined";
  orderIndex: number;
  declineReason: string | null;
  signUrl: string;
}

interface SignatureRequestSummary {
  id: string;
  originalFilename: string;
  status: "pending" | "completed" | "voided";
  effectiveStatus: "pending" | "completed" | "voided" | "declined";
  signingMode: "parallel" | "sequential";
  createdAt: string;
  completedAt: string | null;
  signers: RequestSigner[];
  downloadUrl: string | null;
}

interface TemplateSummary {
  id: string;
  name: string;
  originalFilename: string;
  signingMode: "parallel" | "sequential";
  roleCount: number;
  createdAt: string;
}

const STATUS_BADGE: Record<SignatureRequestSummary["effectiveStatus"], string> = {
  pending: "bg-surface-hover text-text-muted",
  completed: "bg-success-muted text-success",
  voided: "bg-surface-hover text-text-faint",
  declined: "bg-danger-muted text-danger",
};
const STATUS_LABEL: Record<SignatureRequestSummary["effectiveStatus"], string> = {
  pending: "Pending",
  completed: "Completed",
  voided: "Voided",
  declined: "Declined",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const centeredPage = "flex min-h-screen items-center justify-center bg-bg p-6";

/**
 * Not linked from any nav — reached only by visiting /signatures directly,
 * same standalone convention as /analytics (no back button into the main
 * app). Two tabs: every signature request this owner has ever sent (with
 * per-signer status, copy-link/void/download actions — the tracking view
 * that never existed before this rebuild), and every saved template.
 */
export function SignatureRequestsPage() {
  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const signOut = useAuthStore((s) => s.signOut);

  const [activeTab, setActiveTab] = useState<"requests" | "templates">("requests");
  const [requests, setRequests] = useState<SignatureRequestSummary[] | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<SignatureRequestSummary | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthConfigured) initialize();
  }, [initialize]);

  const load = useCallback(async (): Promise<void> => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      setError("Not signed in");
      setLoading(false);
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [requestsRes, templatesRes] = await Promise.all([
        fetch(`${apiUrl}/api/signature-requests`, { headers }),
        fetch(`${apiUrl}/api/signature-templates`, { headers }),
      ]);
      if (!requestsRes.ok) {
        setError(`Couldn't load your signature requests (${requestsRes.status})`);
        return;
      }
      const requestsBody = (await requestsRes.json()) as { requests: SignatureRequestSummary[] };
      setRequests(requestsBody.requests);
      if (templatesRes.ok) {
        const templatesBody = (await templatesRes.json()) as { templates: TemplateSummary[] };
        setTemplates(templatesBody.templates);
      }
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load]);

  const runAction = async (id: string, path: string, method: "POST" | "DELETE", body?: Record<string, unknown>): Promise<boolean> => {
    if (!supabase) return false;
    setPendingId(id);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        toast.error("Not signed in");
        return false;
      }
      const res = await fetch(`${apiUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const errorBody = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error("Action failed", errorBody.error ?? `HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch {
      toast.error("Couldn't reach the server");
      return false;
    } finally {
      setPendingId(null);
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    const ok = await runAction(voidTarget.id, `/api/signature-requests/${voidTarget.id}/void`, "POST");
    setVoidTarget(null);
    if (ok) {
      toast.success("Request voided", voidTarget.originalFilename);
      await load();
    }
  };

  const handleDeleteTemplate = async (template: TemplateSummary) => {
    const ok = await runAction(template.id, `/api/signature-templates/${template.id}`, "DELETE");
    if (ok) {
      toast.success("Template deleted", template.name);
      await load();
    }
  };

  const handleCopy = async (signUrl: string) => {
    await navigator.clipboard.writeText(signUrl);
    setCopiedUrl(signUrl);
    setTimeout(() => setCopiedUrl(null), 1500);
  };

  if (!isAuthConfigured) {
    return (
      <div className={centeredPage}>
        <p className="text-sm text-text-muted">Signature requests aren't set up on this deployment.</p>
      </div>
    );
  }
  if (authLoading) {
    return (
      <div className={centeredPage}>
        <p className="text-sm text-text-muted">Loading…</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className={centeredPage}>
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-text-muted">Sign in to view your signature requests.</p>
          <Button variant="primary" size="sm" onClick={() => setAccountOpen(true)}>
            Sign in
          </Button>
        </div>
        <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-medium text-text">Signature Requests</h1>
            <p className="text-sm text-text-muted">Everything you've sent for signature, and your saved templates.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-faint">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </header>

        {error && <div className="rounded-[--radius-md] border border-border bg-surface p-4 text-sm text-text-muted">{error}</div>}
        {!error && loading && <div className="rounded-[--radius-md] border border-border bg-surface p-4 text-sm text-text-muted">Loading…</div>}

        {!error && !loading && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1 border-b border-border pb-2">
              {(
                [
                  { id: "requests" as const, label: "Requests", count: requests?.length ?? 0 },
                  { id: "templates" as const, label: "Templates", count: templates?.length ?? 0 },
                ]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "rounded-[--radius-sm] px-3 py-1.5 text-sm font-medium transition-colors",
                    activeTab === tab.id ? "bg-primary-muted text-primary" : "text-text-muted hover:bg-surface-hover hover:text-text",
                  )}
                >
                  {tab.label}
                  {tab.count > 0 && <span className="ml-1.5 text-xs text-text-faint">{tab.count}</span>}
                </button>
              ))}
            </div>

            {activeTab === "requests" && (
              <div className="flex flex-col gap-3">
                {(requests ?? []).length === 0 && <p className="text-sm text-text-faint">You haven't sent anything for signature yet.</p>}
                {(requests ?? []).map((request) => (
                  <div key={request.id} className="flex flex-col gap-3 rounded-[--radius-md] border border-border bg-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-text">{request.originalFilename}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_BADGE[request.effectiveStatus])}>
                          {STATUS_LABEL[request.effectiveStatus]}
                        </span>
                        <span className="text-xs text-text-faint">{request.signingMode === "sequential" ? "In order" : "Any order"}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {request.downloadUrl && (
                          <a
                            href={request.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex h-7 items-center gap-1 rounded-[--radius-sm] px-2 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </a>
                        )}
                        {request.status === "pending" && (
                          <IconButton icon={<X />} label="Void this request" size="sm" disabled={pendingId === request.id} onClick={() => setVoidTarget(request)} />
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {request.signers.map((signer) => (
                        <div key={signer.email} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-text-muted">
                            {signer.name ? `${signer.name} · ${signer.email}` : signer.email}
                            {signer.status === "declined" && signer.declineReason && (
                              <span className="ml-1.5 text-danger">— declined: {signer.declineReason}</span>
                            )}
                          </span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 font-medium",
                                signer.status === "signed" ? "bg-success-muted text-success" : signer.status === "declined" ? "bg-danger-muted text-danger" : "bg-surface-hover text-text-faint",
                              )}
                            >
                              {signer.status}
                            </span>
                            {signer.status === "pending" && (
                              <button type="button" onClick={() => void handleCopy(signer.signUrl)} className="flex items-center gap-1 text-text-faint hover:text-text">
                                {copiedUrl === signer.signUrl ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <span className="text-[11px] text-text-faint">Sent {formatDate(request.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "templates" && (
              <div className="flex flex-col gap-2">
                {(templates ?? []).length === 0 && <p className="text-sm text-text-faint">No saved templates yet — check "Save as a reusable template" when sending a document.</p>}
                {(templates ?? []).map((template) => (
                  <div key={template.id} className="flex items-center justify-between gap-2 rounded-[--radius-md] border border-border bg-surface p-3">
                    <div>
                      <div className="text-sm font-medium text-text">{template.name}</div>
                      <div className="text-xs text-text-faint">
                        {template.roleCount} {template.roleCount === 1 ? "role" : "roles"} · {template.signingMode === "sequential" ? "In order" : "Any order"} · Saved {formatDate(template.createdAt)}
                      </div>
                    </div>
                    <IconButton icon={<Trash2 />} label="Delete this template" size="sm" disabled={pendingId === template.id} onClick={() => void handleDeleteTemplate(template)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={voidTarget != null}
        onOpenChange={(open) => !open && setVoidTarget(null)}
        title="Void this request?"
        description={voidTarget ? `Signers won't be able to open or sign "${voidTarget.originalFilename}" anymore. This can't be undone.` : undefined}
        width={400}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setVoidTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" disabled={pendingId === voidTarget?.id} onClick={() => void handleVoid()}>
              {pendingId === voidTarget?.id ? "Voiding…" : "Void request"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-muted">Anyone who already signed keeps their own record of it, but the request itself won't complete.</p>
      </Dialog>
    </div>
  );
}
