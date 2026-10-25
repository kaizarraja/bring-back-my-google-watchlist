import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// This file is evaluated by Node when building; only process.env is used from it.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
	worker: {
		name: "my-watchlist-sync",
		compatibilityDate: "2026-10-19",
		entrypoint,
		env: {
			DB: bindings.d1({ name: "my-watchlist" }),
			// The OAuth client ID from Google Cloud ("Sign in with Google"). Public, not a secret.
			GOOGLE_CLIENT_ID: bindings.text(
				process.env.GOOGLE_CLIENT_ID ?? "422245580735-859ric3u6tg6o0bflo10p6n34f8sjvgr.apps.googleusercontent.com",
			),
			// Where Google publishes the keys that sign its ID tokens. Local tests point this at
			// their own key server; never set TEST_JWKS_URL when deploying.
			GOOGLE_JWKS_URL: bindings.text(process.env.TEST_JWKS_URL ?? "https://www.googleapis.com/oauth2/v3/certs"),
		},
	},
});
