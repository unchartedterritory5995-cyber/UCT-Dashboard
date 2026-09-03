/**
 * HTTP transport to the note-sync server. Split into a plain `Transport`
 * interface (what `sync-manager.ts` depends on — trivially fakeable in
 * tests) and `ObsidianHttpTransport`, the one concrete implementation that
 * actually talks to the network via Obsidian's `requestUrl`.
 *
 * `requestUrl` (not the global `fetch`) is used deliberately — Obsidian's
 * own docs recommend it for plugin network calls because it runs outside
 * the renderer's CORS enforcement, which a plain `fetch()` to an arbitrary
 * member-configured server origin would otherwise be subject to.
 *
 * Endpoints (contract: api/routers/note_sync.py):
 *   POST {serverUrl}/api/j2/notes/connectors/obsidian/redeem
 *   POST {serverUrl}/api/j2/notes/connectors/obsidian/ingest   (Bearer token)
 */
import { requestUrl } from 'obsidian';
import type { IngestRequestBody, IngestResponse, NoteInput, RedeemResponse } from './types';

const REDEEM_PATH = '/api/j2/notes/connectors/obsidian/redeem';
const INGEST_PATH = '/api/j2/notes/connectors/obsidian/ingest';

export function joinUrl(serverUrl: string, path: string): string {
	const base = serverUrl.replace(/\/+$/, '');
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${base}${suffix}`;
}

export interface RedeemParams {
	serverUrl: string;
	code: string;
	vaultId: string;
	label: string | null;
}

export type RedeemOutcome =
	| { ok: true; deviceId: string; token: string; vaultId: string }
	| { ok: false; status: number; message: string };

export interface IngestParams {
	serverUrl: string;
	token: string;
	notes: NoteInput[];
	manifest?: string[];
	final?: boolean;
}

export type IngestOutcome =
	| { ok: true; response: IngestResponse }
	// `authExpired` is true for a 401 specifically — the caller (sync-manager)
	// uses this to distinguish "the token was revoked, tell the member to
	// reconnect" from any other error, which must never loop/retry the same
	// way (see the module docstring on sync-manager.ts).
	| { ok: false; status: number; message: string; authExpired: boolean };

export interface Transport {
	redeem(params: RedeemParams): Promise<RedeemOutcome>;
	ingest(params: IngestParams): Promise<IngestOutcome>;
}

/** Best-effort extraction of FastAPI's `{"detail": "..."}` error shape;
 * falls back to a generic message for anything else (a proxy error page,
 * an empty body, malformed JSON). Never throws. */
function extractDetail(bodyText: string, status: number): string {
	try {
		const parsed = JSON.parse(bodyText) as { detail?: unknown };
		if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail;
	} catch {
		// not JSON — fall through
	}
	return `Request failed (HTTP ${status}).`;
}

export class ObsidianHttpTransport implements Transport {
	async redeem(params: RedeemParams): Promise<RedeemOutcome> {
		const res = await requestUrl({
			url: joinUrl(params.serverUrl, REDEEM_PATH),
			method: 'POST',
			contentType: 'application/json',
			throw: false,
			body: JSON.stringify({ code: params.code, vaultId: params.vaultId, label: params.label }),
		});
		if (res.status >= 200 && res.status < 300) {
			const body = res.json as RedeemResponse;
			return { ok: true, deviceId: body.deviceId, token: body.token, vaultId: body.vaultId };
		}
		return { ok: false, status: res.status, message: extractDetail(res.text, res.status) };
	}

	async ingest(params: IngestParams): Promise<IngestOutcome> {
		const body: IngestRequestBody = { consent: true, notes: params.notes };
		if (params.manifest !== undefined) body.manifest = params.manifest;
		if (params.final !== undefined) body.final = params.final;

		const res = await requestUrl({
			url: joinUrl(params.serverUrl, INGEST_PATH),
			method: 'POST',
			contentType: 'application/json',
			throw: false,
			headers: { Authorization: `Bearer ${params.token}` },
			body: JSON.stringify(body),
		});
		if (res.status >= 200 && res.status < 300) {
			return { ok: true, response: res.json as IngestResponse };
		}
		return {
			ok: false,
			status: res.status,
			message: extractDetail(res.text, res.status),
			// A 401 here means EXACTLY one thing per the server contract:
			// the device token is missing/invalid/revoked
			// (`_authenticate_obsidian_device`) — never a transient blip.
			authExpired: res.status === 401,
		};
	}
}
