/**
 * Orchestrates one sync run: scan -> plan -> batch -> push -> manifest ->
 * persist. Depends only on the small `Transport` and `VaultSource`
 * interfaces (both injected), never on the `obsidian` module directly — the
 * whole class is unit-testable with stub implementations of both and no
 * network, no vault, no live server.
 *
 * ── The two-phase push, and why ─────────────────────────────────────────
 *
 * Phase 1 pushes zero or more `{notes: [...], final: false}` batches — pure
 * content, no manifest. Phase 2, run only after every phase-1 batch has
 * succeeded, sends exactly ONE `{notes: [], manifest: [...], final: true}`
 * call. Splitting it this way (rather than attaching the manifest to the
 * last content batch) means the manifest never has to "hope" a same-call
 * note landed — by the time phase 2 runs, everything phase 1 pushed is
 * already durably staged, so referencing any of those paths satisfies the
 * server's own manifest-integrity check
 * (`obsidian_staging.ingest_batch`'s I3 guard: a manifest path must have
 * been staged EITHER in this call OR an earlier one — see that module's own
 * docstring and its "staged in an earlier batch" test).
 *
 * ── What stops a note the server just rejected from re-appearing next run ──
 *
 * `finalizeManifest` strips a path THIS run's ingest calls reported
 * `tooLarge` before phase 2 ever sends it — but ONLY when that path has
 * NEVER been successfully staged before (`plan.neverStagedPaths`). A path
 * that grew past the ceiling AFTER syncing fine once is left in the
 * manifest regardless, so growing one note never makes an unrelated,
 * already-imported note look deleted (see sync-plan.ts's own docstring for
 * the full reasoning — this is the subtler half of the "never dishonestly
 * name an un-staged path" rule, not a contradiction of it).
 *
 * ── Auth failure handling (gotcha #7 — never loop on a dead token) ───────
 *
 * A 401 from ANY ingest/redeem call clears the stored `deviceToken` (never
 * `vaultId` — that must survive so a fresh redeem still ROTATES the same
 * device row rather than minting an orphaned second one) and reports
 * `needsReconnect: true`. The caller (main.ts / the settings tab) is
 * responsible for telling the member to reconnect; this class never retries
 * a 401 itself and never schedules a background retry loop against a token
 * it just learned is dead.
 */
import { buildBatches, DEFAULT_BATCH_OPTIONS, type BatchOptions } from './batching';
import { sha256Hex } from './hashing';
import { applySyncResult, finalizeManifest, planSync } from './sync-plan';
import type { PluginData, ScannedFile } from './types';
import type { Transport } from './api-client';

export interface VaultFileRef {
	path: string;
	/** Epoch milliseconds — informational only, feeds `updated_at`. */
	mtime: number;
}

/** What `sync-manager.ts` needs from a vault — deliberately narrow so a test
 * fake can implement it in a few lines with no `obsidian` import at all. */
export interface VaultSource {
	listMarkdownFiles(): Promise<VaultFileRef[]>;
	readFile(path: string): Promise<string>;
}

export interface SyncManagerDeps {
	transport: Transport;
	vaultSource: VaultSource;
	getData: () => PluginData;
	saveData: (data: PluginData) => Promise<void>;
	/** Injectable clock for deterministic tests. */
	now?: () => string;
	batchOptions?: BatchOptions;
}

export interface SyncSummary {
	ok: boolean;
	scanned: number;
	pushed: number;
	skippedUnchanged: number;
	tooLarge: string[];
	skippedTooLargeUnchanged: string[];
	deletedLocally: string[];
	manifestSent: boolean;
	needsReconnect: boolean;
	error?: string;
}

function isoNow(): string {
	return new Date().toISOString();
}

export class SyncManager {
	constructor(private readonly deps: SyncManagerDeps) {}

	async runSync(): Promise<SyncSummary> {
		const data = this.deps.getData();
		const empty = (overrides: Partial<SyncSummary>): SyncSummary => ({
			ok: false,
			scanned: 0,
			pushed: 0,
			skippedUnchanged: 0,
			tooLarge: [],
			skippedTooLargeUnchanged: [],
			deletedLocally: [],
			manifestSent: false,
			needsReconnect: false,
			...overrides,
		});

		if (!data.deviceToken) {
			return empty({
				needsReconnect: true,
				error: 'Not connected to UCT Notebook. Paste a connect code in Settings first.',
			});
		}
		// Captured into a local so TypeScript's narrowing (and our own
		// reasoning) survives the `await`s below — `data.deviceToken` itself
		// stays `string | null` since `fail()` may null it out mid-run.
		const deviceToken: string = data.deviceToken;

		const now = (this.deps.now ?? isoNow)();
		const files = await this.deps.vaultSource.listMarkdownFiles();
		const scanned: ScannedFile[] = [];
		for (const f of files) {
			const body = await this.deps.vaultSource.readFile(f.path);
			scanned.push({
				path: f.path,
				hash: sha256Hex(body),
				updatedAt: new Date(f.mtime).toISOString(),
				body,
			});
		}

		const plan = planSync(scanned, data.files);
		const batches = buildBatches(plan.toPush, this.deps.batchOptions ?? DEFAULT_BATCH_OPTIONS);

		const tooLargeThisRun = new Set<string>();
		let pushed = 0;

		// Persists `lastSyncError` (and clears a dead token on a 401) BEFORE
		// returning — a member reopening Settings after Obsidian restarts
		// must still see why the last run failed, not just a silently-stale
		// `lastSyncAt`.
		const fail = async (message: string, authExpired: boolean): Promise<SyncSummary> => {
			if (authExpired) data.deviceToken = null;
			data.lastSyncError = message;
			await this.deps.saveData(data);
			return empty({
				scanned: scanned.length,
				pushed,
				skippedUnchanged: scanned.length - plan.toPush.length,
				tooLarge: [...tooLargeThisRun],
				skippedTooLargeUnchanged: plan.skippedTooLarge,
				deletedLocally: plan.removedLocally,
				needsReconnect: authExpired,
				error: message,
			});
		};

		for (const batch of batches) {
			const outcome = await this.deps.transport.ingest({
				serverUrl: data.serverUrl,
				token: deviceToken,
				notes: batch,
				final: false,
			});
			if (!outcome.ok) return fail(outcome.message, outcome.authExpired);
			pushed += outcome.response.written;
			for (const p of outcome.response.tooLarge) tooLargeThisRun.add(p);
		}

		const finalManifest = finalizeManifest(plan.manifestPaths, tooLargeThisRun, plan.neverStagedPaths);
		let manifestSent = false;
		if (finalManifest.length > 0) {
			const outcome = await this.deps.transport.ingest({
				serverUrl: data.serverUrl,
				token: deviceToken,
				notes: [],
				manifest: finalManifest,
				final: true,
			});
			if (!outcome.ok) return fail(outcome.message, outcome.authExpired);
			manifestSent = outcome.response.manifestReplaced;
		}
		// An empty `finalManifest` (nothing known-good survives this run —
		// e.g. a brand-new vault whose only file was just reported
		// tooLarge, or a genuinely empty vault) deliberately sends NOTHING
		// for phase 2 — see finalizeManifest's own docstring: an empty
		// `manifest: []` is a refused claim server-side, not a harmless
		// no-op, so silence is the only safe choice here.

		const pushedPaths = new Set(plan.toPush.map((n) => n.vault_path));
		data.files = applySyncResult(data.files, scanned, pushedPaths, tooLargeThisRun, now);
		data.lastSyncAt = now;
		data.lastSyncError = null;
		await this.deps.saveData(data);

		return {
			ok: true,
			scanned: scanned.length,
			pushed,
			skippedUnchanged: scanned.length - plan.toPush.length,
			tooLarge: [...tooLargeThisRun],
			skippedTooLargeUnchanged: plan.skippedTooLarge,
			deletedLocally: plan.removedLocally,
			manifestSent,
			needsReconnect: false,
		};
	}
}
