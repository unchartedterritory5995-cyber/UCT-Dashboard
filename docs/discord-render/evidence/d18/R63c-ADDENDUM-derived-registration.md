# R63(c) ADDENDUM — registration derived from the manifest, not hand-picked

## What changed

`api/main.py::_start_cold_path_boot_preload` no longer hand-registers a fixed list. It reads
R63(a)'s manifest (`docs/discord-render/instruments/oi44_cold_paths.py --measure`), takes every
module measured above **50 ms**, and registers each via a generic `importlib.import_module`
loader through `cold_start_guard`. The two `cap_universe` caches stay hand-registered as the
addendum specified — they are a DIFFERENT resource (a cached data load) than the plain-import
cost the manifest measures, not a hedge against the derivation.

## The measurement had never actually been run

The manifest's `measured` field was `[]` — the scanner's `--measure` machinery existed, sandboxed
and self-checked, but had never been invoked against the full 502-module list. Running it for
real was the first blocker.

### Fixed along the way: the census cost scales to hours across 502 subprocesses

`import conftest` + `shared_data_root_census()` measured **~34 s** on this box's *ordinary* load
(several concurrent sessions + a local LLM server routinely running here). The original
`_PRELUDE` re-paid that cost fresh in every one of 502 child subprocesses — hours, not minutes.
`_census_env()` now derives the sandbox pins ONCE in the parent and hands each child the result
as plain environment variables; the child never imports `conftest` at all. Real run: **502
modules in ~19 minutes** instead of an estimated 4+ hours. The scanner's self-check was widened
from a 30 s timeout (too tight for this box's real load, not a defect) to 90 s for the
independent slow-path control, and now asserts the fast and slow paths agree.

## The finding that mattered most: `api.main` at 17,300 ms is a methodology artifact

The single largest number the scanner has ever produced. `api.main` is the ASGI entry point;
the only two places that lazily `import api.main` (`api/routers/auth.py`'s maintenance-mode
toggle, `api/services/discord_index_close.py`'s uptime read) can only execute at all once
`api.main` has already finished importing — their own existence as callable code depends on it.
A "lazy" import of the entry point from inside the app it defines is a guaranteed cache hit in
every real request path. Excluded by name (`EXCLUDED_SELF_REFERENTIAL_MODULES`), not by a general
heuristic — the entry point has exactly one name in this codebase, and a broader rule for a
population of one would be guessing ahead of evidence.

⛔ **Reporting it unexcluded would have been actively misleading**, not just noisy: it would
have buried the entry that is real.

## The finding that IS real: `api.services.options_chain` at 13,370 ms

Lazily imported from three call sites in `api/services/voice_tool_impls.py` — the yfinance
fallback path for option expirations and option chains when Polygon (the primary provider)
fails or is unconfigured. No self-referential guarantee here: this is an ordinary service
module, and the first voice query that falls through to this fallback pays 13.4 seconds. This
was undiscovered before this measurement run existed. It is now covered by the same derived
registration that covers everything else above threshold — no separate fix was needed once
the mechanism could see it.

## What the 392 candidates actually cost, measured — not the naive sum

The manifest's per-module numbers are each module measured **in total isolation**; many share
heavy transitive dependencies (pandas, numpy, matplotlib, the Anthropic SDK), so summing them
naively (**359 seconds**) wildly overstates the real cost of preloading them together, where
each shared dependency is paid once.

Measured for real: importing all 392 candidates, individually guarded (matching exactly how
`cold_start_guard._run_one` runs each loader), immediately after a normal `api.main` boot in a
sandboxed subprocess:

```
7,000.6 ms total, 0 failures, all 392 modules
```

Cross-referencing against what a normal `api.main` boot already imports eagerly: **156 of the
392 are already warm** by construction (registering them is a harmless no-op); **236 are
genuinely lazy-only** and would still be cold on whichever request happens to hit them first
without this mechanism. `options_chain` is the largest of the 236.

⭐ This is a boot-thread cost, off the request path, paid after Railway's healthcheck has
already passed (`/api/health` answers as soon as uvicorn binds — see `readiness.py`). Seven
seconds once, in the background, is the entire price for removing 236 real cold-start risks
from members' requests, one of them 13.4 seconds by itself.

## Rails and mutations

`cold_path_manifest.py`: 13 tests (loading, threshold boundary exclusive-not-inclusive,
unmeasurable entries excluded not defaulted, ranking, the `api.main` exclusion, absence
handling). `test_cold_path_boot_preload_wiring.py`: +3 tests proving the derivation end-to-end
against an injected synthetic manifest (never the real file, so the test is deterministic
regardless of the real manifest's regeneration state) — every above-threshold entry registered,
a derived loader actually resolves to the real module, and a missing manifest degrades to the
two hand-registered entries, never to zero and never to a crash.

```
target=cold_path_manifest.py  sha256=7b9b03696f1c94a771de61841b652d1c68eb49f0566e8a50ab9b3ff2b995666f
CONTROL pristine                          13 passed
P1-unmeasurable-treated-as-qualifying  RED
P2-boundary-becomes-inclusive          RED
P3-not-ranked                          RED
P4-parse-error-raises-instead-of-None  RED
P5-summary-hides-absence               RED
P6-exclusion-list-ignored              RED
restored sha256 identical, MATCH=True
TOTALS mutate_cold_path_manifest mutations=6 red=6 not_red=0
```

⚰️ Two bad mutation choices found and fixed before trusting the result. P4's first draft
narrowed `except Exception` to `except ValueError`, which caught the JSON parse error anyway —
`json.JSONDecodeError` is already a `ValueError` subclass, so nothing was actually narrowed;
fixed to `except KeyError`. P1/P2's anchors went stale mid-session when the exclusion filter
was added to the same expression they targeted, reporting `ANCHOR-STALE` rather than a false
pass — exactly the failure mode a stale anchor is supposed to produce.

## R63(d) — the acceptance tool, built and tested, not runnable for a real verdict yet

`tools/r63d_verify_boot_window_stalls.py` joins `stall_record`'s durable JSONL against
`cold_path_instrument`'s durable JSONL (via the join already built in R63(b)) and applies the
acceptance rule verbatim: **zero qualifying stalls, or every one joined to a named cause** — not
"mostly," every one. Pods are counted by distinct `pid`, never assumed from elapsed calendar
time. 13 tests against synthetic fixtures. Cannot produce a real verdict until ≥10 real pod
boots have accumulated data on the volume — that is calendar time passing in production with
this derivation live, not more code.

## Disposition

R63(c) addendum **BUILT, DERIVED, MEASURED SAFE, PROVEN** — 392 candidates registered
(236 of them genuinely new coverage), api.main correctly excluded, 7s real aggregate boot cost
measured. R63(d) tooling **BUILT, not runnable for a verdict** — needs the derivation live in
production for ≥10 pod boots first.
