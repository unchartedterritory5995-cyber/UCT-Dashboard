"""TERM-060 (FB-I1-02) — a machine-checkable citation pointer per claim.

FB-I1-02: *"Every claim in a generated answer carries a pointer something other
than a human can check."* Half of it is a wire format and half is the data
modelling D2 CP3 already did (``resolver.resolve``). This module is the wire
format and the check; it composes on the resolver and adds no store, no read
path and no status of its own.

THE WIRE FORMAT (``CLAIM_WIRE_VERSION`` 1) — a claim that states a number::

    {"v": 1,
     "pointer":  "uct://breadth_snapshot_numeric.breadth_score/D?as_of=2026-09-25",
     "stated":   72.4,     # the number the prose states
     "decimals": 1}        # the precision it states it to

``pointer`` is an address in the resolver's own grammar
(``uct://metric@entity/tf?as_of=``), built by ``resolver.format_address`` — never
a second copy of the grammar. When its ``as_of`` is a DATE, the claim is about
that session, and a value the store holds for an EARLIER session is not the
value the claim cites.

THE CHECK (``check_claim``) resolves the pointer and returns::

    {"verdict": "verified" | "mismatch" | "unverified",
     "reason":  "match" | "value_differs" | "as_of_differs" | "not_resolved"
                | "not_a_number" | "malformed",
     "status":  one of resolver.STATUSES, ALWAYS — the resolver's own answer,
     "address", "resolved_value", "resolved_as_of", "authority", "detail"}

⛔⛔ ``verified`` HAS EXACTLY ONE ROAD: the resolver said ``resolved``, the
stored value is a number, the stated number is within tolerance of it, and —
when the pointer names a session — the value is FROM that session. Every other
outcome is ``mismatch`` (we read the stored value and the claim disagrees with
it) or ``unverified`` (we could not read one to compare against). An
unresolvable pointer is never ``verified``; a claim is never ``verified``
because the check could not run.

⚠️ THE TOLERANCE IS THE CLAIM'S OWN STATED PRECISION, because the book declares
none. Measured 2026-09-29: ``canonical_address_book.json`` gives every metric
exactly ``store, column, as_of_column, grain, cadence, yields, authority,
sentence`` — no tolerance, no rounding, no display precision — and
``breadth_metrics.py``'s catalogue declares a unit but no decimals. So a claim
says the precision it states (``decimals``) and the check accepts the stored
value when it rounds to the stated one: ``|stated - stored| <= half a unit in
the last stated place``. A claim cannot widen that past ``MAX_DECIMALS`` in
either direction — ``decimals`` below 0 is malformed, so "72" can never be
stated as "about 100".

⛔ NOTHING IS WRITTEN. Like the resolver: no table, no file, no cache.
"""
from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.canonical import resolver

_ET = ZoneInfo("America/New_York")

CLAIM_WIRE_VERSION = 1
MAX_DECIMALS = 6

VERIFIED = "verified"
MISMATCH = "mismatch"
UNVERIFIED = "unverified"
VERDICTS = (VERIFIED, MISMATCH, UNVERIFIED)

REASON_MATCH = "match"
REASON_VALUE_DIFFERS = "value_differs"
REASON_AS_OF_DIFFERS = "as_of_differs"
REASON_NOT_RESOLVED = "not_resolved"
REASON_NOT_A_NUMBER = "not_a_number"
REASON_MALFORMED = "malformed"
REASONS = (REASON_MATCH, REASON_VALUE_DIFFERS, REASON_AS_OF_DIFFERS,
           REASON_NOT_RESOLVED, REASON_NOT_A_NUMBER, REASON_MALFORMED)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def stated_decimals(stated: Any) -> Optional[int]:
    """The decimals a number states: ``72.4`` -> 1, ``80.0`` -> 0, ``3`` -> 0.
    None for anything that is not a finite number. Capped at ``MAX_DECIMALS``
    (a float's repr can carry noise past what anybody stated)."""
    if isinstance(stated, bool) or not isinstance(stated, (int, float)):
        return None
    if not math.isfinite(float(stated)):
        return None
    if isinstance(stated, int):
        return 0
    text = repr(float(stated))
    if "e" in text or "E" in text:
        return MAX_DECIMALS
    frac = text.partition(".")[2].rstrip("0")
    return min(len(frac), MAX_DECIMALS)


def make_claim(metric: str, stated: Any, *, decimals: Optional[int] = None,
               entity: Optional[str] = None, tf: Optional[str] = None,
               as_of: Optional[str] = None) -> dict:
    """A claim on the wire. ``decimals`` defaults to the precision ``stated``
    itself carries. The pointer comes from the resolver's own grammar."""
    return {
        "v": CLAIM_WIRE_VERSION,
        "pointer": resolver.format_address(metric, entity=entity, tf=tf, as_of=as_of),
        "stated": stated,
        "decimals": stated_decimals(stated) if decimals is None else decimals,
    }


def _malformed(claim: Any) -> Optional[str]:
    """Why a claim is not well-formed, or None. Checked BEFORE any number is
    compared, so a malformed claim can never reach ``verified``."""
    if not isinstance(claim, dict):
        return "a claim is an object"
    if claim.get("v") != CLAIM_WIRE_VERSION:
        return f"unknown claim wire version {claim.get('v')!r}"
    if not isinstance(claim.get("pointer"), str) or resolver.parse_address(claim["pointer"]) is None:
        return f"pointer {claim.get('pointer')!r} is not an address the grammar parses"
    stated = claim.get("stated")
    if isinstance(stated, bool) or not isinstance(stated, (int, float)) or not math.isfinite(float(stated)):
        return f"stated {stated!r} is not a finite number"
    dec = claim.get("decimals")
    if isinstance(dec, bool) or not isinstance(dec, int) or not (0 <= dec <= MAX_DECIMALS):
        return f"decimals {dec!r} is not an integer in 0..{MAX_DECIMALS}"
    if abs(round(float(stated), dec) - float(stated)) > 1e-9 * max(1.0, abs(float(stated))):
        return f"stated {stated!r} carries more precision than its {dec} decimals"
    return None


def _session_of(res: resolver.Resolution) -> Optional[str]:
    """The ET session date the resolved value is from, or None."""
    if res.as_of is None:
        return None
    return datetime.fromtimestamp(res.as_of, tz=_ET).date().isoformat()


def within_tolerance(stated: float, stored: float, decimals: int) -> bool:
    """True when ``stored`` rounds to ``stated`` at ``decimals`` places:
    ``|stated - stored| <= 0.5 * 10**-decimals``, with a relative epsilon so a
    stored 72.45 is not refused over float representation."""
    half = 0.5 * (10.0 ** -decimals)
    eps = 1e-9 * max(1.0, abs(stored))
    return abs(float(stated) - float(stored)) <= half + eps


def check_claim(claim: Any) -> dict:
    """Resolve the claim's pointer and compare. Never raises. ``status`` is
    always the resolver's own status for the pointer (a malformed claim whose
    pointer does not parse gets ``unknown_metric``, exactly what ``resolve``
    answers for an unparseable address)."""
    pointer = claim.get("pointer") if isinstance(claim, dict) else None
    res = resolver.resolve(pointer if isinstance(pointer, str) else "")
    out = {
        "verdict": UNVERIFIED, "reason": REASON_NOT_RESOLVED, "status": res.status,
        "address": res.address, "resolved_value": None,
        "resolved_as_of": _session_of(res) if res.status == resolver.RESOLVED else None,
        "authority": res.authority, "detail": res.detail,
    }
    why = _malformed(claim)
    if why is not None:
        out.update(reason=REASON_MALFORMED, detail=f"the claim is malformed: {why}")
        return out
    if res.status != resolver.RESOLVED:
        return out
    value = res.value
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        out.update(reason=REASON_NOT_A_NUMBER,
                   detail=f"the stored value {value!r} is not a number a stated figure can match")
        return out
    out["resolved_value"] = value
    ask = resolver.parse_address(claim["pointer"]).get("as_of")
    if ask and _DATE_RE.match(ask) and out["resolved_as_of"] != ask:
        out.update(verdict=MISMATCH, reason=REASON_AS_OF_DIFFERS,
                   detail=(f"the claim cites the {ask} session and the newest stored value at or "
                           f"before it is from {out['resolved_as_of']}"))
        return out
    if not within_tolerance(claim["stated"], value, claim["decimals"]):
        out.update(verdict=MISMATCH, reason=REASON_VALUE_DIFFERS,
                   detail=(f"stated {claim['stated']!r} at {claim['decimals']} decimals; "
                           f"the stored value is {value!r}"))
        return out
    out.update(verdict=VERIFIED, reason=REASON_MATCH)
    return out


def checked_claim(metric: str, stated: Any, **kw) -> dict:
    """``make_claim`` plus its ``check``, as one wire object — what a product
    caller puts beside the number it states."""
    claim = make_claim(metric, stated, **kw)
    return dict(claim, check=check_claim(claim))
