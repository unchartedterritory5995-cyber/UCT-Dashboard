---
id: PACKET-Z
title: RG-33 — cap_universe.json still carries ~102 already-delisted tickers; Entity Master's own reconciliation independently confirms it — one-time prune + a durable guard
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET Z — cap_universe.json delisted-ticker staleness

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs `api/data/cap_universe.json`'s
> delisted-ticker staleness. **Non-collision:** grepped `docs/terminal-research/12-decisions/gates/`
> (every `packet-*` file) and the full `s7-price-level` checkout for `PACKET-[A-Z]` immediately
> before writing this file. At that check: A–Q, T, V, **and W** were taken (`packet-w-` was
> claimed by a concurrent sibling agent's RG-32 packet moments before this one — this packet was
> first drafted as `PACKET-W` and renamed to `PACKET-Z` on discovering that collision, rather than
> overwrite the sibling's file), and a **third** concurrent sibling had just claimed `PACKET-R`
> for RG-12/21-class work. Re-verified `PACKET-Z` (and neighbours X/Y) absent from both worktrees
> — the one hit for `packet-x` was a disposable test fixture inside `tools/sign_gate.py`'s own
> self-check, not a claimed letter — immediately before writing this final version.

⛔ **ZERO PRODUCT CODE.** CP1 is a pure data-file diff (removing entries from a static JSON
list, no code path changed). CP2 is one new test file. Neither touches
`api/services/bars_fetch.py`, `api/services/bars_sqlite.py`, `api/services/delisted_registry.py`,
or anything else flow-worker reaches — **checked, not assumed** (§5). This is not a
member-facing feature; it changes no behaviour except which tickers a background warm loop
touches and which type badge a handful of dead symbols get in search.

---

## 1 · The finding, as registered (RESEARCH_GAPS.md, RG-33 — corrected entry)

RG-33's *original* diagnosis ("`delisted_tickers_bulk.json` is stale, 123 entries are actually
live") was wrong and is struck in the row itself. The **corrected** finding, verified against
Massive's own live API (99/101 exact-date matches, 2 one-day timezone-rounding differences,
**zero** false positives): `delisted_tickers_bulk.json` was accurate. **The stale file is
`api/data/cap_universe.json`** — last touched 2026-07-20, additively ("add 32 live-but-uncharted
tickers," 3710→3742), never a full membership prune, so a ticker delisted before or after that
touch was never dropped. Entity Master's own Checkpoint-7 reconciliation job (live-Massive-only,
never reads either static file) independently proposed — and on 2026-09-02 actually **wrote** —
131 delistings into its own store: 101 matching the original collision set exactly, plus 30 more
delisted *since* `delisted_tickers_bulk.json`'s 2026-08-09 generation that neither static file
knows about yet.

RG-33's own proposed follow-up (not yet built, explicitly out of Entity Master's scope by owner
ruling): **(i)** one-time refresh of `cap_universe.json` to prune delisted names, **(ii)** add a
delisted-check to whatever process appends to it, or **(iii)** separately schedule
`tools/enumerate_delisted.py` on a recurring cadence.

## 2 · Verified still current, 2026-09-22 — re-derived, not restated

**Nobody has touched any of the relevant files since 2026-09-02** (`git log --since=2026-09-02`
on each, run today from `feat/s7-price-level`):

| file | commits since 2026-09-02 |
|---|---|
| `api/data/cap_universe.json` | **0** (last commit ever: `6ea5f7d5e`, 2026-07-20) |
| `api/services/cap_universe.py` | 0 |
| `api/services/delisted_registry.py` | 0 |
| `api/data/delisted_tickers_bulk.json` | 0 (last commit ever: `30c538591`, 2026-08-09, sector enrichment only) |
| `tools/enumerate_delisted.py` | 0 |
| `api/services/entity_master/reconciliation.py` | 0 |

`scripts/entity_master_seed.py` had two commits since (class-share alias handling) — unrelated
to delisted-checking.

**Fresh measurement, today, of `api/data/cap_universe.json`:** a flat JSON list, **3,742
tickers**, exactly the count the 2026-07-20 commit message left it at — confirming zero net
change since. Walking every one of those 3,742 tickers through the **already-shipped**
`api.services.delisted_registry.resolve()` (bulk 2026-08-09 + curated seed + runtime overlay —
the same authority `bars.py`, `discord_render/symbols.py` and `/api/ticker-search` already
trust) finds **102** that resolve as delisted right now — e.g. `AL` (delisted 2026-04-09, the
exact date this program already verified against Massive's live API), `EA` (2026-08-05), `BK`
(2026-05-21), `CMA`, `CTRA`, `CYBR`, `EXAS`… This is one more than the Checkpoint-7 log's
"101 exactly match the original collision set" (`docs/entity-master-implementation-log.md:797`),
consistent with one additional delisting since that log was written, and is the same measurement
method that log used to describe the 101/30 split.

**Entity Master's Checkpoint-7 log (2026-09-02) is the corroborating, MORE current number**,
already applied as a real write (not a proposal) to Entity Master's own store:
`created: 0, delisted: 131, rejected: 0, ambiguous: 0` (`…-implementation-log.md:813`) — 101
matching the static registry's own collision set + 30 delisted since `delisted_tickers_bulk.json`
was generated, found only because reconciliation reads live Massive directly and never touches
either static file (`test_reconciliation_never_imports_delisted_registry`, AST-checked). That
131 is **not independently reproducible here** without a live Massive call, which this task
deliberately does not make (see §6). The 102 measured above is the number CP1 below can act on
today, from files already in the repo, with zero network cost.

**No automated writer exists.** Grepped the whole repo for any `open(..., "w")` / `json.dump` /
`os.replace` touching `cap_universe.json` — none. Every historical change to the file is a
hand-compiled, manually-committed data commit (`6ea5f7d5e` "add 32 live-but-uncharted tickers",
`8526fb033` "remove buyout tickers", `4d3a50c63` "Add 30 ETFs", `ecc0d073f` the original seed).
**This matters for scoping proposal (ii) below — see §4/CP2.**

## 3 · Every consumer of `cap_universe` membership — found, not guessed

`grep -rn "cap_universe\." --include="*.py"` across `api/**`, `scripts/**`, `tools/**`, narrowed
to actual `.symbols()`/`.etf_symbols()`/direct-file-read call sites (not the many files that
merely mention the word in a comment or docstring):

| consumer | what it uses membership for | effect of removing ~102 delisted names |
|---|---|---|
| `api/routers/ticker_search.py` + `api/services/ticker_search_index.py` | builds the "stock" autocomplete rows straight from `cap_universe.symbols()` | **fixes a real mislabel**: today a stale entry surfaces as `type:"stock"` because `/api/ticker-search`'s delisted branch explicitly skips a ticker already found live (`if rec["ticker"] in live_syms: continue`, `ticker_search.py:237`) — so these ~102 currently show as ordinary live stocks, not `type:"delisted"` with a delisted badge. Pruning routes them through `delisted_registry.search()` instead, which is the correct authority and already renders the badge |
| `api/routers/bars.py` (`_carried_symbols`/`_is_carried`) | "no_data vs transient" distinction when Massive returns nothing for a symbol | **no behavioural change** — delisted tickers still have real historical OHLCV from Massive/Polygon, so `bars_fetch` never returns empty for them regardless of `cap_universe` membership; this fallback logic never triggers on this population |
| `api/services/discord_render/symbols.py` (`/chart` resolution) | one authority in a 7-authority OR-chain (`breadth → index → universe → search_index → delisted → entity_master → bars_store`) | **no loss of resolvability** — `delisted` is a later authority in the SAME chain and already fires for these tickers independently; removing them from `universe` just makes the chain attribute them to the correct (delisted) authority instead of the wrong (universe) one |
| `api/services/panel_prewarm.py`, `scripts/prewarm_stock_briefs.py` | iterate the full universe for background panel/AI-brief prewarm | **less wasted work** — `prewarm_stock_briefs.py` in particular pays one Claude generation per symbol; ~102 fewer symbols is ~102 fewer LLM calls for companies that no longer trade |
| `api/services/bars_prewarm.py`, `api/services/bars_universe_crawler.py`, `api/services/ticker_names_prewarm.py`, the startup full-universe pre-cache in `api/main.py` | the "long-tail" background D/W/M bar + company-name warm loops (CLAUDE.md: "3,742 tickers × 5 TFs") | **less wasted provider load, and closes exactly the hazard `delisted_registry.py`'s own docstring names**: *"Kept deliberately OUT of cap_universe.json / the live warmers: a dead ticker must never be pulled into live-price / streaming / freshness / reconciliation loops (it has no live feed; chasing one blanks the chart)"* — today ~102 dead tickers ARE in that loop, contrary to that stated design intent |
| `api/services/substack_article.py` (`_prose_universe`) | validates a ticker mentioned in wire prose is a real, known symbol before linking/citing it in the **published Substack** | **tightens, does not loosen**, a public-facing check — a dead company can no longer pass this gate as if it were a live, chartable name |
| `api/services/rs_ranking.py` | RS-rank universe, but **prefers `wire_data["cap_universe"]`** (pushed daily by the morning-wire engine) and falls back to this on-disk file only when wire_data is absent | out of scope either way — this file is the fallback path, not the primary one; not touched by this packet |
| `scripts/entity_master_seed.py` (Checkpoint 4) | seeded Entity Master's initial "active" set from this list | **the ALREADY-DIAGNOSED, ALREADY-RULED-OUT-OF-SCOPE defect from RG-33 itself** ("Not a Terminal-Next research task and explicitly not Entity Master's to fix... owner ruling: do not expand scope into legacy-dataset cleanup"). This packet does not re-open it or re-run the seed script; it only stops *feeding* the seed script's future re-runs the same stale list |

**Nothing treats `cap_universe` membership as authoritative for anything other than "is this a
coverable ticker."** The one place membership currently decides something ELSE — the
autocomplete `type` badge (`"stock"` vs `"delisted"`) — is a case the prune makes MORE correct,
not less, because the delisted badge is real, already-shipped UI (`ticker_search.py:239-243`)
that these ~102 entries are currently hiding from. No side effect beyond "fewer stale delisted
names get warmed/searched/seeded as if live" was found.

## 4 · Proposed checkpoints

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One-time prune of `api/data/cap_universe.json`: remove every ticker for which `api.services.delisted_registry.resolve(ticker)` is non-`None`, using the registry exactly as shipped today (bulk + seed + overlay, zero new network calls). Preserve the existing single-line JSON format and alphabetical order. Commit message names every removed ticker plus the before/after count. | none | **S** — data-only diff |
| **CP2** | A new, durable regression guard: `tests/test_cap_universe_no_known_delisted.py` asserts `{t for t in cap_universe.symbols() if delisted_registry.resolve(t)} == set()`, failing **by name** (not by count) on any offender. This is the "delisted-check on the writer" from RG-33 proposal (ii), in the only form that actually applies — see §6 for why there is no code *writer* to instrument. | none | **XS** — one new test file |

Both checkpoints are independent and can ship in either order or separately; CP2 does not depend
on CP1 having run first (it would simply fail loudly today, which is expected and correct until
CP1 lands).

### CP1 — exactly what changes

- Input: current `api/data/cap_universe.json` (3,742 entries) + the already-shipped
  `delisted_registry` (no refresh of `delisted_tickers_bulk.json` — see §6 for why that is
  deliberately excluded).
- Method: `[t for t in sorted(cap_universe) if delisted_registry.resolve(t) is None]`, written
  back in the same single-line format the 2026-07-20 commit established ("Single-line format
  preserved").
- Expected result at today's measurement: 3,742 → ~3,640 (102 removed; the exact count and list
  are re-verified at build time, since the registry could have shifted by a name or two between
  this packet's drafting and its build).
- Verification, in the same build: re-run the identical check against the PRUNED file and assert
  zero hits; assert `len(new) == len(old) - len(removed)`; assert every removed ticker is
  actually absent and every non-removed ticker is unchanged (a diff, not a rewrite).
- Explicitly **not** part of CP1: refreshing `delisted_tickers_bulk.json` first (that would also
  catch the +30 tickers only Entity Master's live reconciliation currently knows about — see §6).

### CP2 — exactly what changes

- One new test file. No product code. It reads `cap_universe.symbols()` and
  `delisted_registry.resolve()` — both already public, already-imported-elsewhere functions;
  the test adds no new coupling.
- Failure message names every offending ticker (this repo's own standing convention: "names, not
  counts" — `CoverageLine`, `desk_session_audit`, etc., all cited elsewhere in this program for
  the same reason).
- Mutation-proof at build time: temporarily reintroduce one known-delisted ticker into a copy of
  the list and confirm the test fails; remove it and confirm it passes again.
- This becomes the standing gate any future manual or agent-driven addition to
  `cap_universe.json` must clear before merging — see §6 for why this is the right shape for
  proposal (ii).

## 5 · flow-worker / bars_fetch / bars_sqlite — CHECKED, NOT GUESSED

Ran `tools/flow_worker_watch_coverage.py`'s own `reachable_paths()`/`watched_paths()` against
this worktree, 2026-09-22:

| path | reachable from `api/flow_worker_main.py`? | watched (redeploys flow-worker)? |
|---|---|---|
| `api/services/cap_universe.py` | **NO** | no |
| `api/data/cap_universe.json` | n/a (not a Python import; its only reader is the row above, which flow-worker never imports) | no |
| `api/services/delisted_registry.py` | yes | no |
| `api/services/bars_fetch.py` | yes | no |
| `api/services/bars_sqlite.py` | yes | no |

**flow-worker's process never even imports `cap_universe.py`**, so its content — pruned or not —
is invisible to flow-worker's runtime regardless of watch-list status. `delisted_registry.py`,
`bars_fetch.py` and `bars_sqlite.py` ARE in flow-worker's reachable-but-unwatched set (a real
hazard class for *future* work touching those three files — a change there would not redeploy
flow-worker even though flow-worker runs it), but **neither CP1 nor CP2 touches any of the
three**. CP1 edits only the JSON data file; CP2 adds only a new file under `tests/`, outside
`api/` entirely. This packet's diff is fully outside flow-worker's territory, checked directly
rather than inferred from file location.

Separately, and unrelated to flow-worker: `worker` and `bars-api`'s Railway watch patterns are
`/api/**` and `api/**` respectively, so both redeploy on **any** push touching `api/data/*` —
that is normal, unavoidable, and identical to what any other `api/**` change already costs; it
is not a special property of this packet. `cap_universe.py`'s `@lru_cache(maxsize=1)` loader
means `web` also needs its ordinary restart (which any `api/**` push already causes) to see the
pruned list — again, not a new cost, just the normal deploy-windows rule from
`docs/runbooks/deploy-windows.md` applying as it would to any other data-file change.

## 6 · Recommendation on proposal (ii) and (iii) — why (ii) becomes CP2's shape, and (iii) is explicitly NOT a checkpoint here

**Proposal (ii)** as literally stated — "add a delisted-check to whatever process currently
appends to `cap_universe.json`" — has no code writer to modify (§2: zero automated writers
found). The "process" that appends is a human or an agent hand-compiling a list and committing
it. The only place a check can live for a process shaped like that is the review/CI gate every
such commit already passes through — which is exactly CP2: a standing test that fails by name
if a future addition (or the current state, before CP1 lands) contains an already-known-delisted
ticker. This is proposal (ii)'s intent, built in the only form the actual "writer" admits.

**Proposal (iii)** — scheduling `tools/enumerate_delisted.py` on a recurring cadence — is
**deliberately left out of this packet**, for a reason worth stating plainly rather than
discovering at build time: **its output, `api/data/delisted_tickers_bulk.json`, is a git-tracked
repo file, not a `/data` volume file.** Every other recurring job in this codebase that "just
needs an APScheduler entry" writes to a Railway-persistent volume or an external service; this
script does not — if it ran on a Railway cron (web/worker/bars-api/flow-worker), it would write
to that pod's ephemeral container filesystem, the write would vanish on the next redeploy, and
it would never reach git, so the job would have **zero durable effect** despite looking exactly
like every other "scheduled job" pattern in this repo. A working recurring version needs a
mechanism that also commits and pushes the resulting diff — either a local Windows Task
Scheduler job (in the mold of "UCT Brain Pack Export," which already does a build-then-upload
step) that also runs `git add/commit/push`, or a CI-side scheduled workflow that opens a PR. That
choice — cadence, local-vs-CI, auto-push-to-master vs. review-first, and the recurring cost of
hitting live Massive across the full active+delisted ticker set on a schedule — is a genuine
infrastructure decision for the owner, not a narrow data-hygiene fix, and bundling it into this
packet would violate the "keep each checkpoint's diff as small as possible" instruction this
packet is written under. **Recommended as its own follow-up decision, explicitly not authorized
by anything in this packet.**

## 7 · MUST-BUILD, exactly

**CP1:**
1. Compute `removed = [t for t in cap_universe if delisted_registry.resolve(t) is not None]` against the CURRENT (build-time) state of the shipped registry — re-measure, do not reuse this packet's 102 as a literal list.
2. Write the pruned list back to `api/data/cap_universe.json`, single-line JSON, alphabetically sorted, same encoding as today.
3. Commit message: exact removed count, before/after totals, and either the full removed-ticker list or a pointer to it (e.g. printed in the commit body).
4. In the same change, verify: zero remaining `resolve()` hits on the new file; `new_count == old_count - len(removed)`; every ticker NOT in `removed` still present.

**CP2:**
1. `tests/test_cap_universe_no_known_delisted.py` — one test, reading `cap_universe.symbols()` and calling `delisted_registry.resolve()` per symbol, failing with every offending ticker named in the assertion message.
2. Mutation-proof recorded in the build record: reintroduce one known-delisted ticker → red; remove it → green.

Nothing else. No change to `tools/enumerate_delisted.py`, `delisted_tickers_bulk.json`,
`api/services/delisted_registry.py`, `api/services/entity_master/reconciliation.py`, or any
scheduler wiring. No change to `api/**` files other than the one data file named above.
