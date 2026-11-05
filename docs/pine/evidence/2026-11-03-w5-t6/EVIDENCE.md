# W5-T6 supervisor + protocol + auth: evidence

Lane: W5-T6 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7, P1 T6), desktop machine.
Branch `feat/pine-w5-t6-supervisor`, based on W5-T1's tip `caa9d246f4` (T1 not yet merged; merge
origin/master in once it is). Tested on master `5d95103c8a` (merge-base with origin/master).
Code tip checked: `318cf7c295`. Local only: no Railway, no flags, no secrets. HMAC keys in the
rails come from `PINE_RUNTIME_TEST_SECRET` / `PINE_RUNTIME_TEST_SECRET_2` when set, otherwise from
the OS RNG, per process.

## What is new
- `services/pine_runtime/auth.mjs`: header `X-Pine-Runtime-Signature: t=<unix>,v1=<hex>`,
  `v1 = HMAC-SHA256(secret, "<t>." + sha256hex(body))`; comma-separated secrets (rotation: any
  listed secret verifies); each secret at least 32 characters, else boot is refused, naming the
  entry's position, never its value; 60 s skew; a replay set that remembers each accepted
  signature for the window.
- `services/pine_runtime/protocol.mjs`: the closed `POST /v1/run` schema of design 3.2. An unknown
  key at any level is a 400; caps are jobs <= 500 (= `scan_run.MAX_RUN_SYMBOLS`), `bars.n` <= the
  bundle's `DEFAULT_LIMITS.HISTORY`, doc <= 128 KiB (= `RUNTIME_MAX_DEFINITION_BYTES`), and `tf` in
  the bundle's `NATIVE_TFS`. Bars must be finite with `t` strictly increasing, base64 must be
  canonical, and the body must be UTF-8. The engine identity is the 5 T3 fields (int == decimal
  string); a mismatch is 409 `runtime:server-engine-mismatch`. `doc: null` is 409
  `runtime:server-doc-unknown` (no cache before T8). Doc and bars hashes are recomputed; a mismatch
  is 422 `runtime:server-integrity`.
- `services/pine_runtime/server.mjs`: the order is signature header and clock (401, before the body
  is read), then the capped body read (400; the declared length and the stream are both capped,
  and this is the ONLY body cap), then HMAC (401), replay (401), schema/identity/hashes, readiness,
  runner. Every refusal runs zero jobs. With no runner (T7) `/ready` is 503 and runs answer 503
  `runtime:server-unavailable`. Runner replies must answer every job once, in order, with a closed
  status, or the result is 500 `runtime:server-failed` (never partial). `/health` is always 200;
  `/ready` needs the bundle, the runner and the canary hook (T9). The dual-stack listener connects
  to itself over 127.0.0.1 AND ::1 and refuses to serve if either fails. The env allowlist (L2) is
  exact names only: no `RAILWAY_` prefix rule, no NODE_OPTIONS, no public-domain names. Refusals
  log status and guard only, and the boot fingerprint line follows 3.8.
- `serverEntry.js` (T1's file) re-exports `NATIVE_TFS` and `DEFAULT_LIMITS`, so the door reads them
  from the bundle and never retypes them. T1's rail EXPORTS list is updated to match.

**Wire decisions T11 must mirror.** These are stated in the protocol.mjs header.
- `definition.doc` is the document's canonical JSON TEXT (a string), and `doc_sha256` is the
  sha256 of its UTF-8 bytes. Both languages therefore hash the same bytes, with no second
  canonical-JSON emitter.
- `bars.sha256 = sha256(u32le(len) "pine-runtime-bars/1" u32le(n) t o h l c v)`.
- Status codes: 400 schema, 401 auth, 409 engine / doc-unknown, 422 integrity, 500 failed,
  503 unavailable.

Engine bump: **NO**. No compute code changed. The bundle gains two re-exports, so its sha256 moves.
That is identity, not output.

## Commands and totals (tip 318cf7c295, tested on master 5d95103c8a)
- Rails: `node --test --test-force-exit services/pine_runtime/test/*.test.mjs` -> tests 33, pass 33,
  fail 0. (A directory argument does not work under Node 24; design 8 step 5's
  `node --test services/pine_runtime/` should read the glob.)
- T1 rail + frontend gate (direct): `serverBundle.rail.test.js` 6/6, `pineRuntimeFrontendGate.test.js` 3/3.
- final-tip (lock `dsk/heavy-final3.lock`):
  `bash $S/final-tip.sh pine-dsk-w5t6 w5t6-final tests/test_script_engine_version_gate.py`.
  Log dir: `_resume-2026-11-01/runs/w5t6-final/`.
  - gate pytest: 46 passed. `test_script_engine_version_gate.py`: 6 passed. Hygiene: clean (34677 files).
  - full chart+hooks vitest: Test Files 1 failed | 1334 passed | 27 skipped; Tests 1 failed | 22366
    passed | 118 skipped. The only failure is `src/hooks/pollingSites.rail.test.js`, the desktop
    baseline. Nothing new.

## Rails red on base, green on tip
Proof script: `redbase.py` (here), byte-exact restore. Log: `_resume-2026-11-01/runs/w5t6-mut/mut2.log`.
- With the three modules absent (as on base): node --test rc=1, tests 4, fail 4, ERR_MODULE_NOT_FOUND
  for auth.mjs / protocol.mjs. Every test in auth/protocol/server/bundle.test.mjs is red on base.
- With serverEntry.js at base bytes:
  - `serverBundle.rail` "exports the entry surface ..." is red (1 failed | 5 passed);
  - `bundle.test.mjs` "loadBundle derives identity, timeframes and the bars ceiling ..." and
    "main() boots ..." are red (2 failed).
- Green on tip: 33/33 and 6/6 as above.

## Mutation table
Lane: the desktop mutation lock `_resume-2026-11-01/dsk/heavy-mut.lock` (the coordinator moved
mutation runs there). Command, from the repo root:
`python docs/pine/evidence/2026-11-03-w5-t6/mutate_node.py $S/mutate.py docs/pine/evidence/2026-11-03-w5-t6/muts.json services/pine_runtime/test/{auth,bundle,protocol,server}.test.mjs`.
`mutate_node.py` runs `mutate.py` unchanged (the same apply, byte-exact restore and assert). It
swaps only the runner (vitest becomes `node --test`) and maps node's failed-test marks, so the
killing tests are named. Log: `_resume-2026-11-01/runs/w5t6-mut/mut3.log`. **58 of 58 killed.**
The no-op control survived, as it must.

Round 1 (mut.log, tip 47cdd7d7af) left 3 survivors:
- `proto:b64-regex-off`: an equivalent second guard. The re-encode check already refuses
  everything the regex did, so the regex was DELETED (one rule).
- `proto:protocol-any` and `proto:missing-keys-ok`: no rail of their own. Rails were added, and
  both are now killed.

| mutation | result | killed by (first tests named) |
|---|---|---|
| `control:noop-comment` | SURVIVED | - |
| `auth:skew-off` | KILLED | header: malformed or absent is refused; the clock allows exactly SKEW_SECONDS either way; unsigned, badly signed, skewed or wrong-key requests are 401 and run zero jobs |
| `auth:skew-one-sided` | KILLED | header: malformed or absent is refused; the clock allows exactly SKEW_SECONDS either way; unsigned, badly signed, skewed or wrong-key requests are 401 and run zero jobs |
| `auth:replay-off` | KILLED | replay: a signature is admitted once inside the window, and forgotten only after it; replay: the same signed request is refused the second time, and runs once |
| `auth:replay-no-prune` | KILLED | replay: a signature is admitted once inside the window, and forgotten only after it |
| `auth:verify-always` | KILLED | the signature is bound to the body, the timestamp and the key; rotation: any listed secret verifies; a removed one does not |
| `auth:body-unbound` | KILLED | v1 is HMAC-SHA256(secret, t "." sha256hex(body)), the wire formula T11 signs with; the signature is bound to the body, the timestamp and the key |
| `auth:weak-secret-ok` | KILLED | a missing, weak or empty secret refuses to boot, and the message never carries a value |
| `auth:empty-ok` | KILLED | a missing, weak or empty secret refuses to boot, and the message never carries a value; main() refuses to boot with a foreign variable or without a secret |
| `auth:first-secret-only` | KILLED | rotation: any listed secret verifies; a removed one does not; rotation over the wire: the second configured secret is accepted |
| `auth:header-uppercase-hex` | KILLED | header: malformed or absent is refused; the clock allows exactly SKEW_SECONDS either way |
| `proto:extra-keys-ok` | KILLED | fuzz (L5): 600 seeded mutations of a valid request are each a 400 at the schema; closed sets: an unknown key is refused at every level |
| `proto:missing-keys-ok` | KILLED | protocol must be 1, and a missing key is named as missing |
| `proto:tf-any` | KILLED | values: tf from the chart set, finite bars, increasing t, canonical base64, exact length |
| `proto:nonfinite-ok` | KILLED | values: tf from the chart set, finite bars, increasing t, canonical base64, exact length |
| `proto:t-unordered` | KILLED | values: tf from the chart set, finite bars, increasing t, canonical base64, exact length |
| `proto:t-nondecreasing` | KILLED | values: tf from the chart set, finite bars, increasing t, canonical base64, exact length |
| `proto:b64-reencode-off` | KILLED | values: tf from the chart set, finite bars, increasing t, canonical base64, exact length |
| `proto:col-length-off` | KILLED | values: tf from the chart set, finite bars, increasing t, canonical base64, exact length |
| `proto:jobs-cap-off` | KILLED | caps: jobs, bars.n, doc bytes, want, ids |
| `proto:jobs-empty-ok` | KILLED | caps: jobs, bars.n, doc bytes, want, ids |
| `proto:bars-cap-off` | KILLED | caps: jobs, bars.n, doc bytes, want, ids |
| `proto:doc-cap-off` | KILLED | caps: jobs, bars.n, doc bytes, want, ids |
| `proto:doc-hash-off` | KILLED | hashes are recomputed: a doc or bars mismatch is refused, an absent doc is doc-unknown |
| `proto:bars-hash-off` | KILLED | values: tf from the chart set, finite bars, increasing t, canonical base64, exact length; hashes are recomputed: a doc or bars mismatch is refused, an absent doc is doc-unknown |
| `proto:engine-off` | KILLED | engine identity: every field must equal the service's; an integer equals its decimal strin; integrity and engine refusals run zero jobs |
| `proto:identity-strict` | KILLED | engine identity: every field must equal the service's; an integer equals its decimal strin |
| `proto:identity-subset` | KILLED | engine identity: every field must equal the service's; an integer equals its decimal strin |
| `proto:dup-job-ok` | KILLED | caps: jobs, bars.n, doc bytes, want, ids |
| `proto:dup-want-ok` | KILLED | caps: jobs, bars.n, doc bytes, want, ids |
| `proto:protocol-any` | KILLED | protocol must be 1, and a missing key is named as missing |
| `proto:profile-any` | KILLED | fuzz (L5): 600 seeded mutations of a valid request are each a 400 at the schema |
| `proto:utf8-lenient` | KILLED | fuzz (L5): 600 seeded mutations of a valid request are each a 400 at the schema; a body that is not valid UTF-8 is refused, even where any string would be accepted |
| `proto:inputs-any` | KILLED | values: tf from the chart set, finite bars, increasing t, canonical base64, exact length |
| `proto:bool-any` | KILLED | fuzz (L5): 600 seeded mutations of a valid request are each a 400 at the schema; values: tf from the chart set, finite bars, increasing t, canonical base64, exact length |
| `proto:doc-not-object-ok` | KILLED | hashes are recomputed: a doc or bars mismatch is refused, an absent doc is doc-unknown |
| `proto:doc-unknown-off` | KILLED | hashes are recomputed: a doc or bars mismatch is refused, an absent doc is doc-unknown |
| `srv:header-before-body-off` | KILLED | unsigned, badly signed, skewed or wrong-key requests are 401 and run zero jobs |
| `srv:declared-cap-off` | KILLED | an oversized body is refused without being buffered, declared or streamed; C:\Users\Patrick\uct-worktrees\pine-dsk-w5t6\services\pine_runtime\test\server.test.mjs |
| `srv:stream-cap-off` | KILLED | an oversized body is refused without being buffered, declared or streamed |
| `srv:verify-off` | KILLED | unsigned, badly signed, skewed or wrong-key requests are 401 and run zero jobs; no log line carries a secret, a body or a source |
| `srv:replay-off` | KILLED | replay: the same signed request is refused the second time, and runs once |
| `srv:ready-without-runner` | KILLED | /health is liveness (always 200); /ready needs the runner and the canary |
| `srv:canary-ignored` | KILLED | /health is liveness (always 200); /ready needs the runner and the canary |
| `srv:ready-before-schema` | KILLED | fuzz over HTTP (L5): signed malformed bodies are 400 with zero jobs run; integrity and engine refusals run zero jobs |
| `srv:results-unchecked` | KILLED | a runner that does not answer every job exactly once is a 500, never a partial reply |
| `srv:results-order-free` | KILLED | a runner that does not answer every job exactly once is a 500, never a partial reply |
| `srv:runner-throw-leaks` | KILLED | a runner that does not answer every job exactly once is a 500, never a partial reply |
| `srv:env-allow-all` | KILLED | main() refuses to boot with a foreign variable or without a secret; env allowlist (L2): any variable outside it refuses boot, by name and never by value |
| `srv:env-railway-prefix` | KILLED | env allowlist (L2): any variable outside it refuses boot, by name and never by value |
| `srv:env-value-in-sentence` | KILLED | main() refuses to boot with a foreign variable or without a secret; env allowlist (L2): any variable outside it refuses boot, by name and never by value |
| `srv:dualstack-proof-off` | KILLED | dual-stack proof can fail: an IPv6-only listener is refused at boot, not served |
| `srv:ipv6only` | KILLED | main() boots: one fingerprint line, and a signed run built for the bundle reaches the runn; a signed valid request reaches the runner once and answers with the service identity |
| `srv:port-zero-ok` | KILLED | PORT: unset is the default; anything but a whole port number refuses boot |
| `srv:main-env-off` | KILLED | main() refuses to boot with a foreign variable or without a secret |
| `srv:identity-from-path` | KILLED | loadBundle derives identity, timeframes and the bars ceiling from the bundle itself |
| `srv:tfset-retyped` | KILLED | loadBundle derives identity, timeframes and the bars ceiling from the bundle itself |
| `srv:maxbars-retyped` | KILLED | loadBundle derives identity, timeframes and the bars ceiling from the bundle itself |
| `entry:drop-tfs` | KILLED | loadBundle derives identity, timeframes and the bars ceiling from the bundle itself; main() boots: one fingerprint line, and a signed run built for the bundle reaches the runn |

## Open items
- **T11 contract.** The Python client must mirror the wire decisions above: doc as text, the bars
  hash layout, the header, and the status codes. A cross-language fixture belongs to T11.
- **T3 not merged.** `ENGINE_FIELDS` is declared in protocol.mjs in T3's order. Once T3 merges,
  import it from `columnDigest.js` through the bundle (one authority).
- **The env allowlist is unproved against a real Railway boot.** The Railway names are listed one
  by one. T10/T20 should confirm them on a real boot: a refusal names the offending variables.
- **The feature_flags ledger row.** `PINE_RUNTIME_SERVICE_SECRET`'s `read_at` names only the web
  pod. It should add `services/pine_runtime/server.mjs` (T12's file; not edited here).
- **Not built here, by design.** Q3 (closed bars only) is the lane's call; the service accepts
  `newestBarIsForming: true`. `/v1/metrics` and the canary are T9; the pool and sandbox are T7.
  `runtimeVersionRefusal` per document is T7's job adapter.
- **`sourceSizeRefusal` is unreachable at the door.** A doc of at most 128 KiB cannot carry a
  source over 512 KiB, so the door does not call it.
