// tools/vendor_harness/shard.mjs
//
// ─── WHICH SHARD OWNS A CAPTURE OR A SCRIPT — a stable hash, never an order ──
//
// `parallel_run.mjs` splits the member-door census and the vendor harness into
// N processes that run at once inside ONE heavy-lock hold, then merges their
// outputs back into exactly the bytes a single run writes. Membership is a pure
// function of the item's id and N:
//
//     shardOf(id, N) = (first 4 bytes of sha256(id), big-endian) mod N
//
// so it never depends on directory order, on which other files exist, or on
// which shard asked. The id is the repo-relative path with forward slashes
// (`tests/fixtures/vendor/harness/x.json`, `corpus/committed/x.pine`) — the same
// string each output already records in its `file` field.
//
// The spec is 1-based like vitest's `--shard`: `HARNESS_SHARD=2/3` is the second
// of three. A malformed spec THROWS: a typo must never quietly run everything,
// or nothing, and read as a shard.

import { createHash } from 'node:crypto'

export const HARNESS_SHARD_ENV = 'HARNESS_SHARD'
export const CENSUS_SHARD_ENV = 'CENSUS_SHARD'

/** @returns {{index: number, count: number} | null} index is 1-based */
export function parseShard(spec, name = 'shard spec') {
  if (spec === undefined || spec === null || spec === '') return null
  const m = String(spec).trim().match(/^(\d+)\/(\d+)$/)
  if (!m) throw new Error(`${name}=${JSON.stringify(spec)}: expected i/N, e.g. 2/3`)
  const index = Number(m[1])
  const count = Number(m[2])
  if (!(count >= 1 && index >= 1 && index <= count)) {
    throw new Error(`${name}=${JSON.stringify(spec)}: need 1 <= i <= N`)
  }
  return { index, count }
}

/** 0-based bucket of `id` among `count` shards. */
export function shardOf(id, count) {
  const h = createHash('sha256').update(String(id), 'utf8').digest()
  return h.readUInt32BE(0) % count
}

/** Does shard `shard` (from parseShard; null = unsharded) own `id`? */
export function inShard(id, shard) {
  if (!shard) return true
  return shardOf(id, shard.count) === shard.index - 1
}

/** Forward-slash repo-relative id of an absolute path. */
export function idOf(repo, abs, pathMod) {
  return pathMod.relative(repo, abs).replace(/\\/g, '/')
}

/** An optional list file restricting a run to named ids (one per line; `#` comments).
 *  Used by the byte-identity rail to run a fixed subset. Returns a Set or null. */
export function readOnlyList(file, fsMod) {
  if (!file) return null
  const ids = fsMod.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/\\/g, '/'))
  if (!ids.length) throw new Error(`${file}: the only-list is empty`)
  return new Set(ids)
}
