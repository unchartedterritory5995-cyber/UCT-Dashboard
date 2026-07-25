"""
backfill_rest.py — one-time exact-ns side backfill for the Massive backlog.

Context (2026-07-25): flow.db's Massive-era history (6/23 -> 7/23) was written
before any systematic side-heal and sits at ~12% sided. The raw tape for those
days rotated off, and ts_ns wasn't stored back then — BUT Massive's historical
REST feed still has the nanosecond timestamp for every past print. So we recover
the ns from /v3/trades and heal at exact-ns without any local tape or ts_ns.

The join, validated on the MU 12/17/27 $1500C case (7/25): flow.db aggregates a
print (e.g. 2000 @ 385.39 @ 9:32:21) while the tape/REST shows its individual
legs (150x8 + 800, all stamped 9:32:21). So the reliable key is NOT price+time
(ambiguous — the same price prints at multiple seconds across the day) but the
LEG-SUM CLUSTER: the same-price legs at the flow.db second whose sizes sum
EXACTLY to the flow.db volume. That cluster is the print, unambiguously; its
completing sip_timestamp gives the exact ns for the NBBO lookup.

Per contract-day: one /v3/trades range pull (trades are sparse — well under the
page cap), then per matched print one /v3/quotes lte=ns limit=1 (the book at the
instant). Classify with the midpoint rule; write-once via update_sides_by_dedup.
Only EXACT leg-sum matches are healed — anything that doesn't sum cleanly stays
blank (a blank is honest; a guessed side is not). Idempotent + resumable: the
target query only pulls still-blank rows, so a re-run continues where it left off.

Run detached from the flow-worker console (survives a pod bounce):
    cd /app && nohup python3 -c "from api.backfill_rest import run_all; import json; print(json.dumps(run_all()))" > /data/backfill_rest.log 2>&1 &
    # then: cat /data/backfill_rest.log

Scope is 6/23 -> 7/24 (all EDT) — the full Massive era. Because the timestamp
comes from REST /v3/trades, not the local tape, 7/24 IS recoverable here even
though its tape rotated off (the tape-based backfill_side_heal could not).
<= 6/22 is BBS (already 93-97% sided) and is intentionally excluded.
"""
import os
import json
import logging
import sqlite3
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

BASE = os.environ.get("MASSIVE_REST_BASE", "https://api.massive.com").rstrip("/")
API_KEY = os.environ.get("MASSIVE_API_KEY", "")
UA = {"User-Agent": "UCT-Massive/1.0 (+https://uctintelligence.com)"}
STALENESS_NS = int(float(os.environ.get("MASSIVE_NBBO_STALENESS_SEC", "5")) * 1_000_000_000)

# The backlog window is entirely EDT (June-July), so a fixed -4 is correct here.
# flow.db CreatedTime is ET (verified 7/25: flow.db 9:32:21 == trade sip_ts at UTC-4).
_ET = timezone(timedelta(hours=-4))

PREM_FLOOR = float(os.environ.get("MASSIVE_BACKFILL_PREMIUM", "100000"))
WORKERS = int(os.environ.get("MASSIVE_BACKFILL_WORKERS", "8"))
FROM_MDY = os.environ.get("MASSIVE_BACKFILL_FROM", "6/23/2026")
TO_MDY = os.environ.get("MASSIVE_BACKFILL_TO", "7/24/2026")


def _occ(symbol, cp, strike, exp_mdy):
    m, d, y = [int(x) for x in str(exp_mdy).split("/")]
    c = "C" if str(cp).upper().startswith("C") else "P"
    k = int(round(float(strike) * 1000))
    return f"O:{str(symbol).upper().strip()}{y % 100:02d}{m:02d}{d:02d}{c}{k:08d}"


def _classify_side(trade_price, bid, ask):
    """Exact port of the deployed worker _classify_side (7/18 midpoint split)."""
    if bid is None or ask is None:
        return ""
    try:
        b, a, p = float(bid), float(ask), float(trade_price)
    except (TypeError, ValueError):
        return ""
    if b <= 0 or a <= 0 or a < b:
        return ""
    tol = 0.005
    if p > a + tol:
        return "AA"
    if p < b - tol:
        return "BB"
    mid = (b + a) / 2.0
    if p > mid:
        return "A"
    if p < mid:
        return "B"
    return ""


def _http_json(url):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=20.0) as r:
            if r.status != 200:
                return None
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def _fetch_trades(occ, start_ns, end_ns):
    """All trades for a contract over the day window (paginated defensively)."""
    out = []
    url = (f"{BASE}/v3/trades/{occ}?timestamp.gte={start_ns}&timestamp.lte={end_ns}"
           f"&limit=50000&sort=timestamp&order=asc&apiKey={API_KEY}")
    for _ in range(20):  # page guard
        d = _http_json(url)
        if not d:
            break
        out.extend(d.get("results") or [])
        nxt = d.get("next_url")
        if not nxt:
            break
        url = nxt + ("" if "apiKey=" in nxt else f"&apiKey={API_KEY}")
    return out


def _fetch_quote_at(occ, ns):
    """Consolidated NBBO at/just before ns. Returns (bid, ask, q_ts) or None."""
    url = (f"{BASE}/v3/quotes/{occ}?timestamp.lte={ns}&order=desc&sort=timestamp"
           f"&limit=1&apiKey={API_KEY}")
    d = _http_json(url)
    res = (d or {}).get("results") or []
    if not res:
        return None
    q = res[0]
    return (q.get("bid_price"), q.get("ask_price"), int(q.get("sip_timestamp", 0) or 0))


def _trading_days(from_mdy, to_mdy):
    a = datetime.strptime(from_mdy, "%m/%d/%Y")
    b = datetime.strptime(to_mdy, "%m/%d/%Y")
    days, cur = [], a
    while cur <= b:
        if cur.weekday() < 5:  # Mon-Fri
            days.append(f"{cur.month}/{cur.day}/{cur.year}")
        cur += timedelta(days=1)
    return days


def _load_targets(db, source, days):
    """Blank non-ML rows in the window, grouped by (occ, CreatedDate).

    Each entry: (dedup_key, price_rounded, volume, (h,m,s) ET second).
    """
    _prem = "CAST(REPLACE(REPLACE(COALESCE(Premium,''),'$',''),',','') AS REAL)"
    placeholders = ",".join("?" * len(days))
    con = sqlite3.connect(db.db_path, timeout=30)
    try:
        rows = con.execute(
            f"""SELECT dedup_key, Symbol, CallPut, Strike, ExpirationDate,
                       Price, Volume, CreatedDate, CreatedTime
                FROM flow
                WHERE source = ? AND CreatedDate IN ({placeholders})
                  AND (Side IS NULL OR Side = '')
                  AND UPPER(COALESCE(Type,'')) NOT LIKE 'ML/%'
                  AND {_prem} >= ?
                ORDER BY {_prem} DESC""",
            (source, *days, PREM_FLOOR),
        ).fetchall()
    finally:
        con.close()

    groups = defaultdict(list)
    for dedup_key, sym, cp, strike, exp, price, vol, cdate, ctime in rows:
        try:
            occ = _occ(sym, cp, strike, exp)
            p = round(float(price), 2)
            v = int(float(vol))
            t = datetime.strptime(ctime.strip(), "%I:%M:%S %p")
            sec = (t.hour, t.minute, t.second)
        except Exception:
            continue
        groups[(occ, cdate)].append((dedup_key, p, v, sec))
    return groups, len(rows)


def _process_group(occ, cdate, prints):
    """Heal one contract-day. Returns (updates, stats)."""
    d0 = datetime.strptime(cdate, "%m/%d/%Y").replace(tzinfo=_ET)
    start_ns = int(d0.timestamp() * 1_000_000_000)
    end_ns = int((d0 + timedelta(hours=30)).timestamp() * 1_000_000_000)
    trades = _fetch_trades(occ, start_ns, end_ns)

    # index legs by (ET second, price) -> [(size, ts_ns), ...]
    legmap = defaultdict(list)
    for t in trades:
        ts, pr, sz = t.get("sip_timestamp"), t.get("price"), t.get("size")
        if ts is None or pr is None or sz is None:
            continue
        et = datetime.fromtimestamp(int(ts) / 1e9, _ET)
        legmap[((et.hour, et.minute, et.second), round(float(pr), 2))].append((int(sz), int(ts)))

    updates = []
    st = {"matched": 0, "nomatch": 0, "noquote": 0, "mid": 0}
    for dedup_key, price, vol, sec in prints:
        legs = legmap.get((sec, price))
        if not legs or sum(s for s, _ in legs) != vol:
            st["nomatch"] += 1               # no clean leg-sum cluster -> leave blank
            continue
        st["matched"] += 1
        ns = max(t for _, t in legs)          # completing instant of the print
        q = _fetch_quote_at(occ, ns)
        if q is None or (q[2] and (ns - q[2]) > STALENESS_NS):
            st["noquote"] += 1                # no fresh book -> leave blank
            continue
        side = _classify_side(price, q[0], q[1])
        if side:
            updates.append((dedup_key, side, ""))
        else:
            st["mid"] += 1
    return updates, st


def run(source="stocks", flush_every=500):
    from api.flow_db import FlowDB
    if not API_KEY:
        log.warning("[backfill-rest] MASSIVE_API_KEY unset; skipping")
        return {"error": "no api key"}
    db = FlowDB()
    days = _trading_days(FROM_MDY, TO_MDY)
    groups, n_rows = _load_targets(db, source, days)
    tot = {"source": source, "targets": n_rows, "contracts": len(groups),
           "healed": 0, "matched": 0, "nomatch": 0, "noquote": 0, "mid": 0}
    if not groups:
        log.info("[backfill-rest] %s: no targets", source)
        return tot

    pending, done = [], 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(_process_group, occ, cd, pr): 1 for (occ, cd), pr in groups.items()}
        for fut in as_completed(futs):
            try:
                ups, st = fut.result()
            except Exception:
                continue
            pending.extend(ups)
            for k in ("matched", "nomatch", "noquote", "mid"):
                tot[k] += st[k]
            done += 1
            if len(pending) >= flush_every:
                tot["healed"] += db.update_sides_by_dedup(pending)
                pending = []
            if done % 500 == 0:
                log.info("[backfill-rest] %s: %d/%d contracts, healed %d so far",
                         source, done, len(groups), tot["healed"])
    if pending:
        tot["healed"] += db.update_sides_by_dedup(pending)

    log.info("[backfill-rest] %s DONE: contracts %d, targets %d, matched %d, healed %d "
             "(nomatch %d, noquote %d, mid %d)", source, len(groups), n_rows,
             tot["matched"], tot["healed"], tot["nomatch"], tot["noquote"], tot["mid"])
    return tot


def run_all():
    return {src: run(source=src) for src in ("stocks", "indexes")}
