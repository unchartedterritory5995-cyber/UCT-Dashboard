"""MD-1 kind `congress.trades` (owner: terminal-data, data wave 14) — congressional trade disclosures, as held.

STOCK Act periodic transaction reports from the Senate and the House: with no `symbol`, the newest disclosures across every
symbol; with a `symbol`, both chambers' disclosures for that stock. The Agent half of CONG and `NVDA CONG`, over the answers
of `GET /api/research/congress-latest` and `GET /api/research/congress-trades/{sym}` (`api/services/congress_trades.py`),
with the service's own field names: each row's chamber, member, owner, side, the disclosed amount RANGE (never one figure),
the trade day, the disclosure day and the days between them.

⛔ ONLY WHAT THE SERVER ALREADY HOLDS, NEVER A VENDOR REQUEST (MD-1 §5). Both routes read the vendor on a cache miss; this
adapter reads only the answer the service stored in the shared cache (`congress_trades::<SYM>`, `congress_trades_latest`)
and never calls `latest()` or `for_symbol()`. provider_calls is always 0.
⚠️ COUPLING, stated: the two cache keys are private to the service. A rail fills them through the service's own functions
over invented vendor rows and reads them back, so a rename fails by name.

THE SWITCH IS THE ROUTES': while `CONGRESS_TRADES_ENABLED` is off, both routes answer 404 and this read is `unavailable`.
A healthy "no disclosure" (both chambers answered with nothing) is said as no record in what UCT holds; one chamber missing
is `partial` and named; nothing held is `unavailable`; never "no trades".

THE CUT IS STATED: at most `rows` disclosures, newest disclosure first; the rest are cut from the OLD end.

TIME (MD-1 §3): `as_of` is the newest disclosure day, as the start of that Eastern day; each row carries its own trade and
disclosure days, and when UCT read the vendor rides as `data.read_at`. Disclosures can lag the trade by up to 45 days.
freshness `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the disclosures come through the vendor's lists, which the licensing
register (docs/terminal-research/09-security-licensing-cost/licensing-register.md) does not name for congressional data;
the nearest rows are T-39 (FMP's insider trading for member display, "R") and T-44 (FMP's numbers into a model, "No AI
clause"). The underlying reports are public, but 5 U.S.C. 13107 limits the commercial use of congressional financial
disclosure reports, and no register row has cleared that, for members or for a model provider. Shown to the member only; the capability is local-only, and the
kind is to stay dark until that is cleared.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _whole, day_as_of
from api.services.uct_agent.marketdata.stock_stats_read import clean_symbol

KIND = "congress.trades"
SOURCE = "uct-congress-trades"
DEFAULT_ROWS = 15
MAX_ROWS = 50
CHAMBERS = ("senate", "house")                       # congress_trades.CHAMBERS, railed equal
SIDES = ("buy", "sell", "exchange", "other")
LATEST_KEY = "congress_trades_latest"
SYMBOL_KEY = "congress_trades::{sym}"

NOTE_WHAT = ("{scope} as UCT holds them: STOCK Act periodic transaction reports filed with the Senate and the House, each "
             "with the member, the owner, the side, the disclosed amount range (the law requires ranges, never one "
             "figure), the trade day and the disclosure day. A record of disclosures, not advice")
NOTE_AS_OF = ("`as_of` is the newest disclosure day ({day}); each row carries its own trade and disclosure days, and UCT "
              "read them at {at}; never the time of the read. Members may disclose up to 45 days after a trade")
NOTE_NO_DAY = "`as_of` is null: no disclosure is held to date it; UCT read the records at {at}, never the time of the read"
NOTE_NONE = "no congressional disclosure in what UCT holds names {symbol}. That is not the same as no trades"
NOTE_CHAMBER = "the {chamber} records could not be read when UCT last read them, so only the other chamber is stated"
NOTE_CUT = "{total} disclosures are held and the newest {shown} are returned: the list is cut from the OLD end"
NOTE_NO_SYMBOL = "{n} disclosures name no stock symbol (bonds, funds, private holdings); they are counted, not listed"
NOTE_OFF = ("congressional trades are switched off on this server (CONGRESS_TRADES_ENABLED is not on), so nothing is read. "
            "That is not the same as no trades")
NOTE_NOT_HELD = ("{scope} are not held on this server yet, and this read never asks the vendor. That is not the same as no "
                 "trades. Open CONG{sym} in UCT, then ask again")
NOTE_UNREAD = "neither chamber's records could be read when UCT last read them; nothing is stated. That is not the same as no trades"
NOTE_FAILED = "the congressional trades read failed; nothing is stated. That is not the same as no trades"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if params.get("symbol") is not None and clean_symbol(params.get("symbol")) is None:
        return "`symbol` must be one US stock ticker, or null for the newest disclosures"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(sym: Optional[str]) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)`; `how` is `off`, `held` or `not_held`. A shared-cache read; never asks the vendor."""
    from api.services import congress_trades
    from api.services.cache import cache
    if not congress_trades.is_enabled():
        return None, "off"
    got = cache.get(SYMBOL_KEY.format(sym=sym) if sym else LATEST_KEY)
    return (got, "held") if isinstance(got, dict) else (None, "not_held")


def _row(t: Any) -> Optional[dict]:
    if not isinstance(t, dict) or t.get("chamber") not in CHAMBERS:
        return None
    s = lambda k: t.get(k) if isinstance(t.get(k), str) else None    # noqa: E731
    return {"chamber": t["chamber"], "symbol": s("symbol"), "member": s("member"), "office": s("office"),
            "owner": s("owner"), "type": s("type"), "side": t.get("side") if t.get("side") in SIDES else "other",
            "amount": s("amount"), "amount_low": _num(t.get("amount_low")), "amount_high": _num(t.get("amount_high")),
            "asset": s("asset"), "transaction_date": _day(t.get("transaction_date")),
            "disclosure_date": _day(t.get("disclosure_date")), "lag_days": _whole(t.get("lag_days")),
            "link": s("link") if (s("link") or "").startswith("https://") else None}


def read_congress(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = clean_symbol(params["symbol"]) if params.get("symbol") is not None else None
    limit = params.get("rows", DEFAULT_ROWS)
    scope = f"{sym}'s congressional trade disclosures" if sym else "The newest congressional trade disclosures"
    try:
        got, how = held_answer(sym)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "off":
        return env.unavailable(KIND, params, SOURCE, NOTE_OFF)
    if how != "held":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(scope=scope, sym=f" for {sym}" if sym else ""))
    state = got.get("state")
    if state == "unavailable":
        return env.unavailable(KIND, params, SOURCE, NOTE_UNREAD)
    if state not in ("ok", "partial", "none_disclosed"):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    rows = [x for x in (_row(t) for t in got.get("trades") or []) if x]
    rows.sort(key=lambda r: (r["disclosure_date"] or "", r["transaction_date"] or ""), reverse=True)
    shown = rows[:limit]
    fetched = got.get("fetched_at")
    read_at = (env.utc_iso(datetime.fromtimestamp(float(fetched), tz=timezone.utc))
               if isinstance(fetched, (int, float)) and not isinstance(fetched, bool) and fetched > 0 else None)
    newest = _day(got.get("newest_disclosure")) or (rows[0]["disclosure_date"] if rows else None)
    chambers = {c: (got.get("chambers") or {}).get(c, {}).get("state") for c in CHAMBERS}
    notes = [NOTE_WHAT.format(scope=scope)]
    if newest:
        notes.append(NOTE_AS_OF.format(day=newest, at=read_at or "a time it did not record"))
    else:
        notes.append(NOTE_NO_DAY.format(at=read_at or "a time it did not record"))
    if not rows:
        notes.append(NOTE_NONE.format(symbol=sym or "any stock"))
    for c, st in chambers.items():
        if st == "unavailable":
            notes.append(NOTE_CHAMBER.format(chamber=c.capitalize()))
    if len(rows) > len(shown):
        notes.append(NOTE_CUT.format(total=len(rows), shown=len(shown)))
    if not sym and _whole(got.get("without_symbol")):
        notes.append(NOTE_NO_SYMBOL.format(n=_whole(got["without_symbol"])))
    data = {"scope": "stock" if sym else "market", "symbol": sym, "state": state, "rows": shown, "count": len(shown),
            "total": len(rows), "cut": len(rows) > len(shown), "chambers": chambers, "newest_disclosure": newest,
            "read_at": read_at, "without_symbol": _whole(got.get("without_symbol")) if not sym else None}
    return env.make_envelope(KIND, params, status="partial" if state == "partial" else "ok", freshness="periodic",
                             as_of=day_as_of(newest), source=SOURCE, data=data, notes=notes, provider_calls=0)
