// End-to-end tests against a locally running server.
//   1. node test/fake-google.mjs
//   2. GOOGLE_CLIENT_ID=test-client TEST_JWKS_URL=http://127.0.0.1:8790/jwks npx cf dev
//   3. API=http://localhost:5173 node --test test/sync.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const API = process.env.API || "http://localhost:5173";
const CLIENT_ID = "test-client";
const now = Math.floor(Date.now() / 1000);

async function googleToken(claims) {
	const res = await fetch("http://127.0.0.1:8790/token", { method: "POST", body: JSON.stringify(claims) });
	return res.text();
}

async function post(path, body, token) {
	const res = await fetch(API + path, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: await res.json() };
}

async function signIn(sub, overrides = {}) {
	const nonce = "n-" + Math.random();
	const idToken = await googleToken({
		iss: "https://accounts.google.com", aud: CLIENT_ID, sub, email: `${sub}@example.com`,
		email_verified: true, iat: now, exp: now + 3600, nonce, ...overrides,
	});
	return post("/v1/auth/google", { idToken, nonce: overrides.nonce === undefined ? nonce : "n-expected" });
}

// Pulls every page after `since`.
async function pullAll(token, since = 0) {
	const items = [];
	for (;;) {
		const { body } = await post("/v1/sync", { since, changes: [] }, token);
		items.push(...body.items);
		since = body.cursor;
		if (!body.more) return { items, cursor: since };
	}
}

const run = Date.now();
const userA = `user-a-${run}`;
const userB = `user-b-${run}`;

test("rejects forged, foreign and expired Google tokens", async () => {
	assert.equal((await signIn(userA, { aud: "someone-elses-app" })).status, 401);
	assert.equal((await signIn(userA, { exp: now - 3600 })).status, 401);
	assert.equal((await signIn(userA, { iss: "https://evil.example" })).status, 401);
	assert.equal((await signIn(userA, { nonce: "different" })).status, 401);
	const good = await signIn(userA);
	assert.equal(good.status, 200);
	assert.ok(good.body.token);
	assert.equal(good.body.email, `${userA}@example.com`);
	const idToken = await googleToken({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: userA, exp: now + 3600, nonce: "n" });
	const tampered = idToken.slice(0, -4) + (idToken.endsWith("AAAA") ? "BBBB" : "AAAA");
	assert.equal((await post("/v1/auth/google", { idToken: tampered, nonce: "n" })).status, 401);
});

test("sync needs a valid session", async () => {
	assert.equal((await post("/v1/sync", { since: 0, changes: [] })).status, 401);
	assert.equal((await post("/v1/sync", { since: 0, changes: [] }, "made-up-token")).status, 401);
});

test("two devices converge, with last-writer-wins state and fill-only details", async () => {
	const laptop = (await signIn(userA)).body.token;
	const desktop = (await signIn(userA)).body.token;
	assert.ok(laptop && desktop && laptop !== desktop);

	// Laptop adds a title without details.
	await post("/v1/sync", { since: 0, changes: [{ id: "/m/024lt6", title: "Rushmore", addedAt: 1000, updatedAt: 1000 }] }, laptop);
	let { items, cursor } = await pullAll(desktop);
	assert.deepEqual(items.map((i) => [i.id, i.title, i.year, i.deleted]), [["/m/024lt6", "Rushmore", null, false]]);

	// Desktop marks it watched (later), laptop meanwhile fills in details with its stale, older state.
	await post("/v1/sync", { since: cursor, changes: [{ id: "/m/024lt6", title: "Rushmore", addedAt: 1000, watchedAt: 3000, updatedAt: 3000 }] }, desktop);
	await post("/v1/sync", { since: 0, changes: [{ id: "/m/024lt6", title: "Rushmore", addedAt: 1000, watchedAt: null, year: 1998, kind: "movie", poster: "data:image/jpeg;base64,AAA", updatedAt: 1000 }] }, laptop);
	({ items } = await pullAll(laptop));
	const r = items.find((i) => i.id === "/m/024lt6");
	assert.equal(r.watchedAt, 3000, "watched state survives a stale details update");
	assert.equal(r.year, 1998);
	assert.equal(r.kind, "movie");
	assert.equal(r.poster, "data:image/jpeg;base64,AAA");

	// An older delete loses; a newer one wins and drops the poster.
	await post("/v1/sync", { since: 0, changes: [{ id: "/m/024lt6", title: "Rushmore", deleted: true, updatedAt: 2000 }] }, laptop);
	assert.equal((await pullAll(laptop)).items.find((i) => i.id === "/m/024lt6").deleted, false);
	await post("/v1/sync", { since: 0, changes: [{ id: "/m/024lt6", title: "Rushmore", deleted: true, updatedAt: 4000 }] }, laptop);
	const gone = (await pullAll(desktop)).items.find((i) => i.id === "/m/024lt6");
	assert.equal(gone.deleted, true);
	assert.equal(gone.poster, null);

	// Re-adding after a delete brings it back.
	await post("/v1/sync", { since: 0, changes: [{ id: "/m/024lt6", title: "Rushmore", addedAt: 5000, updatedAt: 5000 }] }, desktop);
	assert.equal((await pullAll(laptop)).items.find((i) => i.id === "/m/024lt6").deleted, false);
});

test("pulling after a cursor only returns newer changes, across pages", async () => {
	const token = (await signIn(userA)).body.token;
	const { cursor } = await pullAll(token);
	const changes = Array.from({ length: 250 }, (_, i) => ({ id: `/g/test${i}`, title: `Title ${i}`, addedAt: 10_000 + i, updatedAt: 10_000 + i }));
	await post("/v1/sync", { since: cursor, changes }, token);
	const after = await pullAll(token, cursor);
	assert.equal(after.items.length, 250);
	assert.equal(new Set(after.items.map((i) => i.id)).size, 250);
	assert.equal((await pullAll(token, after.cursor)).items.length, 0);
	// Re-sending identical changes doesn't count as new.
	await post("/v1/sync", { since: after.cursor, changes }, token);
	assert.equal((await pullAll(token, after.cursor)).items.length, 0);
});

test("users only see their own lists, and sign-out ends the session", async () => {
	const a = (await signIn(userA)).body.token;
	const b = (await signIn(userB)).body.token;
	await post("/v1/sync", { since: 0, changes: [{ id: "/m/b-only", title: "B's film", updatedAt: 1 }] }, b);
	assert.ok(!(await pullAll(a)).items.some((i) => i.id === "/m/b-only"));
	assert.equal((await pullAll(b)).items.length, 1);
	await post("/v1/signout", {}, b);
	assert.equal((await post("/v1/sync", { since: 0, changes: [] }, b)).status, 401);
});

test("deleting an account removes the list and every session", async () => {
	const user = `user-delete-${run}`;
	const one = (await signIn(user)).body.token;
	const two = (await signIn(user)).body.token;
	await post("/v1/sync", { since: 0, changes: [{ id: "/m/x", title: "X", updatedAt: 1 }] }, one);
	assert.equal((await post("/v1/account/delete", {}, one)).status, 200);
	assert.equal((await post("/v1/sync", { since: 0, changes: [] }, two)).status, 401);
	const again = (await signIn(user)).body.token;
	assert.equal((await pullAll(again)).items.length, 0, "signing in again starts with an empty list");
});
