import { applyRemoteUpdate, encodeFullState, onLocalDocUpdate, type ReviewSession } from "@pdfloom/core";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../app/supabase";

export interface ReviewConnection {
  disconnect: () => void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Bridges a local Yjs ReviewSession (packages/core's review-session.ts) to
 * a Supabase Realtime broadcast channel — the only transport-specific
 * piece of "Live Review", deliberately kept out of packages/core so that
 * package stays backend-agnostic. A channel is just a named pub/sub topic
 * on Supabase's already-configured project (the same one Auth already
 * uses) — no new server, no new infrastructure, and no document content
 * ever passes through it: only small Yjs update payloads describing
 * comment pins (page, position, author, text).
 *
 * Update bytes are base64-encoded because Supabase's broadcast payload is
 * plain JSON, not raw binary.
 */
export function connectReviewSession(sessionCode: string, session: ReviewSession, onPeerSynced?: () => void): ReviewConnection | null {
  if (!supabase) return null;
  const channel: RealtimeChannel = supabase.channel(`pdfloom-review-${sessionCode}`, {
    config: { broadcast: { self: false, ack: false } },
  });

  channel.on("broadcast", { event: "update" }, ({ payload }) => {
    const update = (payload as { update?: unknown } | undefined)?.update;
    if (typeof update !== "string") return;
    applyRemoteUpdate(session, base64ToBytes(update));
    onPeerSynced?.();
  });

  // A newly-joined participant has an empty Y.Doc and no way to know what
  // happened before they connected — this asks everyone already present to
  // resend the FULL current state (not just future deltas) so they catch up.
  channel.on("broadcast", { event: "sync-request" }, () => {
    void channel.send({ type: "broadcast", event: "update", payload: { update: bytesToBase64(encodeFullState(session)) } });
  });

  const stopLocalUpdates = onLocalDocUpdate(session, (update) => {
    void channel.send({ type: "broadcast", event: "update", payload: { update: bytesToBase64(update) } });
  });

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      void channel.send({ type: "broadcast", event: "sync-request", payload: {} });
    }
  });

  return {
    disconnect: () => {
      stopLocalUpdates();
      void channel.unsubscribe();
    },
  };
}
