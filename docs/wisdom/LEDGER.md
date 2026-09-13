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

### Owner-task evidence (W1 GO Part 2)

| Task | Done | How verified |
|---|---|---|
| §2.1 Discord grants | Bot role `1474903498700230668` given VIEW on #tsdr, #1chartmaster and #manrav, and VIEW+HISTORY on #bracco (@everyone denies history there). Granted in the Discord web UI as the server owner; the bot lacks MANAGE_ROLES. | `GET /channels/{id}/messages?limit=50` with the bot token returned HTTP 200 for all four channels on 2026-09-13. |
| §2.1 author IDs | tsdr `339816805805588480` (46/50; the other 4 are the UCT Intelligence webhook bot) · bracco `427798118935953410` (50/50) · chartmaster `1203080759141736508` (50/50) · manrav `806378356966424596` (50/50) | Authorship of the latest 50 messages in each author's own channel (IDs only). |
| §2.1 other trade-alert channels | #volume-alerts (Scripted Trading app), #uncharted-scanners (Uncharted Scanners app) and #test-chartmaster-alerts (ChartMaster Alerts app) are OUT OF SCOPE, not granted. | Read in the owner's Discord session 2026-09-13; every visible message is app-authored. |
| §2.2 Zoom | **Recovery DROPPED (owner correction 2026-09-13):** Zoom cloud copies are deleted on purpose after posting; the Stockbee workshop is not in trash and is not an owner task. Replaced by the desk-transcript check (Step 0) for 356 and every video under 98 %, re-transcription + diarization where no full copy exists, and store-and-verify before delete (CONTRACTS §8a.6a–6b). | Measured S2S scopes: `cloud_recording:delete:meeting_recording:admin cloud_recording:read:list_recording_files:admin cloud_recording:read:recording:admin`; `GET /meetings/{uuid}/recordings` → 404, consistent with the intentional deletion. R2 `desk_audio/rKVAkk3811Q.m4a` exists (83,057,014 bytes). |

## Section 2 — merges to master

| # | branch | tip SHA | merge SHA | flow-worker classification | web SUCCESS observed |
|---|---|---|---|---|---|

*(none yet — planned order S-B → S-A → S-C → S-D → S-E → S-F, one at a time; CONTRACTS.md §8)*

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
