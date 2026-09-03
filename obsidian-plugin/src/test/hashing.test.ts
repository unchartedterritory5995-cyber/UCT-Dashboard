import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../hashing';

// Ground-truth vectors computed independently via `node -e
// "require('crypto').createHash('sha256').update(X).digest('hex')"` on this
// machine, not transcribed from memory — see the task's own instruction to
// never hand-type a hash constant.
describe('sha256Hex', () => {
	it('matches the known SHA-256 vector for the empty string', () => {
		expect(sha256Hex('')).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});

	it('matches the known SHA-256 vector for "abc"', () => {
		expect(sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	});

	it('matches the known SHA-256 vector for "hello world"', () => {
		expect(sha256Hex('hello world')).toBe(
			'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
		);
	});

	it('is deterministic: the same content always hashes the same', () => {
		const content = '# Daily Notes\n\n- [ ] follow up\n- discussed the trade plan';
		expect(sha256Hex(content)).toBe(sha256Hex(content));
	});

	it('produces a different hash for different content', () => {
		expect(sha256Hex('version 1')).not.toBe(sha256Hex('version 2'));
	});

	it('is sensitive to a single trailing character (no truncation/rounding bug)', () => {
		expect(sha256Hex('same')).not.toBe(sha256Hex('same '));
	});
});
