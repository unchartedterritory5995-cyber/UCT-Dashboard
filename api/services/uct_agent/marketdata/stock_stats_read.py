"""MD-1 kind `stock.stats` (owner: terminal-data, data wave 10) — one stock's statistics, as held.

One stock's volatility and range, its beta and correlation against SPY and against its sector fund, its returns from one
week to five years, a summary of its own declines of 20% or more, and the summary line of how it fell against the S&P
500 in the index's corrections and bear markets: the Agent half of the STAT terminal function, over the answer of
`GET /api/research/stock-stats/{ticker}` (`api/services/stock_stats.py`), with the route's own field names (the panel's
model reads them).

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `stock_stats.get_stock_stats` WORKS
THE STOCK OUT on the request when nothing is held for the session (a read of the stored daily bars, SPY's and the
sector fund's closes) and asks MKTH for its answer, which starts MKTH's own background build when that is due. A turn
must not, so this adapter never calls it. It reads through `stock_stats_held.held_stats()`, which returns the answer
the service holds for the stock or nothing, and never builds. provider_calls is always 0. A rail shows
`get_stock_stats` doing that work in the same state.

NOTHING HELD IS SAID, NEVER "NO STATISTICS": nothing held is `unavailable` with that reason; a held answer that found no
stored prices is `unavailable` with its own reason.

WHAT IS STATED: every figure is the service's own, passed through (`stock_stats_calc`); nothing is recomputed here. A
statistic the history is too short for keeps the service's `short` block (what it needs), never 0. A benchmark not held
or not read keeps its own state. The corrections' summary line only: each correction's own row is left out, and the
note says the STAT panel shows them.

THE CUT IS STATED: the stock's own declines return the newest `rows` (the service lists at most 40), cut from the OLD
end, with the whole count beside them.

TIME (MD-1 §3): `as_of` = the regular-session close of the newest session in the statistics (`data_through`), in UTC;
never the time of the read. When UCT worked them out rides as `data.read_at`. The read is `stale`, with a note, when the
answer was worked out for an earlier session than the newest one whose evening has begun (the service's own key,
`market_history.evening_key`), or when the newest close it held stops short of the session it was worked out for:
this read never works it out again. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the figures are computed from UCT's daily bar store, which holds the
market-data vendor's end-of-day history (docs/terminal-research/09-security-licensing-cost/licensing-register.md, rows
T-04 and T-09: member display of daily history, and its storage) and, before 2003-09-10, yfinance history (row T-71: the
pre-2003 daily tail, class X). No row of that register names these statistics, and no row clears them for a model
provider (row T-14, AI processing of the vendor's numbers, is restricted and names none of them). The corrections come
from MKTH's held answer over UCT's index store, which no row names either. The same rule as `seasonality.stock`. Shown
to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.bars_daily import VENDOR_FLOOR_YMD, _session_close_utc
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole

KIND = "stock.stats"
SOURCE = "uct-stock-stats"
DEFAULT_ROWS = 5            # the stock's own declines returned, newest first
MAX_ROWS = 40               # stock_stats_calc.DRAWDOWNS_SHOWN (a rail pins the two together)
MAX_TEXT = 300
MAX_LIST = 60
JUMPS_SHOWN = 20            # the service keeps the newest 20 suspect jumps (stock_stats.build; a rail pins it)
#: the blocks this read passes through, by the route's own names
SECTIONS = ("volatility", "beta", "returns", "drawdowns", "corrections")
#: the corrections block's own states (stock_stats.market_corrections) and what each says
CORRECTION_WORDS = {"computing": "the market history was still working out the S&P 500's declines when UCT worked these out",
                    "not_held": "the market history held no S&P 500 declines when UCT worked these out",
                    "unavailable": "the market history could not be read when UCT worked these out"}
#: a benchmark comparison that is not stated, by its state (stock_stats.sector_fund / bench_closes)
BENCH_WORDS = {"not_held": "no settled closes were held for the fund", "unavailable": "the fund's closes could not be read",
               "fund": "a fund has no sector fund of its own", "no_sector": "no sector is held for the stock",
               "not_mapped": "its sector has no sector fund in UCT's list", "short": "too few daily returns on days both traded"}

NOTE_WHAT = ("{symbol}'s statistics as UCT worked them out for the STAT panel, from the completed daily sessions its bar "
             "store holds ({first} to {through}, {sessions} sessions): volatility and range, beta and correlation "
             "against SPY and its sector fund, returns from one week to five years, its own declines of 20% or more, "
             "and how it fell against the S&P 500 in the index's corrections. Price returns (split-adjusted, not "
             "dividend-adjusted). A record of the past, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the close of the newest session in the statistics ({day}); it is never the time of the read. "
              "UCT worked them out at {at} (UCT's own time) from prices it already held")
NOTE_OLD_SESSION = ("UCT worked these out for the session of {session}; a newer session has closed since ({current}), "
                    "and this read never works them out again. Open {code} for {symbol} in UCT, then ask again")
NOTE_LAGGING = ("the newest close UCT held for {symbol} ({through}) stops short of the session it was worked out for "
                "({session}): the store had not caught up, or the stock did not trade")
NOTE_PRE_FLOOR = ("the prices start before 2003-09-10: the bars before that date come from yfinance history (the "
                  "market-data vendor's daily archive starts 2003-09-10)")
NOTE_BENCH = "{n} of the two benchmark comparisons are not stated, and that is not a beta of 0: {what}"
NOTE_CORRECTIONS = "the corrections summary is not stated: {why}. That is not the same as a stock that never fell with the index"
NOTE_CUT = ("{total} declines of 20% or more are held and the newest {shown} are returned: the list is cut from the OLD "
            "end")
NOTE_JUMPS = ("{n} sessions moved more than {pct}% in one close, which can be a split the history did not adjust: the "
              "figures that span them are marked to check")
NOTE_LEFT_OUT = ("each correction's own row (its fall, back at its high first, the three months after) is not in this "
                 "read, only the summary line: the STAT panel shows them")
NOTE_NO_PRICES = ("when UCT last worked out {symbol}'s statistics it held no settled daily prices for it, and this read "
                  "never reads the store. That is not the same as no statistics. Open STAT for {symbol} in UCT, then "
                  "ask again")
NOTE_NOT_HELD = ("{symbol}'s statistics are not held on this server yet, and this read never works them out. That is not "
                 "the same as no statistics. Open STAT for {symbol} in UCT, then ask again")
NOTE_FAILED = "the stock statistics read failed; nothing is stated. That is not the same as no statistics"


# ── shared by the four price-derived kinds of this wave (stock_stats_read, volume_footprint_read,
#    factor_exposure_read, setup_history_read) ──────────────────────────────────────────────────────

def clean_symbol(v: Any) -> Optional[str]:
    """One ticker in the route's own spelling (`ticker_resolver.route_symbol`: BRK-B, never BRK.B), or None."""
    from api.services.ticker_resolver import route_symbol
    return route_symbol(v.strip().lstrip("$")) if isinstance(v, str) else None


def check_params(params: Any, max_rows: Optional[int], default_rows: Optional[int]) -> Optional[str]:
    """The pure parameter check of a one-symbol kind with an optional `rows`."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if clean_symbol(params.get("symbol")) is None:
        return "`symbol` must be one US stock or fund ticker"
    if max_rows is not None:
        n = params.get("rows", default_rows)
        if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= max_rows:
            return f"`rows` must be a whole number from 1 to {max_rows}"
    return None


def tree(v: Any, depth: int = 0) -> Any:
    """The service's own block passed through as data: numbers finite or null (never a NaN, never invented), a bool kept,
    text bounded, lists bounded; nothing renamed and nothing recomputed."""
    if depth > 8:
        return None
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return _num(v) if isinstance(v, float) else v
    if isinstance(v, str):
        return v[:MAX_TEXT]
    if isinstance(v, dict):
        return {str(k)[:60]: tree(x, depth + 1) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [tree(x, depth + 1) for x in list(v)[:MAX_LIST]]
    return None


def close_as_of(day: Optional[str]) -> Optional[str]:
    """A settled session's regular close as an MD-1 time (half days from their own close)."""
    return _session_close_utc(int(day.replace("-", ""))) if day else None


def session_now(svc: Any) -> str:
    """The newest session whose evening has begun, by the service's own clock and key (pure: no read). SETH names its
    key `evening_key`; the other three `session_key`; all four are MKTH's `evening_key`."""
    key = getattr(svc, "session_key", None) or svc.evening_key
    return key(svc.now_et())


#: why a price-derived read is stale, as codes in `data.stale_for` (the member's answer words them; it never reads a note)
STALE_CODES = ("earlier_session", "closes_short")


def time_notes(symbol: str, code: str, answer: dict, current: str) -> tuple[list, list]:
    """The staleness notes shared by the price-derived kinds: an earlier session's answer, a stock whose closes stop
    short, prices from before the vendor's floor. Returns `(notes, stale codes)`; the read is stale when a code is."""
    notes, codes = [], []
    session, through, first = _day(answer.get("session")), _day(answer.get("data_through")), _day(answer.get("first"))
    if session and session < current:
        notes.append(NOTE_OLD_SESSION.format(session=session, current=current, code=code, symbol=symbol))
        codes.append("earlier_session")
    if session and through and through < session:
        notes.append(NOTE_LAGGING.format(symbol=symbol, through=through, session=session))
        codes.append("closes_short")
    if first and int(first.replace("-", "")) < VENDOR_FLOOR_YMD:
        notes.append(NOTE_PRE_FLOOR)
    return notes, codes


def held_read(kind: str, source: str, params: dict, held: Callable[[str], tuple], svc_name: str,
              not_held: str, no_prices: str, failed: str) -> tuple[Optional[dict], Optional[dict], str, str]:
    """The shared front half of a price-derived read: `(envelope_if_done, answer, symbol, current_session)`. The answer
    is the held one with status `ok`; anything else is answered here, never as an empty record."""
    sym = clean_symbol(params["symbol"])
    try:
        import importlib
        got, how = held(sym)                                      # the held answer only: never a build
        current = session_now(importlib.import_module(f"api.services.{svc_name}"))
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "nothing there"
        return env.unavailable(kind, params, source, failed), None, sym, ""
    if how == "not_held" or got is None:
        return env.unavailable(kind, params, source, not_held.format(symbol=sym)), None, sym, current
    if how != "held" or not isinstance(got, dict):
        return env.unavailable(kind, params, source, failed), None, sym, current
    if got.get("status") == "not_held":
        return env.unavailable(kind, params, source, no_prices.format(symbol=sym)), None, sym, current
    if got.get("status") != "ok" or _day(got.get("data_through")) is None or _read_at(got.get("built_at")) is None:
        return env.unavailable(kind, params, source, failed), None, sym, current
    return None, got, sym, current


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the answer the service holds for `sym`, 'held' | 'not_held'), WITHOUT working anything out
    (`stock_stats_held.held_stats`)."""
    from api.services import stock_stats_held as svc
    return svc.held_stats(sym)


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, MAX_ROWS, DEFAULT_ROWS)


def _bench_missing(beta: dict) -> list[str]:
    out = []
    for key, label in (("spy", "SPY"), ("sector", "the sector fund")):
        b = beta.get(key) if isinstance(beta.get(key), dict) else {}
        state = b.get("state")
        if state != "ok":
            out.append(f"{label} ({BENCH_WORDS.get(state, 'not stated')})")
    return out


def read_stats(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    limit = params.get("rows", DEFAULT_ROWS)
    done, got, sym, current = held_read(KIND, SOURCE, params, held_answer, "stock_stats",
                                        NOTE_NOT_HELD, NOTE_NO_PRICES, NOTE_FAILED)
    if done is not None:
        return done
    through, read_at = _day(got["data_through"]), _read_at(got["built_at"])
    beta = tree(got.get("beta")) if isinstance(got.get("beta"), dict) else {}
    returns = tree(got.get("returns")) if isinstance(got.get("returns"), dict) else {}
    dd_raw = got.get("drawdowns") if isinstance(got.get("drawdowns"), dict) else {}
    episodes = [tree(e) for e in (dd_raw.get("episodes") or []) if isinstance(e, dict)]
    total = _whole(dd_raw.get("total")) or 0
    shown = episodes[:limit]
    drawdowns = {**{k: tree(v) for k, v in dd_raw.items() if k != "episodes"}, "episodes": shown, "shown": len(shown)}
    c_raw = got.get("corrections") if isinstance(got.get("corrections"), dict) else {}
    corrections = {k: tree(v) for k, v in c_raw.items() if k != "episodes"}
    jumps = [d for d in (_day(j) for j in (got.get("suspect_jumps") or [])) if d][:JUMPS_SHOWN]

    notes = [NOTE_WHAT.format(symbol=sym, first=_day(got.get("first")) or "not given", through=through,
                              sessions=_whole(got.get("sessions")) or 0),
             NOTE_AS_OF.format(day=through, at=read_at)]
    timing, stale_for = time_notes(sym, "STAT", got, current)
    notes += timing
    missing = _bench_missing(beta)
    if missing:
        notes.append(NOTE_BENCH.format(n=len(missing), what="; ".join(missing)))
    if corrections.get("state") != "ok":
        notes.append(NOTE_CORRECTIONS.format(why=CORRECTION_WORDS.get(corrections.get("state"), CORRECTION_WORDS["unavailable"])))
    if total > len(shown):
        notes.append(NOTE_CUT.format(total=total, shown=len(shown)))
    if jumps:
        notes.append(NOTE_JUMPS.format(n=len(jumps), pct=_whole(got.get("suspect_jump_pct")) or 40))
    notes.append(NOTE_LEFT_OUT)

    # every key below is the route's own name (the STAT panel's model reads them)
    data = {"symbol": sym, "session": _day(got.get("session")), "data_through": through, "first": _day(got.get("first")),
            "sessions": _whole(got.get("sessions")), "read_at": read_at,
            "source": got.get("source") if isinstance(got.get("source"), str) else None,
            "basis": got.get("basis") if isinstance(got.get("basis"), str) else None,
            "suspect_jump_pct": _whole(got.get("suspect_jump_pct")), "suspect_jumps": jumps,
            "volatility": tree(got.get("volatility")) if isinstance(got.get("volatility"), dict) else None,
            "beta": beta, "returns": returns, "drawdowns": drawdowns, "corrections": corrections,
            "stale_for": stale_for, "left_out": ["correction_episodes"]}
    periods = [p for p in (returns.get("periods") or []) if isinstance(p, dict)]
    ok = sum(1 for p in periods if p.get("state") == "ok")
    coverage = {"evaluated": len(periods), "answered": ok, "dropped": 0, "not_computable": len(periods) - ok}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=close_as_of(through), source=SOURCE,
                             data=data, stale=bool(stale_for), coverage=coverage, notes=notes, provider_calls=0)
