/**
 * Content hashing. `content_hash` is opaque to the server — it only ever
 * compares a newly-pushed hash against the one already stored for that
 * vault_path (`obsidian_staging.ingest_batch`: "an existing row whose stored
 * content_hash already equals the pushed one is neither rewritten nor its
 * received_at bumped"). SHA-256 hex is used here purely because it is a
 * standard, cheap, collision-safe choice — nothing about the server depends
 * on this specific algorithm.
 */
// Bare "crypto" (not "node:crypto") — esbuild.config.mjs marks Node's
// builtins external by their BARE specifier only (mirrors the official
// obsidianmd/obsidian-sample-plugin scaffold's `external` list); the
// "node:"-prefixed form is a distinct specifier esbuild does not resolve
// the same way and fails the production bundle.
import { createHash } from 'crypto';

export function sha256Hex(content: string): string {
	return createHash('sha256').update(content, 'utf8').digest('hex');
}
