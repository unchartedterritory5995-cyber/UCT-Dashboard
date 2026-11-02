"""The DataEnvelope — contract MD-1 (docs/agent/program/contracts/MD-1-market-data.md).

Every Agent market-data answer is one of these. Building it through `make_envelope` and checking it
with `validate_envelope` is how adapters, the gateway and QA's conformance suite agree on one shape.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Optional

CONTRACT = "MD-1.0"

#: How current the DATA is (not the fetch):
#:   live        streaming or polled within seconds of the market (e.g. quotes during the session)
#:   delayed     a known feed delay (`delay_s` says how long)
#:   periodic    recomputed on a schedule (breadth, NH/NL, themes, screener rows)
#:   historical  a completed past period (a closed session's bars)
#:   unavailable nothing trustworthy to return
FRESHNESS = ("live", "delayed", "periodic", "historical", "unavailable")
STATUS = ("ok", "partial", "unavailable", "refused")
PURPOSES = ("answer", "scan", "research")

_REQUIRED = ("contract", "kind", "params_echo", "status", "freshness", "as_of", "fetched_at", "delay_s",
             "stale", "source", "coverage", "data", "notes", "provider_calls")


def utc_iso(dt: Optional[datetime] = None) -> str:
    """ISO-8601 UTC with a trailing Z, second precision."""
    d = (dt or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return d.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def make_envelope(kind: str, params: Any, *, status: str, freshness: str, as_of: Optional[str], source: str,
                  data: Any = None, delay_s: Optional[float] = None, stale: bool = False,
                  coverage: Optional[dict] = None, notes: Iterable[str] = (), provider_calls: int = 0) -> dict:
    """One DataEnvelope. `as_of` is the DATA's source time (ISO-8601 UTC) or None when the source has none —
    then `notes` must say so (validate_envelope enforces it). `provider_calls` is how many UNDERLYING
    provider requests this read caused (cache hits are 0); the gateway's turn budget counts it."""
    return {
        "contract": CONTRACT, "kind": kind, "params_echo": params, "status": status, "freshness": freshness,
        "as_of": as_of, "fetched_at": utc_iso(), "delay_s": delay_s, "stale": bool(stale), "source": source,
        "coverage": coverage, "data": data, "notes": list(notes), "provider_calls": int(provider_calls),
    }


def refused(kind: str, params: Any, reason: str) -> dict:
    """The gateway's own answer when it will not read: disabled, unknown kind, over budget, bad request."""
    return make_envelope(kind, params, status="refused", freshness="unavailable", as_of=None, source="uct-agent-gateway",
                         notes=[reason])


def unavailable(kind: str, params: Any, source: str, note: str, provider_calls: int = 0) -> dict:
    """The source could not answer (error, no data). Never a guess."""
    return make_envelope(kind, params, status="unavailable", freshness="unavailable", as_of=None, source=source,
                         notes=[note], provider_calls=provider_calls)


def _iso_utc(v: Any) -> bool:
    if not isinstance(v, str) or not v.endswith("Z"):
        return False
    try:
        datetime.fromisoformat(v.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def validate_envelope(env: Any) -> list[str]:
    """Contract violations (empty list = conforms). Used by the gateway before anything leaves the server
    and by QA's conformance suite against every kind."""
    if not isinstance(env, dict):
        return ["not an object"]
    errs = [f"missing {k}" for k in _REQUIRED if k not in env]
    if errs:
        return errs
    if env["contract"] != CONTRACT:
        errs.append(f"contract {env['contract']!r} != {CONTRACT}")
    if env["status"] not in STATUS:
        errs.append(f"status {env['status']!r}")
    if env["freshness"] not in FRESHNESS:
        errs.append(f"freshness {env['freshness']!r}")
    if not _iso_utc(env["fetched_at"]):
        errs.append("fetched_at is not ISO-8601 UTC")
    if env["as_of"] is not None and not _iso_utc(env["as_of"]):
        errs.append("as_of is not ISO-8601 UTC")
    if not isinstance(env["notes"], list) or not all(isinstance(n, str) for n in env["notes"]):
        errs.append("notes must be a list of strings")
    if not isinstance(env["source"], str) or not env["source"]:
        errs.append("source is required")
    if not isinstance(env["provider_calls"], int) or env["provider_calls"] < 0:
        errs.append("provider_calls must be a non-negative int")
    if "isolated" in env and env["isolated"] is not True:
        errs.append("isolated, when present, must be true (ADR-005 L2)")
    if env["status"] in ("ok", "partial"):
        if env["freshness"] == "unavailable":
            errs.append("an ok/partial read cannot be freshness 'unavailable'")
        if env["as_of"] is None and not env["notes"]:
            errs.append("as_of is null without a note saying why")
        if env["freshness"] == "delayed" and not isinstance(env["delay_s"], (int, float)):
            errs.append("delayed data must give delay_s")
    else:
        if env["freshness"] != "unavailable":
            errs.append("an unavailable/refused read must be freshness 'unavailable'")
        if env["data"] is not None:
            errs.append("an unavailable/refused read carries no data")
        if not env["notes"]:
            errs.append("an unavailable/refused read must say why in notes")
    return errs
