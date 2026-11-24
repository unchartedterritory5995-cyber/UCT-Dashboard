"""IV rank, industry group rank, the next ex-dividend date and estimate revisions for the Screener: ten columns, each
read ONCE per nightly build from a store this server already holds. Never a vendor call, never a store's own build
(one store, the estimate snapshots, is read through EEHSC's own read of it: a local file, never the vendor).

FOUR READERS, ONE PER STORE (each a `snapshot_builder._read_market_source` peer, so a dead store costs only its own
columns, counted by name). Every value is as known at the build's session (the last completed session before the
build): a store whose newest session is after it (`ahead`), or too far behind it (`stale`), leaves its columns NULL for
every row, and an absent key leaves the row's column NULL: never a guessed 0. The fifth family of this unit,
`short_interest_chg_pct`, rides the short-interest columns' own one read of the FINRA list
(`short_columns.read_short_columns`), so it is not here.

  iv_rank, iv_percentile   `read_iv_fields`: OSCR's full per-symbol map, the file the 20:45 ET IV rank build writes
      beside its held answer (`iv_rank_leaders.read_rank_map`, read only): each ranked symbol's IV rank and IV
      percentile against its own logged sessions, exactly as OSCR and IVH work them out (`iv_history.rank_of`; an ATM IV
      under `iv_history.IV_FLOOR` is a placeholder, never a point). A symbol with fewer than
      `iv_history.RANK_MIN_SESSIONS` sessions, a flat series, or no reading on the newest session is not in the map:
      NULL. The whole map is withheld when it is behind by the IV rank module's own rule (`iv_rank_leaders.behind`: its
      session older than the newest one its last evening build should have read, and built before that build), or when
      its session is after the build's.
  group_rank, group_rank_of, group_rank_chg_4w   `read_group_fields`: GRPS's held answer (`group_stats.held_answer`),
      the INDUSTRY kind. Each stock is put in its industry with the map GRPS groups by (`group_stats._group_map`, i.e.
      `scan_period._sector_industry_map`, cleaned as GRPS cleans it, `group_stats._clean`), never by the Screener's own
      industry label (the spellings differ). The rank is GRPS's place on its primary measure
      (`group_stats_calc.RANK_PRIMARY`: the median 6-month change of the group's members, 1 = strongest), `of` how many
      industries were ranked that week, and the change over 4 weekly points as GRPS states it (positive = climbed). NULL
      for a stock with no industry on file or an industry GRPS could not rank (fewer than
      `group_stats_calc.MIN_MEMBERS` members with a change); the change is NULL when either point is missing. The whole
      answer is withheld more than `fund_trends.MAX_LAG_SESSIONS` sessions behind the build's session.
  next_ex_div_date, days_to_ex_div   `read_ex_div_fields`: DVD MARKET's held list (`dividends_market.peek`, read
      only): the soonest ex-dividend date from the row's date to the end of the list's window (this week's Monday to next
      week's Sunday, as DVD MARKET last read it), and the calendar days to it from the row's date (as Days to Earnings
      counts). The list covers only that window and only the stocks of the site's universe, so a blank means "no
      ex-date in the window" (or a stock the list does not follow), never "no dividend". The whole list is withheld when
      its window does not reach the day after the build's session, or its dividends read failed.
  eps_rev_up_30d, eps_rev_down_30d, eps_rev_net_30d   `read_eps_revision_fields`: EEHSC's own read of UCT's daily
      estimate snapshots (`estimate_revisions.build`, over the `estimate_history` store, a local file) and its per-stock
      classification of the next fiscal quarter's consensus EPS over `EPS_REV_WINDOW` days
      (`estimate_revisions.classify`: up / down / held, never restated here). One classification per stock, so up and
      down are 1 or 0 and net is up less down (-1, 0 or +1): the stock's own count in EEHSC's tally. NULL for every stock
      the store does not track (it tracks the S&P 500 plus the stocks members opened EEH for, at most
      `estimate_history.MAX_SYMBOLS`), and for a tracked stock still collecting, with a gap, or not comparable. The whole
      read is withheld when the store does not exist (it is never created by this read), or its newest snapshot is after
      the build's session or more than `fund_trends.MAX_LAG_SESSIONS` sessions behind it.

COST (measured 2026-11-23 on invented stores, 11,000 targets, the dev PC shared with other work, under tracemalloc, not
production; `snapshot_builder`'s receipt `stats["store_columns"]` carries each read's seconds on the pod): the IV map of
6,028 symbols (a 138 KB file) 0.33 s, peak 4.4 MB; GRPS's answer of 145 industries and a 5,000-symbol map 0.20 s, peak
1.4 MB; a DVD MARKET list of 1,800 dividends 0.14 s, peak 2.1 MB; EEHSC's read of 600 tracked stocks with 37 snapshot
days of 4 quarters each 3.7 s (one small SELECT per stock, as EEHSC measures), peak 3.1 MB. The four run one after
another and merge into one map: 4.3 s, peak 6.2 MB, 2.2 MB held through the build, well under the 20 MB budget.
"""
from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Optional

from .beats_insiders_funds import _done, _finite, _iso, _key, _note

#: snapshot columns, in the order the views show them
IV_COLUMNS = ("iv_rank", "iv_percentile")
GROUP_COLUMNS = ("group_rank", "group_rank_of", "group_rank_chg_4w")
EX_DIV_COLUMNS = ("next_ex_div_date", "days_to_ex_div")
EPS_REV_COLUMNS = ("eps_rev_up_30d", "eps_rev_down_30d", "eps_rev_net_30d")
COLUMNS = IV_COLUMNS + GROUP_COLUMNS + EX_DIV_COLUMNS + EPS_REV_COLUMNS
#: the whole-number columns (`next_ex_div_date` is TEXT, the IV pair REAL)
INT_COLUMNS = GROUP_COLUMNS + ("days_to_ex_div",) + EPS_REV_COLUMNS
#: the filter category each column sits in (where a member looks for it)
CATEGORY = {**{c: "volume_volatility" for c in IV_COLUMNS}, **{c: "context" for c in GROUP_COLUMNS},
            **{c: "events" for c in EX_DIV_COLUMNS + EPS_REV_COLUMNS}}
#: GRPS's kind these columns rank in (`group_stats.KINDS`), and the weekly points the change looks back
GROUP_KIND = "industry"
GROUP_CHANGE_WEEKS = 4
#: EEHSC's window and estimate these columns read (`estimate_revisions.WINDOWS`, `estimate_revisions.METRICS`)
EPS_REV_WINDOW = 30
EPS_REV_METRIC = "eps"


def _session_lag(asof: str, session: date, said: dict, failures, label: str) -> Optional[str]:
    """'ahead' when the store's session is after the build's (look-ahead), 'stale' when it is more than
    `fund_trends.MAX_LAG_SESSIONS` sessions behind (the shared rule the last unit's insider reader uses), else None."""
    from api.services.screener import fund_trends as FT            # noqa: PLC0415 -- the shared session-lag rule
    if asof > session.isoformat():
        _note(failures, label, "ahead")
        return "ahead"
    lag = FT.lag_sessions(asof, session)
    said["lag_sessions"] = lag
    if lag is None or lag > FT.MAX_LAG_SESSIONS:
        _note(failures, label, "stale")
        return "stale"
    return None


def _wanted(targets) -> dict:
    """{matching key: TICKER} for the build's targets (BRK.B and BRK-B are one stock)."""
    return {_key(t): str(t).upper() for t in targets or ()}


# ── IV rank and percentile: OSCR's full map ───────────────────────────────────────────────────

def read_iv_fields(targets, failures=None, *, session: Optional[date] = None, now=None,
                   receipt: Optional[dict] = None) -> dict:
    """{TICKER: {iv_rank?, iv_percentile?}} from ONE read of the IV rank build's full map. `now` is the IV rank module's
    clock for its own stale rule (None: the real clock). `receipt`: state ('served' | 'no_session' | 'not_held' |
    'unreadable' | 'empty' | 'ahead' | 'stale'), the build's session, the map's session and build time, symbols in it,
    how many the map's bound cut, and matched."""
    from api.services.research import iv_history as IVH            # noqa: PLC0415 -- lazy: the build's one read
    from api.services.research import iv_rank_leaders as IVR       # noqa: PLC0415
    said = {"state": None, "session": session.isoformat() if session else None, "map_session": None,
            "map_built_at": None, "in_map": 0, "cut": None, "matched": 0}
    if session is None:
        return _done(receipt, said, "no_session", {})
    doc, how = IVR.read_rank_map()
    if how != "held":
        _note(failures, "iv_rank", how)
        return _done(receipt, said, how, {})
    symbols = doc.get("symbols") or {}
    said.update(map_session=doc.get("session"), map_built_at=doc.get("built_at"), in_map=len(symbols),
                cut=(doc.get("counts") or {}).get("cut"))
    if not doc.get("session"):
        return _done(receipt, said, "empty", {})
    if doc["session"] > session.isoformat():
        _note(failures, "iv_rank", "ahead")
        return _done(receipt, said, "ahead", {})
    if IVR.behind({"session": doc["session"], "built_at": doc.get("built_at")}, now):
        _note(failures, "iv_rank", "stale")
        return _done(receipt, said, "stale", {})
    want = _wanted(targets)
    out = {}
    for sym, vals in symbols.items():
        t = want.get(_key(sym))
        if t is None or not isinstance(vals, list) or len(vals) != 3:
            continue
        rank, pct, sessions = (_finite(v) for v in vals)
        if sessions is None or sessions < IVH.RANK_MIN_SESSIONS:     # never ranked on fewer sessions
            continue
        row = {}
        if rank is not None:
            row["iv_rank"] = rank
        if pct is not None:
            row["iv_percentile"] = pct
        if row:
            out[t] = row
    said["matched"] = len(out)
    return _done(receipt, said, "served", out)


# ── industry group rank: GRPS's held answer ───────────────────────────────────────────────────

def _change_label(calc) -> str:
    """GRPS's own label for the rank `GROUP_CHANGE_WEEKS` weekly points back (`group_stats_calc.RANK_BACK`)."""
    return {weeks: label for label, weeks in calc.RANK_BACK}[GROUP_CHANGE_WEEKS]


def _group_of(groups: dict, ticker: str) -> Optional[dict]:
    for spelling in (ticker, ticker.replace("-", "."), ticker.replace(".", "-")):
        g = groups.get(spelling)
        if isinstance(g, dict):
            return g
    return None


def read_group_fields(targets, failures=None, *, session: Optional[date] = None,
                      receipt: Optional[dict] = None) -> dict:
    """{TICKER: {group_rank, group_rank_of, group_rank_chg_4w?}} from ONE read of GRPS's held answer and ONE read of
    the map GRPS groups by. `receipt`: state ('served' | 'no_session' | 'not_held' | 'no_rank' | 'ahead' | 'stale'),
    the build's session, the answer's session and evening, its lag in sessions, the kind and measure, industries in
    it and ranked, targets with an industry on file, and matched."""
    from api.services import group_stats as GS                     # noqa: PLC0415 -- lazy: the build's one read
    from api.services import group_stats_calc as GC                # noqa: PLC0415
    said = {"state": None, "session": session.isoformat() if session else None, "answer_session": None,
            "built_for": None, "lag_sessions": None, "kind": GROUP_KIND, "measure": GC.RANK_PRIMARY, "groups": 0,
            "ranked_groups": 0, "mapped": 0, "matched": 0}
    if session is None:
        return _done(receipt, said, "no_session", {})
    ans, how = GS.held_answer()
    if how != "held" or not isinstance(ans, dict):
        _note(failures, "group_rank", "not_held")
        return _done(receipt, said, "not_held", {})
    asof = _iso(ans.get("session"))
    said.update(answer_session=asof, built_for=ans.get("built_for"))
    if not isinstance(ans.get("rank"), dict) or ans["rank"].get("state") != "ok" or asof is None:
        _note(failures, "group_rank", "no_rank")
        return _done(receipt, said, "no_rank", {})
    late = _session_lag(asof, session, said, failures, "group_rank")
    if late:
        return _done(receipt, said, late, {})
    back = _change_label(GC)
    places: dict = {}
    for name, block in ((ans.get("kinds") or {}).get(GROUP_KIND) or {}).items():
        line = ((block or {}).get("rank") or {}).get(GC.RANK_PRIMARY) or {}
        now_pt = line.get("now") or {}
        said["groups"] += 1
        if isinstance(now_pt.get("position"), int):
            said["ranked_groups"] += 1
            places[name] = (now_pt["position"], now_pt.get("of"), (line.get(back) or {}).get("change"))
    groups = GS._group_map()
    out = {}
    for t in targets or ():
        tick = str(t).upper()
        name = GS._clean((_group_of(groups, tick) or {}).get(GROUP_KIND))
        if not name:
            continue
        said["mapped"] += 1
        place = places.get(name)
        if place is None:
            continue
        pos, of, chg = place
        row = {"group_rank": pos}
        if isinstance(of, int):
            row["group_rank_of"] = of
        if isinstance(chg, int):
            row["group_rank_chg_4w"] = chg
        out[tick] = row
    said["matched"] = len(out)
    return _done(receipt, said, "served", out)


# ── the next ex-dividend date: DVD MARKET's held list ─────────────────────────────────────────

def read_ex_div_fields(targets, failures=None, *, session: Optional[date] = None, today: Optional[date] = None,
                       receipt: Optional[dict] = None) -> dict:
    """{TICKER: {next_ex_div_date, days_to_ex_div}} from ONE read of DVD MARKET's held list. `today` is the row's date
    (the build's, `snapshot_date`; None: the day after the session): the days count from it, and the dates looked at
    run from the later of it and the day after the session to the end of the list's window (the day before its latest
    listed date when the list was cut at its cap). `receipt`: state ('served' | 'no_session' | 'not_held' |
    'leg_failed' | 'window_not_held'), the window, when it was read, the days covered, whether it was cut, dividends
    listed and inside the covered days, targets the list follows, and matched."""
    from api.services import dividends_market as DM                # noqa: PLC0415 -- lazy: the build's one read
    said = {"state": None, "session": session.isoformat() if session else None, "window_from": None,
            "window_to": None, "read_at": None, "cover_from": None, "cover_to": None, "days_ahead": None,
            "cut": None, "listed": 0, "in_cover": 0, "followed_targets": 0, "matched": 0}
    if session is None:
        return _done(receipt, said, "no_session", {})
    held = DM.peek()
    if not isinstance(held, dict) or held.get("status") != "ok":
        _note(failures, "ex_dividend", "not_held")
        return _done(receipt, said, "not_held", {})
    win = held.get("window") or {}
    lo, hi = _iso(win.get("from")), _iso(win.get("to"))
    rows = [d for d in held.get("dividends") or () if isinstance(d, dict) and d.get("sym") and _iso(d.get("ex_date"))]
    said.update(window_from=lo, window_to=hi, read_at=held.get("read_at"), listed=len(rows),
                cut=bool((held.get("cut") or {}).get("dividends")))
    if (held.get("legs") or {}).get("dividends") != "ok":
        _note(failures, "ex_dividend", "leg_failed")
        return _done(receipt, said, "leg_failed", {})
    base = today or (session + timedelta(days=1))
    first = max(session + timedelta(days=1), base).isoformat()
    last = hi
    if said["cut"] and rows:            # the LATEST days are the ones a cut leaves out: the last listed day may be part
        last = (date.fromisoformat(max(_iso(d["ex_date"]) for d in rows)) - timedelta(days=1)).isoformat()
    if not lo or not hi or not last or not lo <= first <= hi or last < first:
        _note(failures, "ex_dividend", "window_not_held")
        return _done(receipt, said, "window_not_held", {})
    said.update(cover_from=first, cover_to=last, days_ahead=(date.fromisoformat(last) - date.fromisoformat(first)).days)
    want = _wanted(targets)
    soonest: dict = {}
    for d in rows:
        ex = _iso(d["ex_date"])
        if not first <= ex <= last:
            continue
        said["in_cover"] += 1
        t = want.get(_key(d["sym"]))
        if t is not None and (t not in soonest or ex < soonest[t]):
            soonest[t] = ex
    followed = {_key(s) for s in DM.universe()}
    said["followed_targets"] = sum(1 for k in want if k in followed)
    out = {t: {"next_ex_div_date": ex, "days_to_ex_div": (date.fromisoformat(ex) - base).days}
           for t, ex in soonest.items()}
    said["matched"] = len(out)
    return _done(receipt, said, "served", out)


# ── estimate revisions: EEHSC's per-stock classification ──────────────────────────────────────

def read_eps_revision_fields(targets, failures=None, *, session: Optional[date] = None,
                             receipt: Optional[dict] = None) -> dict:
    """{TICKER: {eps_rev_up_30d, eps_rev_down_30d, eps_rev_net_30d}} for every tracked stock EEHSC counts (up, down or
    held) over `EPS_REV_WINDOW` days, from ONE read of the estimate snapshots through EEHSC's own read
    (`estimate_revisions.build`, its sector map left out: this reads no other store). `receipt`: state ('served' |
    'no_session' | 'not_held' | 'no_snapshots' | 'no_window' | 'ahead' | 'stale'), the build's session, the store's
    newest snapshot day and its lag, the window and estimate, stocks tracked, each classification's count, and
    matched."""
    from api.services import estimate_history as EH                # noqa: PLC0415 -- lazy: the build's one read
    from api.services import estimate_revisions as ER              # noqa: PLC0415
    said = {"state": None, "session": session.isoformat() if session else None, "asof": None, "lag_sessions": None,
            "window": EPS_REV_WINDOW, "metric": EPS_REV_METRIC, "tracked": 0, "states": {s: 0 for s in ER.STATES},
            "matched": 0}
    if session is None:
        return _done(receipt, said, "no_session", {})
    if not os.path.exists(EH.db_path()):                    # a read never creates the store
        _note(failures, "eps_revisions", "not_held")
        return _done(receipt, said, "not_held", {})
    answer, _text = ER.build(None, groups={})
    asof = _iso(answer.get("asof"))
    said.update(asof=asof, tracked=(answer.get("tracked") or {}).get("n") or 0)
    if asof is None:
        return _done(receipt, said, "no_snapshots", {})
    part = (answer.get("slices") or {}).get(f"{EPS_REV_METRIC}:{EPS_REV_WINDOW}")
    if not isinstance(part, dict):
        _note(failures, "eps_revisions", "no_window")
        return _done(receipt, said, "no_window", {})
    late = _session_lag(asof, session, said, failures, "eps_revisions")
    if late:
        return _done(receipt, said, late, {})
    want = _wanted(targets)
    out = {}
    for sector in part.get("sectors") or ():
        for s in sector.get("symbols") or ():
            state = s.get("state")
            if state in said["states"]:
                said["states"][state] += 1
            t = want.get(_key(s.get("symbol")))
            if state not in ER.COUNTED or t is None:
                continue
            up, down = int(state == "up"), int(state == "down")
            out[t] = {"eps_rev_up_30d": up, "eps_rev_down_30d": down, "eps_rev_net_30d": up - down}
    said["matched"] = len(out)
    return _done(receipt, said, "served", out)
