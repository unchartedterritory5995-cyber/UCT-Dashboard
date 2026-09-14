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
