"""PHASE 3 (missing_source) + PHASE 4 (session geometry).

PHASE 3. The NYSE holiday calendar is computed HERE from its published rules (no repo
constant is trusted), every one of the 175 missing_source dates is classified against it,
the provider grouped calendar and a HEAD of the minute flat-file key.

PHASE 4. For every session whose stored bucket count is not 390 (and a random control
set that is), the minute file's participation is replayed to say exactly WHY: which
minute the derived close landed on, whether any minute inside the window is absent, and
what the bucket count would be under the calendar-correct boundary.
"""
import collections
import datetime as dt
import json
import random
import sys

import pandas as pd

from common import SCRATCH, calendar, ro, write
import oracle as O


def easter(y):
    a = y % 19; b = y // 100; c = y % 100; d = b // 4; e = b % 4
    f = (b + 8) // 25; g = (b - f + 1) // 3; h = (19 * a + b - d - g + 15) % 30
    i = c // 4; k = c % 4; l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mo = (h + l - 7 * m + 114) // 31; da = ((h + l - 7 * m + 114) % 31) + 1
    return dt.date(y, mo, da)


def nth(y, mo, wd, n):
    d = dt.date(y, mo, 1)
    d += dt.timedelta(days=(wd - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def last(y, mo, wd):
    d = dt.date(y, mo + 1, 1) - dt.timedelta(days=1) if mo < 12 else dt.date(y, 12, 31)
    return d - dt.timedelta(days=(d.weekday() - wd) % 7)


def observed(d):
    if d.weekday() == 5:
        return d - dt.timedelta(days=1)
    if d.weekday() == 6:
        return d + dt.timedelta(days=1)
    return d


def nyse_holidays(y):
    h = {}
    ny = dt.date(y, 1, 1)
    if ny.weekday() == 6:
        h[ny + dt.timedelta(days=1)] = "New Year's Day (observed)"
    elif ny.weekday() != 5:          # NYSE does not observe a Saturday New Year on Dec 31
        h[ny] = "New Year's Day"
    h[nth(y, 1, 0, 3)] = "Martin Luther King Jr. Day"
    h[nth(y, 2, 0, 3)] = "Washington's Birthday"
    h[easter(y) - dt.timedelta(days=2)] = "Good Friday"
    h[last(y, 5, 0)] = "Memorial Day"
    if y >= 2022:
        h[observed(dt.date(y, 6, 19))] = "Juneteenth"
    h[observed(dt.date(y, 7, 4))] = "Independence Day"
    h[nth(y, 9, 0, 1)] = "Labor Day"
    h[nth(y, 11, 3, 4)] = "Thanksgiving"
    h[observed(dt.date(y, 12, 25))] = "Christmas"
    special = {dt.date(2012, 10, 29): "Hurricane Sandy closure",
               dt.date(2012, 10, 30): "Hurricane Sandy closure",
               dt.date(2018, 12, 5): "National Day of Mourning (G.H.W. Bush)",
               dt.date(2025, 1, 9): "National Day of Mourning (J. Carter)"}
    for d, n in special.items():
        if d.year == y:
            h[d] = n
    return h


def early_closes(y):
    e = {}
    jul3 = dt.date(y, 7, 3)
    if jul3.weekday() < 5 and observed(dt.date(y, 7, 4)) != jul3:
        e[jul3] = "Jul 3 half day"
    tg = nth(y, 11, 3, 4)
    e[tg + dt.timedelta(days=1)] = "Day after Thanksgiving"
    c24 = dt.date(y, 12, 24)
    if c24.weekday() < 5 and c24 not in nyse_holidays(y):   # a Friday Dec 24 is the holiday itself
        e[c24] = "Christmas Eve"
    return e


def main():
    c = ro(SCRATCH)
    ck = dict(c.execute("SELECT date,status FROM pass_checkpoint").fetchall())
    ps = {d: (b, ec) for d, b, ec in c.execute("SELECT date,buckets,early_close FROM pass_session")}
    cal = set(calendar())
    hol, ecl = {}, {}
    for y in range(2008, 2027):
        hol.update({d.isoformat(): n for d, n in nyse_holidays(y).items()})
        ecl.update({d.isoformat(): n for d, n in early_closes(y).items()})
    s3 = O.s3()
    R = {"phase3": [], "phase4": {}}
    # ── PHASE 3 ──
    for d in sorted(k for k, v in ck.items() if v == "missing_source"):
        key = "us_stocks_sip/minute_aggs_v1/%s/%s/%s.csv.gz" % (d[:4], d[5:7], d)
        try:
            h = s3.head_object(Bucket="flatfiles", Key=key)
            fstate = "present %d bytes" % h["ContentLength"]
        except Exception as e:
            fstate = "absent (%s)" % type(e).__name__
        R["phase3"].append({"date": d, "weekday": dt.date.fromisoformat(d).strftime("%a"),
                            "nyse_rule_holiday": hol.get(d), "provider_grouped_session": d in cal,
                            "minute_file": fstate})
    rule_holidays_weekday = sorted(d for d in hol if "2008-01-02" <= d <= "2026-09-11"
                                   and dt.date.fromisoformat(d).weekday() < 5)
    R["phase3_summary"] = {
        "missing_source": len(R["phase3"]),
        "all_are_rule_holidays": all(r["nyse_rule_holiday"] for r in R["phase3"]),
        "none_in_provider_calendar": not any(r["provider_grouped_session"] for r in R["phase3"]),
        "minute_file_states": dict(collections.Counter(r["minute_file"].split(" ")[0] for r in R["phase3"])),
        "rule_holidays_on_weekdays_in_range": len(rule_holidays_weekday),
        "rule_holidays_not_missing_source": [d for d in rule_holidays_weekday if ck.get(d) != "missing_source"],
        "by_reason": dict(collections.Counter(r["nyse_rule_holiday"] for r in R["phase3"])),
    }
    # ── PHASE 4 ──
    odd = sorted(d for d, (b, ec) in ps.items() if b != 390 or ec)
    random.seed(20260923)
    ctrl = sorted(random.sample(sorted(d for d, (b, ec) in ps.items() if b == 390 and not ec), 30))
    rule_early = {d for d in ecl}
    for d in odd + ctrl:
        try:
            df = O.load_minutes(d, s3)
        except Exception as e:
            R["phase4"][d] = {"error": str(e)}
            continue
        g = O.session_geometry(df)
        g.pop("minutes")
        b, ec = ps[d]
        exp_last = (12 * 60 + 59) if d in rule_early else (15 * 60 + 59)
        g.update({"stored_buckets": b, "stored_early_close": ec, "rule_early_close": ecl.get(d),
                  "calendar_last_bar": exp_last, "control": d in ctrl,
                  "derived_minus_calendar_last_bar": g["last_bar"] - exp_last,
                  "reproduces_stored_buckets": g["buckets"] == b})
        R["phase4"][d] = g
        print(d, b, g["buckets"], g["close_min"], g["missing_minutes"][:5], flush=True)
    cls = collections.Counter()
    for d, g in R["phase4"].items():
        if "error" in g:
            cls["error"] += 1
            continue
        k = ("control " if g["control"] else "") + "Δlast_bar=%+d missing=%d early=%s" % (
            g["derived_minus_calendar_last_bar"], len(g["missing_minutes"]), bool(g["rule_early_close"]))
        cls[k] += 1
    R["phase4_classes"] = dict(cls)
    R["rule_early_closes_not_flagged"] = sorted(d for d in rule_early if d in ps and not ps[d][1])
    R["flagged_early_not_rule"] = sorted(d for d, (b, ec) in ps.items() if ec and d not in rule_early)
    print(write("calendar_geometry.json", R))
    print(json.dumps({"phase3_summary": R["phase3_summary"], "phase4_classes": R["phase4_classes"],
                      "rule_early_closes_not_flagged": R["rule_early_closes_not_flagged"],
                      "flagged_early_not_rule": R["flagged_early_not_rule"]}, indent=1))


if __name__ == "__main__":
    main()
