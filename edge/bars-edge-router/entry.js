/**
 * The Worker's module entry (wrangler.json `main`). Deliberately thin: everything it runs lives in modules
 * the node rails import directly (worker.js, history.js, tail.js); only `cloudflare:workers` is here.
 *
 * Three entrypoints, and which of them has a cache in front (wrangler.json `exports`, Workers Cache):
 *   default     the routed Worker (worker.js). NO cache in front: it runs on every request, so the
 *               entitlement check runs on every request.
 *   LakePiece   one lake piece out of R2 (history.js serveLakePiece). CACHED, tiered.
 *   BarsTail    one /api/bars answer from the tier (tail.js serveTail). CACHED, a few seconds.
 * The two cached entrypoints have NO route, hostname or workers.dev URL: the only way in is
 * `ctx.exports.<name>.fetch` from the default entrypoint, AFTER it has proven the caller entitled.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "./worker.js";
import { serveLakePiece } from "./history.js";
import { serveTail } from "./tail.js";

export class LakePiece extends WorkerEntrypoint {
  fetch(request) { return serveLakePiece(request, this.env); }
}

export class BarsTail extends WorkerEntrypoint {
  fetch(request) { return serveTail(request, this.env); }
}

export default worker;
