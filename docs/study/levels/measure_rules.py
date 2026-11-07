"""EVIDENCE FOR THE LEVELS RULINGS: candidate entry and stop rules replayed over the bank's own examples.

The owner, 2026-11-06: the entry / stop / sell rules still waiting on him are to be worked out from "the entire brain
system knowledge base content examples pattern rec internet avilable information and studies and everything". This is the
"examples" leg: for each of the seven Hard-mode setups, every candidate entry rule x stop rule (from his rulings, the
brain's setup templates and the pattern engine's own levels) is replayed on every Yes example in the bank
(docs/study/bank/spot.setups.json, spot.bear_gaps.json) over the next 60 sessions of real daily bars.

READ THIS BEFORE READING THE NUMBERS: the examples are the owner's chosen textbook charts, not a random sample, so the
tables say which rule FITS his examples (how wide the stop is, how often it is hit, how often the trade reaches 2R before
it), not what edge the setup has in general. Daily bars cannot say what happened first inside a day, so the replay is
conservative where it must guess: the stop is not checked on the fill day, and on the day the stop is hit that day's high
is not counted. Nothing here is shown to a member; it is evidence for the owner's rulings.

Usage (read-only):
  python docs/study/levels/measure_rules.py [--bars <bars.db>] [--out docs/study/levels/evidence.md]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import statistics
from typing import Callable, Optional

REPO = pathlib.Path(__file__).resolve().parents[3]
BANK = REPO / "docs" / "study" / "bank"
DEFAULT_BARS = r"C:\Users\pgosz\AppData\Local\Temp\uct_tests_datadir_8_xzj23w\bars.db"
FORWARD = 60
CONTEXT = 260


def ema_series(values, n):
    out, e, k = [], None, 2 / (n + 1)
    for i, v in enumerate(values):
        if i + 1 < n:
            out.append(None); continue
        e = sum(values[i + 1 - n:i + 1]) / n if e is None else v * k + e * (1 - k)
        out.append(e)
    return out


def sma_at(values, i, n):
    return sum(values[i + 1 - n:i + 1]) / n if i + 1 >= n else None


def atr_at(bars, i, n=14):
    if i < n:
        return None
    trs = [max(bars[k]["h"] - bars[k]["l"], abs(bars[k]["h"] - bars[k - 1]["c"]), abs(bars[k]["l"] - bars[k - 1]["c"]))
           for k in range(i - n + 1, i + 1)]
    return sum(trs) / n


def gap_day(bars, i):
    """The up-gap a Gap Support example tests: the latest bar in the prior 60 sessions (not the last two) that opened 4%+
    over the prior close and above the prior high."""
    for g in range(i - 2, max(1, i - 60) - 1, -1):
        p, b = bars[g - 1], bars[g]
        if p["c"] > 0 and b["o"] / p["c"] - 1 >= 0.04 and b["o"] > p["h"]:
            return g
    return None


# ── candidate rules: each returns (entry, fill_offset) / stop price, or None when the rule does not apply ─────────────
# fill_offset 0 = filled on the signal bar, 1 = filled on the next bar (a stop order over / under the signal bar).

def over_prior_high(bars, i):
    b, p = bars[i], bars[i - 1]
    return (max(b["o"], p["h"] + 0.01), 0) if b["h"] > p["h"] else None


def at_close(bars, i):
    return (bars[i]["c"], 0)


def at_prior_close(bars, i):
    b, p = bars[i], bars[i - 1]
    return (p["c"], 0) if b["h"] >= p["c"] else None


def next_day_over_high(bars, i):
    if i + 1 >= len(bars):
        return None
    b, n = bars[i], bars[i + 1]
    return (max(n["o"], b["h"] + 0.01), 1) if n["h"] > b["h"] else None


def next_day_under_low(bars, i):
    if i + 1 >= len(bars):
        return None
    b, n = bars[i], bars[i + 1]
    return (min(n["o"], b["l"] - 0.01), 1) if n["l"] < b["l"] else None


def capped(stop_fn, pct, short=False):
    def f(bars, i, entry):
        s = stop_fn(bars, i, entry)
        if s is None:
            return None
        return max(s, entry * (1 - pct)) if not short else min(s, entry * (1 + pct))
    return f


RULES: dict[str, dict] = {
    "setup.family3.kicker": {
        "name": "Kicker", "short": False,
        "entries": {"over the red day's high (his ruling)": over_prior_high, "the Kicker day's close": at_close},
        "stops": {"the Kicker day's low (his ruling)": lambda b, i, e: b[i]["l"] - 0.01,
                  "the red day's low": lambda b, i, e: b[i - 1]["l"] - 0.01,
                  "Kicker low, at most 3.5% (his ruling)": capped(lambda b, i, e: b[i]["l"] - 0.01, 0.035)},
    },
    "setup.family4.oops": {
        "name": "Oops Reversal", "short": False,
        "entries": {"buy stop at the prior close (engine, template)": at_prior_close, "the Oops day's close": at_close},
        "stops": {"the Oops day's low (engine, template)": lambda b, i, e: b[i]["l"] - 0.01,
                  "Oops low, at most 3.5%": capped(lambda b, i, e: b[i]["l"] - 0.01, 0.035)},
    },
    "setup.family3.gap_support": {
        "name": "Gap Support", "short": False,
        "entries": {"the test day's close (engine)": at_close, "next day over the test day's high": next_day_over_high},
        "stops": {"the test day's low (template)": lambda b, i, e: b[i]["l"] - 0.01,
                  "under the gap-up day's low (his definition)": lambda b, i, e: (b[g]["l"] * 0.99) if (g := gap_day(b, i)) else None,
                  "the gap top, the gap filled (engine)": lambda b, i, e: (b[g - 1]["h"] - 0.01) if (g := gap_day(b, i)) else None},
    },
    "setup.family3.hve": {
        "name": "High Volume Edge", "short": False,
        "entries": {"the HVE day's close (engine)": at_close, "next day over the HVE day's high": next_day_over_high},
        "stops": {"the HVE day's low (engine)": lambda b, i, e: b[i]["l"] - 0.01,
                  "HVE low, at most 3.5%": capped(lambda b, i, e: b[i]["l"] - 0.01, 0.035)},
    },
    "setup.family4.slingshot": {
        "name": "Slingshot", "short": False,
        "entries": {"the trigger day's close (engine)": at_close, "next day over the trigger day's high": next_day_over_high},
        "stops": {"the trigger day's low (engine)": lambda b, i, e: b[i]["l"] - 0.01,
                  "the pullback's low (five sessions)": lambda b, i, e: min(x["l"] for x in b[i - 4:i + 1]) - 0.01},
    },
    "setup.family1.launchpad": {
        "name": "Launchpad", "short": False,
        "entries": {"the launch day's close (engine)": at_close, "next day over the launch day's high": next_day_over_high},
        "stops": {"the launch day's low": lambda b, i, e: b[i]["l"] - 0.01,
                  "under the bundle: lowest of 8/21/50 less 0.25 ATR (engine)": lambda b, i, e: _bundle_stop(b, i)},
    },
    "setup.family3.bear_gap": {
        "name": "Bear gap (short)", "short": True,
        "entries": {"short the gap day's close": at_close, "next day under the gap day's low": next_day_under_low},
        "stops": {"over the gap day's high": lambda b, i, e: b[i]["h"] + 0.01,
                  "over the gap-fill level (the prior day's low)": lambda b, i, e: b[i - 1]["l"] + 0.01},
    },
}


def _bundle_stop(bars, i):
    closes = [b["c"] for b in bars[:i + 1]]
    e8, e21 = ema_series(closes, 8)[i], ema_series(closes, 21)[i]
    s50, a = sma_at(closes, i, 50), atr_at(bars, i)
    if None in (e8, e21, s50, a):
        return None
    return min(e8, e21, s50) - 0.25 * a


def replay(bars, i, entry, off, stop, short):
    """The trade from its fill to its stop or FORWARD sessions: (stopped, mfe_R, r20_pct)."""
    risk = (stop - entry) if short else (entry - stop)
    if risk <= 0:
        return None
    fill = i + off
    end = min(len(bars), fill + 1 + FORWARD)
    best, stopped = 0.0, False
    for k in range(fill, end):
        b = bars[k]
        if k > fill and ((b["h"] >= stop) if short else (b["l"] <= stop)):
            stopped = True
            break
        fav = (entry - b["l"]) if short else (b["h"] - entry)
        best = max(best, fav / risk)
    k20 = fill + 20
    r20 = None
    if not stopped and k20 < len(bars):
        r20 = ((entry / bars[k20]["c"] - 1) if short else (bars[k20]["c"] / entry - 1)) * 100
    return stopped, best, r20, risk / entry * 100


def load_items():
    items = []
    for f in ("spot.setups", "spot.bear_gaps"):
        d = json.loads((BANK / f"{f}.json").read_text(encoding="utf-8"))
        for it in (d if isinstance(d, list) else d.get("items")):
            if it.get("skill_id") in RULES and str((it.get("answer_json") or {}).get("answer", "")).lower() == "yes":
                items.append(it)
    return items


VERDICT_NAMES = {"Kicker Candle": "setup.family3.kicker", "Oops Reversal": "setup.family4.oops", "Gap Support": "setup.family3.gap_support",
                 "High Volume Edge": "setup.family3.hve", "Slingshot": "setup.family4.slingshot", "Launchpad": "setup.family1.launchpad",
                 "Bear Gap off the Highs": "setup.family3.bear_gap", "Bear gap": "setup.family3.bear_gap"}
KEPT = {"keep", "keep_lesser", "owner_reference"}


def kept_set():
    """(skill, SYM, asof) the owner KEPT on the review screen (owner_verdicts.jsonl)."""
    out = set()
    p = REPO / "docs" / "study" / "audits" / "2026-10-24" / "owner_verdicts.jsonl"
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        sk = VERDICT_NAMES.get(r.get("setup") or "")
        if sk and r.get("verdict") in KEPT and r.get("sym") and r.get("asof"):
            out.add((sk, str(r["sym"]).upper(), str(r["asof"])[:10]))
    return out


def atlas_items(path, top=1000, per_setup=800, seed=7):
    """Every clean, institutional instance the deep scan found (scan_history.py), worked or failed, sampled evenly."""
    import gzip
    import random
    rows = [json.loads(l) for l in gzip.open(path, "rt", encoding="utf-8")]
    by = {}
    for r in rows:
        if r["skill"] in RULES and not r.get("co_fires") and (r.get("liq_rank") or 10**9) <= top:
            by.setdefault(r["skill"], []).append(r)
    items, rnd = [], random.Random(seed)
    for sk, lst in by.items():
        rnd.shuffle(lst)
        for r in lst[:per_setup]:
            t = str(r["t"])
            items.append({"skill_id": sk, "sym": r["sym"], "asof": f"{t[:4]}-{t[4:6]}-{t[6:8]}"})
    return items


def bars_for(c, sym, asof):
    key = int(str(asof).replace("-", "")[:8])
    before = c.execute("SELECT ts,o,h,l,c,v FROM (SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? "
                       "ORDER BY ts DESC LIMIT ?) ORDER BY ts", (sym.upper(), key, CONTEXT)).fetchall()
    after = c.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts>? ORDER BY ts LIMIT ?",
                      (sym.upper(), key, FORWARD + 2)).fetchall()
    if not before or int(before[-1][0]) != key:
        return None, None
    rows = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in before + after]
    return rows, len(before) - 1


def pct(xs, cond):
    return round(100 * sum(1 for x in xs if cond(x)) / len(xs)) if xs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars", default=DEFAULT_BARS)
    ap.add_argument("--out", default=str(REPO / "docs" / "study" / "levels" / "evidence.md"))
    ap.add_argument("--source", choices=("bank", "kept", "atlas"), default="bank")
    ap.add_argument("--atlas", default=None, help="the deep scan's atlas.jsonl.gz (scripts/study/bank_v2/scan_history.py)")
    ap.add_argument("--per-setup", type=int, default=800)
    a = ap.parse_args()
    c = sqlite3.connect(f"file:{a.bars}?mode=ro", uri=True)
    if a.source == "atlas":
        items = atlas_items(a.atlas, per_setup=a.per_setup)
        title = "candidate rules replayed on the deep scan (every clean, institutional instance since 1995, worked or failed)"
        note = ("The instances are every one the owner's calibrated finders accepted in the top 1,000 stocks by dollar volume "
                "that day since 1995, with no other setup firing on the same bar, sampled evenly up to "
                f"{a.per_setup} per setup, and NOT filtered for having worked: this is the closest thing to the setup's real edge "
                "the data allows (still only stocks listed today: delisted names are missing).")
    elif a.source == "kept":
        kept = kept_set()
        items = [it for it in load_items() if (it["skill_id"], str(it["sym"]).upper(), str(it["asof"])[:10]) in kept]
        title = "candidate rules replayed on the examples the owner KEPT"
        note = ("Only the bank examples his verdict log marks keep / keep_lesser / owner_reference. They were still chosen to "
                "work, so a stop at the setup day's own low looks good partly by construction.")
    else:
        items = load_items()
        title = "candidate rules replayed on the bank's own examples"
        note = ("The examples are the owner's chosen charts, not a random sample: the tables show which rule FITS his "
                "examples, not the setup's edge.")
    lines = [f"# Levels evidence: {title}", "",
             "Generated by `docs/study/levels/measure_rules.py` (read-only). " + note + " Daily bars cannot order the "
             "moves inside a day, so the stop is not checked on the fill day, and the stop day's high is not counted.", "",
             "Columns: **n** examples the rule applied to · **risk** median stop distance (% of entry) · **stop hit** the initial "
             "stop was hit at some point in 60 sessions, even after a gain (nothing trails yet; the sell rules are his to make) · **1R / 2R / 3R** reached that multiple of the risk before any stop · **best R** median "
             "best move in R before the stop · **+20 sessions** median return 20 sessions after the fill, trades not stopped.", ""]
    for skill, spec in RULES.items():
        mine = [it for it in items if it["skill_id"] == skill]
        loaded = [(it, *bars_for(c, it["sym"], it["asof"])) for it in mine]
        loaded = [(it, b, i) for it, b, i in loaded if b and i is not None and i >= 60]
        lines += [f"## {spec['name']} ({len(loaded)} of {len(mine)} examples with bars)", "",
                  "| entry | stop | n | risk | stop hit | 1R | 2R | 3R | best R | +20 sessions |",
                  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for en, efn in spec["entries"].items():
            for sn, sfn in spec["stops"].items():
                res = []
                for it, b, i in loaded:
                    e = efn(b, i)
                    if not e:
                        continue
                    entry, off = e
                    s = sfn(b, i, entry)
                    if s is None:
                        continue
                    r = replay(b, i, entry, off, s, spec["short"])
                    if r:
                        res.append(r)
                if not res:
                    lines.append(f"| {en} | {sn} | 0 | | | | | | | |"); continue
                risk = statistics.median(r[3] for r in res)
                best = statistics.median(r[1] for r in res)
                r20 = [r[2] for r in res if r[2] is not None]
                lines.append(f"| {en} | {sn} | {len(res)} | {risk:.1f}% | {pct(res, lambda r: r[0])}% | "
                             f"{pct(res, lambda r: r[1] >= 1)}% | {pct(res, lambda r: r[1] >= 2)}% | {pct(res, lambda r: r[1] >= 3)}% | "
                             f"{best:.1f} | {(statistics.median(r20) if r20 else 0):+.1f}% |")
        lines.append("")
    pathlib.Path(a.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
