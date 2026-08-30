import { IconButton, toast } from "@pdfloom/ui";
import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLoomStore } from "../../app/store";
import "./speech-recognition.d.ts";

// If nothing at all happens within this window (no onstart/onresult/
// onerror/onend), something is wrong with the browser's speech service
// rather than the user just not having spoken yet — surface that instead
// of leaving the button stuck in "listening" forever. Chromium's built-in
// recognizer is cloud-backed, so this also covers a real no-network case,
// not just a defensive edge case.
const STUCK_TIMEOUT_MS = 15000;

interface FocusedField {
  name: string;
  left: number;
  top: number;
}

/**
 * Floating microphone button that appears above whichever text form field
 * currently has focus, letting the user dictate into it with the browser's
 * built-in speech recognition — no model download, no API key, per the
 * plan. Unlike every other AI-adjacent feature in this app, this is
 * explicitly NOT guaranteed to stay on-device: most browsers' built-in
 * SpeechRecognition sends audio to a cloud recognition service (Chromium's
 * default implementation does) — said plainly in the tooltip/hint rather
 * than silently implying the same local-only privacy promise the rest of
 * PDFLoom makes.
 */
export function VoiceToFillButton() {
  const formFillOpen = useLoomStore((s) => s.formFillOpen);
  const formMode = useLoomStore((s) => s.formMode);
  const setFormFieldValue = useLoomStore((s) => s.setFormFieldValue);

  const [supported] = useState(() => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  const [focused, setFocused] = useState<FocusedField | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFillMode = formFillOpen && formMode === "fill";

  useEffect(() => {
    if (!supported || !isFillMode) {
      setFocused(null);
      return;
    }
    const handler = (e: FocusEvent) => {
      const target = e.target;
      const fieldName = target instanceof HTMLElement ? target.dataset.fieldName : undefined;
      if (!fieldName) {
        setFocused(null);
        return;
      }
      const rect = (target as HTMLElement).getBoundingClientRect();
      setFocused({ name: fieldName, left: rect.right + 6, top: rect.top + rect.height / 2 });
    };
    const clear = (e: FocusEvent) => {
      // Only clear if focus isn't moving to the mic button itself (its own click steals focus momentarily).
      if (!(e.relatedTarget instanceof HTMLElement && e.relatedTarget.dataset.voiceToFillButton)) setFocused(null);
    };
    document.addEventListener("focusin", handler);
    document.addEventListener("focusout", clear);
    return () => {
      document.removeEventListener("focusin", handler);
      document.removeEventListener("focusout", clear);
    };
  }, [supported, isFillMode]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
    },
    [],
  );

  const clearStuckTimer = () => {
    if (stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = null;
    }
  };

  const handleToggle = () => {
    if (!focused) return;
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    const fieldName = focused.name;

    recognition.onstart = () => {
      clearStuckTimer();
      setIsListening(true);
    };
    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript.trim();
      if (transcript) {
        const current = useLoomStore.getState().formFieldValues[fieldName];
        const existing = typeof current === "string" ? current : "";
        setFormFieldValue(fieldName, existing ? `${existing} ${transcript}` : transcript);
      }
    };
    recognition.onerror = (event) => {
      clearStuckTimer();
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Microphone access was denied", "Allow microphone access in your browser to use voice input.");
      } else if (event.error === "no-speech" || event.error === "aborted") {
        // Nothing said, or the user stopped it themselves — not worth an error toast.
      } else if (event.error === "network") {
        toast.error("Voice input needs an internet connection", "Your browser's speech recognition uses a cloud service, unlike the rest of PDFLoom.");
      } else {
        toast.error("Voice input didn't work", event.error);
      }
    };
    recognition.onend = () => {
      clearStuckTimer();
      setIsListening(false);
    };

    recognition.start();
    stuckTimerRef.current = setTimeout(() => {
      recognition.abort();
      setIsListening(false);
      toast.error("Voice input didn't respond", "Check your microphone and internet connection, then try again.");
    }, STUCK_TIMEOUT_MS);
  };

  if (!supported || !focused) return null;

  return (
    <div className="loom-pop fixed z-50 -translate-y-1/2" style={{ left: focused.left, top: focused.top }}>
      <IconButton
        icon={isListening ? <MicOff /> : <Mic />}
        label={isListening ? "Stop voice input" : "Dictate into this field — uses your browser's speech recognition, which may send audio to a cloud service"}
        variant={isListening ? "active" : "ai"}
        size="sm"
        // Marks this element so the focusout handler above doesn't clear
        // `focused` when focus momentarily lands on the button itself.
        data-voice-to-fill-button="true"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleToggle}
      />
    </div>
  );
}
