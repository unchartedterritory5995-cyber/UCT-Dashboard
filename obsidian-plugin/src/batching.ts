/**
 * Splits a flat list of notes to push into ordered batches bounded by both
 * count and byte size, so one `POST /obsidian/ingest` call never risks the
 * server's hard caps:
 *   - `_MAX_NOTES_PER_BATCH = 2000` (obsidian_staging.py) — an all-or-nothing
 *     rejection of the WHOLE batch if exceeded.
 *   - `_MAX_OBSIDIAN_INGEST_BYTES = 2_000_000` declared Content-Length
 *     (note_sync.py) — also enforced on the raw body stream regardless of
 *     what Content-Length claims.
 *
 * The defaults here (`DEFAULT_BATCH_OPTIONS`) sit well under BOTH server
 * ceilings on purpose: JSON-encoding overhead (per-note keys, quoting,
 * escaping newlines inside markdown) inflates a UTF-8 byte count by a
 * non-trivial margin, and this module has no visibility into the OTHER
 * fields (`consent`, `final`, per-note `vault_path`/`content_hash`/
 * `updated_at`) that also count against the server's 2MB ceiling.
 */
import type { NoteInput } from './types';

export interface BatchOptions {
	/** Never let a batch exceed this many notes. */
	maxNotes: number;
	/** Never let a batch's total `body_md` byte count exceed this. A single
	 * note whose OWN body already exceeds this becomes a singleton batch —
	 * it is not split (the schema has no way to split one note's body across
	 * two ingest calls), and is left for the SERVER to isolate via `tooLarge`
	 * if it truly cannot be stored. */
	maxBytes: number;
}

export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
	maxNotes: 200,
	maxBytes: 1_500_000,
};

// A conservative fixed per-note overhead estimate (JSON punctuation + the
// other three string fields) — not exact, just enough margin that
// `maxBytes` stays a real safety margin under the server's byte ceiling
// rather than a number this module could blow past by counting only
// `body_md`.
const OVERHEAD_PER_NOTE_BYTES = 512;

function utf8ByteLength(s: string): number {
	return Buffer.byteLength(s, 'utf8');
}

/** Pure, deterministic, order-preserving. Returns `[]` for an empty input. */
export function buildBatches(
	notes: NoteInput[],
	opts: BatchOptions = DEFAULT_BATCH_OPTIONS,
): NoteInput[][] {
	if (notes.length === 0) return [];

	const batches: NoteInput[][] = [];
	let current: NoteInput[] = [];
	let currentBytes = 0;

	for (const note of notes) {
		const noteBytes = utf8ByteLength(note.body_md) + OVERHEAD_PER_NOTE_BYTES;
		const wouldExceedBytes = current.length > 0 && currentBytes + noteBytes > opts.maxBytes;
		const wouldExceedCount = current.length >= opts.maxNotes;
		if (wouldExceedBytes || wouldExceedCount) {
			batches.push(current);
			current = [];
			currentBytes = 0;
		}
		current.push(note);
		currentBytes += noteBytes;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}
