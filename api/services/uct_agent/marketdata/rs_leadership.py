"""MD-1 kind `rs.leadership` (owner: agent-md, Phase 2 market intelligence) — relative strength and group
leadership from UCT's OWN stored data, read-only. MODEL-ISOLATED (ADR-005, like `ratings` / `breadth.current`).

One kind, four scopes (`scope`):
  * symbols   1-6 tickers (stocks or ETFs): each one's UCT RS Rating, its change over 5 / 20 stored sessions, its
              1M / 3M / 6M / 12M RS components, its price return over the period and that return minus SPY's over
              the SAME window — and, for a stock, where it sits in its own industry (rank k of n rated members, the
              industry's median rating now and 20 sessions ago over the same members);
  * sectors   the 11 SPDR Select Sector ETFs (sector_strength.SECTOR_ETFS, the Dashboard's Sector Flow roster),
              ranked by the period's return, each with its RS Rating and change;
  * industry  one industry group (the Finviz industry taxonomy in industry_map): the median RS Rating of its rated
              members now and 20 sessions ago (paired members), how many sit at 80+, rising vs falling counts, and
              its five highest-rated members;
  * backdrop  the index ETFs (groups.MACRO_CORE: SPY, QQQ, IWM, DIA) plus the sector rows — the browser adds the
              breadth reading (breadth.current) beside it, each fact with its own source and date.

SOURCES (no provider call, no write, no refresh — `provider_calls` is always 0):
  * the RS Rating: `screener.rs_history.read_fields` — the nightly IBD-style rating table the chart's UCT RS prints
    (`rs_rating_history`; the weights and the population are rs_history's own docstring, never restated here). Its
    own stale rule (`STALE_DAYS` behind the settled session) is reused: its `failures` note decides `stale`.
  * returns: the canonical bars store, read exactly as `bars.daily` reads it (bars_sqlite.get_bars_before +
    bars_fetch._fmt_sqlite_bars under bars_sanitize.suppress_meta_warm: no cold metadata fetch), completed sessions
    only. A return is close[-1] / close[-1-n] - 1 over n stored sessions; "vs SPY" is given ONLY when SPY's window has
    the same first and last session (never mixed windows).
  * groups: `industry_map.peek_groups` / `peek_industries` / `peek_members` — the persisted map only, READ-ONLY and fail closed (the
    side-effect-free read; get_groups would queue provider fallbacks).

An industry word is resolved against the map's OWN industry names (exact, a short alias table, or a unique contained
match); several matches are `ambiguous` with the candidates, none is `not_covered` — never a guess, never a figure.

Everything here is a historical observation of stored data. Nothing forecasts.

Access: served only through the gateway (`POST /api/agent/data`, `require_admin_dark` → `require_paid`), only while
UCT_AGENT_DATA=1, `rs.leadership` is listed in UCT_AGENT_DATA_KINDS (fail-closed) and, being model-isolated,
UCT_AGENT_ISOLATED=1 — and then for purpose "answer" only. The RS ranking / sector strength / groups routes it mirrors
are all `require_paid`; this door is stricter (paid AND admin while the Agent is dark).
"""
from __future__ import annotations

import re
import statistics
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "rs.leadership"
SOURCE = "uct-rs"
SCOPES = ("symbols", "sectors", "industry", "backdrop")
#: trading sessions per period: 1W / 1M / 3M are sector_strength.PERIOD_TO_BARS's own; 6M is rs_history's 126
PERIODS = {"1W": 5, "1M": 21, "3M": 63, "6M": 126}
DEFAULT_PERIOD = "1M"
MAX_SYMBOLS = 6
BENCHMARK = "SPY"
LEADER_RATING = 80                      # "80+": the share of a group's members rated at or above it
TOP_N = 5
MAX_COHORT = 1500                       # a bound on one industry's members read (the largest Finviz industry is far below)
_ET = ZoneInfo("America/New_York")
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_WORD_RE = re.compile(r"^[A-Za-z0-9&.,\-/' ]{2,60}$")

NOTE_METHOD = ("RS Rating: UCT's nightly IBD-style relative strength rating, 1-99, from weighted 3/6/9/12-month price "
               "performance ranked against every rated US stock (ETFs are placed on the same scale); change = the rating "
               "minus the rating 5 or 20 stored sessions earlier")
NOTE_RETURNS = "returns: completed daily sessions from UCT's bars store; vs SPY only over the identical window"
NOTE_HISTORICAL = "historical observation of stored data, not a forecast"
NOTE_STALE = "the newest stored RS Rating session is {session}, older than the ratings' own freshness rule allows"
NOTE_NO_RATINGS = "no stored RS Rating is available"
NOTE_NOT_RATED = "no RS Rating is stored for: {syms}"
NOTE_NO_BARS = "no completed daily bars are held for: {syms}"
NOTE_INDUSTRY_NOT_COVERED = "no industry in UCT's group map matches: {word}"
NOTE_INDUSTRY_AMBIGUOUS = "several industries match {word}: {names}"
NOTE_NO_GROUP = "not in UCT's group map: {syms}"

#: member words → a Finviz industry name; used only when the map really holds that name
INDUSTRY_ALIASES: dict[str, str] = {
    "semis": "Semiconductors", "semi": "Semiconductors", "semiconductor": "Semiconductors", "chips": "Semiconductors",
    "chip stocks": "Semiconductors", "chipmakers": "Semiconductors", "chip makers": "Semiconductors",
    "semi equipment": "Semiconductor Equipment & Materials", "semiconductor equipment": "Semiconductor Equipment & Materials",
    "biotech": "Biotechnology", "biotechs": "Biotechnology", "regional banks": "Banks - Regional",
    "big banks": "Banks - Diversified", "money center banks": "Banks - Diversified", "solar": "Solar",
    "airlines": "Airlines", "gold miners": "Gold", "homebuilders": "Residential Construction",
    "home builders": "Residential Construction", "reits": None, "software": None,
}
_FILLER = re.compile(r"^(?:the|a|an)\s+|\s+(?:industry|industries|group|groups|stocks?|names|space|sector)$")


# ── seams (monkeypatched in tests; each is a read-only call into an existing UCT service) ──────────────────────────
def _ratings(tickers: list[str], failures: list) -> dict:
    from api.services.screener import rs_history
    return rs_history.read_fields(tickers, failures=failures)


def _groups(tickers: list[str]) -> dict:
    from api.services import industry_map
    return industry_map.peek_groups(tickers)


def _industries() -> list[str]:
    from api.services import industry_map
    return industry_map.peek_industries()


def _members(industry: str) -> list[str]:
    from api.services import industry_map
    return industry_map.peek_members(industry)


def _expected_session() -> int:
    from api.services.uct_agent.marketdata.sessions import last_completed_session
    return last_completed_session()


def _closes(sym: str, n: int, expected: int) -> list[tuple[str, float]]:
    """[(YYYY-MM-DD, close)] oldest first: the newest `n` completed sessions held at or before `expected` (bars.daily's read)."""
    from api.services import bars_fetch, bars_sanitize, bars_sqlite
    rows = bars_sqlite.get_bars_before(sym, "D", n, expected)
    with bars_sanitize.suppress_meta_warm():
        bars = bars_fetch._fmt_sqlite_bars(rows, "D", sym) if rows else []
    out = []
    for b in bars:
        t, c = b.get("t"), b.get("c")
        if isinstance(t, str) and int(t.replace("-", "")) <= expected and isinstance(c, (int, float)) and not isinstance(c, bool):
            out.append((t, float(c)))
    return out


def _sector_etfs() -> dict:
    from api.services.sector_strength import SECTOR_ETFS
    return dict(SECTOR_ETFS)


def _index_etfs() -> tuple:
    from api.services.groups import MACRO_CORE
    return tuple(MACRO_CORE)


def _etf_industry() -> str:
    from api.services.rs_benchmarks import ETF_INDUSTRY
    return ETF_INDUSTRY


# ── pure math (exported for tests) ──────────────────────────────────────────────────────────────────────────────────
def period_return(closes: list[tuple[str, float]], n: int) -> Optional[dict]:
    """{from, to, pct} over the last n sessions, or None when fewer than n+1 closes are held or a close is not positive."""
    if not closes or len(closes) < n + 1:
        return None
    (d0, c0), (d1, c1) = closes[-1 - n], closes[-1]
    if c0 <= 0 or c1 <= 0:
        return None
    return {"from": d0, "to": d1, "pct": round((c1 / c0 - 1) * 100, 2)}


def excess(ret: Optional[dict], bench: Optional[dict]) -> Optional[float]:
    """ret − bench in percentage points, ONLY over the identical window (same first and last session)."""
    if not ret or not bench or ret["from"] != bench["from"] or ret["to"] != bench["to"]:
        return None
    return round(ret["pct"] - bench["pct"], 2)


def _med(vals: list) -> Optional[float]:
    return round(float(statistics.median(vals)), 1) if vals else None


def cohort_stats(ratings: dict, members: list[str], focus: Optional[str] = None) -> dict:
    """A group's RS distribution from stored rows: rated count, median now, the same members' median 20 sessions ago,
    80+ count, rising / falling counts (d20), the five highest, and `focus`'s rank (1 = highest; ties share the rank)."""
    rated = [(t, int(ratings[t]["ibd"])) for t in members if (ratings.get(t) or {}).get("ibd") is not None]
    paired = [(int(ratings[t]["ibd"]), int(ratings[t]["d20"])) for t, _ in rated if ratings[t].get("d20") is not None]
    out = {
        "members": len(members), "rated": len(rated), "median": _med([r for _, r in rated]),
        "paired_20": len(paired),
        "median_paired_now": _med([r for r, _ in paired]),
        "median_paired_20_ago": _med([r - d for r, d in paired]),
        "at_or_above_80": sum(1 for _, r in rated if r >= LEADER_RATING),
        "rising_20": sum(1 for _, d in paired if d > 0), "falling_20": sum(1 for _, d in paired if d < 0),
        "top": [{"symbol": t, "rating": r} for t, r in sorted(rated, key=lambda x: (-x[1], x[0]))[:TOP_N]],
    }
    out["median_change_20"] = (None if out["median_paired_now"] is None
                               else round(out["median_paired_now"] - out["median_paired_20_ago"], 1))
    if focus:
        mine = next((r for t, r in rated if t == focus), None)
        out["focus"] = None if mine is None else {"symbol": focus, "rating": mine,
                                                   "rank": 1 + sum(1 for _, r in rated if r > mine)}
    return out


# ── industry resolution ────────────────────────────────────────────────────────────────────────────────────────────
def _norm(word: str) -> str:
    w = re.sub(r"\s+", " ", str(word or "").strip().lower().replace("’", "'"))
    prev = None
    while prev != w:
        prev, w = w, _FILLER.sub("", w).strip()
    return w


def resolve_industry(word: str, names: list[str]) -> tuple[Optional[str], list[str]]:
    """(industry, []) on one match; (None, candidates) when several match; (None, []) when none. Never a guess."""
    w = _norm(word)
    if not w:
        return None, []
    by_lower = {n.lower(): n for n in names if n}
    if w in by_lower:
        return by_lower[w], []
    if w in INDUSTRY_ALIASES:
        target = INDUSTRY_ALIASES[w]
        if target and target.lower() in by_lower:
            return by_lower[target.lower()], []
    stem = w[:-1] if w.endswith("s") and len(w) > 4 else w
    hits = [n for low, n in sorted(by_lower.items()) if re.search(rf"(?:^|[\s\-&/]){re.escape(stem)}", low)]
    if len(hits) == 1:
        return hits[0], []
    return None, hits[:8]


# ── params ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate): the request's SHAPE only. Coverage is the read's answer."""
    scope = params.get("scope")
    if scope not in SCOPES:
        return "`scope` must be one of " + ", ".join(SCOPES)
    period = params.get("period", DEFAULT_PERIOD)
    if period not in PERIODS:
        return "`period` must be one of " + ", ".join(PERIODS)
    syms = params.get("symbols")
    if scope == "symbols":
        if not isinstance(syms, list) or not syms:
            return f"`symbols` must be a list of 1-{MAX_SYMBOLS} tickers"
        if len(syms) > MAX_SYMBOLS:
            return f"at most {MAX_SYMBOLS} tickers per read"
        if not all(isinstance(s, str) and _SYMBOL_RE.match(s.strip().upper()) for s in syms):
            return "each symbol must be a ticker"
    elif syms not in (None, []):
        return "`symbols` is only for scope symbols"
    ind = params.get("industry")
    if scope == "industry":
        if not isinstance(ind, str) or not _WORD_RE.match(ind.strip() or "!"):
            return "`industry` must be a short industry name"
    elif ind is not None:
        return "`industry` is only for scope industry"
    return None


# ── the read ───────────────────────────────────────────────────────────────────────────────────────────────────────
def _session_close_utc(ymd: str) -> str:
    from api.services import bars_fetch
    d = datetime.strptime(ymd, "%Y-%m-%d")
    mins = bars_fetch._session_close_minutes(int(ymd.replace("-", "")))
    return env.utc_iso(datetime(d.year, d.month, d.day, tzinfo=_ET) + timedelta(minutes=mins))


def _iso(ymd: int) -> str:
    s = str(ymd)
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def _row(sym: str, rating: dict, closes: list, n: int, bench_ret: Optional[dict], expected: int, group: Optional[dict],
         is_etf: bool, label: Optional[str] = None) -> dict:
    ret = period_return(closes, n)
    r = rating or {}
    return {
        "symbol": sym, **({"label": label} if label else {}), "is_etf": is_etf,
        "rated": r.get("ibd") is not None, "rating": r.get("ibd"), "d5": r.get("d5"), "d20": r.get("d20"),
        "m1": r.get("m1"), "m3": r.get("m3"), "m6": r.get("m6"), "m12": r.get("m12"),
        "return": ret, "vs_spy": None if sym == BENCHMARK else excess(ret, bench_ret),
        "bars_through": closes[-1][0] if closes else None,
        "bars_stale": bool(closes) and int(closes[-1][0].replace("-", "")) < expected,
        "sector": (group or {}).get("sector"), "industry": (group or {}).get("industry"),
    }


def read_rs_leadership(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    scope = params["scope"]
    period = params.get("period", DEFAULT_PERIOD)
    n = PERIODS[period]
    expected = _expected_session()
    etf_ind = _etf_industry()
    notes = [NOTE_METHOD, NOTE_RETURNS, NOTE_HISTORICAL]
    data: dict = {"scope": scope, "period": period, "sessions": n, "benchmark": BENCHMARK,
                  "latest_completed_session": _iso(expected), "leader_rating": LEADER_RATING}

    # 1) what to read
    labels: dict[str, str] = {}
    if scope == "symbols":
        syms = []
        for s in params["symbols"]:
            su = s.strip().upper()
            if su not in syms:
                syms.append(su)
    elif scope == "sectors":
        labels = {t: name for name, t in _sector_etfs().items()}
        syms = list(labels)
    elif scope == "backdrop":
        sectors = {t: name for name, t in _sector_etfs().items()}
        idx = list(_index_etfs())
        labels = {**sectors}
        syms = idx + [t for t in sectors if t not in idx]
    else:
        syms = []

    industry = None
    if scope == "industry":
        word = params["industry"].strip()
        industry, candidates = resolve_industry(word, [i for i in _industries() if i != etf_ind])
        if industry is None:
            note = (NOTE_INDUSTRY_AMBIGUOUS.format(word=word, names="; ".join(candidates)) if candidates
                    else NOTE_INDUSTRY_NOT_COVERED.format(word=word))
            data.update({"industry": None, "asked": word, "candidates": candidates, "ambiguous": bool(candidates)})
            return env.make_envelope(KIND, params, status="partial", freshness="periodic", as_of=None, source=SOURCE,
                                     data=data, notes=notes + [note], provider_calls=0,
                                     coverage={"requested": 1, "answered": 0})

    # 2) groups (symbols scope: each stock's industry cohort)
    groups = _groups(syms) if syms else {}
    cohorts: dict[str, list[str]] = {}
    if scope == "symbols":
        for s in syms:
            ind = (groups.get(s) or {}).get("industry")
            if ind and ind != etf_ind and ind not in cohorts:
                cohorts[ind] = _members(ind)[:MAX_COHORT]
    elif scope == "industry":
        cohorts[industry] = _members(industry)[:MAX_COHORT]

    # 3) ratings: ONE read for every ticker involved (the asked symbols, SPY, every cohort member)
    failures: list = []
    want = list(dict.fromkeys(syms + [BENCHMARK] + [t for m in cohorts.values() for t in m]))
    ratings = _ratings(want, failures) or {}
    session = next((r.get("asof") for r in ratings.values() if r and r.get("asof")), None)
    stale = any(isinstance(f, str) and f.startswith("stale:") for f in failures)
    if session is None:
        notes.append(NOTE_NO_RATINGS)
    elif stale:
        notes.append(NOTE_STALE.format(session=session))

    # 4) returns: the benchmark first, so every row is compared over the identical window
    bench_closes = _closes(BENCHMARK, n + 1, expected)
    bench_ret = period_return(bench_closes, n)
    rows = []
    no_bars, not_rated, no_group = [], [], []
    for s in syms:
        closes = bench_closes if s == BENCHMARK else _closes(s, n + 1, expected)
        g = groups.get(s)
        is_etf = s in labels or s in _index_etfs() or (g or {}).get("industry") == etf_ind
        row = _row(s, ratings.get(s), closes, n, bench_ret, expected, g, is_etf, labels.get(s))
        if scope == "symbols" and not is_etf and row["industry"] in cohorts:
            row["industry_context"] = cohort_stats(ratings, cohorts[row["industry"]], focus=s)
        if not closes:
            no_bars.append(s)
        if not row["rated"]:
            not_rated.append(s)
        if scope == "symbols" and g is None:
            no_group.append(s)
        rows.append(row)
    if scope in ("sectors", "backdrop"):
        # ranked by the period's return, strongest first (the Sector Flow order); a row with no return goes last
        sect = [r for r in rows if r["symbol"] in labels]
        sect.sort(key=lambda r: (r["return"] is None, -(r["return"] or {}).get("pct", 0.0), r["symbol"]))
        data["sectors"] = sect
        data["indices"] = [r for r in rows if r["symbol"] not in labels]
    else:
        data["rows"] = rows
    if scope == "industry":
        data["industry"] = industry
        data["cohort"] = cohort_stats(ratings, cohorts[industry])
    bench = _row(BENCHMARK, ratings.get(BENCHMARK), bench_closes, n, None, expected, None, True)
    data.update({"benchmark_row": bench, "rating_session": session, "ratings_stale": stale})

    if no_bars:
        notes.append(NOTE_NO_BARS.format(syms=", ".join(no_bars)))
    if not_rated and session is not None:
        notes.append(NOTE_NOT_RATED.format(syms=", ".join(not_rated)))
    if no_group:
        notes.append(NOTE_NO_GROUP.format(syms=", ".join(no_group)))
    bars_stale = any(r["bars_stale"] for r in rows) or bench["bars_stale"]
    answered = sum(1 for r in rows if r["rated"] or r["return"])
    if scope == "industry":
        answered = 1 if data["cohort"]["rated"] else 0
    if not answered:
        return env.make_envelope(KIND, params, status="partial", freshness="periodic", as_of=None, source=SOURCE,
                                 data=data, notes=notes + ["nothing in this request has stored RS or return data"],
                                 provider_calls=0, coverage={"requested": max(len(syms), 1), "answered": 0})
    # as_of: the RS session's close; without ratings, the oldest newest-bar among the rows read
    through = [r["bars_through"] for r in rows if r["bars_through"]]
    as_of_day = session or (min(through) if through else None)
    partial = bool(no_bars or not_rated or no_group) and scope == "symbols"
    return env.make_envelope(KIND, params, status="partial" if partial else "ok", freshness="periodic",
                             as_of=_session_close_utc(as_of_day) if as_of_day else None, source=SOURCE, data=data,
                             stale=stale or bars_stale, notes=notes, provider_calls=0,
                             coverage={"requested": max(len(syms), 1), "answered": answered})


__all__ = ["KIND", "read_rs_leadership", "validate", "period_return", "excess", "cohort_stats", "resolve_industry"]
