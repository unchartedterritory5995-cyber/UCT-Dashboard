/**
 * Exercises the REAL `ObsidianHttpTransport` — the only file that actually
 * imports Obsidian's `requestUrl` — with `requestUrl` itself stubbed. This
 * is the piece sync-manager.test.ts's `FakeTransport` deliberately does not
 * cover: is the outgoing request shaped correctly (URL, method, headers,
 * JSON body), and is a non-2xx response translated into the right
 * `Outcome` (especially the 401 -> authExpired mapping the whole reconnect
 * story depends on)?
 *
 * The real `obsidian` npm package ships no runtime JS at all (types only),
 * so it cannot be resolved even under `vi.mock` — `vitest.config.ts`
 * aliases the `obsidian` specifier to `src/test/obsidian-stub.ts` for tests,
 * which is what `requestUrl` below actually resolves to.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { requestUrl as requestUrlMock } from 'obsidian';
import { ObsidianHttpTransport, joinUrl } from '../api-client';

describe('joinUrl', () => {
	it('joins a base with no trailing slash and a leading-slash path', () => {
		expect(joinUrl('https://uctintelligence.com', '/api/x')).toBe('https://uctintelligence.com/api/x');
	});

	it('strips a trailing slash on the base before joining', () => {
		expect(joinUrl('https://uctintelligence.com/', '/api/x')).toBe('https://uctintelligence.com/api/x');
	});
});

describe('ObsidianHttpTransport', () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
	});

	it('redeem() posts to the redeem path with the code/vaultId/label body', async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: '',
			json: { deviceId: 'd1', token: 'd1:secret', vaultId: 'v1', source: { id: 's1', provider: 'obsidian', remoteId: 'v1' } },
		});
		const transport = new ObsidianHttpTransport();
		const result = await transport.redeem({
			serverUrl: 'https://uctintelligence.com',
			code: 'CODE123',
			vaultId: 'v1',
			label: 'My Vault',
		});

		expect(result).toEqual({ ok: true, deviceId: 'd1', token: 'd1:secret', vaultId: 'v1' });
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
		const call = requestUrlMock.mock.calls[0][0];
		expect(call.url).toBe('https://uctintelligence.com/api/j2/notes/connectors/obsidian/redeem');
		expect(call.method).toBe('POST');
		expect(JSON.parse(call.body)).toEqual({ code: 'CODE123', vaultId: 'v1', label: 'My Vault' });
	});

	it('ingest() sends a Bearer header and the pinned "notes" field', async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: '',
			json: { written: 1, skipped: 0, manifestReplaced: false, tooLarge: [] },
		});
		const transport = new ObsidianHttpTransport();
		const outcome = await transport.ingest({
			serverUrl: 'https://uctintelligence.com',
			token: 'd1:secret',
			notes: [{ vault_path: 'a.md', content_hash: 'h1', body_md: '# A', updated_at: '2026-09-02T00:00:00Z' }],
			final: false,
		});

		expect(outcome).toEqual({ ok: true, response: { written: 1, skipped: 0, manifestReplaced: false, tooLarge: [] } });
		const call = requestUrlMock.mock.calls[0][0];
		expect(call.url).toBe('https://uctintelligence.com/api/j2/notes/connectors/obsidian/ingest');
		expect(call.headers.Authorization).toBe('Bearer d1:secret');
		const body = JSON.parse(call.body);
		expect(body.consent).toBe(true);
		expect(body.notes).toHaveLength(1);
		expect(body.manifest).toBeUndefined();
	});

	it('omits the manifest field entirely when not provided, never sends manifest: []', async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: '',
			json: { written: 0, skipped: 0, manifestReplaced: false, tooLarge: [] },
		});
		const transport = new ObsidianHttpTransport();
		await transport.ingest({ serverUrl: 'https://x.test', token: 't', notes: [] });
		const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
		expect('manifest' in body).toBe(false);
	});

	it('maps a 401 to authExpired: true with the server-provided detail message', async () => {
		requestUrlMock.mockResolvedValue({
			status: 401,
			text: JSON.stringify({ detail: 'Not authenticated' }),
			json: undefined,
		});
		const transport = new ObsidianHttpTransport();
		const outcome = await transport.ingest({ serverUrl: 'https://x.test', token: 'dead', notes: [] });
		expect(outcome).toEqual({ ok: false, status: 401, message: 'Not authenticated', authExpired: true });
	});

	it('maps a non-401 error status to authExpired: false', async () => {
		requestUrlMock.mockResolvedValue({
			status: 403,
			text: JSON.stringify({ detail: 'Upgrade required' }),
			json: undefined,
		});
		const transport = new ObsidianHttpTransport();
		const outcome = await transport.ingest({ serverUrl: 'https://x.test', token: 't', notes: [] });
		expect(outcome).toEqual({ ok: false, status: 403, message: 'Upgrade required', authExpired: false });
	});

	it('falls back to a generic message when the error body is not the expected JSON shape', async () => {
		requestUrlMock.mockResolvedValue({ status: 502, text: '<html>Bad Gateway</html>', json: undefined });
		const transport = new ObsidianHttpTransport();
		const outcome = await transport.ingest({ serverUrl: 'https://x.test', token: 't', notes: [] });
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.message).toBe('Request failed (HTTP 502).');
			expect(outcome.authExpired).toBe(false);
		}
	});
});
