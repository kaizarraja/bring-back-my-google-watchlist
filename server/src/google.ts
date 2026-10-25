// Verifies a Google ID token (a JWT signed with one of Google's published RSA keys).
// https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken

export interface GoogleClaims {
	sub: string;
	email: string;
}

const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CLOCK_SKEW_SECONDS = 300;

let cachedKeys: { url: string; keys: JsonWebKey[]; expires: number } | null = null;

async function googleKeys(jwksUrl: string): Promise<JsonWebKey[]> {
	if (cachedKeys && cachedKeys.url === jwksUrl && cachedKeys.expires > Date.now()) return cachedKeys.keys;
	const res = await fetch(jwksUrl);
	if (!res.ok) throw new Error(`could not fetch Google's keys (${res.status})`);
	const { keys } = (await res.json()) as { keys: JsonWebKey[] };
	const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "")?.[1] || 3600);
	cachedKeys = { url: jwksUrl, keys, expires: Date.now() + maxAge * 1000 };
	return keys;
}

function base64UrlDecode(part: string): Uint8Array {
	const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const decodeJson = (part: string) => JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));

export async function verifyGoogleIdToken(
	idToken: string,
	{ clientId, jwksUrl, nonce }: { clientId: string; jwksUrl: string; nonce: string },
): Promise<GoogleClaims> {
	const parts = idToken.split(".");
	if (parts.length !== 3) throw new Error("malformed token");
	const [headerPart, payloadPart, signaturePart] = parts;
	const header = decodeJson(headerPart);
	if (header.alg !== "RS256") throw new Error("unexpected signing algorithm");

	const jwk = (await googleKeys(jwksUrl)).find((k) => (k as { kid?: string }).kid === header.kid);
	if (!jwk) throw new Error("unknown signing key");
	const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
	const valid = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		key,
		base64UrlDecode(signaturePart),
		new TextEncoder().encode(`${headerPart}.${payloadPart}`),
	);
	if (!valid) throw new Error("bad signature");

	const claims = decodeJson(payloadPart);
	const now = Math.floor(Date.now() / 1000);
	if (!ISSUERS.has(claims.iss)) throw new Error("wrong issuer");
	if (claims.aud !== clientId) throw new Error("token was issued for a different app");
	if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < now) throw new Error("token expired");
	if (claims.nonce !== nonce) throw new Error("nonce mismatch");
	if (typeof claims.sub !== "string" || !claims.sub) throw new Error("token has no user id");
	if (claims.email_verified === false) throw new Error("email not verified");
	return { sub: claims.sub, email: String(claims.email || "") };
}
