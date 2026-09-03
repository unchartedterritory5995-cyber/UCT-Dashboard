import { describe, expect, it } from 'vitest';
import { applySyncResult, finalizeManifest, planSync } from '../sync-plan';
import type { FileState, ScannedFile } from '../types';

function scanned(path: string, hash: string, body = '# ' + path): ScannedFile {
	return { path, hash, updatedAt: '2026-09-02T00:00:00.000Z', body };
}

describe('planSync', () => {
	it('a brand-new file (no prior state) is pushed and manifested', () => {
		const plan = planSync([scanned('a.md', 'h1')], {});
		expect(plan.toPush.map((n) => n.vault_path)).toEqual(['a.md']);
		expect(plan.manifestPaths).toEqual(['a.md']);
		expect(plan.retryingTooLarge).toEqual([]);
		expect(plan.skippedTooLarge).toEqual([]);
	});

	it('an unchanged file (same hash as prior state) is NOT pushed but stays manifested', () => {
		const prior: Record<string, FileState> = { 'a.md': { hash: 'h1', syncedAt: 't0' } };
		const plan = planSync([scanned('a.md', 'h1')], prior);
		expect(plan.toPush).toEqual([]);
		expect(plan.manifestPaths).toEqual(['a.md']);
	});

	it('a changed file (different hash from prior state) is pushed and manifested', () => {
		const prior: Record<string, FileState> = { 'a.md': { hash: 'h1', syncedAt: 't0' } };
		const plan = planSync([scanned('a.md', 'h2')], prior);
		expect(plan.toPush.map((n) => n.vault_path)).toEqual(['a.md']);
		expect(plan.toPush[0]!.content_hash).toBe('h2');
		expect(plan.manifestPaths).toEqual(['a.md']);
	});

	it('a file removed from the vault is reported as removedLocally and dropped from the manifest', () => {
		const prior: Record<string, FileState> = {
			'a.md': { hash: 'h1', syncedAt: 't0' },
			'gone.md': { hash: 'hX', syncedAt: 't0' },
		};
		const plan = planSync([scanned('a.md', 'h1')], prior);
		expect(plan.removedLocally).toEqual(['gone.md']);
		expect(plan.manifestPaths).toEqual(['a.md']);
	});

	it('a too-large file whose hash is UNCHANGED is skipped: not pushed, not manifested', () => {
		const prior: Record<string, FileState> = { 'huge.md': { hash: 'hHuge', syncedAt: '', tooLarge: true } };
		const plan = planSync([scanned('huge.md', 'hHuge')], prior);
		expect(plan.toPush).toEqual([]);
		expect(plan.manifestPaths).toEqual([]);
		expect(plan.skippedTooLarge).toEqual(['huge.md']);
		expect(plan.retryingTooLarge).toEqual([]);
	});

	it('a too-large file whose hash CHANGED is retried: pushed, and provisionally manifested', () => {
		const prior: Record<string, FileState> = { 'huge.md': { hash: 'hHuge', syncedAt: '', tooLarge: true } };
		const plan = planSync([scanned('huge.md', 'hShorter')], prior);
		expect(plan.toPush.map((n) => n.vault_path)).toEqual(['huge.md']);
		expect(plan.retryingTooLarge).toEqual(['huge.md']);
		expect(plan.skippedTooLarge).toEqual([]);
		// Provisional only — the caller must run this through
		// finalizeManifest with this run's actual tooLarge verdicts.
		expect(plan.manifestPaths).toEqual(['huge.md']);
	});

	it('a brand-new file being pushed for the first time is recorded in neverStagedPaths', () => {
		const plan = planSync([scanned('brand-new.md', 'h1')], {});
		expect(plan.neverStagedPaths.has('brand-new.md')).toBe(true);
	});

	it('a file with prior successful staging is never counted as "never staged", even when retried', () => {
		const prior: Record<string, FileState> = { 'huge.md': { hash: 'hHuge', syncedAt: 't0', tooLarge: true } };
		const plan = planSync([scanned('huge.md', 'hShorter')], prior);
		expect(plan.neverStagedPaths.has('huge.md')).toBe(false);
	});

	it('a too-large file whose hash is UNCHANGED but was staged successfully BEFORE it grew stays manifested', () => {
		// syncedAt is non-empty here -- an older, smaller version of this
		// note genuinely synced before an edit pushed it over the ceiling.
		// Omitting it from the manifest would make the server's delete
		// detection eventually tag the member's EXISTING Notebook note
		// `source-deleted`, even though the vault file (and an older synced
		// copy) both still exist.
		const prior: Record<string, FileState> = { 'grown.md': { hash: 'hHuge', syncedAt: 't0', tooLarge: true } };
		const plan = planSync([scanned('grown.md', 'hHuge')], prior);
		expect(plan.toPush).toEqual([]);
		expect(plan.skippedTooLarge).toEqual(['grown.md']);
		expect(plan.manifestPaths).toEqual(['grown.md']);
	});

	it('handles a mixed vault correctly in one pass', () => {
		const prior: Record<string, FileState> = {
			'unchanged.md': { hash: 'h1', syncedAt: 't0' },
			'stale.md': { hash: 'h2', syncedAt: 't0' },
			'huge-stuck.md': { hash: 'hHuge', syncedAt: '', tooLarge: true },
			'deleted.md': { hash: 'hDel', syncedAt: 't0' },
		};
		const plan = planSync(
			[
				scanned('unchanged.md', 'h1'),
				scanned('stale.md', 'h2-new'),
				scanned('huge-stuck.md', 'hHuge'),
				scanned('new.md', 'hNew'),
			],
			prior,
		);
		expect(plan.toPush.map((n) => n.vault_path).sort()).toEqual(['new.md', 'stale.md']);
		expect(plan.manifestPaths.sort()).toEqual(['new.md', 'stale.md', 'unchanged.md']);
		expect(plan.skippedTooLarge).toEqual(['huge-stuck.md']);
		expect(plan.removedLocally).toEqual(['deleted.md']);
	});
});

describe('finalizeManifest', () => {
	it('removes a NEVER-staged path this run reported as too large from the provisional manifest', () => {
		const result = finalizeManifest(['a.md', 'b.md', 'c.md'], new Set(['b.md']), new Set(['b.md']));
		expect(result).toEqual(['a.md', 'c.md']);
	});

	it('returns an unchanged list when nothing was too large', () => {
		const result = finalizeManifest(['a.md', 'b.md'], new Set(), new Set());
		expect(result).toEqual(['a.md', 'b.md']);
	});

	it('can legitimately collapse to empty (caller must then skip sending a manifest at all)', () => {
		const result = finalizeManifest(['only.md'], new Set(['only.md']), new Set(['only.md']));
		expect(result).toEqual([]);
	});

	it('KEEPS a path reported too large this run if it was previously staged successfully — the growth case', () => {
		// "grown-past-the-ceiling.md" is in tooLargeThisRun (this attempt
		// failed) but NOT in neverStagedPaths (an older version synced fine
		// before) -- must survive, or the member's existing Notebook note
		// for it would spuriously look deleted.
		const result = finalizeManifest(
			['unrelated.md', 'grown-past-the-ceiling.md'],
			new Set(['grown-past-the-ceiling.md']),
			new Set(), // nothing is "never staged"
		);
		expect(result).toEqual(['unrelated.md', 'grown-past-the-ceiling.md']);
	});
});

describe('applySyncResult', () => {
	it('records a successful push: hash + syncedAt updated, tooLarge cleared', () => {
		const prior: Record<string, FileState> = {};
		const scannedFile = scanned('a.md', 'h1');
		const next = applySyncResult(prior, [scannedFile], new Set(['a.md']), new Set(), '2026-09-02T01:00:00Z');
		expect(next['a.md']).toEqual({ hash: 'h1', syncedAt: '2026-09-02T01:00:00Z', tooLarge: false });
	});

	it('marks a too-large verdict: hash updated, tooLarge true, syncedAt preserved from before', () => {
		const prior: Record<string, FileState> = { 'huge.md': { hash: 'hOld', syncedAt: 't0' } };
		const scannedFile = scanned('huge.md', 'hNew');
		const next = applySyncResult(prior, [scannedFile], new Set(['huge.md']), new Set(['huge.md']), 'now');
		expect(next['huge.md']).toEqual({ hash: 'hNew', syncedAt: 't0', tooLarge: true });
	});

	it('a too-large verdict on a NEVER-before-synced file leaves syncedAt empty, not fabricated', () => {
		const next = applySyncResult({}, [scanned('huge.md', 'h1')], new Set(['huge.md']), new Set(['huge.md']), 'now');
		expect(next['huge.md']).toEqual({ hash: 'h1', syncedAt: '', tooLarge: true });
	});

	it('carries forward prior state untouched for a file that was neither pushed nor too-large', () => {
		const prior: Record<string, FileState> = { 'a.md': { hash: 'h1', syncedAt: 't0', tooLarge: false } };
		const next = applySyncResult(prior, [scanned('a.md', 'h1')], new Set(), new Set(), 'now');
		expect(next['a.md']).toEqual(prior['a.md']);
	});

	it('garbage-collects a path no longer present in the scan (deleted/renamed)', () => {
		const prior: Record<string, FileState> = {
			'a.md': { hash: 'h1', syncedAt: 't0' },
			'gone.md': { hash: 'h2', syncedAt: 't0' },
		};
		const next = applySyncResult(prior, [scanned('a.md', 'h1')], new Set(), new Set(), 'now');
		expect(Object.keys(next)).toEqual(['a.md']);
	});
});
