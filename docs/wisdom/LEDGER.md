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

**Row 8 evidence.** The integrator re-ran the verifier on the integration branch:
- `--self-check` → `SELF-CHECK PASS`.
- v0 defaults → `records=30 … PASS`.
- v1 with `--require-strata` → `STRATA PASS`, 125 records.

Totals: 117 confirmed, 8 provisional. Types: CALL 40, NEGATIVE_CALL 17, MENTION 22, PRINCIPLE 27, LEVEL 11, MARKET_SIGNAL 8. Authors: tsdr 76, bracco 25, manrav 11, chartmaster 10, ravi 1, guests 2. Split: dev 67, test 58.

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

### Owner-task evidence (W1 GO Part 2)

| Task | Done | How verified |
|---|---|---|
| §2.1 Discord grants | Bot role `1474903498700230668` given VIEW on #tsdr, #1chartmaster and #manrav, and VIEW+HISTORY on #bracco (@everyone denies history there). Granted in the Discord web UI as the server owner; the bot lacks MANAGE_ROLES. | `GET /channels/{id}/messages?limit=50` with the bot token returned HTTP 200 for all four channels on 2026-09-13. |
| §2.1 author IDs | tsdr `339816805805588480` (46/50; the other 4 are the UCT Intelligence webhook bot) · bracco `427798118935953410` (50/50) · chartmaster `1203080759141736508` (50/50) · manrav `806378356966424596` (50/50) | Authorship of the latest 50 messages in each author's own channel (IDs only). |
| §2.1 other trade-alert channels | #volume-alerts (Scripted Trading app), #uncharted-scanners (Uncharted Scanners app) and #test-chartmaster-alerts (ChartMaster Alerts app) are OUT OF SCOPE, not granted. | Read in the owner's Discord session 2026-09-13; every visible message is app-authored. |
| §2.2 Zoom recovery | IN PROGRESS. The S2S token scopes are exactly `cloud_recording:delete:meeting_recording:admin cloud_recording:read:list_recording_files:admin cloud_recording:read:recording:admin`. | `GET /meetings/{uuid}/recordings` → 404 "This recording does not exist" (in trash). Trash listing via `users/me` and `accounts/me` → 400 naming the missing list scopes. The portal sign-in needs the owner's password (the agent may not enter one). |

## Section 2 — merges to master

| # | branch | tip SHA | merge SHA | flow-worker classification | web SUCCESS observed |
|---|---|---|---|---|---|

*(none yet — planned order S-B → S-A → S-C → S-D → S-E → S-F, one at a time; CONTRACTS.md §8)*

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
