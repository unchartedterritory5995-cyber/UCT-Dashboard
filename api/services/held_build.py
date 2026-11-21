"""One answer, held in the module that owns it and built by ONE background thread.

This is the hold-and-build machinery of `api/services/treasury_yields.py` (its `_state`, `_held`,
`_build_bg`, `_remember_stop`, `_start_job`, `_block` and `get_yields`), lifted out unchanged in
behaviour so the two reads that sit beside RATES (the real yield curve,
`api/services/treasury_real_yields.py`, and the Treasury auctions, `api/services/treasury_auctions.py`)
follow it exactly instead of each carrying a copy of it. `treasury_yields.py` itself is not moved
onto it: the nominal read keeps its own state, its disk file and its partial-build keeping.

The house rule (builder rule 5, `api/services/scan_period.py`): a member's request NEVER builds. It
gets the answer already held (in memory, or the copy on this server's disk, looked for once per
process), else waits a few seconds on the one build it started, else is told `computing` and the
panel asks again. The shared 1,000-entry cache is never the hand-off.

    held = HeldBuild("auctions-data", build, due, disk=("treasury_auctions", "auctions_v1.json"))
    held.get()   -> the answer, with `check` added, or {"status": "computing" | "unavailable" | "failed", ...}
    held.peek()  -> the answer already held, or None. Never starts a build.

`build(previous)` runs on the background thread and returns `(answer, note)`: the new answer (a
dict; `previous` is the answer held now, or None) and the words for the build's ONE log line (the
status, the requests made, the rows read). It raises `Stop` to say the source refused, failed or
could not be read; any other exception is a `failed` read with reason `error`.

`due(answer, checked)` says whether a request may start a refresh of `answer`, last looked for at
`checked` (epoch seconds: the last look that WORKED, as in treasury_yields). The refresh is never
waited for: the held answer is given at once.

A LOOK THAT DID NOT GO WELL NEVER REPLACES A GOOD ANSWER. With an answer held, the failure is kept
beside it as `check` ({state, reason, http_status, at}) and the source is not asked again until the
stop's `hold` has passed (then `due` decides, exactly as before the failure). With nothing held, the
failure itself is the answer for that long.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

_log = logging.getLogger(__name__)

FAILED_S = 60.0     # a failed build is said briefly, then tried again (treasury_yields.FAILED_S)
WAIT_S = 3.0        # the longest a request waits on the build it started (treasury_yields.WAIT_S)


class Stop(Exception):
    """A build that did not give a usable answer. `state`: 'unavailable' | 'failed'. `hold` is how
    long that stands before the source is asked again. `note` is for the log only."""

    def __init__(self, state: str, reason: Optional[str] = None, http_status: Optional[int] = None,
                 hold: float = FAILED_S, note: str = ""):
        super().__init__(reason or state)
        self.state = state if state in ("unavailable", "failed") else "failed"
        self.reason = reason
        self.http_status = http_status
        self.hold = hold
        self.note = note


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class HeldBuild:
    def __init__(self, name: str, build: Callable[[Optional[dict]], tuple[dict, str]],
                 due: Callable[[dict, float], bool], *, disk: Optional[tuple[str, str]] = None, version: int = 1,
                 wait_s: float = WAIT_S, valid: Optional[Callable[[dict], bool]] = None):
        self.name = name
        self._build = build
        self._due = due
        self._disk = disk
        self._version = version
        self._wait_s = wait_s
        self._valid = valid
        self._lock = threading.Lock()
        self._state: dict[str, Any] = {}
        self.reset()

    # ── state ────────────────────────────────────────────────────────────────────────────────

    def reset(self) -> None:
        """Forget everything held (tests, and nothing else)."""
        with self._lock:
            self._state = {"held": None, "loaded": False, "checked": 0.0, "check": None, "block": None,
                           "retry_at": 0.0, "inflight": None}

    def _path(self) -> Optional[str]:
        if not self._disk:
            return None
        base = os.environ.get("DATA_DIR", "/data")
        return os.path.join(base, self._disk[0], self._disk[1]) if os.path.isdir(base) else None

    def _save(self, held: dict, checked: float) -> None:
        path = self._path()
        if not path:
            return
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            fd, tmp = tempfile.mkstemp(prefix=".held_", suffix=".tmp", dir=os.path.dirname(path))
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    json.dump({"v": self._version, "held": held, "checked": checked}, fh)
                os.replace(tmp, path)
            except Exception:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                raise
        except Exception as exc:  # noqa: BLE001 -- the answer is still held in memory
            _log.warning("[%s] the answer could not be written to disk (%s)", self.name, type(exc).__name__)

    def _load(self) -> tuple[Optional[dict], float]:
        path = self._path()
        if not path:
            return None, 0.0
        try:
            with open(path, "r", encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, ValueError):
            return None, 0.0
        held = doc.get("held") if isinstance(doc, dict) else None
        if not isinstance(held, dict) or doc.get("v") != self._version or (self._valid and not self._valid(held)):
            return None, 0.0
        checked = doc.get("checked")
        checked = float(checked) if isinstance(checked, (int, float)) and not isinstance(checked, bool) else 0.0
        return held, min(checked, time.time())

    def _held(self) -> Optional[dict]:
        with self._lock:
            if self._state["held"] is not None or self._state["loaded"]:
                return self._state["held"]
        held, checked = self._load()
        with self._lock:
            if not self._state["loaded"]:
                self._state["loaded"] = True
                if self._state["held"] is None and held is not None:
                    self._state["held"], self._state["checked"] = held, checked
            return self._state["held"]

    # ── the one build ────────────────────────────────────────────────────────────────────────

    def _run(self, done: threading.Event) -> None:
        started = time.time()
        try:
            with self._lock:
                previous = self._state["held"]
            try:
                got = self._build(previous)
                answer, note = got if isinstance(got, tuple) and len(got) == 2 else (None, "")
                if not isinstance(answer, dict):
                    raise Stop("failed", "error", note="the build gave no answer")
                if self._valid and not self._valid(answer):
                    raise Stop("unavailable", "shape", note="the build's answer is not this module's shape")
            except Stop as stop:
                self._remember(stop, started)
                return
            except Exception as exc:  # noqa: BLE001 -- only the error's class is ever logged
                self._remember(Stop("failed", "error", note=f"failed ({type(exc).__name__})"), started)
                return
            now = time.time()
            with self._lock:
                self._state.update({"held": answer, "checked": now, "check": None, "block": None, "retry_at": 0.0})
            self._save(answer, now)
            _log.info("[%s] %s; %.2fs", self.name, note or "built", time.time() - started)
        finally:
            with self._lock:
                if self._state["inflight"] is done:
                    self._state["inflight"] = None
            done.set()

    def _remember(self, stop: Stop, started: float) -> None:
        """As treasury_yields._remember_stop: the failure is the answer for `hold` when nothing is
        held, else it is said beside the held answer and no new look starts before `hold` passes.
        `checked` is left alone, so the refresh rule decides again once the hold is over."""
        now = time.time()
        said = {"state": stop.state, "reason": stop.reason, "http_status": stop.http_status}
        with self._lock:
            self._state["block"] = (now + stop.hold, {"status": stop.state, **{k: v for k, v in said.items() if k != "state"}})
            self._state["check"] = {**said, "at": now_iso()}
            self._state["retry_at"] = now + stop.hold
        _log.warning("[%s] %s; %.2fs", self.name, stop.note or f"{stop.state} ({stop.reason})", now - started)

    def _start(self) -> threading.Event:
        with self._lock:
            if self._state["inflight"] is not None:
                return self._state["inflight"]
            done = self._state["inflight"] = threading.Event()
        threading.Thread(target=self._run, args=(done,), name=f"{self.name}-build", daemon=True).start()
        return done

    def _block(self) -> Optional[dict]:
        with self._lock:
            block = self._state["block"]
            if block is None:
                return None
            if time.time() >= block[0]:
                self._state["block"] = None
                return None
            return dict(block[1])

    # ── the two reads ────────────────────────────────────────────────────────────────────────

    def peek(self) -> Optional[dict]:
        """READ ONLY: the answer already held (with `check`), or None. It never starts a build."""
        held = self._held()
        if held is None:
            return None
        with self._lock:
            return {**held, "check": self._state["check"]}

    def get(self, *, wait_s: Optional[float] = None) -> dict:
        held = self._held()
        if held is not None:
            with self._lock:
                checked, check, retry_at = self._state["checked"], self._state["check"], self._state["retry_at"]
            try:
                due = time.time() >= retry_at and bool(self._due(held, checked))
            except Exception:  # noqa: BLE001 -- a broken rule must not cost the member the held answer
                due = False
            if due:
                self._start()                      # never waited for: the held answer is given now
            return {**held, "check": check}
        block = self._block()
        if block is not None:
            return block
        done = self._start()
        done.wait(self._wait_s if wait_s is None else wait_s)
        with self._lock:
            held, check = self._state["held"], self._state["check"]
        if held is not None:
            return {**held, "check": check}
        block = self._block()
        return block if block is not None else {"status": "computing"}

    def drain(self, timeout: float = 5.0) -> None:
        """Tests: wait for the build in flight, if any."""
        with self._lock:
            done = self._state["inflight"]
        if done is not None:
            done.wait(timeout)
