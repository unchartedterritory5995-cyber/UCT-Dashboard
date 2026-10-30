"""Go Signal HOURLY finder (local, reads docs/study/setups/go_signal_hourly_bars.json).

Owner rulings 2026-10-27 (docs/study/audits/2026-10-24/owner_verdicts.jsonl, the two Go Signal `rule` lines):
"GO SIGNAL is similar to the oops reversal or the UNR but is an hourly GO SIGNAL" and "GO SIGNALS are supposed
to be notable hourly flags that undercut a slight range and quickly go red to green in the first hour", off a
"higher low" in the flag. The daily bar is only the footprint; this finder reads the hourly bars.

For every regular session in a name's window it asks, of the FIRST HOUR (the 9:30 bucket):
  (1) a prior advance into the flag (the flag high sits well above the low of the sessions before it),
  (2) a flag: the previous 2-5 sessions of hourly bars hold a tight range (the tightest span of 2-5 sessions),
  (3) the first hour UNDERCUTS the flag low,
  (4) the first hour closes back above its open AND above the flag low (red to green, the reclaim),
  (5) volume on the reclaim against the flag sessions' first hours,
plus "higher low": the flag low sits above the swing low before the advance. The forward strip (rest of the
session, 5 sessions on) is reported so the MUST WORK rule can be applied. Nothing is written to the pod.

Output: docs/study/setups/go_signal_hourly_candidates.json (per name: the owner's day, every firing session
in the window, facts) and a printed table. Run from the repo root:
    python -X utf8 scripts/study/find_go_signal_hourly.py
"""
import json, os, sys
from datetime import datetime
from zoneinfo import ZoneInfo

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, "docs", "study", "setups", "go_signal_hourly_bars.json")
OUT = os.path.join(REPO, "docs", "study", "setups", "go_signal_hourly_candidates.json")
ET = ZoneInfo("America/New_York")
FLAG_MIN, FLAG_MAX = 2, 5          # sessions in the flag
ADVANCE_LOOKBACK = 15              # sessions before the flag that hold the prior advance
SWING_LOOKBACK = 10                # sessions before the flag whose low is the "lower low" a higher low must beat
MAX_FLAG_RANGE_PCT = 10.0          # a "slight range"
MIN_ADVANCE_PCT = 8.0              # a prior advance worth flagging


def pct(a, b):
    return (a / b - 1.0) * 100.0 if b else 0.0


def session_of(t):
    return datetime.fromtimestamp(int(t), tz=ET).strftime("%Y-%m-%d")


def is_open_bar(t):
    d = datetime.fromtimestamp(int(t), tz=ET)
    return d.hour == 9 and d.minute == 30


def to_bars(rows):
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5])} for r in rows]


def sessions(bars):
    """Ordered list of (date, [bars]) with only sessions that start at the 9:30 bucket."""
    by = {}
    for b in bars:
        by.setdefault(session_of(b["t"]), []).append(b)
    out = []
    for d in sorted(by):
        bs = sorted(by[d], key=lambda x: x["t"])
        if is_open_bar(bs[0]["t"]):
            out.append((d, bs))
    return out


def evaluate(sess, k):
    """Facts for the first hour of session k, or None when the window is too short."""
    if k < FLAG_MIN + 2:
        return None
    day, bs = sess[k]
    first = bs[0]
    prev_close = sess[k - 1][1][-1]["c"]
    best = None
    for n in range(FLAG_MIN, FLAG_MAX + 1):
        if k - n < 0:
            break
        fb = [b for _, s in sess[k - n:k] for b in s]
        fh, fl = max(b["h"] for b in fb), min(b["l"] for b in fb)
        rng = pct(fh, fl)
        if best is None or rng < best[0]:
            best = (rng, n, fh, fl, fb)
    rng, n, fh, fl, fb = best
    pre = [b for _, s in sess[max(0, k - n - ADVANCE_LOOKBACK):k - n] for b in s]
    swing = [b for _, s in sess[max(0, k - n - SWING_LOOKBACK):k - n] for b in s]
    adv_low = min(b["l"] for b in pre) if pre else None
    swing_low = min(b["l"] for b in swing) if swing else None
    adv_pct = pct(fh, adv_low) if adv_low else 0.0
    flag_first_vols = [s[0]["v"] for _, s in sess[k - n:k] if s]
    avg_fv = sum(flag_first_vols) / len(flag_first_vols) if flag_first_vols else 0.0
    undercut = first["l"] < fl
    red_to_green = first["c"] > first["o"] and first["c"] > fl
    dipped_below_prev_close = first["l"] < prev_close
    day_close = bs[-1]["c"]
    fwd = sess[k + 1:k + 6]
    fwd_closes = [s[-1]["c"] for _, s in fwd]
    fwd_high = max((b["h"] for _, s in fwd for b in s), default=None)
    fires = undercut and red_to_green and rng <= MAX_FLAG_RANGE_PCT and adv_pct >= MIN_ADVANCE_PCT
    higher_low = bool(swing_low) and fl > swing_low
    f = {
        "session": day, "first_hour_t": first["t"], "flag_sessions": n, "flag_start_t": fb[0]["t"],
        "flag_high": round(fh, 2), "flag_low": round(fl, 2), "flag_range_pct": round(rng, 1),
        "advance_pct": round(adv_pct, 1), "advance_low": round(adv_low, 2) if adv_low else None,
        "swing_low": round(swing_low, 2) if swing_low else None, "higher_low": higher_low,
        "prev_close": round(prev_close, 2), "first_open": first["o"], "first_low": first["l"], "first_close": first["c"],
        "undercut": undercut, "undercut_pct": round(pct(fl, first["l"]), 2) if undercut else 0.0,
        "red_to_green": red_to_green, "dipped_below_prev_close": dipped_below_prev_close,
        "reclaim_pct": round(pct(first["c"], fl), 2), "first_hour_vol_x": round(first["v"] / avg_fv, 2) if avg_fv else None,
        "day_close_vs_first_close_pct": round(pct(day_close, first["c"]), 2),
        "fwd_5s_pct": round(pct(fwd_closes[-1], first["c"]), 2) if len(fwd_closes) == 5 else None,
        "fwd_5s_high_pct": round(pct(fwd_high, first["c"]), 2) if fwd_high else None,
        "fwd_sessions_available": len(fwd), "fires": fires,
    }
    sc = (5 if fires else 0) + (2 if rng <= 5 else 1 if rng <= 8 else 0) + (1 if higher_low else 0)
    sc += 1 if (f["first_hour_vol_x"] or 0) >= 1.2 else 0
    sc += 1 if (f["fwd_5s_pct"] or 0) > 0 else 0
    sc += 1 if f["day_close_vs_first_close_pct"] > 0 else 0
    f["score"] = sc
    return f


def main():
    doc = json.load(open(SRC, encoding="utf-8"))
    report = {"generated": datetime.now().strftime("%Y-%m-%d"), "source": SRC.replace(REPO + os.sep, ""),
              "rules": {"flag_sessions": [FLAG_MIN, FLAG_MAX], "max_flag_range_pct": MAX_FLAG_RANGE_PCT,
                        "min_advance_pct": MIN_ADVANCE_PCT, "fires": "undercut of the flag low in the first hour, first-hour close above its open and above the flag low, a slight flag range, a prior advance"},
              "names": {}}
    print(f"{'name':<18}{'owner day':<12}{'fires':<7}{'flag%':<7}{'adv%':<7}{'HL':<5}{'under%':<8}{'recl%':<7}{'volx':<6}{'fwd5%':<7} other firing sessions")
    for key, rec in doc["names"].items():
        sym, asof = key.split("|")
        if "bars" not in rec:
            continue
        sess = sessions(to_bars(rec["bars"]))
        idx = {d: i for i, (d, _) in enumerate(sess)}
        owner = evaluate(sess, idx[asof]) if asof in idx else None
        firing = []
        for k in range(len(sess)):
            f = evaluate(sess, k)
            if f and f["fires"]:
                firing.append(f)
        report["names"][key] = {"sym": sym, "asof": asof, "owner_day": owner, "firing_sessions": firing,
                               "sessions_in_window": len(sess)}
        o = owner or {}
        others = [f["session"] for f in firing if f["session"] != asof]
        print(f"{key:<18}{asof:<12}{str(o.get('fires')):<7}{o.get('flag_range_pct', ''):<7}{o.get('advance_pct', ''):<7}"
              f"{str(o.get('higher_low', '')):<5}{o.get('undercut_pct', ''):<8}{o.get('reclaim_pct', ''):<7}{str(o.get('first_hour_vol_x', '')):<6}"
              f"{str(o.get('fwd_5s_pct', '')):<7} {', '.join(others)}")
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(report, fh, indent=1)
        fh.write("\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
