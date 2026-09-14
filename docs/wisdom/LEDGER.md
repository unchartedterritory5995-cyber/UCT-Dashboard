---
id: WISDOM-LOOP-LEDGER
title: UCT Wisdom Loop — Implementation Ledger
role: the single authority for what this program has committed, merged and shipped
status: current
generated: 2026-09-13
---

# UCT Wisdom Loop — Implementation Ledger

This file is the program's manifest of commits. **Every commit returned by the ledger query
must have a row here.** A commit on a program-created path with no row is a FAIL.

It follows the Terminal-Next convention
(`origin/terminal-research:docs/terminal-research/00-program-control/LEDGER.md`): rows are
filled from the query, never from memory. Never use a path-filtered or subject-filtered log
alone; that undercounted the Terminal-Next program twice.

⛔ **THE LEDGER QUERY**

```bash
# Section 1 — the program's own branch, before merge
git log --format='%h %ci %s' --shortstat origin/master..feat/wisdom-loop

# Section 1 — after a merge M (substitute its SHA)
git log --format='%h %ci %s' M^1..M^2

# Section 3 — anyone else building on a path this program created
git diff --diff-filter=A --name-only <first-program-commit>^..feat/wisdom-loop   # the created paths
git log --format='%h %ci %s' <merge-sha>..origin/master -- <those paths>
```

**The one exemption:** a commit that touches ONLY this file is exempt, because the commit that
records a SHA cannot also contain its own SHA. Every other commit, docs-only included, needs a row.

**Required on any row that merges to master:** the classification from
`python tools/flow_worker_watch_coverage.py` (`docs/runbooks/deploy-windows.md` makes a red a
review gate: ADDITIVE or BEHAVIOUR-CHANGING). A red with no classification here is the one
unacceptable state. Also required: the Railway `web` deploy SUCCESS observed before the next
master push (one master merge at a time, repo-wide).

---

## Section 1 — the program's own build: `feat/wisdom-loop`

Branch cut from `origin/master` at `f4fc5d1c1`. **Rebased 2026-09-13 12:20 CDT onto `origin/master` `f34ce660b`**
(29 + 8 commits behind; rebase rule CLAUDE.md), so the Session 0 SHAs were rewritten; the old SHAs are kept in the
subject column. Not merged.

| # | commit | when (CDT) | wave | files | subject |
|---|---|---|---|---|---|
| 1 | `1b72193b8` | 2026-09-13 12:20 (orig. `37e84831e` 09:29) | **S0** | 5 | docs(wisdom): Session 0 discovery — manifest, schema v0, vocabulary v0, golden verifier |
| 2 | `d04f86650` | 2026-09-13 12:20 (orig. `b5e51c37b` 09:54) | **S0** | 2 | docs(wisdom): owner rulings D1-D10 (all YES), D6 merge map, D11-D20, expanded scope |
| 3 | `7c3f282ba` | 2026-09-13 12:20 | **W1** | 4 | docs(wisdom): W1 contracts (db v0 DDL, extraction schema), discord sources, authors |
| 4 | `4b0eba32b` | 2026-09-13 12:20 | **W1** | 1 | docs(wisdom): W1 build contracts — 29 resolved contradictions, layout, registry/store API, flags, schedule |
| 5 | `ca0b9b801` | 2026-09-13 12:20 | **W1** | 38 | feat(wisdom): W1 skeleton — registry, wisdom.db store, gates, jobs runner, R2, authors, owner gate, core routes |
| 6 | `1363d588b` | 2026-09-13 12:26 | **W1** | 2 | docs(wisdom): #manrav granted + verified; volume-alerts, uncharted-scanners, test-chartmaster-alerts bot-authored, out of scope |
| 7 | `3155b3c6d` | 2026-09-13 ~12:45 | **W1** | 3 | docs(wisdom): manifest brought in line with the W1 GO; ledger rows after rebase; session state |
| 8 | `2e1f9f4bb` | 2026-09-13 ~14:40 | **W1 S-D golden** | 4 | feat(wisdom): golden v1 — verifier v1, discord sampler, quote-free provenance, methodology (cherry-picked from `wisdom/w1-d-golden` `21801941a`) |
| 9 | `7f788aa7f` | 2026-09-13 ~14:50 | **W1** | 5 | docs(wisdom): golden v1 follow-ups — ambiguous host label, chartmaster workshop alias, exit_price/exit_text, split wording; ledger rows 7-8 |
| 10 | `3f46c768d` | 2026-09-13 ~15:10 | **W1** | 6 | docs(wisdom): checkpoint-1 owner rulings (CONTRACTS §8a) and the Zoom correction (no trash recovery; store-and-verify before delete; desk-check-first) |

**Row 8 evidence.** The integrator re-ran the verifier on the integration branch:
- `--self-check` → `SELF-CHECK PASS`.
- v0 defaults → `records=30 … PASS`.
- v1 with `--require-strata` → `STRATA PASS`, 125 records.

Totals: 117 confirmed, 8 provisional. Types: CALL 40, NEGATIVE_CALL 17, MENTION 22, PRINCIPLE 27, LEVEL 11, MARKET_SIGNAL 8. Authors: tsdr 76, bracco 25, manrav 11, chartmaster 10, ravi 1, guests 2. Split: dev 67, test 58.

Stratification as committed in `2e1f9f4bb` (record type × author; the owner asked for this table here). The counts are
from the S-D golden report and the verifier's `--require-strata` matrix:

| type | tsdr | bracco | chartmaster | manrav | ravi | guests | total | minimum |
|---|---|---|---|---|---|---|---|---|
| CALL | 22 | 10 | 3 | 5 | – | – | 40 | 30 |
| NEGATIVE_CALL | 14 | 3 | – | – | – | – | 17 | 12 |
| MENTION | 8 | 5 | 3 | 5 | 1 | – | 22 | 20 |
| PRINCIPLE | 17 | 3 | 4 | 1 | – | 2 | 27 | 20 |
| LEVEL | 9 | 2 | – | – | – | – | 11 | 8 |
| MARKET_SIGNAL | 6 | 2 | – | – | – | – | 8 | 5 |
| **total** | 76 | 25 | 10 | 11 | 1 | 2 | **125** | 100 |

Other counts:
- **Verification:** text-only 64, text+bars 53, text+bars+positions 8.
- **Streams:** sunday_scans 51, zoom_live 43, discord 27, workshop 4.
- **Distinct sources:** 28 live sessions, 15 Sunday Scans issues.

⚠️ **This is NOT yet the frozen `golden-v1`.** Per the owner's checkpoint-1 ruling, v1 is frozen only after the §8a
propagation lands and a re-run of all three verifier passes plus the leaked-quote check passes. Author re-tags from the
"Uncharted Territory" re-resolution may move these counts. The frozen table and the sha256 of
`data/wisdom/golden/golden-v1.jsonl` get their own row.

The quote-leak scan of the committed files found 0 quote fragments; the only provenance keys are `quote_sha256` and `text_sha256`. The labels and the 13-item review queue are gitignored under `data/wisdom/golden/`. The Discord samples (400 messages per channel, all four channels returned 200) are gitignored under `data/wisdom/samples/discord/`.

Ledger-only commits (exempt): `a89b4f5aa`, `f786ac72a`.

**Row 5 evidence.**
- `tests/test_wisdom_skeleton.py`: 19 passed.
- Rails run by name after the rebase (`test_wisdom_skeleton`, `test_feature_flag_ledger`, `test_no_shadowed_definitions`,
  `test_lifespan_scheduler_binds_before_use`, `test_cross_module_imports_resolve`): 209 passed, 1 failed.
- The one failure is `test_cross_module_imports_resolve` on `api/services/discord_render/commands.py:34`
  (`INTERACTIVE`). It was introduced on master by the Discord render program and is not a Wisdom import.
- Before the rebase, `test_feature_flag_ledger` was also red on four `ALERT_TAXONOMY_*_DARK_ENABLED` gates (S7).
  Master `f34ce660b` fixes it.
- `python tools/flow_worker_watch_coverage.py` at base `f34ce660b`: `reachable=154 watched=24 changed=47 OK`.
  No Wisdom module is in flow-worker's import closure.

### Incident — this program wrote to the PRODUCTION bucket, and how it is closed (2026-09-13)

**What happened.** An S-C (sources) test run, before its hermetic fixture existed, wrote **16 objects,
2,399 bytes** into the production R2 bucket under `wisdom/sources/zoom_vtt/`. All 16 were written
2026-09-13 ~18:00 UTC; every `.vtt` carried the same content hash (`134614f9aa8c`), i.e. one fixture
transcript repeated across eight synthetic meeting ids.

⛔ **Nothing failed.** `DATA_SYNC_*` were already present in the operator's shell, so the real client
built itself and every `put_object` SUCCEEDED. This is the class the repo-root `conftest.py` tripwire
exists for, in a namespace that tripwire does not cover: **a test that reaches production data does
not go red — it passes, against live files.**

**The 16 keys removed** (owner instruction, P1; recovered from the pre-deletion inventory
`audit_r2_inventory.json`, taken 14:09 CDT before the deletion):

```
wisdom/sources/zoom_vtt/259b77c380fdc13aff5ce4fb/d9dfa78ba7ea375fd6de35f2.vtt
wisdom/sources/zoom_vtt/259b77c380fdc13aff5ce4fb/recording-c2428ec2e5bf62f9.json
wisdom/sources/zoom_vtt/3d22b8ed5e449d975b7ef3b7/d9dfa78ba7ea375fd6de35f2.vtt
wisdom/sources/zoom_vtt/3d22b8ed5e449d975b7ef3b7/recording-c2428ec2e5bf62f9.json
wisdom/sources/zoom_vtt/3d22b8ed5e449d975b7ef3b7/recording-ef48220d12b00265.json
wisdom/sources/zoom_vtt/690a90d364ceab6bfc02d7cd/recording-3b37ae33a0194c02.json
wisdom/sources/zoom_vtt/bbd888be9c0eb1229c281130/d9dfa78ba7ea375fd6de35f2.vtt
wisdom/sources/zoom_vtt/bbd888be9c0eb1229c281130/recording-6d76576e5c6bba4f.json
wisdom/sources/zoom_vtt/beefc3762535ae72b0857a9a/d9dfa78ba7ea375fd6de35f2.vtt
wisdom/sources/zoom_vtt/beefc3762535ae72b0857a9a/recording-c2428ec2e5bf62f9.json
wisdom/sources/zoom_vtt/db6ee1f4b0ba70043e771b75/d9dfa78ba7ea375fd6de35f2.vtt
wisdom/sources/zoom_vtt/db6ee1f4b0ba70043e771b75/recording-c2428ec2e5bf62f9.json
wisdom/sources/zoom_vtt/f76fee84e0c524d56820bec2/d9dfa78ba7ea375fd6de35f2.vtt
wisdom/sources/zoom_vtt/f76fee84e0c524d56820bec2/recording-c2428ec2e5bf62f9.json
wisdom/sources/zoom_vtt/fa9c889b5946d02b0b22379a/d9dfa78ba7ea375fd6de35f2.vtt
wisdom/sources/zoom_vtt/fa9c889b5946d02b0b22379a/recording-c2428ec2e5bf62f9.json
```

**How they were removed.** A one-off guarded script (scratchpad, never committed — this module has no
delete path by design, and that stays true). Dry run first:
`candidates=16 bytes=2399 not-fixture-shaped(kept)=0`; then applied. **Re-verified after the fact**
with the read-only lister: `TOTAL objects=0 bytes=0` under `wisdom/`. Nothing else in the bucket was
touched — every key deleted is listed above.

**The durable fix (S-B, `f1e0e9d91`).** `api/services/wisdom/core/r2.py` refuses to build a real
client under pytest. It sits INSIDE `_client_and_bucket()`, which is the function every hermetic
wisdom suite already monkeypatches — so it is unreachable for a test that has isolated itself and
fires only for one that has not. `put_immutable`, `get` and `list_prefix` all funnel through it.

- ⛔ **Not an env var, and not "delete `DATA_SYNC_*` in a fixture."** A kill switch nobody sets is
  indistinguishable from a working one, and the leaking run was in a shell that already had them.
  The opt-in is a module attribute a test must monkeypatch deliberately, leaving one reviewable line.
- ⛔ **The predicate is deliberately NOT `"pytest" in sys.modules`.** pytest is a *production*
  dependency here (`requirements.txt`) and `api/` carries `*_test.py` modules, so that check could
  arm the guard on the web pod and break real archiving. It reads `PYTEST_CURRENT_TEST`, plus the
  last two path components of `argv[0]` for collection time — `bin/pytest` and `pytest/__main__.py`
  match, `bin/uvicorn` and `bin/python` do not. **The rail caught the first attempt**, which used
  the basename alone and so missed `python -m pytest` entirely.
- **Mutation-proved four ways**, `r2.py` restored from original bytes each time and sha256-verified
  identical (`0576394ded84495b` before and after all four), final run green:
  opt-in pinned True → 5 failed/5 passed · guard clause deleted → 4 failed/6 passed ·
  `_under_pytest` pinned True → 1 failed/9 passed · pinned False → 6 failed/4 passed.
- **S-C re-run against the isolated target:** the guard was applied into the S-C worktree as an
  uncommitted change and its whole suite run with the guard ARMED —
  `tests/test_wisdom_sources_{transcripts,sunday_scans,discord,routes}.py` + `test_wisdom_skeleton.py`
  → **71 passed**. With the guard armed, any test still reaching a real client would have gone red,
  so that green is the isolation measurement, not just an absence of complaints. The worktree was
  then restored from HEAD and verified byte-identical.

⚠️ **Scope, stated rather than implied:** this is a *pytest* rail. A bare `python tools/...` run
still reaches the live bucket, exactly as the conftest tripwire is a test-suite rail only.

### Visibility escalation — `DESK_PUBLIC_SHOWS=*`: escalated, reverted, then REAFFIRMED by the owner

⭐⭐ **RESOLVED 2026-09-13: THE WILDCARD IS THE OWNER'S DELIBERATE DECISION AND IT STANDS.**
Owner ruling, verbatim: *"that was me. All auto-recorded sessions post public was and is my
deliberate visibility decision."* The 2026-09-13 revert was **reversed the same day**: all 28
videos restored to public, `DESK_PUBLIC_SHOWS` set back to `*`, and the decision written into
`docs/feature_flags.json` under `owner_decision`.

⛔ **THE ESCALATION WAS STILL CORRECT, AND THE RECORD BELOW IS KEPT IN FULL.** A doc asserted a
rule (*"Live Trading Sessions… stay unlisted"*), production did the opposite, and **nothing
anywhere said which was intended**. Escalating that is the right behaviour; a session that sees
paid content public and files it as a footnote is the failure mode (H14). What was actually
missing was never a guard — it was a RECORD. That is the whole lesson and the whole fix.

⭐ **The correction the owner made to the rail is the load-bearing one:** the first version
REFUSED a wildcard outright. That would have made a legitimate business decision inexpressible,
and a rail that forbids what the owner wants gets satisfied on Railway and never written down —
which is precisely the state that produced 25 days of ambiguity. **The rail's job is to record
intent, not to veto it.** A wildcard now costs one dated, attributable sentence.

**Not this program's system. Found, escalated, reverted, restored and railed by this program's
agent; the reusable part is how close it came to being a footnote.**

**How it surfaced.** The P3 Track-A transcription agent ended an unrelated report with:
*"Observed in passing, unverified as intentional: `DESK_PUBLIC_SHOWS=*` on `web`, so every show —
including paywalled workshops — uploads public."* ⭐ That is the H14 tell verbatim — a hazard class
demoted to a footnote. Running the H14 chain instead of filing it is the whole of this entry.

**Confirmed, in three independent places before anything was changed:**

| layer | evidence |
|---|---|
| source | `desk_daily_session.privacy_for_section:117` — `if "*" in shows: return "public"` |
| live config | `railway variables --service web --kv` → `DESK_PUBLIC_SHOWS=*`, with `DESK_DAILY_SESSION_ENABLED=1` |
| artifact | anonymous fetch of `rKVAkk3811Q` (a PAID Stockbee workshop) → `"isUnlisted":false` |

⭐ **The artifact check carried its own control.** Two older Mental Game videos read
`"isUnlisted":true` in the same sweep, and Sunday Scans read `false` — so the probe demonstrably
discriminates, and "public" was a measurement rather than an inference.

**The revert (owner's flag flip, executed 2026-09-13).**
⛔ **The owner's instruction said `DESK_PUBLIC_SHOWS=sundayscans` — no space — and that value makes
NOTHING public, including Sunday Scans.** `privacy_for_section` does a plain substring test, so
`"sundayscans" in "sunday scans"` is False. Run against the real classifier over all six routable
sections before touching production: `*` → 6 public · `sundayscans` → 0 public · `sunday scans` →
exactly `Sunday Scans`. The RULING ("Public = Sunday Scans only") was executed, the typo was not,
and it was reported the same minute. The space is load-bearing and is now pinned by a rail.

| | before | after |
|---|---|---|
| `DESK_PUBLIC_SHOWS` on `web` | `*` | `sunday scans` |
| sections resolving to public, **read in-process on the pod** | all 6 | `Sunday Scans` only |

Verified by `railway ssh` running `privacy_for_section` in the live process — not from `--kv`,
which shows what the service is configured with and is not evidence the running process has it.

**Blast radius — 320 videos, every privacy status read from YouTube's own API with the publisher's
token, then split by CAUSE rather than by the literal predicate:**

| set | n | disposition |
|---|---|---|
| desk-published (`meeting_uuid`), public, non-Sunday-Scans | **28** | set unlisted, then **RESTORED to public** on the owner's reaffirmation — each verified, one field changed |
| legacy back-catalog, public, non-Sunday-Scans | 66 | **UNTOUCHED throughout**, and the owner ruled they stay as they are. Table kept for reference only. |

⛔ **The literal instruction was "any non-Sunday-Scans video with `isUnlisted:false`", which is all
94.** Applying it as written would have unlisted 23 Interviews, 9 Scanning and 8 Setups videos that
have been deliberately public for months and have nothing to do with this flag — a second,
unrelated member-visible change made under cover of a fix. The 66 are reported for the owner's
call instead. ⭐ Two of them are Live Trading Sessions and ten are Post-Market Recaps; those may be
a separate, older exposure and are flagged as such rather than silently swept in.

**Earliest affected upload 2026-07-28** — which does NOT match the commit date, and the discrepancy
is kept rather than smoothed: `0894d7ac0` (the wildcard) is 2026-08-19, and Live Trading Sessions do
go public from 2026-08-19 onward. Five earlier uploads (an Evening Update on 07-28, a Live Trading
Session on 08-04, Evening Updates on 08-04/08-12/08-18) predate both the wildcard AND the per-show
privacy feature itself (`634326923`, 2026-08-09), so they cannot have been caused by either. Their
cause is **unattributed**; Railway exposes no variable history from the CLI.

**How it got set.** `0894d7ac0`, 2026-08-19 07:51 CDT, authored by a **Claude Fable 5** session:

> `feat(desk): DESK_PUBLIC_SHOWS="*" uploads every show to YouTube as public`
> *"Owner decision 2026-08-19: all auto-recorded sessions post public."*

✅ **The commit was RIGHT.** The owner confirmed on 2026-09-13 that the decision was his, made on
2026-08-19 and unchanged since. ⚰️ The session's own first reading — recorded here as it was
written — treated the commit message as a contradiction to be reported rather than resolved, which
was the correct call with the information available and the wrong conclusion. **What was never in
dispute is the only thing that actually failed: the decision was never written into
`docs/feature_flags.json`**, so for 25 days nothing in the repo could tell a deliberate setting
from a leak — and the flag was one the ledger's rail could not even see.

**Three could not be changed**, listed with the exact reason rather than counted as done:
`hmGZSV_axHo` and `znjo804B_0k` (Evening Update, Sep 10) and `vslaRnO9G3E` (Sunday Scans Aug 16 Pt 1)
return **no item** from `videos.list` even to the owning token — the videos are gone from YouTube;
their `edu_videos` rows point at nothing. One video, `ngF6_2A3L2w`, read back `public` immediately
after its update and `unlisted` three seconds later: propagation lag, re-verified, not a failure.

**Final state, re-read from YouTube after every change:** desk non-Sunday-Scans = 73 unlisted,
1 private (pre-existing, untouched), 2 gone, **0 public**. Sunday Scans = 3 public, as intended.

**The class, and why no rail could see it.** `tests/test_feature_flag_ledger.py` narrows the census
with `is_gate()` — true only for names carrying `ENABLED`/`DISABLE`/`_ON`. `DESK_PUBLIC_SHOWS`
carries none, so it was **absent from the gate census entirely**; and it defaults to a non-empty
string, so even a name-agnostic version would have read it as a live decision. Two independent
blindnesses, either sufficient alone.

⭐ **A gate decides whether a feature RUNS; a visibility flag decides who can SEE what it produced.**
The first fails loudly and reversibly; the second fails silently and **cannot be un-published**.
They are now separate axes:

- `feature_flag_index.is_visibility_flag()` / `visibility_flags()` — narrowed from `scan()`, never
  from `gates()`, because `gates()` is the thing that was blind. Markers are decision words;
  exclusions are the three kinds of name that carry them and decide nothing (destination,
  credential, location). Measured: 4 flags, excluding exactly `DESK_ANNOUNCE_DB_PATH`,
  `DISCORD_CHART_PUBLIC_KEY`, `UCT_PUBLIC_BASE`.
- `tests/test_visibility_flag_ledger.py` — declared with `exposure`/`default`/`values`; **wildcard
  refused**; declared values must name sections `_RULES`/`_HOST_AWARE` can actually produce; the
  declared default must equal the code default; and the default must resolve to Sunday Scans alone
  through the REAL classifier. Two vacuity controls, because every assertion is over a derived set.
- `tools/flag_ledger_audit.py --visibility` — the live half, which is the only half that could have
  caught this: **the wildcard was never in the repo.** Value reads are scoped to ledger-declared
  `exposure: public` flags so the "names only, values are secrets" rule still holds.
- ⚠️ `test_the_ledger_does_not_describe_gates_that_no_longer_exist` immediately demanded the
  deletion of the two new entries — its own docstring already names this failure
  (*"the rail was reporting its own blindness and blaming the ledger"*), now recurring one axis
  over. Its subtrahend is the union of both axes.

**Mutation-proved, 7 guards, all four files restored byte-exact:** PUBLIC marker removed (2 red) ·
exclusions widened to swallow everything (2) · predicate narrowed to nothing (2) · narrowed from
`gates()` instead of `scan()` (1) · the wildcard back in the ledger (4) · **the code default losing
its space — the owner's typo, reproduced as a mutant (2)** · the live audit no longer flagging
wildcards (1). Control: 15 passed.

**Restore, 2026-09-13 (owner ruling).** All **28** desk-published videos set unlisted earlier that
day were restored to `public` — each re-read from YouTube after the change, **exactly one field
altered** (`privacyStatus`), 0 failures. ⛔ Driven from an **EXPLICIT id list**, not a re-derivation:
"every desk non-Sunday-Scans video → public" would also have flipped the **46** that were already
unlisted BEFORE the revert (pre-2026-08-19 sessions). The owner asked for a reversal of what this
session changed, not a bulk re-publish, and an explicit list is the only way to guarantee that.

**End state, verified in-process on the pod** (never from `--kv`): `DESK_PUBLIC_SHOWS = '*'`, all six
routed sections resolve to **PUBLIC**, the 28 read `public` from YouTube, Sunday Scans untouched
(3 public / 1 unlisted / 1 gone, unchanged), 66 legacy back-catalog left exactly as they were.
`tools/flag_ledger_audit.py --visibility` → **0 findings** with the wildcard live, because it is
now attributable.

**Three `edu_videos` rows point at videos YouTube no longer returns — BROKEN DESK LINKS, reported
only** (owner: report, do not act):

| youtube_id | row | note |
|---|---|---|
| `vslaRnO9G3E` | Sunday Scans — Aug 16, 2026 (Part 1) | Part 2 (`5ARYCslLzwg`) is fine — a split upload lost half |
| `hmGZSV_axHo` | Evening Update — September 10, 2026 | two rows for one evening, both gone |
| `znjo804B_0k` | EVENING UPDATE — September 10, 2026 | duplicate of the above, different id |

`videos.list` returns **no item** for all three even to the OWNING token, so they are deleted at
YouTube rather than merely restricted. ⚠️ The Desk player will render three entries whose video
cannot load. Whether the deletions were intentional is not knowable from this seat; the Sep-10 pair
looks like one session uploaded twice and then cleaned up, which would make the surviving defect
just the stale rows.

⛔ **WISDOM-SIDE, UNCHANGED BY ANY OF THIS** (owner note, 2026-09-13): YouTube visibility does **not**
change Wisdom's entitlement rule. Transcripts and Sunday Scans bodies served through Wisdom
consumers remain **entitlement-checked per §0.4g** until the owner rules otherwise. A public video
is not a licence to serve its transcript to a non-member.

⚠️ **RESIDUAL, stated rather than hidden:** the predicate is a NAME test. A future flag that decides
public exposure without one of the marker words in its name is not caught. That is a smaller hole
than the one it closes; it is named in the source and here so the next reader inherits it.

### Open, carried deliberately — the provenance-marker gap (owner ruling, checkpoint 3 §8c.3)

**The audit that says "nothing reached the member-facing tables" is shape-based.** It searches for
`wisdom:` provenance and the `G-0NN` record-id glob. A row published with **no marker at all** would
not be caught by that shape. The owner accepted the empty `wisdom_publish_log` as *today's*
argument — no adapter has run in any mode, not even a dark `would_publish` preview — and ruled the
gap closed **structurally** rather than by argument:

> Every Wisdom publish adapter (Part 5) writes a provenance marker on every write, and **a CI check
> fails if any adapter code path can write to a consumer table without the marker.** Then the
> shape-based audit becomes a real audit.

**Ships with S-F2 publish.** Until then this note is the record that the audit's negative result
rests on an argument rather than an enforced invariant. Also still unmeasured and NOT closed by that
fix: four large non-target DBs (`bars.db` 25 GB, `darkpool.db`, `flow.db`, `auth.db`) and the four
non-`web` Railway services — every publish target lives on `web`, so that is a coverage gap rather
than a known hole.

### Drift #4 — the first-name attribution path, answered in full (owner ruling, checkpoint 2)

The owner called this "the most dangerous finding in the program so far" and asked for four
confirmations. All four are closed. Merged to master as `2e6f3453e` (web SUCCESS 21:33:55Z,
`/api/health` `uptime_seconds: 34` on a fresh boot).

**(a) The path is DELETED, not disabled.** Removing `"Patrick"`, `"Blake"` and `"Manav"` from the
alias lists fixed the INSTANCE and left the door open — re-adding any bare given name would have
silently restored it. `core/authors.author_for_alias` now refuses **any** one-word alphabetic label
that is not declared in `authors.json` `single_token_aliases_reviewed` with a reason. Measured: with
`"Patrick"` put BACK into tsdr's alias list, `author_for_alias("Patrick")` → `None` and
`normalize_speaker` → `team-unresolved`, while `Patrick (TSDR)`, `TSDR`, `Brac`, `braczyy`,
`1ChartMaster`, `Joe Walburn` and `Manrav` all still resolve.

**(b) Blast radius: ZERO records, and the zero is a measurement.** Five independent instruments over
`golden-v1.jsonl` (125), `golden-v0.draft` (30), `review-queue-v1` (13), all 319 transcript files
(56,397 labelled cues / 409,701 lines) and all six `*.db` files — every one negative. The source
label IS stored for all 125 records (`expected.speaker_label` 125/125, `evidence.attribution.method`
125/125), so this is not a gap filled with a guess: 43 records resolved by `speaker_label` (the
defect's path), 32 by signed section, 27 by Discord user id, 19 by the D4 ruling, 2 guest, 1
self-identification, 1 alias-pending.

⭐ **The control that makes the zero worth anything: `Zack` — 142 cues in session 308, a bare given
name used as a Zoom display name by a non-author in this very room.** The collision the ruling is
about is REAL and OBSERVED; it simply never landed on one of the three names that happened to be
aliases. Had "Zack" been an alias, 142 cues would have been misattributed. The defect was live
ammunition that did not fire.

**7 records came through the shared "Uncharted Territory" label** (a different §8a.2 path, not the
first-name one), each now with cited evidence: G-044, G-045, G-051 keep `tsdr` on same-morning
Discord corroboration (G-051 is Δ0.7 min — textbook §8a.2 same-minute evidence); G-057 → `bracco`;
G-034 → `team-unresolved` (its cue is in an uncorroborated stretch of a UT-only session);
**G-035 and G-052 stay provisional per the owner's ruling** — `team-unresolved`, MENTION only, out
of the UCT-see rate and out of every publish path, pending his answer.

**(c) The regression case ships** as a SESSION, not a unit assertion: a live session containing
attendees named "Patrick", "patrick", "  PATRICK  ", "Blake" and "Manav", the shared host label, the
real owner and a real teammate. Exactly one cue may author as `tsdr` — the owner's own Zoom label.
⚠️ Scope is stated in the test rather than implied: the record WRITER is S-D and unmerged, so this
asserts at the layer that decides authorship. The end-to-end assertion over written rows is **owed
at the S-D merge**.

**(d) The tables were read, not inferred from the dark flags.** Read-only (`mode=ro` URI), bounded
queries, nothing heavy on the live pod:

| store | measured | result |
|---|---|---|
| Brain KB `knowledge_base` (`/data/brain/…`) | 9,677 rows, every column swept for `wisdom` / `wisdom:` / `G-0NN` | **0** (the single "wisdom" hit is a pre-existing Sunday-Scans row titled *Billy Joel 'Vienna' Wisdom Applied to Trading*) |
| Brain semantic index `brain_chunks` | 9,982 rows | **0** |
| `ticker_mentions` → `edu_videos.ticker_moments` | 320 videos, 291 with moments | **0** (5 whole-DB hits are chapter titles using the English word) |
| `pattern_exemplars` | table exists | **0 rows at all** |
| `modelbook.db` (9 tables) | every non-blob column | **0** |
| `wisdom_publish_log` | — | **0 rows — not even a dark-mode `would_publish` preview** |
| `/data/wisdom.db` (34 tables) | every table | every content table **0**; only `wisdom_migrations` 6 and `wisdom_job_heartbeats` 2 |
| 7 further member DBs (43 tables) | `wisdom:` / `G-0NN` | **0** |

⭐ **The switch is confirmed from the artifact, not the config:** both wisdom jobs on the pod record
`last_status='skipped'`, `last_error='master switch WISDOM_INGEST_ENABLED is off'`. The skeleton is
live on production and has written nothing anywhere.

⛔ **The gap the pod could not show, now closed.** The pod's brain pack is a ~1.5-day-old snapshot
and the merge map's KB write is **PC-side**, so a row inserted there after 2026-09-12 02:00 would be
invisible to every pod query and would reach members at the next pack export. Checked directly:
`C:\Users\Patrick\uct-intelligence\data\uct_intelligence.db` (87.5 MB) — **0 rows with Wisdom
provenance**, row count and newest timestamp identical to the pod snapshot (so nothing was written
since), and **`scripts/wisdom_kb_sync.py` does not exist**: the PC-side writer was never built, so
there is no mechanism that could have written. Verified on both sides.

**Still unmeasured, stated rather than implied:** four large DBs (`bars.db` 25 GB, `darkpool.db`,
`flow.db`, `auth.db`) were not swept — none is a publish target per the merge map, but they were not
inspected; the other four Railway services were not checked (every publish target lives on `web`);
and content matching was provenance-shaped (`wisdom:` / `G-0NN`), so a row published with no
provenance marker at all would not be caught by shape — though an empty `wisdom_publish_log` argues
no adapter ran in any mode.

### Owner-task evidence (W1 GO Part 2)

| Task | Done | How verified |
|---|---|---|
| §2.1 Discord grants | Bot role `1474903498700230668` given VIEW on #tsdr, #1chartmaster and #manrav, and VIEW+HISTORY on #bracco (@everyone denies history there). Granted in the Discord web UI as the server owner; the bot lacks MANAGE_ROLES. | `GET /channels/{id}/messages?limit=50` with the bot token returned HTTP 200 for all four channels on 2026-09-13. |
| §2.1 author IDs | tsdr `339816805805588480` (46/50; the other 4 are the UCT Intelligence webhook bot) · bracco `427798118935953410` (50/50) · chartmaster `1203080759141736508` (50/50) · manrav `806378356966424596` (50/50) | Authorship of the latest 50 messages in each author's own channel (IDs only). |
| §2.1 other trade-alert channels | #volume-alerts (Scripted Trading app), #uncharted-scanners (Uncharted Scanners app) and #test-chartmaster-alerts (ChartMaster Alerts app) are OUT OF SCOPE, not granted. | Read in the owner's Discord session 2026-09-13; every visible message is app-authored. |
| §2.2 Zoom | **Recovery DROPPED (owner correction 2026-09-13):** Zoom cloud copies are deleted on purpose after posting; the Stockbee workshop is not in trash and is not an owner task. Replaced by the desk-transcript check (Step 0) for 356 and every video under 98 %, re-transcription + diarization where no full copy exists, and store-and-verify before delete (CONTRACTS §8a.6a–6b). | Measured S2S scopes: `cloud_recording:delete:meeting_recording:admin cloud_recording:read:list_recording_files:admin cloud_recording:read:recording:admin`; `GET /meetings/{uuid}/recordings` → 404, consistent with the intentional deletion. R2 `desk_audio/rKVAkk3811Q.m4a` exists (83,057,014 bytes). |

### Golden-v1 FROZEN (P4 propagation + freeze) — 2026-09-14

**Frozen by** `sha256(data/wisdom/golden/golden-v1.jsonl)` =
`db3475c814eed4f878474d9f4d10c0ce6c39d633cc027e7f49483ed7ada4ade2`

The freeze is a runnable command, not a note — the verifier refuses to run against any other bytes:

```sh
python tools/wisdom_golden_verify.py --golden <data-root>/golden/golden-v1.jsonl \
  --provenance docs/wisdom/golden/golden-v1.provenance.json --require-strata \
  --frozen db3475c814eed4f878474d9f4d10c0ce6c39d633cc027e7f49483ed7ada4ade2
```

**All four gates green on the frozen bytes** (re-run AFTER the mutation proofs below, on the restored file):

| gate | command | totals line | exit |
|---|---|---|---|
| 1. self-check | `--self-check` | `SELF-CHECK PASS` | 0 |
| 2. v0 defaults | *(no args)* | `records=30 (v0=30 v1=0)` · `PASS — provenance for 30 records` | 0 |
| 3. v1 strata | `--golden … --require-strata` | `records=125 (v0=0 v1=125)` · `PASS — provenance for 125 records matches` · `STRATA PASS` | 0 |
| 4. leaked-quote | `tools/wisdom/golden_leak_check.py` | `9086 tracked files, 125 quotes, min_windows=2, leaks=0` · `LEAK-CHECK PASS` | 0 |
| rail | `pytest tests/test_wisdom_golden_freeze.py` | `15 passed` | 0 |
| adjacent rails | `pytest tests/test_wisdom_authors_aliases.py tests/test_wisdom_core_speakers.py tests/test_wisdom_vocab_authority.py tests/test_wisdom_guard_mutation.py tests/test_cross_module_imports_resolve.py` | `91 passed, 1 skipped` | 0 |

#### record-type × author — the frozen set (125 records, every one `confirmed`)

Derived from the file, never typed. `(was N)` is the pre-propagation backup
`golden/pre-propagation/golden-v1.jsonl.orig`; a cell with no `(was …)` did not move.

| type | bracco | chartmaster | guest:buckethead | guest:zen | manrav | ravi | team-unresolved | tsdr | **total** |
|---|---|---|---|---|---|---|---|---|---|
| CALL | 10 | 3 | — | — | 5 | — | — | **21** _(was 22)_ | **39** _(was 40)_ |
| NEGATIVE_CALL | 3 | — | — | — | — | — | — | **13** _(was 14)_ | **16** _(was 17)_ |
| MENTION | 5 | 3 | — | — | 5 | 1 | **2** _(was 0)_ | 8 | **24** _(was 22)_ |
| PRINCIPLE | 3 | 4 | 1 | 1 | 1 | — | — | 17 | **27** |
| LEVEL | 2 | — | — | — | — | — | — | 9 | **11** |
| MARKET_SIGNAL | 2 | — | — | — | — | — | — | 6 | **8** |
| **total** | 25 | 10 | 1 | 1 | 11 | 1 | **2** _(was 0)_ | **74** _(was 76)_ | **125** |

**The counts moved, and §8a.2 is why.** Two records changed author AND type: `G-035`
(AVGO pass, was `NEGATIVE_CALL`/tsdr) and `G-052` (RKLB stop-out, was `CALL`/tsdr). The owner
answered **"unknown"** on both at checkpoint 2 — a VALID answer that CLOSES them — so each is
`speaker=team-unresolved`, `MENTION` only, `excluded_from=["uct_see_rate","publish"]`,
attributed to nobody. ⛔ `team-unresolved` is **not** a person and must never be counted as one:
its two records are out of the UCT-see rate and out of every publish path by declaration, and the
verifier fails a `team-unresolved` record that omits either exclusion.

Also folded in, with no count movement: eight records went `provisional → confirmed` as their
checkpoint-2 items were ruled (`G-002 G-018 G-028 G-035 G-052 G-055 G-057 G-065`), so the frozen
set carries **zero** provisional records.

#### The three items that were NOT ours to decide

| item | encoded as | where |
|---|---|---|
| **006** G-030 vs the 9/06 50SMA/20EMA line | G-030 stays **non-canonical**; both statements kept with dates. The proposed "50SMA is an entry anchor only with confluence" rule is written **nowhere** — not a PRINCIPLE, not a vocabulary note. It stays in the Contradictions queue **as a recommendation**, `owner_disposition: open`. | `review-queue-v1.jsonl` `RQ-v1-006` |
| **007** G-035 AVGO pass | `team-unresolved`, `MENTION`, excluded from the see-rate and publish, attributed to nobody. | golden `G-035` |
| **008** G-052 RKLB stop-out | same. | golden `G-052` |

A grep for `confluence` across the frozen set returns **zero** records — the recommendation exists
only as a queue recommendation, which is what the ruling asked for.

#### Mutation proofs — every guard broken once, restored byte-exact by sha256

⛔ Restored by writing back bytes captured in memory, **never `git checkout`** (which restores
from the INDEX and would have silently discarded the WIP in this tree).

| # | mutant | rail | verdict | restored sha256 equal |
|---|---|---|---|---|
| M1 | `G-035.record_type` → `NEGATIVE_CALL` | v1 strata pass | **exit 1** — `G-035: team-unresolved may author MENTION only (§8a.2/§8b.7), not NEGATIVE_CALL` | ✅ |
| M2 | `G-018.evidence.entity.entity_confidence` `0.5` → `0.8` | v1 strata pass | **exit 1** — `G-018: inferred ticker needs entity_confidence <= 0.5 (§8a.4), got 0.8` | ✅ |
| M3 | verifier §8a.2 guard `if ambiguous and method == "speaker_label":` → `if False and …` | `--self-check` | **exit 1** — `SELF-CHECK FAIL (1)` | ✅ |
| M4 | longest golden quote planted into tracked `docs/wisdom/RESUME.md` | leaked-quote check | **exit 1** — `LEAK docs/wisdom/RESUME.md: G-061 (54 matching 24-char windows)` | ✅ |

⚠️ **M3's first attempt was VACUOUS and read as a pass.** It replaced `if is_ambiguous:` — a string
that does not occur in the verifier — so the file was unchanged, the self-check returned **0**, and
the guard looked proved while nothing had been broken. The redo asserts `count(needle) == 1` and
`mutated != original` **before** running the rail. *An empty result is a failed invocation until
proven otherwise* — the non-vacuity control is what caught it, not the exit code.

The `--frozen` lever carries its own control: the correct sha passes, and
`--frozen 000…0` returns `FAIL — golden-v1 is not the frozen set`.

## Section 2 — merges to master

| # | branch | tip SHA | merge SHA | flow-worker classification | web SUCCESS observed |
|---|---|---|---|---|---|
| 1 | `wisdom/w1-b-rails` | `010fadbe2` | `e5dfb23fb` | **OK** — `reachable=154 watched=24 changed=75`, no Wisdom module in flow-worker's import closure, so web-only | **SUCCESS 2026-09-13 21:10:33Z** on `e5dfb23fb`; `/api/health` `status: ok`, `uptime_seconds: 36` (a fresh boot, not the old pod answering) |
| 2 | `wisdom/w1-a-capture` | `7a456bcd6` | `fb62a44d9` | **OK** — `reachable=154 watched=24 changed=42`, web-only | **SUCCESS** on `fb62a44d9`; `/api/health` `uptime_seconds: 38` (fresh boot). Anonymous probes: `/capture/health`, `/capture/runs`, `/core/status` and **`POST /capture/run-family/detections?dry_run=false&as_of=2027-06-15`** each **401** |
| 3 | `wisdom/w1-c-sources` | `9193a5aa3` | `a64336c89` | **OK** — `reachable=154 watched=24 changed=26`, web-only | **SUCCESS** on `a64336c89`; `/api/health` `uptime_seconds: 27` (fresh boot) |

*(next in the §8.4 order: S-D → S-E → S-F1 → S-F2, one at a time, web SUCCESS between)*

**Merge 1 evidence.**
- Base `89c6b12bf`. Master moved TWICE during the gate (`d623baf1d` → `834034622` → `89c6b12bf`,
  other sessions), so "60 behind" was re-measured rather than carried from the session start.
- **The branch was brought current first.** `wisdom/w1-b-rails` forked at `1363d588b`, BEFORE the
  Checkpoint-1 rulings landed on `feat/wisdom-loop`. Merging the tip alone would have put an
  `authors.json` on master in which **"Uncharted Territory" is still an alias of TSDR** — the exact
  thing ruling §8a.2 reverses — plus a schema with no `ticker_inferred` and a CONTRACTS.md with no
  §8a at all. `feat/wisdom-loop` was merged into the branch first.
- **Gated on the MERGE, not the branch.** The branch gate ran without master's 60 new commits, so it
  could not answer the question that matters (`lesson_a_rail_can_be_green_alone_and_red_in_company`).
  On the merge commit: **788 passed, 2 skipped, 1 failed** (159s). The one failure is the
  pre-existing non-Wisdom `test_cross_module_imports_resolve`, provenance established from the
  committed version. `core_check_bans.py` → PASS (46 / 46 / 1285 files; `offlimits` correctly
  SKIPPED on a detached HEAD, having already run on the branch).
- **Conflict:** exactly one, `docs/feature_flags.json`, resolved by UNION after measuring all three
  sides — master had added 2 flags since the fork, S-B 25, **no flag added by both, neither side
  removing one**; 137 → 164. Re-asserted equal to the union after writing.
- **Anonymous probe of what shipped:** `/api/admin/wisdom/core/status`, `/runs` and
  `/private/{id}` each return **401**. Mounted and gated.
- **Member impact: none.** All 25 `WISDOM_*` flags are `dark` and none is set on any service;
  no job is scheduled; nothing member-facing imports `api.services.wisdom`.

**Findings fixed before the merge rather than deferred** (S-B reviewer verdict: SHIP WITH
FOLLOW-UPS). Each was a rail that could not fire, so deferring would have shipped the rails while
leaving the next five merges ungated:

| # | what it was | why it mattered |
|---|---|---|
| F1 | `"Patrick"`, `"Blake"`, `"Manav"` were CALL-author **aliases** | an exact, case-insensitive match on a Zoom display name: any attendee in a ~750-member room whose display name was their own first name was written as a CALL by that author, and D6's merge map publishes CALLs into the brain KB, `ticker_mentions` and the exemplars. Moved to `ambiguous_speaker_labels` per §8a.2 |
| **F1b** | **not in the review** — ruling §8a.2 had been applied to the DATA only | moving `"Uncharted Territory"` out of tsdr's aliases stopped it resolving to tsdr and started it resolving to **`guest:uncharted_territory`**: the guest branch matched both tokens against the session title and invented a person. `speakers.py` now checks ambiguous labels FIRST, and `author_for_alias` refuses one even if it is left in an alias list by mistake |
| F2 | the off-limits rail enforced **8 of the ~20** paths CONTRACTS §1 names, and its test parametrised over the same 8 the code named | a tautology that could never go red on an omission. Missing were `api/routers/auth.py`, `auth_db.py`, `alert_taxonomy/**`, `data_sync.py`, `llm_batch.py`, `buzz_*.py`, `tweet_store.py`, `zoom_client.py`, `deploy-windows.md`, `CatalystTable.jsx`, `app/src/hub/**` and **the flow-worker watched files — where a green rail buys a PERMANENT OPRA tape gap**. The test now derives the expected set from the CONTRACTS paragraph and fails by name; the flow-worker list is derived from the tool that already parses it |
| F3 | the private-store rail matched only the **module path** | the store stayed reachable by opening its file (`WISDOM_PRIVATE_DB_PATH` / `wisdom_private.db`) or naming its table (`wisdom_private_positions`) — neither is an import. §0.4d is about REACH, not readability. The fast path was also case-sensitive, skipping any file whose only mention was the uppercase env var |
| F5 | both CI triggers carried a `paths:` filter naming Wisdom paths and **no off-limits path** | a `wisdom/*` branch touching only `journal-2-0/**` never started the workflow, so rail 4 never ran on the one diff shape it exists for. The filter is removed rather than extended — a longer list would be a third hand-typed mirror of §1 |

Mutation-proved: dropping `auth.py`, dropping the buzz glob, and emptying the flow-worker list each
fail **by name**; `bans.py` restored from original bytes and sha256-verified (`8e6cf8f1ee33d086`).

**Open follow-ups from the review, not fixed here:** F4 (the Substack rail covers imports and two
path strings, not `subprocess`/HTTP — no live reach exists today: Wisdom has zero
`subprocess`/`httpx`/`requests`/`urllib`/`socket` surface), F6 (`ticker_inferred` has a column on
the integration branch but no writer binds the bar-range pass to it — S-D), F7 (the off-limits rail
is the only rail with no non-vacuity floor, so `0 files scanned` prints PASS), F8/F9/F10 (minor).
⚠️ **`test_property_no_publish_adapter_output_carries_a_private_value` is SKIPPED** until S-F exists —
the half of the D16a property test that covers member-facing OUTPUT has never executed. It must be
re-run at the S-F merge, and that is recorded here so it is not mistaken for coverage.

### S-B pre-merge gate (branch `wisdom/w1-b-rails`, tip `f1e0e9d91`) — 2026-09-13

The first merge in the §8.4 order. Recorded BEFORE the merge so the row above can be filled with a
merge SHA and an observed deploy rather than an intention.

| gate | result |
|---|---|
| CONTRACTS §7, run by name in full | **741 passed, 2 skipped, 1 failed** in 198.75s |
| the one failure | `test_cross_module_imports_resolve` — `api/services/discord_render/commands.py:34` imports `INTERACTIVE` from `…discord_render.runtime`. **Provenance asked of the committed version, not the working tree** (`git show origin/master:…`): the import is already on master, and `git log origin/master..HEAD -- api/services/discord_render/` is EMPTY, so this branch touches no file in that package. Belongs to the Discord render program; not Wisdom's to fix. |
| import bans (W1 GO §0.4 a/b/d/i) | `tests/test_wisdom_bans.py` **182 passed**. All four families present with planted-violation proofs: **substack** (`§0.4a` — `import`/`from`/`importlib`/`__import__`/drafts path/saved-login path, each planted at four program paths), **journal** (`§0.4b` — 18 planted reaches incl. `j2_` tables, broker router, `lib/offline`), **private store** (`§0.4d` — 8 reach forms × 8 member-facing modules, plus `test_the_real_router_does_reach_the_store_so_its_allowance_is_load_bearing`, which stops the allow-list passing for the wrong reason), **off-limits paths** (`§0.4i` — 11 named, 7 near-misses that must NOT trip). Each scan carries a floor: `test_a_scan_below_its_floor_is_inconclusive`, `test_an_unparseable_file_is_a_violation_not_a_pass`, `test_the_grep_on_this_checkout_measures_and_finds_no_live_journal_reference_in_code`. |
| owner gate | `tests/test_wisdom_core_private_routes.py` 2 passed, after `153050f71` restored `Depends(require_owner)` on `GET /api/admin/wisdom/core/private/{record_id}`. See the stranded-mutation note below. |
| R2 isolation | `tests/test_wisdom_r2_isolation.py` 10 passed, mutation-proved four ways (previous section). |

**The stranded mutation — why S-B was red at the pause.** `api/routers/wisdom_core.py:102` still read
`Depends(require_admin)) -> dict:  # MUTATION R-a`: a mutation-proof left in place when the pause
interrupted the agent mid-proof. The rail was correct and the code was wrong — a second admin reached
owner-private data (`assert 200 == 403`). Restored byte-exact to `Depends(require_owner)`.
**A sweep of all seven stream branches** for the marker found 280 pre-existing prose matches on every
branch and 281 on `w1-b-rails` — exactly one extra, this one. No other stranded mutation exists.

### S-A pre-merge gate (branch `wisdom/w1-a-capture`, tip `7a456bcd6`) — 2026-09-13

**The finding this merge closes, named as §8c.1.5 requires.**

> **An unbounded `as_of`, behind the same gate as a read, turned one admin call into a
> permanent outage with no repair route.** Executed by the S-A adversarial reviewer against
> the real `runner` with a fake bucket — not argued:
>
> ```
> POST /api/admin/wisdom/capture/run-family/detections?dry_run=false&as_of=2027-06-15
> watermark healthy=1789445820  poisoned=1813033020        (delta_days = 273.0)
> nightly 2026-09-16 → {'status':'ok','health':'zero','rows':0,'paged':True} ['window_empty']
> nightly 2026-09-17 → same        nightly 2026-09-18 → same
> ```
>
> Three things the scout's version did not have, each of which raises the severity:
> 1. **the watermark advanced on a run that captured ZERO rows.** `_record` gated on
>    `status == "ok"`, which says the reader returned and the put did not raise — and says
>    nothing about whether anything was captured or landed;
> 2. **`detection_outcomes` and `vision` poison SILENTLY.** Both declare
>    `pages=_PAGE_MISSING`, so `zero` never pages. Measured: three consecutive poisoned
>    nights, **0 pages**. The loud case was the safe one;
> 3. **there is no repair route.** The route census is three endpoints; recovery was a
>    hand-written `UPDATE` against `wisdom.db`.

**Verdict: FIX BEFORE MERGE**, on three findings that are one mechanism — `as_of` is a
trusted, unbounded input that three readers turn into a **watermark** and every reader turns
into an **immutable R2 key**.

| # | finding | disposition |
|---|---|---|
| **F1** | unbounded `as_of` → poisoned watermark; silent on two of three datasets | **fixed** |
| **F2** | a past-dated zero-row run wrote an EMPTY object to the canonical immutable key, exiling the later genuine backfill to a sha-suffixed key **forever** | **fixed** |
| **F3** | `last_as_of` / `last_r2_key` written unconditionally while the watermark beside them was monotonic — **every** legitimate backfill walked the consumer's pointer back | **fixed** |

**The five §8c.1 requirements, each against the thing that satisfies it.**

1. **Authenticates and authorizes.** Already authenticated — premise corrected in §8c.1.1.
   *Authorization* was the missing half: `dry_run=false` now requires
   `WISDOM_CAPTURE_ENABLED`. ⚰️ The admin route consulted **no flag at all**, so "every
   `WISDOM_*` variable is unset" read as "nothing can write" while this route wrote R2
   objects and run rows — the reviewer established that by execution, not by reading. A
   backdated write additionally needs `confirm=<as_of>`. **A dry run stays open**: refusing
   it would make the operator's only diagnostic depend on the flag being diagnosed.
2. **A watermark advances only past a verified, non-empty write.** `_advanceable()` —
   rows existed **and** an object was written **and** it read back as what we wrote.
   ⚠️ Consequence stated rather than hidden: a genuinely quiet window no longer advances, so
   the next run re-reads it against a wider `hi`. The safe direction, not a free one.
3. **Canonical keys via staging + a verified move.** `archive.put_versioned`'s default
   putter is `core.r2.put_verified` (integrator-owned, `ef0393790`).
   ⛔ **`put_verified`'s empty-BYTES guard cannot see F2** — `{"payload": [], "rows": 0}`
   gzips to plenty of bytes — so the empty-**capture** refusal had to live at the runner.
   Two different emptinesses need two different guards.
4. **A regression test plants the attack and asserts it is refused.**
   `test_the_as_of_attack_is_refused_and_a_write_is_gated_harder_than_a_read` (future date ·
   ancient date · flagless write · unconfirmed backdate, with a control proving only the
   three 200s reached the runner) · `test_a_zero_row_capture_writes_no_object_and_moves_no_watermark`
   · `test_a_backfill_of_an_older_day_never_walks_the_current_pointer_back` ·
   `test_an_object_that_does_not_read_back_moves_no_watermark` ·
   `test_an_archive_that_did_not_verify_moves_no_watermark_even_when_the_run_reads_ok`.
5. **This row.**

⚰️⚰️ **THE RAIL THAT WAS SUPPOSED TO PROTECT THIS PATH WAS ASSERTING THE DEFECT.**
`test_a_dry_run_writes_nothing_anywhere` used a **zero-row** reader, and its control asserted
that the same capture "for real" wrote an object and set `watermark == 123` — precisely what
§8c.1.2 forbids. **A test asserting a defect is indistinguishable from coverage**, which is
why review did not catch F1. It is now split: the dry-run test uses a non-empty capture (so it
still proves a dry run computes key and bytes and writes nothing), and the zero-row case is its
own rail asserting the opposite of what its predecessor did.

**Mutation proof — 9 guards, and the first pass had a SURVIVOR.** Each guard broken once,
rails re-run, source restored byte-exact (sha256 verified on all four files).

| guard | mutant result |
|---|---|
| `as_of` future refused · backfill horizon · write needs the flag · backdated needs confirm | 1 failed each |
| pointer write is ordered · zero rows are not archived | 1 failed each |
| canonical keys go via `put_verified` | 3 failed |
| foreign-journal carve-out stays narrow | 1 failed |
| **watermark needs a verified write** | ⛔ **38 passed — SURVIVED** |

⭐ The survivor is the finding. Neutering `_advanceable` changed nothing any test could see,
because every other rail reaches the watermark through a guard that fires *earlier* — a
zero-row capture leaves `arch is None`, a failed checksum leaves `status == "failed"`. The
invariant was implicit in two unrelated short-circuits and therefore unprotected: change
either one and the watermark is silently unguarded again. A ninth rail now drives
`_advanceable` at its own decision point (an archive result with no `verified` key, with a
control), and the same mutant reds.

**A second instrument was measuring itself.** `tools/wisdom/core_journal_exclusion_grep.py`
went red on `wire_inputs.py:31` — `morning-wire data/{wire_journal,…}`, the **morning wire's**
own ledger, named in a dict of PC-only sources Wisdom declares it does **not** read. Flagging
it reported the opposite of what is true. Carved out by exact spelling (`FOREIGN_JOURNAL_RE`),
the same shape as the `journal_mode` carve-out already beside it, **occurrence-scoped never
line-scoped**, with a control asserting `wire_journal and the J2 journal` still reads as
journal sense. ⭐ Pre-existing on S-A at `6b2d347a8` (established with `git show`, not
`git status`); it surfaced only because S-A merged the integration branch **first**, which is
the standing rule from drift #2 doing exactly its job.

**Gate evidence.**
- Gated on the **MERGE**, not the branch: **754 passed** (131s) on the first merge commit,
  then **774 passed / 1 failed** (203s) after master moved again.
- **Master moved three times during this gate** — `4fb4f9daf` → `0cd09a212` → `368520647`,
  all other programmes. Re-measured each time; **zero file overlap** with this branch on every
  measurement, so each was a clean merge rather than a rebase (this branch carries merge
  commits by design — each stream is brought current before its reviewer runs).
- **The one failure is master's, not this program's**, and the provenance was established from
  the committed versions rather than the working tree:
  `test_feature_flag_ledger::test_every_off_by_default_gate_is_declared` names
  **`TERMINAL_NEXT_MONITOR_ENABLED`** in `api/terminal_next_monitor_main.py`, a file **master**
  added in `6a7a8ee73`. `git show origin/master:docs/feature_flags.json` does **not** declare
  it, and this branch has not touched that file since `e5dfb23fb`. **origin/master is red on
  that rail right now.** ⛔ Not fixed here on purpose: the ledger records a programme's
  **intent** (`armed` / `dark` / `pending`), and only the terminal-next programme can state
  theirs. Writing a verdict on their behalf would be inventing one. **Raised for the owner.**
- `core_check_bans.py` → **PASS** (substack 70 · journal 70 · private_store 1312 · offlimits 42,
  0 violations).
- **Member impact: none.** Every `WISDOM_*` flag is `dark` and none is set on any service; no
  job is scheduled; nothing member-facing imports `api.services.wisdom`. The capture write path
  is now doubly inert — dark flag *and* admin gate.

**The other reviewer findings, each with a verdict and evidence — none "probably fine"
(§8c.2).** Eight scout findings were verified or refuted by execution; five more were new.

| # | finding | verdict | disposition |
|---|---|---|---|
| F4 | a page of foreign-author results ends a PAID walk mid-history (`new == 0` trips `no_new_ids`) | **VERIFIED** (3-page fixture: stopped at page 2, page 3's real post never reached, billed for 2 pages) | **before the first paid run**, not before merge — dark, gated, manual |
| F5 | an unresolved tweet author is stamped with the **queried handle**, defeating the `:161` guard for the one case it was written to catch | **VERIFIED — NEW**, and the SS8b.2 "unmapped must never become a named person" shape applied to authorship | with F4 |
| F6 | casing splits archived per-handle counts | **VERIFIED** | with F4 |
| F7 | the spend cap is enforced against an **unverified** `PAGE_SIZE_ESTIMATE = 20` and never reconciles against `settle()` | **VERIFIED — NEW** | with F4; bounded ≈ $2.25 against `HARD_MAX_USD = 25` |
| F8 | the spend cap is in-memory only; a crash mid-walk re-charges from page 1 | **VERIFIED — NEW** | with F4 |
| F9 | `run_family` has no durable claim, only a per-process set | **VERIFIED, bounded** — the scheduled path claims durably; F3 was the unabsorbed half and is fixed | follow-up |
| F10 | "the only product store not opened through `ro_connect`" | **PARTIALLY REFUTED** — there are **two** (`themes` *and* `catalysts`), and deleting the named call would not have fixed either | follow-up: `ro_connect` both, or amend the docstring to name the exceptions |
| F11 | abandoned `short_interest` futures could corrupt a store | **REFUTED by reading the body** — it writes **nothing to disk**, only a module-level `TTLCache` | one comment at the call site |
| F12 | a `hash_on_change` flip "mis-compares forever" | **PARTIALLY REFUTED** — it mis-compares exactly **once** and self-heals; no second object (one key across four runs) | NIT: `schema.py` docstring |
| F13 | 15 unbounded history queries in `health.py` | **VERIFIED, severity LOW** (~12k rows/year; 2 s busy_timeout 503s rather than hanging the shared pool) | follow-up: one `LIMIT` |
| F14 | `runner.py`'s docstring says it never raises; it can | **VERIFIED as a false docstring, harmless in behaviour** — caught by `registry._run_job`, recorded and paged as intended | follow-up: amend the docstring |
| F15 | S-A's mutation proof was a **gitignored hand-run script**, not a committed rail (SS8b.4: "a claim about a moment") | **VERIFIED** | **partly closed here** — the nine guards above are committed rails, mutation-proved. The x_backfill spend-cap and dry-run guards still need in-process neutering; carried with F4 |

⚠️ **What the reviewer could NOT do, stated rather than smoothed over:** no reader was run
against production-shaped product stores, so `detections_retention`'s byte-per-row cost basis
(taken from a *stale local mirror*) and the 13.6 GB claim in `detections.py` are unvalidated;
no real TwitterAPI.io call was made, so `PAGE_SIZE_ESTIMATE`, the `has_next_page`/`next_cursor`
field names and `since_time`/`until_time` remain assumptions that only `smoke_test(execute=True)`
can settle — and that needs the flag on and the owner's consent to spend.

### Observed external drift — not this program's, recorded so it is not re-diagnosed

| what | commit | state |
|---|---|---|
| `TERMINAL_NEXT_MONITOR_ENABLED` undeclared in `docs/feature_flags.json`, so `test_feature_flag_ledger::test_every_off_by_default_gate_is_declared` is RED on master | master's own `6a7a8ee73` (terminal-next-monitor) | open, theirs |

Provenance from `git show origin/master:docs/feature_flags.json` (absent) and
`git log --diff-filter=A -- api/terminal_next_monitor_main.py`, never `git status`.
⛔ **Deliberately not fixed here** (owner ruling, 2026-09-13): the ledger records a programme's
INTENT — `armed` / `dark` / `pending` — and only terminal-next can state theirs. Writing a verdict
on their behalf would be inventing one. Wisdom merges proceed past it; it is counted as a known
external red in every gate, never as a new failure.

## Section 3 — other programs' commits on paths this program created

| commit | when | program-created files touched | subject |
|---|---|---|---|

*(none)*

## Section 4 — flags declared by this program

All declared in `ca0b9b801` with their read site in `api/services/wisdom/core/flags.py`; status `dark`; nobody has flipped any.

| flag | member-visible | status | flipped by / when |
|---|---|---|---|
| `WISDOM_INGEST_ENABLED` | no (master switch) | dark | — |
| `WISDOM_CAPTURE_ENABLED` | no | dark | — |
| `WISDOM_X_BACKFILL_ENABLED` | no (spends) | dark | — |
| `WISDOM_VOCAB_AUTOPROMOTE_ENABLED` | no | dark | — |
| `WISDOM_DISCORD_LISTENER_ENABLED` | no | dark | — |
| `WISDOM_SOURCES_INGEST_ENABLED` | no | dark | — |
| `WISDOM_EXTRACT_ENABLED` | no (spends) | dark | — |
| `WISDOM_VISION_ENABLED` | no (spends) | dark | — |
| `WISDOM_EXTRACT_AUDIT_ENABLED` | no (spends) | dark | — |
| `WISDOM_OUTCOMES_ENABLED` | no | dark | — |
| `WISDOM_CONTEXT_SNAPSHOT_ENABLED` | no | dark | — |
| `WISDOM_REPLAY_ENABLED` | no | dark | — |
| `WISDOM_METRICS_ENABLED` | no | dark | — |
| `WISDOM_RETRIEVAL_INDEX_ENABLED` | no | dark | — |
| `WISDOM_WEEKLY_REPORT_ENABLED` | owner-facing | dark | — |
| `WISDOM_BRAINKB_PUBLISH_ENABLED` | **yes** — owner flips | dark | — |
| `ASKAI_WISDOM_RETRIEVAL_ENABLED` | **yes** — owner flips (cohort `wisdom-askai`) | dark | — |
| `WISDOM_DESK_MARKERS_ENABLED` | **yes** — owner flips | dark | — |
| `WISDOM_BADGES_ENABLED` | **yes** — owner flips | dark | — |
| `WISDOM_PV_EXAMPLES_ENABLED` | **yes** — owner flips | dark | — |
| `WISDOM_MODELBOOK_DRAFTS_ENABLED` | **yes** — owner flips | dark | — |
| `WISDOM_VOICE_PROFILE_ENABLED` | **yes** — owner flips | dark | — |
| `WISDOM_DOSSIER_ENABLED` | **yes** — owner flips | dark | — |
| `WISDOM_LEVEL_ALERTS_ENABLED` | **yes** — owner flips; code-gated n ≥ 100 + 14 days | dark | — |
| `WISDOM_LOOKALIKE_ENABLED` | **yes** — owner flips; code-gated n ≥ 100 + 14 days | dark | — |

---

### S-D adversarial review — findings and fixes (branch `wisdom/w1-d-extract`, 2026-09-14)

Reviewer ran on the branch AFTER `git merge feat/wisdom-loop` (§8b.1), i.e. with golden-v1
frozen at `db3475c8…` and P4 landed. Six findings confirmed by EXECUTION and fixed on the
branch; three reported and not fixed. Every fix is mutation-proved, restored byte-exact and
verified by sha256 (never `git checkout`).

| # | finding | severity | evidence | fixed |
|---|---|---|---|---|
| D-R1 | `extract/seams.py` trips the **private_store import-ban rail** — and the rail is RIGHT: `seam_report()` `importlib.import_module`s `core.private` from a module W1 §0.4d does not allow. Declared "pre-existing, not mine" by the merge-gate commit, but the file is S-D's and master would have taken a red rail. | blocks-merge | `tests/test_wisdom_bans.py` at HEAD: `1 failed, 378 passed` → after: `207 passed` on that file | ✅ row moved to its owner (`writer.private_seam_row`), still in `seam_report()` |
| D-R2 | **The budget cap is per `extractor_version`, and `extractor_version` is a hash of the system prompt, which CARRIES THE SETUP VOCABULARY** — a live, DB-backed, actively-edited artifact. Approving one vocabulary name mints a version whose spend is $0 and re-arms the entire cap. §6.4 says `actual_to_date`, not "for this version". | blocks-merge (money) | executed: $14.90 of a $15 cap spent → one extra vocab name → `wx-v0-74bafea0` → `wx-v0-3637ea48`, `spent_and_pending` `(0.0, 0.0)`, **3 more $5 requests allowed** | ✅ same cap, two ceilings, whichever binds first; fails closed. ⚠️ **reverses this stream's earlier per-version-only rule and the test that pinned it — owner/integrator should confirm** |
| D-R2 **RULING** | ⭐ **OWNER CONFIRMED THE REVERSAL, 2026-09-14.** Verbatim: *"the reviewer is right. The cap is ONE program-level total carried in the ledger across all extractor versions, models and runs; per-version and per-run spend are reported as sub-lines, never as separate budgets. Raise the program cap from $15 to $40 now that Wave 1.5 below needs multi-pass extraction; every run still prints spend-to-date against the cap and stops at it."* So the stream's earlier per-version-only rule and the test that pinned it are **superseded**, not merely overridden by a reviewer. | ruling | the reviewer's executed evidence above ($14.90 of $15 + one vocab name ⇒ 3 more $5 requests) | ✅ ONE ceiling. `select_within_budget` enforces the PROGRAM total only; `actual_usd`/`pending_estimate_usd` and the per-run ledger entries travel as REPORTED sub-lines and bind nothing; `remaining_usd` is the program remainder. Cap **$15 → $40** in `extract_golden_gate.py` and in the carried ledger ($11.6504 spent, $28.3496 headroom) |
| D-R2 **and the ceiling was already dead code** | ⚰️ The per-version check could NEVER fire. Per-version rows are a SUBSET of the program rows (same tables, one extra `WHERE`), so `actual_v <= actual_p` and `pending_v <= pending_p`, and the per-version sum cannot cross the cap strictly before the program sum does. The rail that pinned it, `test_the_per_version_ceiling_still_binds_when_the_program_total_has_room`, passed only because it seeded **one** version — which makes the two sums EQUAL, so the fixture could not create the difference its own name asserts (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). | correctness of the record | driven with TWO versions (60+5 and 40+5, cap $120) the stop reason is the program one, every time | ✅ removing the check is **behaviour-preserving**, and that is now proved rather than hoped: the replacement rail seeds two versions, asserts the sub-lines stay visible in the stop reason, and a second rail drives the real hole — a FRESH version with $0 of its own spend against a program at its cap. Mutants: enforce per-version ⇒ **3 failed**; `remaining_usd` reports the per-version view ⇒ **3 failed**; restored byte-exact, sha256-verified, **18 passed** |
| D-R3 | The golden gate records `golden_version` **derived from the FILE NAME** and never the sha §8a.1 froze. Changed bytes under the same name are compared against a baseline measured on different records and still read "accepted"; the freeze was enforceable only by remembering `--frozen` on an offline verifier. | before-first-use | `golden_file()` returns `"golden-v1"` for any bytes at that path; `golden_sha256` appeared nowhere in `golden.py` | ✅ `golden.golden_sha256`, required on every gate run and receipt, and `decide_gate` keys the comparison on it — changed bytes are an honest new BASELINE |
| D-R4 | The **dry-run rail asserted one table** (`wisdom_extract_requests`), and its fixture pre-segmented its only source, so `segment_pending_sources`'s dry-run guard was unreachable by the test. | before-first-use | mutant: `if not dry_run and segments:` → `if segments:` ⇒ `tests/test_wisdom_extract_batch.py` **26 passed, GREEN** | ✅ plants an UNsegmented source, counts all six writable tables, asserts no page, and carries a control proving a real run does segment |
| D-R5 | `writer.resolve_author` matched a speaker label to a declared guest on a **bare prefix in either direction**, so the label `"P"` resolved to `guest:patricia-kim` at confidence `medium` — and D14 then lets that "guest" author records. §8a.3 says unattributable speech in a guest session is `unresolved`; authors.json says matching is exact, no fuzzy matching. Third sighting of this class (drift #3, drift #4, S-C's guest minting). | blocks-merge | executed: `'P'`, `'Pat'`, `'patr'` → `('guest:patricia-kim', True, 'medium')` | ✅ whole-word boundary in both directions; `Qullamaggie (Guest)` and `Patricia` still resolve |
| D-R6 | `golden.split_for`'s fallback recomputed the split with a **different function** from §6.4's (`sha24(gid)` last-digit parity vs `int(sha256(gid)[:8],16)` even) — a second authority over one value. Latent (golden-v1 records carry `split`), which is why it was wrong for months. | follow-up | executed: **1007 / 2000** synthetic gids disagree | ✅ fallback is the contract formula; rail over 500 gids |

**Reported, NOT fixed — deliberately:**

* **D-R7 — `ticker_is_inferred` is case-INSENSITIVE, so §8a.4 silently never fires for a ticker
  that is also an English word.** Executed: `ticker_is_inferred("Taking it over 55 with the stop
  at 52.", "IT", None)` is `False`; same for ALL / ON / SO. Making the test case-sensitive would
  call nearly every ticker on a lowercase ASR transcript inferred and flood the review queue.
  Choosing needs a measurement against golden-v1, which is gitignored and absent from a
  reviewer's worktree. Recorded in the function's own docstring rather than patched blind.
* **D-R8 — §8a.5's `exit_price` / `exit_text` / `exit_date` columns exist in `wisdom-db-v0.sql`
  and NOTHING in `api/services/wisdom/` reads or writes them.** `prompt.record_fields()` has no
  exit field, and adding one would change the contract schema, hence `extractor_version`, hence
  the frozen golden-v1 gate — the same constraint F6 was solved around. So §8a.5's reconciliation
  has no input in W1. Not S-D's to fix inside the freeze; flagged to the integrator.
* **D-R9 — a DRY-RUN `reap` still builds a real Anthropic client and calls
  `client.messages.batches.retrieve`.** A read, not a write and not a spend, and the dry-run
  contract (no row, object, registry state, page or watermark) holds. Noted because "a dry run
  calls nothing" is how the batch suite's own docstring describes it.

**Verified, and the claim needed refining:** the merge-gate commit's note that drift #4 has TWO
independent closures and opening only ONE keeps the rail green is **true of the end-to-end
written-records assertion, and understates the branch's coverage.** Measured: dropping "Patrick"
from `ambiguous_speaker_labels` alone → `4 failed` (all in `test_wisdom_authors_aliases.py`);
re-adding it to `tsdr`'s aliases AND declaring it reviewed, leaving it ambiguous → `5 failed`,
one of them in S-D's own file (`test_the_collision_set_is_derived_and_contains_the_measured_case`
— the derived sweep cannot be silenced by editing the data); opening BOTH → `2 failed`, including
`test_an_attendee_called_Patrick_writes_zero_records_for_TSDR` by name.

**Runs (totals lines, scoped by named file):**

```
S-D + S-B core + hygiene rails ......... 736 passed, 2 skipped in 144.47s
S-D extract + store + ban rails ........ 440 passed, 1 skipped in 39.28s
repo hygiene ........................... clean (9341 tracked, no line-ending flip)
```

The 2 skips are known and recorded: §8b.9 (`test_wisdom_core_private.py:280` — the D16a
member-facing half, unrunnable until S-F lands `publish.adapters`) and the vocabulary
engine re-measure that needs `WISDOM_ENGINE_DB`.

**Mutants, each restored byte-exact and verified by sha256 (never `git checkout`):**

```
K  private seam row put back in the SEAMS table ........... 2 failed
L  program-wide budget ceiling removed .................... 1 failed
M  dry run writes segments ................................ 1 failed
N  guest matched on a bare prefix again ................... 1 failed
O  gate compares across different golden bytes ............ 1 failed
P  golden_sha256 no longer required on a gate run ......... 1 failed
Q  split fallback back to the sha24 last-digit formula .... 1 failed
R  the auto bar-range seam hands back a permissive provider  1 failed
```

**Could not measure:** no Anthropic batch was submitted and no cost was incurred (owner rule);
`data/wisdom/golden/golden-v1.jsonl` is gitignored and absent from this worktree, so neither the
`db3475c8…` freeze sha nor any extractor metric was re-derived here — only the mechanism that
records and compares it; and `WISDOM_EXTRACT_BUDGET_USD`'s live value on Railway was not read
(no variable reads or writes were performed), so the $120 code default is what the rails measure.

---

## Wave 1.5 — two ways a MUTATION HARNESS destroyed work in a shared worktree, 2026-09-14

Both found by executing, both inside the repo's own standing rule *"restore byte-exact, never
`git checkout`"* — which turns out to assume something nobody wrote down.

### 1. Byte-exact restore is a TIME MACHINE when the tree has two writers

⛔ **The standing rule assumes ONE writer.** A subagent's harness captured `golden.py`'s bytes
once at the start of its run and restored those exact bytes after each mutant. The integrator's
edits landed *inside that window*, so the restore silently reverted them — and the harness's own
check passed, because the sha matched the bytes IT had captured. **The failure is invisible from
inside the instrument: the restore succeeds, the sha agrees, and somebody else's work is gone.**

Lost and re-applied: `_ANTONYMS` and `_polarity_conflict` in `extract/golden.py`.

⭐ **The fix is not "don't mutate" — it is to re-read immediately before each mutant, and to
ABORT rather than restore when the file moved under you.** Restoring is only safe when the bytes
on disk are the bytes you mutated; otherwise the correct action is to leave the file alone and
say so. The subagent rewrote its harness that way and named the rule better than the warning it
was given.

### 2. `write_text()` on a CRLF file re-translates the newlines, and the harness then eats itself

⚰️ The integrator's own harness, ten minutes later, in the other direction. It read `writer.py`
as BYTES, decoded to text (keeping `\r\n`), mutated, and wrote back with `write_text()` — which
on Windows translates every `\n` to `\r\n`, turning each existing `\r\n` into `\r\r\n`. The
read-back no longer matched what it thought it had written, so it concluded **a concurrent
writer had touched the file** and aborted *"leaving the file as found"* — which left **the
mutant in the working tree** and 832 doubled line endings behind it.

⛔ Three lessons, and the third is the general one:
- **Bytes in, bytes out.** A harness that mutates source must `read_bytes`/`write_bytes`
  throughout; text mode silently rewrites the file's line endings.
- **An abort path must restore, not merely stop.** "Leaving the file as found" is the wrong
  default when what you found is your own mutant.
- ⭐ **A concurrency check can fire on your own corruption.** This one reported another writer
  when there was none — the instrument diagnosed the world for a fault in itself
  (`lesson_an_instrument_can_reproduce_its_own_blind_spot`). It was caught only because the next
  command grepped for the mutant instead of trusting the harness's summary.

⚠️ Repaired at byte level rather than with `git checkout`, which would have destroyed the
uncommitted Wave 1.5 item 4 work in the same file. `tools/check_repo_hygiene.py` clean afterwards.

### 3. And a reformat is a correct, unreviewable edit

Rewriting `extraction-output-v0.schema.json` with `json.dumps(indent=2)` to change three fields
produced **384 added / 53 removed**. Restored and redone as a targeted text edit: **3 changed
lines**. Same content, same tests, and a diff a human can actually review — the same defect the
CRLF ruling (R-2) names, arrived at through formatting instead of line endings.

### 4. A mutation harness whose anchors match NOTHING reports a clean sweep

⛔⛔ **The most dangerous of the three, found by the golden-v1.1 subagent.** `golden.py` is
**CRLF on disk and LF in the stored blob** (`core.autocrlf=true`). Five multi-line literal
anchors therefore matched **0 times**, the mutations silently did not happen — and the run
printed the same thing it prints when every rail catches every mutant.

⭐ **"The anchor matched nothing" and "the rail caught the mutant" are indistinguishable in the
output.** A harness can report nine of nine caught having changed not one byte of the subject.
Any harness in this repo that does a literal multi-line string match against a source file has
this latent; the fix is to match on normalised text, restore the original BYTES, and **assert the
anchor count is exactly 1 before mutating** — an anchor that matches zero times must be a hard
error, never a skipped mutant.

### 5. And a filter tuned for one purpose silently disabled another that reused it

The paraphrase lens's antonym guard was installed, tested, and dead for one of its two cases.
`_polarity_conflict` took the token sets `_tokens` had already built, and `_tokens` drops words
of two characters or fewer — so `up` was never in them and the (up, down) pair could not fire.
"size down when the regime turns hostile" and "size up when the regime turns friendly" went on
merging **with the guard in place and apparently working**, because the never/always case passed.

⭐ A filter that is correct for similarity (short words are noise) is wrong for polarity (the
short words ARE the meaning). The guard now tokenises for itself, and the docstring says why.
