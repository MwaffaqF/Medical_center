/// <reference types="astro/client" />

// Minimal typing for the Workers runtime module (full workers-types clash with DOM types in pages).
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
