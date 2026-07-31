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
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

BASE = os.environ.get("MASSIVE_REST_BASE", "https://api.massive.com").rstrip("/")
API_KEY = os.environ.get("MASSIVE_API_KEY", "")
UA = {"User-Agent": "UCT-Massive/1.0 (+https://uctintelligence.com)"}
STALENESS_NS = int(float(os.environ.get("MASSIVE_NBBO_STALENESS_SEC", "5")) * 1_000_000_000)
# Dedicated staleness for the LIVE heal (run_recent) — decoupled from the shared
# MASSIVE_NBBO_STALENESS_SEC above, which the live WS classifier also reads
# (massive_ws_worker) and must stay tight. Thin far-dated contracts (the blank-whale
# case) legitimately go tens of seconds between NBBO updates; a sweep executes against
# the LAST resting book, so a stale-but-unchanged NBBO is still the correct book to
# classify against. Read at import -> restart to change.
RESTHEAL_STALENESS_NS = int(float(
    os.environ.get("MASSIVE_RESTHEAL_STALENESS_SEC", "120")) * 1_000_000_000)
# ts_ns sanity floor: a real 2020s nanosecond epoch is ~1.7e18. Anything below this
# (0/null/garbage, or a value mistakenly stored in ms) is rejected and that row falls
# back to the leg-sum reconstruction.
_NS_FLOOR = 10 ** 18

# The backlog window is entirely EDT (June-July), so a fixed -4 is correct here.
# flow.db CreatedTime is ET (verified 7/25: flow.db 9:32:21 == trade sip_ts at UTC-4).
_ET = timezone(timedelta(hours=-4))
# The live path (run_recent) runs year-round, so it uses a DST-aware ET instead of
# the fixed -4 above (which is only correct for the summer backlog window).
_ET_LIVE = ZoneInfo("America/New_York")

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


def _load_targets(db, source, days, min_time_sec=None, prem_floor=None):
    """Blank non-ML rows in the window, grouped by (occ, CreatedDate).

    Each entry: (dedup_key, price_rounded, volume, (h,m,s) ET second).

    min_time_sec (seconds-since-ET-midnight): when set, only prints whose
    CreatedTime is at/after it are kept — the live path uses this to heal only
    the last few minutes of blanks each cycle instead of re-scanning the day.
    prem_floor overrides the module PREM_FLOOR (live path uses a higher whale floor).
    """
    _prem = "CAST(REPLACE(REPLACE(COALESCE(Premium,''),'$',''),',','') AS REAL)"
    floor = PREM_FLOOR if prem_floor is None else float(prem_floor)
    placeholders = ",".join("?" * len(days))
    con = sqlite3.connect(db.db_path, timeout=30)
    try:
        rows = con.execute(
            f"""SELECT dedup_key, Symbol, CallPut, Strike, ExpirationDate,
                       Price, Volume, CreatedDate, CreatedTime, ts_ns
                FROM flow
                WHERE source = ? AND CreatedDate IN ({placeholders})
                  AND (Side IS NULL OR Side = '')
                  AND UPPER(COALESCE(Type,'')) NOT LIKE 'ML/%'
                  AND {_prem} >= ?
                ORDER BY {_prem} DESC""",
            (source, *days, floor),
        ).fetchall()
    finally:
        con.close()

    groups = defaultdict(list)
    kept = 0
    for dedup_key, sym, cp, strike, exp, price, vol, cdate, ctime, ts_ns in rows:
        try:
            occ = _occ(sym, cp, strike, exp)
            p = round(float(price), 2)
            v = int(float(vol))
            t = datetime.strptime(ctime.strip(), "%I:%M:%S %p")
            sec = (t.hour, t.minute, t.second)
        except Exception:
            continue
        if min_time_sec is not None and (t.hour * 3600 + t.minute * 60 + t.second) < min_time_sec:
            continue
        groups[(occ, cdate)].append((dedup_key, p, v, sec, ts_ns))
        kept += 1
    return groups, kept


def _build_legmap(occ, cdate, tz):
    """Fetch the contract-day's trades and index legs by (ET second, rounded price)
    -> [(size, ts_ns), ...]. Only needed to reconstruct a print's ns for rows that
    have NO stored ts_ns (the pre-7/25 backlog)."""
    d0 = datetime.strptime(cdate, "%m/%d/%Y").replace(tzinfo=tz)
    start_ns = int(d0.timestamp() * 1_000_000_000)
    end_ns = int((d0 + timedelta(hours=30)).timestamp() * 1_000_000_000)
    trades = _fetch_trades(occ, start_ns, end_ns)
    legmap = defaultdict(list)
    for t in trades:
        ts, pr, sz = t.get("sip_timestamp"), t.get("price"), t.get("size")
        if ts is None or pr is None or sz is None:
            continue
        et = datetime.fromtimestamp(int(ts) / 1e9, tz)
        legmap[((et.hour, et.minute, et.second), round(float(pr), 2))].append((int(sz), int(ts)))
    return legmap


def _process_group(occ, cdate, prints, tz=_ET, staleness_ns=STALENESS_NS):
    """Heal one contract-day. Returns (updates, stats).

    For each print we need its exact nanosecond to look up the NBBO. LIVE rows store
    it (ts_ns = the cluster's first_ts_ns, the same instant the live classifier uses)
    -> use it directly, no /v3/trades fetch, no leg-sum reconstruction. Only rows with
    NO stored ts_ns (the pre-7/25 backlog) fall back to the leg-sum cluster match
    (lazy legmap, built once per contract only if actually needed).

    tz buckets trades into ET seconds + computes the day window (fixed-EDT _ET for the
    backlog, DST-aware _ET_LIVE for the live run). staleness_ns bounds how old the REST
    NBBO may be vs the print's ns (tight module default for the backlog;
    RESTHEAL_STALENESS_NS for the live run).
    """
    updates = []
    st = {"matched": 0, "nomatch": 0, "noquote": 0, "noquote_none": 0,
          "noquote_stale": 0, "mid": 0}
    legmap = None  # built lazily only for rows lacking a stored ts_ns
    for dedup_key, price, vol, sec, ts_ns in prints:
        # Prefer the stored print ns; reconstruct via leg-sum only when it's absent.
        if ts_ns is not None and int(ts_ns) > _NS_FLOOR:
            ns = int(ts_ns)
        else:
            if legmap is None:
                legmap = _build_legmap(occ, cdate, tz)
            legs = legmap.get((sec, price))
            if not legs or sum(s for s, _ in legs) != vol:
                st["nomatch"] += 1           # no clean leg-sum cluster -> leave blank
                continue
            ns = max(t for _, t in legs)      # completing instant of the print
        st["matched"] += 1
        q = _fetch_quote_at(occ, ns)
        if q is None:
            st["noquote"] += 1
            st["noquote_none"] += 1          # REST returned no quote at all
            continue
        if q[2] and (ns - q[2]) > staleness_ns:
            st["noquote"] += 1
            st["noquote_stale"] += 1         # quote exists but older than the guard
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


# --- Live on-demand heal (Q-pool coverage floor) -----------------------------
# Big prints land blank-side when their contract's NBBO churned out of the 950-cap
# Q-pool or went stale. This reuses the backlog machinery — leg-sum match on
# REST /v3/trades, then the consolidated NBBO from REST /v3/quotes at the print's
# exact ns — to recover the side for TODAY's recent whale blanks, bypassing the
# Q-pool entirely. Conservative: only exact leg-sum matches with a fresh book heal;
# everything else stays honestly blank. Idempotent (targets only still-blank rows).

RESTHEAL_PREMIUM = float(os.environ.get("MASSIVE_RESTHEAL_PREMIUM", "1000000"))
RESTHEAL_RECENCY_MIN = int(os.environ.get("MASSIVE_RESTHEAL_RECENCY_MIN", "20"))


def run_recent(source="stocks", recency_min=None, prem_floor=None, flush_every=200):
    """Heal recent big blank-side prints for the CURRENT ET day.

    Targets still-blank, non-ML prints >= prem_floor from the last recency_min
    minutes and classifies each from the REST NBBO at its exact ns. Meant to run
    on a short timer on the flow-worker (which owns flow.db + Massive REST access).
    """
    if not API_KEY:
        return {"error": "no api key"}
    from api.flow_db import FlowDB
    recency = RESTHEAL_RECENCY_MIN if recency_min is None else int(recency_min)
    floor = RESTHEAL_PREMIUM if prem_floor is None else float(prem_floor)
    tz = _ET_LIVE
    now = datetime.now(tz)
    today = f"{now.month}/{now.day}/{now.year}"
    now_sec = now.hour * 3600 + now.minute * 60 + now.second
    min_time_sec = max(0, now_sec - recency * 60)

    db = FlowDB()
    groups, n_targets = _load_targets(db, source, [today], min_time_sec=min_time_sec,
                                      prem_floor=floor)
    tot = {"source": source, "day": today, "targets": n_targets,
           "contracts": len(groups), "healed": 0, "matched": 0,
           "nomatch": 0, "noquote": 0, "noquote_none": 0, "noquote_stale": 0, "mid": 0}
    if not groups:
        return tot

    pending = []
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(_process_group, occ, cd, pr, tz, RESTHEAL_STALENESS_NS): 1
                for (occ, cd), pr in groups.items()}
        for fut in as_completed(futs):
            try:
                ups, st = fut.result()
            except Exception:
                continue
            pending.extend(ups)
            for k in ("matched", "nomatch", "noquote", "noquote_none",
                      "noquote_stale", "mid"):
                tot[k] += st[k]
            if len(pending) >= flush_every:
                tot["healed"] += db.update_sides_by_dedup(pending)
                pending = []
    if pending:
        tot["healed"] += db.update_sides_by_dedup(pending)

    if tot["healed"] or tot["matched"]:
        log.info("[restheal-live] %s: healed %d/%d blank whales (%d contracts, "
                 "nomatch %d, noquote %d [none %d, stale %d], mid %d)", source,
                 tot["healed"], n_targets, len(groups), tot["nomatch"],
                 tot["noquote"], tot["noquote_none"], tot["noquote_stale"], tot["mid"])
    return tot
