/**
 * Shared types. This file has NO dependency on the `obsidian` module and no
 * side effects — every type here is safe to import from a plain Node/vitest
 * test.
 *
 * Wire shapes below mirror the server contract EXACTLY (read before editing):
 *   - api/routers/note_sync.py — ObsidianRedeemBody, ObsidianIngestBody,
 *     ObsidianNoteItem, OBSIDIAN_INGEST_NOTES_FIELD ("notes" is pinned and
 *     required — do not rename the `notes` key on IngestRequestBody).
 *   - api/services/journal_two/note_connectors/obsidian_staging.py —
 *     ingest_batch's return shape (written/skipped/manifestReplaced/tooLarge).
 */

/** One note as pushed to `POST /obsidian/ingest`. All four fields are
 * REQUIRED by the server (`ObsidianNoteItem` has no optional/defaulted
 * field) — never omit one to "save space". */
export interface NoteInput {
	vault_path: string;
	content_hash: string;
	body_md: string;
	/** An honest, plugin-read filesystem mtime, ISO-8601. The server does
	 * NOT use this as its sync cursor (it cursors on its own server-assigned
	 * `received_at` instead) — see sync-manager.ts's module docstring. Send
	 * it honestly anyway; it is still used for display/conflict purposes. */
	updated_at: string;
}

/** Body of `POST /obsidian/ingest`. `consent` is always `true` here — the
 * member already gave consent in the web dashboard's connect modal BEFORE a
 * connect code could even be minted (`ConnectBody.consent` /
 * `ObsidianConnectModal.jsx`'s required checkbox); a device token cannot
 * exist without that having happened, so there is no second consent surface
 * for this plugin to present. */
export interface IngestRequestBody {
	consent: true;
	notes: NoteInput[];
	/** The vault's COMPLETE current path list. Only ever sent together with
	 * `final: true`; never send an EMPTY array here (the server treats
	 * `manifest: [], final: true` as an explicit — and refused — claim that
	 * the vault has zero files; see obsidian_staging.py's I4 finding). Omit
	 * the field entirely (undefined) rather than sending `[]`. */
	manifest?: string[];
	final?: boolean;
}

/** Response body of a successful `POST /obsidian/ingest` call. */
export interface IngestResponse {
	written: number;
	skipped: number;
	manifestReplaced: boolean;
	/** vault_paths that were NOT staged because the converted note would
	 * exceed the server's storage ceiling. These paths are NOT "known" to
	 * the server (never written to j2_obsidian_staging) — never name one of
	 * these in a later `manifest` unless it is re-pushed successfully. */
	tooLarge: string[];
}

/** Response body of a successful `POST /obsidian/redeem` call. */
export interface RedeemResponse {
	deviceId: string;
	token: string;
	vaultId: string;
	source: { id: string; provider: string; remoteId: string };
}

/** One markdown file as read off disk, before hashing. */
export interface ScannedFile {
	path: string;
	/** sha256 hex of the CURRENT file content. */
	hash: string;
	/** ISO-8601, derived from the file's own mtime. */
	updatedAt: string;
	body: string;
}

/** Everything the plugin remembers, per vault_path, between sync runs. */
export interface FileState {
	/** The content hash last seen for this path — successful OR too-large.
	 * Used to detect "nothing changed, don't re-push" (`hash` matches) vs.
	 * "the member edited this since the last too-large verdict, retry it"
	 * (`hash` differs while `tooLarge` is true). */
	hash: string;
	/** ISO-8601 timestamp of the last time this path was ACTUALLY staged
	 * (written, not skipped/too-large) server-side. */
	syncedAt: string;
	/** True when the server's most recent verdict for THIS hash was
	 * `tooLarge` — the note was never stored. See sync-plan.ts's module
	 * docstring for why a too-large note is excluded from both future
	 * pushes (until its hash changes) and the manifest (it was never
	 * actually staged, so naming it would be dishonest). */
	tooLarge?: boolean;
}

/** Everything persisted via Obsidian's `Plugin.loadData()`/`saveData()`
 * (one JSON blob at `.obsidian/plugins/uct-notebook-sync/data.json`). */
export interface PluginData {
	serverUrl: string;
	/** A random, plugin-generated identifier for THIS vault, minted once on
	 * first install and never regenerated — reconnecting (a plugin
	 * reinstall, a lost token) must reuse the SAME vaultId so the server's
	 * `UNIQUE(user_id, vault_id)` constraint ROTATES the existing device row
	 * instead of creating a second, orphaned one. */
	vaultId: string;
	deviceToken: string | null;
	/** The device label the dashboard shows for this connection (defaults
	 * to the Obsidian vault's own name at connect time). */
	connectedLabel: string | null;
	connectedAt: string | null;
	lastSyncAt: string | null;
	lastSyncError: string | null;
	/** Per-vault_path sync bookkeeping. Entries are garbage-collected the
	 * moment a path disappears from a vault scan (see applySyncResult). */
	files: Record<string, FileState>;
}

export const DEFAULT_SERVER_URL = 'https://uctintelligence.com';

export function defaultPluginData(vaultId: string): PluginData {
	return {
		serverUrl: DEFAULT_SERVER_URL,
		vaultId,
		deviceToken: null,
		connectedLabel: null,
		connectedAt: null,
		lastSyncAt: null,
		lastSyncError: null,
		files: {},
	};
}
