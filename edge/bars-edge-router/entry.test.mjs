/**
 * entry.js (the deployed module) and wrangler.json (the deployed configuration): the cache sits in front of
 * the two internal entrypoints ONLY, never in front of the routed Worker, and the routes/bindings are the ones
 * production runs (read back from the live Worker 2026-11-28, version 5ba3e055).
 *
 * `cloudflare:workers` does not exist under node, so a module hook stands it in with the one class entry.js
 * uses; everything else entry.js imports is the real code.
 *
 * Run: node --test   (from edge/bars-edge-router/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return { url: "uct-stub:cloudflare-workers", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "uct-stub:cloudflare-workers") {
      return { format: "module", shortCircuit: true,
        source: "export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }" };
    }
    return next(url, context);
  },
});

const entry = await import("./entry.js");
const worker = (await import("./worker.js")).default;
const { LAKE_ENTRY } = await import("./history.js");
const { TAIL_ENTRY } = await import("./tail.js");
const CONFIG = JSON.parse(readFileSync(new URL("./wrangler.json", import.meta.url), "utf8"));

test("entry.js: the routed Worker is worker.js, and the two cached entrypoints are the names the gateway calls", () => {
  assert.equal(entry.default, worker);
  assert.equal(typeof entry[LAKE_ENTRY], "function");
  assert.equal(typeof entry[TAIL_ENTRY], "function");
  assert.equal(CONFIG.main, "entry.js");
});

test("entry.js: LakePiece and BarsTail answer through serveLakePiece / serveTail", async () => {
  const lake = new entry[LAKE_ENTRY]({}, {});
  const res = await lake.fetch(new Request("https://lake-piece.internal/not-a-piece"));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const tail = new entry[TAIL_ENTRY]({}, {});
  const t = await tail.fetch(new Request("https://bars-tail.internal/api/bars/AAPL?tf=D&warm=1"));
  assert.equal(t.status, 404);
  assert.equal(t.headers.get("cache-control"), "no-store");
});

test("⛔ wrangler.json: NO cache in front of the routed Worker (the entitlement check runs on every request)", () => {
  assert.equal(CONFIG.exports.default.cache.enabled, false);
  assert.equal(CONFIG.exports[LAKE_ENTRY].cache.enabled, true);
  assert.equal(CONFIG.exports[TAIL_ENTRY].cache.enabled, true);
  assert.equal(CONFIG.cache.enabled, true);
  assert.equal(CONFIG.cache.cross_version_cache, true, "a deploy must not empty the lake copy");
  // every exported entrypoint is declared, so none inherits the top-level `enabled: true` by accident
  const exported = Object.keys(entry).filter((k) => k !== "default");
  assert.deepEqual(Object.keys(CONFIG.exports).filter((k) => k !== "default").sort(), exported.sort());
});

test("wrangler.json: the production routes, bindings and variables, so a deploy from here changes none of them", () => {
  assert.equal(CONFIG.name, "bars-edge-router");
  assert.equal(CONFIG.compatibility_date, "2026-09-02");
  assert.equal(CONFIG.workers_dev, true);
  assert.equal(CONFIG.preview_urls, false);
  assert.equal(CONFIG.keep_vars, true, "dashboard variables (LAKE_TIER, TAIL_CACHE switches) survive a deploy");
  assert.deepEqual(CONFIG.routes.map((r) => r.pattern).sort(), [
    "*.uctintelligence.com/*",
    "uctintelligence.com/api/bars/*",
    "uctintelligence.com/api/hist/*",
    "uctintelligence.com/api/seed/*",
    "uctintelligence.com/api/stream/bars*",
  ]);
  assert.deepEqual(CONFIG.r2_buckets, [
    { binding: "HISTORY", bucket_name: "uct-bars-snapshots" },
    { binding: "LIVE1M", bucket_name: "uct-bars-snapshots" },
  ]);
  assert.equal(CONFIG.vars.HISTORY_PREFIX, "hist/");
  assert.ok(!JSON.stringify(CONFIG).includes("CHART_EDGE_SECRET"), "the secret is never in the file");
});
