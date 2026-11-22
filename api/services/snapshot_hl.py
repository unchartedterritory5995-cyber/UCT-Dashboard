"""The whole-market high/low snapshot: its row rule, and a helper process that fetches and parses it.

WHY A HELPER PROCESS
--------------------
From 04:00 to 20:00 ET the live scanners (`nhnl_live`, `volume_live`, `scatter`, `todaypack`,
`theme_index`) share ONE whole-market pull every ~2 seconds
(`massive.get_full_market_snapshot_hl_cached`). Measured in the web pod on 2026-11-16: the answer
is 5.8 MB for 13,236 tickers and one pull costs ~180 ms of CPU, of which ~100 ms is a single JSON
parse that holds the interpreter lock without a break. `web` is one process with one event loop, so
every member's request waits behind that parse: the request-timing layer shows event-loop lag
averaging ~5 ms while the scanners are idle and ~25 ms once they start.

With `SNAPSHOT_CHILD_ENABLED=1` the download, the parse and the per-ticker reduction happen in a
small child process (its own interpreter lock). It hands back twelve packed columns; the web
process only rebuilds the dicts, in a plain loop the event loop can interrupt. The answer is the
same dict, built by the same `row()` rule: there is ONE rule and both paths call it.

FAILURE RULES
-------------
* The vendor fails (timeout, 5xx, bad body): the child answers "fetch error" and the caller gets
  `{}`, exactly what the in-process path returns. No second pull.
* The helper itself fails (cannot start, dies, does not answer in time, breaks the framing):
  `ChildUnavailable`. The caller falls back to the in-process path, and the helper is not tried
  again for `RETRY_AFTER_S`, so a broken helper cannot become a spawn storm.
* Switch unset / 0: the helper is never started. Nothing changes.

The request URL carries the vendor key. It travels to the child on its stdin (never argv, never the
environment), and the child never prints an exception message, only its type.

This file is ALSO the child's program (`python -I snapshot_hl.py --child`), so it imports the
standard library only at module level and nothing from `api`.
"""
from __future__ import annotations

import array
import os
import queue
import struct
import subprocess
import sys
import threading
import time

ENV = "SNAPSHOT_CHILD_ENABLED"
#: Longest the web process waits for one answer. The child's own read timeout is 25 s.
ANSWER_TIMEOUT_S = 40.0
#: After the helper fails, the in-process path serves for this long before the helper is retried.
RETRY_AFTER_S = 60.0

#: Column order on the wire. The dict key order of a row is ROW_KEYS (the order callers always saw).
FLOAT_KEYS = ("last_price", "prev_close", "day_high", "day_low", "day_open", "day_c", "min_c", "last_trade_p")
INT_KEYS = ("prev_vol", "today_vol", "min_av", "min_v")
ROW_KEYS = ("last_price", "prev_close", "prev_vol", "today_vol", "day_high", "day_low", "day_open", "day_c",
            "min_c", "last_trade_p", "min_av", "min_v")

_OK, _FETCH_ERROR = 0, 1


class ChildUnavailable(Exception):
    """The helper process could not answer. Use the in-process path."""


def enabled() -> bool:
    return os.environ.get(ENV, "0").strip().lower() in ("1", "true", "yes", "on")


# ── the one row rule ──────────────────────────────────────────────────────────

def row(t: dict) -> dict:
    """One vendor ticker object -> the row every consumer reads.

      last_price    lastTrade.p (session-aware) -> day.c -> prevDay.c
      prev_close    prevDay.c
      prev_vol      prevDay.v (stable liquidity, for the tradability floor)
      today_vol     day.v
      day_high/low  day.h / day.l (today's RTH running high/low; 0 pre-open)
      day_open      day.o
      day_c         day.c (RTH close, for the ext-price staleness check)
      min_c         min.c (current minute close; extended-session aware)
      last_trade_p  raw lastTrade.p (ext-hours print)
      min_av        min.av, accumulated volume for the CURRENT day: grows across pre/RTH/post
                    (unlike day.v, which is RTH-only), so a rate off it works in every session
      min_v         min.v, the last minute's volume
    """
    day = t.get("day", {})
    prev_day = t.get("prevDay", {})
    last = t.get("lastTrade", {})
    minute = t.get("min", {})
    last_price = float(last.get("p") or day.get("c") or prev_day.get("c") or 0.0)
    return {
        "last_price": round(last_price, 4),
        "prev_close": round(float(prev_day.get("c") or 0.0), 4),
        "prev_vol": int(prev_day.get("v") or 0),
        "today_vol": int(day.get("v") or 0),
        "day_high": round(float(day.get("h") or 0.0), 4),
        "day_low": round(float(day.get("l") or 0.0), 4),
        "day_open": round(float(day.get("o") or 0.0), 4),
        "day_c": round(float(day.get("c") or 0.0), 4),
        "min_c": round(float(minute.get("c") or 0.0), 4),
        "last_trade_p": round(float(last.get("p") or 0.0), 4),
        "min_av": int(minute.get("av") or 0),
        "min_v": int(minute.get("v") or 0),
    }


def rows_from_payload(data: dict) -> dict:
    """The vendor's parsed answer -> {provider ticker: row}. Tickers with no name are skipped."""
    out: dict = {}
    for t in data.get("tickers", []):
        ticker = t.get("ticker", "")
        if not ticker:
            continue
        out[ticker] = row(t)
    return out


# ── the wire: twelve packed columns ───────────────────────────────────────────

def pack(rows: dict) -> bytes:
    names = list(rows)
    blob = "\n".join(names).encode("utf-8")
    parts = [struct.pack("<II", len(names), len(blob)), blob]
    for key in FLOAT_KEYS:
        parts.append(array.array("d", [rows[n][key] for n in names]).tobytes())
    for key in INT_KEYS:
        parts.append(array.array("q", [rows[n][key] for n in names]).tobytes())
    return b"".join(parts)


def unpack(buf: bytes) -> dict:
    n, blob_len = struct.unpack_from("<II", buf, 0)
    if n == 0:
        return {}
    off = 8
    names = buf[off:off + blob_len].decode("utf-8").split("\n")
    off += blob_len
    width = 8 * n
    if len(names) != n or len(buf) != off + width * (len(FLOAT_KEYS) + len(INT_KEYS)):
        raise ValueError("snapshot frame does not match its own header")
    cols: dict = {}
    for key, code in [(k, "d") for k in FLOAT_KEYS] + [(k, "q") for k in INT_KEYS]:
        a = array.array(code)
        a.frombytes(buf[off:off + width])
        cols[key] = a
        off += width
    ordered = [cols[k] for k in ROW_KEYS]
    out: dict = {}
    # A plain loop on purpose: the interpreter can hand the lock to the event loop between rows.
    for name, values in zip(names, zip(*ordered)):
        out[name] = dict(zip(ROW_KEYS, values))
    return out


# ── the parent side ───────────────────────────────────────────────────────────

_lock = threading.Lock()          # one request at a time, and guards _child / _retry_at
_child: "_Child | None" = None
_retry_at = 0.0
_stats = {"ok": 0, "fetch_errors": 0, "unavailable": 0, "spawns": 0, "last_ms": None, "last_rows": None,
          "last_problem": None}
#: Tests point this at a pipe to read what the child writes to stderr. None = inherit (the pod log).
_child_stderr = None


def _command() -> list:
    # -I: isolated. Neither this file's directory (api/services, which holds modules named like
    # standard-library ones) nor PYTHONPATH reaches the child's import path.
    return [sys.executable, "-I", os.path.abspath(__file__), "--child"]


class _Child:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=_child_stderr, bufsize=0)
        self.answers: "queue.Queue" = queue.Queue()
        threading.Thread(target=self._read, name="snapshot-child-reader", daemon=True).start()

    def _read_exact(self, n: int) -> bytes:
        chunks, got = [], 0
        while got < n:
            chunk = self.proc.stdout.read(n - got)
            if not chunk:
                raise EOFError
            chunks.append(chunk)
            got += len(chunk)
        return b"".join(chunks)

    def _read(self) -> None:
        try:
            while True:
                status, size = struct.unpack("<BI", self._read_exact(5))
                self.answers.put((status, self._read_exact(size) if size else b""))
        except Exception:
            self.answers.put(None)   # the child is gone or the framing broke

    def ask(self, url: str, timeout: float):
        self.proc.stdin.write(url.encode("utf-8") + b"\n")
        self.proc.stdin.flush()
        return self.answers.get(timeout=timeout)

    def kill(self) -> None:
        try:
            self.proc.kill()
        except Exception:
            pass
        for pipe in (self.proc.stdin, self.proc.stdout):
            try:
                pipe.close()
            except Exception:
                pass


def _fail(problem: str) -> "ChildUnavailable":
    """Under _lock: drop the helper and start the retry clock."""
    global _child, _retry_at
    if _child is not None:
        _child.kill()
        _child = None
    _retry_at = time.monotonic() + RETRY_AFTER_S
    _stats["unavailable"] += 1
    _stats["last_problem"] = problem
    return ChildUnavailable(problem)


def fetch_rows(url: str, timeout: float | None = None) -> dict:
    """The snapshot rows, fetched and parsed in the helper process.

    Returns `{}` when the VENDOR failed (same as the in-process path). Raises `ChildUnavailable`
    when the HELPER failed; the caller then uses the in-process path.
    """
    global _child
    timeout = ANSWER_TIMEOUT_S if timeout is None else timeout
    with _lock:
        if time.monotonic() < _retry_at:
            raise ChildUnavailable("waiting to retry")
        started = time.monotonic()
        try:
            if _child is None:
                _child = _Child()
                _stats["spawns"] += 1
            answer = _child.ask(url, timeout)
        except queue.Empty:
            raise _fail("no answer in %.0f s" % timeout) from None
        except Exception as e:  # cannot start, broken pipe
            raise _fail("cannot reach helper: %s" % type(e).__name__) from None
        if answer is None:
            raise _fail("helper exited")
        status, payload = answer
        if status == _FETCH_ERROR:
            _stats["fetch_errors"] += 1
            return {}
        try:
            rows = unpack(payload)
        except Exception as e:
            raise _fail("bad frame: %s" % type(e).__name__) from None
        _stats["ok"] += 1
        _stats["last_ms"] = round((time.monotonic() - started) * 1000, 1)
        _stats["last_rows"] = len(rows)
        return rows


def stats() -> dict:
    with _lock:
        return {"enabled": enabled(), "running": _child is not None and _child.proc.poll() is None, **_stats}


def stop() -> None:
    """Stop the helper (tests, shutdown). The next fetch starts a new one."""
    global _child, _retry_at
    with _lock:
        if _child is not None:
            _child.kill()
            _child = None
        _retry_at = 0.0


def _reset_for_tests() -> None:
    stop()
    for key in _stats:
        _stats[key] = 0 if key in ("ok", "fetch_errors", "unavailable", "spawns") else None


# ── the child ─────────────────────────────────────────────────────────────────

def _make_get():
    """bytes of one GET, on a kept-alive connection when httpx is installed."""
    try:
        import httpx
        client = httpx.Client(timeout=httpx.Timeout(connect=3.0, read=25.0, write=5.0, pool=10.0),
                              headers={"Accept": "application/json"})

        def get(url: str) -> bytes:
            resp = client.get(url)
            resp.raise_for_status()
            return resp.content
    except ImportError:
        import urllib.request

        def get(url: str) -> bytes:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=25.0) as resp:
                return resp.read()
    return get


def _make_loads():
    try:
        import orjson
        return orjson.loads
    except ImportError:
        import json
        return json.loads


def _answer(url: str, get, loads) -> tuple:
    """One request, as the child serves it: (status, frame, line for stderr or None)."""
    try:
        return _OK, pack(rows_from_payload(loads(get(url)))), None
    except Exception as e:
        # Never the message: an HTTP error's text contains the URL, and the URL carries the key.
        return _FETCH_ERROR, b"", "[snapshot-child] fetch failed: %s\n" % type(e).__name__


def _child_main() -> None:
    # The answer pipe is a private copy of stdout; anything a library prints goes to stderr instead
    # and cannot corrupt the framing.
    out = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)
    get, loads = _make_get(), _make_loads()
    stdin = sys.stdin.buffer
    while True:
        line = stdin.readline()
        if not line:
            return   # the web process is gone
        status, payload, problem = _answer(line.decode("utf-8").strip(), get, loads)
        if problem:
            sys.stderr.write(problem)
            sys.stderr.flush()
        out.write(struct.pack("<BI", status, len(payload)))
        out.write(payload)
        out.flush()


if __name__ == "__main__" and "--child" in sys.argv:
    _child_main()
