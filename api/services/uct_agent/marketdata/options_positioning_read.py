"""MD-1 kind `options.positioning` (owner: terminal-data, data wave 14) — one stock's max pain and positioning levels.

Two parts, each with its own state: max pain per expiration (the strike where the open calls' and puts' intrinsic value
is smallest), and the named positioning levels (call wall, put wall, zero gamma, the absolute gamma and key delta strikes,
max pain, the implied one- and five-day moves). The Agent half of the POS terminal function, over the answers of
`GET /api/options/positioning/{sym}/max-pain` and `/levels` (`api/services/options_analytics/positioning.py`), with the
service's own field names.

⛔ ONLY WHAT THE SERVICE ALREADY HOLDS, NEVER A CHAIN READ (MD-1 §5). Both routes build on a miss: a paged option chain
read from the vendor (and, for the levels, the GEX read and an at-the-money IV read). A turn must not, so this adapter
never calls `positioning.max_pain` or `positioning.levels`. It reads the service's own result cache (`positioning._RESULTS`,
kept `RESULT_TTL_S` seconds after a member's panel built it), and nothing else. provider_calls is always 0.
⚠️ COUPLING, stated: the cache key (`posn::<kind>::<SYM>::<window>`) is private to the service. A rail builds through the
service's own functions over an invented chain and reads the answers back, so a rename fails by name.

THE SWITCHES ARE THE ROUTES': `OPTIONS_MAX_PAIN_ENABLED` and `OPTIONS_POSITIONING_VOCAB_ENABLED`. A part whose switch is off
is `off`; both off is `unavailable`. Nothing held for either part is `unavailable`: never "no max pain".

TIME (MD-1 §3): each answer carries `computed_at`, when UCT read the chain and worked the levels out: a computation time,
never `as_of`. `as_of` is null with a note; the stock price is the one the chain carried at that moment, never a quote.
freshness `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): UCT's own arithmetic over the vendor's option chain. The licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-28 covers the chain, Greeks and IV for
display to members, restricted, and row T-14 is the vendor's numbers into a model, restricted. Neither clears these figures
for a model provider. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.iv_history_read import _clean
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole

KIND = "options.positioning"
SOURCE = "uct-options-positioning"
WINDOWS = ("0dte", "1dte", "week", "month", "all")         # positioning.DTE_WINDOWS, railed equal
DEFAULT_WINDOW = "month"                                    # the POS panel's own window
MAX_EXPIRATIONS = 12
SWITCHES = {"max_pain": "OPTIONS_MAX_PAIN_ENABLED", "levels": "OPTIONS_POSITIONING_VOCAB_ENABLED"}
CACHE_KINDS = {"max_pain": "maxpain", "levels": "levels"}

NOTE_WHAT = ("{symbol}'s options positioning as UCT worked it out from an option chain for the {window} window: max pain "
             "per expiration and the named positioning levels. UCT's own arithmetic on the vendor's open interest, gamma "
             "and delta, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is null: these were worked out at {at} (UCT's own time) from the chain read then, never the time of "
              "the read; the stock price given is the one that chain carried")
NOTE_BAND = "max pain: {band}"
NOTE_OFF = "the {part} is switched off on this server ({switch} is not on), so it is not read"
NOTE_PART_NOT_HELD = ("the {part} for {symbol} is not held on this server (it is kept for a minute after the POS panel "
                      "works it out), and this read never reads an option chain")
NOTE_CUT = "max pain: {total} expirations are held and the nearest {shown} are returned: the list is cut from the FAR end"
NOTE_MISSING_OI = "{n} contracts carried no open interest and are left out of max pain, never counted as 0"
NOTE_LEVEL_NOTES = "the levels' own notes: {notes}"
NOTE_BOTH_OFF = ("options positioning is switched off on this server (neither OPTIONS_MAX_PAIN_ENABLED nor "
                 "OPTIONS_POSITIONING_VOCAB_ENABLED is on), so nothing is read. That is not the same as no positioning")
NOTE_NOT_HELD = ("{symbol}'s options positioning is not held on this server for the {window} window, and this read never "
                 "reads an option chain. That is not the same as no positioning. Open POS for {symbol} in UCT, then ask "
                 "again within a minute")
NOTE_FAILED = "the options positioning read failed; nothing is stated. That is not the same as no positioning"

PART_WORDS = {"max_pain": "max pain", "levels": "positioning levels"}


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if _clean(params.get("symbol")) is None:
        return "`symbol` must be one US stock or fund ticker"
    w = params.get("window", DEFAULT_WINDOW)
    if w is not None and w not in WINDOWS:
        return f"`window` must be one of {', '.join(WINDOWS)}"
    return None


def held_answer(sym: str, window: str) -> dict:
    """READ ONLY: `{part: answer | None | "off"}` from the service's own result cache. Never builds, never reads a chain."""
    from api.services.options_analytics import flags, positioning
    out: dict = {}
    for part, ck in CACHE_KINDS.items():
        out[part] = positioning._RESULTS.get(f"posn::{ck}::{sym}::{window}") if flags.is_on(SWITCHES[part]) else "off"
    return out


def _exp(e: Any) -> Optional[dict]:
    if not isinstance(e, dict) or _day(e.get("expiration")) is None:
        return None
    return {"expiration": _day(e["expiration"]), "max_pain": _num(e.get("max_pain")),
            "distance_pct": _num(e.get("distance_pct")), "call_oi": _whole(e.get("call_oi")),
            "put_oi": _whole(e.get("put_oi")), "strikes_counted": _whole(e.get("strikes_counted"))}


def _level(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or not isinstance(r.get("id"), str):
        return None
    return {"id": r["id"], "label": r.get("label") if isinstance(r.get("label"), str) else r["id"],
            "value": _num(r.get("value")), "unit": r.get("unit") if isinstance(r.get("unit"), str) else None,
            "role": r.get("role") if isinstance(r.get("role"), str) else None, "expiration": _day(r.get("expiration"))}


def read_positioning(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym, window = _clean(params["symbol"]), params.get("window") or DEFAULT_WINDOW
    try:
        got = held_answer(sym, window)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if all(v == "off" for v in got.values()):
        return env.unavailable(KIND, params, SOURCE, NOTE_BOTH_OFF)
    if not any(isinstance(v, dict) for v in got.values()):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym, window=window))
    notes, parts, built = [], {}, []
    for part, ans in got.items():
        if ans == "off":
            parts[part] = {"state": "off"}
            notes.append(NOTE_OFF.format(part=PART_WORDS[part], switch=SWITCHES[part]))
            continue
        if not isinstance(ans, dict):
            parts[part] = {"state": "not_held"}
            notes.append(NOTE_PART_NOT_HELD.format(part=PART_WORDS[part], symbol=sym))
            continue
        at = _read_at(ans.get("computed_at"))
        if at:
            built.append(at)
        base = {"state": "held", "computed_at": at, "spot": _num(ans.get("spot")),
                "chain_truncated": ans.get("chain_truncated") is True,
                "strike_band_pct": _num(ans.get("strike_band_pct")),
                "method": ans.get("method") if isinstance(ans.get("method"), str) else None}
        if part == "max_pain":
            exps = sorted((x for x in (_exp(e) for e in ans.get("expirations") or []) if x), key=lambda x: x["expiration"])
            shown = exps[:MAX_EXPIRATIONS]
            base.update({"expirations": shown, "count": len(shown), "total": len(exps), "cut": len(exps) > len(shown),
                         "contracts_missing_oi": _whole(ans.get("contracts_missing_oi"))})
            if isinstance(ans.get("band_note"), str):
                notes.append(NOTE_BAND.format(band=ans["band_note"]))
            if base["cut"]:
                notes.append(NOTE_CUT.format(total=len(exps), shown=len(shown)))
            if base["contracts_missing_oi"]:
                notes.append(NOTE_MISSING_OI.format(n=base["contracts_missing_oi"]))
        else:
            base["levels"] = [x for x in (_level(r) for r in ans.get("levels") or []) if x]
            own = [n.strip() for n in ans.get("notes") or [] if isinstance(n, str) and n.strip()]
            if own:
                notes.append(NOTE_LEVEL_NOTES.format(notes=" ".join(own[:5])))
        parts[part] = base
    at = min(built) if built else None
    notes = [NOTE_WHAT.format(symbol=sym, window=window),
             NOTE_AS_OF.format(at=at or "a time it did not record"), *notes]
    status = "ok" if all(p["state"] in ("held", "off") for p in parts.values()) else "partial"
    data = {"symbol": sym, "window": window, "max_pain": parts["max_pain"], "levels": parts["levels"], "computed_at": at}
    return env.make_envelope(KIND, params, status=status, freshness="periodic", as_of=None, source=SOURCE, data=data,
                             notes=notes, provider_calls=0)
