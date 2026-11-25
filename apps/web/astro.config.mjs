import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Public website. Every page lives under /ar/ or /en/; "/" redirects (see src/pages/index.astro).
export default defineConfig({
  site: "https://example.com", // replace with the center's domain
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }), // Cloudflare Images is a paid product
  session: false, // no Astro sessions: avoids a KV namespace; patients don't log in
  vite: { plugins: [tailwindcss()] },
});
