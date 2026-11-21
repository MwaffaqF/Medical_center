/** Random URL-safe token (256 bits by default). */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short human-friendly reference code, e.g. "K7M-4QX". Skips 0/O/1/I to avoid confusion. */
export function referenceCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 chars: no modulo bias for bytes
  const buf = crypto.getRandomValues(new Uint8Array(6));
  const chars = [...buf].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 3).join("")}-${chars.slice(3).join("")}`;
}
