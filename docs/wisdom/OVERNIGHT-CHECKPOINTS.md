---
id: WISDOM-OVERNIGHT-CHECKPOINTS
title: Overnight autonomous run — checkpoint after each master merge
status: in progress (2026-09-13 23:38 CT →)
---

# Overnight checkpoints

⛔ **Why this file exists.** The owner asked for a checkpoint after each master merge. An
interactive session that emits prose ENDS ITS TURN, and the run would stop there — so the
checkpoints are written here as they happen and the run continues. The morning report is the
one piece of prose.

---

## Merge 3 — S-C sources · `a64336c89` · 2026-09-14 01:05 CT

| stream | branch | SHA | tests | import-ban | reviewer verdict | blockers |
|---|---|---|---|---|---|---|
| S-C sources | `wisdom/w1-c-sources` | `9193a5aa3` → **`a64336c89`** | **1009 passed, 0 failed** (24 named files, 397s) | substack/journal/private_store/offlimits **PASS** | SHIP-WITH-FOLLOW-UPS | 6 blocks-merge, **all fixed on branch** |

- **Master SHA merged onto:** `0794772b9` (re-measured immediately before; 35 behind at the start of the gate, 0 at push).
- **Railway:** `web` SUCCESS on `a64336c89`, `/api/health` `uptime_seconds: 27` — a fresh boot, not the old pod answering.
- **flow-worker:** OK, `reachable=154 watched=24 changed=26` — web-only.
- **Agents running at the time:** 0 during the gate (integrator alone), then 2 (pair 2 launched after the push). **Free memory 9.6 GB.**
- **Cost:** $0 — no model calls in this merge; reviewers are session tokens, no API spend.

**What the reviewer actually found — the adjudication, not a re-reading:**
19 candidates adjudicated → **6 VERIFIED · 5 REFUTED · 4 DOWNGRADED · 4 NEW.**

Six blocks-merge, all closed on the branch, and the two most serious were about a delete that
could outrun its copy:

| id | finding |
|---|---|
| **S01** | the Zoom trash gate read `if coverage is not None and coverage < THRESHOLD`, so an **UNMEASURABLE** coverage skipped the block entirely and deleted the only copy. Probe printed `coverage: None … DELETED: ['UUIDNODUR']`. §8a.6a: "we could not measure it" is not "it verified". |
| **S02** | the **CHAT LOG was never archived** and the recording was deleted anyway — `_is_vtt_file` answers False for a CHAT/TXT file, while §8a.6a.1 names four artifacts. Zoom has no trash recovery, so that chat log was gone. |
| **N1** *(new)* | a **SECOND Zoom delete path** no gate ever covered, behind a **default-ON** flag. |
| **N4** *(new)* | **five pre-existing desk tests asserted the delete §8a.6a forbids** — tests agreeing with the defect, the same shape as S-A's dry-run rail. |
| **S07** | the transcript resolver **MINTED A GUEST** from an ambiguous label (`Uncharted Territory → guest:uncharted-territory`) — drift #3/#4 for the **third** time. |
| **S08** | an ambiguous host label with no title match was **DROPPED as an attendee**, so a possible AUTHOR's words lost their speaker. Now `team-unresolved`, never the raw label (§0.4e). |

**Refuted, and worth naming** (the reviewer disagreeing where it should): **S05** — the archived
Zoom metadata was said to leak a credential in `download_url`. It does not: `zoom_client.download_text`
sends the token as an `Authorization: Bearer` **header**, so there is no token in the URL at all.
Read the client, not the call site.

**Also fixed this hour, and it is not S-C's:** `tests/test_cross_module_imports_resolve.py` — the
shared §7 rail that had been red "pre-existing, someone else's" for weeks — was **wrong**. Its
`_bindings` collector skipped tuple-unpacking targets, so `HOLIDAY, WEEKEND, PRE, RTH, POST,
OVERNIGHT = …` bound nothing and two importable modules were reported as unresolved. ⛔ The obvious
fix (add both to `KNOWN_DEAD`) would have permanently blinded the rail at exactly the two names it
was wrong about. The collector was fixed instead; mutation-proved (old collector → 2 of 4 red).

**Open from S-C, carried as follow-ups, not blockers:** the Zoom archive still uses `put_immutable`
rather than §8c.1.3's `put_verified` (the reviewer correctly refused to change an integrator-owned
contract), and the R2 prefix is `wisdom/sources/zoom_vtt/` where §8a.6a.1 names `wisdom/sources/zoom/`.
Both are integrator decisions; `core/r2.py` has no delete path, so a prefix change strands whatever
is already written.

---

## Reviewers — pair 1 (S-C, S-E) and pair 2 (S-F1, S-F2), 2026-09-14 00:38–01:27 CT

⭐ **The adjudication profile is the point.** The owner's instruction was that *"all N confirmed" is a red flag, not a clean bill* — a review that agrees with every scout candidate is a re-reading. Across the four streams the reviewers **refuted or downgraded 31 of 63** and found **23 findings no scout had**.

| stream | verdict | adjudicated | VERIFIED | REFUTED | DOWNGRADED | NEW | blocks-merge | all fixed |
|---|---|---|---|---|---|---|---|---|
| S-C | SHIP-WITH-FOLLOW-UPS | 19 | 6 | 5 | 4 | 4 | 6 | yes |
| S-E | FIX-BEFORE-MERGE | 20 | 1 | 6 | 5 | 8 | 3 | **NO** |
| S-F1 | SHIP-WITH-FOLLOW-UPS | 11 | 0 | 4 | 1 | 5 | 1 | yes |
| S-F2 publish | SHIP-WITH-FOLLOW-UPS | 13 | 0 | 6 | 1 | 6 | 2 | yes |
| **total** | | **63** | **7** | **21** | **11** | **23** | **12** | |

⭐ **S-E's one unfixed blocker was not S-E's to fix, and it was the best finding of the night.**
E-5: the shared §7 rail `tests/test_cross_module_imports_resolve.py` was RED on `feat/wisdom-loop`
and it was a **FALSE POSITIVE** — `_bindings` collected only `ast.Name` targets, so tuple unpacking
bound nothing and two importable modules were reported as unresolved imports. That red had been
carried as "a pre-existing non-Wisdom failure" in this programme's own ledger rows for weeks.
The reviewer correctly refused to touch it (CONTRACTS §8.2 gives shared files to the integrator) and
⛔ explicitly warned that the obvious fix — adding both names to `KNOWN_DEAD` — would permanently
blind the rail at exactly the two names it was wrong about. Fixed by the integrator at `409b7dd74`;
mutation-proved (old collector reds 2 of 4). **S-E therefore has zero open blockers.**

**Each reviewer also refuted something it had raised itself**, which is the habit worth keeping:
- **S-C / S05** — the archived Zoom metadata was said to leak a credential in `download_url`. It does
  not: `zoom_client.download_text` sends the token as an `Authorization: Bearer` **header**. Read the
  client, not the call site.
- **S-F1 / F-N4** — D20's silent scorer running with `WISDOM_LEVEL_ALERTS_ENABLED=0` looked like an
  ungated feature. It is the DESIGN: §0 ruling 13 builds D20 as a silent scorer and the enablement
  gate needs ≥14 days of silent scoring, so the scorer MUST run while emission is off. The flag gates
  EMISSION, in S-F2's module.
- **S-F2** attacked its OWN provenance rail (committed hours earlier) and found two blockers in it:
  the marked-predicate excuse laundered an UPDATE, and **a SQL COMMENT spelling `source = 'wisdom'`
  marked the site** — an analyser reading comments as code, which is the exact defect class this
  repo's "CODE, NEVER PROSE" rule exists for, committed by the rail written to enforce it.

---

## Checkpoint 8 — merge 7 (S-F2 publish) LANDED. All six §8.4 master merges complete. 2026-09-14 03:58 CT

**`fedd8dea1` on master · Railway `web` SUCCESS · `/api/health` 200 with `uptime_seconds: 28`** (a
real fresh boot, not a cached answer) · `git merge-base --is-ancestor` confirms the commit is in
what master serves, rather than inferred from the push.

| # | merge | commit | web |
|---|---|---|---|
| 2 | S-A capture | `fb62a44d9` | SUCCESS |
| 3 | S-C sources | `a64336c89` | SUCCESS |
| 4 | S-D extract | `7a2b54369` | SUCCESS |
| 5 | S-E evals | `98a18b969` | SUCCESS |
| 6 | S-F1 admin | `49fdc1fbc` | SUCCESS |
| 7 | **S-F2 publish** | **`fedd8dea1`** | **SUCCESS** |

**Gate: 987 passed, 1 skipped, 0 failed** (60 named files; the one skip is the vocab-authority
probe that needs `WISDOM_ENGINE_DB`). It opened at **2 failed, 787 passed**.

### What the gate caught, and it was not what merge 7 changed

⭐⭐ **THE MERGE GATE EARNED ITS KEEP — a cross-stream defect no single stream could see.**
S-E's grounding seam resolves S-F's retrieval through a `find_spec` seam. S-F2 made that module
exist for the first time, and the seam had been calling it wrong since the day it was written:

```
seam status: ok
CALL RAISED: TypeError: search() takes 1 positional argument but 2 were given
```

`search(query, *, tickers=(), limit=3, ...)` is keyword-only past `query`; the seam called
`fn(query, k)`. `run_grounding` catches that **per question** into `retrieval_error` and carries on
with `segments = []`, so the with_wisdom arm would have retrieved **nothing** for all 30 questions
while the metric row still said `retrieval: ok` — the two arms identical **by construction**, and
that published as `grounding_faithfulness` / `grounding_citation_validity` / `grounding_coverage`.
The eval exists to ask whether wisdom retrieval grounds better than none. It would have answered
"no difference", because it never asked.

⛔ **Neither stream could have found this alone.** S-E's rails ran in a world where the module did
not exist (every run took the `retrieval_module_absent` branch); S-F has no reason to call S-E's
seam. It is reachable only where the two meet, which is this gate.

**Fixed** by binding the signature ONCE before the seam may promise `ok`, and calling `limit=k` —
the keyword every shipped caller already uses (`adapters/askai.py:73`). An unbindable search is now
refused BY NAME (`retrieval_signature_mismatch`) and the arm runs without retrieval: *"we could not
retrieve"* and *"retrieval added nothing"* are two facts a reader of the D-class metrics must never
see collapsed.

### And the rail that went red was right to, in the wrong place

`test_the_with_arm_uses_retrieval_when_present_and_says_so_when_absent` asserted
`retrieval_module_absent` against a real, un-faked seam. True only before S-F. ⭐ **A rail whose
subject is "which files exist today" silently changes meaning under a merge** — nothing regressed;
the world caught up with the seam's own docstring (*"S-F builds the module; until then None"*). It
now DRIVES both branches, so it reads the same before and after S-F.

⛔ **The hiding goes through `pytest.MonkeyPatch.context()`, never the `monkeypatch` fixture +
`undo()`** — the `db` fixture requests that same instance to pin `WISDOM_DB_PATH`, and an undo
would have unpinned the test database along with it.

⭐ **Note what the old rail could not have caught even in the new world:** it asserted the *string*
the seam returns, and the seam returned the right string. **Arity is not a shape and no validator
sees it**, so the new rail asserts the CALL (CLAUDE.md, *"Contracts — verify against the RUNTIME
CALL SITE, not a harness"*).

**Mutants, each restored byte-exact and sha256-verified (never `git checkout`):**

```
S  seam back to fn(query, k) ............................. 2 failed, 7 passed
T  bind check deleted, call left correct ................. 1 failed (the control ALONE), 8 passed
U  _hide_retrieval made a no-op .......................... 1 failed (the branch rail), 8 passed
   restored .............................................. 9 passed
```

T is the one that matters: it proves the control fires for its own reason and not as a side effect
of S. **A guard nobody has seen fire is not a guard.**

### Merge-7 provenance footer

`weekly_embed` marks the embed **footer**, not the description (`EMBED_DESCRIPTION_MAX` truncates
that from the end), and `deliver` asserts the marker immediately before
`discord_notify._send_webhook` so a marking call dominates the send's own scope. Chose to **mark
rather than exempt**: a Discord webhook is a delivery rather than a consumer table, so the rail
arguably over-reached — but only one of those can be wrong in the direction that matters.

⚠️ **Deviation to state plainly:** `scripts/deploy_watch.py --service web --sha …` printed **nothing
and exited 0**. It was not used as evidence — the deploy was verified from
`railway deployment list --json` polled to a terminal status, then from `/api/health`. Recorded
because an empty result with a zero exit is this programme's most expensive shape, and the tool is
currently unusable as invoked. Not fixed here; it is not Wisdom's file and merge 7 was in flight.

---

## Checkpoint 9 — the §8.6 acceptance run. 11 PASS · 0 FAIL · 1 INCONCLUSIVE. 2026-09-14 04:05 CT

Run in-process against a **sandbox** built from `conftest.shared_data_root_census()` —
**77 pins applied, `unpinnable` 0**, so nothing resolved at the owner's live `C:\data`.
⛔ The pins are derived and applied BEFORE the first `api.**` import, because these paths are
captured at module import and `DATA_DIR` reaches only one of the 77.

| # | check | verdict | evidence |
|---|---|---|---|
| 1 | daily chain end to end | **INCONCLUSIVE** | 9 steps: 6 ok, 2 skipped, 1 failed — `sources`, environmental only (see below) |
| 2 | weekly chain dry run | PASS | 7 steps, 0 failed |
| 2b | weekly report builds | PASS | `weekly-v1`, 8 sections |
| 3 | every rate prints its n | PASS | `ratio_text(0,0)` = `'0/0'` — no percentage; `ratio_text(3,4)` = `'3/4 (75.0%)'` |
| 3b | contract metric names declared | PASS | 11 in `EXPECTED_METRICS` |
| 4 | job roster registers | PASS | **13 jobs** from `registry.job_specs()` |
| 4b | heartbeat / chain-step / observation tables | PASS | all 4 present of 60 tables |
| 5 | flag census | PASS | **24 `WISDOM_*` flags, every one `dark`, none set in env** |
| 5b | the flag READER agrees | PASS | 25 predicates derived from the module itself; **none returns true** |
| 6 | D20 built AND disabled | PASS | `score_silently` runs (`levels_scored: 0`); `level_alerts_enabled()` **False** |
| 7 | provenance CI check | PASS | `ok=True`, **10 consumer write sites, 0 unmarked** |
| 7b | that check can still FAIL | PASS | plants 1 unmarked write → audit finds 1, returns `ok=False` |

⭐ **5b is the one worth keeping.** Reading the ledger tells you what was *declared* dark; asking
the flag module's own predicates tells you what the code will actually *do*. They are two
authorities over one value and the ledger is the one that drifts silently — this repo has already
paid for that with `RESEARCH_TECHNICAL_TAB_ENABLED`. So the predicates are **derived from
`vars(flags)`** (every zero-argument `*_enabled`), never typed, and a flag added tomorrow is
covered the day it lands.

### The one INCONCLUSIVE, stated as what it is

```
sources.run_daily: discord: DISCORD_BOT_TOKEN is not set; transcripts: OperationalError
  {'discord': {'outcome': 'no_token'}, 'transcripts': {'error': 'no such table: edu_videos'}}
```

Both causes are **this box, not the code**: no Discord bot token in a sandbox that deliberately
carries no secrets, and an unseeded `education.db`. ⛔ **Reported INCONCLUSIVE rather than PASS or
FAIL, by name.** A sandbox cannot distinguish *"this code is broken"* from *"this box holds no
credential"*, and collapsing those either manufactures a defect or hides one. Calling it a pass
would be the worse error: it would record the daily chain as proven end to end when two of its
nine steps were never exercised. Verifying `sources` needs either a real token or a seeded Desk
table, and neither belongs in an unattended overnight run.

⚠️ **Four of the first-run "failures" were MY HARNESS, not the product**, and are recorded because
the distinction is the whole point: `flags.enabled(name)` does not exist (the module exposes one
predicate per flag), `registry.JOBS` does not exist (`job_specs()`), `build_weekly` takes
`(conn, *, now=)`, and a chain step's key is `"step"`, not `"name"` — which is why the first run
printed `FAILED=[None]` and named nothing. ⭐ **A harness that guesses at an API produces findings
about the harness.** None of those reached the table above.

⚰️ **And 7b was reported FAIL once, wrongly, by me.** `self_check` PLANTS an unmarked write and
returns `{'found': 1, 'report': {'ok': False}}` — `found: 1` means the guard caught the plant and
`ok: False` is the verdict **on the plant**, which is success. Reading that nested `ok` inverts
the test and calls a working guard broken. The predicate is now `found >= 1 AND report.ok is
False`, which can only be satisfied by a guard that actually fired.

---

## Checkpoint 10 — the LIVE half: production is dark, and every route refuses. 2026-09-14 04:20 CT

The §8.6 census above reads the repo. This reads **Railway and production**, because the ledger
records intent and cannot see either.

### Every WISDOM_* flag, on every service — names only, values are secrets (§11.3)

```
web                       247 vars, WISDOM_*: NONE
worker                     56 vars, WISDOM_*: NONE
bars-api                   30 vars, WISDOM_*: NONE
flow-worker                67 vars, WISDOM_*: NONE
chart-renderer             16 vars, WISDOM_*: NONE
terminal-next-monitor      14 vars, WISDOM_*: NONE
                                    TOTAL SET ANYWHERE: 0
```

**Six services, 430 variables, not one of them `WISDOM_*`.** Six master merges are on production
and the program cannot do anything to a member: §0.4c holds by measurement, not by assertion.

`python tools/flag_ledger_audit.py` (the whole-ledger live half) also reports **0** in every
category: 0 fiction, 0 set-but-undeclared, 0 undeclared-and-off, 0 awaiting a decision.

### Every Wisdom route, anonymously

**27 real GET routes, all 401. None returns JSON to an anonymous caller.**

⛔ **The route list is DERIVED from `registry.routers()`, not typed** — and that matters, because
the first probe I ran used paths I had invented (`…/review/items`, `…/report/weekly`,
`…/capture/status`) and **three of them came back `200`**. Not an auth hole: FastAPI had no such
route, so the request fell through to the SPA catch-all and returned `<!doctype html>`. That is
the exact tell CLAUDE.md records for the unmounted `broker_sync` router (`GET /connect` → 200
HTML), and read carelessly it would have been published as a Wisdom auth leak.

⭐ **So the probe now distinguishes three outcomes, not two:** `401` (gated), `200` carrying the
SPA shell (route absent), and `200` carrying JSON (an actual leak, of which there are none). A
two-outcome probe would have called the SPA fallthrough a pass on the first run and a breach on
the second, and both readings would have been wrong.
