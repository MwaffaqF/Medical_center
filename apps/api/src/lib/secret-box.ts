/**
 * AES-256-GCM encryption for small secrets stored in the database (TOTP secrets).
 * The key comes from the SECRETS_KEY Worker secret: 32 random bytes, base64.
 *   Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   Set:      npx wrangler secret put SECRETS_KEY --env production
 * Stored format: v1.<iv b64>.<ciphertext b64>
 */
import { ApiError } from "./errors";

async function importKey(keyB64: string | undefined): Promise<CryptoKey> {
  if (!keyB64) throw new ApiError(500, "secrets_key_missing");
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new ApiError(500, "secrets_key_invalid");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(plaintext: string, keyB64: string | undefined): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

export async function open(sealed: string, keyB64: string | undefined): Promise<string> {
  const [version, ivB64, ctB64] = sealed.split(".");
  if (version !== "v1" || !ivB64 || !ctB64) throw new ApiError(500, "sealed_value_invalid");
  const key = await importKey(keyB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) as BufferSource }, key, unb64(ctB64) as BufferSource);
  return new TextDecoder().decode(pt);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
