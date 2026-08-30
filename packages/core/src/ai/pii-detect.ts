/**
 * Pure, dependency-free structured-PII detectors (email/phone/SSN/credit
 * card). No model involved — this is deliberately regex-based, not NER,
 * because these formats are precise enough that a classifier would add
 * risk (false negatives) without meaningfully improving recall. The NER
 * model (smart-redact.ts) is reserved for unstructured PII a regex
 * fundamentally can't catch: person names, organizations, locations.
 */

export type PiiType = "email" | "phone" | "ssn" | "creditCard";

export interface PiiMatch {
  type: PiiType;
  text: string;
  startIndex: number;
  endIndex: number;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Matches common US-style formats: (555) 123-4567, 555-123-4567,
// 555.123.4567, +1 555 123 4567 — deliberately conservative (7-11 digits
// total with real separators) to avoid flagging arbitrary number runs.
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

// Candidate digit runs (13-19 digits, optionally grouped by spaces/dashes)
// — each candidate is then Luhn-checked below to cut false positives on
// arbitrary long numbers (invoice IDs, phone numbers with extra digits).
const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){13,19}\b/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48; // '0'
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function findAll(re: RegExp, text: string, type: PiiType, filter?: (match: string) => boolean): PiiMatch[] {
  const matches: PiiMatch[] = [];
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    if (filter && !filter(m[0])) continue;
    matches.push({ type, text: m[0], startIndex: m.index, endIndex: m.index + m[0].length });
  }
  return matches;
}

/** Detects structured PII (email/phone/SSN/credit card) in a block of text. Card numbers are Luhn-validated to avoid flagging arbitrary long digit runs. */
export function detectStructuredPii(text: string): PiiMatch[] {
  const matches: PiiMatch[] = [
    ...findAll(EMAIL_RE, text, "email"),
    ...findAll(PHONE_RE, text, "phone"),
    ...findAll(SSN_RE, text, "ssn"),
    ...findAll(CARD_CANDIDATE_RE, text, "creditCard", (raw) => {
      const digits = raw.replace(/[ -]/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
    }),
  ];

  // Sort so overlap-resolution (a card number can also look like a phone
  // number fragment) is deterministic, then drop matches fully contained
  // within an earlier, already-accepted match.
  matches.sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
  const resolved: PiiMatch[] = [];
  for (const m of matches) {
    const containedInPrevious = resolved.some((r) => m.startIndex >= r.startIndex && m.endIndex <= r.endIndex);
    if (!containedInPrevious) resolved.push(m);
  }
  return resolved;
}
