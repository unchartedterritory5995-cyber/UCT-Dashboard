"""How long the stream-ingest Massive reader waits before it connects again (ingest PR4b).

Massive counts stocks connections per key and kicks the oldest one past the limit with
`max_connections`. The limit was ONE until 2026-11-18, when a second connection was added
(measured that day: a second socket on the key coexisted with ingest's once ingest's
session re-authenticated after the add-on). A session that just closed stays counted on
Massive's side for 10-30 s, so with one connection a reconnect straight into it was
refused; with two, that leftover session fits under the limit, which is what lets
`INGEST_RECONNECT_MIN_GAP_S` (the `min_gap_s` below) come down from its 10 s default.

This policy is what keeps one refusal from turning into a reconnect storm. It is the
options worker's ladder (api/massive_ws_worker.py, MAXCONN_LADDER and the young-process
cap), ported here as a pure object:

  * `max_connections` (at auth, as a status frame while streaming, which is how a
    KICK arrives, or in the disconnect reason): wait 30, 60, 120, 300, then 600 s on
    each further strike. The strikes reset only once a connection has stayed up for
    `healthy_s` (120 s): resetting at auth would let two sockets that kick each other
    reconnect every 30 s forever. While the process is young (just deployed) the wait
    is capped at 60 s: a young process's refusal is almost always the old
    deployment's session still being reaped, not a real lockout.
  * any other auth failure: 60 s (what bar_stream has always done).
  * any other disconnect, and a clean close by the server: the reader's own
    exponential backoff, but never under `min_gap_s` (Massive's guidance for one
    connection: leave 10-30 s between connections).

No rung and no cap is below 30 s. Time is injected (`monotonic`), so every decision
is reproducible in a test. The web pod's reader does NOT use this: bar_stream's
default policy keeps its behaviour exactly as it was.
"""
from __future__ import annotations

import os
import time
from typing import Callable

#: Seconds to wait on the 1st, 2nd, ... consecutive `max_connections`.
MAXCONN_LADDER = (30.0, 60.0, 120.0, 300.0, 600.0)
#: A process younger than this (seconds) caps a max_connections wait at YOUNG_CAP_S.
YOUNG_UPTIME_S = 900.0
YOUNG_CAP_S = 60.0
#: Other auth failures (a bad key, an unexpected status): bar_stream's historic wait.
AUTH_FAILURE_S = 60.0
#: The shortest wait before any reconnect after a disconnect or a clean close by the server.
#: `INGEST_RECONNECT_MIN_GAP_S` sets it (default 10, Massive's 10-30 s guidance for ONE
#: connection); it is never under MIN_GAP_FLOOR_S, so a dead endpoint cannot be hammered.
#: With the second stocks connection (2026-11-18) a just-closed session no longer blocks
#: the next one, so stream-ingest runs it at 2 s.
MIN_GAP_FLOOR_S = 1.0


def _min_gap_from_env() -> float:
    raw = os.environ.get("INGEST_RECONNECT_MIN_GAP_S", "").strip()
    try:
        value = float(raw) if raw else 10.0
    except ValueError:
        value = 10.0
    return max(MIN_GAP_FLOOR_S, value)


MIN_GAP_S = _min_gap_from_env()
#: A connection that stayed up this long clears the max_connections strikes.
HEALTHY_S = 120.0


def is_max_connections(text: object) -> bool:
    return "max_connections" in str(text or "")


class MaxConnLadder:
    """The reconnect policy bar_stream._run_websocket asks for its waits (see module doc)."""

    def __init__(self, *, ladder=MAXCONN_LADDER, young_uptime_s: float = YOUNG_UPTIME_S,
                 young_cap_s: float = YOUNG_CAP_S, auth_failure_s: float = AUTH_FAILURE_S,
                 min_gap_s: float = MIN_GAP_S, healthy_s: float = HEALTHY_S,
                 monotonic: Callable[[], float] = time.monotonic):
        if not ladder or min(ladder) < 30.0 or young_cap_s < 30.0:
            raise ValueError("no max_connections wait may be under 30 s (Massive guidance)")
        self.ladder = tuple(float(x) for x in ladder)
        self.young_uptime_s = float(young_uptime_s)
        self.young_cap_s = float(young_cap_s)
        self.auth_failure_s = float(auth_failure_s)
        self.min_gap_s = float(min_gap_s)
        self.healthy_s = float(healthy_s)
        self._up_since = None       # monotonic time the current connection authenticated
        self._kicked = False        # a max_connections status arrived on the current connection
        self._mono = monotonic
        self.started = monotonic()
        self.strikes = 0            # consecutive max_connections since the last auth_success
        self.maxconn_total = 0
        self.connects = 0           # connections that authenticated
        self.last_wait_s = None
        self.last_reason = None
        self.on_connected: Callable[[int], None] = lambda n: None

    # -- the three questions bar_stream asks --

    def connected(self, notify: bool = True) -> None:
        """A connection authenticated. `on_connected(n)` is told which connection
        this is (1 = first, 2+ = a reconnect). The strikes are NOT reset here (see
        module doc): `_settle` resets them once this connection proved healthy.
        `notify=False` (HOT STANDBY, bar_stream): the other connection was delivering
        the whole time, so nothing was missed and nothing is re-seeded."""
        self.connects += 1
        self._up_since = self._mono()
        self._kicked = False
        if notify:
            self.on_connected(self.connects)

    def note_status(self, status: object) -> None:
        """A non-routine status frame while streaming (bar_stream's frame loop)."""
        if is_max_connections(status):
            self._kicked = True

    def auth_failed_delay(self, status: object) -> float:
        self._settle()
        if is_max_connections(status):
            return self._maxconn("auth: max_connections")
        return self._wait(self.auth_failure_s, f"auth failed: {str(status)[:80]}")

    def disconnect_delay(self, err: BaseException, backoff: float) -> float:
        kicked = self._take_kick() or is_max_connections(err)
        self._settle(kicked)
        if kicked:
            return self._maxconn("disconnect: max_connections")
        return self._wait(max(float(backoff), self.min_gap_s), f"disconnect: {type(err).__name__}")

    def normal_close_delay(self) -> float:
        kicked = self._take_kick()
        self._settle(kicked)
        if kicked:
            return self._maxconn("closed: max_connections")
        return self._wait(self.min_gap_s, "closed by the server")

    # -- internals --

    def _settle(self, kicked: bool = False) -> None:
        """The connection that just ended: if it stayed up healthy_s AND did not end in
        a kick, strikes reset. (A kicked connection proves nothing: two sockets that
        kick each other each survive as long as the other one waits, which reaches
        healthy_s on the higher rungs.)"""
        if (not kicked and self._up_since is not None
                and self._mono() - self._up_since >= self.healthy_s):
            self.strikes = 0
        self._up_since = None

    def _take_kick(self) -> bool:
        k, self._kicked = self._kicked, False
        return k

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
