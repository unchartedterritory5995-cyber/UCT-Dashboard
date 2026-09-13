---
id: WISDOM-LOOP-SESSION-STATE
title: UCT Wisdom Loop — session state (continuation handoff)
status: current
updated: 2026-09-13 13:35 ET (an earlier "17:xx ET" reading was UTC — Git Bash ignores TZ=America/New_York)
---

# Session state

Read this, then `docs/wisdom/CONTRACTS.md`, then `docs/wisdom/LEDGER.md`. The owner's Wave 1 text
is in the gitignored `data/wisdom/WAVE1-PROMPT-v2.0.md` in this worktree.

## Branch

`feat/wisdom-loop`, rebased on `origin/master` `f34ce660b`, pushed. Nothing merged to master yet.

## Done

- **Contracts:** `docs/wisdom/CONTRACTS.md` settles 29 contradictions and fixes the layout, registry/store API, flags,
  schedule and merge protocol.
- **Skeleton:**
  - `api/services/wisdom/` (registry, core store, ids, time, flags, heartbeat, R2, authors, owner gate, core jobs)
    plus `api/routers/wisdom_*.py`.
  - Three `api/main.py` hooks; 25 gates declared dark.
  - `tests/test_wisdom_skeleton.py` 19 passed.
- **Discord (W1 §2.1):**
  - The bot reads #tsdr, #bracco, #1chartmaster and #manrav (200 each).
  - Authors verified by user ID from the last 50 messages of each channel.
  - #volume-alerts, #uncharted-scanners and #test-chartmaster-alerts are app-authored (Scripted Trading / Uncharted
    Scanners / ChartMaster Alerts). They are out of scope and were not granted.
- **Zoom — owner correction 2026-09-13 (CLOSED on the owner's side):**
  - Zoom cloud recordings are deleted ON PURPOSE after posting. "Workshop with Stockbee" is NOT in Zoom trash and cannot
    be recovered. Never plan a Zoom recovery, and never list it as an owner task.
  - Instead (CONTRACTS §8a.6a–6b):
    1. Desk-transcript check first, for 356 and every video under 98 % coverage (audit agent running).
    2. If no full copy exists: re-transcribe the full audio (faster-whisper, the Desk gapfill STT) + diarization, and name
       clusters by evidence only.
    3. Rebuild edu_videos + chapters as a new source version.
    4. Pipeline: store-and-verify before delete (VTT, audio transcript, chat log, metadata to R2; coverage >= 98 %).
  - R2 `desk_audio/rKVAkk3811Q.m4a` exists (83,057,014 bytes). The box has faster_whisper + ctranslate2, ffmpeg 8.1.2
    and 24 cores.
  - **R2:** `wisdom/` prefix measured empty (0 keys) before any Wisdom write.
- **Owner rulings at checkpoint 1** are in CONTRACTS §8a:
  - golden-v1 freeze;
  - ambiguous host label -> evidence-only resolution, else `team-unresolved` (MENTION only);
  - inferred tickers (confidence <= 0.5 + bar-range pass);
  - exits (exit_price/exit_text/exit_date, mismatch flag, private when open or closed <= 20 sessions);
  - checkpoint format (status table first, cost + Batch progress every time).

## In flight

- **Build streams:** Workflow `wf_c1669d34-d75` (launched 13:32 ET).
  - Seven worktree builders, each followed by an adversarial reviewer. The plan's S-F is split into S-F1 `wisdom/w1-f-admin`
    (review queue, dashboard, chains, weekly report, RUNBOOK) and S-F2 `wisdom/w1-f-publish` (consumer adapters, retrieval,
    D20), with disjoint owned paths.
  - The other branches: `wisdom/w1-b-rails`, `wisdom/w1-a-capture`, `wisdom/w1-c-sources`, `wisdom/w1-d-extract`,
    `wisdom/w1-e-evals`. Base `1363d588b`.
  - Their briefs predate the checkpoint-1 rulings and the Zoom correction. Reviewers judge against the CURRENT
    CONTRACTS.md, so the gaps surface as findings to fix at integration.
- **S-D golden v1 — integrated `2e1f9f4bb`.** Propagation + freeze agent running (branch `wisdom/w1-d-golden-prop`).
- **Desk-transcript audit (Step 0):** read-only agent running. Output: `data/wisdom/audit/desk-transcript-audit-2026-09-13.json`.
- ⚠️ **Box lock:** `uct-clips/tools/heavy_lock.py` is shared with other programs. An integrator skeleton re-run timed out while
  'HOLD-2e' held it. The skeleton was green before (19 passed); re-run when free.

## Pre-existing reds on master (not Wisdom)

- `tests/test_cross_module_imports_resolve.py`: `api/services/discord_render/commands.py:34` imports `INTERACTIVE`
  from `runtime`, which does not define it. This belongs to the Discord render program.
- `tests/test_feature_flag_ledger.py` was red on the old base (four ALERT_TAXONOMY dark flags). It is fixed on
  master `f34ce660b`.

## Deploy constraints today (Sunday)

- **No master push** 17:50–18:30 ET (Notebook Wave Q1 gate).
- **No master push** within ±3 min of an odd ET hour (Q1 sampler).
- **One master merge at a time.** Railway web SUCCESS must be verified by an `/api/health` uptime reset before the next merge.
