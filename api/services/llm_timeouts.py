"""Bounded read timeouts for LLM clients — the policy, in one place.

WHY THIS EXISTS. The `anthropic` and `openai` SDKs default to a **600 s read
timeout**. An LLM client constructed without `timeout=` on a request path is
therefore a ten-minute pin of one of the web pod's 64 shared anyio worker
threads, per request. That is the *exact* mechanism of the 2026-07-01 outage —
an unbounded blocking call on a path every user hits, where a bare 401 took 24
seconds — and the 2026-08-09 performance audit found **11** of them still
standing, one (`transcripts.py`) reachable with **no auth dependency at all**.

`requests` / `httpx` / `urllib` / yfinance are already clean and rail-enforced.
LLM clients were the remaining hole.

THE INVARIANT, and it is structural: **every LLM client construction under
`api/` passes an explicit `timeout=`.** `tools/llm_timeout_census.py` +
`tests/test_llm_timeout_census.py` fail by NAME when a new unbounded client
appears — a one-time sweep without a rail is how eleven of them accumulated.

⚠️ THE RAIL NEVER DICTATES A VALUE, only that one is stated. That distinction is
load-bearing: a **scheduler-thread** pass can legitimately need minutes, and a
shared 60 s default has already broken one (the Desk insights chapters pass,
600k-char transcript + 2400 Opus tokens — hence `DESK_CHAPTERS_LLM_TIMEOUT_SECS`,
default 300, applied per call via `client.with_options(timeout=...)`). Picking a
number for the caller is how that regression happened; demanding that the caller
pick one is what this module is for.

Which constant to reach for:
  REQUEST_PATH   — a user is waiting on an HTTP response. Short by design.
  REQUEST_PATH_LONG — same, but streaming or a large generation.
  OFFLINE_JOB    — a scheduler thread or an operator script; nobody is waiting
                   on a socket, and cutting it short just wastes the tokens.

Every call site passes its value through `seconds()` so an operator can retune a
single surface from Railway without a deploy, exactly as the Desk pass does.
"""
from __future__ import annotations

import os

# A user is blocked on this. 60 s is the value the shared client in
# `engine._get_anthropic_client()` has carried since the 2026-07-01 hardening.
REQUEST_PATH = 60.0

# Streaming synthesis / large max_tokens on a request path. Still bounded, still
# an order of magnitude under the SDK's 600 s default.
REQUEST_PATH_LONG = 120.0

# Scheduler threads and operator scripts. No request is held; the only cost of a
# long ceiling here is a slow job, not a starved pool.
OFFLINE_JOB = 300.0


def seconds(env_name: str, default: float) -> float:
    """`default`, overridable by the `env_name` environment variable.

    Fail-soft on purpose: a typo'd or hostile env value falls back to the coded
    default rather than raising at client construction, because the failure mode
    of "0" or "" or "none" would otherwise be an *unbounded* client — the very
    thing this module exists to prevent. A non-positive override is refused for
    the same reason.
    """
    raw = os.environ.get(env_name)
    if raw is None or not str(raw).strip():
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default
