# R71 — web watch paths: derived list, one step handed off

## Read-only investigation first (done)

`railway deployment list --service web --json` / `--service flow-worker --json`, most recent
deploy's `meta.serviceManifest.build.watchPatterns`:

| service | watchPatterns | evidence |
|---|---|---|
| `web` | `[]` (empty — no restriction, deploys on every master push) | direct field read |
| `flow-worker` | not present on a SKIPPED deploy's manifest, but the skip mechanism itself fired: `"skippedReason": "No changes to watched files"` on `6685707af` | direct field read |

This confirms both halves of CLAUDE.md's existing claim: `flow-worker` has real, working watch
restrictions (skip mechanism observed firing); `web` has none. It also confirms today's own
R62-F3-attempt finding (two unrelated deploys landing during market open, each restarting a
boot-window tax) was not a one-off — it is exactly what an unrestricted `web` watch list produces
on any day with concurrent push activity.

## The derived list — NOT a guess, walked from the actual import graph

Base set per R71's own instruction, each confirmed against the live deploy metadata rather than
assumed: `api/**`, `app/**`, `requirements.txt` (the only requirements/lock file present),
`railway.json`, `railway.web.json` (confirmed live: `configFile: /railway.web.json`),
`Dockerfile.web` (confirmed live: `build.builder: DOCKERFILE`, `dockerfilePath: Dockerfile.web`).
⛔ **`nixpacks.toml` is NOT in this list** — it exists in the repo (CLAUDE.md's Project Structure
section still names it) but the live deploy metadata shows `web` builds via `DOCKERFILE`, not
Nixpacks. Watching a file that plays no role in this service's actual build would be exactly the
kind of guess this task explicitly says not to make.

**Grepped every `api/**` file for a real (non-test, non-prose) import reaching outside `api/**` —
two found:**

1. `api/services/journal_two/ask_retrieval.py:677` — `from tools.notebook_excerpt_anchor_audit
   import NOT_NAVIGABLE, classify`. Checked `tools/notebook_excerpt_anchor_audit.py`'s own
   imports: stdlib only (`argparse`, `json`, `sqlite3`, `sys`, `collections`) — a clean leaf, one
   file to add.
2. `api/services/alert_user_series.py:617-621` — `_conformance()` dynamically inserts `tools/`
   onto `sys.path` and does `import ast_conformance` (docstring: *"the ONE cross-lane comparator,
   imported by path"*). Checked `tools/ast_conformance.py`'s own dependencies: reads three fixture
   JSONs from `tests/fixtures/ast/{corpus,escapes,scalars}.json` via `load_corpus`/`load_escapes`/
   `load_scalars`, and references `app/src/components/chart/engine/ast/{closedTable.json,
   interpret.js,parse.js}` (already covered by `app/**`). The fixture JSONs are a genuine
   runtime read if `compare_lanes` calls those loaders on the live request path — **not fully
   traced end to end (`cross_lane_report` → `compare_lanes`'s exact call chain), flagged rather
   than asserted.** `LOG_PATH` writes are gated behind CLI-only `REFUSED:` messaging and look like
   offline-script behavior, not the live path.

**Two other categories checked and cleared, not guessed:**
- `sys.path.insert` sites in `api/**` other than the one above: all resolve to `api/`-internal
  paths (`engine.py`'s `MORNING_WIRE_PATH`/uct-intelligence paths — both external local-dev
  directories outside this repo entirely, already documented as local-dev-only fallbacks in
  CLAUDE.md; `intelligence.py`/`brain_service.py` similarly point at the installed brain pack
  path, not a repo directory).
- `importlib.import_module(...)` call sites: both resolve to computed `api.*` module paths
  (`wisdom_publish.py`'s `ADAPTER_ROUTES_MODULE` constant; `concept_vocabulary.py`'s
  `_function_node` takes an arbitrary `module_name` from citation metadata — genuinely dynamic,
  can't be captured by a static glob, and looks like an audit/verification helper rather than a
  live-request dependency; not added to the list on that basis).

## Recommended final watch-path list for `web`

```
api/**
app/**
requirements.txt
railway.json
railway.web.json
Dockerfile.web
tools/notebook_excerpt_anchor_audit.py
tools/ast_conformance.py
```

Plus, **unresolved and worth 10 more minutes from whoever applies this**: whether
`tests/fixtures/ast/corpus.json`, `escapes.json`, and `scalars.json` need their own entries —
trace `alert_user_series.cross_lane_report` → `ast_conformance.compare_lanes` to confirm whether
the live request path actually calls the three `load_*` functions, or whether they are exercised
only by `ast_conformance.py`'s own CLI/test entry points.

## ⛔ BLOCKED-permission — the one step no session in this environment can do

Railway's `watchPatterns` field is **dashboard-only** (CLAUDE.md's own prior note, now confirmed
twice over): the `railway` CLI (v4.35+, checked `--help` on every subcommand including `service`)
has no command that writes it, and the field is absent from `railway.json` by design (shared by
web + worker; a repo-file value there would apply to both).

Attempted the other route available to this session — Chrome browser automation — since it was
used successfully for OI-13's `/chart` proof earlier in this programme. `railway.com/dashboard`
loaded a **Login** dialog ("Continue with GitHub" / "Log in using email"): this Chrome profile
has no active Railway session. Per this session's own standing rules, entering credentials or
completing an OAuth sign-in on the owner's behalf is prohibited outright, session-scoped consent
notwithstanding — so this is not a retry-able failure, it is a hard stop for any session in this
environment.

**Exact values for the owner to paste in** (Railway dashboard → `web` service → Settings →
Source → Watch Paths, or equivalent labelled field):

```
api/**
app/**
requirements.txt
railway.json
railway.web.json
Dockerfile.web
tools/notebook_excerpt_anchor_audit.py
tools/ast_conformance.py
```

## The proof, staged and ready to run the moment the setting is applied

1. Note the current `railway deployment list --service web --json | head -1` deployment id/time
   as the baseline.
2. Push a genuinely docs-only commit to `master` (e.g. this very file, or a trivial `docs/**`
   edit) and note the push timestamp.
3. Wait 10 minutes. `railway deployment list --service web --json | head -1` — expect **no new
   deployment** (or a `SKIPPED` one with `"skippedReason": "No changes to watched files"`,
   matching what `flow-worker` already shows today).
4. Push a trivial `api/**` change (or wait for the next real one) and confirm it DOES trigger a
   real `SUCCESS` build within the normal window — the negative control, so a broken/over-broad
   pattern that blocks ALL deploys is caught rather than silently celebrated as "fewer deploys."
5. Record the before/after deploys-per-day figure in R64's line, per R71's own instruction.

Not run yet — depends on step 0 (the owner's paste) landing first.
