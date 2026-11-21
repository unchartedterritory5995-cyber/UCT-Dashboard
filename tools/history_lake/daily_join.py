"""Step 3 of the deep daily rebuild (2026-11-18): history from BEFORE the vendor's archive (2003-09-10) or before
a lineage's first segment, from the second vendor, joined only where the two provably describe one series.

For each rebuilt series (D:/uct-history/daily-v1/series/<SYM>.json, built by daily_build.py):
  * the second vendor's (yfinance, auto_adjust=False: split-adjusted) per-company bars BEFORE the rebuild's
    first bar are candidates;
  * the ratio yf_close / rebuilt_close over the first JOIN_SESSIONS shared sessions must hold within JOIN_TOL
    on EVERY session (one security, one basis); its median is the join factor;
  * joined: the candidates divided by the factor (volume x factor), written in front of the rebuilt bars.
  * not joined (too short an overlap, or a wandering ratio): the series starts where the vendor's does, and
    the reason is recorded. A gap is better than a wrong price.
Output: D:/uct-history/daily-v1/joined/<SYM>.json (the rebuilt record plus "pre": {joined, factor, bars, reason}).
Reads only. python tools/history_lake/daily_join.py --root D:/uct-history
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # the repo root: `api.services.bars_sanitize`

JOIN_SESSIONS, JOIN_TOL, CHUNK = 250, 0.02, 40
#: A second-vendor split this close to an event the split table already carries is that event (heal_splits).
SAME_EVENT_NEAR_DAYS = 3


def clean_split_ratio(r: float) -> bool:
    """A real split's ratio (or its inverse) is a small fraction: 3:2, 5:4, 2:1, 1:10 ... The second vendor also
    files spin-offs in its split list at whatever price ratio they caused (ABT 2013-01-02 = 2.0842, AbbVie);
    the app's series are SPLIT-adjusted only, so those are never applied."""
    for x in (r, 1.0 / r):
        for q in range(1, 11):
            if abs(x * q - round(x * q)) <= 0.01 and round(x * q) >= 1:
                return True
    return False


def heal_splits(rec: dict, yf_splits: list) -> dict:
    """Splits the vendor's split reference lacks, from the second vendor's list, applied ONLY where the
    rebuilt (raw-based) series shows the matching cliff (`bars_sanitize.unadjusted_splits`, the app's one split
    detector: a close step matching the declared ratio within +-7 sessions of the declared date).

    ⚰️ 2026-11-18: the reference had no entry for Balchem's 3:2 splits before 2007 (none under BCP, only 2007
    and 2010 under BCPC), so the rebuild drew two -33% overnight drops that never traded."""
    from api.services import bars_sanitize as S
    import datetime as _dt
    have = [(_dt.date.fromisoformat(d), float(r)) for d, r in rec.get("splits") or ()]

    def _already(d: str, r: float) -> bool:
        """The same event the reference already applied, filed a few days apart (BMI 2016: applied twice
        otherwise, the rebuild read half the price for 43 years).
        ⭐ 2026-11-21: ANY event the split table carries within SAME_EVENT_NEAR_DAYS is that event, whatever the
        second vendor's ratio. The table holds the vendor's events and the TradingView-verified supplement rows
        (split_supplement.json); a second vendor's different ratio for one of them is its error, never a second
        event. ⚰️ ATRO 2018: the vendor's 1.15 on 10-11 plus Yahoo's 1.182 on 10-10 put every bar before it
        15.4% below the vendor basis. FTI 2021 (TradingView 1.2216, Yahoo 1.344) and the other verified
        spin-offs rely on this: the rebuild never leaves a verified event to the cliff test."""
        x = _dt.date.fromisoformat(d)
        return any(abs((x - hd).days) <= SAME_EVENT_NEAR_DAYS
                   or (abs((x - hd).days) <= 14 and abs(r / hr - 1) <= 0.02) for hd, hr in have)

    # ⭐ Spin-offs count too. The second vendor files them in its split list at the price ratio they caused
    # (REZI 2026-08-04 = 1.437, VYX 2023 = 1.63, NTGR 2019 = 1.612, ABT 2013 = 2.0842), and the served
    # history adjusts for them exactly the same way (measured: it agrees with the second vendor there), so a
    # rebuild without them would move hundreds of members' charts onto a different basis. The cliff test is
    # what authorises each one; a ratio too close to 1 to tell from an ordinary day is never applied
    # (`bars_sanitize.adjudicable`, inside `unadjusted_splits`).
    cand = [(d, float(r)) for d, r in yf_splits if r and float(r) > 0 and not _already(d, float(r))]
    if not cand or not rec["bars"]:
        rec["healed_splits"] = []
        return rec
    dicts = [{"t": b[0], "c": b[4]} for b in rec["bars"]]
    found = S.unadjusted_splits(dicts, cand)
    if found:
        bars = []
        for d, o, h, l, c, v in rec["bars"]:
            f = S.split_factor(__import__("datetime").date.fromisoformat(d), found)
            bars.append([d, round(o / f, 4), round(h / f, 4), round(l / f, 4), round(c / f, 4), round(v * f)] if f != 1.0
                        else [d, o, h, l, c, v])
        rec["bars"] = bars
    rec["healed_splits"] = [[b.isoformat(), r] for b, r in found]
    return rec


def join_one(rec: dict, yf_rows: list) -> dict:
    """`yf_rows`: [[ISO, o, h, l, c, v], ...] ascending. Returns `rec` with "pre" and, when joined, the
    earlier bars in front."""
    bars = rec["bars"]
    out = dict(rec)
    if not bars or not yf_rows:
        out["pre"] = {"joined": False, "reason": "no second-vendor bars" if bars else "empty rebuild"}
        return out
    first = bars[0][0]
    yc = {r[0]: r[4] for r in yf_rows}
    ratios = [yc[b[0]] / b[4] for b in bars[:JOIN_SESSIONS] if yc.get(b[0]) and b[4] > 0]
    before = [r for r in yf_rows if r[0] < first]
    if not before:
        out["pre"] = {"joined": False, "reason": "the second vendor starts no earlier"}
        return out
    if len(ratios) < JOIN_SESSIONS // 2:
        out["pre"] = {"joined": False, "reason": f"overlap too short ({len(ratios)} sessions)"}
        return out
    med = statistics.median(ratios)
    worst = max(abs(x / med - 1) for x in ratios)
    if worst > JOIN_TOL:
        out["pre"] = {"joined": False, "reason": f"ratio wanders ({worst:.1%} off the median)", "factor": round(med, 5)}
        return out
    pre = [[d, round(o / med, 4), round(h / med, 4), round(l / med, 4), round(c / med, 4), round(v * med)]
           for d, o, h, l, c, v in before if c and c > 0]
    out["bars"] = pre + bars
    out["pre"] = {"joined": True, "factor": round(med, 5), "bars": len(pre), "from": pre[0][0] if pre else None}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="D:/uct-history")
    a = ap.parse_args(argv)
    import yfinance as yf
    src = Path(a.root) / "daily-v1" / "series"
    dst = Path(a.root) / "daily-v1" / "joined"
    dst.mkdir(parents=True, exist_ok=True)
    todo = sorted(p.stem for p in src.glob("*.json") if not (dst / p.name).exists())
    t0 = time.time()
    for k in range(0, len(todo), CHUNK):
        chunk = todo[k:k + CHUNK]
        try:
            data = yf.download(chunk, period="max", auto_adjust=False, actions=True, group_by="ticker",
                               progress=False, threads=True)
        except Exception as e:  # noqa: BLE001
            print("yf chunk failed", chunk[0], e, flush=True)
            time.sleep(30)
            continue
        for sym in chunk:
            rec = json.loads((src / f"{sym}.json").read_text(encoding="utf-8"))
            try:
                df = (data[sym] if len(chunk) > 1 else data).dropna(subset=["Close"])
                rows = [[str(i)[:10], float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"]), float(r["Volume"] or 0)]
                        for i, r in df.iterrows()]
                splits = [[str(i)[:10], float(v)] for i, v in df["Stock Splits"].items() if v and float(v) > 0] \
                    if "Stock Splits" in df else []
            except Exception:  # noqa: BLE001
                rows, splits = [], []
            out = join_one(heal_splits(rec, splits), rows)
            tmp = dst / f"{sym}.json.tmp"
            tmp.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
            os.replace(tmp, dst / f"{sym}.json")
        print(f"{k + len(chunk)}/{len(todo)} {time.time() - t0:.0f}s", flush=True)
        time.sleep(3)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
