"""Universe-wide chart diagnostic.

Audits EVERY ticker for the things that break the main goal (instant,
accurate, real-time charts): staleness + OHLC integrity + phantom spikes.
Because Part 1 heals on access, this sweep also bulk-heals everything it
touches. Client-driven so a deploy can't kill it.
"""
import json, os, sys, time, urllib.request, random, collections
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"
ET = timezone(timedelta(hours=-4))  # EDT (valid Mar–Nov; fine for this run)

# NYSE full-day closures (extend yearly). Drives the dynamic "expected latest
# session" so the sweep flags TRUE staleness instead of comparing to a stale
# hardcoded date (the trap that made every chart look FRESH after May).
_NYSE_HOLIDAYS = {
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
    "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
}

def _expected_session_date():
    """Most recent NYSE trading day as of now (ET) — rolls back weekends,
    holidays, and weekday pre-open (before 9:35 ET)."""
    now = datetime.now(timezone.utc).astimezone(ET)
    d = now.date()
    if now.hour * 60 + now.minute < 9 * 60 + 35:
        d -= timedelta(days=1)
    for _ in range(14):
        if d.weekday() < 5 and d.isoformat() not in _NYSE_HOLIDAYS:
            return d
        d -= timedelta(days=1)
    return d

_EXP_DATE = _expected_session_date()
EXPECTED_DAILY = _EXP_DATE.isoformat()
EXPECTED_INTRADAY = _EXP_DATE.isoformat()
# Weekly bar is dated by the week's first trading day (Mon); monthly by 1st.
EXPECTED_WEEKLY = (_EXP_DATE - timedelta(days=_EXP_DATE.weekday())).isoformat()
EXPECTED_MONTHLY = _EXP_DATE.replace(day=1).isoformat()
REPORT = os.path.join(os.environ.get("TEMP", "/tmp"), "chart_diag_report.txt")

def fetch(ticker, tf, retry=1):
    url = f"{BASE}/api/bars/{ticker}?tf={tf}&bars=5000"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        if retry > 0:
            time.sleep(2)
            return fetch(ticker, tf, retry - 1)
        return {"_err": f"{type(e).__name__}:{str(e)[:80]}"}

def last_date(bars, tf):
    t = bars[-1]["t"]
    if isinstance(t, str):
        return t[:10]
    return datetime.fromtimestamp(int(t), ET).strftime("%Y-%m-%d")

def analyze(ticker, tf, resp):
    if "_err" in resp:
        return ("ERROR", resp["_err"], None)
    bars = resp.get("bars") or []
    if not bars:
        return ("EMPTY", "no bars", None)
    issues = []
    prev_t = None
    for b in bars:
        o, h, l, c = b.get("o"), b.get("h"), b.get("l"), b.get("c")
        v = b.get("v", 0)
        if None in (o, h, l, c):
            issues.append("NULL_OHLC"); break
        if h < l - 1e-6:
            issues.append("H<L"); break
        if h < max(o, c) - 1e-6 or l > min(o, c) + 1e-6:
            issues.append("OHLC_INVARIANT"); break
        if min(o, h, l, c) <= 0:
            issues.append("NONPOS_PRICE"); break
        if v < 0:
            issues.append("NEG_VOL"); break
        tt = b["t"]
        tn = tt if isinstance(tt, str) else int(tt)
        if prev_t is not None and tn <= prev_t:
            issues.append("NONMONO_TS"); break
        prev_t = tn
    # phantom-spike (soft): adjacent close ratio extreme
    for i in range(1, len(bars)):
        pc, cc = bars[i - 1].get("c") or 0, bars[i].get("c") or 0
        if pc > 0 and (cc / pc > 2.5 or cc / pc < 0.4):
            issues.append(f"SPIKE@{i}({pc}->{cc})"); break
    ld = last_date(bars, tf)
    integrity = "INTEGRITY_FAIL" if issues else None
    if tf in ("1", "5", "15", "30", "60", "D"):
        exp = EXPECTED_DAILY if tf == "D" else EXPECTED_INTRADAY
        fresh = ld >= exp
    elif tf == "W":
        fresh = ld >= EXPECTED_WEEKLY
    else:  # M
        fresh = ld >= EXPECTED_MONTHLY
    status = integrity or ("FRESH" if fresh else "STALE")
    return (status, ld, issues[0] if issues else None)

def main():
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    tickers = json.load(open("api/data/cap_universe.json"))
    tickers = [t.upper() for t in tickers if t]
    # sanity: confirm probe path works (UA not blocked)
    s = fetch(tickers[0], "D")
    if "_err" in s and "403" in s["_err"]:
        print("ABORT: 403 — UA blocked, cannot run"); return
    random.seed(42)
    sample_rare = set(random.sample(tickers, min(400, len(tickers))))
    jobs = []
    for t in tickers:
        for tf in ("15", "30", "60", "D"):
            jobs.append((t, tf))
    for t in sample_rare:
        for tf in ("1", "5", "W", "M"):
            jobs.append((t, tf))
    total = len(jobs)
    print(f"Diagnostic: {len(tickers)} tickers, {total} chart series to check")
    by_tf = collections.defaultdict(lambda: collections.Counter())
    datehist = collections.defaultdict(lambda: collections.Counter())
    integrity_ex, stale_ex = [], []
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch, t, tf): (t, tf) for (t, tf) in jobs}
        for fu in as_completed(futs):
            t, tf = futs[fu]
            st, info, issue = analyze(t, tf, fu.result())
            by_tf[tf][st] += 1
            if st in ("FRESH", "STALE"):
                datehist[tf][info] += 1
            if st == "INTEGRITY_FAIL" and len(integrity_ex) < 60:
                integrity_ex.append(f"{t}/{tf}: {issue} (last={info})")
            if st == "STALE" and len(stale_ex) < 80:
                stale_ex.append(f"{t}/{tf} last={info}")
            done += 1
            if done % 500 == 0:
                el = time.time() - t0
                print(f"  {done}/{total} ({done*100//total}%) {el:.0f}s "
                      f"rate={done/el:.1f}/s")
    el = time.time() - t0
    lines = []
    lines.append(f"=== UNIVERSE CHART DIAGNOSTIC — {datetime.now()} ===")
    lines.append(f"{len(tickers)} tickers, {total} series, {el:.0f}s\n")
    tot = collections.Counter()
    for tf in ("15", "30", "60", "D", "1", "5", "W", "M"):
        c = by_tf[tf]
        for k, v in c.items():
            tot[k] += v
        n = sum(c.values())
        if not n:
            continue
        lines.append(f"[tf={tf}] n={n}  FRESH={c['FRESH']} "
                     f"STALE={c['STALE']} EMPTY={c['EMPTY']} "
                     f"ERROR={c['ERROR']} INTEGRITY_FAIL={c['INTEGRITY_FAIL']}")
        top = datehist[tf].most_common(6)
        lines.append(f"        last-bar-date distribution: {top}")
    lines.append("")
    lines.append(f"=== TOTAL: {dict(tot)} ===")
    gn = tot['FRESH']
    gt = sum(tot.values())
    lines.append(f"=== FRESH RATE: {gn}/{gt} = {gn*100/max(gt,1):.2f}% ===")
    lines.append("")
    lines.append(f"--- INTEGRITY failures ({tot['INTEGRITY_FAIL']}) sample ---")
    lines += ["  " + x for x in integrity_ex] or ["  (none)"]
    lines.append("")
    lines.append(f"--- STALE sample ({tot['STALE']}) ---")
    lines += ["  " + x for x in stale_ex] or ["  (none)"]
    out = "\n".join(lines)
    open(REPORT, "w").write(out)
    print(out)
    print(f"\n[report written to {REPORT}]")

if __name__ == "__main__":
    main()
