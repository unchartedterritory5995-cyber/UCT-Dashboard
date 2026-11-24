"""MD-1 kind `stock.setupHistory` (owner: terminal-data, data wave 10) — the setups that fired on one stock, as held.

Every time each setup of UCT's fixed library (breakouts, pullbacks, gaps, reclaims, tight weeks, pocket pivots) fired on
one stock over its held daily history, one signal per run, each with its return 5, 20 and 60 sessions on and the S&P
500's market phase that day; and, beside each setup and phase, the universe line: how that setup did across UCT's stock
universe in the same phase, from the weekly study. The Agent half of the stock view of the SETH terminal function, over
the answer of `GET /api/research/setup-history/{ticker}` (`api/services/setup_history.py` `get_stock`), with the route's
own field names.

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `setup_history.get_stock` asks MKTH for
its answer (whose reader starts MKTH's own background build when that is due), starts the one-stock background build
when nothing is held for the session, and reads the universe study through `get_study`, which starts the weekly study
build when that is due. A turn must not, so this adapter never calls either. It reads through
`setup_history_held.held_signals()`, which returns the newest answer the service holds for the stock with the universe
lines attached by the service's own `universe_lines` from the study it holds, or nothing, and never builds.
provider_calls is always 0. A rail shows `get_stock` doing that work in the same state.

NOTHING HELD IS SAID, NEVER "NO SIGNAL": nothing held is `unavailable` with that reason; a held answer that found no
stored prices is `unavailable` with its own reason. A held answer in which no setup fired is said as that, over the
prices held.

WHAT IS STATED: every signal, return and universe figure is the service's own (`setup_history_calc`, the screen
backtester's numbers), passed through; nothing is recomputed here. A return the history cannot reach yet is null, never
0; a universe group under the backtester's minimum keeps its `below_floor` flag. The market phase is assigned with
hindsight, and the note says so.

THE CUT IS STATED: each setup returns its newest `rows` signals, each setup's list cut from the OLD end, with the whole
count beside them; where the service itself keeps only the newest 300 of a stock's signals, that is said too.

TIME (MD-1 §3): `as_of` = the regular-session close of the newest session in the history (`data_through`), in UTC; never
the time of the read. When UCT worked it out rides as `data.read_at`, and the study's own build time inside `universe`.
Stale, with a note, on the same rules as `stock.stats`. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the signals and every return are computed from UCT's daily bar store,
which holds the market-data vendor's end-of-day history
(docs/terminal-research/09-security-licensing-cost/licensing-register.md, rows T-04 and T-09: member display of daily
history, and its storage) and, before 2003-09-10, yfinance history (row T-71: the pre-2003 daily tail, class X). No row
of that register names the setup study, and no row clears it for a model provider (row T-14, AI processing of the
vendor's numbers, is restricted and names none of it). The phases come from MKTH's held answer over UCT's index store,
which no row names either. The same rule as `seasonality.stock`. Shown to the member only; the capability is
local-only.
"""
from __future__ import annotations

from typing import Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _read_at, _whole
from api.services.uct_agent.marketdata.stock_stats_read import (check_params, close_as_of, held_read, time_notes,
                                                                tree)

KIND = "stock.setupHistory"
SOURCE = "uct-setup-history"
DEFAULT_ROWS = 3            # signals returned per setup, newest first
MAX_ROWS = 20
#: the forward horizons, in sessions (setup_history_calc.HORIZONS; a rail pins the two together)
HORIZONS = (5, 20, 60)
#: the universe block's states (setup_history.universe_lines, setup_history_held.held_signals) and what each says
UNIVERSE_WORDS = {"not_held": "the weekly study of every setup across UCT's stock universe is not held on this server yet",
                  "computing": "the weekly study of every setup was still being worked out",
                  "waiting": "the weekly study of every setup had not been worked out yet",
                  "unavailable": "the weekly study held could not be read as this library's"}

NOTE_WHAT = ("{symbol}'s setup signals as UCT worked them out for the SETH panel: every time each of the library's "
             "{setups} setups fired on it over the completed daily sessions its bar store holds ({first} to {through}), "
             "one signal per run, each with its return 5, 20 and 60 sessions on (from the next session's open) and the "
             "S&P 500's market phase that day; beside each setup and phase, how that setup did across UCT's stock "
             "universe in the same phase, from the weekly study. A record of the past, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the close of the newest session in the history ({day}); it is never the time of the read. UCT "
              "worked it out at {at} (UCT's own time) from prices it already held")
NOTE_HINDSIGHT = ("the market phase is assigned with hindsight (a decline is known to be a correction only after the "
                  "fact): read a phase as how a setup did in what turned out to be a correction, never as something a "
                  "trader could have known on the day")
NOTE_NONE_FIRED = "no setup of the library fired on {symbol} in the prices UCT holds ({first} to {through})"
NOTE_CUT = ("{total} signals are held for {symbol} and the newest {rows} of each setup are returned ({shown} in all): "
            "each setup's list is cut from the OLD end")
NOTE_SERVICE_CUT = ("the server keeps only the newest {kept} of {symbol}'s {total} signals, so the oldest are not in "
                    "what UCT holds")
NOTE_NO_PHASES = ("the S&P 500's declines were not held when UCT worked this out, so no signal carries a market phase "
                  "and each universe line is the setup's line over all days")
NOTE_UNIVERSE = "the universe lines are not stated: {why}. That is not the same as a setup that never worked"
NOTE_REFUSED = "{n} setups could not be run on {symbol}'s bars: {what}"
NOTE_NO_PRICES = ("when UCT last worked out {symbol}'s setup signals it held no settled daily prices for it, and this "
                  "read never reads the store. That is not the same as no signal. Open SETH for {symbol} in UCT, then "
                  "ask again")
NOTE_NOT_HELD = ("{symbol}'s setup signals are not held on this server yet, and this read never works them out. That is "
                 "not the same as no signal. Open SETH for {symbol} in UCT, then ask again")
NOTE_FAILED = "the setup history read failed; nothing is stated. That is not the same as no signal"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, MAX_ROWS, DEFAULT_ROWS)


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the newest answer the service holds for `sym`, universe lines attached, 'held' | 'not_held'),
    WITHOUT working anything out (`setup_history_held.held_signals`)."""
    from api.services import setup_history_held as svc
    return svc.held_signals(sym)


def read_signals(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    limit = params.get("rows", DEFAULT_ROWS)
    done, got, sym, current = held_read(KIND, SOURCE, params, held_answer, "setup_history",
                                        NOTE_NOT_HELD, NOTE_NO_PRICES, NOTE_FAILED)
    if done is not None:
        return done
    through, read_at = _day(got["data_through"]), _read_at(got["built_at"])
    library = [tree(s) for s in (got.get("library") or []) if isinstance(s, dict) and isinstance(s.get("id"), str)]
    order = [s["id"] for s in library]
    held = [r for r in (got.get("signals") or []) if isinstance(r, dict) and _day(r.get("date")) and r.get("setup") in order]
    per: dict = {}
    for r in held:                                        # the service lists them newest first
        if len(per.setdefault(r["setup"], [])) < limit:
            per[r["setup"]].append(tree(r))
    signals = sorted((r for rows in per.values() for r in rows), key=lambda r: (r["date"], -order.index(r["setup"])),
                     reverse=True)
    counts = {sid: sum(1 for r in held if r["setup"] == sid) for sid in order}
    total = _whole(got.get("total"))
    total = len(held) if total is None else total
    setups = [tree(s) for s in (got.get("setups") or []) if isinstance(s, dict)]
    phases = tree(got.get("phases")) if isinstance(got.get("phases"), dict) else {"state": "not_held"}
    pairs = {f"{r['setup']}|{r.get('phase') or 'all'}" for r in signals}
    u_raw = got.get("universe") if isinstance(got.get("universe"), dict) else {"state": "unavailable"}
    universe = {k: tree(v) for k, v in u_raw.items() if k != "lines"}
    if isinstance(u_raw.get("lines"), dict):
        universe["lines"] = {k: tree(v) for k, v in u_raw["lines"].items() if k in pairs}

    first = _day(got.get("first")) or "not given"
    notes = [NOTE_WHAT.format(symbol=sym, setups=len(library), first=first, through=through),
             NOTE_AS_OF.format(day=through, at=read_at)]
    timing, stale_for = time_notes(sym, "SETH", got, current)
    notes += timing
    notes.append(NOTE_HINDSIGHT)
    if total == 0:
        notes.append(NOTE_NONE_FIRED.format(symbol=sym, first=first, through=through))
    elif len(held) > len(signals):
        notes.append(NOTE_CUT.format(total=total, symbol=sym, rows=limit, shown=len(signals)))
    if got.get("cut") == "oldest" and total > len(held):
        notes.append(NOTE_SERVICE_CUT.format(kept=len(held), symbol=sym, total=total))
    if phases.get("state") != "ok":
        notes.append(NOTE_NO_PHASES)
    if universe.get("state") != "ok":
        notes.append(NOTE_UNIVERSE.format(why=UNIVERSE_WORDS.get(universe.get("state"), UNIVERSE_WORDS["unavailable"])))
    refused = [s.get("id") for s in setups if s.get("state") == "refused" and isinstance(s.get("id"), str)]
    if refused:
        notes.append(NOTE_REFUSED.format(n=len(refused), symbol=sym, what=", ".join(refused)))

    # every key below is the route's own name (the SETH panel's model reads them); `per_setup` is each setup's count of
    # the signals the server holds
    data = {"symbol": sym, "session": _day(got.get("session")), "data_through": through, "first": _day(got.get("first")),
            "sessions": _whole(got.get("sessions")), "read_at": read_at,
            "source": got.get("source") if isinstance(got.get("source"), str) else None,
            "horizons": [h for h in (got.get("horizons") or []) if isinstance(h, int) and not isinstance(h, bool)],
            "phases": phases, "total": total, "shown": len(signals), "signals": signals, "per_setup": counts,
            "library": library, "setups": setups, "universe": universe,
            "one_signal_per_run": got.get("one_signal_per_run") if isinstance(got.get("one_signal_per_run"), str) else None,
            "fill": got.get("fill") if isinstance(got.get("fill"), str) else None, "stale_for": stale_for}
    coverage = {"evaluated": len(order), "answered": sum(1 for s in setups if s.get("state") == "ok"), "dropped": 0,
                "not_computable": len(refused)}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=close_as_of(through), source=SOURCE,
                             data=data, stale=bool(stale_for), coverage=coverage, notes=notes, provider_calls=0)
