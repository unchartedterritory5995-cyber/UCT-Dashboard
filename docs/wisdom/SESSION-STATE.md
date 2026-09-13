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
- **Zoom (W1 §2.2):**
  - The S2S app has only these scopes: `cloud_recording:delete:meeting_recording:admin`,
    `cloud_recording:read:list_recording_files:admin` and `cloud_recording:read:recording:admin`.
  - It cannot list trash or recover. The direct GET for the Stockbee meeting returns 404 because the recording is in trash.
  - The Zoom web portal is signed out and asks for a password, which the agent may not enter.
  - **Needs:** the owner signs in to zoom.us once in the shared Chrome profile. The fallback is Whisper re-transcription
    from R2 `desk_audio/rKVAkk3811Q.m4a` (precedent `tools/desk_transcript_gapfill.py`), which has no speaker labels.

## In flight

- **S-D golden v1 agent** (worktree branch `wisdom/w1-d-golden`): verifies the 30 v0 labels, expands to ≥100, and
  samples Discord.
- **Build streams:** Workflow run `wf_c1669d34-d75`, launched 13:32 ET. It has seven worktree builders, each followed by
  an adversarial reviewer. The branches are `wisdom/w1-b-rails`, `wisdom/w1-a-capture`, `wisdom/w1-c-sources`,
  `wisdom/w1-d-extract`, `wisdom/w1-e-evals`, `wisdom/w1-f-admin` and `wisdom/w1-f-publish`, all based on `1363d588b`.
  The script is under `.claude/projects/.../workflows/scripts/wisdom-w1-build-wf_c1669d34-d75.js`; resume it with
  `resumeFromRunId`.

## Pre-existing reds on master (not Wisdom)

- `tests/test_cross_module_imports_resolve.py`: `api/services/discord_render/commands.py:34` imports `INTERACTIVE`
  from `runtime`, which does not define it. This belongs to the Discord render program.
- `tests/test_feature_flag_ledger.py` was red on the old base (four ALERT_TAXONOMY dark flags). It is fixed on
  master `f34ce660b`.

## Deploy constraints today (Sunday)

- **No master push** 17:50–18:30 ET (Notebook Wave Q1 gate).
- **No master push** within ±3 min of an odd ET hour (Q1 sampler).
- **One master merge at a time.** Railway web SUCCESS must be verified by an `/api/health` uptime reset before the next merge.
