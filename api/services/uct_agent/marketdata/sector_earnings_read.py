"""MD-1 kind `earnings.seasonBySector` (owner: terminal-data, data wave 11) — an earnings season by sector, as held.

For one season (the one that holds today, the one before it, or the same one a year earlier): how many of the stocks UCT
holds earnings results for reported, are still to report or are past their date with the result not in UCT's copy yet;
per sector and in total the EPS and revenue beat / in line / miss shares with their counts, the median surprise, and the
reaction (the median move from the close before the report to the close after, and the share that rose); for the season
that holds today, each sector's line for the same season a year earlier; and the coverage first. The Agent half of
ERNSC, over the answer of `GET /api/research/sector-earnings?season=…` (`api/services/sector_earnings.py`), with the
route's own field names (the ERNSC panel's model reads them).

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `sector_earnings.get_season` answers
through `held_build.HeldBuild.get()`, which STARTS the one background read of every stock's held earnings copy when the
held answer is due, and with nothing held waits on it. A turn must not, so this adapter never calls it. It reads through
`sector_earnings_held.held_season()`, the route's own table shaped over `sector_earnings.peek()`, which never starts a
read. provider_calls is always 0. A rail shows `get_season` starting that read in the same state.

NOTHING HELD IS SAID, NEVER "NO REPORTS": nothing held is `unavailable` with that reason. A season in which nothing has
reported yet is an answer (every count 0), said as such; a share or a median resting on fewer than five reporters is
null with its count kept, never 0.

WHAT IS STATED: every figure is the service's own (`sector_earnings_calc.figures`), passed through; nothing is recomputed
here. COVERAGE FIRST: only the stocks UCT holds an earnings copy for are counted, and the answer says how many of the
universe that is. Each sector's reporters, the stocks still to report and the ones whose result has not reached UCT
are left out, and a note says the ERNSC panel shows them. At most `MAX_SECTORS` sectors (the map has about a dozen); a
cut is said.

TIME (MD-1 §3): `as_of` = the start of the Eastern day of the newest earnings copy UCT held (`coverage.newest_copy`), the
data's own date, with the oldest beside it; never the time of the read. When UCT added them up rides as
`data.built_at`. The read is `stale`, with a note, when the held answer was added up on an earlier day than today (the
service's own refresh rule: the seasons and "still to report" move with the date): this read never adds them up again.
Every read is `periodic`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the actual and consensus figures and the surprises are the earnings
vendors' (docs/terminal-research/09-security-licensing-cost/licensing-register.md, row T-36: FMP's earnings history and
surprises for member display; row T-44: FMP's numbers into a model, "No AI clause"; row T-53: Finnhub's derived
earnings rollups; row T-54: Finnhub's fields into a model, class R), and the reactions are worked out from UCT's daily
bar store (rows T-04 and T-09: the market-data vendor's daily history, its display and its storage; row T-14: the
vendor's numbers into a model, restricted). No row of that register clears these figures for a model provider. The same
rule as `earnings.reactions` and `earnings.season`. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole, day_as_of
from api.services.uct_agent.marketdata.stock_stats_read import tree

KIND = "earnings.seasonBySector"
SOURCE = "uct-sector-earnings"
SEASONS = ("current", "previous", "year_ago")      # sector_earnings_calc.SEASON_IDS (a rail pins the two together)
DEFAULT_SEASON = "current"
MAX_SECTORS = 30
#: one sector's (or the total's) figures, by the service's own names (sector_earnings_calc.figures, season_slice)
FIGURE_FIELDS = ("name", "on_file", "reported", "to_report", "awaiting", "eps", "rev", "move")
SEASON_WORDS = {"current": "the season that holds today", "previous": "the season before it",
                "year_ago": "the same season a year earlier"}

NOTE_WHAT = ("{label} earnings season ({which}) by sector as UCT added it up for ERNSC, from the earnings results it "
             "holds for {held} of the {universe} stocks in its universe, not every company that reports: per sector the "
             "EPS and revenue beat, in line and miss shares (a surprise within {in_line}% either way is in line), the "
             "median surprise and the median move from the close before the report to the close after. A record of "
             "results, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the day of the newest earnings copy UCT held ({newest}; the oldest is {oldest}); it is never the "
              "time of the read. UCT added them up at {at} (UCT's own time)")
NOTE_NO_COPY = "`as_of` is null: no earnings copy UCT held carries a read day, so the figures carry no date"
NOTE_OLD_COPIES = "{n} of the held copies are more than {days} days old, so a recent report may not be counted yet"
NOTE_STALE = ("UCT added these up on {built}; a newer day has begun ({today}), so the counts still to report and past "
              "due may have moved, and this read never adds them up again")
NOTE_FLOOR = "a share or a median needs {min} reporters: a sector with fewer gives its counts and no figure (never 0)"
NOTE_NONE_YET = "no stock UCT holds results for has reported in this season yet, and none is due: every count is 0"
NOTE_NO_SECTOR = "{n} of the held stocks have no sector on file: they are counted on their own row"
NOTE_CUT = "{total} sectors are held and the first {shown} are returned: the list is cut from the end of the server's order"
NOTE_LEFT_OUT = ("each sector's reporters, the stocks still to report and the ones whose result has not reached UCT are "
                 "not in this read: the ERNSC panel shows them")
NOTE_NOT_HELD = ("earnings season by sector is not held on this server yet, and this read never adds it up. That is not "
                 "the same as no reports. Open ERNSC in UCT, then ask again")
NOTE_FAILED = "the earnings season read failed; nothing is stated. That is not the same as no reports"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if params.get("season", DEFAULT_SEASON) not in SEASONS:
        return "`season` must be current, previous or year_ago"
    return None


def held_answer(season: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the route's own table for `season`, 'held' | 'not_held'), WITHOUT starting a read
    (`sector_earnings_held.held_season`)."""
    from api.services import sector_earnings_held as svc
    return svc.held_season(season)


def _figures(f: Any, with_year_ago: bool) -> Optional[dict]:
    if not isinstance(f, dict):
        return None
    out = {k: tree(f.get(k)) for k in FIGURE_FIELDS if k in f}
    if with_year_ago:
        out["year_ago"] = _figures(f.get("year_ago"), False)
    return out


def _today() -> str:
    from api.services import sector_earnings as svc
    return svc._today().isoformat()


def read_season(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    season = params.get("season", DEFAULT_SEASON)
    try:
        got, how = held_answer(season)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how != "held" or not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    try:
        return _answer(params, got, season)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, got: dict, season: str) -> dict:
    cov = got.get("coverage") if isinstance(got.get("coverage"), dict) else {}
    coverage = {k: (_day(cov.get(k)) if k.endswith("_copy") else _whole(cov.get(k)))
                for k in ("universe", "held", "not_held", "no_sector", "oldest_copy", "newest_copy", "copies_old", "old_days")}
    seasons = {sid: tree(s) for sid, s in (got.get("seasons") or {}).items() if sid in SEASONS and isinstance(s, dict)}
    label = (seasons.get(season) or {}).get("label") or "The"
    built_at, built_day, today = _read_at(got.get("built_at")), _day(got.get("today")), _today()
    total = _figures(got.get("total"), season == "current")
    sectors = [_figures(s, season == "current") for s in (got.get("sectors") or []) if isinstance(s, dict)]
    shown = sectors[:MAX_SECTORS]
    in_line = _num(got.get("in_line_pct"))
    notes = [NOTE_WHAT.format(label=label, which=SEASON_WORDS[season], held=coverage["held"] or 0,
                              universe=coverage["universe"] or 0, in_line=in_line if in_line is not None else 0.5)]
    newest = coverage["newest_copy"]
    notes.append(NOTE_AS_OF.format(newest=newest, oldest=coverage["oldest_copy"] or "not given", at=built_at or "a time it does not give")
                 if newest else NOTE_NO_COPY)
    if coverage["copies_old"]:
        notes.append(NOTE_OLD_COPIES.format(n=coverage["copies_old"], days=coverage["old_days"] or 7))
    stale = bool(built_day and built_day < today)
    if stale:
        notes.append(NOTE_STALE.format(built=built_day, today=today))
    notes.append(NOTE_FLOOR.format(min=_whole(got.get("min_reporters")) or 5))
    t = total or {}
    if not (t.get("reported") or t.get("to_report") or t.get("awaiting")):
        notes.append(NOTE_NONE_YET)
    if coverage["no_sector"]:
        notes.append(NOTE_NO_SECTOR.format(n=coverage["no_sector"]))
    if len(sectors) > len(shown):
        notes.append(NOTE_CUT.format(total=len(sectors), shown=len(shown)))
    notes.append(NOTE_LEFT_OUT)
    data = {"season": season, "seasons": seasons, "today": built_day, "built_at": built_at, "coverage": coverage,
            "total": total, "sectors": shown, "count": len(sectors), "in_line_pct": in_line, "in_line_abs": _num(got.get("in_line_abs")),
            "min_reporters": _whole(got.get("min_reporters")), "season_rule": tree(got.get("season_rule")),
            "stale_for": ["earlier_day"] if stale else [], "left_out": ["reporters", "upcoming", "late"]}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=day_as_of(newest), source=SOURCE,
                             data=data, stale=stale,
                             coverage={"evaluated": coverage["universe"] or 0, "answered": coverage["held"] or 0, "dropped": 0,
                                       "not_computable": coverage["not_held"] or 0},
                             notes=notes, provider_calls=0)
