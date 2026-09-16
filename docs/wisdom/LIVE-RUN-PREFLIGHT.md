---
id: WISDOM-LIVE-RUN-PREFLIGHT
title: The first live daily chain run — what it needs, measured
status: BLOCKED ON FOUR OWNER FLAG FLIPS (2026-09-14)
---

# The first live run — pre-flight

⛔⛔ **"Run the daily chain for real on Railway after today's close, flags dark" cannot happen as
written, and the reason is structural rather than a bug.** Measured against production's actual
state (no `WISDOM_*` variable set on any of six services):

```
0 of 13 Wisdom jobs would run tonight.
```

Every job's `enabled()` returns **False**, so the scheduler registers none of them. That includes
`wisdom_daily_chain` (Mon–Fri **18:47 ET**, which is correctly after the close),
`wisdom_sources_discord_listener` (every 15 min) and all six capture jobs. So:

- **The Discord listener is not running and cannot be "confirmed running"** — it is disabled, not
  broken.
- **D12 capture counts cannot be session 1 of the 3-session gate** — the capture jobs do not fire.
- **The weekly chain IS scheduled correctly** — `wisdom_weekly_chain`, Sunday **19:52 ET**, which
  is after Sunday Scans publishes — but it is disabled too, so 2026-09-20 will not fire either.

⭐ **This is the design working.** `WISDOM_INGEST_ENABLED` is the master switch and it fails
closed; nothing in this program can touch anything while it is unset. The cost is that the first
live run is a **flag flip, and flag flips are the owner's** (§0.4c).

## The minimal set, and why each one

| flag | why it is needed | what it exposes |
|---|---|---|
| `WISDOM_INGEST_ENABLED=1` | **The master.** Without it NO job registers — not the chain, not capture, not the listener. | nothing member-facing |
| `WISDOM_CAPTURE_ENABLED=1` | the six D12 capture jobs; this is what makes tonight **session 1 of 3** | internal archive to R2 |
| `WISDOM_DISCORD_LISTENER_ENABLED=1` | the listener AND the `sources` step's Discord half — the **catch-up count from the four author channels** | reads four channels; no member messages (§0.4e) |
| `WISDOM_SOURCES_INGEST_ENABLED=1` | the `sources` step's transcripts half. Optional: without it that half reports `skipped`, which is honest, and the Discord count still lands. | internal |

⛔ **`WISDOM_EXTRACT_ENABLED` should stay OFF, and leaving it off costs nothing tonight.**
`batch.run_daily` is gated by that flag **AND** by the golden gate — it needs an *accepted*
evaluation for the running `extractor_version` + model **in production's own `wisdom.db`**. The
only accepted evaluation for `wx-v0-fc47bc97` lives in a local gate DB on the PC, so the extract
step would report `gate not accepted` and skip regardless. Leaving the flag off makes **"tonight
spends nothing" structural rather than incidental**, which is the version worth having.

⛔ **Every member-facing flag stays off, and that is the whole point of flipping only these four.**
The one flag in the ledger carrying `exposure: public` is `WISDOM_BRAINKB_PUBLISH_ENABLED`; it is
not in this set. Neither is any adapter, the weekly report, D20 level alerts, dossiers or the
voice profile. **Nothing a member can see changes.**

## What tonight will and will not produce

| the owner asked for | with the four flags on |
|---|---|
| per-step results for the daily chain | ✅ all 9 steps, each with `ok` / `failed` / `not_available` / `skipped` and a reason |
| D12 capture counts, session 1 of 3 | ✅ |
| Discord catch-up count, four author channels | ✅ |
| "any step fails on production → a Wave 1 defect" | ⚠️ read `not_available` and `skipped` as neither: `retrieval` skips on its own flag and `stt_alias` is an inline note, and the extract step will skip on the golden gate |

⚠️ **The sandbox already told us where the risk is.** In the §8.6 acceptance run the `sources`
step was the only failure, and both causes were environmental (no local Discord token, unseeded
`edu_videos`). Production has the Discord token and a real `edu_videos`, so this is the step most
likely to behave differently from the sandbox — which is exactly why it is worth running.
