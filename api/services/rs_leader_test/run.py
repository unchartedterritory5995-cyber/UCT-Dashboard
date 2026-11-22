"""The whole test: read, form the portfolios on every formation date, judge.

:func:`run_test` returns one dict (the output file's content). It writes nothing; the
command line (``__main__``) writes that dict to ``--out`` and prints the verdict.

ONE SCORE. The portfolios are formed with ``screener.rs_leader_score.score_rows``, the
function the nightly pass stores from, over rows built for each date from bars as of
that date and that session's rating. The reference set is the liquid universe of that
date.

THE RATING of a formation date is either computed from bars in memory with the rating
job's own functions (``ratings.py``; the default, so no stored history is needed) or
read from ``rs_rating_history`` (``ratings="stored"``). In computed mode the sessions
are the benchmark's bar dates, and wherever a stored session can also be read the two
are compared and the output carries the comparison.

WHAT A DATE'S NUMBERS ARE. Every position is entered at the next session's open and
left at the close ``h`` sessions after the formation date, equal weight; a formed
portfolio's positions are charged ``spec.ROUND_TRIP_COST_PCT``, a baseline is not. A
date's value for a portfolio is the mean over its positions with a complete window,
and a period's value is the mean over its dates (each date counts once).
"""
from __future__ import annotations

import datetime as _dt
from collections import Counter
from typing import Callable, Dict, List, Optional

from api.services.screener import rs_leader_score

from api.services.screener import rs_history

from . import panel, ratings as rt, spec, stats
from .data import COMPUTED, STORED, Store, as_bars, ymd

DEVELOPMENT, HOLDOUT = "development", "holdout"
QUINTILE_NAMES = tuple(f"q{q}" for q in range(1, spec.QUANTILES + 1))
TOP_SCORE, TOP_RATING = "top_score", "top_rating"
BASE_PRIMARY, BASE_LIQUID = "baseline_liquid_range", "baseline_liquid"
SKIP_FEW = f"fewer than {spec.MIN_QUALIFIERS} scored qualifiers"
SKIP_NO_SESSION = "no benchmark bar on the session"


# --------------------------------------------------------------------------- #
# one formation date
# --------------------------------------------------------------------------- #

def _tally(returns, bench) -> dict:
    """What one date's cross-section keeps of a group of returns: how many windows were
    complete, their mean, how many were positive and how many beat the benchmark."""
    vals = [v for v in returns if v is not None]
    return {"n": len(vals), "mean": stats.mean(vals),
            "positive": sum(1 for v in vals if v > 0),
            "beat": None if bench is None else sum(1 for v in vals if v > bench)}


def _net(v):
    return None if v is None else v - spec.ROUND_TRIP_COST_PCT


def _spread(tallies: dict):
    top, bottom = tallies[QUINTILE_NAMES[-1]]["mean"], tallies[QUINTILE_NAMES[0]]["mean"]
    return None if top is None or bottom is None else top - bottom


def cross_section(day: int, session: str, k: int, segment: str, book: panel.DateBook,
                  bench: Optional[dict], ratings: Dict[str, tuple], classes: Dict[str, dict]) -> dict:
    """One formation date's record (module docstring): the portfolios formed among that
    date's scored qualifiers, their returns at every horizon, and the baselines."""
    rec = {"date": day, "session": session, "k": k, "segment": segment, "skipped": None,
           "floor": len(book.tickers), "gate_bars": len(book.candidates),
           "qualifiers": 0, "scored": 0,
           "market_above_average": None if bench is None else bench["above_average"]}
    if bench is None:
        rec["skipped"] = SKIP_NO_SESSION
        return rec
    rows, forward, adr_of = [], {}, {}
    for t, steady, change, adr, fwd in book.members():
        cand, rating, cls = book.candidates.get(t) or {}, ratings.get(t), classes.get(t) or {}
        rows.append({"ticker": t, "rs_rating_score": rating[1] if rating else None,
                     "rs_steady": steady, "chg_pct_1m": change,
                     "px_below_high_pct": cand.get("px_below_high_pct"),
                     "rs_line_below_high_pct": cand.get("rs_line_below_high_pct"),
                     "industry": cls.get("industry"), "sector": cls.get("sector")})
        forward[t], adr_of[t] = fwd, adr
    parts = rs_leader_score.score_rows(rows, in_floor=lambda r: True)
    qualifiers = [t for t in book.candidates
                  if (ratings.get(t) or (None,))[0] is not None
                  and ratings[t][0] >= spec.GATE_MIN_RATING]
    scores = {t: parts[t]["score"] for t in qualifiers if parts[t]["score"] is not None}
    rec.update(qualifiers=len(qualifiers), scored=len(scores))
    if len(scores) < spec.MIN_QUALIFIERS:
        rec["skipped"] = SKIP_FEW
        return rec

    quint = stats.quintiles(scores)
    lists = {TOP_SCORE: stats.top(scores),
             TOP_RATING: stats.top({t: ratings[t][1] for t in scores})}
    rec["lists"] = lists
    rec["h"] = {}
    for h in spec.HORIZONS:
        spy = bench["forward"][h]
        tallies = {name: _tally([_net(forward[t][h]) for t in scores if quint[t] == q], spy)
                   for q, name in enumerate(QUINTILE_NAMES, 1)}
        for name, members in lists.items():
            tallies[name] = _tally([_net(forward[t][h]) for t in members], spy)
        tallies[BASE_PRIMARY] = _tally(
            [forward[t][h] for t in forward
             if adr_of[t] is not None and adr_of[t] >= spec.BASELINE_MIN_ADR_PCT], spy)
        tallies[BASE_LIQUID] = _tally([forward[t][h] for t in forward], spy)
        rec["h"][h] = {"groups": tallies, "spread": _spread(tallies), "benchmark": spy}

    # Leave one part out: the same scored qualifiers, re-sorted without the part.
    rec["without"] = {}
    for part in rs_leader_score.PARTS:
        alt = stats.quintiles({t: rs_leader_score.combine(parts[t], without=part) for t in scores})
        ph = spec.PRIMARY_HORIZON
        rec["without"][part] = _spread(
            {name: _tally([_net(forward[t][ph]) for t in scores if alt[t] == q], None)
             for q, name in enumerate(QUINTILE_NAMES, 1)})

    rec["excursion"], rec["extended"] = {}, {}
    for name, members in lists.items():
        rec["extended"][name] = [book.candidates[t]["extended"] for t in members]
        rec["excursion"][name] = {
            h: [book.candidates[t]["excursion"][h] for t in members
                if h in book.candidates[t]["excursion"]] for h in spec.EXCURSION_HORIZONS}
    return rec


# --------------------------------------------------------------------------- #
# a period
# --------------------------------------------------------------------------- #

def _group_summary(used: List[dict], h: int, name: str) -> dict:
    tallies = [r["h"][h]["groups"][name] for r in used]
    means = [t["mean"] for t in tallies]
    n = sum(t["n"] for t in tallies)
    beat_n = sum(t["n"] for t in tallies if t["beat"] is not None)

    def excess(base):
        return stats.mean([t["mean"] - r["h"][h]["groups"][base]["mean"]
                           for t, r in zip(tallies, used)
                           if t["mean"] is not None and r["h"][h]["groups"][base]["mean"] is not None])
    return {
        "dates": sum(1 for m in means if m is not None), "positions": n,
        "mean_return_pct": stats.mean(means),
        "mean_excess_vs_liquid_range_pct": excess(BASE_PRIMARY),
        "mean_excess_vs_liquid_pct": excess(BASE_LIQUID),
        "mean_excess_vs_benchmark_pct": stats.mean(
            [t["mean"] - r["h"][h]["benchmark"] for t, r in zip(tallies, used)
             if t["mean"] is not None and r["h"][h]["benchmark"] is not None]),
        "hit_rate_positive": (sum(t["positive"] for t in tallies) / n) if n else None,
        "hit_rate_vs_benchmark": (sum(t["beat"] for t in tallies if t["beat"] is not None) / beat_n)
        if beat_n else None,
    }


def _turnover(used: List[dict], name: str) -> Optional[float]:
    """The mean share of a list replaced from one used formation date to the next."""
    changes = []
    for prev, cur in zip(used, used[1:]):
        now = cur["lists"][name]
        if now:
            changes.append(1.0 - len(set(now) & set(prev["lists"][name])) / len(now))
    return stats.mean(changes)


def _market_split(used: List[dict]) -> dict:
    out = {}
    ph = spec.PRIMARY_HORIZON
    for label, flag in (("benchmark_above_its_200_day", True), ("benchmark_below_its_200_day", False)):
        part = [r for r in used if r["market_above_average"] is flag]
        entry = {"dates": len(part),
                 "primary_spread_pct": stats.mean([r["h"][ph]["spread"] for r in part])}
        for name in (TOP_SCORE, TOP_RATING):
            entry[f"{name}_excess_vs_liquid_range_pct"] = (
                _group_summary(part, ph, name)["mean_excess_vs_liquid_range_pct"] if part else None)
        out[label] = entry
    return out


def summarise(recs: List[dict]) -> dict:
    """One period's numbers from its formation-date records."""
    used = [r for r in recs if not r["skipped"]]
    skipped = Counter(r["skipped"] for r in recs if r["skipped"])
    ph = spec.PRIMARY_HORIZON
    out = {
        "formation_dates": len(recs), "dates_used": len(used), "dates_skipped": dict(skipped),
        "first_date": recs[0]["session"] if recs else None,
        "last_date": recs[-1]["session"] if recs else None,
        # One line per formation date, skipped ones included: what the date held.
        "dates": [{"date": r["session"], "floor": r["floor"], "qualifiers": r["qualifiers"],
                   "scored": r["scored"], "skipped": r["skipped"],
                   "spread_pct": None if r["skipped"] else r["h"][ph]["spread"]} for r in recs],
        "mean_floor": stats.mean([r["floor"] for r in recs]),
        "mean_qualifiers": stats.mean([r["qualifiers"] for r in recs]),
        "mean_scored_qualifiers": stats.mean([r["scored"] for r in recs]),
        "horizons": {}, "primary": {}, "excursions_in_daily_ranges": {}, "top_lists": {},
    }
    names = (*QUINTILE_NAMES, TOP_SCORE, TOP_RATING, BASE_PRIMARY, BASE_LIQUID)
    for h in spec.HORIZONS:
        out["horizons"][str(h)] = {
            "groups": {name: _group_summary(used, h, name) for name in names},
            "top_minus_bottom_pct": stats.mean([r["h"][h]["spread"] for r in used]),
            "benchmark_mean_return_pct": stats.mean([r["h"][h]["benchmark"] for r in used]),
            "events": sum(r["h"][h]["groups"][n]["n"] for r in used for n in QUINTILE_NAMES),
        }
    dated = [(r["session"], r["k"], r["h"][ph]["spread"]) for r in used
             if r["h"][ph]["spread"] is not None]
    out["primary"] = {
        "horizon": ph, "top_minus_bottom_pct": stats.mean([s for _d, _k, s in dated]),
        "dates": len(dated), "independent_blocks": stats.independent_blocks([k for _d, k, _s in dated]),
        "by_date": [{"date": d, "spread_pct": s} for d, _k, s in dated],
        "quintile_excess_pct": [out["horizons"][str(ph)]["groups"][n]["mean_excess_vs_liquid_range_pct"]
                                for n in QUINTILE_NAMES],
        "without": {part: [(r["date"], r["without"][part]) for r in used]
                    for part in rs_leader_score.PARTS},
    }
    for name in (TOP_SCORE, TOP_RATING):
        flags = [f for r in used for f in r["extended"][name]]
        out["top_lists"][name] = {"turnover": _turnover(used, name),
                                  "share_extended": stats.share(flags),
                                  "extended_known": sum(1 for f in flags if f is not None)}
        out["excursions_in_daily_ranges"][name] = {
            str(h): {"median_favourable": stats.med([m for r in used for m, _a in r["excursion"][name][h]]),
                     "median_adverse": stats.med([a for r in used for _m, a in r["excursion"][name][h]]),
                     "positions": sum(len(r["excursion"][name][h]) for r in used)}
            for h in spec.EXCURSION_HORIZONS}
    out["market_split"] = _market_split(used)
    return out


# --------------------------------------------------------------------------- #
# the pass rule
# --------------------------------------------------------------------------- #

def judge(dev: dict, holdout: Optional[dict], *, unlocked: bool) -> dict:
    """The four criteria, each ``met`` or not, and the verdict. Criterion 4 is asked
    only when the holdout was read; locked, the verdict is about development data."""
    primary = dev["primary"]
    spread = primary["top_minus_bottom_pct"]
    boot = stats.block_bootstrap([p["spread_pct"] for p in primary["by_date"]])
    c1 = {"met": bool(spread is not None and spread > 0 and boot is not None and boot["low"] > 0),
          "spread_pct": spread, "interval": boot, "dates": primary["dates"],
          "independent_blocks": primary["independent_blocks"],
          "reason": None if boot is not None else
          f"fewer than {spec.BOOTSTRAP_BLOCK_DATES} formation dates: no interval can be formed"}
    per_year = stats.by_year([(ymd(p["date"]), p["spread_pct"]) for p in primary["by_date"]])
    c2 = stats.year_rule(per_year)
    excess = primary["quintile_excess_pct"]
    rho = (stats.spearman(list(range(1, spec.QUANTILES + 1)), excess)
           if all(e is not None for e in excess) else None)
    c3 = {"met": bool(rho is not None and rho >= spec.SPEARMAN_MIN), "spearman": rho,
          "quintile_excess_pct": excess}
    if unlocked:
        h_spread = holdout["primary"]["top_minus_bottom_pct"] if holdout else None
        same = (spread is not None and h_spread is not None and spread != 0
                and (spread > 0) == (h_spread > 0) and h_spread != 0)
        c4 = {"asked": True, "met": bool(same), "holdout_spread_pct": h_spread,
              "holdout_dates": holdout["primary"]["dates"] if holdout else 0}
    else:
        c4 = {"asked": False, "met": None, "holdout_spread_pct": None, "holdout_dates": 0}
    passed = c1["met"] and c2["met"] and c3["met"] and (c4["met"] if unlocked else True)
    without = {part: stats.leave_one_out_rule(
        per_year, stats.by_year(primary["without"][part])) for part in rs_leader_score.PARTS}
    return {"passed": bool(passed),
            "criteria": {"1_spread_positive_interval_off_zero": c1, "2_positive_in_3_of_4_years": c2,
                         "3_quintiles_in_order": c3, "4_same_sign_in_holdout": c4},
            "leave_one_out": without}


def _fmt(v, digits=2, signed=True):
    if v is None:
        return "n/a"
    return f"{v:+.{digits}f}" if signed else f"{v:.{digits}f}"


def verdict_lines(result: dict) -> List[str]:
    """The short plain-text verdict, printed last: PASS or FAIL per criterion."""
    j, c = result["judgement"], result["judgement"]["criteria"]
    c1, c2, c3, c4 = (c[k] for k in sorted(c))

    def mark(met):
        return "PASS" if met else "FAIL"
    lines = [f"Leader score test (pre-registered {spec.PREREGISTERED})"]
    if result["quick_run"]:
        lines.append("QUICK RUN: a limited number of formation dates was read. This is NOT a test record.")
    if result["holdout_unlocked"]:
        lines.append("HOLDOUT UNLOCKED: the newest "
                     f"{spec.HOLDOUT_SESSIONS} sessions were read in this run.")
    dev = result[DEVELOPMENT]
    lines.append(f"Development data: {dev['dates_used']} formation dates used of "
                 f"{dev['formation_dates']} ({dev['first_date']} to {dev['last_date']}).")
    lines.extend(_rating_lines(result))
    iv = c1["interval"]
    lines.append(
        f"{mark(c1['met'])}  1. Top minus bottom quintile at {spec.PRIMARY_HORIZON} sessions is positive "
        f"and its {int(spec.BOOTSTRAP_INTERVAL * 100)}% interval excludes zero: "
        f"{_fmt(c1['spread_pct'])} points, interval "
        + (f"{_fmt(iv['low'])} to {_fmt(iv['high'])}" if iv else "not formed")
        + f", N = {c1['independent_blocks']} non-overlapping windows."
        + (f" ({c1['reason']})" if c1["reason"] else ""))
    years = ", ".join(f"{y} {_fmt(v['mean'])}" for y, v in c2["years"].items()) or "none"
    lines.append(
        f"{mark(c2['met'])}  2. Positive in at least {spec.YEARS_POSITIVE_MIN} of the "
        f"{spec.YEARS_COMPARED} most recent years: {c2['positive']} positive ({years})."
        + (f" ({c2['reason']})" if c2["reason"] else ""))
    lines.append(
        f"{mark(c3['met'])}  3. Quintile means in order: Spearman {_fmt(c3['spearman'], signed=False)} "
        f"(needs {spec.SPEARMAN_MIN} or more).")
    if c4["asked"]:
        lines.append(f"{mark(c4['met'])}  4. Same sign in the holdout: {_fmt(c4['holdout_spread_pct'])} "
                     f"points over {c4['holdout_dates']} formation dates.")
    else:
        lines.append("NOT READ  4. Same sign in the holdout: the holdout is locked "
                     "(--unlock-holdout reads it).")
    for part, rule in j["leave_one_out"].items():
        if rule["removal_helps"]:
            lines.append(f"NOTE  Removing {part} raised the spread by {spec.LEAVE_ONE_OUT_MIN_GAIN_PCT} "
                         f"points or more in {rule['years_improved']} of {rule['years_compared']} years. "
                         "The default is KEEP; nothing was changed.")
    overall = mark(j["passed"])
    if not result["holdout_unlocked"]:
        overall += " on development data (the holdout has not been read)"
    lines.append(f"VERDICT: {overall}")
    lines.append(spec.CAVEAT)
    return lines


# --------------------------------------------------------------------------- #
# the run
# --------------------------------------------------------------------------- #

def _rating_lines(result: dict) -> List[str]:
    """Where the ratings came from and, in computed mode, how they compare with the
    stored ones. Printed BEFORE the criteria: a rating that does not match the stored
    one is something to know before reading PASS or FAIL."""
    info = result.get("ratings") or {}
    if info.get("mode") != COMPUTED:
        return ["Ratings: read from the stored rating history."]
    lines = ["Ratings: computed from daily bars for each formation date, with the rating job's own functions."]
    check = result.get("ratings_cross_check") or {}
    newest = check.get("newest")
    if newest is None or newest.get("equal_share") is None:
        lines.append("Ratings cross-check: NOT DONE. "
                     + (check.get("note") or "no stock was rated both ways").capitalize()
                     + ", so nothing says the computed ratings match the stored ones.")
        return lines
    share = f"{newest['equal_share'] * 100:.1f}% of {newest['stocks']:,} stocks"
    if check.get("agrees"):
        lines.append(f"Ratings cross-check: {share} have the stored rating on {newest['session']} "
                     f"({check['sessions_compared']} sessions compared).")
    else:
        worst = ", ".join(f"{d['ticker']} {d['stored']} stored, {d['computed']} computed"
                          for d in newest["largest"][:3])
        lines.append(
            f"WARNING  Ratings cross-check: only {share} have the stored rating on {newest['session']} "
            f"(needs {rt.MIN_AGREEMENT * 100:.0f}%). The bars, the ETF list or the split lists are not "
            "the ones that night's ratings were made from, so the ratings tested here are not the "
            "ratings members saw. Largest differences: " + (worst or "none") + ".")
    return lines


def _formation(sessions: List[str], n_dev: int, unlocked: bool, limit: Optional[int],
               offset: int = 0) -> List[tuple]:
    """``[(k, session, segment)]``: every ``spec.FORMATION_STEP``-th session of the
    calendar, counted from its oldest, that this run may read. ``sessions`` start
    ``offset`` sessions into the calendar and ``k`` is the position in the WHOLE
    calendar, so the grid of dates does not move with ``--from-date``. ``limit`` keeps
    the newest ``limit`` of each segment (a quick run)."""
    dev = [(offset + n, s, DEVELOPMENT) for n, s in enumerate(sessions)
           if (offset + n) % spec.FORMATION_STEP == 0 and n < n_dev]
    hold = [(offset + n, s, HOLDOUT) for n, s in enumerate(sessions)
            if (offset + n) % spec.FORMATION_STEP == 0 and n >= n_dev] if unlocked else []
    if limit is not None:
        dev, hold = dev[-limit:] if limit > 0 else [], hold[-limit:] if limit > 0 else []
    return dev + hold


def _span(sessions: List[str]) -> dict:
    return {"count": len(sessions), "first": sessions[0] if sessions else None,
            "last": sessions[-1] if sessions else None}


def plan_block(store: Store, plan: List[tuple], limit: Optional[int], from_date) -> dict:
    """What the run is about to do, known before a bar is read: the session range, the
    formation dates and how many non-overlapping 21-session windows they span."""
    dev = [k for k, _s, seg in plan if seg == DEVELOPMENT]
    hold = [k for k, _s, seg in plan if seg == HOLDOUT]
    return {
        "ratings": store.mode, "from_date": from_date, "max_formation_dates": limit,
        "calendar": _span(store.calendar), DEVELOPMENT: _span(store.development),
        HOLDOUT: {**_span(store.holdout), "read": store.unlock_holdout},
        "formation_dates": {DEVELOPMENT: len(dev), HOLDOUT: len(hold)},
        "first_formation_date": plan[0][1] if plan else None,
        "last_formation_date": plan[-1][1] if plan else None,
        "independent_blocks": {DEVELOPMENT: stats.independent_blocks(dev),
                               HOLDOUT: stats.independent_blocks(hold)},
    }


def plan_lines(block: dict) -> List[str]:
    """:func:`plan_block` in plain words, printed up front."""
    dev, hold = block[DEVELOPMENT], block[HOLDOUT]
    source = ("computed from daily bars for each formation date" if block["ratings"] == COMPUTED
              else "read from the stored rating history")
    lines = [f"Ratings: {source}.",
             f"Development sessions: {dev['count']:,} ({dev['first']} to {dev['last']}).",
             f"Holdout: the newest {hold['count']:,} sessions ({hold['first']} to {hold['last']}), "
             + ("READ in this run." if hold["read"] else "not read.")]
    n, b = block["formation_dates"], block["independent_blocks"]
    lines.append(f"Formation dates: {n[DEVELOPMENT]:,} in development "
                 f"({block['first_formation_date']} to "
                 f"{block['last_formation_date'] if not n[HOLDOUT] else 'the holdout'}), "
                 f"spanning {b[DEVELOPMENT]:,} non-overlapping {spec.PRIMARY_HORIZON}-session windows"
                 + (f"; {n[HOLDOUT]:,} in the holdout ({b[HOLDOUT]:,} windows)." if n[HOLDOUT] else "."))
    return lines


def run_test(bars_db, screener_db, *, unlock_holdout: bool = False,
             max_formation_dates: Optional[int] = None,
             progress: Optional[Callable[[str], None]] = None,
             ratings: str = COMPUTED, from_date: Optional[str] = None, industry_db=None,
             announce: Optional[Callable[[List[str]], None]] = None) -> dict:
    """Run the test and return the output dict. Opens every database read-only and
    writes nothing.

    ``ratings`` is where a formation date's ratings come from (module docstring);
    ``from_date`` bounds how far back formation dates go; ``industry_db`` is the
    industry map the rating job's ETF list reads (computed mode). ``announce`` receives
    the plan's lines once, before any bar is read."""
    say = progress or (lambda _msg: None)
    counts: Counter = Counter()
    recs = {DEVELOPMENT: [], HOLDOUT: []}
    compared: List[dict] = []
    with Store(bars_db, screener_db, unlock_holdout=unlock_holdout, ratings=ratings,
               from_date=from_date, industry_db=industry_db) as store:
        computed = store.mode == COMPUTED
        n_dev = len(store.development)
        plan = _formation(store.sessions, n_dev, store.unlock_holdout, max_formation_dates,
                          offset=store.first)
        block = plan_block(store, plan, max_formation_dates, from_date)
        if announce is not None:
            announce(plan_lines(block))
        result = {
            "test": "UCT Leader score: pre-registered test", "preregistered": spec.PREREGISTERED,
            "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
            "quick_run": max_formation_dates is not None,
            "max_formation_dates": max_formation_dates,
            "holdout_unlocked": store.unlock_holdout,
            "seed": spec.BOOTSTRAP_SEED,
            "constants": spec.as_dict(),
            "score": {"preregistered": rs_leader_score.PREREGISTERED,
                      "weights": dict(rs_leader_score.WEIGHTS),
                      "near_zero_at_pct": rs_leader_score.NEAR_ZERO_AT_PCT,
                      "group_min_members": rs_leader_score.GROUP_MIN_MEMBERS,
                      "group_shrink_members": rs_leader_score.GROUP_SHRINK_MEMBERS},
            "plan": block,
            "sessions": {"stored": _span(store.stored_sessions), "calendar": _span(store.sessions),
                         DEVELOPMENT: _span(store.development),
                         HOLDOUT: {**_span(store.holdout), "read": store.unlock_holdout},
                         "last_date_read": store.cutoff},
            "ratings": {"mode": store.mode},
            "ratings_cross_check": None,
            "universe": {"classification": ("Industry, sector and the ETF flag are as held today "
                                            "(screener_rows), not as of each formation date."),
                         "gate_omissions": list(spec.GATE_OMISSIONS)},
            "caveat": spec.CAVEAT,
        }
        formation: Dict[int, int] = {}
        if plan:
            dev_end = ymd(store.development[-1]) if store.development else None
            for _k, s, segment in plan:
                formation[ymd(s)] = dev_end if segment == DEVELOPMENT else store.cutoff_ymd
            first = min(formation)
            start = _dt.date(first // 10000, first // 100 % 100, first % 100) \
                - _dt.timedelta(days=spec.WARMUP_CALENDAR_DAYS)
            from_ymd = start.year * 10000 + start.month * 100 + start.day
            cal = panel.Calendar(store.daily_bars(spec.BENCHMARK, from_ymd))
            classes = store.classification()
            etfs: set = set()
            if computed:
                etfs, sources = store.etf_tickers(classes)
                result["ratings"].update(
                    etf_sources=sources, etfs_known=len(etfs),
                    held_today=("The bars, the list of which symbols are ETFs and the declared "
                                "split lists are as held today, not as of each formation date."),
                    etf_list=("the rating job's four sources" if sources["industry_map"] is not None else
                              "WITHOUT the industry map (--industry-db was not given): an ETF known "
                              "only there is ranked as a stock, which moves every rating a little"))
            symbols = sorted(t for t, c in classes.items() if c["is_etf"] == 0 and t not in etfs)
            in_universe = set(symbols)
            counts["symbols_classified"] = len(classes)
            counts["symbols_not_a_stock_or_unknown"] = len(classes) - len(symbols)
            declared = store.declared_splits()
            result["universe"]["split_lists"] = (
                "declared split lists read from the rating job's memo" if declared is not None else
                "NO declared split lists in this database: no window was checked for an unadjusted split")
            books = {f: panel.DateBook() for f in formation}

            def _declared(t):
                return None if declared is None else declared.get(t)
            series: dict = {}
            if computed:
                # ONE read per symbol: its closes are kept (typed arrays) for every
                # date's rating window, and a stock of the universe goes through the
                # panel from the same rows.
                say(f"reading every rankable symbol for {len(formation)} formation dates")
                seen = set()
                for n, t in enumerate(store.tickers(), 1):
                    counts["symbols_in_bars_store"] += 1
                    tu = str(t).upper()
                    if not rs_history.rankable_symbol(tu):
                        counts["symbols_not_rankable"] += 1
                        continue
                    rows = store.daily_rows(tu, from_ymd)
                    if not rows:
                        continue
                    seen.add(tu)
                    if tu in etfs:
                        # An ETF's rating is read off the stocks' distribution and never
                        # moves a stock's (`compute_ratings`), and the test ranks stocks
                        # only: its closes are not kept and it is not rated.
                        counts["symbols_etf_not_rated"] += 1
                    elif rt.add_symbol(series, tu, rows, _declared(tu)):
                        counts["symbols_rating_candidates"] += 1
                    if tu in in_universe:
                        panel.add_symbol(tu, as_bars(rows), cal, formation, books, counts,
                                         declared=_declared(tu), development_end=dev_end)
                    if n % 1000 == 0:
                        say(f"  {n} symbols read")
                counts["symbols_no_bars"] = len(in_universe - seen)
            else:
                say(f"reading {len(symbols)} symbols for {len(formation)} formation dates")
                for n, t in enumerate(symbols, 1):
                    bars = store.daily_bars(t, from_ymd)
                    if not bars:
                        counts["symbols_no_bars"] += 1
                        continue
                    panel.add_symbol(t, bars, cal, formation, books, counts,
                                     declared=_declared(t), development_end=dev_end)
                    if n % 500 == 0:
                        say(f"  {n} of {len(symbols)} symbols")
            bench = panel.benchmark_book(cal, formation)
            readable = set(store.readable_stored_sessions()) if computed else set()
            for n, (k, s, segment) in enumerate(plan, 1):
                f = ymd(s)
                if computed:
                    rated = rt.rate(series, etfs, s)
                    if s in readable:
                        compared.append(rt.compare(s, store.ratings(s), rated, etfs))
                    if n % 25 == 0:
                        say(f"  {n} of {len(plan)} formation dates rated")
                else:
                    rated = store.ratings(s)
                recs[segment].append(cross_section(f, s, k, segment, books[f], bench.get(f),
                                                   rated, classes))
            if computed:
                # The newest stored session this run may read is the one the verdict
                # quotes: compared even when it is not a formation date.
                newest = max(readable) if readable else None
                if newest is not None and all(c["session"] != newest for c in compared):
                    compared.append(rt.compare(newest, store.ratings(newest),
                                               rt.rate(series, etfs, newest), etfs))
        if computed:
            result["ratings_cross_check"] = rt.cross_check(
                sorted(compared, key=lambda c: c["session"]),
                stored_sessions=len(store.stored_sessions),
                readable=len(store.readable_stored_sessions()))
    result["counts"] = dict(sorted(counts.items()))
    result[DEVELOPMENT] = summarise(recs[DEVELOPMENT])
    result[HOLDOUT] = summarise(recs[HOLDOUT]) if unlock_holdout else None
    result["judgement"] = judge(result[DEVELOPMENT], result[HOLDOUT], unlocked=bool(unlock_holdout))
    result["verdict"] = "PASS" if result["judgement"]["passed"] else "FAIL"
    # The per-date leave-one-out series fed the judgement; the file keeps its summary.
    for seg in (DEVELOPMENT, HOLDOUT):
        if result[seg]:
            result[seg]["primary"].pop("without", None)
    result["verdict_lines"] = verdict_lines(result)
    return result
