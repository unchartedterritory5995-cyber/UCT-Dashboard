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

| # | merge | merge commit | deployed & verified tip | web |
|---|---|---|---|---|
| 2 | S-A capture | `fb62a44d9` | `fb62a44d9` | SUCCESS |
| 3 | S-C sources | `a64336c89` | `a64336c89` | SUCCESS |
| 4 | S-D extract | `7a2b54369` | `7a2b54369` | SUCCESS |
| 5 | S-E evals | `98a18b969` | `98a18b969` | SUCCESS |
| 6 | S-F1 admin | `b9b12b828` | `49fdc1fbc` | SUCCESS |
| 7 | **S-F2 publish** | **`27921010f`** | **`fedd8dea1`** | **SUCCESS** |

⚰️ **Rows 6 and 7 carried the DEPLOYED TIP in the "commit" column until 2026-09-14 (session 4,
E4).** Both merges were followed by a fix commit before the deploy was verified, and the table
recorded the fix. The merge SHAs are `b9b12b828` and `27921010f`; `49fdc1fbc` and `fedd8dea1` are
the tips that reached Railway. Verified structurally, not by memory: `49fdc1fbc` is the **first
parent** of `27921010f`, and each of rows 2–5 has two parents (a real merge) while `49fdc1fbc` and
`fedd8dea1` have one. ⭐ Rows 2–5 were always correct — for those four the merge commit *was* the
deployed tip, because no fix landed in between, which is exactly why the column heading read
unambiguously right for four rows and wrong for two.

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

---

## Checkpoint 11 — STT. 356 rescued; 254 and 221 were never broken. 2026-09-14 04:21 CT

Text-only `faster-whisper base.en` (int8, 4 threads, VAD on, `condition_on_previous_text=False`),
resumable per video, run beside only the gate's sleeping poll loop. **13.7 GB free at launch.**
⛔ No diarization: the owner answered NO, the HF token question is still open, and no speaker is
inferred anywhere in the output — §8a's rule is evidence or `unresolved`.

| id | video | duration | before | after | wall |
|---|---|---|---|---|---|
| **356** | `rKVAkk3811Q` | 6830 s | **4.2 %** (76 cues) | ✅ **100.0 %**, 1398 cues | 215 s |
| 254 | `G80NM-hRoas` | 4532 s | 68.7 % (1009 cues, a **330 s internal hole**) | 61.6 %, 500 cues, **0 internal gaps** | 78 s |
| 221 | `myuRq5qVOgI` | 4386 s | 92.8 % (1728 cues) | 92.3 %, 1040 cues, **0 internal gaps** | 126 s |

**356 is the win and it was the real defect** — 288 seconds of a 6830-second session, now complete
end to end: it opens *"we got some people joining in here"* and closes on *"Bye."*, with no
internal gap anywhere.

### ⭐ The coverage rule over-flags, and 254 and 221 are the proof

Their numbers did not improve, and that is the finding rather than a failure. **Every second of
their shortfall is AFTER the last word**, with zero internal gaps:

```
254   silence before first speech    0 s | after last speech  1742 s | internal gaps >=30s   0 s
221   silence before first speech    1 s | after last speech   335 s | internal gaps >=30s   0 s
```

and the last cue in each is a sign-off — 254: *"All right, guys, ladies and gentlemen, have…"*;
221: *"…catch you later guys"*. **The recording keeps rolling after everyone says goodbye.**

⛔ **An absence is only evidence if the instrument could have seen a presence**, so the tails were
re-driven with **VAD OFF**, which is the only way to prove the silence is silence:

```
254 [2780..3200]  55 chars  "Alright guys, ladies and gentlemen, have a great night."   (the sign-off, already captured)
254 [4100..4532]   0 chars  silence — no speech at all
221 [4040..4386] 183 chars  "...We'll see you guys tomorrow. Later guys." + "All right." x11
```

**So `cue_span / duration` measures "does speech reach the end of the file", not "did we capture
the speech".** Two of the three videos on the re-transcription list were already complete. The
discriminator that actually separates a lost session from a long outro is **internal gaps plus
whether the last cue is a sign-off** — 356 failed on internal coverage (288 s of 6830 s); 254 and
221 never did.

⚠️ **AND DO NOT "FIX" COVERAGE BY TURNING VAD OFF.** The 221 probe is the warning in one line:
with VAD disabled, dead air produced *"All right."* **eleven times** — whisper's hallucination
loop on silence, the same class this repo already measured and killed with
`condition_on_previous_text=False`. Disabling VAD would push 221's coverage toward 100 % by
**manufacturing transcript text out of silence**, and that text would then be extracted, scored
and attributed to a named author. A number that looks better while the artifact gets worse.

**Recommendation (not applied — it changes the audit's own rule):** gate the under-98 % list on
*internal* gaps, and treat a trailing gap that ends on a sign-off as complete. That would have cut
this run from three videos to one.

⛔ Output is `data/wisdom/audit/stt/` — **`data/` is gitignored** (`git check-ignore` verified), so
no transcript text and none of the 180 MB of cached audio can reach the public repo (§0.4f).
Nothing was written to wisdom.db, education.db or R2; the R2 reads were `head`/`get` only.

---

## Checkpoint 12 — P5 golden gate COMPLETE. Accepted, and it found something. 2026-09-14 04:53 CT

Resumed from the checkpoint, never from zero. **$11.6504 of the $15 cap** (this run: $7.197 —
gate $4.8007, drift $1.0651, trial $1.3314). Neither forbidden batch was re-submitted;
`msgbatch_01Kvf7Q9ZinucRR7xfKQTsnq` and `msgbatch_019NjdbTHu1eK3MXbW2zxMC7` both still read
`collected: true` and were not touched. Three new batches, all collected, 0 errors, 0 transport
errors, 0 `skipped_spend_cap`, 0 retried after max_tokens.

⚠️ **A correction to RESUME.md §3**, which says to pass `--max-usd` equal to the *remaining* cap
(15 − 4.45). `SpendCap.reserve` tests `spent + reserved + usd > max_usd` against the **carried**
ledger total, so `--max-usd` is the TOTAL. Passing 10.55 would have left $6.10 of headroom, not
$10.55, and the gate would have stopped part-way and recorded an INCOMPLETE evaluation. Passed 15.

### The gate — dev split, golden-v1 `db3475c814ee`, 57 segments, `claude-opus-5` high

```
type             tp   fp   fn   precision (n)     recall (n)
CALL             17    7    6   0.708 ( 24)      0.739 ( 23)
LEVEL             6    0    4   1.000 (  6)      0.600 ( 10)
MARKET_SIGNAL     3    3    0   0.500 (  6)      1.000 (  3)
MENTION          51    7    0   0.879 ( 58)      1.000 ( 51)
NEGATIVE_CALL     4    1    2   0.800 (  5)      0.667 (  6)
PRINCIPLE        14    6    1   0.700 ( 20)      0.933 ( 15)
```

**decision `accepted`** — `baseline: true`, `compared_to: null`, `regressions: []`. ⛔ Read that
honestly: this is the FIRST recorded evaluation for `wx-v0-74bafea0`, so "accepted" means *"there
was nothing to regress against"*, not *"these numbers are good"*. 882 records kept, $0.0054 per
record.

⛔⛔ **AND THE HEADLINE NUMBERS COVER 14 % OF THE OUTPUT.** `golden.match_segment` scores a
prediction only when its quote span **overlaps a golden label's span**:
`scored = [p for p in predicted if any(_overlap_ratio(...) > 0 for s in spans)]`. So of **882
records kept, 763 were never scored** — they are claims about paragraphs nobody labelled, and the
gate is structurally blind to them. **Precision above is precision ON LABELLED TEXT; it does not
bound the extractor's false-positive rate on the other 86 %.** A record invented about an
unlabelled paragraph cannot appear as an `fp` here.

### ⛔⛔ DRIFT IS THE FINDING: the extractor agrees with ITSELF half the time

Same model, same effort, same 10 segments, run twice:

```
mean_jaccard        0.5046          identical_segments  3 of 10
                 agreed   run_1   run_2
CALL                17      23      21
MENTION             93     117     116
LEVEL                2       3       3
MARKET_SIGNAL        4      17      19      <- ~24 % agreement
PRINCIPLE            6      30      28      <- ~20 % agreement
```

`claude-opus-5` takes no temperature, so this is inherent run-to-run variance, not a
misconfiguration. **PRINCIPLE and MARKET_SIGNAL are effectively not reproducible**: re-run the
same session and you get a largely different set of principles.

⭐ **Why this outranks the precision table.** PRINCIPLE rows are the ones destined for the Brain KB
and Ask-AI under D18 — replacing the stale Bonde-credited rows with "dated, signed, linked Wisdom
rows". A row that would not survive re-running the extractor on the same paragraph is not a
finding about what the team teaches; it is a sample from a distribution. **Publishing it and
citing it to a named author is the part that cannot be undone**, and nothing in the current design
tells a reader which side of that line a given row is on.

This is a measurement, not a proposal. It is recorded for the owner, and D18's adapters stay dark.

### The smaller-model trial — VERDICT: NO SWITCH

20 shared segments, `claude-sonnet-5` vs `claude-opus-5` scored on the same golden spans:

| type | opus P | sonnet P | Δ precision | opus R | sonnet R |
|---|---|---|---|---|---|
| CALL | 0.583 | **0.778** | **+0.194** | 0.875 | 0.875 |
| LEVEL | **1.000** | 0.667 | −0.333 | 0.333 | **0.667** |
| MARKET_SIGNAL | 0.500 | 0.500 | 0.000 | 1.000 | 1.000 |
| MENTION | **1.000** | 0.800 | −0.200 | 1.000 | 1.000 |
| NEGATIVE_CALL | 1.000 | 1.000 | 0.000 | 1.000 | 1.000 |
| PRINCIPLE | **0.700** | 0.636 | −0.064 | 1.000 | 1.000 |

Cost on those segments: opus **$1.7214** (289 records) · sonnet **$1.3314** (277) —
**$0.004806 vs $0.005956 per kept record, ~19 % cheaper.**

⛔ **Not a tie, so D5's condition is not met and the model does not change.** Sonnet wins CALL
precision and loses LEVEL, MENTION and PRINCIPLE. The expected counts are 8, 3, 1, 4, 1 and 7 — a
single record moves a rate by 12–100 points, so no cell here separates the models. The tool's own
rule says the rest: *"a trial is not a gate evaluation: a smaller model becomes eligible only
through a full gate run of its own."*

---

## Checkpoint 13 — Wave 1.5 item 4 MEASURED. The schema lever, isolated. 2026-09-14 07:50 CT

Gate + drift on `wx-v0-fc47bc97`, pinned to `--golden-file golden-v1.jsonl` (sha `db3475c814ee`,
57 segments) so it is like-for-like with the 2026-09-14 baseline on the SAME 10 drift segments.
**$5.22 this run; $16.8725 of the $40 cap.**

### ⭐⭐ The mean moved +0.002 while PRINCIPLE nearly TRIPLED

```
type             old      new    delta      old(agr/r1/r2)   new(agr/r1/r2)
CALL            0.630    0.708   +0.079           17/23/21         17/21/20
LEVEL           0.500    0.500   +0.000              2/3/3            3/5/4
MARKET_SIGNAL   0.125    0.231   +0.106            4/17/19          6/15/17
MENTION         0.664    0.638   -0.027         93/117/116       88/113/113
PRINCIPLE       0.115    0.325   +0.210            6/30/28         13/26/27
MEAN            0.505    0.507   +0.002
```

⛔ **This is item 1 justifying itself on its first real use.** A reader of `mean_jaccard` alone
would conclude the schema change bought NOTHING. The type the whole wave exists for improved by
**a factor of 2.8**, and the average could not see it because MENTION's 113 records per run swamp
PRINCIPLE's 26 (`lesson_a_hit_rate_is_meaningless_without_its_base_rate`).

### ⭐⭐ And most of the REMAINING drift is wording, not disagreement

```
PRINCIPLE       strict 0.325   paraphrase-tolerant 0.767   (agreed 13 -> 23)
MARKET_SIGNAL   strict 0.231   paraphrase-tolerant 0.524   (agreed  6 -> 11)
```

Under an identity that treats a reworded claim as the same claim — with the antonym guard, so
"never average down" and "always average down" are still counted as different — **PRINCIPLE
reaches 0.767 against a 0.8 floor.** So roughly two thirds of what is left is the extractor
finding the SAME teaching and saying it differently, not finding a different teaching.

⛔ **That changes what N=3 voting is worth.** Voting matched on the STRICT key would pay 3x to
average over a disagreement that is mostly in the identity function, not in the extraction. The
owner's item 2 already specifies the right matcher — *"match records across runs by normalized
statement + span overlap"* — and this measurement says that choice is doing most of the work,
not the third pass.

### Precision and recall barely moved, and mostly up

```
type             P old   P new      dP     R old   R new      dR
CALL             0.708   0.692   -0.016    0.739   0.783   +0.043
LEVEL            1.000   1.000    0.000    0.600   0.600    0.000
MARKET_SIGNAL    0.500   0.500    0.000    1.000   1.000    0.000
MENTION          0.879   0.895   +0.015    1.000   1.000    0.000
NEGATIVE_CALL    0.800   1.000   +0.200    0.667   0.833   +0.167
PRINCIPLE        0.700   0.765   +0.065    0.933   0.867   -0.067      ⛔ WITHDRAWN — see below
```

⛔⛔ **CONFOUNDED — DO NOT CITE THE PRINCIPLE PRECISION/RECALL DELTA (recorded 2026-09-14
session 2, narrowed and applied session 4).** `golden.py` bound `_tokens` twice at module level
from `c9d6af653` (2026-09-14 12:09:48Z): the similarity scorer's at `:329` and the paraphrase
lens's at `:689`. Python keeps the last, so `match_segment`'s PRINCIPLE similarity ran the
**lens's** tokenizer. gate-run-1's reports are 09:35:44Z and 09:52:59Z (before); gate-run-2's is
13:23:53Z (after). **The two runs were scored with different similarity functions, so
P 0.700 → 0.765 and R 0.933 → 0.867 cannot be attributed to the schema change.** Master fixed the
shadowing in `e56a11b3e`, merged here at `6c2b85749`. Re-scoring locally is impossible — the raw
outputs were never persisted (only aggregates and record keys) — so closing it costs a $4.34
re-run of the 57-segment gate phase. Owner ruling 2026-09-14: `Q3_RERUN: NO`, so the row stands
withdrawn rather than re-measured, and **nothing was spent**.

⭐⭐ **ONLY THE PRINCIPLE ROW IS AFFECTED. The other five rows stand as recorded.** Proved from
source, not assumed: `match_segment` has two branches, and the **non-PRINCIPLE** branch
(`golden.py:376-392`) matches on `pre_entity_type`, ticker equality, `stance` and `direction` —
**it never calls `_tokens`**. The single `_tokens` call site in the function is `:404`, inside the
PRINCIPLE branch. Scoring *scope* is `_overlap_ratio` over character spans (`:360-362`), also not
token-based. So CALL, LEVEL, MARKET_SIGNAL, MENTION and NEGATIVE_CALL were scored identically in
both runs.

⭐ **The DRIFT numbers are NOT affected either** and stand as recorded: drift keys on
`writer.Chunk.key` → `writer.normalize_quote_key`, which never calls `golden._tokens`.

Records kept **882 -> 835**, unscored **763 -> 718**, cost **$4.8007 -> $4.3357**, cache read
share **0.773 -> 0.877**. ⭐ The tighter schema is CHEAPER per record as well as steadier.
⚠️ The sentence that stood here — *"PRINCIPLE trades one miss for fewer inventions, which is the
trade the tightening was for"* — is withdrawn with the row it described. It read as the finding
the whole schema change was for, which is precisely why it had to be struck rather than footnoted.

### ⛔ The finding the owner has to rule on: EVERY type is under the floor

On strict identity: CALL 0.708 · MENTION 0.638 · LEVEL 0.500 · MARKET_SIGNAL 0.231 ·
PRINCIPLE 0.325. Item 2 says voting applies to *"PRINCIPLE and MARKET_SIGNAL (and any record type
whose drift is below 0.8)"*, and that CALL/MENTION/NEGATIVE_CALL/LEVEL keep single-pass
*"unless their measured drift says otherwise"*. **It says otherwise.**

⚠️ But CALL, MENTION and LEVEL have STRUCTURED keys — `(type, ticker, stance, direction)` — so
their disagreement is genuinely about which calls exist, and the paraphrase lens does not apply
to them. There is no cheap identity fix there; the only lever is more passes. Taken literally the
rule triples the whole catalog bill rather than the teaching half.

### Item 6 — the 3-pass projection, printed before anything is submitted

Measured on `wx-v0-fc47bc97`: **$0.07607 per segment**, **$0.005192 per kept record** (batch,
opus-5, effort high, cache read share 0.877, 0 errors).

| | |
|---|---|
| documented 1-pass catalog estimate | **$80.00** (the basis of `WISDOM_EXTRACT_BUDGET_USD = 80 × 1.5`) |
| implied segments at the measured rate | ~1,052 |
| **3 passes** | **$240.00** |
| `WISDOM_EXTRACT_BUDGET_USD` cap | $120.00 |
| **over the cap by** | **$120.00** |

⛔⛔ **A CALL RETURNS ALL SIX RECORD TYPES, so "3-pass on PRINCIPLE/MARKET_SIGNAL" is not
purchasable as written.** Three passes over a source is three passes of everything in it. The
lever is **which SOURCES get three passes**, not which types — teaching-heavy sources (workshops,
Mental Game, interviews) are where PRINCIPLE lives, and 3-passing those while single-passing the
rest is the shape that fits under the cap.

⚠️ **Two numbers are owed before any submission** and neither is guessable from here: the
per-source segment counts (the catalog is not on this box), and a re-based 1-pass estimate —
$80 is documented, not measured, and the measured per-segment cost has fallen since it was
written. "Likely under $80" is not a budget.

## ⭐⭐ WHAT "PRODUCTION IS DARK" MEANS — and the 2026-09-14 23:32 ET measurement

⛔ **The definition changed on 2026-09-14 (session 5, owner ruling R18).** It is now three
numbers, all derived, none typed:

> **0 of the 25 registry gates set** (of which **10 are member-visible**), **0 switch-shaped env
> vars read outside the registry**, and **27 of 27 Wisdom GET routes returning 401** to an
> anonymous caller.

⚰️ **The old line — "six services, 430 variables, zero `WISDOM_*` set anywhere" — is
SUPERSEDED, and not merely restated.** It counted variables by NAME PREFIX, and the prefix is
wrong: **`ASKAI_WISDOM_RETRIEVAL_ENABLED`** is the Ask-AI kill switch, it is **member-visible**,
and it does not begin with `WISDOM_`. A prefix scan reports "zero WISDOM_* set" while that
switch is lit. The gate list now comes from **`flags.GATES`**, the same registry the admin status
page and the ledger rail read, which also carries `member_visible`.

### The measurement — `scripts/wisdom_dark_check.py`, 2026-09-14 23:32 ET

| half | result |
|---|---|
| routes (`--host https://uctintelligence.com`) | ⭐ **27 of 27 -> 401. 0 LIT, 0 unreachable.** Latency min 84 ms / median 113 ms / max 684 ms. Exit **0 (PASS)** |
| gates (`--local`) | **0 of 25 set on this machine** |
| off-registry switches | **0** |

⛔ **The route half is a PRODUCTION measurement; the gate half is NOT.** `--local` reads this
machine's environment, which says nothing about Railway. Reading production's variable state
needs Railway credentials, and this session did not attempt it — **the production gate state is
the owner's to confirm from Railway**, and until he does, "0 of 25 in production" is unmeasured
rather than measured.

> ✅ **CLOSED IN SESSION 9 (2026-09-15, owner ruling R24_VIA_RAILWAY_EXIT_CODES).** The
> production half is now measured: **0 of 25 SET on `web`**, all ten member-visible ones
> included. The paragraph above stands as the honest state at the time it was written and is
> kept for that reason — see *"Session 9 — R24 is closed"* below for the method, which reads
> presence by a child process's EXIT CODE and never lists, prints or compares a value.

⭐ **All four templated routes were genuinely probed**, with a placeholder id substituted, rather
than skipped. A guard that fires before the lookup 401s on a nonexistent id, which is the
evidence wanted — skipping them would have left 4 of 27 unmeasured while the run still said
"checked".

**How it was sent** (printed by the tool before any request left): GET only · no Authorization,
no Cookie, no push secret · one request per route · 250 ms spacing · 10 s timeout · no retries ·
status and byte-shape read, **no body stored or printed**.

⚠️ A `User-Agent` is set, and that is deliberate rather than sloppy: Cloudflare 1010-blocks bare
tool UAs, which would make every route read UNREACHABLE and the run read clean.

## ⛔⛔ THE 3-PASS GATE RUN IS READY AND WAS NOT RUN — 2026-09-15 (session 6)

Owner ruling **R2_GATE_3PASS_SPEND: YES**, $13.01. **It did not run, and no money was spent.**

**Why: `ANTHROPIC_API_KEY` is not set in this session's environment.** `batch.make_client`
(`api/services/wisdom/extract/batch.py:63-65`) reads it from the environment and raises
`ExtractUnavailable` without it. There is no `.env` in the worktree and the repo carries no
key-loading helper — the key comes from the operator's own environment. ⛔ No attempt was made to
locate it elsewhere; §11.3 keeps secrets out of files, and hunting for one is not a workaround.

### ⭐⭐ AND THE COMMAND NEEDS `--golden-file golden-v1.jsonl`, OR IT COSTS 46% MORE THAN RULED

Measured by dry run (no API call, $0.00):

| golden set | dev records | segments | 3 passes @ $0.076066 | vs the $14.96 hard stop |
|---|---:|---:|---:|---|
| `golden-v1.jsonl` | 67 (0 NULL) | **57** | **$13.01** | within |
| `golden-v1.1.jsonl` **(the DEFAULT)** | 93 (26 NULL) | **83** | **$18.94** | ⛔ **breaches it** |

⛔ **The ruling authorised "the 57-segment gate set", and that set is golden v1 — but the gate
defaults to the NEWEST golden file present, which is now v1.1.** An unpinned run would quietly
buy 83 segments three times. The pin is not optional.

### The exact invocation, ready to run

    python tools/wisdom/extract_golden_gate.py \
      --db data/wisdom/extract/gate.db \
      --data-dir data/wisdom \
      --out-dir data/wisdom/extract/gate-run-3 \
      --ledger data/wisdom/extract/spend-ledger.json \
      --golden-file golden-v1.jsonl \
      --split dev --phases gate --max-usd 40.0

Run it **three times** (same flags, same `--out-dir`), then `reconcile_stability` picks the three
persisted runs up automatically. ⚠️ `--max-usd` is the **ledger-carried TOTAL**, not the
remainder — 40.0 is correct, and the run stops itself at the cap.

**Verified by dry run:** `extractor_version wx-v0-fc47bc97`, model `claude-opus-5`, effort
`high`, transport `batch`, worst case per request $0.42. Persistence is ON by default (R12), so
each pass writes `data/wisdom/gate-runs/<stamp>/records.jsonl`.

⭐ **An alternative worth a ruling:** v1.1 at **$18.94** still fits the $23.13 headroom, and it
would produce the NULL false-positive numbers **item 5** has been waiting on — which RQ-v11-001
now has a queue for (session 6, `evals/null_review.py`). One run, two items closed, $5.93 more
than authorised. Not taken, because it is more than the ruling said.

## Session 7 — 2026-09-15: the branch is PUSHED, the chain is complete, the run is still unbought

⭐⭐ **`feat/wisdom-loop` IS PUSHED.** `ef0393790..a5ee068f9`, divergence **0 0**. Six sessions of
work existed only on this box until now. Nothing deployed: Railway deploys from **master**, and
master was not touched (no refspec, no force).

⛔ **The three passes were NOT bought, for the second session running: `ANTHROPIC_API_KEY` is not
set in the session environment.** `batch.make_client` raises `ExtractUnavailable` without it.
**$0.00 spent; the ledger is byte-identical for the fourth session in a row.**

### The DAILY chain is now complete end to end

    … evals → rq_v11_001 → reconcile_stability → publication_floor

Every adjacency is load-bearing and each is pinned by a test:

| step | why it sits where it does |
|---|---|
| `rq_v11_001` | the NULL question reaches the owner's queue **as a question**, before the floor acts on the record |
| `reconcile_stability` | the floor **reads** the `stability` this **writes** — reversed, it would judge yesterday's scores |
| `publication_floor` | last, so it sees both |

**Measured inert on an empty store, all three in order:**

    rq_v11_001          -> emitted 0, created 0, skipped: no gate run recorded
    reconcile_stability -> skipped: only 0 persisted run(s); need 3
    publication_floor   -> blocked 0, enqueued 0
    review queue rows: 0   wisdom_records rows: 0

⭐ That is the whole safety argument for the eventual flip, and it is now a measurement rather
than a claim: with no records, the chain writes nothing.

### What the first real run still needs

**Ruled golden set: v1.1** (`R27_GOLDEN_SET: V1_1`) — 83 segments, 93 dev records, **26 NULL**.
Projection **$18.94**, hard stop **$21.78**, headroom $23.13. Dry run re-verified this session:
`extractor_version wx-v0-fc47bc97`, `claude-opus-5`, effort high, transport batch, persistence ON,
`data/wisdom/gate-runs/` **empty**.

⛔ **`--golden-file golden-v1.1.jsonl` must still be pinned explicitly.** It happens to be the
default today, but the default is "newest present" — the next golden file to land silently
changes what an unpinned run buys.

    python tools/wisdom/extract_golden_gate.py \
      --db data/wisdom/extract/gate.db \
      --data-dir data/wisdom \
      --out-dir data/wisdom/extract/gate-run-3 \
      --ledger data/wisdom/extract/spend-ledger.json \
      --golden-file golden-v1.1.jsonl \
      --split dev --phases gate --max-usd 40.0

Three times. Then `reconcile_stability` finds them automatically.

⭐ **v1.1 buys two items at once:** item 2's three passes AND item 5's NULL false-positive numbers,
which now have a queue to land in (`rq_v11_001`). It is also the re-measurement Q3 withdrew.

## Session 8 — 2026-09-15 04:39 ET: the key has a name now; the run is still unbought

⭐ **`WISDOM_ANTHROPIC_API_KEY` is now what the gate reads** (R32, `batch.py` `KEY_VARS`),
falling back to `ANTHROPIC_API_KEY`. ⛔ **The generic name was never free to set**:
`ANTHROPIC_API_KEY` is the variable **Claude Code itself** reads to authenticate and bill, so
exporting it to feed the gate would change how the agent session launching the gate is
authenticated — on the account paying for that session. The programme now carries its own
credential under its own name.

⛔ **Readiness at 04:39 ET: BLOCKED.** Neither variable is set. Third session running with the
run ready and unbought. **$0.00; the ledger is byte-identical for the fifth session in a row.**

**To unblock:** export **`WISDOM_ANTHROPIC_API_KEY`** in the shell that launches Claude Code, on
the machine Claude Code runs on. ⚠️ A session already running will not see it — the process
environment is inherited at launch, so it needs a fresh session afterwards.

### Master synced deliberately short

**25 commits**, merged at `3058cde1d`. **None** touches `api/services/wisdom/**`,
`tests/test_wisdom_*`, `tests/conftest.py`, `core/schema.py`, any migration, or any file under
`.github/workflows/` — so neither the promotion gate nor the R21 xfail baseline is affected.
⭐ Kept short on purpose: session 6 merged **111** after letting the gap run, and the lesson
recorded then was that the risk of waiting looks low right up until it is not.

### Pre-run baseline, 2026-09-15 04:38 ET

The complete chain against an empty store, in order:

    rq_v11_001          -> emitted 0, created 0, skipped: no gate run recorded
    reconcile_stability -> skipped: only 0 persisted run(s); need 3
    publication_floor   -> blocked 0, enqueued 0
    review queue rows: 0   wisdom_records rows: 0

Chain order verified on the merged tree: `chain.py:68` evals → `:79` rq_v11_001 → `:85`
reconcile_stability → `:92` publication_floor, and the twelve-step exact-order pin passes.

### ⚠️ The next daily-chain window is TONIGHT, not Wednesday

`wisdom_daily_chain` is **cron mon-fri 18:47 ET** (`CONTRACTS.md:296`). At 04:39 ET Tuesday the
next fire is **Tuesday 2026-09-15 18:47 ET, ~14 hours away** — not Wednesday the 16th. Recorded
because a checklist pointing at the wrong evening is worse than no checklist.

⛔⛔ **And a flip at that window would still write NOTHING**: `wisdom_records` is at **0 rows**,
so there is nothing to extract from, reconcile, block or queue. The flip is only informative
**after** the three passes exist. **Buy the run first.**


## Session 9 — 2026-09-15: R24 is closed, the key has three sources, and pass 1 is in flight

### R24 is CLOSED — production is dark, and now that is MEASURED

> **0 of the 25 registry gates are SET on the production `web` service**, and that includes all
> **10 member-visible** ones — `ASKAI_WISDOM_RETRIEVAL_ENABLED` among them.

⛔⛔ **HOW IT WAS MEASURED, because the method is the only reason this was permissible at all.**
Presence was read by **a child process's EXIT CODE**, one child per gate name: the process exits
`0` if the variable is present and `1` if it is not, and **prints nothing either way**. No
command that lists variables was run — not `railway variables`, not `env`, not `printenv`, not
`Get-ChildItem env:` — and no value was printed, echoed, hashed, compared or written anywhere.
⭐ The distinction that makes this safe is that **presence is a one-bit fact and a value is not**,
and an exit code is the only channel narrow enough to carry the first without the second.

⚠️ `railway run` **reads** the environment into a child process; it never sets, unsets or edits
one. `railway variables --set` and every other write form remain forbidden.

⛔ **A fresh measurement, not an inference from the local one.** The session-5 gate half was
`--local`, which reads this machine and says nothing about Railway; the two agreeing is a result,
not a method. The old paragraph above is marked rather than rewritten.

### R34 — the OS credential store is a third key source, and it loses every tie

`WISDOM_ANTHROPIC_API_KEY` -> `ANTHROPIC_API_KEY` -> keyring (`uct-wisdom` / `anthropic`).
A tie goes to the **environment**: `railway run` and a one-off export are deliberate acts scoped
to one process, while the store is ambient and applies to every run on the machine. `keyring` is
**declared in `requirements.txt` and not installed here** — with it absent the gate behaves
exactly as it did before R34 existed, which is the point and is railed both ways. The failure
message names all three sources and **no value from any of them**.

Mutation-proved: consulting the store BEFORE the environment reds exactly
`test_the_environment_beats_the_store` — **1 failed, 13 passed** — restored byte-exact and
sha256-verified. ⚠️ The anchor had to be encoded CRLF; `batch.py` is CRLF on disk and an
LF-anchored mutation matches zero times and asserts out before touching the file. That is the
fourth time this session family has paid for the same thing.

### R35 — the settings-`env` fallback is DOCUMENTED, NEVER WRITTEN

Owner ruling: DOCUMENT_ONLY. Two standing rules forbid it independently — §11.3 (a key never
lives in a file; a value in the environment dies with the process, one in a settings file waits)
and never self-granting through settings. ⭐ It is written down anyway because an undocumented
path gets rediscovered and tried, and **the hazard is that it would work.**

### Tier 1 safety, re-proved before spending

`--db` overrides `WISDOM_DB_PATH` through `common.bootstrap` (`:41-46`) and refuses a shared
root; `--max-usd` genuinely governs (`SpendCap` reads `args.max_usd`, not `budget_cap_usd()`);
the gate imports no flags and calls neither `write_output` nor `private_put`. A dry run **under
production variable injection** returned the same `wx-v0-fc47bc97` / `claude-opus-5` / `high`
and cap $40 as the uninjected one — so injection changes nothing the gate does.

`extractor_version` is **unchanged at `wx-v0-fc47bc97`** after R34, which is the check that
matters: the key source is not part of the prompt, the contract or the transport, so it must not
move the hash. It did not.

### Step 4d exists BEFORE it is needed — and it has been seen to fail

`tools/wisdom/rescore_offline.py` re-scores a finished phase from the persisted records for
**$0.00** and compares it to that phase's own receipt; a disagreement STOPS the next purchase.
It reuses `extract_golden_gate.segment_scores` -> `golden.score` by import — one authority, never
a second implementation — so what it proves is exact: **the persisted records, run back through
the live scoring path, reproduce the reported numbers.** Three exit codes: `0` MATCH, `1`
MISMATCH, `2` INCONCLUSIVE, and an empty phase is INCONCLUSIVE **never** MATCH.

⭐ Its vacuity control earned its place on the first run: the fixture put `stance` at the top
level instead of inside `fields`, so `match_segment` matched nothing and the phase scored
**tp = 0** while looking fully populated — and **every other assertion in the file passed on
it**. 11 tests green.

### Pass 1 is IN FLIGHT and has reported nothing — which is expected, not a fault

Launched 03:51:34 CT under `railway run --service web` against `golden-v1.1.jsonl`, dev split,
gate phase, cap $40.

⚠️ **Its output file is 0 bytes and will stay that way until it exits.** `python` is invoked
without `-u` and its stdout is a pipe through the railway shim, so the header — printed before
any API call — sits in a 4-8 KB block buffer. **0 bytes is a buffering fact, not a progress
fact**, and on this box a silent log is otherwise the signature of an OOM kill, so it was worth
distinguishing rather than assuming: the process is alive, CPU is advancing (8.77 s -> 8.84 s
across the poll interval) and it holds **one established TLS connection on :443**.

The batch transport polls every 20 s with a **3-hour** ceiling (`--batch-timeout-seconds`), and
receipts plus the persisted records are written only **after** the batch ends. So there is
nothing on disk to read mid-flight by design.

⛔ **Nothing downstream may be reported until it lands**: the reconciler needs three runs, the
floor counts need records, and the cost actuals need the ledger. **Pass 2 is gated on 4d
matching pass 1's own receipt exactly.**


## PASS 1 IS BOUGHT AND IT RECONCILES — 2026-09-15 07:16 CT

**The first real gate run against `golden-v1.1` exists.** 83 dev segments, 827 validated records,
**$4.7497**, zero errors, zero retries.

    eval run   afab4baf6b51ee189964d1e6      persisted  data/wisdom/gate-runs/20260915T085142Z
    golden     golden-v1.1 sha c26c871ea5a1  93 dev records, 26 NULL -> 83 segments
    model      claude-opus-5 / high / batch  extractor_version wx-v0-fc47bc97
    decision   accepted (baseline=True, regressions=[])

| type | tp | fp | fn | precision | recall |
|---|---:|---:|---:|---:|---:|
| CALL | 17 | 8 | 6 | 0.680 (25) | 0.739 (23) |
| LEVEL | 6 | 0 | 4 | **1.000** (6) | 0.600 (10) |
| MARKET_SIGNAL | 3 | 3 | 0 | 0.500 (6) | **1.000** (3) |
| MENTION | 51 | 6 | 0 | 0.895 (57) | **1.000** (51) |
| NEGATIVE_CALL | 5 | 1 | 1 | 0.833 (6) | 0.833 (6) |
| PRINCIPLE | 13 | 7 | 2 | 0.650 (20) | 0.867 (15) |

⭐ **The 26 NULL segments produced ZERO null false positives — 0 in 0/26, for every one of the six
types.** That is the half of v1.1 that did not exist in v1, and it is the half most likely to
embarrass an extractor: a segment labelled "there is nothing here" invites a model to find
something anyway. It found nothing, 26 times out of 26.

### Step 4d: the persisted records reproduce the receipt EXACTLY

    compared 30 field(s) over 6 type(s): MATCH
    SELF-CHECK PASSED: dropping one persisted record reds 1 field(s) of 30
      PRINCIPLE  fp  7 -> 6  MISMATCH

⛔ **Both halves are load-bearing and neither is sufficient alone.** The MATCH says the persisted
records, re-scored offline through the live path, reproduce all 30 reported fields. The SELF-CHECK
says that comparison can still FAIL on *this* data — otherwise a MATCH over 30 fields is just as
consistent with a comparison that stopped comparing. **Pass 2 is authorised by this, and by
nothing else.**

### ⚠️ THE RUN TOOK 3h25m, AND THE CAP IS WHY — not the work

Pass 1 went out as **two batches**, not one:

| round | requests | actual | settled |
|---|---:|---:|---|
| 1 | 54 | $3.2521 | 10:00:43Z |
| 2 | 29 | $1.4976 | 12:16:46Z |

⭐ **`SpendCap` is CUMULATIVE OVER THE WHOLE LEDGER, not per run** (`self.spent = sum(entries)`),
and `run_batch_round` sizes each batch to *what the cap can still reserve*. The ledger already held
$16.87 from earlier sessions, so a $40 cap left $23.13 of headroom, and at a **worst case of $0.42
per request** that admitted 54 of 83. The remaining 29 waited for round 1 to settle.

⛔ **The reservation is worst case; the bill is not.** 83 requests reserve **$34.86** and actually
cost **$4.75 — 14% of worst case** (`cache_read_share` 0.7484). So the cap is not throttling
spend here, it is throttling *scheduling*: each extra round is another batch with its own
multi-hour latency. Pass 2 opened with $18.38 of headroom and went out as 43 requests; pass 3 will
open with roughly $13.6 and split further.

**This is a question for the owner, not a decision for the session** — see the report. Raising
`--max-usd` would cost **nothing extra in actuals** and would collapse each pass to a single
batch. ⛔⛔ It has NOT been raised: $40 is the ruled figure and the spend cap is never edited by a
session. Three passes still fit — ~$31.1 of $40 at the measured rate.

### Cost, measured rather than forecast

| | |
|---|---|
| per segment | **$0.05723** (83 segments, $4.7497) |
| vs the prior working rate $0.076066 | **24.8% cheaper** |
| Q4 — the 9,733-segment catalog, ONE pass | **~$557** |
| the same catalog at three passes | ~$1,671 |

⚠️ The discount is real but it is a property of THIS corpus shape: `cache_read_share` 0.7484 means
three quarters of input tokens were cache reads, which depends on the system prompt staying put
across a batch. A prompt change resets that and the rate moves back toward $0.076.

Calibration recorded for the budgeter: output p50 **2,353** / p90 **9,940** / max 15,328 tokens;
input mean 7,120; system 6,509; `max_tokens` stops on first attempt **0**.

### Pass 2 is in flight

`20260915T121930Z`, launched 07:19 CT, same golden sha, round 1 of ~3 sent with 43 requests.
⭐ Invoked with `python -u` this time: pass 1's captured log lost its header and its batch-round
lines to block buffering, which is exactly what made "is it hung or is it working?" cost a
measurement instead of a glance.


## ⛔⛔ EVERY CALL IN PASS 1 WAS DEMOTED TO MENTION — and the gate table cannot show it

**99 of 99 CALLs. Also 28 of 38 LEVELs and 2 of 9 NEGATIVE_CALLs.** Measured from the persisted
records of `20260915T085142Z`:

    pre_entity_type : CALL 99  LEVEL 38  MARKET_SIGNAL 102  MENTION 485  NEGATIVE_CALL 9  PRINCIPLE 94
    record_type     :          LEVEL 10  MARKET_SIGNAL 102  MENTION 614  NEGATIVE_CALL 7  PRINCIPLE 94
    reclassified    : CALL->MENTION 99 | LEVEL->MENTION 28 | NEGATIVE_CALL->MENTION 2

⛔ **`record_type` contains no CALL at all**, while the gate's table reports `CALL tp=17 fp=8
P=0.680`. Both are correct and they are answering different questions: **the table scores
`pre_entity_type`**, which is fixed before entity resolution runs (`writer.py:494`). So the gate
measures the EXTRACTOR, deliberately insulated from whether an entity could be resolved — and the
thing that would actually be WRITTEN is a different distribution entirely.

### The mechanism, read from source rather than inferred

`writer.py:504` — a CALL that cannot be tied to a resolved entity is not allowed to stand:

    if rtype == "CALL" and not (isinstance(entity, dict) and entity.get("entity_id")):
        rtype = "MENTION"; reasons.append("call_entity_unresolved")

The reason strings distinguish the two cases, and that is what settles it. All 99 carry
**`call_entity_unresolved`**, NOT `call_entity_unresolved:no_resolver` — so a resolver was
present, ran, and returned nothing. **Every one of the 827 records has `entity: none`.**

⚠️ **It is not the authors and not the corpus, and both were checked before blaming the
environment.** `docs/wisdom/authors.json` marks all four — tsdr, bracco, chartmaster, manrav —
`can_author_calls: true`, and only 8 records anywhere carry `not_a_call_author`. The author gate
passed; the ENTITY gate is what fired.

**The cause is the environment the gate runs in.** `entity_master/schema.py:33` resolves
`DB_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "entity_master.db")` **at import**,
so under `railway run` it took production's `DATA_DIR` and landed on this box's
`C:\data\entity_master.db` — a file that exists, is 86 KB, and has **not been written since
2026-09-02**. It resolved nothing because it holds nothing for these tickers. Nothing wrote to it;
its mtime is untouched.

> ⚰️⚰️ **CORRECTED 2026-09-15 (session 10, R42). The mechanism above is WRONG and the truth is the
> opposite.** `railway run` leaked nothing. The gate imports `conftest` deliberately
> (`extract_common.py:39`, reached from `extract_golden_gate.py:412` before its first `api.*`
> import), and `conftest.py:515` redirects `DATA_DIR` to a **fresh `mkdtemp` sandbox per process** —
> including when the value is `/data`, because that abspaths to the shared root
> (`conftest.py:505-508`). Each run therefore created a **brand-new EMPTY entity master** and read
> that. Evidence: three sandbox databases whose mtimes match the three gate manifests to within
> 0.3 s, each 86,016 bytes with **0 rows in every table**; the shared-root copy's sha256 is
> unchanged. ⭐ The corrected lesson is better than the original: **a sandbox redirect protects
> against writes by guaranteeing an empty read**, and the fail-closed CALL downgrade that follows is
> indistinguishable from a corpus with no calls in it. See `docs/wisdom/HARD-RULES.md`, R42.

### What this does and does not contaminate — bounded, not hand-waved

| consumer | keyed on | effect |
|---|---|---|
| the gate's precision/recall table | `pre_entity_type` | ✅ **unaffected** — measured before the demotion |
| item 3, the publication floor | PRINCIPLE, MARKET_SIGNAL | ✅ **unaffected** — neither type is ever demoted (94 -> 94, 102 -> 102) |
| R30 MARKET_SIGNAL rename audit | MARKET_SIGNAL | ✅ **unaffected** — 102 in, 102 out |
| item 2, the reconciler's per-type stability | `record_type` / `record_key` (`reconcile.py:95,101`) | ⛔ **CALL is vacuous (0 records) and MENTION is polluted** — 99 demoted CALLs and 28 demoted LEVELs land in MENTION's bucket under the same ticker |

⭐ **So the three-pass stability numbers for CALL and MENTION will describe the harness, not the
product**, and they must be reported that way or not at all. The persisted rows carry
`pre_entity_key` beside `record_key` precisely so the same run can be re-keyed offline for $0.00 —
which is what step 5 will do, reporting both views side by side rather than silently picking one.

### ⛔ NOTHING WAS CHANGED, AND THAT IS THE POINT

The fix is obvious and must not be applied now: **passes 1, 2 and 3 have to be identical or the
stability measurement means nothing.** Giving pass 2 a populated entity master would confound the
three-run comparison exactly the way the withdrawn PRINCIPLE delta was confounded by a tokenizer
that changed between runs. The environment stays frozen for all three passes; whether to seed the
entity master and re-run is the owner's call, and it is a question in the report.

⚠️ **This also sharpens what R33 bought.** `railway run` injects production variables into a LOCAL
process, and a module that derives a path from `DATA_DIR` at import will therefore point at this
box's `C:\data`. That is how a production variable reaches a local file, and it is worth knowing
before the next tool is run that way.

### OPEN — one shared-root observation, recorded rather than resolved

`C:\data\wisdom.db` was written at **07:24:39**, about five minutes into pass 2 and eight after
pass 1 ended. Neither moment corresponds to anything the gate does (pass 1's eval was written at
07:16:46; at 07:24 pass 2 was polling a batch and writing nothing). No `-wal`/`-shm` sidecars, and
no backend process was found — but this box was demonstrably writing other shared-root files in
the same window (`desk.db` 07:07, `fundamentals_tables.db` 07:15,
`flow_conviction_board.json` 07:25:32), so something local is active.

⛔ The gate's own store cannot be the writer — `common.bootstrap` REFUSES a shared root — and the
balance of evidence says this is not ours. **That is not a measurement, so a baseline was taken
rather than a conclusion reached:** sha256 `8B528BBC…68DF2F`, mtime 07:24:39, read at 07:26:56.
It is re-read when pass 2 lands; if the content moved while only the gate was running, that is a
stop-and-escalate, not a note.


## PASS 2 — 2026-09-15 07:33 CT. It reconciles, and the run-to-run spread is now MEASURED

83 calls, **$5.0955**, 824 records, zero errors, zero retries. Three batch rounds (43 / 36 / 4),
`20260915T121930Z`, eval `ab1f7ef85094cb38db114ea4`. **Step 4d: MATCH, 30 of 30 fields**, with the
self-check firing on the same data (`PRINCIPLE fp` 5 -> 4).

| type | pass 1 tp/fp/fn | pass 2 tp/fp/fn | moved |
|---|---|---|---|
| CALL | 17 / 8 / 6 | 17 / **10** / 6 | +2 fp (P 0.680 -> 0.630) |
| LEVEL | 6 / 0 / 4 | **5** / 0 / **5** | −1 tp (R 0.600 -> 0.500) |
| MARKET_SIGNAL | 3 / 3 / 0 | 3 / 3 / 0 | — |
| MENTION | 51 / 6 / 0 | 51 / 6 / 0 | — |
| NEGATIVE_CALL | 5 / 1 / 1 | 5 / **0** / 1 | −1 fp (P 0.833 -> 1.000) |
| PRINCIPLE | 13 / 7 / 2 | **14 / 5 / 1** | +1 tp, −2 fp, −1 fn |

⭐⭐ **THIS RETROSPECTIVELY VINDICATES REFUSING THE v1 COMPARISON.** The v1 baseline measured
PRINCIPLE at **14 / 6 / 1**. Pass 1 came in at 13 / 7 / 2 — which, cited alone, is a drop. Pass 2
came in at **14 / 5 / 1, nearer the v1 baseline than pass 1 was, and slightly better**. The same
configuration, the same bytes, two runs: the "regression" was sampling noise. ⛔ A single run
compared against a single earlier run cannot distinguish a real change from this, which is exactly
why the withdrawn PRINCIPLE delta had to stay withdrawn and why item 2 exists.

⭐ MENTION (51/6/0) and MARKET_SIGNAL (3/3/0) reproduced **exactly**. The spread is not uniform
across types — which is itself the thing Q17's floor is built to respect.

⚠️ Cost rose $4.7497 -> $5.0955 while the work was identical: `cache_read_share` fell
**0.7484 -> 0.5833**. The cache is a property of batch shape and timing, not of the corpus, so the
per-segment rate has a floor and a ceiling rather than a value. Two-run range:
**$0.05723 – $0.06139** per segment.

### ⭐ `baseline=True` ON EVERY PASS IS CORRECT, AND THE REASON MATTERS

All three passes report `gate decision: accepted (baseline=True, regressions=[])`. That reads like
a gate that cannot fail. It is not — `golden.py:517` **deliberately skips** any prior run with the
SAME `extractor_version`, `model` AND `effort`:

    if run["extractor_version"] == extractor_version and m.get("model") == model        and m.get("effort") == effort:
        continue

**The gate is a cross-CONFIGURATION regression check.** Comparing a configuration against itself
would flag exactly the run-to-run spread tabulated above as a regression, the gate would fire on
every honest re-run, and it would be muted inside a week.

⛔ **So read `accepted` honestly, for all three passes: it means "there was no DIFFERENT accepted
configuration to regress against", not "these numbers are good".** The same warning was written
for the v1 baseline in session 6 and it applies unchanged here.

⭐ The two instruments divide cleanly, and neither substitutes for the other:

| instrument | compares | answers |
|---|---|---|
| `decide_gate` | across configurations | did the new prompt / model / effort make it worse? |
| the reconciler (item 2, Q17) | across runs of ONE configuration | how much of this is the model being non-deterministic? |

### The shared-root observation — investigated, strongly not ours, still OPEN

`C:\data\wisdom.db` DID change during pass 2 (sha `8B528BBC…` -> `9A4B2C6B…`, mtime 07:29:39),
so the baseline was honoured and the run stopped for it. What the investigation found:

- **The size did not move: 352256 bytes before and after.** Pass 2 persisted **824 records**; that
  cannot be a size-stable write.
- **`gate.db` grew 675840 -> 696320 at 07:33:42** — the gate's eval landed exactly where `--db`
  sent it, and its records are in the worktree (`records.jsonl`, 1.6 MB).
- **Two files the gate cannot write moved in the same minutes**: `fundamentals_tables.db` at
  07:30:04 (25 s after wisdom.db) and `flow_conviction_board.json` at 07:34:32 — and
  `fundamentals_tables.db` has been moving on a ~15-minute cadence all morning.
- `common.bootstrap` **refuses** a shared root, so the gate's store cannot resolve there.

⛔ **The writer was NOT identified** (the only python listener on this box is an unrelated Pine rig
on :8129), so this is recorded as evidence, not as a closed question. It is almost certainly a
local scheduled job doing a round of writes. **It is not "confirmed clean" and is not written up
as such.**

### Pass 3 is in flight

Launched 07:34 CT, headroom $13.28 of the ruled $40 — so expect three rounds again.


### ✅ THE SHARED-ROOT OBSERVATION IS CLOSED — the writer has a name

`C:\data\wisdom.db` changed at **07:24:39, 07:29:39 and 07:34:39** — five minutes apart, on the
same second, size unchanged at 352256 every time. A batch-polling gate does not write on a metronome.

The heartbeat table names it. Reading **only** `wisdom_job_heartbeats` (job ids and timestamps —
no records, no quotes, no member rows):

    wisdom_core_catchup    2026-09-15T08:34:39-04:00   skipped   380 beats
    wisdom_core_watchdog   2026-09-15T08:34:39-04:00   skipped   380 beats

**08:34:39 ET is 07:34:39 CT — the file's mtime to the second.** The writer is the Wisdom
programme's own scheduled watchdog pair, beating every five minutes from a local scheduler, and
both report `skipped`, which is what a dark programme's watchdog should say. ~380 beats is about
31 hours of running.

⭐ **The method is the point, not the answer.** A hash baseline was taken *before* the run, the
content moved, the run stopped for it, and the question was then settled by reading the artifact
that records the fact — not by reasoning about which process "probably" did it. The earlier
write-up said "strongly not ours, writer NOT identified" and refused to call itself clean; that was
the correct state then, and this supersedes it with evidence rather than with confidence.

⛔ It also removes a live worry in the right direction: the gate's `--db` and `common.bootstrap`'s
shared-root refusal were never in question, and now nothing about the gate is implicated at all.


## ⭐⭐ THREE PASSES ARE BOUGHT. THE FLOOR IS NOT INERT — IT BLOCKS 88% OF WHAT IT GOVERNS

Pass 3: 83 calls, **$4.7638**, 839 records, four rounds, step 4d **MATCH 30/30** with the
self-check firing. Ledger **$31.4815 of the ruled $40.00**, as forecast.

| pass | run id | eval | records | cost | rounds | cache read |
|---|---|---|---:|---:|---:|---:|
| 1 | `20260915T085142Z` | `afab4baf…` | 827 | $4.7497 | 2 | 0.7484 |
| 2 | `20260915T121930Z` | `ab1f7ef8…` | 824 | $5.0955 | 3 | 0.5833 |
| 3 | `20260915T123550Z` | `93a248c9…` | 839 | $4.7638 | 4 | 0.7594 |

**All three re-score offline to 30 of 30 fields, each with a self-check that fires.**

### ⛔⛔ RECALL IS STABLE; PRECISION IS WHERE THE NON-DETERMINISM LIVES

| type | tp across 3 passes | fp across 3 passes |
|---|---|---|
| CALL | **17, 17, 17** | 8, 10, 9 |
| MENTION | **51, 51, 51** | 6, 6, 7 |
| NEGATIVE_CALL | **5, 5, 5** | 1, 0, 1 |
| MARKET_SIGNAL | **3, 3, 3** | 3, 3, 2 |
| LEVEL | 6, 5, 6 | **0, 0, 0** |
| PRINCIPLE | 13, 14, 13 | 7, 5, 6 |

⭐ **The model finds the same true records every time and varies in how much EXTRA it emits.**
Four of six types have an invariant `tp`; `fn` moves only where `tp` does. Nothing in three runs
changed a recall number except LEVEL once and PRINCIPLE once. That is a far more useful
characterisation than a single precision figure, and it could not have been seen from one pass.

### Stability at n=3 — the judgement types are radically less reproducible

    product view (record_type)      total    3/3    2/3    1/3    clears floor
      MARKET_SIGNAL                   236     21     43    172             21
      PRINCIPLE                       182     31     36    115             31
      MENTION                         778    407    151    220            778
      LEVEL                            18      3      3     12             18
      NEGATIVE_CALL                     9      5      2      2              9

    extractor view (pre_entity_type)
      CALL                            116     79     12     25            116
      LEVEL                            46     18     11     17             46
      MENTION                         642    305    140    197            642

⭐⭐ **MARKET_SIGNAL reproduces across all three runs 8.9% of the time (21 of 236). PRINCIPLE,
17% (31 of 182). CALL, 68% (79 of 116).** The two types Q17 chose to floor are, by a wide margin,
the two least reproducible — and **173 of 236 MARKET_SIGNAL identities (73%) appear in exactly ONE
of three runs.** The floor was placed on the right types, and that is now a measurement rather
than a design assumption.

### THE PUBLICATION FLOOR'S FIRST REAL VERDICT

    MARKET_SIGNAL    PUBLISH   21   BLOCK  215     <- floored
    PRINCIPLE        PUBLISH   31   BLOCK  151     <- floored
    LEVEL            PUBLISH   18   BLOCK    0
    MENTION          PUBLISH  778   BLOCK    0
    NEGATIVE_CALL    PUBLISH    9   BLOCK    0
    ENQUEUE -> review tab 'contradictions', reason 'below_publication_floor':  366

⛔ **The floor blocks 366 of the 418 identities it governs — 88%.** Sessions 4 and 5 measured it
**inert**, because it was measured against an empty store; this is what it does with real records
in front of it. Item 3 is the most consequential thing this programme has built, and until today
nobody had seen it decide anything.

⚠️⚠️ **READ THAT AS THE PREDICATE'S VERDICT, NOT AS 366 REVIEW ROWS. Nothing was enqueued.**
`floor.passes` was applied to the reconciler's real stability scores — so the counts above are a
true measurement of **what the floor decides**, on real data, for the first time. They are NOT the
chain having acted: `wisdom_review_queue` still holds **0 rows**, because the golden gate never
ingests into `wisdom_records` (its records live in the runs' JSONL) and both the floor and the
score-writer act on the DATABASE. Proved by running the real chain step below, not assumed. The
distinction matters because "the floor blocked 366" and "366 items are sitting in the review tab"
are different claims and only the first one is true.

⭐ `PUBLISH` equals the `3/3` column exactly for both floored types (21 and 31), which is the Q17
arithmetic visible in the data: at n=3 only 3/3 = 1.0 clears a floor of 0.8, and 2/3 = 0.667 does
not. **`MIN_RUNS = 3` is doing real work** — at n=2 every floored identity blocked regardless of
agreement, which is exactly the refusal-to-guess it was ruled for.

### R30 — a third of MARKET_SIGNAL's churn looks like RENAMING, not disagreement

    market_signal_keys 236   suspected_renames 85   share_of_keys 0.3602   threshold 0.5   n 3

**85 of 236 keys (36%)** are suspected renames at n=3, up from 40 of 180 (22%) at n=2 — more runs,
more chances for a rename pair to appear. R30 accepted a name-based identity for MARKET_SIGNAL on
the grounds that the error is bounded in the safe direction and fully recoverable offline. That
bet is now quantified: **a large minority of MARKET_SIGNAL's 8.9% stability is an artifact of the
key, not of the extractor disagreeing with itself.**

⛔ Counts only. The keys are `normalize_quote_key` of model-written names, so they are
quote-derived and cannot be printed into a public repo — the audit's `examples` field is dropped
rather than truncated, because a truncated quote is still a quote.

### Records per type per run — the variance the stability score compresses away

    LEVEL            10    9    8     spread  2
    MARKET_SIGNAL   102  107  112     spread 10
    MENTION         614  610  617     spread  7
    NEGATIVE_CALL     7    6    8     spread  2
    PRINCIPLE        94   92   94     spread  2

⚠️ MARKET_SIGNAL emitted 102, then 107, then 112. The volume is nearly steady while the IDENTITIES
churn — 236 distinct keys from ~321 record-instances. **A stable count of unstable names** is the
signature R30 predicted.


### The local chain run — `reconcile_stability` fires for the first time, and writes to NOTHING

Run against a **sandbox copy** of the gate db, with the AST-derived census pins applied before any
`api.**` import. ⛔ That is not belt-and-braces: `store.write()` resolves `WISDOM_DB_PATH`, and
unset it derives from `DATA_DIR` — on this box, the owner's live `C:\data\wisdom.db`. Running the
chain bare would have written stability columns into production data.

    reconcile_stability ->
      n: 3   run_ids: [20260915T085142Z, 20260915T121930Z, 20260915T123550Z]   keys: 1223
      MARKET_SIGNAL total 236  clears_floor  21
      PRINCIPLE     total 182  clears_floor  31
      MENTION       total 778  clears_floor 778
      LEVEL         total  18  clears_floor  18
      NEGATIVE_CALL total   9  clears_floor   9
      records_updated: 0        principles_updated: 0

⭐⭐ **`records_updated: 0` IS THE FINDING, and it is visible only because `write_scores` was built
to report it.** Its docstring says so outright — *"so a write that matched nothing is visible
rather than reported as success"* — and that decision just paid for itself. The reconciler computed
1,223 identities and correct stability for every one of them, then wrote them to **zero rows**,
because `wisdom_records` is empty: the golden gate persists to JSONL and never ingests into the
store.

⛔ **So item 2 is correct and wired, and end-to-end it is INERT against a gate run.** The stability
scores have nowhere to land until a real extraction populates `wisdom_records`. A version of
`write_scores` that returned nothing would have reported this as a clean success, and the chain
would have looked finished.

The step's own artifact was written beside the run —
`data/wisdom/gate-runs/20260915T123550Z/reconcile-report.json`, carrying `n`, the three run ids,
1,223 keys, the histogram and `written: {records_updated: 0, principles_updated: 0}`.

⚠️ `rq_v11_001` and `publication_floor` were NOT separately re-run: both read the same empty
`wisdom_records`, so both would answer 0 for the same reason, and re-running them would produce
three zeros that look like three measurements. The session-8 baseline already recorded them at 0.


## SESSION 10 — 2026-09-15: identity BOUNDED, the chain runs on REAL ROWS, Q3 CLOSED. $0.00

Ledger byte-identical at both ends: sha256 `d976dba7…`, 5,405 bytes, **$31.4815 of $40.00**.
No API call, no `railway` subcommand, no gate run.

### ✅ ITEM 5 IS MEASURED — and the 86%-blind worry does not bite here

    fp_null, per type, per pass:  0 / 0 / 0  for all six types.  null_segments = 26.

⛔ **That number alone would not have settled it**, because `fp_null` only counts a prediction
whose span OVERLAPS a declared null span (`golden.py:427-436`) — a record emitted elsewhere in a
NULL segment is invisible to it. So it was re-derived from the persisted runs: **records emitted on
a NULL segment AT ALL = 0, in every type, in all three passes.** The two numbers are identical.

⭐ And the zero is REAL, not an un-run instrument: raw output present 26/26 per pass, usage present
26/26, `raw_output["records"]` length **0 for all 26**, and the NULL-segment spend was
$0.2002 / $0.1808 / $0.1452. The model was asked and answered nothing, 26 times out of 26. The
span-scoping blind spot has **zero surface on golden-v1.1** because every declared null span covers
its whole segment (ratio 1.000, min and max).

### ✅ Q3 IS CLOSED — the schema-lever PRINCIPLE improvement does NOT survive

| | precision | recall |
|---|---|---|
| gate-run-1 baseline (v1) | 0.700 | 0.933 |
| the WITHDRAWN gate-run-2 figure | 0.765 | 0.867 |
| **v1.1, three passes** | **0.650 / 0.737 / 0.684** | **0.867 / 0.933 / 0.867** |

⛔ **The withdrawn 0.765 lies ABOVE the entire three-pass range; the 0.700 baseline lies inside
it.** So the apparent improvement was the `_tokens` shadowing confound, exactly as session 2
suspected, and refusing to cite it was right. Recall moves between the same two values the
baseline and the withdrawn figure took, so it says nothing either. **Q3 closes as: no measurable
schema-lever effect on PRINCIPLE, at a run-to-run spread of ±0.04 precision.**

### ✅ ITEM 2 IS MEASURED — the identity bounds (R39)

| identity | MS ids | MS mean | MS pub | PR ids | PR mean | PR pub |
|---|---:|---:|---:|---:|---:|---:|
| **KEY** (ruled, LOWER bound) | 236 | 0.453 | **21** | 182 | 0.513 | **31** |
| MERGED-MS J=0.4 | 150 | 0.713 | 70 | — | — | — |
| MERGED-MS J=0.5 (R30's threshold) | 163 | 0.656 | **61** | — | — | — |
| MERGED-MS J=0.6 | 191 | 0.560 | 44 | — | — | — |
| **LENS-PRINCIPLE** (UPPER bound) | — | — | — | 122 | **0.765** | **67** |
| STRUCTURED-MS | *skipped* | | | | | |

> **KEY publishes 52 of 418 floored identities (12.4%). At the upper bounds, 128 of 418 (30.6%).**
> **So ~18 points of session 9's 88% blocked are a MATCHING ARTIFACT, and ~70% is real instability
> even under the most generous identity that can be defended.**

⭐ LENS-PRINCIPLE's mean stability lands at **0.7650** — within 0.002 of session 3's independently
measured paraphrase figure of 0.767, on different data with the same lens.

⛔ STRUCTURED-MS is skipped on its own evidence: the persisted `market_signal` payload carries only
`name` (100%) and `direction` (88.8%) — no instrument, no timeframe — and the row-level ticker is
**48.3%**, under the ruled 80% floor. Forced through anyway as a diagnostic it collapses **122
distinct names**, which is the over-merge the bound exists to expose.

### ✅ THE CHAIN RAN ON REAL ROWS — the session-9 zero is closed

Pass 1 ingested through the production writer (`writer.write_output`, writer.py:675 — the same
function `batch.handle_result` calls at batch.py:519). **826 of 827 record_ids identical to the
persisted run (99.9%)**; the one difference is the record the overlap-dedupe key catches.

    store       63 sources · 83 segments · 826 records · 91 principles · 4,295 provenance rows
    rq_v11_001           skipped: no gate run recorded in THIS store (the evals live in gate.db)
    reconcile_stability  records_updated 826 · principles_updated 51      <- was 0 in session 9
    publication_floor    blocked 143 · enqueued 143
    review queue         184 -> 327   contradictions 143 · extraction_audit 114 · vocabulary 70
    second run           blocked 143 · enqueued 0   (idempotent)

⭐ **The store's 3/3 counts — MARKET_SIGNAL 21, PRINCIPLE 31 — match the paper figures exactly.**
The BLOCK counts differ (143 vs 366) for a stated reason: the paper counts identities across three
runs, the store holds one pass's records.

⛔ **This is a LOCAL store under `data/wisdom/`, not production.** Nothing member-visible moved; the
queue that now holds 327 items is on this box.

### R36 — the reservation is 90% a CONSTANT, and the tighter rule needs its second half

    current   output leg = MAX_TOKENS 32000 x $25/Mtok x 0.5 = $0.4000, a CONSTANT
              + input ~$0.042  ->  ~$0.4420/request, of which 90% is the ceiling
    proposed  p90 10,641 x 1.5 = 15,962 tokens -> ~$0.2415/request (55%)
    rounds    session 9 would have run 1 / 2 / 2 instead of 2 / 3 / 4

⚠️⚠️ **AND THE PROPOSAL AS BRIEFED IS NOT SAFE ALONE: p90 x 1.5 = 15,962 is BELOW the observed
max of 18,857 (0.85x).** A reservation under the largest real request can let ACTUALS pass the cap,
because the cap is only tested at reserve time. That is precisely why the second half — *the cap is
re-checked against ACTUALS after every batch* — is not optional. Proposed, not applied (R36 =
PROPOSE).

### Budget, restated with the measured rate

Per-segment mean **$0.058671** over 249 segment-passes -> 9,733 segments = **$571.04** for one
pass, **$1,713.13** for three. ⛔ The estimator changes ROUNDS, never ACTUALS.

**N=5 does not fit:** two more passes cost **$9.7393** against **$8.5185** of headroom — short by
**$1.2208**. And at N=5 a 4/5 record PUBLISHES under the same 0.8 floor, so raising N silently
changes the rule from unanimity to 80% agreement (R17 = HOLD_3; this is for the cap question only).


## SESSION 11 — 2026-09-15: identity RULED and APPLIED, R36 live, promotion PREPARED. $0.00

Ledger byte-identical: sha256 `d976dba7…`, **$31.4815 / cap 40.0**. ⚠️ **R37 was ruled `40.0`,
i.e. UNCHANGED** — the prose accompanying the brief suggested $100, the ruling line said 40.0, and
"read literally, never infer a value not written" plus the fail-safe direction settle it. The cap
was not touched. **It is a question, not a decision taken.**

### R43 applied to the WRITE path

MARKET_SIGNAL = **MERGED_J05**, PRINCIPLE = **KEY**. `reconcile.MS_IDENTITY` is the single switch
(mutation: flipping it reds three tests by name). On the local store's 826 real records:

    MARKET_SIGNAL records clearing the floor   21 -> 61
    identities                              1,223 -> 1,150
    floor blocked                             143 -> 103
    PRINCIPLE                                 31, unchanged, as ruled

⚠️ **The floor enqueues but never retracts:** 103 blocked, **153** `below_publication_floor` rows.

### Golden grading — the free check worked, after a real defect

    MERGED-MS   J=0.4 2/2 · J=0.5 1/1 · J=0.6 1/1      precision 1.000 (n <= 2)
    LENS-PRINCIPLE  t=0.6 13/13 · 0.9 7/7               precision 1.000

So the lens clears ≥0.9 at its own default threshold — **the number behind a future `LENS_STRICT`,
which would move PRINCIPLE 31 → 67.** It is NOT applied: R43 rules KEY.

⚰️ The first grading run returned ZERO gradeable PRINCIPLE clusters. Cause:
`identity_study._rows_by_segment` did `tuple(principle_key)` — a **tuple of characters**. Still a
bijection, so sessions 9–10's numbers are unaffected (re-verified exactly), but nothing outside
could join: intersection 0 of 182.

### Promotion prepared — and the branch had never touched master

`origin/master` merged in (**61 commits, none touching wisdom, workflows or schema**), CI parity
run locally (all four wisdom-rails steps PASS), suite **1,210 passed · 1 skipped · 0 failed**.
PR body at `docs/wisdom/PROMOTION-2026-09-15.md`. ⛔ `gh` is absent, so the command and the
mobile-app route are written down rather than a PR half-opened. **Master untouched:
`79b4b2907` before and after.**

⛔⛔ **THE GATE FACT THAT CHANGES THE FLAG PLAN.** Chain step 1, `capture`, consults **no gate of
its own** — `WISDOM_CAPTURE_ENABLED` gates the standalone capture jobs (`capture/jobs.py:46`), not
the chain step. So `WISDOM_INGEST_ENABLED` alone starts capture. The proposed "flip three
together" is one switch plus two that govern other paths.

⭐ **Migrations proved safe by running the real runner twice** against a throwaway SQLite: pass 1
applied 24 including `core_007..010`, pass 2 applied **0**. They land on the first web boot after
merge (`api/main.py:3244-3245`, unconditional).

### R45 — the owner can read the store from a phone

`GET /api/admin/wisdom/core/status` now also returns `store_counts`, `floored_stability`,
`extractor_version`. **No new route**, so the pinned 27-route list and the dark-check walk are
untouched.

### R36 applied, with the half that makes it safe

Reservation now = p90 of measured cost-per-request × 1.5, floored at the worst case when
unmeasured; and `SpendCap.settle` re-checks **actuals** against the cap after every batch.
⚠️ Deviation stated: the ledger has no token counts and no `extractor_version`, so the p90 is over
cost-per-request, not tokens. Mutation: removing the post-batch check reds a test.


## SESSION 12 — 2026-09-15: the clock rail retired, the queue self-corrects, PR-ready. $0.00

**Ledger: `cap_usd` 40.0 → 100.0 (R37). Totals identical** — $31.4815, 28 entries, +1 byte.

### ⚰️ R46 — I wrote a waiting period for a rule that does not exist

Session 11 read `pre_push_guard.py`'s "owner ruling A2" clock and put *"merge after 16:05 ET or at
a weekend"* into a promotion document. **CLAUDE.md:4805 already said the opposite** — the
market-hours freeze and both its guards were removed 2026-08-24. A rescinded rule reinstated, which
CLAUDE.md warns about twice. ~190 lines and **19 tests** removed; the QUEUE and CADENCE guards kept
(physics, not a clock). `test_the_guard_has_no_time_of_day_branch` fails by name if it returns.
⛔ And a merge on github.com runs no local hook at all.

### R47 — the floor retracts

153 open rows for 103 blocked records → open rows now track blocked records **exactly**. RESOLVED,
never deleted; an item a person decided is untouched; three traps railed and mutation-proved.

### R43 revised — PRINCIPLE under the lens at 0.6

Publishable **31 → 66**; with MARKET_SIGNAL's 61 the floor blocks **68** where it blocked 143 under
KEY. Provisional: 42 ungradeable pairs are the confirmation, and `PRINCIPLE_IDENTITY = "KEY"`
reverts in one line.

### R8 — the INGEST-only plan, REHEARSED not traced

Child process, temp store, census pins; session env UNSET before and after. **Dark:** one heartbeat
row. **INGEST alone:** extract SKIPPED, retrieval SKIPPED (no index even built), `wisdom_records`
**0**, capture 15 rows — and **36 review rows on the `attribution` tab**, which are not floor
blocks and would otherwise read as a publication problem.

### ⚠️ R48 NOT DONE

Ledger token fields are ruled YES and were not delivered; the effort went to the three items the
branch needs before a merge. Carried as a question. It changes no bill.


## W2 BACKLOG — the three weekly steps deleted by R57 (2026-09-15)

⚰️ These were declared in `chain.WEEKLY` and **had never run once.** Each named a function that
is not implemented anywhere in the repo, so `chain.resolve()` returned `fn=None` and the step
recorded `not_available` — a SKIP, not a failure. The weekly chain reported green while three of
its seven steps did nothing, for the programme's whole life.

⛔ They are DELETED rather than left declared (owner ruling R57: DELETE_ALL). A step that cannot
run is not a plan; it is a green tick standing in for one. The intent is recorded here so it can
be scheduled instead of skipped, and `tests/test_wisdom_chain_targets_resolve.py` now fails by
name if any new chain target fails to resolve.

| W2 item | was | intent, and where the intent is recorded |
|---|---|---|
| **W2-A — weekly outcome reconciliation** | `evals.reconcile_weekly` | Not documented beyond the
step's own name. The daily `evals` chain already runs outcomes/replay/metrics
(`evals/pipeline.py`), so a weekly pass would be a re-reconciliation over a longer window. ⚠️ The
intent is genuinely UNRECOVERABLE from the repo — no spec, no docstring, no contract row. Scope it
from scratch or drop it deliberately; do not infer one from the name. |
| **W2-B — vocabulary candidate refresh** | `core.vocab.refresh_candidates` | `vocab.record_candidate`
already writes candidates to the review queue as records are extracted, and
`WISDOM_VOCAB_AUTOPROMOTE_ENABLED` (`flags.py`) is a declared, unset gate for promoting them. The
missing weekly step is the PROMOTION pass that gate was written for. |
| **W2-C — owner voice-profile refresh** | `adapters.refresh_voice_profile` | **D19**
(PROGRAM-MANIFEST): *"Refresh the Morning Wire owner-voice profile weekly from the full corpus."*
The adapter half exists — `publish/adapters/voice.py` writes `wisdom_drafts` (kind
`desk_title_style`) and `tools/wisdom/publish_voice_corpus.py` exports the corpus PC-side. What is
missing is the weekly entry point that ties them together. ⛔ D19 is drafts-only, owner-approved,
never auto-published, never Substack — any build must keep that. |

⭐ **The fourth weekly step was a MISSPELLING, not a gap**, and was fixed rather than deleted:
`extract.run_weekly_audit` → `extract.run_audit`, the implementation `RUNBOOK.md` and
`CONTRACTS.md` both specify. The difference between the two cases is exactly what the rail now
enforces.

---

## 2026-09-17 (Thu) 18:47 ET — the first INGEST night with SOURCES lit

**State at arming (13:37Z):** `WISDOM_INGEST_ENABLED=1`, `WISDOM_SOURCES_INGEST_ENABLED=1`,
everything else False including all three member doors. Production serves `3648792d5`, so R64
(force never spends), R65 (night rationing) and R66 (honest outcomes) are live. The golden gate
is OPEN: `wisdom_eval_runs = 1`, `gate_status.accepted = True` for `wx-v0-fc47bc97` /
`claude-opus-5` / `high`. **EXTRACT is DARK, so tonight cannot spend.**

### What to expect

| step | expected |
|---|---|
| `capture` | `ok` — it is not gated by `WISDOM_CAPTURE_ENABLED` (the chain step is `gate=None`); ~175 s writing dataset objects to R2 |
| `sources` | **`ok` AND ACTUALLY TRUE FOR THE FIRST TIME** — transcripts ingest runs; `discord` sub-stream still skipped, so under R66 this should read **partial:** naming discord |
| `extract` | `skipped — WISDOM_EXTRACT_ENABLED is off` |
| `evals` | **`skipped`** now, naming all four sub-steps (R66; it used to read `ok`) |
| `reconcile_stability` | `skipped — only 0 persisted run(s); need 3` |
| everything else | unchanged from 09-16 |

**Counts:** `wisdom_sources` and `wisdom_segments` go from **0** to whatever `transcripts.ingest_new`
yields (it walks `edu_videos` newest-first, limit 500). `wisdom_records` stays **0** — records come
from extraction, which is dark. `wisdom_extract_requests` stays **0**.

### How to check (the log window is ~12 minutes; use the durable table)

⛔ `railway logs` returns roughly a 500-line / 12-minute window and the pod redeploys often, so it
**cannot** reach a run from the night before. Read the artifact instead:

```
GET /api/admin/wisdom/core/status                      # store_counts, flags, job heartbeats
GET /api/admin/wisdom/core/runs?job_id=wisdom_daily_chain&limit=3   # the run row + every step
```

(admin session in the box's browser; both 401 unauthenticated.)

### Verdict rule

**HEALTHY** = the run row exists for due_key 2026-09-17 with `status: ok`, `sources` did work,
`wisdom_segments > 0`, and nothing paged.
**DEGRADED** = it ran but sources wrote nothing, or a step failed.
**DID NOT RUN** = no run row (check the heartbeat: a skipped slot writes a beat and NO run row).

### The one-line stop

`railway variables --service web --unset WISDOM_SOURCES_INGEST_ENABLED` — ingest stops; anything
already written persists. ⚠️ That same flag also arms **Sunday's** `run_weekly_sunday_scans`
(`sources/__init__.py:72`), so unsetting it closes both.

### Friday 2026-09-18 18:47 ET — NOT YET ARMED

EXTRACT is armed only if tonight is HEALTHY. At `WISDOM_DAILY_SEGMENT_LIMIT=1200` and N=3 that is
**400 segments / 1,200 requests**, ~**$70.41** at the measured mean and ~**$73.67** at p90, inside a
$75 night line and an $1,800 programme total (~24 nights). ⛔ Those three variables are **not set**;
setting them is Step G2 and it happens only after tonight's verdict.
