# D14 — session log (master-tracked)

The full working checklist and evidence tree for this programme live on the
`discord-render-hardening` branch (not yet merged to master); this file is a
short, master-tracked log of individual fixes as they land here, plus the
PROOF entries for R71's watchPatterns change.

## 2026-09-18

- **R71 (D-21):** `railway.web.json`'s `build.watchPatterns` set via
  config-as-code (commit `5f21367b2`) — web now redeploys only on
  `api/**`/`app/**`/`requirements*.txt`/`railway*.json`/`Dockerfile.web` plus
  two named tools. This line is the PROOF: a docs-only push (this file) must
  produce **no web deploy record**. If it does, `railway.web.json`'s pattern
  list needs correcting before anything else in the D-21 work order proceeds.
- **R72 (D-21):** `api/services/screener/live_tier.py::_timed_touch` — three
  named SQLite sub-timers inside the boot-window sweep, busy-wait separated
  from statement time (`set_busy_handler` confirmed removed on this Python).
  This is the `api/**` commit that proves R71's second half: it must still
  deploy normally. Full account:
  `discord-render-hardening:docs/discord-render/evidence/d18/R72-boot-window-screener-derive-2026-09-18.md`.
