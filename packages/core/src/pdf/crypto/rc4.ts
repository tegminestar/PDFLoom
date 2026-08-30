// RC4 stream cipher — required by the PDF Standard Security Handler for
// computing the /O and /U dictionary entries (ISO 32000-1 Algorithms
// 3.3/3.5), which use RC4-based key wrapping even in revisions (R4) whose
// actual string/stream content encryption uses AES instead. Encryption and
// decryption are the same operation for a stream cipher.
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;

  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i]! + key[i % key.length]!) & 0xff;
    const tmp = S[i]!;
    S[i] = S[j]!;
    S[j] = tmp;
  }

  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]!) & 0xff;
    const tmp = S[i]!;
    S[i] = S[j]!;
    S[j] = tmp;
    const k = S[(S[i]! + S[j]!) & 0xff]!;
    out[n] = data[n]! ^ k;
  }
  return out;
}
