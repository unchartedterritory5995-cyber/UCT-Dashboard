---
id: ARMING-LIST-2026-10-10
title: Arming list for the dark alert flags (AC-2, AC-4, AC-7, FT-033, FT-035 remind) plus TERM-047 and FT-034 shadow
date: 2026-10-10
status: record (no production change was made)
---

# Arming list, 2026-10-10

Lane f-l6 checked that each flag below has complete code and a real read site (grep, at the
f-l6 branch), and lists the exact variable, the service, and any prerequisite. **Nothing here was
armed.** Each arm is the owner's act.

**How to arm any row** (CLAUDE.md, "`railway variables --set` measured both ways"):

1. `railway variables --service web --set "<FLAG>=1"`
2. Wait for a new boot (a startup line stamped after the set). If none appears within about
   3 minutes, `railway redeploy --service web --yes`.
3. Confirm in the running process (`os.environ.get("<FLAG>")` over `railway ssh`), never from `--kv`.
4. In the same docs push, set the flag's `docs/feature_flags.json` entry to `armed`, with the
   service in `where` and the flip time in the note.

Rollback for every row: set the variable to `0` and confirm a new boot (a `delete` does not
restart the process).

| row | variable | service | read site (gate) | consumers | prerequisite |
|---|---|---|---|---|---|
| AC-2 channel registry | `ALERT_CHANNEL_REGISTRY_ENABLED` | web | `api/services/alert_taxonomy/channels.py:38` (`is_enabled`, read per call) | `api/services/alerts.py:148` resolves the alert webhook through the registry | None. The registry resolves to the same variable names the legacy reads used, so armed output is byte-identical by design. |
| AC-4 queue caps | `ALERT_QUEUE_CAPS_ENABLED` | web | `api/services/alert_taxonomy/queue_caps.py:63` | `api/services/alert_taxonomy/delivery.py:69` (`admit` before delivery), `queue_caps.py:134` | None. Caps are code constants (total 30 per member per rolling hour, per-type cap 12 with a reserve). A capped fire is still recorded in `alert_fires`. |
| AC-7 ops monitor | `ALERT_OPS_MONITOR_ENABLED` | web | `api/services/alert_taxonomy/ops_monitor.py:55` | route `api/routers/alert_taxonomy.py:225` (`require_admin`); panel `app/src/pages/Admin.jsx:2061` (`AlertOpsPanel`, renders nothing on a 404) | None. Admin-only. Recording runs whether or not it is armed; the flag gates the read route. |
| FT-033 outbound webhooks | `ALERT_WEBHOOKS_ENABLED` | web | `api/services/alert_taxonomy/outbound_webhooks.py:102` | enqueue `outbound_webhooks.py:296`, drain `:349`, routes `api/routers/alert_outbound.py:37`, drain job `api/main.py:7678` (`alert_webhooks_drain`, registered unconditionally) | **`BROKER_ENCRYPTION_KEY` must be set on web** (`api/services/crypto_box.py:57`): `outbound_webhooks.py:219` refuses to mint a per-webhook signing secret without it. CLAUDE.md records the key as set on production; confirm it in-process before arming. Optional: `WEBHOOK_HOURLY_CAP` (default 120). |
| FT-035 remind | `ALERT_REMIND_ENABLED` | web | `api/services/alert_taxonomy/remind.py:63` | routes `api/routers/alert_taxonomy.py:175`; job `api/main.py:7714` (`alert_remind`, every 5 min, registered unconditionally) | None to arm. A reminder only goes to channels that delivered the original fire, so email reminders need `RESEND_API_KEY` and push reminders need the `WEB_PUSH_*` variables, both of which already govern the original delivery. |
| TERM-047 coverage receipts | `COVERAGE_RECEIPTS_SCANS_ENABLED` | web | `api/services/coverage_receipt.py:30` (`is_enabled`, read per call) | routes `api/routers/scans.py:44`, `api/routers/screener.py:307`, `api/routers/volume_scan.py:57`; panels render `CoverageLine` from the `coverage` key (screener widgets, `ScannerShell`, BRKO, and since f-l6 the `MOST RVOL` lens) | None. Dark, no `coverage` key is attached and every response is byte-identical. |
| FT-034 rating-change shadow log | `ALERT_TAXONOMY_RATING_CHANGE_DARK_ENABLED` | web | `api/services/alert_taxonomy/rating_change_compare.py:100` (`is_enabled`, read per call) | job `api/main.py:7756` (`alert_taxonomy_rating_change_dark`, registered only while armed, so arming needs the boot) | None. Writes comparison spans and a heartbeat to `alert_taxonomy.db` only: no fire, no delivery. The member-facing type stays behind `ALERT_RATING_CHANGE_ENABLED`, which flips only when `tools/alert_type_readiness.py` says READY. |

## The TERM-025 owner action

Run the readiness tool on the web pod (it reads, it flips nothing):

```
railway ssh --service web
/opt/venv/bin/python tools/alert_type_readiness.py --db /data/alert_taxonomy.db
```

Pass `--dispositions <file>` once any excluded predicate has been dispositioned (ADR-0036 clause 3).
A type it prints as `READY TO FLIP` is flipped by that type's own per-type step.
