"""FakeAdapter -- a scripted adapter for tests (scheduler / ingest / service).

NOT registered in the global adapter registry (so it can never satisfy the
registry's "adapter exists" rail); construct it directly, or call
``register_fake()`` inside a test and ``unregister`` afterwards.

SCRIPT FORMAT -- ``FakeAdapter(script=[step, step, ...])``; each ``fetch()``
call consumes ONE step, in order:

  FetchResult                  -> returned as ``[result]``
  list[FetchResult]            -> returned as-is
  BaseException instance/class -> raised (e.g. ``SourceUnavailable("503 x5")``,
                                  ``MalformedPayload("bad json")``)
  callable(specs, mode, start, end, http) -> its return value (or it raises)
  dict shorthand:
      {"observations": [("USCPI", "2026-08-01", "2026-08-31", 321.5, "p"), ...],
       "status": 200, "request_key": "fake:USCPI", "not_modified": False,
       "source_published_at": None, "warnings": [], "payload": b"..."}
        observation tuples are (series_id, period_start, period_end, value[, flag
        [, source_published_at]]) or RawObs instances; value None = provider NA.
      {"raise": "source_unavailable" | "malformed" | "validation",
       "message": "..."}         -> raises the matching model error
      {"not_modified": True}     -> a single 304-style FetchResult, no observations

``script`` may also be a dict ``{symbol: [steps]}``: then each fetch() consumes
one step per REQUESTED symbol and concatenates results (a raising step raises).

When the script is exhausted: ``on_exhausted="raise"`` (default, AssertionError
-- an unexpected extra call is a test failure), ``"repeat"`` (repeat the last
step) or ``"empty"`` (return ``[]``).

Every call is recorded in ``.calls`` as ``(symbols, mode, start, end)``.
"""
from __future__ import annotations

from typing import Any, Optional

from ..model import FetchResult, MalformedPayload, RawObs, SourceUnavailable, ValidationFailed
from .base import BaseAdapter, as_specs, register


class FakeAdapter(BaseAdapter):
    name = "fake"
    key_env = None
    max_series_per_request = 50

    def __init__(self, script=None, *, name: str = "fake", max_series_per_request: int = 50,
                 on_exhausted: str = "raise"):
        self.name = name
        self.max_series_per_request = max_series_per_request
        self.on_exhausted = on_exhausted
        self.calls: list[tuple] = []
        if isinstance(script, dict):
            self._by_symbol = {k: list(v) for k, v in script.items()}
            self._steps = None
        else:
            self._by_symbol = None
            self._steps = list(script or [])
        self._last: dict[Any, Any] = {}

    # ------------------------------------------------------------------ script
    def push(self, *steps, symbol: Optional[str] = None) -> None:
        if symbol is not None:
            if self._by_symbol is None:
                raise ValueError("script is a list; push without symbol")
            self._by_symbol.setdefault(symbol, []).extend(steps)
        else:
            if self._steps is None:
                raise ValueError("script is per-symbol; pass symbol=")
            self._steps.extend(steps)

    @property
    def remaining(self) -> int:
        if self._steps is not None:
            return len(self._steps)
        return sum(len(v) for v in self._by_symbol.values())

    def _next(self, queue: list, slot) -> Any:
        if queue:
            step = queue.pop(0)
            self._last[slot] = step
            return step
        if self.on_exhausted == "repeat" and slot in self._last:
            return self._last[slot]
        if self.on_exhausted == "empty":
            return []
        raise AssertionError(f"FakeAdapter {self.name}: script exhausted ({slot})")

    def _run(self, step, specs, mode, start, end, http) -> list[FetchResult]:
        if isinstance(step, FetchResult):
            return [step]
        if isinstance(step, list):
            return list(step)
        if isinstance(step, BaseException):
            raise step
        if isinstance(step, type) and issubclass(step, BaseException):
            raise step("scripted failure")
        if isinstance(step, dict):
            return [self._from_dict(step, specs)] if "raise" not in step else self._raise(step)
        if callable(step):
            return step(specs, mode, start, end, http)
        raise TypeError(f"FakeAdapter: bad script step {step!r}")

    @staticmethod
    def _raise(step: dict):
        kind = step["raise"]
        msg = step.get("message", f"scripted {kind}")
        if kind == "source_unavailable":
            raise SourceUnavailable(msg)
        if kind == "malformed":
            raise MalformedPayload(msg)
        if kind == "validation":
            raise ValidationFailed(step.get("series_id", "?"), [msg])
        raise ValueError(f"unknown raise kind {kind!r}")

    def _from_dict(self, step: dict, specs) -> FetchResult:
        obs = []
        for o in step.get("observations", []):
            obs.append(o if isinstance(o, RawObs) else RawObs(*o))
        rk = step.get("request_key") or f"{self.name}:" + ",".join(s.symbol for s in specs)
        payload = step.get("payload")
        res = self.make_result(rk, obs, payload=payload,
                               source_published_at=step.get("source_published_at"),
                               warnings=step.get("warnings"),
                               http_status=step.get("status", 304 if step.get("not_modified") else 200))
        res.not_modified = bool(step.get("not_modified", False))
        return res

    # ------------------------------------------------------------------ Adapter
    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None) -> list[FetchResult]:
        specs = as_specs(specs)
        self.calls.append((tuple(s.symbol for s in specs), mode, start, end))
        if self._steps is not None:
            return self._run(self._next(self._steps, None), specs, mode, start, end, http)
        out: list[FetchResult] = []
        for s in specs:
            q = self._by_symbol.setdefault(s.symbol, [])
            out.extend(self._run(self._next(q, s.symbol), [s], mode, start, end, http))
        return out


def register_fake(adapter_cls=FakeAdapter):
    """Register the fake under its name for a test. Pair with ``unregister("fake")``."""
    return register(adapter_cls)
