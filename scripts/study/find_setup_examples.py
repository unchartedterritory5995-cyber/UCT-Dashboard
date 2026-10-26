"""Find VARIED real-chart examples of the seven UCT setups (read-only on the pod).

Runs the firm's own detectors (api.services.pattern_engine.detectors.uct.*)
over a wide candidate list and many years of the pod's bars.db, then applies
the owner's 2026-10-23/24 rulings on top. Keeps at most one chart per symbol
per setup, spread across years, and never reuses a (sym, asof) across setups.
Prints JSON: {generated, scanned, examples: [{setup, sym, asof, facts}]}.
It reads bars.db only (get_bars_before); it writes nothing.
"""
import json, os, sys, time
from datetime import date

REPO = os.getcwd()
sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from api.services.pattern_engine.detectors.uct import (  # noqa
    uct_kicker, uct_hve, uct_gap_support, uct_go_signal, uct_launch_pad, uct_oops_reversal, uct_slingshot)
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa

MAX_SYMS = int(os.environ.get("FS_MAX_SYMS", "320"))
BARS = int(os.environ.get("FS_BARS", "1500"))       # ~6 years
PER_SETUP = 10
PER_YEAR = 3
MIN_GAP = 60
WINDOW, FORWARD = 120, 20


def key_to_iso(k):
    s = str(int(k)); return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def rows_to_bars(rows):
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5])}
            for r in rows]


def pct(a, b):
    return (a / b - 1) * 100 if b else 0.0


# ---- owner overlays (2026-10-23/24 rulings), each returns (ok, facts) ----
def ov_launchpad(bars, S, i, c):
    cc = S["c"]; hi = max(cc[i - 120:i])
    vals = [S[k][i] for k in ("e8", "e21", "s50") if S[k][i]]
    spread = (max(vals) - min(vals)) / cc[i] * 100 if vals else None
    return True, {"ma_spread_pct": round(spread, 2) if spread is not None else None,
                  "from_120d_high_pct": round(pct(cc[i], hi), 1), "above_sma200": bool(S["s200"][i] and cc[i] > S["s200"][i])}


def ov_kicker(bars, S, i, c):
    b, p = bars[i], bars[i - 1]
    rng = b["h"] - b["l"]
    f = {"prior_red": p["c"] < p["o"], "gap_pct": round(pct(b["o"], p["c"]), 2), "day_pct": round(pct(b["c"], p["c"]), 2),
         "green": b["c"] > b["o"], "close_above_prior_high": b["c"] > p["h"],
         "close_pos": round((b["c"] - b["l"]) / rng, 2) if rng else 0}
    ok = f["prior_red"] and f["gap_pct"] >= 1.0 and f["green"] and f["close_above_prior_high"] and f["close_pos"] >= 0.7 and f["day_pct"] >= 3.0
    return ok, f


def ov_hve(bars, S, i, c):
    b, p = bars[i], bars[i - 1]
    f = {"up_day": b["c"] > p["c"], "day_pct": round(pct(b["c"], p["c"]), 2), "rvol": c.get("rvol") or c.get("rvol50")}
    return f["up_day"], f


def ov_gap_support(bars, S, i, c):
    return True, {"gap_pct": c.get("gap_pct"), "bars_since_gap": c.get("bars_since_gap"), "first_test": c.get("first_test"),
                  "levels_touched": c.get("levels_touched")}


def ov_go_signal(bars, S, i, c):
    return True, {"swept": c.get("swept"), "red_to_green": c.get("red_to_green"), "dcr": c.get("dcr")}


def ov_oops(bars, S, i, c):
    b, p = bars[i], bars[i - 1]
    f = {"scanner": True, "williams": b["o"] < p["l"], "super": b["c"] > p["h"],
         "open_vs_prior_low_pct": round(pct(b["o"], p["l"]), 2), "day_pct": round(pct(b["c"], p["c"]), 2)}
    f["variant"] = "super" if f["super"] else ("williams+scanner" if f["williams"] else "scanner")
    rng = b["h"] - b["l"]; f["close_pos"] = round((b["c"] - b["l"]) / rng, 2) if rng else 0
    return (f["day_pct"] >= 1.5 and f["close_pos"] >= 0.6), f


def ov_slingshot(bars, S, i, c):
    """Owner: a good rally up OR an earnings gapper, THEN a consolidation, THEN the
    recapture. The trigger day itself is never a gap day."""
    b, p = bars[i], bars[i - 1]
    cc = S["c"]
    trig_gap = pct(b["o"], p["c"])
    if trig_gap >= 3.0:
        return False, {"why": "trigger is a gap day"}
    # consolidation: the 3 prior closes under E4H is the detector's S2; add that the
    # pullback is at least 3 sessions and shallow (above the 50-day)
    # the drive BEFORE the pullback: a gap >= 5% on 2x volume, or a >= 20% rally, ending 4..40 bars ago
    gap_ev = None
    for k in range(i - 40, i - 3):
        if k < 51: continue
        g = pct(bars[k]["o"], bars[k - 1]["c"])
        v50 = S["v50"][k - 1]
        if g >= 5.0 and v50 and S["v"][k] >= 2.0 * v50:
            gap_ev = {"gap_day": key_to_iso(bars[k]["t"]), "gap_pct": round(g, 1), "bars_ago": i - k}
    rally = None
    for k in range(i - 40, i - 3):
        if k < 60: continue
        lo = min(cc[k - 60:k - 10]) if k - 60 >= 0 else None
        if lo and cc[k] / lo >= 1.20:
            rally = {"rally_pct": round(pct(cc[k], lo), 1), "peak_day": key_to_iso(bars[k]["t"]), "bars_ago": i - k}
    s50_rising = S["s50"][i] and S["s50"][i - 20] and S["s50"][i] > S["s50"][i - 20]
    f = {"trigger_gap_pct": round(trig_gap, 2), "earnings_like_gap": gap_ev, "rally": rally, "sma50_rising": bool(s50_rising)}
    ok = bool(gap_ev) or (bool(rally) and bool(s50_rising))
    return ok, f


DETECTORS = [
    ("Launchpad", uct_launch_pad, ov_launchpad),
    ("Kicker Candle", uct_kicker, ov_kicker),
    ("High Volume Edge", uct_hve, ov_hve),
    ("Oops Reversal", uct_oops_reversal, ov_oops),
    ("Slingshot", uct_slingshot, ov_slingshot),
    ("Gap Support", uct_gap_support, ov_gap_support),
    ("Go Signal", uct_go_signal, ov_go_signal),
]


def legible(bars, i, n=20, frac=0.8):
    hist = bars[i - n:i]
    avg = sum(x["h"] - x["l"] for x in hist) / n
    return avg > 0 and (bars[i]["h"] - bars[i]["l"]) >= frac * avg


def _days(k):
    import datetime as _d
    s = str(int(k)); return _d.date(int(s[:4]), int(s[4:6]), int(s[6:8])).toordinal()


def clean_window(bars, i, window=WINDOW, forward=FORWARD):
    """No era jumps (the window spans a normal number of calendar days), no
    corrupt bar (a close-to-close move over 60%, or a wick 1.4x past the body range)."""
    lo, hi = i - window + 1, i + forward
    if lo < 0 or hi >= len(bars) or bars[i]["t"] < 20190101:
        return False
    if _days(bars[hi]["t"]) - _days(bars[lo]["t"]) > (window + forward) * 1.9:
        return False
    for k in range(lo + 1, hi + 1):
        a, b = bars[k - 1], bars[k]
        if a["c"] <= 0 or abs(b["c"] / a["c"] - 1) > 0.60:
            return False
        body = max(b["o"], b["c"]) - min(b["o"], b["c"])
        rng = b["h"] - b["l"]
        if rng > 0 and body > 0 and rng > 12 * body and rng / b["c"] > 0.25:
            return False
    return True


def main():
    t0 = time.time()
    uni = json.load(open(os.path.join(REPO, "api/data/cap_universe.json"), encoding="utf-8"))
    extra = [s for k, s in enumerate(uni) if k % 9 == 0 and s not in ALL_CANDIDATES]
    syms = (ALL_CANDIDATES + extra)[:MAX_SYMS]
    today = int(date.today().strftime("%Y%m%d"))
    hits = {name: [] for name, _, _ in DETECTORS}
    scanned = 0
    for sym in syms:
        try:
            rows = bars_sqlite.get_bars_before(sym, "D", BARS, today)
        except Exception:
            continue
        if len(rows) < 400:
            continue
        bars = rows_to_bars(rows)
        if bars[-1]["t"] < today - 100:   # stale listing (the stored history is another era)
            continue
        if bars[-1]["c"] < 8 or (sum(b["v"] for b in bars[-50:]) / 50) < 500_000:
            continue
        scanned += 1
        S = U.series(bars)
        for name, mod, ov in DETECTORS:
            last_i = -10_000
            for i in range(260, len(bars) - FORWARD - 1):
                if i - last_i < MIN_GAP:
                    continue
                try:
                    c = mod.evaluate(bars, S, i)
                except Exception:
                    c = None
                if not c:
                    continue
                ok, facts = ov(bars, S, i, c)
                if not ok or not legible(bars, i) or not clean_window(bars, i):
                    continue
                q = min(float(facts.get("day_pct") or 0), 12.0) + min(float(facts.get("dcr") or 0), 0.9)                     + (2.0 if facts.get("first_test") else 0.0) + (1.0 if facts.get("super") else 0.0)                     + (1.0 if (facts.get("bars_since_gap") or 0) >= 5 else 0.0)
                hits[name].append({"setup": name, "sym": sym, "asof": key_to_iso(bars[i]["t"]), "year": int(str(bars[i]["t"])[:4]),
                                   "close": bars[i]["c"], "facts": facts, "q": q})
                last_i = i
    # select: best quality first, one per sym per setup, <= PER_YEAR per year, >= 30 days from any
    # other pick of the same setup, no (sym, asof) reuse across setups
    import datetime as _dt
    def dnum(a): return _dt.date.fromisoformat(a).toordinal()
    used = set()
    out = []
    for name, _, _ in DETECTORS:
        rows = sorted(hits[name], key=lambda r: (-r["q"], r["asof"]))
        picked, per_sym, per_year = [], {}, {}
        for r in rows:
            k = (r["sym"], r["asof"])
            if k in used or per_sym.get(r["sym"], 0) >= 1 or per_year.get(r["year"], 0) >= PER_YEAR:
                continue
            if any(abs(dnum(r["asof"]) - dnum(p["asof"])) < 30 for p in picked):
                continue
            var = (r["facts"] or {}).get("variant")
            if var and sum(1 for p in picked if p["facts"].get("variant") == var) >= 4:
                continue
            picked.append(r); used.add(k)
            per_sym[r["sym"]] = 1; per_year[r["year"]] = per_year.get(r["year"], 0) + 1
            if len(picked) >= PER_SETUP:
                break
        out.extend(sorted(picked, key=lambda r: r["asof"]))
    print(json.dumps({"generated": date.today().isoformat(), "scanned": scanned, "candidates": len(syms),
                      "seconds": round(time.time() - t0), "raw_hits": {k: len(v) for k, v in hits.items()},
                      "examples": out}, indent=1))


if __name__ == "__main__":
    main()
