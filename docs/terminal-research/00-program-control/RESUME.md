# RESUME — cold-start entry point (Document B §3A)

---

# 🧭 RESUME — 2026-09-13. **§6 is EMPTY; the programme is waiting on a MEASUREMENT.**

> The 2026-09-13 restart is over and its COLD START block is retired. Everything below was
> measured, not remembered.

## 0. Where things stand

| | |
|---|---|
| §6 build queue | ✅ **EMPTY** — every numbered row DONE with its SHA. **AUTHORIZED-AND-UNBUILT = 0.** |
| audit counts | DONE **11** · BLOCKED-DATA **5** · BLOCKED-OWNER **8** · BLOCKED-SPEC-READ **5** · BLOCKED-DEPENDENCY **2** · EXCLUDED **1** = **32**. ⛔ NOT-YET-CLASSIFIED **0**. |
| S7 | **8 of 8 types registered; every CP3 merged and ARMED.** Seven dark sweeps ticking. |
| next decision | **next weekend's dark read** — not a build. |

## 1. Reopen

```sh
cd /c/Users/Patrick/uct-worktrees/s7-price-level      # branch feat/s7-price-level -> pushes to master
cd /c/Users/Patrick/uct-worktrees/terminal-research   # branch terminal-research
```

**Verify each against origin** (run in each tree):

```sh
git fetch -q origin && git status -sb && git log --oneline -1
```

⚠️ `git worktree list` shows ~60 trees. **They belong to other workstreams — do not prune, reuse
or merge them.** In particular `feat/s7-indicator-condition` @ `4e04f43f0` (a locked agent tree) is
a redundant re-derivation of `ccbab9bcd`, already on master; its only unique content is a stale
parity test whose `_EXPECTED` is missing three types, so merging it would **regress three
siblings**. Abandon it unmerged.

## 2. The Monday 09:05 ET command — verbatim, all seven dark sweeps

**PowerShell / cmd:**

```
railway ssh --service web "/opt/venv/bin/python tools/s7_price_level_report.py --ticking"
```

**Git Bash** — ⛔ `MSYS_NO_PATHCONV=1` is REQUIRED, or MSYS rewrites `/opt/venv/bin/python` into
`C:/Program Files/Git/opt/...` and the pod answers `sh: 1: C:/Program: not found`:

```
MSYS_NO_PATHCONV=1 railway ssh --service web "/opt/venv/bin/python tools/s7_price_level_report.py --ticking"
```

Exit **0** = ticking, or legitimately outside the window · **1** = stalled, or never started while
INSIDE the window. Per-type staleness bounds, **derived from the sweep table, never typed**:
`PRICE-LEVEL=180s · EVENT-PROXIMITY=26h · POSITION-RISK=180s · SCAN-MEMBERSHIP=26h ·
CATALYST-MATCH=26h · REGIME-CHANGE=1h · INDICATOR-COND=180s`.

⚠️ **F-S7-PL-2, PROVISIONAL:** per-sweep windows **narrow** what `--ticking` calls a stall — a
sweep that dies mid-window and is only checked after the close now reports `0`. Recommendation:
**keep the narrowing** (the alternative flags every sweep every weekend and gets muted). The 09:05
check is inside every window, so it is not a gap today.

## 3. ⭐ What next weekend's read decides — and `legacy_only` is the deciding column

Four outcomes per predicate: `agreed` · `new_only` · **`legacy_only`** · `not_comparable`.

⛔ **Read `legacy_only` first.** Agreement is cheap when both sides are quiet, and a high `agreed`
count mostly measures how often the sweep ran. **`legacy_only` is the only column that can say the
new lane would have DROPPED a member's alert** — it is the number that decides whether a flip is
safe. `new_only` is the mirror (the new lane fires where legacy did not) and is a product question,
not a safety one.

⛔⛔ **AND FOR `indicator-condition`, EXPECT `not_comparable` TO BE ESSENTIALLY EVERYTHING.** F-S7-IC-1:
31 legacy addresses vs 142 book metrics, **empty intersection** — one rename (`close` ↔ `ohlcv.c`)
and thirty genuine absences. The two lanes never met; a comparison is undefined, not a
disagreement. Production also holds **zero active indicator alerts** today, so its honest projected
N is **0 with that reason**. Its heartbeat is the liveness signal, not its outcome counts.

## 4. Flags — seven dark sweeps armed, and what must NOT change

All armed on **`web`**, all verified reading `1` in-process (never `--kv`):

```
ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED        ALERT_TAXONOMY_CATALYST_MATCH_DARK_ENABLED
ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED    ALERT_TAXONOMY_REGIME_CHANGE_DARK_ENABLED
ALERT_TAXONOMY_POSITION_RISK_DARK_ENABLED      ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED
ALERT_TAXONOMY_INDICATOR_CONDITION_DARK_ENABLED    (armed 2026-09-13 20:48:30 UTC)
ALERT_TAXONOMY_DOCUMENT_ARRIVAL_ENABLED   (live, not dark)   D2_SAMPLE_PERSIST_ENABLED
```

⛔ **`CANONICAL_INDICATOR_AXIS_ENABLED` stays UNSET.** D2 CP4 declares the indicator axis; nothing
reads it for real yet, so arming it lights a door with no room behind it.

**Derive the full armed roster — never hand-list it** (118+ flags; a typed list beside the artifact
that owns it is this programme's most-repeated defect):

```sh
python -c "import json,io; d=json.load(io.open('docs/feature_flags.json',encoding='utf-8')); \
print(*[k for k,v in d['flags'].items() if v.get('status')=='armed'], sep=chr(10))"
```

`python tools/flag_ledger_audit.py` compares the ledger against Railway itself. **0/0/0/0** at this
commit.

## 5. ⛔ What a session must NOT do

1. **No unscoped `pytest tests/`.** Collection alone reached 6.6 GB; an unscoped run reached 18 GB
   and was OOM-killed. **Name the files.** `-k` does not scope — everything is still collected.
2. **No `railway redeploy`.** A `--set` on `web` auto-redeploys (now **five** measurements). Verify
   a NEW BOOT by `/api/health` `uptime_seconds` resetting, never by `--kv`.
3. **No marker bump without a MEASURED strand.** `python tools/flow_worker_watch_coverage.py`
   decides it. A bump during RTH drops the Massive OPRA socket and that tape gap is PERMANENT
   until the T+1 flat file.
4. **No flag changes.** Arming is the owner's flip.
5. **No master push Mon–Fri 09:00–16:00 ET**, and **one master merge at a time repo-wide** —
   Railway `web` must read SUCCESS before the next push. Other sessions push to this same master
   (the discord-render workstream moved it 9 commits during this session).
6. **Do not touch other sessions' work** — `stash@{0}` *"broker-sync WIP"* is not ours; the
   wisdom-loop extraction job and its worktrees are not ours.

## 6. The three owner items — UNCHANGED

1. **A9 / A11 / A13** — **BLOCKED-OWNER** on the flips after the dark reads.
2. **F-S2-1** — baselined is correct; tightening the guards is member-visible and waits for
   **OI-06**, with its own PR then.
3. **S6 CP2–CP5** — **SPEC-BLOCKED** on four owner rulings, each named in §4: SET-vs-WEIGHTED-SET,
   derive-vs-mirror, `personal_edge`, paid-gating.

## 7. ✅ VERDICT — BUILD-COMPLETE TO GATE (verified 2026-09-13)

> **Every buildable-and-signed unit is built and verified. The remaining 21 items are blocked on
> data, owner or spec-read only.**

**11 DONE · 21 blocked (5 DATA · 8 OWNER · 5 SPEC-READ · 2 DEPENDENCY) · 1 EXCLUDED = 32.**
AUTHORIZED-AND-UNBUILT **0** · NOT-YET-CLASSIFIED **0** · signed-and-unbuilt **0** ·
built-and-unsigned **1** (S3, the recorded historical case).

⭐ **No dependency chain bottoms out in a buildable-and-unsigned item.** Every terminal is an
unsigned gate line awaiting the owner's read, never something this programme may sign for itself.

### Findings from the verification pass: **3 opened → 0 open**

| id | closed by |
|---|---|
| **F-S7-PL-3** | `9b1d6c537` — the report's self-check derives its count from the registry `--ticking` reads; control registers a throwaway eighth descriptor and watches the count follow |
| **F-GATE-1** | `80247f2f5` — `s7-event-proximity` line 2 re-pinned to `4f522011c`, derived from git history; line 1 untouched; the convention written once into PROGRAM_STATUS.md's gate rule as **b-2** |
| **F-FLAG-1** | `bd57ffaf7` (docstring) + ledger advisory — **advisory only**, no flag and no audit behaviour changed; follow-up named to the **flow workstream** |

⚠️ **Still open, and each is somebody's decision rather than a build:** F-S7-IC-2, F-S7-PL-2
(PROVISIONAL — recommend KEEP), F-D2-3, F-CAT-2, F-D2-1, F-S7-RC-1, F-S7-RC-3, F-I1-2 (parked).
PART D of `OWNER_INPUTS.md` carries the three that need a CHOOSE.


## 1. BUILT — the roster

| system | state | merge |
|---|---|---|
| **H14** placeholder-stop | one detector, five call sites, one-definition rail | `94209e962` (+ AMD fixture `de519c969`) |
| **S4** Context Bus | **CP1** — divergence detector, read-only, mounts nothing | `76c62c494` |
| **S7** `position-risk` | **CP1–CP2**, DARK | `2b0547949` |
| **S7** `scan-membership-change` | **CP1–CP2**, DARK | `0c6caf25b` |
| **S7** `regime-change` | **CP1–CP2**, DARK | `0392c78bf` |
| **S7** `indicator-condition` | **CP1–CP2**, DARK | `ccbab9bcd` |
| **D2** CP3 sample store | durable, RTH-gated, log-only | `0b8cf4c41` + init fix `40bf07c99` |
| alerts webhook | read at call time, not import | `73d997520` (marker bump #7) |
| doc-SHA rail | derives approval fingerprints | `d1398df5a` |

**S7 is 8 of 8 named types registered** — 4 live, 4 dark. `_EXPECTED` is seven.
**No marker bump for any S7 merge**; **one bump (#7)** for `alerts.py`, measured, weekend, no tape.

## 2. ⛔ DATA-BLOCKED — waiting on a measurement, not a decision

| item | blocked until | note |
|---|---|---|
| **D2 CP3** | **Monday's session** | ≥200 AGREED rows spanning ≥1 session, zero inequality. ⚠️ The reader is COLD (`ticker_returns._close`, Desk pages only) — a short count is a reader problem, **not** a reason to lower the threshold |
| **S7 `price-level` CP3 verdict** | five full sessions of dark run | reads start Monday |
| **S7 `event-proximity` CP3 verdict** | five full sessions | 07:05 / 18:05 ET slots |
| **S7 CP3 for the other four types** | their own dark reads, which need CP3 authorized first | none authorized |
| **A9** Screening | `scan-membership-change` **CP3** | CP1–CP2 fires nothing; A9 needs fires |
| **A11** Breadth & Regime | `regime-change` CP3 **+** the one-regime ruling **+** D2 coverage | three blockers, one of them owner's |
| **A13** Journal | `position-risk` CP3 **+** D2 journal coverage **+** S5 | three blockers |

## 3. ⛔ OWNER-BLOCKED — waiting on a ruling

| item | blocked on |
|---|---|
| **S1** Terminal Shell · **S2** Command/Search · **A2** Charts | **OI-06** — both are PROVISIONAL-SHIPPED ahead of it, and the owner ruled its findings get diffed against what shipped |
| **S9** Entitlements · **A14** Portfolio & Risk | **OI-03(a)(b)** and **OI-12**; A14 is also deferred by **D8** in its own block |
| **F-I1-2** | browser checks the owner runs |
| **A11**'s first blocker | the one-regime-authority ruling (two classifiers live) |

## 4. ⛔ SPEC-BLOCKED — written, unsigned, awaiting the owner's reading

| spec | what it asks for |
|---|---|
| **PRD-D2 §9.5 + SPEC-D2 §5.4** | the **indicator axis**. `indicator-condition` CP3 is blocked on it. Approval block EMPTY, no code written |
| **D3** Realtime Streaming | gate written, approval EMPTY |
| **D4** Caching & Serving | gate written, approval EMPTY |
| **S5** Persistence & User State | gate written, approval EMPTY — and A12/A13 wait on it |
| **S6** Personalization | PRD + spec written, no gate by instruction |

## 5. ⭐ MONDAY — TWO LINES, and that is the whole morning check

Git Bash needs the prefix; drop it in PowerShell. **Run them in this order.**

```
MSYS_NO_PATHCONV=1 railway ssh --service web   "/opt/venv/bin/python tools/s7_price_level_report.py --ticking"
MSYS_NO_PATHCONV=1 railway ssh --service web   "/opt/venv/bin/python -c \"from api.services.canonical import dual_sample_store as s; g=s.gate_status(); print('D2 CP3 rows/agreed/disagreed:', g['rows'], g['agreed'], g['disagreed']); print('covered sessions:', g['covered_sessions']); print('GATE MET:', g['gate_met'], '|', g['why'])\""
```

**Line 1** is unchanged: both dark sweeps, worse-exit-code-wins.
**Line 2** is the D2 CP3 sample count. ⛔ **Read `why`, never just the row count** — it
distinguishes *zero rows* (the reader was never called) from *the store could not be read* (a
different fault entirely), and it names `agreed` separately from `book_unavailable` so 200 rows of
"the book could not answer" can never read as 200 agreements.

⚠️ **Before 09:30 ET line 2 will legitimately show 0** — the store is RTH-gated. Zero at 09:15 is
the design; zero at 16:15 is a finding.

---

# ⛔⛔ COLD START — DAY 2, Sunday 2026-09-13. This block supersedes the one below it.

## What merged on day 2

| # | what | commit | classification |
|---|---|---|---|
| 1 | **H14** — one placeholder-stop detector, five call sites | `94209e962` | ADDITIVE, 7 files · **MEMBER-VISIBLE** (a false alert stops being possible) |
| 2 | **S4 CP1** — the focus-divergence detector | `76c62c494` | ADDITIVE, 3 files, all `app/**` |
| 3 | **S7 `position-risk`** CP1–CP2 | `2b0547949` | ADDITIVE, DARK — no delivery, records no fire |
| 4 | **S7 `scan-membership-change`** CP1–CP2 | `0c6caf25b` | ADDITIVE, DARK — but absorbs a LIVE path |
| 5 | **S7 `regime-change`** CP1–CP2 | `0392c78bf` | ADDITIVE, DARK — two fixed schema values |
| 6 | **S7 `indicator-condition`** CP1–CP2 | `ccbab9bcd` | ADDITIVE, DARK — every legacy predicate refuses |

Day 1's five (`ffa8102c7`, `78ba40fe8`, `6576f044e`, `1c426c199`, `9458ea641`) are all live.

⛔ **ALL FOUR S7 TYPES ARE CP1–CP2 ONLY: registered, comparable, and FIRING NOTHING.** No CP3 was
authorized and none was built. `_EXPECTED` in the parity control is now **seven** names.

## ✅ THE FOUR S7 TYPES ARE MERGED — and the merge phase is the lesson

⚰️ This block read *"IN FLIGHT AT THE TIME OF WRITING … **none merged**."* All four are in, in the
owner's order: `position-risk` → `scan-membership-change` → `regime-change` → `indicator-condition`.

⛔ **THEY MERGED SERIALLY AND EACH ONE REBASED ONTO THE PREVIOUS**, exactly as predicted: they all
edit ONE line — `tests/test_alert_taxonomy_filing_watch_parity.py`'s `_EXPECTED` set — so each
merge conflicted there and was resolved by ADDING one name, never by taking one side. Pre-merge
baseline was **20 passed** at `76c62c494`; the same suite is **20 passed** with seven names in it.

⭐⭐ **THE BUILD PARALLELISES AND THE MERGE DOES NOT.** Four agents built simultaneously with no
interference; the merge phase was a strict queue — rebase, re-run parity, re-run the control,
mutate, push, four times. **That queue, not agent count, is what bounds a day.**

⚠️ **MASTER MOVED DURING THE FOURTH MERGE** (the glass/closure workstream pushed) and the push was
correctly rejected. Recovered with `git rebase origin/master` — ⛔ **never `git reset --soft`**,
which on a behind branch stages the INVERSE of the intervening commits. Parity and the control were
re-run on the new base before merging.

## ⛔ D2 CP3 IS HELD, AND ITS GATE IS UNREACHABLE AS WRITTEN

Measured in the pod EARLIER today: the dual-compute is armed and correct (fraction **100 %**, the
book resolves `ohlcv.c` to position **4**) and the sample count was **0**.

⚠️ **THE END-OF-DAY RE-READ THE OWNER ASKED FOR WAS BLOCKED** — the session's tool sandbox refused
`railway ssh` as a production read. The 0 above is **not** carried forward as the end-of-day
number: the day happened in between. Reported as a gap.

⛔ Zero here means *"the reader has not been called"*, not *"no disagreements"* —
`ticker_returns._close` is reached only through the Desk's since-mention returns, which is neither
scheduled nor hot. ⛔⛔ **And the ledger is in-process: it resets on every deploy, and web
redeployed six times on Saturday.** A 200-sample threshold cannot be reached by a counter that dies
on each push — the `_FAIL_STREAKS` shape the desk-session audit already documents.

**Needs a ruling:** a durable counter, a scheduled reader, or a different reader. CP3 stays held.

## ⛔ NO MARKER BUMP ON EITHER DAY — measured per commit, never assumed

`reachable_paths()` = 154, `watched_paths()` = 24. In-closure changed files: **0 for all eleven
merges** (⚰️ this said *"all seven"*; four more landed). Cross-checked at end of day by hand: of the
**19 files** merged in `94209e962..origin/master`, none is in the 154-module closure. A strand
exists only when flow-worker RUNS a changed file and will not redeploy for it. Bumping to discharge
nothing would drop the Massive OPRA socket, and Massive does not replay.

## The A-series instruction resolved to nothing to build

**BUILDABLE = 0 of 8.** Six are GATE-ONLY *because the surface already exists and works* — a CP1
over a live page is a second authority. Two are BLOCKED on owner-bound lines. ⭐ **A9 is the one
that moves** the day `scan-membership-change` merges, and that is in flight.

## Standing rulings confirmed by the owner, day 2

1. **D2 CP2's narrowing to `bars_sqlite`** — correct; fundamentals' JSON blob has no declaration to
   ratify. F-D2-1 stands with its prerequisite.
2. **S12 converts the cohort tag only.** ⛔⛔ **STANDING RULE FOR ALL FUTURE KILL SWITCHES:
   stopping a dark run must NEVER be a `DELETE` against member data.** The two `_DARK_ENABLED`
   flags stay env vars.
3. **D5 CP1 is census only**; the loader and its scheduling are CP2 and get classified on that line.

---

# ⛔⛔ DAY 1 COLD START (superseded by the block above) — BUILD DAY, 2026-09-12

**Read this, then `LEDGER.md`'s build-day sections, then the block below for the two dark runs.**

## What merged today, in order

| # | what | commit | classification |
|---|---|---|---|
| 1 | **D2 CP2** — the address book's first non-screener store + its first reader | `ffa8102c7` | ADDITIVE, 8 files |
| 2 | **S12 second migration** — the flag and the role constants go; the assignment mechanism arrives | `78ba40fe8` | ADDITIVE, 6 files · **in-pod verified** |
| 3 | **S10 CP2** — F-S10-1: a price has two right renderings, both named | `6576f044e` | ADDITIVE, 4 files, all `app/**` |
| 4 | **I1 slice 3** — the tool-registry contract becomes six rails | `1c426c199` | ADDITIVE, 1 test file |
| 5 | **D5 CP1** — the corporate-actions census | `9458ea641` | ADDITIVE, 2 files, `tools/` + `tests/` |

## ⛔⛔ NO MARKER BUMP WAS NEEDED, AND THAT IS A MEASUREMENT, NOT AN OMISSION

The day's plan said ADDITIVE strands would accumulate and be discharged by ONE marker bump at the
end. **None accumulated.** Measured per commit against `reachable_paths()` (154) and
`watched_paths()` (24):

```
D2 CP2      ffa8102c7  changed=8  in-closure=0  watched=0   no strand
S12 2nd     78ba40fe8  changed=6  in-closure=0  watched=0   no strand
S10 CP2     6576f044e  changed=4  in-closure=0  watched=0   no strand
I1 slice 3  1c426c199  changed=1  in-closure=0  watched=0   no strand
```

⭐ **A strand exists only when flow-worker RUNS a changed file and will not redeploy for it.** Not
one file changed today is inside flow-worker's import closure, so there is nothing stale for it to
run. ⛔ **Bumping the marker anyway would drop the Massive OPRA socket to discharge nothing**, and
Massive does not replay — the gap would be permanent until the T+1 flat file. The bump is the
expensive half of the mechanism; it is not a ritual.

⚠️ Flow-worker DID rebuild once today, `SUCCESS c4c77d385` at 23:14 ET, off another workstream's
marker bump at `614036147`. Every deploy of mine reads `SKIPPED`, which is correct and is
**cancellation-by-narrow-watch-list, not failure**.

## ⛔ WHAT IS PROVISIONAL AND NEEDS ONE PASS FROM THE OWNER

| # | where | the exact question | the answer taken |
|---|---|---|---|
| 1 | **GATE-D2 line 2 (NARROWED)** | the scope said "pick the store with the most divergent naming"; measured, that is FUNDAMENTALS | **bars_sqlite**, because fundamentals has ten metric names *because it has no declaration* — addressing it means typing them, which makes the book a second authority. F-D2-1 records it with its prerequisite |
| 2 | **GATE-S12 line 2 (PROVISIONAL)** | does "S7 flags become tag assignments" include the two `_DARK_ENABLED` kill switches? | **the cohort flag only.** Converting the kill switches would make "stop the dark run" a `DELETE` against `user_tags`. Reversing this is one line in each sweep |
| 3 | **GATE-D5 CP1** | signed on the build-day instruction, CP1 alone | CP2–CP7 remain unsigned; CP4 and CP7 touch an INERT STRAND and must be classified on the line that approves them |

## ⛔⛔ H14 — A HAZARD CLASS WAS FOUND LIVE, CHECKED LIVE, AND IS NOT FIRING

**THREE placeholder-stop detectors, three tolerances, and the weakest gates a member alert.**
`awareness/rules.py:74` skips on `abs(stop − entry) < 1e-9`; `portfolio_heat.py:35` uses a relative
tolerance; `broker/balances.py:457` uses `max(0.001, 1e-5 × entry)` and was written **after** the
drift happened. A drifted placeholder passes the `1e-9` skip and can fire `stop_hit` at importance
10, which away-delivers by email and Discord.

Live flags read: **`AWARENESS_ENGINE_ENABLED=1`**, **`COMPASS_AUTOMATION_ENABLED=1`** — R1 is
running. Production `auth.db`, read-only: **17 open broker positions, 17 with `stop == entry`
exactly, 0 drifted.** ✅ Not firing. No deploy blocked.

⛔ **And 0 of 17 carry a real, deliberate stop** — the entire live broker population is a
placeholder, one float-drift from the branch. That is a measurement of today, not a proof about
tomorrow, and it is why the class is written down here rather than closed.

## The gate packets that now exist and are UNSIGNED

`d3-realtime-streaming` · `d4-caching-and-serving` · `s5-persistence-user-state` ·
`s4-context-bus` · `s7-position-risk` · `s7-scan-membership-change` · `s7-regime-change` ·
`s7-indicator-condition`. **Every approval block is the four bare labels.** Each names its
checkpoints so a line can name ONE.

⛔ **`indicator-condition`'s three-clause gate is now 2/3 satisfied** — D2 CP1 merged, and D2 CP2
gave the book its first non-screener store today. Clause 3 (cadence gates the predicate at
registration) is a CP1 deliverable, and the packet's answer to the undeclared-cadence question is
**refuse at registration, naming the axis** — with the harder half recorded: for bars, cadence is a
property of the *(metric, timeframe)* PAIR, so the gate must resolve the ADDRESS, not the metric.

## Three counts this programme got wrong today, all its own

⭐ Recorded because the pattern is the point, not the individual numbers.

1. **Δ2** (build-day plan): "F-S10-1 has SEVEN importers, not six." Measured — the MODULE has 9, the
   SYMBOL `formatPrice` has 6. The gate packet was right; the plan's correction of it was wrong.
2. **Δ3** (build-day plan): S4 CP1 sized **L** on "62 + 22 consumers". Both figures reproduce with
   `grep -rl` and neither is a consumer count; the real number is **24**, and the size is **M**.
3. **The D5 register**, hand-written from a measurement ten minutes old, was **two rows short** —
   caught by its own census the moment the detector stopped being URL-only.

**In every case the number sat beside the list it claimed to describe.**

---

# ⛔⛔ PREVIOUS COLD START (superseded by the block above) — WHERE THINGS ACTUALLY ARE, end of 2026-09-12 (SATURDAY)

**This block supersedes everything below it. Read it, then `LEDGER.md`.**

## TWO DARK RUNS ARE ARMED. Both admin cohort. Both read next weekend.

| | `price-level` | `event-proximity` |
|---|---|---|
| state | CP1–CP3 merged, dark | CP1–CP3 merged, dark |
| cohort | admin-role `watchlist_alerts` rows | admin-role My Stocks × the day's reporters |
| flag | `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED` | `ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED` |
| cadence | every minute, weekdays 09:00–16:59 ET | 07:05 and 18:05 ET weekdays |
| verdict gate | five full trading sessions | five full trading sessions |

**ONE command covers both**, Monday ~09:05 ET (Git Bash needs the prefix; drop it in
PowerShell):

```
MSYS_NO_PATHCONV=1 railway ssh --service web   "/opt/venv/bin/python tools/s7_price_level_report.py --ticking"
```

⭐ **The worse exit code of the two wins** — a green overall line beside one stalled sweep
is exactly the reassurance that stops anyone reading further. ⛔ The staleness bounds
DIFFER by design: 180 s for price-level, **26 h** for event-proximity. Copying the
sibling's number would report a healthy twice-a-day sweep as stalled every time.

## ✅ BOTH DARK RUNS ARE ARMED **AND VERIFIED PROJECTING > 0**

⚰️ **This section was "MONDAY, BEFORE ANYTHING ELSE — did the rollout seed run?"** It was an
inference: the boot had happened, but the seed's line is a `logging.info` that never appeared in the
retrieved log window. **It was measured instead, and it ran.**

Read-only, in the pod, 2026-09-12 — user IDs only, nothing written:

| | |
|---|---|
| `user_tags` rows, tag `rollout:s7-dark` | **6** |
| production accounts with `role='admin'` | **6** |
| the two sets | **EQUAL** — empty difference in BOTH directions |
| other `rollout:` tags | none |
| projected via COHORT (post-swap) | **12** |
| projected via ROLE (pre-swap) | **12** — IDENTICAL |

And the dry-run harness **run in the pod against production rows** (writes to `/tmp` only,
`--self-check` PASSED first): **12 projected, 11 distinct symbols, 10 priced, 10 spans opened,
heartbeat stamped 0.** `PIPELINE: VERIFIED — a real row reached a real span.`

⭐ **12 = 10 `price` + 2 `line`, the exact cohort shape F-S7-4 found** — corroborated by a second
reading rather than merely produced.

⛔ **`SET EQUAL`, not "same size".** 6 against 6 is compatible with one admin tagged and a different
one missed.

---

## ⭐ WHERE THIS PROGRAM STANDS, end of 2026-09-12

| | |
|---|---|
| **two dark runs** | **ARMED and VERIFIED projecting > 0** — 12 price-level rows against the 6-account cohort; event-proximity arms on the calendar |
| **next weekend's read** | **price-level + event-proximity**, and **`legacy_only` is the deciding column** — an alert a member LOSES at the flip |
| **F-S7-5** | ✅ **CLOSED** (`5ff6fc04a`). Do not re-raise |
| **`catalyst-match` CP3** | ⛔ needs a line **after** that read |
| **price-level CP4** | ⛔ needs a line **after** that read |
| **D2 CP2** | ⛔ needs a line (the resolver + S7 as first consumer) |
| **S10 CP2** | ⛔ needs a line (F-S10-1 — the two `formatPrice`s, probably TWO named primitives rather than one) |
| **F-I1-2** | ⏸️ parked on the owner's browser checks |

⛔ **THE OWNER-BOUND LINE IS UNTOUCHED** and the three browser checks stay on it. Not a session's to
run, not a session's to raise.

---

## ⛔⛔ HOW TO READ NEXT WEEKEND — the two columns that decide, and the two that cannot

**`price-level`:** `legacy_only` is the column. `new_only` is **structurally invisible**
(legacy is one-shot; the row leaves the projection the moment it fires), so a zero there is
a blind spot, not evidence.

⚠️ **And the cohort has NO TRENDLINES** — 10 fixed-price rows and 2 `line` rows. The
interpolated level, the anchor-move reset, all of F-S7-2 collect **nothing**. Next
weekend's verdict covers **fixed levels only** and must say so.

**`event-proximity`:** the thing its dark week is SIZING is the **calendar-reschedule
divergence** — the legacy path re-reads the calendar every run, a stored date is a
snapshot. CP3 makes them converge by construction (reset + `not_comparable`), so what the
week measures is **genuine rule disagreement only**. A high `not_comparable` means the
calendar moved a lot, not that anything is wrong.

## What else landed 2026-09-12

- **G1 tranche 1** — `3b817186c`, BEHAVIOUR-CHANGING, marker bump #4. The adapter fails
  fast; the call site owns degradation. Two member-request-path sites now return the legacy
  empty shape **plus an S8 envelope** instead of a silent `null`.
- **F-S7-4** — `b5133f50d`. The third `alert_type` (`line`) is pinned with its own branch.
- **G3 DEFERRED and to be re-scoped** (its stated justification is half-false in this repo:
  one PNG call site, no CSVs). **G5 quarantined with the contract reason — the census red
  is CLEARED.**
- **CP4 prepped on a branch, NOT merged**: `feat/s7-price-level-cp4` (`e79635193`) for
  price-level; event-proximity's CP4 flag ships inert on master beside CP3's.
- **WAVE 3, all ADDITIVE, no marker bump** — **S10 Presentation Primitives** (`3c539d011`,
  the five primitives adopted by S8's four and nothing else, byte-identity proved against a
  frozen oracle rather than a snapshot file) · **S7 `catalyst-match` CP1** (`faaa30146`)
  and **CP2** (`d9631afa5`), dark, harness-armed only, parity 20/20.
- **D2 CP1 IS BUILT AND MERGED** (`b9783d509`, gate `1a0adb471`). 137 metrics, derived, INERT —
  nothing in `api/**` reads it and a rail enforces that. CP2+ need new lines.
- **S12's FIRST MIGRATION IS BUILT AND MERGED** (`56df6803f`, gate `afdd4adf5`). Both S7 cohorts
  read `user_tags`. ⛔⛔ **An empty cohort means NO members** — the seed in `api/main.py` is what
  makes the swap a no-op, and it is idempotent and never removes.
- **F-S10-2 MERGED** (`e909279e1`) — `<Cited>` pins ET with a visible label. **MEMBER-VISIBLE**:
  every member outside ET now reads a different, correct, labelled timestamp.
- **F-S10-1** (two `formatPrice`s, six importers) and **F-S7-5** (the catalyst dedup collision, a
  LIVE production bug latent behind an OFF flag) are RECORDED, not fixed.

## ⭐ NEXT-SESSION QUEUE

| # | item | note |
|---|---|---|
| 1 | **Read both dark runs** | five sessions; `--ticking` first, then the full report |
| 2 | ✅ **F-S7-5 — CLOSED** | Fixed in the legacy path `5ff6fc04a`, MEMBER-VISIBLE, mirror moved in the same PR. ⛔ Do not re-raise |
| 3 | **S7 `catalyst-match` CP3** | ⛔ **AFTER next weekend's read.** Needs a new line; §9 of its packet lists the five things that line must name |
| 4 | **G1 tranche 1 remainder** | `darkpool_eod`, `company_about`, `ir_webcast` are locally guarded and unmigrated — no behaviour to preserve that is not already preserved, so they are optional |
| 5 | **D1 G3 re-scope** | measure the real call sites before authorizing anything |
| 6 | **CP4 (price-level)** | ⛔ needs the owner's line AFTER the five-session read |
| 7 | **S10 CP2** | F-S10-1 folded in: the two `formatPrice`s (six importers, three disagreements, one of them an EDITABLE INPUT). Plus `formatPercent`'s first consumer |
| 8 | **D2 CP2** | the resolver + S7 as first consumer. ⛔ Needs a new line. And `indicator-condition` waits on CP1 **plus the first non-screener store** — all 137 metrics today are `screener_rows` |
| 9 | **F-I1-2** | ⏸️ **STILL PARKED**, on the owner's browser checks. Do not re-raise. |

---

## 🔧 WORKTREE HOUSEKEEPING — done 2026-09-12, read before running a frontend test

`uct-worktrees/s7-price-level/app` now has a **REAL `node_modules`** (`npm ci`, exit 0), not a
junction.

⚰️ **IT WAS A JUNCTION FOR ONE AFTERNOON AND THAT WAS ALREADY WRONG TWICE.** The first target
(`uct-dashboard/app/node_modules`) had a broken `cssstyle` install and every vitest run died at
jsdom import; the second (`_merge-station`) was **deleted by another session within the hour**,
taking the junction with it — so a session that had been told *"the junction is left in place for
you"* would have started with a repair.

⛔ **A JUNCTION POINTS AT ANOTHER SESSION'S WORKTREE AND IS THEREFORE NOT DURABLE.** CLAUDE.md
offers it as a shortcut for a throwaway baseline checkout; it is not a setup. If a worktree is
going to live more than an afternoon, run `npm ci` in its `app/`.

⚠️ **And the docs worktree itself vanished mid-session** — `uct-worktrees/terminal-research` was
pruned by another session while this one was working in it. Nothing was lost (the branch was
already pushed) and it was re-created with `git worktree add`. **Push docs commits as you make
them; never leave a docs worktree as the only copy of anything.**

---

# ⛔⛔ FIRST THING A COLD START MUST KNOW

**This is a BUILD program.** It has 50+ commits in production. **[`LEDGER.md`](LEDGER.md) is the
authority on what shipped** — not this file, not the specs, not the architecture documents.

## ⚰️ HISTORICAL — the five PRs below were MERGED on 2026-09-11/12

⛔ **Kept for the merge-order reasoning, not as a to-do.** Every row shipped; the current
state is the block at the top of this file and `LEDGER.md`. A cold start that acts on
this table will re-merge merged work.

### (as originally written) FIVE PULL REQUESTS ARE PENDING THE OWNER'S MERGE

| # | branch | SHA | what | tier |
|---|---|---|---|---|
| 1 | `feat/s7-filing-watch-parity` | `c46be401f` | filing-watch parity rail — **precondition for every S7 trigger type** | WEB-ONLY |
| 2 | `feat/i1-rails` | `be3474241` | GATE-I1 slice 1 — F-I1-1, F-I1-4, adversarial cases | WEB-ONLY |
| 3 | **`fix/alert-bell-filing-icon`** | `76f6e2e77` | ⛔ **MEMBER-VISIBLE** — filing-watch bell icon. Own PR by ruling 2b | WEB-ONLY |
| 4 | `feat/s3-admin-routes` | `3ebe013a5` | S3 admin `/status` + `/reconcile`; also greens `test_test_discovery_coverage` | WEB-ONLY |
| 5 | `feat/d1-adoption-sweep` | `638e12f48` | census quarantine cleanup + adapter-gap log | WEB-ONLY |

**All five are WEB-ONLY** — verified against flow-worker's committed watch list (the 21 `api/<name>.py`
files in `api/flow_worker_main.py`'s header). None touches a watched file, so none needs a
weekend/after-hours window. Only dependency: **4 before 5**, so the discovery-coverage red clears
before anyone reads the census red.

⛔ **THE NEXT SESSION'S FIRST ACTION:** when the owner says "merged" — re-run the protection rail
against `origin/master`, flip every Section-4 ledger row from **PENDING-MERGE** to **MERGED** with
its merge SHA, and confirm rail PASS. Nothing else starts before that.

## Authorized and waiting on those merges

**GATE-I1 SLICE 2** — `AskAiTab.jsx` composes `<Cited>`/`<Provenance>` instead of its local
CSS-module citation list. Approved 2026-09-11 at `22a0367fe`; branch `feat/i1-askai-provenance`,
**off `origin/master` AFTER the five merge, never before** (it depends on `feat/i1-rails`).
⛔ MEMBER-VISIBLE. Conditions in the gate packet, including: remove the `RECORDED_BOUNDARY_DEBT`
entry in the same PR and **confirm F-I1-1 goes green because the violation is gone, not because the
entry moved.**

## Next authorization the owner still owes

**S7 price-level** needs an **absorption ruling** before it can be scheduled — which legacy table it
absorbs, under the standing default (legacy stays live, new type runs **dark**, and the flip plus the
legacy switch-off happen in the **same PR**). Draft ruling text is in the next-session queue in
`PROGRAM_STATUS.md`.

## D1 adoption follow-ups — open, unscheduled

The sweep migrated **zero** call sites, because every remaining one is blocked. The blockers, from
`docs/d1-implementation-log.md` on `feat/d1-adoption-sweep`:

| gap | what is missing |
|---|---|
| **G1** | typed functions don't expose a per-call `timeout` to callers — **blocks all 34 reaches on its own** |
| **G2** | no typed function for 9 live endpoints; `/stable/profile` alone is reached by 8 modules |
| **G3** | adapter is JSON-only — can't serve `ticker_logos`' PNG or `fundamentals_bulk`'s 30–70 MB CSVs |
| **G4** | `get_news_stock` is single-ticker; `engine.py` sends a multi-symbol CSV |
| **G5** | no retry/backoff/request-ceiling; `fmp_news.py` has all three plus 429 sleep-retry |

Also open: **11 Massive sites** outside `massive.py`, untouched this wave. ⚠️ And the FMP census rail
is **red on master for a pre-existing reason** — `api/services/news/adapters/fmp_news.py:37`,
unquarantined, fixable only via G5.

---

Read in this order: this file -> `PROGRAM_STATUS.md` -> `GOVERNING_PRINCIPLES.md` -> `CRITICAL_PATH.md` -> `OWNER_DECISIONS.md` -> `AGENT_REGISTRY.md` §5 -> the charter in `charter/` if any requirement is in doubt.

⛔ **`SESSION_HANDOFF.md` is now a HISTORICAL artifact** (the 2026-09-02 11:57 recovery checkpoint). It is preserved as a record, not as a state description, and its §5 and §16 are superseded here. Do not act from it.

## Where we are

* **Program day:** 1 **CLOSED**. **Phase 2 CLOSED** (product/IA/data architecture + F-09, adversarially validated). **Phase 3 CLOSED** (technical validation + PRD/spec for the four LOCKED systems).
* **Stage: BUILD PROGRAM** (owner ruling 3, 2026-09-11 — declared, not discovered: it had been one since 2026-09-02). Specification complete for four systems; **all four are implemented in whole or in part on `origin/master`, plus two application slices** (see "Implementation status" below). The program is **idle**, awaiting the owner's read on the S3 gate and on what shipped undocumented.
* **Worktree:** `C:\Users\Patrick\uct-worktrees\terminal-research`, branch `terminal-research`, start SHA `9c3df14b9`. Never push master from here. Push this branch to `origin/terminal-research` at checkpoints.
* **Orchestrator:** the only committer. Commit with `git add docs/terminal-research` (scoped; never `-A`).

## What exists (verified against git, not asserted)

**Research — Day 1 closed.** Wave 1 (17/17 internal + licensing), Wave 1b (28/28 external benchmark), the internal synthesis group (system map, capability ledger, tech-debt register, provider ledger F-03b, licensing register F-04, both cost models), `executive-questions.md` (all 40), `hypothesis-register.md` (35), and `DAY_1_EXECUTIVE_SYNTHESIS.md` (90 KB, accepted after an independent fact-check pass that found and corrected two genuine drifts). Closed at `7652adabf`; readiness review at `714c05779`.

**Phase 2 — architecture, closed at `92e9c0a8e`.** `product-architecture.md` (32-system decomposition: 12 platform S-systems, 5 data-platform D-systems, 14 applications, 1 intelligence layer), `information-architecture.md`, `data-architecture.md`, `capability-infrastructure-matrix.md`, `provider-master-ledger.md` (F-09), `ARCHITECTURAL_DECISION_REGISTER.md`, and `13-executive-synthesis/PHASE_2_INTEGRATION_SYNTHESIS.md` (the CONDITIONAL GO that authorized Phase 3).

**Phase 3 — PRD/spec pairs, closed at `e9e7a71f7`.** Four complete pairs, no truncation, for the four systems the decision register had LOCKED:

| system | PRD | spec | document status |
|---|---|---|---|
| **S3** Entity Master | `05-product-strategy/prds/entity-master-prd.md` | `07-technical-architecture/specs/entity-master-spec.md` | draft — awaiting review |
| **D1** Provider Abstraction | `prds/provider-abstraction-prd.md` | `specs/provider-abstraction-spec.md` | draft — awaiting review |
| **S8** Provenance & Freshness | `prds/provenance-freshness-prd.md` | `specs/provenance-freshness-spec.md` | **IMPLEMENTED** — awaiting owner sign-off |
| **S7** Alerts & Monitoring | `prds/alerts-monitoring-prd.md` | `specs/alerts-monitoring-spec.md` | draft — awaiting review |

**After Phase 3 close** (the eight docs commits the old control files never recorded): the Entity Master pre-implementation gate packet (`12-decisions/gates/entity-master-pre-implementation-gate.md`, 564 lines, `c46048ae6`, final and awaiting explicit owner approval); RG-33 filed and then corrected (`a9837d71d`, `633691038` — `cap_universe.json` is the stale file, **not** `delisted_tickers_bulk.json`); and the S8/S11 implementation records (`8935b5092`, `99e7de3b5`, `f23530a8d`, `92296aa62`, `a31cacea1`).

## Implementation status

⛔ **Implementation HAS occurred, and it is on `origin/master`.** Any statement that this program has touched no application code — including `SESSION_HANDOFF.md` §16 — is false as of 2026-09-02 evening. The code landed on separate implementation branches (never from this worktree) and is now an ancestor of `origin/master`:

⛔⛔ **THE AUTHORITY IS [`LEDGER.md`](LEDGER.md) — READ IT, NOT THIS SUMMARY.** 50 commits / 207 files / 22,049 insertions on branch `feat/entity-master`, merged as **`ed6b1f041`** on 2026-09-05, covering **S3, D1, S8, S11, S1+S2, S7 Alerts, A3–A8 and I1** — every one assigned, zero unassigned. Plus **19 further commits from four OTHER workstreams building on paths this program created**, including the convergence program's filing watch, which lives **inside** this program's `alert_taxonomy` package.

⚠️ An earlier revision of this file said "17 commits" and "no Checkpoint 6 exists." Both were undercounts from filtered queries; Checkpoint 6 is `5ecdae012`. **A filtered absence is not an absence** — use the ledger query, never a path or subject filter.

**Smaller first cut, kept only as the record of what the re-scoped rail surfaced on its first run — seventeen commits, 2026-09-02 17:51 → 09-03 15:07:**

| system | commits | what shipped |
|---|---|---|
| **S3** Entity Master | `3c762d25e` `8424b8be5` `195e8e24c` `114052d2d` `f1b75e270` `baaf28906` `53b99ad5a` | `api/services/entity_master/` created from nothing — canonical schema, read primitives, write path, seed script **(a real seed run was executed)**, provider mapping, reconciliation, adversarial validation at scale. 2,395 insertions, 1,174 of them tests |
| **D1** Provider Abstraction | `9d0b5eb26` | provenance/freshness hardening — entitlement distinction, stale detection, AI-consumable contract. ⚠️ **Not the one-ACL-per-vendor boundary** the PRD specifies; that is still unbuilt |
| **S8** Provenance & Freshness | `7adf80bd4` `834b45df4` `8d04bf75f` `03d399a52` `48bba9614` | `app/src/components/provenance/` (Provenance, FreshnessBadge, CoverageLine, Cited, freshnessContract, availabilityContract, sessionStale + tests), `api/routers/provenance_quote.py`, `provenance_bar.py`, `api/services/bar_provenance.py`, `ProvenanceDemo.jsx` at `/provenance-demo` |
| **S11** Session & Market Clock | `e14a5836b` `1cf0bf028` | `app/src/lib/marketClock/{marketClock,nyseCalendar}.js`; `useMarketOpen.js` re-sourced; `sessionModel.js` `nextOpenHint()` skips holidays |
| **A3/A4** vertical slice | `408f04935` | `/research/:sym`'s Estimates + Financials mounted onto S3+D1+S8+S11. Does **not** touch Terminal-Current |
| **A5** Events & Calendar | `1214dc246` | ⛔ **modified TERMINAL-CURRENT** — `api/routers/calendar.py` (163 lines), `app/src/pages/Calendar.jsx`, `calendar/CalendarHeader.jsx`, `earningsModalRow.js` + tests, plus `tests/test_calendar_a5_modernization.py` (281 lines, new) |

**S11 has no PRD/spec document** — deliberately. Its `product-architecture.md` system block was judged sufficient for a system that size; that judgement is recorded in `provenance-freshness-prd.md` §12.4 and is not a gap to be silently filled.

⛔⛔ **CORRECTION, 2026-09-11 — S3 was BUILT BY THIS PROGRAM, not adopted.** An earlier reading of
this file said `api/services/entity_master/` was "pre-existing UCT infrastructure the program
adopted." **That is false.** The path **did not exist at the start SHA** (`git ls-tree 9c3df14b9 --
api/services/entity_master` returns nothing); it was created by `3c762d25e` on 2026-09-02 17:51:55
and built out across Checkpoints 1–8 (no Checkpoint 6 exists — open question), 2,395 insertions
including 1,174 lines of tests. The misreading came from `provenance-freshness-spec.md` §8a calling
Entity Master "already shipped" — written at ~23:00 that night, it meant *shipped five hours ago by
us*, and was read as *predates us*. ⭐ **"Already shipped" names a state, never an author. Ask git
who wrote it.**

⚠️ **The full implementation ledger is in `PROGRAM_STATUS.md`** and includes two things no program
document recorded until this reconciliation: the **A3/A4 vertical slice** (`408f04935`) and the
**A5 Events & Calendar modernization** (`1214dc246`) — the latter having modified **Terminal-Current
itself**. Read that section before planning any build work.

## What is blocked

Nothing is blocked on research, and the two items that were waiting on the owner are **closed**:

- ✅ **S8 completion status — SIGNED OFF 2026-09-11**, with S10 and the vendor-side entitlement taxonomy (SPEC-S8 §17a) formally DEFERRED, neither blocking.
- ✅ **Entity Master gate packet — APPROVED 2026-09-11** (conditional on the spec re-verification, which came back clean: 34/36 paths VERIFIED, 0 MOVED, 0 CHANGED).
- ✅ **The 50-commit merge `ed6b1f041` — AUTHORIZED.** Owner's work in a separate session; a **recording failure only**, now recorded in [`LEDGER.md`](LEDGER.md). ⛔ **Closed. Do not re-raise it.**

## ⛔ OWNER-BOUND OPEN ITEMS — standing, do not re-raise per report

**The owner will supply these unprompted. Never assume a value, never let silence decide one, and
do not list them again as a question in a session report.**

| item | what it gates |
|---|---|
| **OI-03(a)** Massive plan tier (Individual vs Business) | 38 licensing-register rows |
| **OI-03(b)** FMP Data Display & Licensing Agreement — exists? | 19 rows. ⛔ **57 rows stay FLAGGED between (a) and (b)** |
| **OI-06** one observed or narrated desk morning | DEC-01 workspace model + DEC-02 command-grammar default. ⛔ **The S1/S2 gate exception stays OPEN until this lands**; its findings then get diffed against the shipped palette and drive a rework list — they are not discarded |
| **OI-08 / OI-18** Bloomberg / Gödel access | validation tier only; nothing depends on either |
| **OI-21** four read-only telemetry queries + `charts_workspace_layout` distribution | sharpens S6's build order; blocks nothing |
| **D-003 / DEC-09** decisiveness for two audiences | ✅ **RULED: decisive for everyone, implemented as a configuration value.** ⛔ Does not apply to I1, which is the Explain role and never renders a verdict |
| **THE THREE BROWSER CHECKS** — bell icon · Ask-AI provenance · S3 admin `/status` as admin | ⛔⛔ **MOVED HERE 2026-09-12 BY OWNER INSTRUCTION so they stop appearing in session reports.** They need a signed-in browser and the owner's own eyes; no session can run them and no session should ask again. They gate no merge |

## Where to pick up

1. **Do not re-dispatch the Wave-2 recovery list.** It is closed. Of the eight items `SESSION_HANDOFF.md` §5 classified as needing re-dispatch (that file says "seven" in §1 and §5's prose while its own table lists eight), **seven are DONE and accepted** — F-06 deliverable 2, B-POD-BBG, C7-02, C5-02, B-POD-GDL, C2-01, C7-03 — all QC'd file-by-file in `AGENT_REGISTRY.md`.
2. ✅ **C2-02 (Events intelligence) is DONE** — re-dispatched and accepted 2026-09-11 (`82d084b43`), 47,658 bytes, QC'd by reading the file. **RG-28 closes with it.** There is no outstanding research task.
3. ⛔ **THE REST OF DAY-1 RESEARCH IS PARKED — owner ruling 5, 2026-09-11. Do not dispatch it as a wave.** Pull an individual pod **on demand, only when a specific system's spec needs it**, and say in the dispatch which spec and which question. The full parked list, recorded so nothing is lost:

   | contract | tasks |
   |---|---|
   | `contracts/C-WAVE2.md` | **C1-01, C1-02** · **C2-03** (alerts & notifications — the one most likely to be pulled, for S7 Alerts) · **C3-01, C3-02** · **C4-02, C4-03** (C4-03 global search / entity resolution — likely for S2, which is itself parked on OI-06) · **C6-03** · **C8-01, C8-02**. *(C2-01, C2-02, C5-02, C6-01, C6-02, C7-02, C7-03 are already accepted.)* |
   | `contracts/B-WAVE2.md` | the per-product **`B-<P>-02` workflow reconstructors** and **`B-<P>-03` verifiers**, one pair per benchmark product (11 products → 22 tasks) |
   | `contracts/G-LIGHT-D2.md` | **G-01-D2** Product Skeptic light red-team pass (Fable; destination `12-decisions/red-team/day2-benchmark-product.md`) |
   | not yet contracted | **F-05** cross-product capability matrix · **F-07** JTBD / workflow library — both need their inputs first |

   ⭐ **Why parked and not cancelled:** Day 1 closed, and Phase 2 and Phase 3 both completed without any of it. The evidence base was sufficient to lock four decisions and specify four systems, so the marginal research value is now lower than the cost of running 20–30 agents. That judgement is reversible — the contracts are on disk and each is independently dispatchable.
4. **QC every return by reading the actual file** — bytes, section headers, tail, truncation-marker scan — never an agent's self-report. This is how F-08 and C6-02 were correctly recovered after their agents reported failure, and how B-POD-BBG's premature failure call was caught and corrected (`68d0f4990`).
5. ⛔ **When scanning a file for a literal marker, strip prose first.** A truncation-marker scan of `provenance-freshness-spec.md` on 2026-09-11 returned two hits, both false: the field name `truncated` inside a documented data shape, and a line-range note. An instrument that matches prose reports a property of itself.
6. Run the protection rail (`protection-rail.md`) at every checkpoint and update `PROGRAM_STATUS.md`, this file, `CRITICAL_PATH.md`, `OWNER_DECISIONS.md`.

## How this drifted (read before trusting any control file)

Between 2026-09-02 17:14 and 2026-09-03 07:04, eight docs commits landed on this branch — the Entity Master gate packet, two RG-33 commits, four S8 records and the S11 record — and **not one of them touched a control file.** In the same window, application code for S8 and S11 shipped to `origin/master` from separate branches, which this worktree's history cannot see at all. `RESUME.md` and `SESSION_HANDOFF.md` were last written at 11:57 that morning and went on describing "Day 1b, Wave 2 partially complete, seven tasks needing re-dispatch" for nine days, while every one of those tasks but C2-02 had in fact been completed and accepted hours later.

A cold-start session reading `RESUME.md` first, exactly as instructed, would therefore have re-dispatched seven finished research tasks and believed no code had shipped.

⛔ **So: check git before trusting these files.** This document carries a "Last verified against git" line at the top; if the branch has moved past that SHA, reconcile before acting. Two specific blind spots, both real here: a docs commit that records implementation is not the implementation (the code lives on other branches, and only `origin/master` can confirm it), and an **untracked** file is invisible to every `git log` — C2-02's stub survived nine days precisely because nothing ever committed it.

## Standing hazards

Vocabulary TERMINAL-CURRENT / TERMINAL-NEXT everywhere. Engine/bot/wire/scans read-only. Never the stale `uct-dashboard` checkout. Never run anything on the production pod. Port 8077 is a stale local backend. `C:\data` is real; never override conftest pins. Partner files untouched. Usage-limit pause = normal; on resume, follow this file.

⚠️ **Two ID collisions in this program's own vocabulary — both live, both load-bearing:**
1. **A bare `Dn` means the SYSTEM. A decision is always `DEC-nn`.** Renamed 2026-09-11 by owner ruling: the decision register's ids are now `DEC-01`–`DEC-15`, and so are the Readiness Review §7 items that seeded them. `PHASE_2_INTEGRATION_SYNTHESIS.md` §10 locks "D3 Entity Master, D4 Provider Abstraction, D6 Provenance, D7 Alerts" in the OLD spelling — read those as **DEC-03 / DEC-04 / DEC-06 / DEC-07**; the systems they lock are **S3, D1, S8, S7**. The token was carrying up to five meanings (decision · data-platform system · capability-ledger row · benchmark-universe row · Readiness-Review item), two of them inside one table row in `information-architecture.md`. **In-prose references were deliberately NOT mass-renamed** — a rule-based pass mislabelled ~10% against hand-checking. Each document's decision references are corrected when that document is re-verified. Mapping and rationale: the register's rename note.
2. ⛔ **`S7` NAMES TWO UNRELATED THINGS — and this program's writing rule for it (owner ruling, 2026-09-11).**
   - In **this** program, S7 is the **Alerts & Monitoring** platform system. **Always write it "S7 Alerts", never a bare "S7."**
   - In the (now closed) UCT Terminal **convergence** program, "S7" is the **filing-watch** feature — live to members since 2026-09-11 12:07:29 ET, durable alert row `alert_fires`. **Always call that one "filing watch", never "S7."**
   - The two are unrelated and neither is a rename of the other. ✅ Checked 2026-09-11: `alerts-monitoring-spec.md` names `alert_fires` 12 times and `user_alerts` **zero** times, so S7 Alerts is already consistent with the convergence program's 2026-09-08 owner ruling that the durable alert is `alert_fires`, never a `user_alerts` row. That consistency is luck plus good grounding, not a designed handshake — re-check it when S7 Alerts is authorized.

⚠️ **The codebase has moved since these documents were written.** Terminal-Next must not assume a pre-convergence codebase — see `PROGRAM_STATUS.md`'s reconciliation section for the one confirmed overlap (Seam 7's 2026-09-07 edit to S11's `nyseCalendar.js`).
