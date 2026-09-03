import * as Y from "yjs";

/**
 * "Live Review" — a shared, real-time list of comment pins on top of a
 * document, for people who each already have their own copy of the same
 * PDF and want to co-review it. Deliberately NOT collaborative editing of
 * the document's actual content: PDFLoom's edits are opaque, whole-file
 * pdf-lib mutations (load the whole PDF, change it, re-save the whole
 * PDF), not the kind of structured, incremental operation a CRDT can
 * merge — trying to make concurrent binary PDF mutations "merge" would be
 * unsound. A CRDT genuinely fits the comments themselves, though: several
 * people can add/remove pins at the same time, on/offline, and Yjs
 * resolves the result deterministically with no server-side merge logic
 * needed.
 *
 * This module only knows about the shared comment list — it has no idea
 * how those bytes reach another participant. See
 * apps/web/src/features/collab/supabaseReviewProvider.ts for the transport
 * (a Supabase Realtime broadcast channel), kept out of this package since
 * packages/core stays platform/backend-agnostic.
 */
export interface ReviewComment {
  id: string;
  pageIndex: number;
  /** PDF point space (not screen pixels), so a pin lands in the same spot regardless of the viewer's current zoom/rotation. */
  x: number;
  y: number;
  width: number;
  height: number;
  authorName: string;
  /** A CSS color string, stable per participant for the life of the session — lets pins from the same person be visually grouped at a glance. */
  authorColor: string;
  text: string;
  createdAt: number;
}

export interface ReviewSession {
  doc: Y.Doc;
  comments: Y.Array<ReviewComment>;
}

export function createReviewSession(): ReviewSession {
  const doc = new Y.Doc();
  const comments = doc.getArray<ReviewComment>("comments");
  return { doc, comments };
}

export function addReviewComment(session: ReviewSession, comment: Omit<ReviewComment, "id" | "createdAt">): ReviewComment {
  const full: ReviewComment = { ...comment, id: crypto.randomUUID(), createdAt: Date.now() };
  session.comments.push([full]);
  return full;
}

export function removeReviewComment(session: ReviewSession, id: string): void {
  const items = session.comments.toArray();
  const index = items.findIndex((c) => c.id === id);
  if (index !== -1) session.comments.delete(index, 1);
}

export function listReviewComments(session: ReviewSession): ReviewComment[] {
  return session.comments.toArray();
}

/** Fires with the full current list on every change (local or synced from a peer) — deliberately not diffed, since a UI list of comment pins is cheap to just re-render in full. */
export function onReviewCommentsChange(session: ReviewSession, callback: (comments: ReviewComment[]) => void): () => void {
  const handler = () => callback(listReviewComments(session));
  session.comments.observe(handler);
  return () => session.comments.unobserve(handler);
}

/**
 * Tags a Yjs update as having come from a peer, not this tab's own local
 * edit — checked in onDocUpdate below so an update this tab just RECEIVED
 * doesn't get immediately re-broadcast back out, which would otherwise
 * loop forever between two or more connected participants.
 */
const REMOTE_ORIGIN = Symbol("pdfloom-review-remote-update");

export function applyRemoteUpdate(session: ReviewSession, update: Uint8Array): void {
  Y.applyUpdate(session.doc, update, REMOTE_ORIGIN);
}

/** Fires only for changes that originated in THIS tab — a transport wires this to actually send the bytes to peers. */
export function onLocalDocUpdate(session: ReviewSession, callback: (update: Uint8Array) => void): () => void {
  const handler = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return;
    callback(update);
  };
  session.doc.on("update", handler);
  return () => session.doc.off("update", handler);
}

/** The full current state, for a participant who just joined and needs to catch up on everything that happened before they connected. */
export function encodeFullState(session: ReviewSession): Uint8Array {
  return Y.encodeStateAsUpdate(session.doc);
}

/** A short, human-shareable session code — typed or pasted, not a long opaque ID. */
export function generateSessionCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 8).toUpperCase();
}
