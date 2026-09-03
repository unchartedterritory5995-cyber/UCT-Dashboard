/**
 * Pure decision logic for one sync run: which notes actually need to be
 * pushed, which paths belong in the final manifest, and how to update the
 * plugin's local per-path bookkeeping afterward. No I/O, no `obsidian`
 * import — everything here is a plain function over plain data so it can be
 * unit-tested without a live vault or a live server.
 *
 * ── Why a too-large note needs special handling (read before touching this) ──
 *
 * `ingest_batch` (server) NEVER stores a note whose markdown clears the
 * per-batch door but whose converted body would exceed the storage ceiling —
 * it reports the path back in `tooLarge` and moves on. That path's row in
 * `j2_obsidian_staging` is therefore left EXACTLY as it was (an
 * `INSERT OR REPLACE` that never runs) — it might hold nothing at all (a
 * brand-new file that was too large from the start), or it might hold an
 * OLDER, smaller version that synced fine before an edit pushed it over the
 * ceiling. Two consequences this module exists to honor:
 *
 *   1. Re-pushing that note's full body every sync forever is pointless (it
 *      will keep failing on an unchanged hash) — a too-large path is
 *      excluded from `toPush` on every subsequent run UNTIL its local
 *      content hash changes (the member edited it — maybe shortened it),
 *      at which point it is retried exactly once.
 *   2. A too-large path that has NEVER been successfully staged must never
 *      appear in a `final` manifest — that would be this plugin asserting a
 *      fact the server cannot verify (`obsidian_staging.ingest_batch`'s own
 *      I3 guard checks a manifest entry against every vault_path this vault
 *      has ever staged BODY CONTENT for).
 *
 *      ⛔ BUT a path that WAS staged successfully before growing too large
 *      is different: the server still holds that OLDER row, so naming it in
 *      the manifest is still honest, and — more importantly — OMITTING it
 *      would make the server's delete detection (a 2-consecutive-miss
 *      streak, `engine.py::_run_delete_detection`) eventually tag the
 *      member's EXISTING, already-imported Notebook note `source-deleted`,
 *      even though the vault file still exists and an older synced copy is
 *      still sitting there. A member growing one daily-notes file past the
 *      ceiling must not watch an unrelated, already-synced note vanish from
 *      their Notebook. `FileState.syncedAt` (non-empty exactly when a path
 *      has EVER been staged successfully) is what distinguishes the two
 *      cases — see `neverStagedPaths` below.
 *
 * ── Manifest completeness vs. deletions ──────────────────────────────────
 *
 * A path that disappears from the vault (the member deleted or renamed the
 * file) is simply left out of the next manifest — that is precisely how the
 * server's delete detection learns a note was removed. This module never
 * sends an explicit "delete" instruction; omission IS the signal, which is
 * also why an EMPTY final manifest is refused server-side (see the
 * module-level warning on `finalizeManifest`) — omitting EVERYTHING would
 * look identical to "the whole vault is gone."
 */
import type { FileState, NoteInput, ScannedFile } from './types';

export interface SyncPlan {
	/** Notes whose content actually needs to reach the server this run. */
	toPush: NoteInput[];
	/** Every path this run believes is (or will be, pending this run's
	 * outcome) genuinely staged server-side — the provisional manifest.
	 * MUST be passed through `finalizeManifest` (with this run's actual
	 * `tooLarge` results and `neverStagedPaths` below) before being sent as
	 * `manifest`. */
	manifestPaths: string[];
	/** Previously-too-large paths being retried this run (their local hash
	 * changed since the last too-large verdict). Informational — already
	 * included in `toPush`. */
	retryingTooLarge: string[];
	/** Previously-too-large paths NOT retried this run (hash unchanged) —
	 * excluded from `toPush`. Surfaced to the member as an ongoing, known
	 * limitation, not a fresh failure. May still appear in `manifestPaths`
	 * if an older version was staged successfully before it grew too large. */
	skippedTooLarge: string[];
	/** Paths present in the prior state but absent from this run's scan —
	 * the vault-local view of "these look deleted or renamed." */
	removedLocally: string[];
	/** The subset of `toPush` paths that have NEVER been successfully
	 * staged before (no prior state, or a prior state with an empty
	 * `syncedAt`). `finalizeManifest` uses this to decide whether a fresh
	 * `tooLarge` verdict this run should also strike the path from the
	 * manifest (never staged -> strike it) or leave it alone (an older
	 * staged copy already justifies keeping it listed). */
	neverStagedPaths: Set<string>;
}

function toNoteInput(file: ScannedFile): NoteInput {
	return {
		vault_path: file.path,
		content_hash: file.hash,
		body_md: file.body,
		updated_at: file.updatedAt,
	};
}

export function planSync(scanned: ScannedFile[], priorFiles: Record<string, FileState>): SyncPlan {
	const scannedPaths = new Set(scanned.map((f) => f.path));
	const toPush: NoteInput[] = [];
	const manifestPaths: string[] = [];
	const retryingTooLarge: string[] = [];
	const skippedTooLarge: string[] = [];
	const neverStagedPaths = new Set<string>();

	for (const file of scanned) {
		const prior = priorFiles[file.path];
		const hashChanged = !prior || prior.hash !== file.hash;
		const previouslyStaged = Boolean(prior?.syncedAt);

		if (prior?.tooLarge && !hashChanged) {
			// Still too large, nothing new to try — never re-push. Still
			// manifested if an OLDER version is genuinely staged server-side
			// (see the module docstring's "BUT" paragraph); otherwise this
			// path has never existed server-side and must stay unlisted.
			skippedTooLarge.push(file.path);
			if (previouslyStaged) manifestPaths.push(file.path);
			continue;
		}
		if (prior?.tooLarge && hashChanged) {
			// The member changed this file since the last too-large verdict
			// — worth one more attempt.
			retryingTooLarge.push(file.path);
		}
		if (hashChanged) {
			toPush.push(toNoteInput(file));
			if (!previouslyStaged) neverStagedPaths.add(file.path);
		}
		// Provisionally "known good": either it was already staged
		// successfully before (prior exists, not tooLarge), or it is being
		// pushed fresh this run. `finalizeManifest` below strips a
		// NEVER-staged path back out if THIS run's push reports it tooLarge
		// after all — a path with prior successful staging is left alone
		// even if this attempt fails too (see module docstring).
		manifestPaths.push(file.path);
	}

	const removedLocally = Object.keys(priorFiles).filter((p) => !scannedPaths.has(p));

	return { toPush, manifestPaths, retryingTooLarge, skippedTooLarge, removedLocally, neverStagedPaths };
}

/**
 * Removes a path from a provisional manifest ONLY when THIS run's ingest
 * calls reported it `tooLarge` AND it has never been successfully staged
 * before (`neverStagedPaths`) — a path with an older, genuinely-staged
 * version survives even a fresh too-large verdict, so growing one note
 * past the ceiling can never make an UNRELATED, already-synced note look
 * deleted (see sync-plan.ts's module docstring).
 *
 * ⛔ If the result is EMPTY, do not send `manifest: []` — the server refuses
 * an empty `final` manifest outright (`obsidian_staging.py` I4: "an empty
 * manifest cannot legitimately assert a vault has zero files"). Skip the
 * final ingest call entirely instead; see sync-manager.ts.
 */
export function finalizeManifest(
	provisional: string[],
	tooLargeThisRun: ReadonlySet<string>,
	neverStagedPaths: ReadonlySet<string>,
): string[] {
	return provisional.filter((p) => !(tooLargeThisRun.has(p) && neverStagedPaths.has(p)));
}

/**
 * Computes the NEXT `files` state after a sync run completes (successfully
 * or partially — this is called with whatever was actually pushed/verdicted
 * before the run stopped, never assumed to be "everything").
 *
 * - A path reported `tooLarge` this run: hash updated (so a further,
 *   unrelated edit is detected next time), `tooLarge: true`, `syncedAt`
 *   preserved from before (it was never actually (re)synced THIS time —
 *   an older `syncedAt`, if any, survives so the "has this path ever been
 *   staged" signal `planSync`/`finalizeManifest` depend on stays correct).
 * - A path that was pushed and NOT reported too-large: hash + `syncedAt`
 *   updated, `tooLarge` cleared.
 * - A path that was neither pushed nor too-large (unchanged): carries its
 *   prior state forward untouched.
 * - A path no longer present in `scanned` (deleted/renamed locally): simply
 *   absent from the result — garbage-collected.
 */
export function applySyncResult(
	priorFiles: Record<string, FileState>,
	scanned: ScannedFile[],
	pushedPaths: ReadonlySet<string>,
	tooLargeThisRun: ReadonlySet<string>,
	now: string,
): Record<string, FileState> {
	const next: Record<string, FileState> = {};
	for (const file of scanned) {
		const wasPushed = pushedPaths.has(file.path);
		const isTooLarge = tooLargeThisRun.has(file.path);
		if (isTooLarge) {
			next[file.path] = {
				hash: file.hash,
				syncedAt: priorFiles[file.path]?.syncedAt ?? '',
				tooLarge: true,
			};
		} else if (wasPushed) {
			next[file.path] = { hash: file.hash, syncedAt: now, tooLarge: false };
		} else {
			next[file.path] = priorFiles[file.path] ?? { hash: file.hash, syncedAt: now, tooLarge: false };
		}
	}
	return next;
}
