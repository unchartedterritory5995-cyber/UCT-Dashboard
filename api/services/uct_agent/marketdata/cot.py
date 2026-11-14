"""MD-1 kind `cot.positioning` (owner: agent-md, Phase 2 COT research) — CFTC Commitments of Traders, read-only.

A thin adapter over the COT tab's own store: `services/cot_service.get_cot_data(symbol, weeks)` (the `cot_records`
table in /data/cot.db — weekly large-spec / commercial / small-spec NET positions and open interest, about ten years
seeded from CFTC's public zips). No provider call, no write, no refresh: this adapter never downloads and never
triggers the service's self-heal (`get_status()` would; it is not called here).

What it returns: the stored weekly ROWS for 1..MAX_MARKETS markets, unchanged, plus the labels a member needs to read
them honestly. It derives NO positioning statistic: the COT Index, zones, percentile ranks and changes are computed in
the browser by the COT tab's single analytics authority (app/src/pages/cot/cotRead.js — CLAUDE.md "Do not port any of
this to Python"), through app/src/agent/capabilities/cot.js.

TIME (MD-1 §3: the data's own time)
  * `as_of` = the CFTC REPORT date (the Tuesday the positions describe), as UTC midnight — the OLDEST newest-report
    across the markets read, so a comparison never claims a newer week than every market has.
  * Positions are Tuesday's; CFTC publishes them the following Friday afternoon (delay_s = 3 days, a fixed schedule).
  * `stale` when that report date is older than `cot_service.expected_latest_report_date(now)` — the service's OWN
    publish-calendar rule (Friday 4:30 PM ET), reused, never restated here. A store that missed a release is stale.
  * freshness `periodic` (a weekly report published on a schedule).

Symbols: a member's word ("gold", "crude", "the S&P", "10-year", "euro") or a stored code (GC, CL, ES, ZN, E6) is
resolved against `cot_service.SYMBOL_MAP` / `SYMBOL_NAMES` plus the alias table below. An unmapped word is never
guessed: it is listed in `not_covered`, and the covered roster (code + name, from the service) rides along so the
member can be told what IS covered. A mapped market with no stored rows is `no_history` — refused, never filled.

Access: served only through the gateway (`POST /api/agent/data`, `require_admin_dark` → `require_paid`), and only
while UCT_AGENT_DATA=1 and `cot.positioning` is listed in UCT_AGENT_DATA_KINDS (fail-closed). No other door reads it.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "cot.positioning"
SOURCE = "cftc-cot"
MAX_MARKETS = 6
MAX_WEEKS = 520                      # the COT route's own bound (api/routers/cot.py GET /{symbol})
DEFAULT_WEEKS = 160
DELAY_S = 3 * 86400                  # Tuesday positions, published Friday
_ET = ZoneInfo("America/New_York")
_WORD_RE = re.compile(r"^[A-Za-z0-9&.\-/' ]{1,40}$")

NOTE_WEEKLY = "weekly data: CFTC Commitments of Traders (legacy futures-only report), net positions per trader group"
NOTE_DELAY = ("positions are as of the Tuesday report date; CFTC publishes them the following Friday, so they are "
              "about three days old when released")
NOTE_STALE = "the newest stored report is {got}; the report expected by now is {want}, so this is not the latest week"
NOTE_NOT_COVERED = "not covered by UCT's COT data: {words}"
NOTE_NO_HISTORY = "no stored COT history for: {codes}"
NOTE_SHORT = "the store holds {n} weeks for {code}, fewer than the {want} asked for"

#: member words → stored COT code. Only unambiguous names; anything else is "not covered", never a guess.
ALIASES: dict[str, str] = {
    # indices
    "s&p": "ES", "s&p 500": "ES", "s&p500": "ES", "sp500": "ES", "sp 500": "ES", "spx": "ES", "e-mini s&p": "ES",
    "es": "ES", "s and p": "ES", "s and p 500": "ES",
    "nasdaq": "NQ", "nasdaq 100": "NQ", "nasdaq-100": "NQ", "ndx": "NQ", "nq": "NQ",
    "dow": "YM", "dow jones": "YM", "djia": "YM", "ym": "YM",
    "russell": "QR", "russell 2000": "QR", "rut": "QR",
    "midcap": "EW", "s&p 400": "EW", "s&p midcap": "EW",
    "vix": "VI", "nikkei": "NK", "nikkei 225": "NK",
    # metals
    "gold": "GC", "silver": "SI", "copper": "HG", "platinum": "PL", "palladium": "PA", "aluminum": "AL", "aluminium": "AL",
    # energies
    "crude": "CL", "crude oil": "CL", "oil": "CL", "wti": "CL", "wti crude": "CL", "heating oil": "HO", "ulsd": "HO",
    "gasoline": "RB", "rbob": "RB", "natural gas": "NG", "natgas": "NG", "nat gas": "NG", "ethanol": "FL",
    "brent": "BZ", "brent crude": "BZ",
    # grains
    "wheat": "ZW", "chicago wheat": "ZW", "kc wheat": "KE", "spring wheat": "MW", "corn": "ZC", "soybeans": "ZS",
    "soybean": "ZS", "soy": "ZS", "beans": "ZS", "soybean meal": "ZM", "soymeal": "ZM", "soybean oil": "ZL",
    "soy oil": "ZL", "rice": "ZR", "rough rice": "ZR", "oats": "OA", "canola": "RS",
    # softs
    "cotton": "CT", "orange juice": "OJ", "oj": "OJ", "coffee": "KC", "sugar": "SB", "cocoa": "CC", "lumber": "LB",
    # livestock & dairy
    "cattle": "LE", "live cattle": "LE", "feeder cattle": "GF", "hogs": "HE", "lean hogs": "HE", "milk": "DL",
    "class iii milk": "DL", "butter": "BD", "cheese": "BJ", "nonfat dry milk": "DF",
    # rates
    "bonds": "ZB", "t-bond": "ZB", "t-bonds": "ZB", "30-year": "ZB", "30 year": "ZB", "30y": "ZB", "long bond": "ZB",
    "30-year bond": "ZB", "30 year bond": "ZB", "ultra bond": "UD", "ultra t-bond": "UD",
    "10-year": "ZN", "10 year": "ZN", "10y": "ZN", "ten-year": "ZN", "ten year": "ZN", "tens": "ZN",
    "10-year note": "ZN", "10 year note": "ZN", "10-year treasury": "ZN", "10 year treasury": "ZN", "t-note": "ZN",
    "5-year": "ZF", "5 year": "ZF", "5y": "ZF", "five-year": "ZF", "five year": "ZF",
    "2-year": "ZT", "2 year": "ZT", "2y": "ZT", "two-year": "ZT", "two year": "ZT",
    "fed funds": "ZQ", "sofr": "SR3",
    # currencies & crypto
    "dollar": "DX", "us dollar": "DX", "dollar index": "DX", "dxy": "DX", "usd": "DX",
    "pound": "B6", "british pound": "B6", "sterling": "B6", "gbp": "B6", "cable": "B6",
    "canadian dollar": "D6", "loonie": "D6", "cad": "D6", "yen": "J6", "japanese yen": "J6", "jpy": "J6",
    "swiss franc": "S6", "franc": "S6", "chf": "S6", "euro": "E6", "eur": "E6", "euro fx": "E6",
    "aussie": "A6", "australian dollar": "A6", "aud": "A6", "peso": "M6", "mexican peso": "M6", "mxn": "M6",
    "kiwi": "N6", "new zealand dollar": "N6", "nzd": "N6", "rand": "T6", "south african rand": "T6",
    "brazilian real": "L6", "bitcoin": "BTC", "btc": "BTC", "ether": "ETH", "ethereum": "ETH", "eth": "ETH",
}
_FILLER = re.compile(r"^(?:the|a)\s+|\s+(?:futures?|contracts?|market|prices?)$")


def _svc():
    from api.services import cot_service
    return cot_service


def _norm(word: str) -> str:
    w = re.sub(r"\s+", " ", str(word or "").strip().lower().replace("’", "'"))
    w = w[:-2].strip() if w.endswith("'s") else w
    prev = None
    while prev != w:
        prev, w = w, _FILLER.sub("", w).strip()
    return w


def resolve(word: str) -> Optional[str]:
    """A member's word or a stored code → the stored COT code, or None (never a guess)."""
    svc = _svc()
    raw = str(word or "").strip()
    if raw.upper() in svc.SYMBOL_MAP:
        return raw.upper()
    w = _norm(raw)
    if w.upper() in svc.SYMBOL_MAP:
        return w.upper()
    if w in ALIASES and ALIASES[w] in svc.SYMBOL_MAP:
        return ALIASES[w]
    for code, name in svc.SYMBOL_NAMES.items():
        if w == name.lower():
            return code
    return None


def covered() -> list[dict]:
    """The covered roster, from the service (code, name, group) — the COT tab's own groups, 'MOST WATCHED' excluded."""
    svc = _svc()
    group_of: dict[str, str] = {}
    for g, codes in svc.SYMBOL_GROUPS.items():
        if g == "MOST WATCHED":
            continue
        for c in codes:
            group_of.setdefault(c, g.title())
    return [{"symbol": c, "name": svc.SYMBOL_NAMES.get(c, c), "group": group_of.get(c)} for c in svc.SYMBOL_MAP]


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate): the request's SHAPE only. Whether a word is covered is the read's answer."""
    syms = params.get("symbols")
    if not isinstance(syms, list) or not syms:
        return "`symbols` must be a list of 1-6 market names or COT codes"
    if len(syms) > MAX_MARKETS:
        return f"at most {MAX_MARKETS} markets per read"
    if not all(isinstance(s, str) and _WORD_RE.match(s.strip() or "!") for s in syms):
        return "each market must be a short name or COT code"
    weeks = params.get("weeks", DEFAULT_WEEKS)
    if not isinstance(weeks, int) or isinstance(weeks, bool) or not 1 <= weeks <= MAX_WEEKS:
        return f"`weeks` must be a whole number from 1 to {MAX_WEEKS}"
    return None


def now_et() -> datetime:
    return datetime.now(_ET)


def _missing_weeks(rows: list[dict]) -> int:
    """Report weeks absent between the first and last stored row (a gap > 7 days), never filled."""
    n = 0
    for a, b in zip(rows, rows[1:]):
        gap = (date.fromisoformat(b["date"]) - date.fromisoformat(a["date"])).days
        if gap > 7:
            n += round(gap / 7) - 1
    return n


def _clean(r: dict) -> Optional[dict]:
    try:
        d = date.fromisoformat(str(r.get("date"))[:10]).isoformat()
        return {"date": d, **{k: int(r[k]) for k in ("large_spec_net", "commercial_net", "small_spec_net", "open_interest")}}
    except (TypeError, ValueError, KeyError):
        return None


def read_cot(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    svc = _svc()
    weeks = params.get("weeks", DEFAULT_WEEKS)
    words = [s.strip() for s in params["symbols"]]
    codes: list[str] = []
    not_covered: list[str] = []
    for w in words:
        c = resolve(w)
        if c is None:
            not_covered.append(w)
        elif c not in codes:
            codes.append(c)

    series: list[dict] = []
    no_history: list[str] = []
    notes = [NOTE_WEEKLY, NOTE_DELAY]
    for c in codes:
        rows = [x for x in (_clean(r) for r in (svc.get_cot_data(c, weeks) or [])) if x]
        rows.sort(key=lambda r: r["date"])
        if not rows:
            no_history.append(c)
            continue
        if len(rows) < weeks:
            notes.append(NOTE_SHORT.format(n=len(rows), code=c, want=weeks))
        series.append({"symbol": c, "name": svc.SYMBOL_NAMES.get(c, c), "first_date": rows[0]["date"],
                       "report_date": rows[-1]["date"], "weeks": len(rows), "missing_weeks": _missing_weeks(rows),
                       "rows": rows})

    if not_covered:
        notes.append(NOTE_NOT_COVERED.format(words=", ".join(not_covered)))
    if no_history:
        notes.append(NOTE_NO_HISTORY.format(codes=", ".join(no_history)))
    roster = covered() if (not_covered or no_history) else None
    expected = svc.expected_latest_report_date(now_et())
    if not series:
        # nothing to show: an honest partial with the roster, never a figure
        return env.make_envelope(KIND, params, status="partial", freshness="periodic", as_of=None, source=SOURCE,
                                 data={"series": [], "not_covered": not_covered, "no_history": no_history,
                                       "covered": roster, "expected_report_date": expected.isoformat(),
                                       "delay_days": DELAY_S // 86400},
                                 delay_s=DELAY_S, notes=notes + ["no market in this request has stored COT data"],
                                 coverage={"requested": len(words), "answered": 0})

    report = min(date.fromisoformat(s["report_date"]) for s in series)
    stale = report < expected
    for s in series:
        s["stale"] = date.fromisoformat(s["report_date"]) < expected
    if stale:
        notes.append(NOTE_STALE.format(got=report.isoformat(), want=expected.isoformat()))
    data = {"series": series, "not_covered": not_covered, "no_history": no_history, "covered": roster,
            "report_date": report.isoformat(), "expected_report_date": expected.isoformat(),
            "delay_days": DELAY_S // 86400}
    as_of = env.utc_iso(datetime(report.year, report.month, report.day, tzinfo=timezone.utc))
    return env.make_envelope(KIND, params, status="partial" if (not_covered or no_history) else "ok",
                             freshness="periodic", as_of=as_of, source=SOURCE, data=data, delay_s=DELAY_S,
                             stale=stale, notes=notes, provider_calls=0,
                             coverage={"requested": len(words), "answered": len(series)})
