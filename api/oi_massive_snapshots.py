"""Massive/OCC-accurate daily OI snapshots for the OI Update card — ISOLATED.

The shared `contract_oi_snapshots` (oi_snapshots.py) is Schwab-sourced and lags OCC by
~a trading day (VERIFIED 2026-08-24: our latest snap for PFE 27P 9/18 = 53,028, while
Massive `open_interest` = 74,259 = UnusualWhales' current; UW's Friday ΔOI =
74,259 − 53,028 = +21,231 exact, carry 85%). Rather than change the shared pipeline
(B-side confirmation / weekly-flow / OI Check all read it), this captures **Massive**
OI into its OWN table/DB so only the OI Update card uses the OCC-accurate value.

- Source: Massive options **chain** snapshot `/v3/snapshot/options/{underlying}` (one
  paginated call per symbol → every contract's `open_interest`), NOT per-contract (the
  flow universe is ~100k contracts). stdlib **urllib** (httpx MIA on flow-worker).
- Universe: contracts with single-name ('stocks') flow in the last `OI_MASSIVE_DAYS_BACK`
  days (the card's universe). Store only those contracts (bounded).
- ΔOI(D) = OI(D) − OI(D−1) over adjacent daily rows (this table is written daily).
- DARK / additive: nothing else reads this table; gated `OI_MASSIVE_ENABLED` for the cron.

Env (flow-worker):
  OI_MASSIVE_ENABLED     "1" arms the daily capture cron (default off)
  OI_MASSIVE_DB_PATH     default <DATA_DIR>/oi_massive.db
  OI_MASSIVE_DAYS_BACK   flow lookback for the capture universe (default 5)
  MASSIVE_API_KEY / MASSIVE_REST_BASE
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
import urllib.parse
import urllib.request
from datetime import date, datetime
from contextlib import closing

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _ET = None

log = logging.getLogger("oi_massive")

_DATA_DIR = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH") or os.environ.get("DATA_DIR", "/data")
DB_PATH = os.environ.get("OI_MASSIVE_DB_PATH", os.path.join(_DATA_DIR, "oi_massive.db"))
FLOW_DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

_BASE = os.environ.get("MASSIVE_REST_BASE", "https://api.massive.com")
_KEY = os.environ.get("MASSIVE_API_KEY", "")
_UA = {"User-Agent": "UCT-Massive/1.0 (+https://uctintelligence.com)"}

ENABLED = os.environ.get("OI_MASSIVE_ENABLED", "0") == "1"
DAYS_BACK = int(os.environ.get("OI_MASSIVE_DAYS_BACK", "5"))
_PAGE_CAP = int(os.environ.get("OI_MASSIVE_PAGE_CAP", "20"))   # chain pages per symbol

_SCHEMA = """
CREATE TABLE IF NOT EXISTS oi_massive_snapshots (
    contract_key TEXT NOT NULL,
    snap_date    TEXT NOT NULL,
    oi           INTEGER NOT NULL,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contract_key, snap_date)
);
CREATE INDEX IF NOT EXISTS idx_oim_date ON oi_massive_snapshots(snap_date);
CREATE INDEX IF NOT EXISTS idx_oim_ck ON oi_massive_snapshots(contract_key);
"""


def init_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with closing(sqlite3.connect(DB_PATH, timeout=15)) as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(_SCHEMA)


# ── helpers ────────────────────────────────────────────────────────────────
def _today_iso() -> str:
    now = datetime.now(_ET) if _ET else datetime.now()
    return now.strftime("%Y-%m-%d")


def _parse_mdy(s):
    try:
        m, d, y = (int(x) for x in str(s).split("/")[:3])
        return date(y if y > 99 else y + 2000, m, d)
    except (ValueError, TypeError):
        return None


def make_key(sym: str, cp: str, strike, exp: str) -> str:
    """Match oi_snapshots.make_key: {SYM}|{C|P}|{float strike}|{M/D/YYYY exp}."""
    cp_norm = "C" if str(cp).upper() in ("C", "CALL") else "P"
    return f"{str(sym).upper()}|{cp_norm}|{float(strike)}|{exp}"


def _occ_to_key(occ: str):
    """OCC (O:PFE260918P00027000) → contract_key. None on malformed."""
    try:
        s = occ[2:] if occ.startswith("O:") else occ
        strike = int(s[-8:]) / 1000.0
        cp = s[-9]
        ymd = s[-15:-9]
        tk = s[:-15]
        yy, mm, dd = int(ymd[:2]), int(ymd[2:4]), int(ymd[4:6])
        return make_key(tk, cp, strike, f"{mm}/{dd}/{2000 + yy}")
    except (ValueError, IndexError):
        return None


def _get(url: str, timeout: int = 30) -> dict:
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=_UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(1.5 * (attempt + 1))
    return {}


# ── universe (single-name flow contracts, last N days) ──────────────────────
def _flow_universe(days_back: int) -> dict:
    """{underlying: set(contract_key)} for 'stocks' flow in the last `days_back`
    trading dates present in flow.db."""
    conn = sqlite3.connect(FLOW_DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        dates = [r[0] for r in conn.execute(
            "SELECT DISTINCT CreatedDate FROM flow WHERE source='stocks'").fetchall()]
        dates = sorted((d for d in dates if d), key=lambda s: _parse_mdy(s) or date.min)
        window = dates[-days_back:] if days_back > 0 else dates
        if not window:
            return {}
        qs = ",".join("?" * len(window))
        rows = conn.execute(f"""
            SELECT DISTINCT Symbol, CallPut, Strike, ExpirationDate
              FROM flow
             WHERE source='stocks' AND CreatedDate IN ({qs})
               AND Symbol!='' AND CallPut!='' AND Strike!='' AND ExpirationDate!=''
        """, window).fetchall()
    finally:
        conn.close()
    uni: dict = {}
    for r in rows:
        sym = (r["Symbol"] or "").upper().strip()
        cpr = (r["CallPut"] or "").upper().strip()
        cp = "C" if cpr in ("C", "CALL") else "P" if cpr in ("P", "PUT") else ""
        try:
            strike = float(r["Strike"])
        except (TypeError, ValueError):
            continue
        exp = (r["ExpirationDate"] or "").strip()
        if not sym or not cp or strike <= 0 or not exp:
            continue
        uni.setdefault(sym, set()).add(make_key(sym, cp, strike, exp))
    return uni


def _fetch_chain_oi(sym: str) -> dict:
    """{contract_key: oi} for every contract of `sym` via the Massive chain snapshot
    (paginated). Empty on error."""
    out: dict = {}
    url = (f"{_BASE}/v3/snapshot/options/{urllib.parse.quote(sym)}"
           f"?limit=250&apiKey={urllib.parse.quote(_KEY)}")
    for _ in range(_PAGE_CAP):
        data = _get(url)
        for r in (data.get("results") or []):
            occ = (r.get("details") or {}).get("ticker")
            oi = r.get("open_interest")
            if not occ or oi is None:
                continue
            ck = _occ_to_key(occ)
            if ck:
                out[ck] = int(oi)
        nxt = data.get("next_url")
        if not nxt:
            break
        url = nxt + (("&" if "?" in nxt else "?") + "apiKey=" + urllib.parse.quote(_KEY))
    return out


# ── write / read ────────────────────────────────────────────────────────────
def record_batch(rows, snap_date: str) -> int:
    """rows = iterable of (contract_key, oi). Upsert for (contract_key, snap_date)."""
    data = [(ck, snap_date, int(oi)) for ck, oi in rows if ck and oi is not None]
    if not data:
        return 0
    with closing(sqlite3.connect(DB_PATH, timeout=30)) as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executemany(
            "INSERT INTO oi_massive_snapshots (contract_key, snap_date, oi) VALUES (?,?,?) "
            "ON CONFLICT(contract_key, snap_date) DO UPDATE SET oi=excluded.oi",
            data)
        c.commit()
    return len(data)


def get_deltas(keys):
    """Return (deltas, d_last, d_prior). deltas = {contract_key: (prior_oi, last_oi)}
    over the two most recent snap_dates present. prior_oi=0 when the contract has no
    earlier snapshot. Absent from the latest snapshot → omitted."""
    keys = list(dict.fromkeys(k for k in keys if k))
    if not keys:
        return {}, None, None
    with closing(sqlite3.connect(DB_PATH, timeout=15)) as c:
        dates = [r[0] for r in c.execute(
            "SELECT DISTINCT snap_date FROM oi_massive_snapshots "
            "ORDER BY snap_date DESC LIMIT 2").fetchall()]
        if not dates:
            return {}, None, None
        d_last = dates[0]
        d_prior = dates[1] if len(dates) > 1 else None
        want = [d for d in (d_last, d_prior) if d]
        dph = ",".join("?" * len(want))
        by_ck: dict = {}
        for i in range(0, len(keys), 400):
            chunk = keys[i:i + 400]
            kph = ",".join("?" * len(chunk))
            for ck, sd, oi in c.execute(
                f"SELECT contract_key, snap_date, oi FROM oi_massive_snapshots "
                f"WHERE contract_key IN ({kph}) AND snap_date IN ({dph})",
                (*chunk, *want),
            ):
                by_ck.setdefault(ck, {})[sd] = oi
    out = {}
    for ck, m in by_ck.items():
        last = m.get(d_last)
        if last is None:
            continue
        out[ck] = (m.get(d_prior, 0) if d_prior else 0, last)
    return out, d_last, d_prior


def get_history(contract_key: str, days: int = 30):
    with closing(sqlite3.connect(DB_PATH, timeout=15)) as c:
        return [{"date": r[0], "oi": r[1]} for r in c.execute(
            "SELECT snap_date, oi FROM oi_massive_snapshots WHERE contract_key=? "
            "ORDER BY snap_date ASC", (contract_key,)).fetchall()]


def coverage(days: int = 10):
    with closing(sqlite3.connect(DB_PATH, timeout=15)) as c:
        return [{"date": r[0], "count": r[1]} for r in c.execute(
            "SELECT snap_date, COUNT(*) FROM oi_massive_snapshots "
            "GROUP BY snap_date ORDER BY snap_date DESC LIMIT ?", (days,)).fetchall()]


# ── capture job ─────────────────────────────────────────────────────────────
def capture_job(*, force: bool = False) -> dict:
    """Snapshot Massive OI for the single-name flow universe into oi_massive_snapshots.
    `force` bypasses the ENABLED gate (manual trigger). Never raises into the scheduler."""
    if not ENABLED and not force:
        log.info("[oi-massive] disabled (set OI_MASSIVE_ENABLED=1)")
        return {"ok": False, "reason": "disabled"}
    if not _KEY:
        return {"ok": False, "reason": "MASSIVE_API_KEY not set"}
    started = time.time()
    try:
        init_db()
        uni = _flow_universe(DAYS_BACK)
        if not uni:
            return {"ok": True, "symbols": 0, "rows": 0, "note": "empty flow universe"}
        snap = _today_iso()
        rows = []
        done = failed = 0
        for sym, cks in uni.items():
            try:
                oi_by_ck = _fetch_chain_oi(sym)
                for ck in cks:
                    if ck in oi_by_ck:
                        rows.append((ck, oi_by_ck[ck]))
                done += 1
            except Exception as e:  # noqa: BLE001
                failed += 1
                log.warning("[oi-massive] %s chain failed: %s", sym, e)
        n = record_batch(rows, snap)
        out = {"ok": True, "snap_date": snap, "symbols": len(uni), "symbols_done": done,
               "symbols_failed": failed, "contracts": len(rows), "inserted": n,
               "elapsed_sec": round(time.time() - started, 1)}
        log.info("[oi-massive] captured %s: %d contracts / %d symbols (%d failed) in %.0fs",
                 snap, n, done, failed, out["elapsed_sec"])
        return out
    except Exception as e:  # noqa: BLE001
        log.exception("[oi-massive] capture failed")
        return {"ok": False, "reason": f"error: {e}"}
