import {
  addReviewComment,
  createReviewSession,
  generateSessionCode,
  onReviewCommentsChange,
  removeReviewComment,
  type ReviewComment,
  type ReviewSession,
} from "@pdfloom/core";
import { create } from "zustand";
import { isAuthConfigured } from "../../app/supabase";
import { connectReviewSession, type ReviewConnection } from "./supabaseReviewProvider";

/** Live Review needs the same configured Supabase project Auth uses (just its Realtime feature, not sign-in) — same "opt-in infrastructure, not required for the free product" rule as auth itself. */
export const isReviewAvailable = isAuthConfigured;

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`;
}

interface ReviewStoreState {
  session: ReviewSession | null;
  sessionCode: string | null;
  participantName: string;
  comments: ReviewComment[];
  isPlacingComment: boolean;
  isConnected: boolean;

  setParticipantName: (name: string) => void;
  startSession: () => void;
  joinSession: (code: string) => void;
  leaveSession: () => void;
  setIsPlacingComment: (value: boolean) => void;
  addCommentAt: (pageIndex: number, rect: { x: number; y: number; width: number; height: number }, text: string) => void;
  removeComment: (id: string) => void;
}

let activeConnection: ReviewConnection | null = null;
let unsubscribeComments: (() => void) | null = null;

function teardown() {
  activeConnection?.disconnect();
  activeConnection = null;
  unsubscribeComments?.();
  unsubscribeComments = null;
}

export const useReviewStore = create<ReviewStoreState>((set, get) => ({
  session: null,
  sessionCode: null,
  participantName: "",
  comments: [],
  isPlacingComment: false,
  isConnected: false,

  setParticipantName: (name) => set({ participantName: name }),

  startSession: () => {
    teardown();
    const session = createReviewSession();
    const code = generateSessionCode();
    unsubscribeComments = onReviewCommentsChange(session, (comments) => set({ comments }));
    activeConnection = connectReviewSession(code, session);
    set({ session, sessionCode: code, comments: [], isConnected: !!activeConnection });
  },

  joinSession: (code) => {
    teardown();
    const session = createReviewSession();
    const normalized = code.trim().toUpperCase();
    unsubscribeComments = onReviewCommentsChange(session, (comments) => set({ comments }));
    activeConnection = connectReviewSession(normalized, session);
    set({ session, sessionCode: normalized, comments: [], isConnected: !!activeConnection });
  },

  leaveSession: () => {
    teardown();
    set({ session: null, sessionCode: null, comments: [], isPlacingComment: false, isConnected: false });
  },

  setIsPlacingComment: (value) => set({ isPlacingComment: value }),

  addCommentAt: (pageIndex, rect, text) => {
    const { session, participantName } = get();
    if (!session || !text.trim()) return;
    addReviewComment(session, {
      pageIndex,
      ...rect,
      authorName: participantName.trim() || "Anonymous",
      authorColor: colorForName(participantName.trim() || "Anonymous"),
      text: text.trim(),
    });
  },

  removeComment: (id) => {
    const { session } = get();
    if (session) removeReviewComment(session, id);
  },
}));
