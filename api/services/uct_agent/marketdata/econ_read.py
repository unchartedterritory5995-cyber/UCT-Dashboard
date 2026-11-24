"""MD-1 kinds `econ.latest`, `market.liquidity` and `market.oil` (owner: terminal-data, data wave 13) — UCT's published
economic series as the ECON, LIQ and OIL panels show them, as held.

  econ.latest       ECON: the economy board's series (inflation, jobs, growth and spending, housing, rates and money):
                    each one's newest points (the reading, the one before it, their periods and release times), its
                    registry meta (name, units, frequency, source line) and its next release from the release calendar
  market.liquidity  LIQ: the Fed's total assets, the Treasury General Account (weekly and daily), overnight reverse repo,
                    reserves, M2 and SOFR, with the history the panel's net liquidity line is worked out from (two years
                    of the three inputs, a few weeks of the two daily parts)
  market.oil        OIL: the EIA's weekly oil figures (crude, gasoline and distillate stocks, the SPR, production,
                    refinery utilization, pump prices) with the econ service's own weekly crude change, and the history
                    the panel reads (two years of crude stocks, a year and some weeks of the rest)

Each is the answer of `GET /api/econ/latest?symbols=…` for the panel's own series (the route's own row shape), and for
LIQ and OIL the points `GET /api/econ/series/{symbol}` gives over the panel's windows. Nothing is worked out here: the
member's answer works the board, the net liquidity calculation and the build or draw out with the panels' own pure
models (`economyModel.js`, `liquidityModel.js`, `oilModel.js`), whose series lists these tuples mirror (a rail pins them).

⛔ ONLY WHAT THE ECONOMICS SERVING CACHE ALREADY HOLDS, NEVER A REQUEST (MD-1 §5). On a cold cache the econ routes read
the published files from the data bucket (a request off the server). This adapter reads `econ_held.held_latest` and
`econ_held.held_history` instead (the cache's own entries; never a load). A series the cache does not hold is
`not_held`, said; with none held the read is `unavailable`. provider_calls is always 0. A rail shows the route reading
the bucket in the same state.

THE ROUTES' SWITCH IS RESPECTED EXACTLY: the econ routes answer 404 unless ECON_ENABLED=1; with it off every read here is
`unavailable`, never an empty board.

NEVER A FORECAST: the next release is the release calendar's date for the next publication, never a figure. A reading the
agency did not publish stays null ("no figure"), never 0.

TIME (MD-1 §3): `as_of` = the newest first-release time among the newest points returned (the data's own time, when the
agency published it), never the time of the read; each row carries its own period, release time and the time the serving
cache read it. Every read is `periodic`; the kinds are DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the series come from the primary agencies through UCT's econ store (the
register's Economic Data note: "Licensed economic data comes from the primary agencies (BLS, BEA, Census, Fed Board, NY
Fed, Treasury, EIA, DOL, FHFA)"); no row of docs/terminal-research/09-security-licensing-cost/licensing-register.md names
these series or a model lane for them; the nearest row, N-14 (economic events — calendar and macro series), is "R", and
FRED, which the store never uses, is RED with an LLM ban (rows T-59, T-60). The store's own registry marks a few series
YELLOW (a regional Reserve Bank's website terms). No row clears them for a model provider; the narrower rule is kept, as
the Fed watch's rates (§4.18) keep it. Shown to the member only; the capabilities are local-only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from api.services.uct_agent.marketdata import envelope as env

SOURCE = "uct-econ"
ECON_KIND = "econ.latest"
LIQ_KIND = "market.liquidity"
OIL_KIND = "market.oil"
KINDS = (ECON_KIND, LIQ_KIND, OIL_KIND)
#: the panels' own series, in their order (economyModel.js ECON_SYMBOLS, liquidityModel.js LIQ_SYMBOLS, oilModel.js
#: OIL_SYMBOLS; a browser rail reads both files and pins them equal)
ECON_SYMBOLS = ("USCPIYOY", "USCPIMOM", "USCORECPIYOY", "USCORECPIMOM", "USPCEPIYOY", "USPCEPIMOM", "USCOREPCEYOY",
                "USCOREPCEMOM", "USPPIYOY", "USPPIMOM", "USNFPCHG", "USUNRATE", "USICSA", "USAHEYOY", "USJOLTSO", "USRGDPQA",
                "USINDPRO", "USPERSINC", "USPCE", "USHOUST", "USPERMIT", "USNEWHOME", "USFHFAHPIYOY", "USEFFR", "UST10Y",
                "USDOLLARIDX")
LIQ_SYMBOLS = ("USFEDBAL", "USTGAFED", "USTGA", "USRRP", "USRESBAL", "USM2", "USM2YOY", "USSOFR")
OIL_SYMBOLS = ("USCRUDEINV", "USCRUDEINVCHG", "USGASINV", "USDISTINV", "USSPR", "USCRUDEPROD", "USREFUTIL", "USGASPRICE",
               "USDIESELPRICE")
#: the history each panel reads, in calendar days back from each series' newest period end (the panels read from the
#: first of the month 25, 14 or 2 months back: the same windows, counted from the data instead of the day of the ask)
LIQ_HISTORY = {"USFEDBAL": 790, "USTGAFED": 790, "USRRP": 790, "USTGA": 70, "USSOFR": 70}
OIL_HISTORY = {s: (790 if s == "USCRUDEINV" else 430) for s in OIL_SYMBOLS}
PANELS = {ECON_KIND: "ECON", LIQ_KIND: "LIQ", OIL_KIND: "OIL"}
WHAT = {ECON_KIND: "the economy board", LIQ_KIND: "the liquidity figures", OIL_KIND: "the weekly oil figures"}

NOTE_WHAT = ("{what} as UCT holds it for the {panel} panel: UCT's published economic series from the agencies' own "
             "releases, each with its newest readings, their periods and release times, and its next release from the "
             "release calendar. Official figures, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the newest release time among the readings returned ({at}); it is never the time of the read, and "
              "this read never reads the econ store's files")
NOTE_NO_TIME = "`as_of` is null: no reading returned carries a release time"
NOTE_SOME_NOT_HELD = ("{n} of the {total} series are not held in the server's economics cache yet, and this read never loads "
                      "them: {names}. That is not the same as no figure")
NOTE_NOT_FOUND = "{n} of the series are not among those this server publishes: {names}"
NOTE_HISTORY = ("the history returned is each series' points within {days} days of its newest period, from the same held "
                "series; a series not held has none")
NOTE_SWITCHED_OFF = ("the economic data is switched off on this server (its routes answer nothing), so it is not read. That "
                     "is not the same as no figure")
NOTE_NOT_HELD = ("{what} is not held in the server's economics cache yet, and this read never loads it. That is not the same "
                 "as no figure. Open {panel} in UCT, then ask again")
NOTE_FAILED = "the read of {what} failed; nothing is stated. That is not the same as no figure"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. These kinds take no parameter."""
    if not isinstance(params, dict):
        return "the request must be an object"
    return None


def switched_on() -> bool:
    """The econ routes' own switch (`econ_held.enabled`, ECON_ENABLED, read per call)."""
    from api.services import econ_held
    return econ_held.enabled()


def held_latest(symbols: tuple) -> dict:
    """READ ONLY: `serving.latest`'s answer from held series only (`econ_held.held_latest`)."""
    from api.services import econ_held
    return econ_held.held_latest(symbols)


def held_history(symbol: str, days: int) -> Optional[list]:
    """READ ONLY: one held series' points over a window (`econ_held.held_history`)."""
    from api.services import econ_held
    return econ_held.held_history(symbol, days)


def _iso(t) -> Optional[str]:
    if isinstance(t, bool) or not isinstance(t, (int, float)) or t <= 0:
        return None
    return env.utc_iso(datetime.fromtimestamp(t, tz=timezone.utc))


def _read(kind: str, params: dict, symbols: tuple, history: Optional[dict]) -> dict:
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    what, panel = WHAT[kind], PANELS[kind]
    try:
        if not switched_on():
            return env.unavailable(kind, params, SOURCE, NOTE_SWITCHED_OFF)
        body = held_latest(symbols)
        rows = [r for r in body.get("series") or [] if isinstance(r, dict)]
        if not any(r.get("state") in ("ok", "no_data") for r in rows):
            return env.unavailable(kind, params, SOURCE, NOTE_NOT_HELD.format(what=what[0].upper() + what[1:], panel=panel))
        histories = None
        if history is not None:
            held = {r.get("symbol") for r in rows if r.get("state") == "ok"}
            histories = {s: ({"symbol": s, "columns": body.get("columns"), "points": held_history(s, d) or []} if s in held else None)
                         for s, d in history.items()}
    except Exception:  # noqa: BLE001
        return env.unavailable(kind, params, SOURCE, NOTE_FAILED.format(what=what))
    t_col = (body.get("columns") or ["t"]).index("t") if "t" in (body.get("columns") or ["t"]) else 0
    newest = [r["points"][-1][t_col] for r in rows if r.get("state") == "ok" and r.get("points")]
    at = _iso(max((t for t in newest if isinstance(t, (int, float)) and not isinstance(t, bool)), default=None))
    not_held = [r["symbol"] for r in rows if r.get("state") == "not_held"]
    not_found = [r["symbol"] for r in rows if r.get("state") == "not_found"]
    notes = [NOTE_WHAT.format(what=what[0].upper() + what[1:], panel=panel), NOTE_AS_OF.format(at=at) if at else NOTE_NO_TIME]
    if not_held:
        notes.append(NOTE_SOME_NOT_HELD.format(n=len(not_held), total=len(rows), names=", ".join(not_held)))
    if not_found:
        notes.append(NOTE_NOT_FOUND.format(n=len(not_found), names=", ".join(not_found)))
    if history is not None:
        notes.append(NOTE_HISTORY.format(days=" or ".join(str(d) for d in sorted(set(history.values()), reverse=True))))
    latest = {**body, "not_held": not_held}
    data = latest if history is None else {"latest": latest, "histories": histories, "history_days": dict(history)}
    return env.make_envelope(kind, params, status="partial" if not_held else "ok", freshness="periodic", as_of=at,
                             source=SOURCE, data=data, notes=notes, provider_calls=0)


def read_econ(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    return _read(ECON_KIND, params, ECON_SYMBOLS, None)


def read_liquidity(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    return _read(LIQ_KIND, params, LIQ_SYMBOLS, LIQ_HISTORY)


def read_oil(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    return _read(OIL_KIND, params, OIL_SYMBOLS, OIL_HISTORY)
