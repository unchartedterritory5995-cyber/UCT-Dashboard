/**
 * Plugin entry point. Wires the pure logic in sync-manager.ts/sync-plan.ts/
 * batching.ts/hashing.ts to real Obsidian primitives: persisted settings
 * (`loadData`/`saveData`), the vault (`ObsidianVaultSource`), the network
 * (`ObsidianHttpTransport`), a ribbon icon, a command, and the settings tab.
 *
 * See README.md for the wire contract this plugin implements and the
 * server-side repo it talks to.
 */
// Bare "crypto" — see hashing.ts's comment on why not "node:crypto".
import { randomUUID } from 'crypto';
import { Notice, Plugin } from 'obsidian';
import { ObsidianHttpTransport, type RedeemOutcome } from './api-client';
import { UctNotebookSyncSettingTab } from './settings';
import { SyncManager, type SyncSummary } from './sync-manager';
import { defaultPluginData, type PluginData } from './types';
import { ObsidianVaultSource } from './vault-source';

export default class UctNotebookSyncPlugin extends Plugin {
	data!: PluginData;
	private transport = new ObsidianHttpTransport();
	private syncManager!: SyncManager;
	private syncing = false;

	async onload(): Promise<void> {
		await this.loadPluginData();

		this.syncManager = new SyncManager({
			transport: this.transport,
			vaultSource: new ObsidianVaultSource(this.app),
			getData: () => this.data,
			saveData: (data) => this.saveData(data),
		});

		this.addSettingTab(new UctNotebookSyncSettingTab(this.app, this));

		this.addRibbonIcon('refresh-cw', 'Sync to UCT Notebook', () => {
			void this.runManualSync();
		});

		this.addCommand({
			id: 'uct-notebook-sync-now',
			name: 'Sync vault to UCT Notebook',
			callback: () => {
				void this.runManualSync();
			},
		});
	}

	private async loadPluginData(): Promise<void> {
		const stored = (await this.loadData()) as Partial<PluginData> | null;
		// `vaultId` must survive verbatim across every reload once minted —
		// see types.ts's own docstring on why reusing it is what makes a
		// reconnect ROTATE the server's device row instead of creating a
		// second, orphaned one. Only ever generated ONCE, on a genuinely
		// fresh install (no stored data at all, or a pre-existing blob
		// missing it for some reason).
		const vaultId = stored?.vaultId ?? randomUUID();
		this.data = { ...defaultPluginData(vaultId), ...stored, vaultId };
	}

	async redeemConnectCode(code: string): Promise<RedeemOutcome> {
		const label = this.app.vault.getName();
		const result = await this.transport.redeem({
			serverUrl: this.data.serverUrl,
			code,
			vaultId: this.data.vaultId,
			label,
		});
		if (result.ok) {
			this.data.deviceToken = result.token;
			this.data.connectedLabel = label;
			this.data.connectedAt = new Date().toISOString();
			await this.saveData(this.data);
		}
		return result;
	}

	async runManualSync(): Promise<SyncSummary> {
		if (this.syncing) {
			new Notice('A sync is already running.');
			return {
				ok: false,
				scanned: 0,
				pushed: 0,
				skippedUnchanged: 0,
				tooLarge: [],
				skippedTooLargeUnchanged: [],
				deletedLocally: [],
				manifestSent: false,
				needsReconnect: false,
				error: 'A sync is already running.',
			};
		}
		this.syncing = true;
		try {
			const summary = await this.syncManager.runSync();
			new Notice(summarize(summary));
			return summary;
		} finally {
			this.syncing = false;
		}
	}
}

function summarize(summary: SyncSummary): string {
	if (summary.needsReconnect) {
		return 'UCT Notebook Sync: not connected. Reconnect in Settings.';
	}
	if (!summary.ok) {
		return `UCT Notebook Sync failed: ${summary.error ?? 'unknown error'}`;
	}
	const parts = [`${summary.pushed} note${summary.pushed === 1 ? '' : 's'} synced`];
	if (summary.tooLarge.length > 0) {
		parts.push(`${summary.tooLarge.length} too large (see Settings)`);
	}
	if (summary.deletedLocally.length > 0) {
		parts.push(`${summary.deletedLocally.length} removed`);
	}
	return `UCT Notebook Sync: ${parts.join(', ')}.`;
}
