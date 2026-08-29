import * as RadixToast from "@radix-ui/react-toast";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastRecord extends ToastOptions {
  id: string;
  tone: ToastTone;
  durationMs: number;
}

type Listener = (record: ToastRecord) => void;
const listeners = new Set<Listener>();

/** Imperative toast API — callable from anywhere (event handlers, async engine callbacks), not just inside React. */
export const toast = {
  show(options: ToastOptions): void {
    const record: ToastRecord = { id: crypto.randomUUID(), tone: "info", durationMs: 5000, ...options };
    for (const listener of listeners) listener(record);
  },
  success(title: string, description?: string): void {
    toast.show({ title, tone: "success", ...(description !== undefined && { description }) });
  },
  error(title: string, description?: string): void {
    toast.show({ title, tone: "error", durationMs: 8000, ...(description !== undefined && { description }) });
  },
  info(title: string, description?: string): void {
    toast.show({ title, tone: "info", ...(description !== undefined && { description }) });
  },
  warning(title: string, description?: string): void {
    toast.show({ title, tone: "warning", ...(description !== undefined && { description }) });
  },
};

const toneIcon: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-success" />,
  error: <XCircle className="h-5 w-5 text-danger" />,
  info: <Info className="h-5 w-5 text-primary" />,
  warning: <AlertTriangle className="h-5 w-5 text-warning" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<ToastRecord[]>([]);

  useEffect(() => {
    const listener: Listener = (record) => setRecords((prev) => [...prev, record]);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const dismiss = (id: string) => setRecords((prev) => prev.filter((r) => r.id !== id));

  return (
    <RadixToast.Provider swipeDirection="right">
      {children}
      {records.map((record) => (
        <RadixToast.Root
          key={record.id}
          duration={record.durationMs}
          onOpenChange={(open) => {
            if (!open) dismiss(record.id);
          }}
          className={cn(
            "loom-pop grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-[--radius-md] border border-border-strong",
            "bg-bg-elevated p-3.5 pr-2.5 shadow-[--shadow-floating]",
            "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
            "data-[swipe=end]:animate-[loom-fade-out_100ms_ease-in_forwards]",
          )}
        >
          <div className="pt-0.5">{toneIcon[record.tone ?? "info"]}</div>
          <div className="min-w-0">
            <RadixToast.Title className="text-sm font-medium text-text">{record.title}</RadixToast.Title>
            {record.description ? (
              <RadixToast.Description className="mt-0.5 text-xs text-text-muted">
                {record.description}
              </RadixToast.Description>
            ) : null}
          </div>
          <RadixToast.Close
            aria-label="Dismiss"
            className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="fixed bottom-4 right-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
    </RadixToast.Provider>
  );
}
