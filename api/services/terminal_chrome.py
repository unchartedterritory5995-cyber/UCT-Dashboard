"""TERMINAL-NEXT lane T4 -- the dark flags for the terminal chrome and the phone doors.

Two ENABLEMENT gates, default OFF, read PER CALL (never captured at import), each the ONE
reader of its variable. Neither has a server route: each is a client surface, so the only
thing a flag does here is put its key on the auth payload (`api/routers/auth.py`
`_terminal_chrome_flags`), present ONLY when on (the TERM-077 form: unset => the payload is
byte-identical to before the lane; the client reads `=== true`).

  TERMINAL_CHROME_ENABLED      -> `terminal_chrome_enabled`
      The /terminal shell's L0 status strip (V7: session clock, data freshness, connection,
      the active channel, unread alerts), the per-panel as-of in each panel header (V8,
      TERM-006's per-class authority), and the phone shell's panel switcher + layout sheet
      (P14a). Still behind the terminal-next cohort gate: the shell itself is unreachable
      for a member the cohort does not admit.

  CHARTS_PHONE_DOORS_ENABLED   -> `charts_phone_doors_enabled`
      /charts on a phone (MobileChartsApp, P14b): three rows in the Tools sheet -- the
      Multi-Chart grid, Compare symbols, and the workspace version history (TERM-051).
      /charts is a LIVE page for every member, so this one is its own flag.

Kill = unset; nothing is written or deleted by either flag.
"""
from __future__ import annotations

import os

_ON = ("1", "true", "yes", "on")


def chrome_enabled() -> bool:
    """V7 / V8 / P14a. Unset means OFF."""
    return os.getenv("TERMINAL_CHROME_ENABLED", "0").strip().lower() in _ON


def charts_phone_doors_enabled() -> bool:
    """P14b. Unset means OFF."""
    return os.getenv("CHARTS_PHONE_DOORS_ENABLED", "0").strip().lower() in _ON
