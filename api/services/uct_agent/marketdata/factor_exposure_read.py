"""MD-1 kind `stock.factorExposure` (owner: terminal-data, data wave 10) — one stock's factor exposure, as held.

How one stock traded against six fund spreads (the market, size, growth vs value, momentum, quality and low volatility)
over its newest year of daily returns: each loading with its standard error and t-statistic, R-squared and adjusted
R-squared, the largest variance inflation factor and whether it marks the loadings unstable, which fund each factor
used, and the plain reading the server builds ONLY from loadings whose t clears the bar: the Agent half of the FCTX
terminal function, over the answer of `GET /api/research/factor-exposure/{ticker}` (`api/services/factor_exposure.py`),
with the route's own field names.

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's
`factor_exposure.get_factor_exposure` first makes sure the session's fund set is held (it READS the stored closes of up
to seven funds and their alternatives when it is not), then WORKS THE STOCK OUT when nothing is held for that fund set.
A turn must not, so this adapter never calls it. It reads through `factor_exposure_held.held_exposure()`, which returns
the answer the service holds or nothing, and never reads the fund set. provider_calls is always 0. A rail shows
`get_factor_exposure` doing that work in the same state.

NOTHING HELD IS SAID, NEVER "NO EXPOSURE": nothing held is `unavailable` with that reason; a held answer that found no
stored prices is `unavailable` with its own reason.

WHAT IS STATED: every figure is the service's own (`factor_exposure_calc`), passed through; nothing is recomputed here,
and the reading is the server's own sentence, built mechanically from the loadings that clear the bar (a loading under
the bar never enters it). A window too short to fit or a singular design keeps its own state and no reading is given; a
t that cannot be worked out is null, never 0. The year-earlier window, the change in each loading and the funds' own
checks are left out, and the note says the FCTX panel shows them.

TIME (MD-1 §3): `as_of` = the regular-session close of the newest session in the regression (`data_through`), in UTC;
never the time of the read. When UCT worked it out rides as `data.read_at`. Stale, with a note, on the same rules as
`stock.stats`. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the regression is computed from UCT's daily bar store, the stock's and
the funds' closes, which holds the market-data vendor's end-of-day history
(docs/terminal-research/09-security-licensing-cost/licensing-register.md, rows T-04 and T-09: member display of daily
history, and its storage) and, before 2003-09-10, yfinance history (row T-71: the pre-2003 daily tail, class X). No row
of that register names the factor exposure, and no row clears it for a model provider (row T-14, AI processing of the
vendor's numbers, is restricted and names none of it). The same rule as `seasonality.stock`. Shown to the member only;
the capability is local-only.
"""
from __future__ import annotations

from typing import Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole
from api.services.uct_agent.marketdata.stock_stats_read import (check_params, close_as_of, held_read, time_notes,
                                                                tree)

KIND = "stock.factorExposure"
SOURCE = "uct-factor-exposure"
#: the factors, in the answer's order (factor_exposure_calc.FACTOR_KEYS; a rail pins the two together)
FACTOR_KEYS = ("market", "size", "growth", "momentum", "quality", "lowvol")
#: a window the service could not fit, by its own state (factor_exposure_calc.fit)
WINDOW_WORDS = {"short": "fewer daily returns on days the stock and every fund traded than the fit needs",
                "singular": "the funds' returns are too close to one another to be told apart"}
#: what a factor's state says (factor_exposure.funds_block)
FACTOR_STATES = ("ok", "substituted", "dropped")

NOTE_WHAT = ("{symbol}'s factor exposure as UCT worked it out for the FCTX panel: a regression of its daily price returns "
             "on six fund spreads (the market, size, growth vs value, momentum, quality and low volatility) over its "
             "newest year of daily returns on days the stock and every fund traded ({start} to {end}, {returns} "
             "returns): each loading with its t-statistic, R-squared, the largest variance inflation factor, and the "
             "server's plain reading, built only from loadings whose t is above {bar}. How the stock traded over the "
             "window, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the close of the newest session in the regression ({day}); it is never the time of the read. "
              "UCT worked it out at {at} (UCT's own time) from prices it already held")
NOTE_NOT_FITTED = "the newest window was not fitted ({why}), so no loading, R-squared or reading is stated, and that is not a loading of 0"
NOTE_EXACT = ("the stock moves exactly with the factor funds (it is one of them, or built from them), so no t-statistic "
              "can be worked out and no reading is given")
NOTE_UNSTABLE = ("the largest variance inflation factor is {vif} ({factor}), above {limit}: the loadings are unstable "
                 "(a small change in the data can move them a lot)")
NOTE_SUBSTITUTED = "{n} factors are measured with their stated stand-in funds, since the first fund is not held with enough history: {what}"
NOTE_DROPPED = ("{n} factors are left out of the model, since neither of their funds is held with enough history: {what}. "
                "A factor left out has no loading, and that is not a loading of 0")
NOTE_LEFT_OUT = ("the year-earlier window, the change in each loading since then and the funds' own checks are not in "
                 "this read: the FCTX panel shows them")
NOTE_NO_PRICES = ("when UCT last worked out {symbol}'s factor exposure it held no settled daily prices for it, and this "
                  "read never reads the store. That is not the same as no exposure. Open FCTX for {symbol} in UCT, then "
                  "ask again")
NOTE_NOT_HELD = ("{symbol}'s factor exposure is not held on this server yet, and this read never works it out. That is "
                 "not the same as no exposure. Open FCTX for {symbol} in UCT, then ask again")
NOTE_FAILED = "the factor exposure read failed; nothing is stated. That is not the same as no exposure"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, None, None)


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the answer the service holds for `sym`, 'held' | 'not_held'), WITHOUT reading the fund set or working
    anything out (`factor_exposure_held.held_exposure`)."""
    from api.services import factor_exposure_held as svc
    return svc.held_exposure(sym)


def _named(factors: list, state: str) -> list[str]:
    out = []
    for f in factors:
        if isinstance(f, dict) and f.get("state") == state:
            legs = " minus ".join(s for s in (f.get("funds") or []) if isinstance(s, str))
            out.append(f"{f.get('name') or f.get('key')}{f' ({legs})' if legs else ''}")
    return out


def read_exposure(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    done, got, sym, current = held_read(KIND, SOURCE, params, held_answer, "factor_exposure",
                                        NOTE_NOT_HELD, NOTE_NO_PRICES, NOTE_FAILED)
    if done is not None:
        return done
    through, read_at = _day(got["data_through"]), _read_at(got["built_at"])
    now = tree(got.get("now")) if isinstance(got.get("now"), dict) else {"state": "missing"}
    method = tree(got.get("method")) if isinstance(got.get("method"), dict) else {}
    factors = [tree(f) for f in (got.get("factors") or []) if isinstance(f, dict) and f.get("key") in FACTOR_KEYS]
    reading = tree(got.get("reading")) if isinstance(got.get("reading"), dict) else None
    fitted = now.get("state") == "ok"

    notes = [NOTE_WHAT.format(symbol=sym, start=_day(now.get("from")) or _day(got.get("common_from")) or "not given",
                              end=_day(now.get("to")) or through, returns=_whole(now.get("returns")) or 0,
                              bar=_num(method.get("t_bar")) or 2.0),
             NOTE_AS_OF.format(day=through, at=read_at)]
    timing, stale_for = time_notes(sym, "FCTX", got, current)
    notes += timing
    if not fitted:
        notes.append(NOTE_NOT_FITTED.format(why=WINDOW_WORDS.get(now.get("state"), "the window was not in the answer")))
        reading = None
    elif now.get("exact"):
        notes.append(NOTE_EXACT)
    mv = now.get("max_vif") if isinstance(now.get("max_vif"), dict) else {}
    if fitted and now.get("unstable") is True and _num(mv.get("value")) is not None:
        name = next((f.get("name") for f in factors if f.get("key") == mv.get("key")), mv.get("key"))
        notes.append(NOTE_UNSTABLE.format(vif=_num(mv.get("value")), factor=name, limit=_num(method.get("vif_unstable")) or 5.0))
    subs, drops = _named(factors, "substituted"), _named(factors, "dropped")
    if subs:
        notes.append(NOTE_SUBSTITUTED.format(n=len(subs), what="; ".join(subs)))
    if drops:
        notes.append(NOTE_DROPPED.format(n=len(drops), what="; ".join(drops)))
    notes.append(NOTE_LEFT_OUT)

    # every key below is the route's own name (the FCTX panel's model reads them)
    data = {"symbol": sym, "session": _day(got.get("session")), "data_through": through,
            "read_from": _day(got.get("read_from")), "sessions_read": _whole(got.get("sessions_read")), "read_at": read_at,
            "source": got.get("source") if isinstance(got.get("source"), str) else None,
            "basis": got.get("basis") if isinstance(got.get("basis"), str) else None,
            "suspect_jump_pct": _whole(got.get("suspect_jump_pct")), "method": method, "factors": factors,
            "common_returns": _whole(got.get("common_returns")), "common_from": _day(got.get("common_from")),
            "common_to": _day(got.get("common_to")), "now": now, "reading": reading, "stale_for": stale_for,
            "left_out": ["then", "change", "reading_then", "fund_checks"]}
    loadings = [r for r in (now.get("loadings") or []) if isinstance(r, dict)] if fitted else []
    no_t = sum(1 for r in loadings if r.get("t") is None)
    coverage = {"evaluated": len(FACTOR_KEYS), "answered": len(loadings), "dropped": len(FACTOR_KEYS) - len(loadings),
                "not_computable": no_t}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=close_as_of(through), source=SOURCE,
                             data=data, stale=bool(stale_for), coverage=coverage, notes=notes, provider_calls=0)
