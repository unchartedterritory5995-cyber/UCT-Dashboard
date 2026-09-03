/**
 * Integration-style tests over SyncManager with a STUBBED Transport and a
 * STUBBED VaultSource — no `obsidian` import, no network, no live server.
 * This is the suite that proves the batching/manifest/tooLarge/auth wiring
 * actually holds together end to end, not just as isolated pure functions.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { IngestOutcome, IngestParams, RedeemOutcome, RedeemParams, Transport } from '../api-client';
import { SyncManager, type VaultFileRef, type VaultSource } from '../sync-manager';
import { defaultPluginData, type PluginData } from '../types';

class FakeVaultSource implements VaultSource {
	constructor(private files: Record<string, string>) {}

	async listMarkdownFiles(): Promise<VaultFileRef[]> {
		return Object.keys(this.files).map((path) => ({ path, mtime: 1_700_000_000_000 }));
	}

	async readFile(path: string): Promise<string> {
		const body = this.files[path];
		if (body === undefined) throw new Error(`no such file: ${path}`);
		return body;
	}
}

/** Records every ingest call it receives (in order) and answers from a
 * scripted queue — the "stubbed transport" the task requires. */
class FakeTransport implements Transport {
	ingestCalls: IngestParams[] = [];
	redeemCalls: RedeemParams[] = [];
	private ingestQueue: IngestOutcome[] = [];
	private redeemQueue: RedeemOutcome[] = [];

	queueIngest(outcome: IngestOutcome): this {
		this.ingestQueue.push(outcome);
		return this;
	}

	queueRedeem(outcome: RedeemOutcome): this {
		this.redeemQueue.push(outcome);
		return this;
	}

	async ingest(params: IngestParams): Promise<IngestOutcome> {
		this.ingestCalls.push(params);
		const next = this.ingestQueue.shift();
		if (!next) throw new Error('FakeTransport.ingest called with no queued outcome');
		return next;
	}

	async redeem(params: RedeemParams): Promise<RedeemOutcome> {
		this.redeemCalls.push(params);
		const next = this.redeemQueue.shift();
		if (!next) throw new Error('FakeTransport.redeem called with no queued outcome');
		return next;
	}
}

function okIngest(overrides: Partial<IngestOutcome & { ok: true }> = {}): IngestOutcome {
	return {
		ok: true,
		response: { written: 0, skipped: 0, manifestReplaced: false, tooLarge: [] },
		...overrides,
	};
}

function makeData(overrides: Partial<PluginData> = {}): PluginData {
	return { ...defaultPluginData('vault-uuid-1'), deviceToken: 'device-token-1', ...overrides };
}

describe('SyncManager.runSync', () => {
	let data: PluginData;
	let saved: PluginData[];

	beforeEach(() => {
		saved = [];
	});

	function manager(transport: FakeTransport, vaultSource: VaultSource, initial: PluginData) {
		data = initial;
		return new SyncManager({
			transport,
			vaultSource,
			getData: () => data,
			saveData: async (d) => {
				data = d;
				saved.push(structuredClone(d));
			},
			now: () => '2026-09-02T12:00:00.000Z',
		});
	}

	it('refuses to run without a device token, and makes no transport calls', async () => {
		const transport = new FakeTransport();
		const sm = manager(transport, new FakeVaultSource({}), makeData({ deviceToken: null }));
		const summary = await sm.runSync();
        expect(summary.ok).toBe(false);
		expect(summary.needsReconnect).toBe(true);
		expect(transport.ingestCalls).toHaveLength(0);
	});

	it('an empty vault sends nothing and succeeds', async () => {
		const transport = new FakeTransport();
		const sm = manager(transport, new FakeVaultSource({}), makeData());
		const summary = await sm.runSync();
		expect(summary.ok).toBe(true);
		expect(summary.manifestSent).toBe(false);
		expect(transport.ingestCalls).toHaveLength(0);
	});

	it('a first sync pushes every file in one batch, then sends the final manifest', async () => {
		const transport = new FakeTransport()
			.queueIngest(okIngest({ response: { written: 2, skipped: 0, manifestReplaced: false, tooLarge: [] } }))
			.queueIngest(okIngest({ response: { written: 0, skipped: 0, manifestReplaced: true, tooLarge: [] } }));
		const sm = manager(
			transport,
			new FakeVaultSource({ 'a.md': '# A', 'b.md': '# B' }),
			makeData(),
		);
		const summary = await sm.runSync();

		expect(summary.ok).toBe(true);
		expect(summary.pushed).toBe(2);
		expect(summary.manifestSent).toBe(true);
		expect(transport.ingestCalls).toHaveLength(2);

		const [contentCall, manifestCall] = transport.ingestCalls;
		expect(contentCall!.final).toBe(false);
		expect(contentCall!.notes.map((n) => n.vault_path).sort()).toEqual(['a.md', 'b.md']);
		expect(contentCall!.manifest).toBeUndefined();

		expect(manifestCall!.final).toBe(true);
		expect(manifestCall!.notes).toEqual([]);
		expect(manifestCall!.manifest?.sort()).toEqual(['a.md', 'b.md']);

		// State persisted for both files.
		expect(data.files['a.md']).toMatchObject({ tooLarge: false, syncedAt: '2026-09-02T12:00:00.000Z' });
		expect(data.files['b.md']).toMatchObject({ tooLarge: false, syncedAt: '2026-09-02T12:00:00.000Z' });
	});

	it('splits changed notes across multiple batches when the count ceiling is small', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 5; i++) files[`n${i}.md`] = `# note ${i}`;
		const transport = new FakeTransport()
			.queueIngest(okIngest({ response: { written: 2, skipped: 0, manifestReplaced: false, tooLarge: [] } }))
			.queueIngest(okIngest({ response: { written: 2, skipped: 0, manifestReplaced: false, tooLarge: [] } }))
			.queueIngest(okIngest({ response: { written: 1, skipped: 0, manifestReplaced: false, tooLarge: [] } }))
			.queueIngest(okIngest({ response: { written: 0, skipped: 0, manifestReplaced: true, tooLarge: [] } }));
		const sm = new SyncManager({
			transport,
			vaultSource: new FakeVaultSource(files),
			getData: () => data,
			saveData: async (d) => {
				data = d;
			},
			now: () => 'now',
			batchOptions: { maxNotes: 2, maxBytes: 1_000_000 },
		});
		data = makeData();
		const summary = await sm.runSync();

		expect(summary.ok).toBe(true);
		expect(summary.pushed).toBe(5);
		// 3 content batches (2,2,1) + 1 final manifest call.
		expect(transport.ingestCalls).toHaveLength(4);
		expect(transport.ingestCalls.slice(0, 3).every((c) => c.final === false)).toBe(true);
		expect(transport.ingestCalls[3]!.final).toBe(true);
	});

	it('a second sync with nothing changed pushes no content but still refreshes the manifest', async () => {
		const initial = makeData({ files: { 'a.md': { hash: '', syncedAt: 't0', tooLarge: false } } });
		// Compute the real hash so "unchanged" is genuine, not a fluke.
		const { sha256Hex } = await import('../hashing');
		initial.files['a.md']!.hash = sha256Hex('# A');

		const transport = new FakeTransport().queueIngest(
			okIngest({ response: { written: 0, skipped: 0, manifestReplaced: true, tooLarge: [] } }),
		);
		const sm = manager(transport, new FakeVaultSource({ 'a.md': '# A' }), initial);
		const summary = await sm.runSync();

		expect(summary.ok).toBe(true);
		expect(summary.pushed).toBe(0);
		expect(summary.skippedUnchanged).toBe(1);
		// Exactly one call: the final manifest alone, no content batch.
		expect(transport.ingestCalls).toHaveLength(1);
		expect(transport.ingestCalls[0]!.final).toBe(true);
		expect(transport.ingestCalls[0]!.notes).toEqual([]);
		expect(transport.ingestCalls[0]!.manifest).toEqual(['a.md']);
	});

	it('a note reported tooLarge is excluded from this run’s manifest and from the NEXT run’s push', async () => {
		const transport = new FakeTransport()
			.queueIngest(
				okIngest({ response: { written: 0, skipped: 0, manifestReplaced: false, tooLarge: ['huge.md'] } }),
			);
			// No second queued call expected — manifestPaths is empty once
			// the only file is excluded, so phase 2 must be skipped.
		const sm = manager(transport, new FakeVaultSource({ 'huge.md': 'x'.repeat(500_000) }), makeData());
		const summary = await sm.runSync();

		expect(summary.ok).toBe(true);
		expect(summary.tooLarge).toEqual(['huge.md']);
		expect(summary.manifestSent).toBe(false);
		// Only ONE ingest call was made at all — the manifest phase was
		// correctly skipped rather than sending an empty `manifest: []`.
		expect(transport.ingestCalls).toHaveLength(1);
		expect(data.files['huge.md']).toMatchObject({ tooLarge: true });

		// Second run, file unchanged: must not be re-pushed, and (being the
		// vault's only file, still too large) still sends nothing.
		const transport2 = new FakeTransport();
		const sm2 = manager(transport2, new FakeVaultSource({ 'huge.md': 'x'.repeat(500_000) }), data);
		const summary2 = await sm2.runSync();
		expect(summary2.ok).toBe(true);
		expect(transport2.ingestCalls).toHaveLength(0);
		expect(summary2.skippedTooLargeUnchanged).toEqual(['huge.md']);
	});

	it('a too-large note is retried once the member edits it', async () => {
		const priorData = makeData({
			files: { 'huge.md': { hash: 'stale-hash', syncedAt: '', tooLarge: true } },
		});
		const transport = new FakeTransport()
			.queueIngest(okIngest({ response: { written: 1, skipped: 0, manifestReplaced: false, tooLarge: [] } }))
			.queueIngest(okIngest({ response: { written: 0, skipped: 0, manifestReplaced: true, tooLarge: [] } }));
		const sm = manager(transport, new FakeVaultSource({ 'huge.md': '# shortened now' }), priorData);
		const summary = await sm.runSync();

		expect(summary.ok).toBe(true);
		expect(summary.pushed).toBe(1);
		expect(transport.ingestCalls[0]!.notes.map((n) => n.vault_path)).toEqual(['huge.md']);
		expect(data.files['huge.md']).toMatchObject({ tooLarge: false });
	});

	it('a note that grew past the ceiling AFTER syncing fine once stays in the manifest — no spurious deletion', async () => {
		// "grown.md" synced successfully before (non-empty syncedAt); the
		// member then grew it, so this run's push fails again. Its manifest
		// entry must survive regardless — the server's own
		// `j2_obsidian_staging` row for this path still holds the OLDER,
		// successfully-staged content, so omitting it here would look
		// exactly like the member deleted an already-imported note.
		const priorData = makeData({
			files: {
				'grown.md': { hash: 'old-small-hash', syncedAt: '2026-08-01T00:00:00Z', tooLarge: false },
				'sibling.md': { hash: '', syncedAt: '2026-08-01T00:00:00Z' },
			},
		});
		const { sha256Hex } = await import('../hashing');
		priorData.files['sibling.md']!.hash = sha256Hex('# sibling, unchanged');

		const transport = new FakeTransport()
			.queueIngest(
				okIngest({ response: { written: 0, skipped: 0, manifestReplaced: false, tooLarge: ['grown.md'] } }),
			)
			.queueIngest(okIngest({ response: { written: 0, skipped: 0, manifestReplaced: true, tooLarge: [] } }));
		const sm = manager(
			transport,
			new FakeVaultSource({ 'grown.md': 'x'.repeat(500_000), 'sibling.md': '# sibling, unchanged' }),
			priorData,
		);
		const summary = await sm.runSync();

		expect(summary.ok).toBe(true);
		expect(summary.tooLarge).toEqual(['grown.md']);
		// The manifest call must still name BOTH paths.
		expect(transport.ingestCalls[1]!.final).toBe(true);
		expect(transport.ingestCalls[1]!.manifest?.sort()).toEqual(['grown.md', 'sibling.md']);
		expect(data.files['grown.md']).toMatchObject({ tooLarge: true, syncedAt: '2026-08-01T00:00:00Z' });
	});

	it('a deleted file drops out of the manifest and out of local state', async () => {
		const priorData = makeData({
			files: {
				'keep.md': { hash: 'h-keep', syncedAt: 't0' },
				'deleted.md': { hash: 'h-del', syncedAt: 't0' },
			},
		});
		const { sha256Hex } = await import('../hashing');
		priorData.files['keep.md']!.hash = sha256Hex('# keep');

		const transport = new FakeTransport().queueIngest(
			okIngest({ response: { written: 0, skipped: 0, manifestReplaced: true, tooLarge: [] } }),
		);
		const sm = manager(transport, new FakeVaultSource({ 'keep.md': '# keep' }), priorData);
		const summary = await sm.runSync();

		expect(summary.deletedLocally).toEqual(['deleted.md']);
		expect(transport.ingestCalls[0]!.manifest).toEqual(['keep.md']);
		expect(data.files['deleted.md']).toBeUndefined();
	});

	it('stops the run on a mid-batch failure and never sends the manifest for unpushed content', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 3; i++) files[`n${i}.md`] = `# note ${i}`;
		const transport = new FakeTransport()
			.queueIngest(okIngest({ response: { written: 1, skipped: 0, manifestReplaced: false, tooLarge: [] } }))
			.queueIngest({ ok: false, status: 502, message: 'upstream unavailable', authExpired: false });
		const sm = new SyncManager({
			transport,
			vaultSource: new FakeVaultSource(files),
			getData: () => data,
			saveData: async (d) => {
				data = d;
			},
			now: () => 'now',
			batchOptions: { maxNotes: 1, maxBytes: 1_000_000 },
		});
		data = makeData();
		const summary = await sm.runSync();

		expect(summary.ok).toBe(false);
		expect(summary.needsReconnect).toBe(false);
		expect(summary.error).toBe('upstream unavailable');
		// Exactly the two attempted calls — the run stopped, no manifest call.
		expect(transport.ingestCalls).toHaveLength(2);
		expect(transport.ingestCalls.every((c) => c.final !== true)).toBe(true);
		// The token must NOT have been cleared for a non-auth failure.
		expect(data.deviceToken).toBe('device-token-1');
		expect(data.lastSyncError).toBe('upstream unavailable');
	});

	it('a 401 clears the device token, keeps vaultId, and asks for reconnection instead of looping', async () => {
		const transport = new FakeTransport().queueIngest({
			ok: false,
			status: 401,
			message: 'Not authenticated',
			authExpired: true,
		});
		const sm = manager(transport, new FakeVaultSource({ 'a.md': '# A' }), makeData({ vaultId: 'stable-vault-id' }));
		const summary = await sm.runSync();

		expect(summary.ok).toBe(false);
		expect(summary.needsReconnect).toBe(true);
		expect(data.deviceToken).toBeNull();
		expect(data.vaultId).toBe('stable-vault-id');
		// Exactly one call was made — a 401 must not trigger an automatic retry.
		expect(transport.ingestCalls).toHaveLength(1);
	});
});
