// Storage for users, sessions and watchlist items, in D1 (SQLite).
//
// Merge rules when two devices change the same title:
// - The title's state (name, when added, when watched, deleted) goes to whichever change
//   has the later updatedAt.
// - Details (year, movie/TV, poster) only ever get filled in, never cleared, so a device
//   that looked up a poster can send it without overwriting anything else.
// Every write that changes a row gives it the user's next sequence number; a device asks
// for "everything after sequence N" to catch up.

import { env } from "cloudflare:workers";

export interface Change {
	id: string;
	title: string;
	year?: number | null;
	kind?: "movie" | "tv" | null;
	addedAt?: number;
	watchedAt?: number | null;
	poster?: string | null;
	deleted?: boolean;
	updatedAt: number;
}

const MAX_CHANGES = 500;
const PAGE_SIZE = 100;
const MAX_POSTER_CHARS = 200_000;

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS sessions (
		token_hash TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS items (
		user_id TEXT NOT NULL,
		id TEXT NOT NULL,
		title TEXT NOT NULL,
		year INTEGER,
		kind TEXT,
		added_at INTEGER NOT NULL,
		watched_at INTEGER,
		poster TEXT,
		deleted INTEGER NOT NULL DEFAULT 0,
		updated_at INTEGER NOT NULL,
		seq INTEGER NOT NULL,
		PRIMARY KEY (user_id, id)
	)`,
	`CREATE INDEX IF NOT EXISTS items_by_seq ON items (user_id, seq)`,
];

let schemaReady = false;

// Creates the tables the first time this server instance handles a request.
export async function ensureSchema() {
	if (schemaReady) return;
	await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
	schemaReady = true;
}

const UPSERT = `
	INSERT INTO items (user_id, id, title, year, kind, added_at, watched_at, poster, deleted, updated_at, seq)
	VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, (SELECT COALESCE(MAX(seq), 0) + 1 FROM items WHERE user_id = ?1))
	ON CONFLICT (user_id, id) DO UPDATE SET
		title      = CASE WHEN excluded.updated_at > items.updated_at THEN excluded.title      ELSE items.title      END,
		added_at   = CASE WHEN excluded.updated_at > items.updated_at THEN excluded.added_at   ELSE items.added_at   END,
		watched_at = CASE WHEN excluded.updated_at > items.updated_at THEN excluded.watched_at ELSE items.watched_at END,
		deleted    = CASE WHEN excluded.updated_at > items.updated_at THEN excluded.deleted    ELSE items.deleted    END,
		year       = COALESCE(items.year, excluded.year),
		kind       = COALESCE(items.kind, excluded.kind),
		poster     = CASE WHEN (CASE WHEN excluded.updated_at > items.updated_at THEN excluded.deleted ELSE items.deleted END) = 1
		                  THEN NULL ELSE COALESCE(items.poster, excluded.poster) END,
		updated_at = MAX(items.updated_at, excluded.updated_at),
		seq        = excluded.seq
	WHERE excluded.updated_at > items.updated_at
		OR (items.year IS NULL AND excluded.year IS NOT NULL)
		OR (items.kind IS NULL AND excluded.kind IS NOT NULL)
		OR (items.poster IS NULL AND excluded.poster IS NOT NULL AND items.deleted = 0)
`;

function clean(change: Change) {
	const id = typeof change.id === "string" ? change.id.slice(0, 200) : "";
	const title = typeof change.title === "string" ? change.title.slice(0, 300) : "";
	const updatedAt = Number(change.updatedAt);
	if (!id || !title || !Number.isFinite(updatedAt)) return null;
	const year = Number.isInteger(change.year) && change.year! > 1800 && change.year! < 2200 ? change.year! : null;
	const kind = change.kind === "movie" || change.kind === "tv" ? change.kind : null;
	const poster = typeof change.poster === "string" && change.poster.length <= MAX_POSTER_CHARS ? change.poster : null;
	return {
		id,
		title,
		year,
		kind,
		addedAt: Number(change.addedAt) || updatedAt,
		watchedAt: Number(change.watchedAt) || null,
		poster: change.deleted ? null : poster,
		deleted: change.deleted ? 1 : 0,
		updatedAt,
	};
}

export async function applyChanges(userId: string, changes: Change[]) {
	const rows = changes.slice(0, MAX_CHANGES).map(clean).filter((c) => c !== null);
	if (!rows.length) return;
	await env.DB.batch(
		rows.map((c) =>
			env.DB.prepare(UPSERT).bind(userId, c.id, c.title, c.year, c.kind, c.addedAt, c.watchedAt, c.poster, c.deleted, c.updatedAt),
		),
	);
}

interface ItemRow {
	id: string;
	title: string;
	year: number | null;
	kind: string | null;
	added_at: number;
	watched_at: number | null;
	poster: string | null;
	deleted: number;
	updated_at: number;
	seq: number;
}

// One page of items changed after `since`, oldest change first.
export async function changesSince(userId: string, since: number) {
	const { results } = await env.DB.prepare(
		"SELECT * FROM items WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?",
	)
		.bind(userId, since, PAGE_SIZE + 1)
		.all<ItemRow>();
	const page = results.slice(0, PAGE_SIZE);
	return {
		items: page.map((r) => ({
			id: r.id,
			title: r.title,
			year: r.year,
			kind: r.kind,
			addedAt: r.added_at,
			watchedAt: r.watched_at,
			poster: r.poster,
			deleted: r.deleted === 1,
			updatedAt: r.updated_at,
		})),
		cursor: page.length ? page[page.length - 1].seq : since,
		more: results.length > PAGE_SIZE,
	};
}
