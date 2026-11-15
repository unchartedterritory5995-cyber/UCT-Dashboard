"""How long the stream-ingest Massive reader waits before it connects again (ingest PR4b).

Massive allows about ONE stocks connection per key (INGEST-PROCESS-DESIGN, "DECIDED
11-13"): a second connection is refused with `max_connections`, or kicks the first.
And a session that just closed stays counted on Massive's side for 10-30 s, so a
reconnect straight into it is refused too. This policy is what keeps one refusal from
turning into a reconnect storm. It is the options worker's ladder (api/massive_ws_worker.py,
MAXCONN_LADDER and the young-process cap), ported here as a pure object:

  * `max_connections` (at auth or as the disconnect reason): wait 30, 60, 120, 300,
    then 600 s on each further strike in a row. The strikes reset only when a
    connection authenticates. While the process is young (just deployed) the wait is
    capped at 60 s: a young process's refusal is almost always the old deployment's
    session still being reaped, not a real lockout.
  * any other auth failure: 60 s (what bar_stream has always done).
  * any other disconnect: the reader's own exponential backoff, but never under
    `min_gap_s` (Massive's guidance: leave 10-30 s between connections).

No rung and no cap is below 30 s. Time is injected (`monotonic`), so every decision
is reproducible in a test. The web pod's reader does NOT use this: bar_stream's
default policy keeps its behaviour exactly as it was.
"""
from __future__ import annotations

import time
from typing import Callable

#: Seconds to wait on the 1st, 2nd, ... consecutive `max_connections`.
MAXCONN_LADDER = (30.0, 60.0, 120.0, 300.0, 600.0)
#: A process younger than this (seconds) caps a max_connections wait at YOUNG_CAP_S.
YOUNG_UPTIME_S = 900.0
YOUNG_CAP_S = 60.0
#: Other auth failures (a bad key, an unexpected status): bar_stream's historic wait.
AUTH_FAILURE_S = 60.0
#: The shortest wait before any reconnect after a disconnect.
MIN_GAP_S = 10.0


def is_max_connections(text: object) -> bool:
    return "max_connections" in str(text or "")


class MaxConnLadder:
    """The reconnect policy bar_stream._run_websocket asks for its waits (see module doc)."""

    def __init__(self, *, ladder=MAXCONN_LADDER, young_uptime_s: float = YOUNG_UPTIME_S,
                 young_cap_s: float = YOUNG_CAP_S, auth_failure_s: float = AUTH_FAILURE_S,
                 min_gap_s: float = MIN_GAP_S,
                 monotonic: Callable[[], float] = time.monotonic):
        if not ladder or min(ladder) < 30.0 or young_cap_s < 30.0:
            raise ValueError("no max_connections wait may be under 30 s (Massive guidance)")
        self.ladder = tuple(float(x) for x in ladder)
        self.young_uptime_s = float(young_uptime_s)
        self.young_cap_s = float(young_cap_s)
        self.auth_failure_s = float(auth_failure_s)
        self.min_gap_s = float(min_gap_s)
        self._mono = monotonic
        self.started = monotonic()
        self.strikes = 0            # consecutive max_connections since the last auth_success
        self.maxconn_total = 0
        self.connects = 0           # connections that authenticated
        self.last_wait_s = None
        self.last_reason = None
        self.on_connected: Callable[[int], None] = lambda n: None

    # -- the three questions bar_stream asks --

    def connected(self) -> None:
        """A connection authenticated: the strikes reset; `on_connected(n)` is told
        which connection this is (1 = first, 2+ = a reconnect)."""
        self.strikes = 0
        self.connects += 1
        self.on_connected(self.connects)

    def auth_failed_delay(self, status: object) -> float:
        if is_max_connections(status):
            return self._maxconn("auth: max_connections")
        return self._wait(self.auth_failure_s, f"auth failed: {str(status)[:80]}")

    def disconnect_delay(self, err: BaseException, backoff: float) -> float:
        if is_max_connections(err):
            return self._maxconn("disconnect: max_connections")
        return self._wait(max(float(backoff), self.min_gap_s), f"disconnect: {type(err).__name__}")

    # -- internals --

    def _maxconn(self, reason: str) -> float:
        self.strikes += 1
        self.maxconn_total += 1
        wait = self.ladder[min(self.strikes, len(self.ladder)) - 1]
        if self._mono() - self.started < self.young_uptime_s:
            wait = min(wait, self.young_cap_s)
        return self._wait(wait, reason)

    def _wait(self, seconds: float, reason: str) -> float:
        self.last_wait_s = seconds
        self.last_reason = reason
        return seconds

    def status(self) -> dict:
        return {"strikes": self.strikes, "maxconn_total": self.maxconn_total,
                "connects": self.connects, "last_wait_s": self.last_wait_s,
                "last_reason": self.last_reason,
                "young": self._mono() - self.started < self.young_uptime_s}
