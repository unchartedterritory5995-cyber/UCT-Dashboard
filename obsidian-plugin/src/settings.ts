/**
 * Settings tab: server URL, connect-code redemption, manual sync, and a
 * visible list of notes the server has permanently refused (too large) —
 * per the task's own hard requirement, a too-large note must be SURFACED,
 * not silently retried forever nor silently dropped. See sync-plan.ts for
 * the logic that decides which notes land in that list.
 */
import { Notice, PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type UctNotebookSyncPlugin from './main';

export class UctNotebookSyncSettingTab extends PluginSettingTab {
	private connectCode = '';

	constructor(app: App, private readonly plugin: UctNotebookSyncPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const data = this.plugin.data;

		containerEl.createEl('h2', { text: 'UCT Notebook Sync' });
		containerEl.createEl('p', {
			text:
				'One-way sync: this vault’s markdown notes are pushed into your ' +
				'UCT Intelligence Notebook. Nothing is ever written back to this vault.',
		});

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('Your UCT Intelligence dashboard origin. Leave the default unless a UCT team member told you otherwise.')
			.addText((text) =>
				text
					.setPlaceholder('https://uctintelligence.com')
					.setValue(data.serverUrl)
					.onChange(async (value) => {
						const trimmed = value.trim().replace(/\/+$/, '');
						data.serverUrl = trimmed || data.serverUrl;
						await this.plugin.saveData(data);
					}),
			);

		if (data.deviceToken) {
			this.renderConnected(containerEl);
		} else {
			this.renderDisconnected(containerEl);
		}

		this.renderTooLarge(containerEl);
	}

	private renderConnected(containerEl: HTMLElement): void {
		const data = this.plugin.data;
		new Setting(containerEl)
			.setName('Connection')
			.setDesc(`Connected as "${data.connectedLabel ?? data.vaultId}".`)
			.addButton((btn) =>
				btn.setButtonText('Sync now').setCta().onClick(async () => {
					await this.plugin.runManualSync();
					this.display();
				}),
			)
			.addButton((btn) =>
				btn.setButtonText('Forget connection (local only)').setWarning().onClick(async () => {
					// This does NOT call the server — disconnecting the
					// server-side device token happens in the dashboard's
					// Settings page (DELETE /obsidian), which is also the
					// only place that revokes it. This button only clears
					// what THIS install remembers, e.g. after moving to a
					// fresh device where reconnecting is easier than
					// tracking down the old token.
					data.deviceToken = null;
					data.connectedLabel = null;
					data.connectedAt = null;
					await this.plugin.saveData(data);
					new Notice('Forgot this connection locally. Reconnect below, or from the dashboard.');
					this.display();
				}),
			);

		if (data.lastSyncAt) {
			containerEl.createEl('p', {
				text: `Last sync: ${new Date(data.lastSyncAt).toLocaleString()}`,
				cls: 'setting-item-description',
			});
		}
		if (data.lastSyncError) {
			const p = containerEl.createEl('p', {
				text: `Last sync error: ${data.lastSyncError}`,
			});
			p.style.color = 'var(--text-error)';
		}
	}

	private renderDisconnected(containerEl: HTMLElement): void {
		containerEl.createEl('p', {
			text:
				'Generate a connect code from your UCT Intelligence dashboard ' +
				'(Journal → Settings → Notebook Connectors → Obsidian), then paste it below. ' +
				'The code works once and expires in a few minutes.',
		});
		new Setting(containerEl).setName('Connect code').addText((text) =>
			text.setPlaceholder('Paste code here').onChange((value) => {
				this.connectCode = value.trim();
			}),
		);
		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText('Connect')
				.setCta()
				.onClick(async () => {
					if (!this.connectCode) {
						new Notice('Paste a connect code first.');
						return;
					}
					btn.setDisabled(true).setButtonText('Connecting…');
					const result = await this.plugin.redeemConnectCode(this.connectCode);
					btn.setDisabled(false).setButtonText('Connect');
					if (result.ok) {
						this.connectCode = '';
						new Notice(`Connected. Vault "${this.plugin.app.vault.getName()}" is now syncing to UCT Notebook.`);
						this.display();
					} else {
						new Notice(`Could not connect: ${result.message}`);
					}
				}),
		);
	}

	private renderTooLarge(containerEl: HTMLElement): void {
		const data = this.plugin.data;
		const tooLarge = Object.entries(data.files)
			.filter(([, state]) => state.tooLarge)
			.map(([path]) => path)
			.sort();
		if (tooLarge.length === 0) return;

		containerEl.createEl('h3', { text: `Notes that could not sync (${tooLarge.length})` });
		containerEl.createEl('p', {
			text:
				'These notes are too large to store once converted, so they are skipped rather than ' +
				'retried on every sync. Shorten a note and it will be retried automatically on the next sync.',
		});
		const list = containerEl.createEl('ul');
		for (const path of tooLarge) {
			list.createEl('li', { text: path });
		}
		new Setting(containerEl)
			.setDesc('Force every note above back into the next sync attempt, even if unchanged.')
			.addButton((btn) =>
				btn.setButtonText('Retry all now').onClick(async () => {
					for (const path of tooLarge) {
						delete data.files[path];
					}
					await this.plugin.saveData(data);
					await this.plugin.runManualSync();
					this.display();
				}),
			);
	}
}
