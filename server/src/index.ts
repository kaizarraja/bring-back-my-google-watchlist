// My Watchlist sync server.
//
//   POST /v1/auth/google  { idToken, nonce }        → { token, email }
//   POST /v1/sync         { since, changes: [...] }  → { items: [...], cursor, more }
//   POST /v1/signout
//   POST /v1/account/delete   deletes the user's list, sessions and account record
//
// The extension signs in with Google, swaps the Google ID token for its own session
// token, then calls /v1/sync with that token: it sends its unsent changes and gets back
// everything that changed on the server since its last sync.

import { env } from "cloudflare:workers";
import { verifyGoogleIdToken } from "./google.ts";
import { applyChanges, changesSince, ensureSchema, type Change } from "./db.ts";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type",
	"Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

class HttpError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

async function readJson(request: Request): Promise<any> {
	const length = Number(request.headers.get("Content-Length") || 0);
	if (length > MAX_BODY_BYTES) throw new HttpError(413, "Request too large");
	try {
		return await request.json();
	} catch {
		throw new HttpError(400, "Body must be JSON");
	}
}

async function sha256Hex(text: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Returns the signed-in user's id, from the "Authorization: Bearer <token>" header.
async function requireUser(request: Request): Promise<string> {
	const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
	if (!token) throw new HttpError(401, "Not signed in");
	const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ?")
		.bind(await sha256Hex(token))
		.first<{ user_id: string }>();
	if (!row) throw new HttpError(401, "Session expired; sign in again");
	return row.user_id;
}

async function signIn(request: Request) {
	const { idToken, nonce } = await readJson(request);
	if (typeof idToken !== "string" || typeof nonce !== "string") throw new HttpError(400, "idToken and nonce are required");
	let claims;
	try {
		claims = await verifyGoogleIdToken(idToken, { clientId: env.GOOGLE_CLIENT_ID, jwksUrl: env.GOOGLE_JWKS_URL, nonce });
	} catch (err) {
		throw new HttpError(401, `Google sign-in could not be verified: ${(err as Error).message}`);
	}
	const token = newToken();
	const now = Date.now();
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET email = excluded.email",
		).bind(claims.sub, claims.email, now),
		env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)").bind(await sha256Hex(token), claims.sub, now),
	]);
	return json({ token, email: claims.email });
}

async function sync(request: Request) {
	const userId = await requireUser(request);
	const body = await readJson(request);
	const since = Number.isSafeInteger(body.since) && body.since >= 0 ? body.since : 0;
	const changes: Change[] = Array.isArray(body.changes) ? body.changes : [];
	await applyChanges(userId, changes);
	return json(await changesSince(userId, since));
}

async function signOut(request: Request) {
	const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
	if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
	return json({ ok: true });
}

async function deleteAccount(request: Request) {
	const userId = await requireUser(request);
	await env.DB.batch([
		env.DB.prepare("DELETE FROM items WHERE user_id = ?").bind(userId),
		env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
		env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
	]);
	return json({ ok: true });
}

export default {
	async fetch(request) {
		if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
		const { pathname } = new URL(request.url);
		try {
			if (request.method === "GET" && pathname === "/") return json({ ok: true, service: "my-watchlist-sync" });
			if (request.method !== "POST") throw new HttpError(405, "Use POST");
			await ensureSchema();
			if (pathname === "/v1/auth/google") return await signIn(request);
			if (pathname === "/v1/sync") return await sync(request);
			if (pathname === "/v1/signout") return await signOut(request);
			if (pathname === "/v1/account/delete") return await deleteAccount(request);
			throw new HttpError(404, "Not found");
		} catch (err) {
			if (err instanceof HttpError) return json({ error: err.message }, err.status);
			console.error(err);
			return json({ error: "Server error" }, 500);
		}
	},
} satisfies ExportedHandler;
