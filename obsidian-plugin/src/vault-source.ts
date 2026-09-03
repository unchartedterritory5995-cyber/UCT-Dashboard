/**
 * The one concrete `VaultSource` — a thin adapter over Obsidian's real
 * `Vault` API. Deliberately tiny and untested directly (it has no logic of
 * its own to test, only Obsidian API calls); `sync-manager.test.ts` covers
 * every decision this plugin makes by injecting a fake `VaultSource`
 * instead.
 */
import type { App, TFile } from 'obsidian';
import type { VaultFileRef, VaultSource } from './sync-manager';

export class ObsidianVaultSource implements VaultSource {
	constructor(private readonly app: App) {}

	async listMarkdownFiles(): Promise<VaultFileRef[]> {
		return this.app.vault.getMarkdownFiles().map((f: TFile) => ({
			path: f.path,
			mtime: f.stat.mtime,
		}));
	}

	async readFile(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !('extension' in file)) {
			throw new Error(`File not found or not readable: ${path}`);
		}
		return this.app.vault.cachedRead(file as TFile);
	}
}
