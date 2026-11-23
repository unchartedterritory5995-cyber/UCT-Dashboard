"""Can a device build TODAY's forming daily bar from the minute feed? A read-only check against production.

For each symbol it compares the server's own daily bar for today (`/api/bars/{sym}?tf=D`, the bar every chart
receives) with what the device can know from the universe minute frames (`/api/hist/live1m/v1/<day>/...`,
decoded by `api/services/minute_frames.py`) and from the server's 1m bars:

    O/H/L   first regular-session minute's open, max high, min low (09:30 <= ET minute < the close)
    C       the last regular minute's close, the 16:00 minute's open / close
    V       the stream's accumulated day volume `av` (frames carry it with MINUTE_FRAMES_WITH_AV=1 on
            stream-ingest): at 15:59, at 16:00, and the newest one; and the plain minute-volume sums

and prints what the device would still need for the OFFICIAL close after 16:00 when the minutes cannot give it.

    DAILY   with MINUTE_FRAMES_WITH_DAILY=1 on stream-ingest, frames from the close to 20:00 carry the server's
            daily row (minute_frames FLAG_DAILY): the newest one per symbol must equal the served D bar exactly

Measured 2026-11-20 (59 symbols, after the close): O/H/L 57/57 from regular minutes; C equal to the 15:59 close in
9/57 (the official close is the closing auction); D volume above the regular-minute sum by a median 16%; `av` not
yet published (0 of 289 frames). This is the follow-up run once frames carry `av`.

    python tools/forming_daily_check.py                  # after 16:05 ET: the full comparison
    python tools/forming_daily_check.py --mid            # mid-session: D so far vs the newest av / minute
    python tools/forming_daily_check.py --symbols SPY,AAPL --json out.json

Signs in as the synthetic smoke account through tools/synthetic_session.py (the one sign-in: it reads the operator's
credentials, never prints or writes them, and signs the session OUT when the run ends, however it ends). Read-only;
~3 requests a symbol plus the day's frames (one today.bin + the newest minute files).
"""
from __future__ import annotations

import argparse
import functools
import json
import statistics
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import (every *_DB_PATH -> a sandbox; this tool only reads production over HTTP)

BASE = "https://uctintelligence.com"
ET = ZoneInfo("America/New_York")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0 Safari/537.36"
DEFAULT_SYMBOLS = (
    "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AVGO,BRK-B,JPM,V,LLY,"
    "SPY,QQQ,IWM,DIA,XLF,XLE,XLK,SMH,TLT,GLD,HYG,ARKK,"
    "SOFI,PLTR,HOOD,COIN,MARA,RIVN,SMCI,F,NIO,AMD,MU,INTC,"
    "MMU,HPI,BOKF,FISI,CCAP,NBTX,AZZ,NUTX,GYRE,TGS,DCBO,MAKO"
)
FLAG_AV = 1
FLAG_DAILY = 4


def et_parts(t: int):
    d = datetime.fromtimestamp(int(t), ET)
    return d.date().isoformat(), d.hour * 60 + d.minute


def regular_close_min(day_iso: str) -> int:
    try:
        from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
        return 780 if int(day_iso.replace("-", "")) in NYSE_EARLY_CLOSES_YYYYMMDD else 960
    except Exception:  # noqa: BLE001
        return 960


def load_frames(s, day_iso: str) -> list:
    from api.services import minute_frames as mf
    head = s.get(f"{BASE}/api/hist/live1m/v1/{day_iso}/head.json", timeout=30)
    head.raise_for_status()
    head = head.json()
    tb = s.get(f"{BASE}/api/hist/live1m/v1/{day_iso}/today.bin", timeout=60)
    frames = list(mf.decode_today(tb.content)["frames"]) if tb.status_code == 200 else []
    last = frames[-1]["seq"] if frames else -1
    for seq in range(last + 1, (head.get("seq") or last) + 1):
        fr = s.get(f"{BASE}/api/hist/live1m/v1/{day_iso}/{mf.hhmm_of_seq(seq)}.bin", timeout=30)
        if fr.status_code == 200:
            frames.append(mf.decode_frame(fr.content))
    return frames


def av_series(frames: list, symbols: set) -> dict:
    """{sym: {minute_of_day: av}} from every frame that carries av (later blocks win)."""
    out: dict = {}
    for f in frames:
        if not f["flags"] & FLAG_AV:
            continue
        for blk in f["blocks"]:
            mod = et_parts(blk["minute"] * 60)[1]
            for sym, row in blk["rows"].items():
                if sym in symbols and len(row) > 5 and row[5] is not None:
                    out.setdefault(sym, {})[mod] = row[5]
    return out


def daily_rows(frames: list, symbols: set) -> dict:
    """{sym: (row, minute_of_day)}: the newest DAILY-section row per symbol (frames carry the server's
    daily bar after the close when MINUTE_FRAMES_WITH_DAILY=1 on stream-ingest)."""
    out: dict = {}
    for f in frames:
        mod = et_parts(f["minute"] * 60)[1]
        for sym, row in (f.get("daily") or {}).items():
            if sym in symbols:
                out[sym] = (row, mod)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--symbols", default=DEFAULT_SYMBOLS)
    ap.add_argument("--mid", action="store_true", help="mid-session read (today's bar is still forming)")
    ap.add_argument("--json", default=None, help="also write every row here")
    a = ap.parse_args(argv)
    import requests

    # tools/synthetic_session.py: the ONE sign-in for a synthetic account, signed OUT in the `finally` below. This tool
    # used to POST the login itself and never sign out, so every run left a 30-day live session behind
    # (tests/test_synthetic_session_signout.py).
    try:
        from tools import synthetic_session as S  # noqa: PLC0415 -- package import
    except ImportError:
        import synthetic_session as S  # noqa: PLC0415 -- script import (tools/ on sys.path)
    s = requests.Session()
    s.headers["User-Agent"] = UA
    # The helper POSTs the login with the client's own `post` and passes no timeout, and a requests session has no
    # default one, so the login could wait as long as production takes. This session's `post` carries the 30 s the
    # old login used. The helper's own requests (the /api/auth/me check, the sign-out) already carry 30 s.
    s.post = functools.partial(s.post, timeout=30)
    session = S.sign_in_client(s, BASE, "smoke", timeout=30)
    try:
        session.response.raise_for_status()
        return _compare(a, s)
    finally:
        session.close()


def _compare(a, s) -> int:
    """The comparison, on the signed-in session `s` (`a`: the parsed arguments)."""
    now = datetime.now(ET)
    day = now.date().isoformat()
    close = regular_close_min(day)
    syms = [x.strip().upper() for x in a.symbols.split(",") if x.strip()]
    frames = load_frames(s, day)
    with_av = sum(1 for f in frames if f["flags"] & FLAG_AV)
    avs = av_series(frames, set(syms))
    with_daily = sum(1 for f in frames if f["flags"] & FLAG_DAILY)
    drows = daily_rows(frames, set(syms))
    print(f"{now:%Y-%m-%d %H:%M} ET  frames {len(frames)}, carrying av {with_av}, carrying the daily section {with_daily}")

    rows = []
    for sym in syms:
        d = s.get(f"{BASE}/api/bars/{sym}?tf=D&bars=5", timeout=30)
        m = s.get(f"{BASE}/api/bars/{sym}?tf=1&bars=1199&session=eth", timeout=60)
        if d.status_code != 200 or m.status_code != 200:
            rows.append({"sym": sym, "error": [d.status_code, m.status_code]})
            continue
        db = d.json().get("bars") or []
        D = db[-1] if db and db[-1].get("t") == day else None
        mins = [b for b in (m.json().get("bars") or [])
                if isinstance(b.get("t"), (int, float)) and et_parts(b["t"])[0] == day]
        reg = [b for b in mins if 570 <= et_parts(b["t"])[1] < close]
        if not D or not reg:
            rows.append({"sym": sym, "error": "no daily bar or no regular minutes today"})
            continue
        at = {et_parts(b["t"])[1]: b for b in mins}
        av = avs.get(sym, {})
        newest_av_min = max(av) if av else None
        r4 = lambda x: None if x is None else round(float(x), 4)  # noqa: E731
        row = {
            "sym": sym, "D": {k: D[k] for k in "ohlcv"},
            "o_eq": r4(D["o"]) == r4(reg[0]["o"]),
            "h_eq": r4(D["h"]) == r4(max(b["h"] for b in reg)),
            "l_eq": r4(D["l"]) == r4(min(b["l"] for b in reg)),
            "c_last_regular": reg[-1]["c"], "c_eq_last_regular": r4(D["c"]) == r4(reg[-1]["c"]),
            "m1600": at.get(close) and {k: at[close][k] for k in "ocv"},
            "v_regular_minutes": sum(b["v"] for b in reg), "v_all_minutes": sum(b["v"] for b in mins),
            "av_1559": av.get(close - 1), "av_1600": av.get(close),
            "av_newest": newest_av_min is not None and av[newest_av_min], "av_newest_at": newest_av_min,
        }
        row["c_eq_1600"] = bool(row["m1600"]) and r4(D["c"]) in (r4(row["m1600"]["o"]), r4(row["m1600"]["c"]))
        fd = drows.get(sym)
        row["frame_daily"] = fd and {"row": fd[0], "at": fd[1]}
        row["frame_daily_eq"] = bool(fd) and all(float(a) == float(D[k]) for a, k in zip(fd[0], "ohlcv"))
        rows.append(row)

    ok = [x for x in rows if "D" in x]
    n = len(ok)

    def count(key):
        return sum(1 for x in ok if x.get(key))

    def ratios(key):
        vals = [x["D"]["v"] / x[key] for x in ok if x.get(key)]
        return (round(statistics.median(vals), 4), round(min(vals), 4), round(max(vals), 4)) if vals else None

    print(f"symbols with today's daily bar: {n} (errors {len(rows) - n})")
    print(f"  O = first regular minute's open  {count('o_eq')}/{n}")
    print(f"  H = regular minutes' max         {count('h_eq')}/{n}")
    print(f"  L = regular minutes' min         {count('l_eq')}/{n}")
    print(f"  C = last regular minute's close  {count('c_eq_last_regular')}/{n}"
          f"   (= the {close // 60}:00 minute's open or close: {count('c_eq_1600')}/{n})")
    for key, label in (("av_1559", "av at the last regular minute"), ("av_1600", "av at the closing minute"),
                       ("av_newest", "newest av"), ("v_regular_minutes", "sum of regular minutes"),
                       ("v_all_minutes", "sum of every minute")):
        exact = sum(1 for x in ok if x.get(key) and int(x[key]) == int(x["D"]["v"]))
        have = sum(1 for x in ok if x.get(key))
        print(f"  V vs {label:<32} exact {exact}/{have}   D.v / it (median, min, max) {ratios(key)}")
    if not with_av:
        print("  (no frame carries av yet: MINUTE_FRAMES_WITH_AV is off on stream-ingest)")
    have_fd = sum(1 for x in ok if x.get("frame_daily"))
    print(f"  frames' DAILY row == the server's D bar (o/h/l/c/v exact): {count('frame_daily_eq')}/{have_fd}"
          f"   (symbols with a daily row in the frames: {have_fd}/{n})")
    if not with_daily:
        print("  (no frame carries the daily section: MINUTE_FRAMES_WITH_DAILY is off, or it is before the close)")
    for x in ok:
        if x.get("frame_daily") and not x["frame_daily_eq"]:
            print("  daily row differs:", x["sym"], "frame", x["frame_daily"], "server", x["D"])

    after_close = not a.mid and now.hour * 60 + now.minute >= close + 5
    if after_close:
        derivable = count("c_eq_last_regular")
        if have_fd and count("frame_daily_eq") == n:
            print("\nTHE FRAMES CARRY THE SERVER'S DAILY BAR for every symbol: the device can paint today's "
                  "D bar (and W/M) from the minute feed after the close.")
        print("\nOFFICIAL CLOSE: derivable from the minutes for "
              f"{derivable}/{n}. " + ("The device can take it from the minutes." if derivable == n else
              "The device needs the server's value after the close, either (1) the publisher adds the server's "
              "daily close (bars-api's snapshot `day.c`, the value /api/bars?tf=D serves) to the frames from the "
              "closing minute on, or (2) the device reads its symbol's /api/bars?tf=D once after the close "
              "(one small request per symbol opened)."))
        v_ok = sum(1 for x in ok if x.get("av_newest") and int(x["av_newest"]) == int(x["D"]["v"]))
        print(f"DAILY VOLUME from the newest av: exact {v_ok}/{n}. "
              + ("av carries the server's basis." if with_av and v_ok == n else
                 "Compare av_1600 / av_newest above: the server's D volume is the snapshot's day volume."))
    for x in ok:
        if not (x["o_eq"] and x["h_eq"] and x["l_eq"]):
            print("  O/H/L differs:", x["sym"], x["D"], {k: x[k] for k in ("o_eq", "h_eq", "l_eq")})
    if a.json:
        Path(a.json).write_text(json.dumps({"at": now.isoformat(), "rows": rows}, indent=1, default=str),
                                encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
