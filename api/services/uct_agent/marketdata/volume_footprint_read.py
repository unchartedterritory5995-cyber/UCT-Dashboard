"""MD-1 kind `stock.volumeFootprint` (owner: terminal-data, data wave 10) — one stock's volume footprint, as held.

One stock's accumulation and distribution days over its last 25 and 50 sessions with the net, its up and down volume
over 50 sessions, its pocket pivots of the last year (how many, the last one's date and the newest `rows`), and its gaps
of 3% or more (how many up and down, how many are still open, the share filled within 5 and within 20 sessions, and the
newest `rows`): the Agent half of the VFP terminal function, over the answer of
`GET /api/research/volume-footprint/{ticker}` (`api/services/volume_footprint.py`), with the route's own field names.

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `volume_footprint.get_volume_footprint`
WORKS THE STOCK OUT on the request when nothing is held for the session (a read of the stored daily bars and of the
earnings dates the earnings page holds), and first looks at a held answer's earnings dates again when that is due. A
turn must not, so this adapter never calls it. It reads through `volume_footprint_held.held_footprint()`, which returns
the answer the service holds or nothing, and never builds. provider_calls is always 0. A rail shows
`get_volume_footprint` doing that work in the same state.

NOTHING HELD IS SAID, NEVER "NO ACCUMULATION": nothing held is `unavailable` with that reason; a held answer that found
no stored prices is `unavailable` with its own reason.

WHAT IS STATED: every count and figure is the service's own (`volume_footprint_calc`), passed through; nothing is
recomputed here. A session with no volume held is "not judged", a window the history is too short for keeps its `short`
block, and an up/down ratio with a missing volume or nothing closed down is null, never 0. An earnings mark the held
report dates cannot settle is null ("not known"), never false. The biggest volume days and the list of each
accumulation and distribution day are left out, and the note says the VFP panel shows them.

THE CUT IS STATED: the pocket pivots and the gaps each return their newest `rows`, cut from the OLD end, with each
list's whole count beside them.

TIME (MD-1 §3): `as_of` = the regular-session close of the newest session in the footprint (`data_through`), in UTC;
never the time of the read. When UCT worked it out rides as `data.read_at`. Stale, with a note, on the same rules as
`stock.stats` (an earlier session's answer; closes that stop short). Every read is `historical`; the kind is DECLARED
`periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the counts are computed from UCT's daily bar store, which holds the
market-data vendor's end-of-day history (docs/terminal-research/09-security-licensing-cost/licensing-register.md, rows
T-04 and T-09: member display of daily history, and its storage) and, before 2003-09-10, yfinance history (row T-71: the
pre-2003 daily tail, class X). No row of that register names the footprint, and no row clears it for a model provider
(row T-14, AI processing of the vendor's numbers, is restricted and names none of it). The earnings marks rest on the
report dates UCT's earnings page holds, a vendor's numbers whose AI row (row T-44) has no AI clause. The same rule as
`seasonality.stock`. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _read_at, _whole
from api.services.uct_agent.marketdata.stock_stats_read import (check_params, close_as_of, held_read, time_notes,
                                                                tree)

KIND = "stock.volumeFootprint"
SOURCE = "uct-volume-footprint"
DEFAULT_ROWS = 5            # pocket pivots and gaps returned, each newest first
MAX_ROWS = 60               # volume_footprint_calc.GAPS_SHOWN (a rail pins the two together)
#: the blocks this read passes through, by the route's own names
SECTIONS = ("accumulation", "pivots", "gaps", "earnings")
#: the earnings block's own states (volume_footprint.earnings) and what each says
EARNINGS_WORDS = {"not_held": "UCT's earnings page has not been built for the stock on this server",
                  "no_dates": "the earnings page UCT holds carries no report dates"}

NOTE_WHAT = ("{symbol}'s volume footprint as UCT worked it out for the VFP panel, from the completed daily sessions its "
             "bar store holds ({first} to {through}, {sessions} sessions; prices and volumes split-adjusted): its "
             "accumulation and distribution days over the last 25 and 50 sessions (a close at least 0.2% up or down on "
             "more volume than the session before) with the net, its up and down volume over 50 sessions, its pocket "
             "pivots of the last year, and its gaps of 3% or more with whether and when each filled. A record of the "
             "past, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the close of the newest session in the footprint ({day}); it is never the time of the read. "
              "UCT worked it out at {at} (UCT's own time) from bars it already held")
NOTE_CUT_PIVOTS = ("{total} pocket pivots are held for the last year and the newest {shown} are returned: the list is cut "
                   "from the OLD end")
NOTE_CUT_GAPS = ("{total} gaps of 3% or more are held and the newest {shown} are returned: the list is cut from the OLD "
                 "end")
NOTE_NOT_JUDGED = ("{n} sessions in the widest window counted have no volume held (or the session before has none): they "
                   "are counted as not judged, never as a quiet day")
NOTE_EARNINGS = "no session carries an earnings mark: {why}. That is not the same as no report"
NOTE_LEFT_OUT = ("the biggest volume days of the year and the list of each accumulation and distribution day are not in "
                 "this read: the VFP panel shows them")
NOTE_NO_PRICES = ("when UCT last worked out {symbol}'s volume footprint it held no settled daily prices for it, and this "
                  "read never reads the store. That is not the same as no footprint. Open VFP for {symbol} in UCT, then "
                  "ask again")
NOTE_NOT_HELD = ("{symbol}'s volume footprint is not held on this server yet, and this read never works it out. That is "
                 "not the same as no accumulation and no gaps. Open VFP for {symbol} in UCT, then ask again")
NOTE_FAILED = "the volume footprint read failed; nothing is stated. That is not the same as no footprint"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, MAX_ROWS, DEFAULT_ROWS)


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the answer the service holds for `sym`, 'held' | 'not_held'), WITHOUT working anything out
    (`volume_footprint_held.held_footprint`)."""
    from api.services import volume_footprint_held as svc
    return svc.held_footprint(sym)


def _listed(block: dict, limit: int) -> tuple[dict, int, int]:
    """A pivots or gaps block with its rows cut to the newest `limit`: (block, held, shown)."""
    rows = [tree(r) for r in (block.get("rows") or []) if isinstance(r, dict)]
    shown = rows[:limit]
    return {**{k: tree(v) for k, v in block.items() if k != "rows"}, "rows": shown}, len(rows), len(shown)


def read_footprint(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    limit = params.get("rows", DEFAULT_ROWS)
    done, got, sym, current = held_read(KIND, SOURCE, params, held_answer, "volume_footprint",
                                        NOTE_NOT_HELD, NOTE_NO_PRICES, NOTE_FAILED)
    if done is not None:
        return done
    through, read_at = _day(got["data_through"]), _read_at(got["built_at"])
    acc_raw = got.get("accumulation") if isinstance(got.get("accumulation"), dict) else {}
    accumulation = {k: tree(v) for k, v in acc_raw.items() if k != "days"}
    pivots, piv_held, piv_shown = _listed(got.get("pivots") if isinstance(got.get("pivots"), dict) else {}, limit)
    gaps, gap_held, gap_shown = _listed(got.get("gaps") if isinstance(got.get("gaps"), dict) else {}, limit)
    earnings = tree(got.get("earnings")) if isinstance(got.get("earnings"), dict) else {"state": "not_held"}
    piv_total = _whole(pivots.get("count")) if pivots.get("state") == "ok" else None
    gap_total = _whole(gaps.get("total")) if gaps.get("state") == "ok" else None
    pivots["last"] = pivots["rows"][0]["date"] if pivots.get("rows") else None

    notes = [NOTE_WHAT.format(symbol=sym, first=_day(got.get("first")) or "not given", through=through,
                              sessions=_whole(got.get("sessions")) or 0),
             NOTE_AS_OF.format(day=through, at=read_at)]
    timing, stale_for = time_notes(sym, "VFP", got, current)
    notes += timing
    wide = [w for w in (accumulation.get("windows") or []) if isinstance(w, dict) and w.get("state") == "ok"]
    unjudged = max((_whole(w.get("not_judged")) or 0 for w in wide), default=0)
    if unjudged:
        notes.append(NOTE_NOT_JUDGED.format(n=unjudged))
    if piv_total is not None and piv_total > piv_shown:
        notes.append(NOTE_CUT_PIVOTS.format(total=piv_total, shown=piv_shown))
    if gap_total is not None and gap_total > gap_shown:
        notes.append(NOTE_CUT_GAPS.format(total=gap_total, shown=gap_shown))
    if earnings.get("state") != "ok":
        notes.append(NOTE_EARNINGS.format(why=EARNINGS_WORDS.get(earnings.get("state"), EARNINGS_WORDS["not_held"])))
    notes.append(NOTE_LEFT_OUT)

    # every key below is the route's own name (the VFP panel's model reads them), and `pivots.last` the newest pivot's date
    data = {"symbol": sym, "session": _day(got.get("session")), "data_through": through, "first": _day(got.get("first")),
            "sessions": _whole(got.get("sessions")), "read_at": read_at,
            "source": got.get("source") if isinstance(got.get("source"), str) else None,
            "basis": got.get("basis") if isinstance(got.get("basis"), str) else None,
            "suspect_jump_pct": _whole(got.get("suspect_jump_pct")), "earnings": earnings,
            "accumulation": accumulation, "pivots": pivots, "gaps": gaps, "stale_for": stale_for,
            "left_out": ["big_days", "ad_days"]}
    windows = [w for w in (accumulation.get("windows") or []) if isinstance(w, dict)]
    coverage = {"evaluated": len(windows), "answered": len(wide), "dropped": 0, "not_computable": len(windows) - len(wide)}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=close_as_of(through), source=SOURCE,
                             data=data, stale=bool(stale_for), coverage=coverage, notes=notes, provider_calls=0)
