"""The MD-1 gateway: one door for every Agent market-data read (contract MD-1).

  read(kind, params, user_id=…, turn_id=…, purpose=…) -> DataEnvelope

* DARK: refused unless UCT_AGENT_DATA=1; kinds in the "scan" category also need UCT_AGENT_SCAN=1.
* KINDS are registered by their owners' modules, loaded once on first use (REGISTRARS below):
  api/services/uct_agent/marketdata/kinds.py (agent-md) and api/services/uct_agent/scan/kinds.py (agent-sc).
  Neither owner edits this file to add a kind.
* TURN BUDGET — counts BOTH (MD-1 §5):
    logical reads    every gateway read in one Agent turn            (MAX_READS_PER_TURN)
    scan reads       reads of a "scan"-category kind in one turn       (MAX_SCANS_PER_TURN)
    provider calls   underlying upstream requests those reads caused   (MAX_PROVIDER_CALLS_PER_TURN)
                     — reported by each adapter in `provider_calls`; cache hits are 0
  A logical read is admitted (and counted) before it runs; provider calls are counted from its
  envelope. Once any limit is reached, further reads in that turn are refused, never partially run.
  These limits sit UNDER the existing caps: they add no model call and change no $ budget
  (budget.py's $5/day Agent cap and the shared $15 ledger are untouched).
* Every envelope is validated (envelope.validate_envelope) before it leaves; an adapter that breaks the
  contract is answered `unavailable`, never passed through.
"""
from __future__ import annotations

import importlib
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from api.services.uct_agent.marketdata import envelope as env

log = logging.getLogger("uct_agent.data")

DATA_ENV = "UCT_AGENT_DATA"
SCAN_ENV = "UCT_AGENT_SCAN"

MAX_READS_PER_TURN = 8
MAX_SCANS_PER_TURN = 1
MAX_PROVIDER_CALLS_PER_TURN = 20
MAX_SYMBOLS_PER_READ = 50
TURN_TTL_S = 600

#: Modules whose `register(registry)` adds kinds. A missing module registers nothing.
REGISTRARS = ("api.services.uct_agent.marketdata.kinds", "api.services.uct_agent.scan.kinds")
CATEGORIES = ("market", "scan")


def data_enabled() -> bool:
    return os.environ.get(DATA_ENV, "").strip() == "1"


def scan_enabled() -> bool:
    return data_enabled() and os.environ.get(SCAN_ENV, "").strip() == "1"


@dataclass(frozen=True)
class Kind:
    name: str
    fn: Callable[[dict, dict], dict]        # (params, ctx) -> DataEnvelope
    freshness: str                          # the class this kind declares (MD-1 §3)
    category: str = "market"                # "market" | "scan"
    owner: str = "agent-md"
    max_symbols: int = MAX_SYMBOLS_PER_READ
    description: str = ""


@dataclass
class _Turn:
    reads: int = 0
    scans: int = 0
    provider_calls: int = 0
    at: float = field(default_factory=time.time)


class Registry:
    def __init__(self) -> None:
        self._kinds: dict[str, Kind] = {}

    def register(self, kind: Kind) -> None:
        if kind.name in self._kinds:
            raise ValueError(f"kind {kind.name!r} is already registered (by {self._kinds[kind.name].owner})")
        if kind.freshness not in env.FRESHNESS or kind.freshness == "unavailable":
            raise ValueError(f"kind {kind.name!r} declares freshness {kind.freshness!r}")
        if kind.category not in CATEGORIES:
            raise ValueError(f"kind {kind.name!r} has category {kind.category!r}")
        self._kinds[kind.name] = kind

    def get(self, name: str) -> Optional[Kind]:
        return self._kinds.get(name)

    def names(self) -> list[str]:
        return sorted(self._kinds)


_registry: Optional[Registry] = None
_lock = threading.Lock()
_turns: dict[tuple[Any, str], _Turn] = {}


def registry() -> Registry:
    global _registry
    with _lock:
        if _registry is None:
            r = Registry()
            for mod in REGISTRARS:
                try:
                    m = importlib.import_module(mod)
                except ModuleNotFoundError as e:
                    if e.name != mod:
                        raise
                    continue
                reg = getattr(m, "register", None)
                if callable(reg):
                    reg(r)
            _registry = r
        return _registry


def _turn(user_id: Any, turn_id: str) -> _Turn:
    now = time.time()
    for k in [k for k, t in _turns.items() if now - t.at > TURN_TTL_S]:
        _turns.pop(k, None)
    return _turns.setdefault((user_id, turn_id), _Turn())


def _symbols_in(params: Any) -> int:
    if not isinstance(params, dict):
        return 0
    syms = params.get("symbols")
    if isinstance(syms, list):
        return len(syms)
    return 1 if params.get("symbol") else 0


def read(kind: str, params: Any = None, *, user_id: Any, turn_id: str, purpose: str = "answer") -> dict:
    """One gateway read -> a validated DataEnvelope. Never raises for a bad request or a source error."""
    params = params if isinstance(params, dict) else {}
    if not data_enabled():
        return env.refused(kind, params, "the Agent data gateway is off (UCT_AGENT_DATA)")
    if purpose not in env.PURPOSES:
        return env.refused(kind, params, f"unknown purpose {purpose!r}")
    if not isinstance(turn_id, str) or not turn_id.strip() or len(turn_id) > 80:
        return env.refused(kind, params, "a turn id is required")
    k = registry().get(kind)
    if k is None:
        return env.refused(kind, params, f"unknown kind {kind!r}")
    if k.category == "scan" and not scan_enabled():
        return env.refused(kind, params, "Agent scans are off (UCT_AGENT_SCAN)")
    if _symbols_in(params) > k.max_symbols:
        return env.refused(kind, params, f"at most {k.max_symbols} symbols per read")
    with _lock:
        t = _turn(user_id, turn_id)
        if t.reads >= MAX_READS_PER_TURN:
            return env.refused(kind, params, f"this turn already made {MAX_READS_PER_TURN} data reads")
        if k.category == "scan" and t.scans >= MAX_SCANS_PER_TURN:
            return env.refused(kind, params, f"this turn already ran {MAX_SCANS_PER_TURN} scan")
        if t.provider_calls >= MAX_PROVIDER_CALLS_PER_TURN:
            return env.refused(kind, params, f"this turn reached {MAX_PROVIDER_CALLS_PER_TURN} provider requests")
        t.reads += 1
        if k.category == "scan":
            t.scans += 1
    try:
        out = k.fn(params, {"user_id": user_id, "turn_id": turn_id, "purpose": purpose})
    except Exception as e:  # noqa: BLE001 — a source failure is an honest "unavailable", never a crash
        log.warning("uct_agent.data kind=%s failed: %s", kind, type(e).__name__)
        out = env.unavailable(kind, params, k.owner, "the data source could not answer")
    errs = env.validate_envelope(out)
    if errs:
        log.warning("uct_agent.data kind=%s broke MD-1: %s", kind, "; ".join(errs[:3]))
        out = env.unavailable(kind, params, k.owner, "the data did not meet the Agent data contract")
    elif out.get("status") in ("ok", "partial") and env.FRESHNESS.index(out["freshness"]) < env.FRESHNESS.index(k.freshness):
        # a read may be LESS fresh than its kind declares (e.g. `historical` while the market is closed),
        # never fresher — FRESHNESS is ordered freshest first
        out = env.unavailable(kind, params, k.owner, "the data claimed a fresher class than its kind declares")
    with _lock:
        _turn(user_id, turn_id).provider_calls += int(out.get("provider_calls") or 0)
    return out


def describe() -> list[dict]:
    """The registered kinds (for docs, discovery and QA) — no values."""
    r = registry()
    return [{"kind": n, "freshness": r.get(n).freshness, "category": r.get(n).category, "owner": r.get(n).owner,
             "max_symbols": r.get(n).max_symbols, "description": r.get(n).description} for n in r.names()]


def _reset_for_test(registry_: Optional[Registry] = None) -> None:
    global _registry
    with _lock:
        _registry = registry_
        _turns.clear()
