import { describe, expect, it } from 'vitest';
import { buildBatches, type BatchOptions } from '../batching';
import type { NoteInput } from '../types';

function note(path: string, bodyLen = 10): NoteInput {
	return {
		vault_path: path,
		content_hash: 'h',
		body_md: 'x'.repeat(bodyLen),
		updated_at: '2026-09-02T00:00:00.000Z',
	};
}

describe('buildBatches', () => {
	it('returns an empty array for no notes', () => {
		expect(buildBatches([])).toEqual([]);
	});

	it('puts everything in one batch when well under both limits', () => {
		const notes = [note('a.md'), note('b.md'), note('c.md')];
		const batches = buildBatches(notes);
		expect(batches).toEqual([notes]);
	});

	it('splits on the note-count ceiling', () => {
		const opts: BatchOptions = { maxNotes: 2, maxBytes: 1_000_000 };
		const notes = [note('a.md'), note('b.md'), note('c.md'), note('d.md'), note('e.md')];
		const batches = buildBatches(notes, opts);
		expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
		// Order and identity are preserved across the split.
		expect(batches.flat().map((n) => n.vault_path)).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
	});

	it('splits on the byte-size ceiling', () => {
		// Each note's body is 100 bytes; a 250-byte ceiling (before the
		// per-note overhead constant) forces a new batch well before the
		// count ceiling would ever fire.
		const opts: BatchOptions = { maxNotes: 1000, maxBytes: 250 };
		const notes = [note('a.md', 100), note('b.md', 100), note('c.md', 100)];
		const batches = buildBatches(notes, opts);
		// With a ~512-byte fixed overhead per note dominating the 250-byte
		// ceiling, every note ends up in its own batch — the point of this
		// test is that it splits at all, not the exact shape.
		expect(batches.length).toBeGreaterThan(1);
		expect(batches.flat()).toHaveLength(3);
	});

	it('gives a single oversized note its own batch instead of dropping or crashing', () => {
		const opts: BatchOptions = { maxNotes: 10, maxBytes: 1000 };
		const huge = note('huge.md', 5000);
		const notes = [note('small.md', 10), huge, note('small2.md', 10)];
		const batches = buildBatches(notes, opts);
		// The huge note must appear exactly once, alone in its own batch —
		// it is never split, never silently dropped.
		const huges = batches.filter((b) => b.some((n) => n.vault_path === 'huge.md'));
		expect(huges).toHaveLength(1);
		expect(huges[0]).toHaveLength(1);
		expect(batches.flat()).toHaveLength(3);
	});

	it('never produces an empty batch', () => {
		const opts: BatchOptions = { maxNotes: 1, maxBytes: 1_000_000 };
		const notes = [note('a.md'), note('b.md'), note('c.md')];
		const batches = buildBatches(notes, opts);
		expect(batches.every((b) => b.length > 0)).toBe(true);
		expect(batches).toHaveLength(3);
	});
});
