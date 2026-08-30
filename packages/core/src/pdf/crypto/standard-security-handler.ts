import { PDFArray, PDFContext, PDFDict, PDFDocument, PDFHexString, PDFNumber, PDFObject, PDFRawStream, PDFRef, PDFStream, PDFString } from "pdf-lib";
import { md5 } from "./md5";
import { rc4 } from "./rc4";

// Implements the PDF "Standard Security Handler", Algorithm 3.1-3.6 from
// ISO 32000-1 §7.6 — specifically Version 4 / Revision 4 (128-bit key,
// AESV2 content encryption). pdf-lib deliberately has no encryption
// support at all (a well-known, long-standing limitation), and every
// alternative on npm for this is either an unmaintained fork or a brand
// new (weeks-old, unvetted) single-maintainer package — unacceptable
// supply-chain risk for security-sensitive code. R4/AESV2 was chosen over
// the newer R6/AES-256 scheme specifically because its key-derivation
// algorithm is the same one used since R2/R3 (extremely well-documented,
// unchanged for ~20 years, implemented identically across every major PDF
// library), which minimizes the surface for a subtle, hard-to-notice bug
// versus R6's more intricate iterative-hash "Algorithm 2.B". R4/AESV2 is
// still fully supported by every mainstream reader including pdf.js and
// Adobe Acrobat. Encrypt and decrypt are both verified against pdf.js's
// own (independent) decryption via a real open-in-browser round trip, not
// just internal self-consistency — see verify-protect.mjs.

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e,
  0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const KEY_LENGTH_BYTES = 16; // 128-bit
const REVISION = 4;
const VERSION = 4;

export interface PdfPermissions {
  printing?: boolean;
  highResPrinting?: boolean;
  modifying?: boolean;
  copying?: boolean;
  annotating?: boolean;
  fillingForms?: boolean;
  contentAccessibility?: boolean;
  documentAssembly?: boolean;
}

export interface EncryptOptions {
  /** Required to open/view the document at all. Leave empty to only restrict permissions (no open password). */
  userPassword?: string;
  /** Required to change permissions or remove protection. Defaults to the user password (or a document is otherwise unprotectable-by-owner). */
  ownerPassword?: string;
  permissions?: PdfPermissions;
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function padPassword(password: string): Uint8Array {
  const bytes = latin1Bytes(password).slice(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes);
  out.set(PAD.subarray(0, 32 - bytes.length), bytes.length);
  return out;
}

function permissionsToInt32(p: PdfPermissions = {}): number {
  const bit = (n: number) => 1 << (n - 1);
  let value = bit(1) | bit(2) | bit(7) | bit(8); // reserved bits, always 1
  for (let n = 13; n <= 32; n++) value |= bit(n); // reserved bits, always 1
  if (p.printing !== false) value |= bit(3);
  if (p.modifying !== false) value |= bit(4);
  if (p.copying !== false) value |= bit(5);
  if (p.annotating !== false) value |= bit(6);
  if (p.fillingForms !== false) value |= bit(9);
  if (p.contentAccessibility !== false) value |= bit(10);
  if (p.documentAssembly !== false) value |= bit(11);
  if (p.highResPrinting !== false) value |= bit(12);
  return value | 0;
}

function permissionsBytesLE(permissions: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, permissions, true);
  return out;
}

/** Algorithm 3.3 — computes the /O (owner) entry. */
function computeOwnerEntry(ownerPassword: string, userPassword: string): Uint8Array {
  let hash = md5(padPassword(ownerPassword || userPassword));
  for (let i = 0; i < 50; i++) hash = md5(hash);
  const rc4Key = hash.subarray(0, KEY_LENGTH_BYTES);
  let encrypted = rc4(rc4Key, padPassword(userPassword));
  for (let i = 1; i <= 19; i++) {
    const xorKey = rc4Key.map((b) => b ^ i);
    encrypted = rc4(xorKey, encrypted);
  }
  return encrypted;
}

/** Recovers the padded user password embedded in /O, given a candidate owner password — the inverse of computeOwnerEntry, used to validate/unlock via the owner password. */
function recoverUserPasswordFromOwnerEntry(ownerEntry: Uint8Array, candidateOwnerPassword: string): Uint8Array {
  let hash = md5(padPassword(candidateOwnerPassword));
  for (let i = 0; i < 50; i++) hash = md5(hash);
  const rc4Key = hash.subarray(0, KEY_LENGTH_BYTES);
  let decrypted = ownerEntry;
  for (let i = 19; i >= 1; i--) {
    const xorKey = rc4Key.map((b) => b ^ i);
    decrypted = rc4(xorKey, decrypted);
  }
  return rc4(rc4Key, decrypted);
}

/** Algorithm 3.2 — computes the file encryption key from the (candidate) user password. */
function computeFileKey(userPassword: string, ownerEntry: Uint8Array, permissions: number, idFirst: Uint8Array): Uint8Array {
  const input = concatBytes([padPassword(userPassword), ownerEntry, permissionsBytesLE(permissions), idFirst]);
  let hash = md5(input);
  for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, KEY_LENGTH_BYTES));
  return hash.subarray(0, KEY_LENGTH_BYTES);
}

/** Algorithm 3.5 (R3/R4 variant) — computes the /U (user) entry from the file key. */
function computeUserEntry(fileKey: Uint8Array, idFirst: Uint8Array): Uint8Array {
  let hash = md5(concatBytes([PAD, idFirst]));
  let encrypted = rc4(fileKey, hash);
  for (let i = 1; i <= 19; i++) {
    const xorKey = fileKey.map((b) => b ^ i);
    encrypted = rc4(xorKey, encrypted);
  }
  const out = new Uint8Array(32);
  out.set(encrypted);
  return out;
}

/** Algorithm 3.1 (AESV2 variant, with the "sAlT" suffix) — per-object encryption key. */
function computeObjectKey(fileKey: Uint8Array, objectNumber: number, generationNumber: number): Uint8Array {
  const input = new Uint8Array(fileKey.length + 5 + 4);
  input.set(fileKey, 0);
  input[fileKey.length] = objectNumber & 0xff;
  input[fileKey.length + 1] = (objectNumber >> 8) & 0xff;
  input[fileKey.length + 2] = (objectNumber >> 16) & 0xff;
  input[fileKey.length + 3] = generationNumber & 0xff;
  input[fileKey.length + 4] = (generationNumber >> 8) & 0xff;
  input.set([0x73, 0x41, 0x6c, 0x54], fileKey.length + 5); // "sAlT"
  const hash = md5(input.subarray(0, fileKey.length + 5 + 4));
  return hash.subarray(0, Math.min(fileKey.length + 5, 16));
}

async function aesCbcEncrypt(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, data as BufferSource);
  const out = new Uint8Array(16 + encrypted.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(encrypted), 16);
  return out;
}

async function aesCbcDecrypt(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length < 16) return new Uint8Array(0); // malformed/empty ciphertext — nothing to recover
  const iv = data.subarray(0, 16);
  const ciphertext = data.subarray(16);
  if (ciphertext.length === 0) return new Uint8Array(0);
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, cryptoKey, ciphertext as BufferSource);
  return new Uint8Array(decrypted);
}

type Transform = (key: Uint8Array, data: Uint8Array) => Promise<Uint8Array>;

async function transformValue(value: PDFObject, objectKey: Uint8Array, transform: Transform): Promise<PDFObject | null> {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    const result = await transform(objectKey, value.asBytes());
    return PDFHexString.of(bytesToHex(result));
  }
  if (value instanceof PDFDict || value instanceof PDFArray) {
    await transformObjectTree(value, objectKey, transform);
    return null;
  }
  return null;
}

async function transformObjectTree(obj: PDFDict | PDFArray, objectKey: Uint8Array, transform: Transform): Promise<void> {
  if (obj instanceof PDFDict) {
    for (const [key, value] of obj.entries()) {
      const replaced = await transformValue(value, objectKey, transform);
      if (replaced) obj.set(key, replaced);
    }
  } else {
    for (let i = 0; i < obj.size(); i++) {
      const replaced = await transformValue(obj.get(i), objectKey, transform);
      if (replaced) obj.set(i, replaced);
    }
  }
}

/**
 * Walks every indirect object in the document, applying `transform` to every
 * string and every stream's raw contents, using a fresh per-object key each
 * time (Algorithm 3.1). Shared by both encrypt and decrypt — they differ
 * only in which Transform (AES-encrypt vs AES-decrypt) is passed in and in
 * how the file key is derived beforehand.
 *
 * `skipRef` must be the /Encrypt dictionary's own ref when one already
 * exists (i.e. always on decrypt, loading an already-encrypted file) — its
 * /O, /U, /Perms etc. entries are stored in plain, unencrypted form per
 * spec, never AES-encrypted, so walking into it would try to AES-decrypt
 * bytes that were never ciphertext in the first place. On encrypt this is
 * naturally moot: the dict is created and registered *after* this walk
 * runs, so it was never in `enumerateIndirectObjects()` to begin with.
 */
async function transformAllIndirectObjects(context: PDFContext, fileKey: Uint8Array, transform: Transform, skipRef?: PDFRef): Promise<void> {
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (skipRef && ref.objectNumber === skipRef.objectNumber && ref.generationNumber === skipRef.generationNumber) continue;
    const objectKey = computeObjectKey(fileKey, ref.objectNumber, ref.generationNumber);
    if (obj instanceof PDFStream) {
      await transformObjectTree(obj.dict, objectKey, transform);
      const newContents = await transform(objectKey, obj.getContents());
      context.assign(ref, PDFRawStream.of(obj.dict, newContents));
    } else if (obj instanceof PDFDict || obj instanceof PDFArray) {
      await transformObjectTree(obj, objectKey, transform);
    }
  }
}

function randomId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** Encrypts a document with the Standard Security Handler (V4/R4, AES-128/AESV2). Re-saves with useObjectStreams:false — cross-reference/object streams complicate the encryption of an already-compressed object stream's own contents, and the classic xref-table format every reader supports sidesteps that entirely. */
export async function encryptDocument(source: Uint8Array, options: EncryptOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source);
  const context = doc.context;

  const userPassword = options.userPassword ?? "";
  const ownerPassword = options.ownerPassword ?? userPassword;
  if (!ownerPassword) throw new Error("An owner password is required (falls back to the user password if only one is set).");

  const idBytes = randomId();
  context.trailerInfo.ID = context.obj([PDFHexString.of(bytesToHex(idBytes)), PDFHexString.of(bytesToHex(randomId()))]);

  const ownerEntry = computeOwnerEntry(ownerPassword, userPassword);
  const permissions = permissionsToInt32(options.permissions);
  const fileKey = computeFileKey(userPassword, ownerEntry, permissions, idBytes);
  const userEntry = computeUserEntry(fileKey, idBytes);

  await transformAllIndirectObjects(context, fileKey, aesCbcEncrypt);

  const encryptDict = context.obj({
    Filter: "Standard",
    V: VERSION,
    R: REVISION,
    Length: KEY_LENGTH_BYTES * 8,
    O: PDFHexString.of(bytesToHex(ownerEntry)),
    U: PDFHexString.of(bytesToHex(userEntry)),
    P: permissions,
    CF: { StdCF: { CFM: "AESV2", AuthEvent: "DocOpen", Length: KEY_LENGTH_BYTES } },
    StmF: "StdCF",
    StrF: "StdCF",
  });
  context.trailerInfo.Encrypt = context.register(encryptDict);

  return doc.save({ useObjectStreams: false });
}

export interface DecryptResult {
  bytes: Uint8Array;
  /** Which password unlocked it — informational, since owner/user may both be valid or differ. */
  unlockedVia: "user" | "owner" | "empty";
}

/** Decrypts a document, validating the given password as either the user or owner password, and strips the /Encrypt entry so the result is a plain, unencrypted PDF pdf-lib (and everything built on it) can work with normally. Throws if the password doesn't validate. */
export async function decryptDocument(source: Uint8Array, password: string): Promise<DecryptResult> {
  // updateMetadata defaults to true and runs *inside the constructor*, at
  // load time — meaning it would overwrite the (still-encrypted, ciphertext)
  // /Producer and /ModDate entries with fresh plaintext values before this
  // function ever gets to read or decrypt them. Must be disabled here.
  const doc = await PDFDocument.load(source, { ignoreEncryption: true, updateMetadata: false });
  const context = doc.context;
  const encryptObj = context.lookup(context.trailerInfo.Encrypt, PDFDict);
  if (!encryptObj) throw new Error("This document isn't encrypted.");
  const encryptRef = context.trailerInfo.Encrypt instanceof PDFRef ? context.trailerInfo.Encrypt : undefined;

  const oEntry = encryptObj.lookup(context.obj("O"), PDFHexString).asBytes();
  const uEntry = encryptObj.lookup(context.obj("U"), PDFHexString).asBytes();
  const permissionsInt = encryptObj.lookup(context.obj("P"), PDFNumber).asNumber() | 0;

  const idArray = context.trailerInfo.ID;
  const idFirst = idArray instanceof PDFArray && idArray.size() > 0 ? (idArray.get(0) as PDFHexString | PDFString).asBytes() : new Uint8Array(0);

  const tryUserPassword = (candidate: string): Uint8Array | null => {
    const fileKey = computeFileKey(candidate, oEntry, permissionsInt, idFirst);
    const expectedU = computeUserEntry(fileKey, idFirst);
    // Only the first 16 bytes of /U are meaningful for R3+ (the rest is arbitrary padding).
    const matches = expectedU.subarray(0, 16).every((b, i) => b === uEntry[i]);
    return matches ? fileKey : null;
  };

  let fileKey = tryUserPassword(password);
  let unlockedVia: DecryptResult["unlockedVia"] = password ? "user" : "empty";
  if (!fileKey) {
    // Candidate didn't validate as the user password — try it as the owner
    // password instead: recover the (still-padded) user password /O was
    // built from, then re-derive the file key directly from those padded
    // bytes (computeFileKey only ever needs the padded 32 bytes, so there's
    // no need to turn them back into a text password first).
    const recoveredUserPassword = recoverUserPasswordFromOwnerEntry(oEntry, password);
    const recoveredFileKey = computeFileKeyFromPaddedPassword(recoveredUserPassword, oEntry, permissionsInt, idFirst);
    const expectedU = computeUserEntry(recoveredFileKey, idFirst);
    if (expectedU.subarray(0, 16).every((b, i) => b === uEntry[i])) {
      fileKey = recoveredFileKey;
      unlockedVia = "owner";
    }
  }

  if (!fileKey) throw new Error("Incorrect password.");

  await transformAllIndirectObjects(context, fileKey, aesCbcDecrypt, encryptRef);
  delete context.trailerInfo.Encrypt;

  return { bytes: await doc.save({ useObjectStreams: false }), unlockedVia };
}

/** Same as computeFileKey, but takes an already-32-byte-padded password directly (used when the "password" was recovered from /O as raw padded bytes, not typed by a user as text). */
function computeFileKeyFromPaddedPassword(paddedPassword: Uint8Array, ownerEntry: Uint8Array, permissions: number, idFirst: Uint8Array): Uint8Array {
  const input = concatBytes([paddedPassword.subarray(0, 32), ownerEntry, permissionsBytesLE(permissions), idFirst]);
  let hash = md5(input);
  for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, KEY_LENGTH_BYTES));
  return hash.subarray(0, KEY_LENGTH_BYTES);
}
