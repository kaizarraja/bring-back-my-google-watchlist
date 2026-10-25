import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [cloudflare()],
	// Let the Worker answer CORS preflights itself in local dev, as it does when deployed;
	// Vite's own CORS handling only allows localhost pages, not the extension.
	server: { cors: false },
});
