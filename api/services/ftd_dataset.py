"""FT-068 (FTD half) -- SEC fails-to-deliver as its own dataset. The Research >
Depth "Fails to deliver" panel.

The SEC publishes, twice a month, the aggregate fails-to-deliver balance per
security per settlement date (Continuous Net Settlement data from NSCC):
  https://www.sec.gov/files/data/fails-deliver-data/cnsfails{YYYYMM}{a|b}.zip
"a" covers settlement dates on the 1st-15th, "b" the 16th to month end; each is
typically posted in the second half of the FOLLOWING period, so the newest
data is always some weeks old and the payload says through which date.

Each file is read through `fundamentals_pit.sec_client` (the one SEC transport)
by a scheduled job, never in a request, and stored in SQLite (FTD_DB_PATH).
A file's own trailer ("Trailer record count N") is checked against the rows
parsed; a file that does not reconcile is stored and marked, not trusted
silently.

Honesty rules, railed in tests/test_ftd_dataset.py:
  * a fail balance is a BALANCE on that settlement date, not a daily flow: the
    payload says so and never sums balances across days;
  * the window the store covers is returned with every answer, and a symbol
    with no rows inside it is "no fails reported in <window>", which is a
    different fact from "no files ingested yet";
  * a file the SEC has not posted yet is recorded as not_published and retried,
    never treated as an empty half-month.

DARK behind FTD_DATASET_ENABLED: unset, the route 404s and the job does nothing.
"""
from __future__ import annotations

import contextlib
import io
import logging
import os
import sqlite3
import threading
import time
import zipfile
from datetime import date
from typing import Callable, Optional

_logger = logging.getLogger(__name__)

ENABLED_ENV = "FTD_DATASET_ENABLED"
BASE_URL = "https://www.sec.gov/files/data/fails-deliver-data/"
SOURCE = ("SEC fails-to-deliver data (cnsfails files, NSCC Continuous Net Settlement), "
          "read via fundamentals_pit.sec_client")
MONTHS_BACK = 6
MAX_FILES_PER_RUN = 3
_RETRY_NOT_PUBLISHED_S = 20 * 3600
_write_lock = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ftd (
  settle_date TEXT NOT NULL, cusip TEXT NOT NULL, symbol TEXT, quantity INTEGER,
  description TEXT, price REAL, file TEXT NOT NULL,
  PRIMARY KEY (settle_date, cusip)
);
CREATE INDEX IF NOT EXISTS idx_ftd_symbol ON ftd(symbol, settle_date);
CREATE TABLE IF NOT EXISTS ftd_file (
  name TEXT PRIMARY KEY, url TEXT NOT NULL, fetched_at INTEGER NOT NULL, state TEXT NOT NULL,
  rows INTEGER, trailer_rows INTEGER, first_date TEXT, last_date TEXT, reason TEXT
);
"""


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def db_path() -> str:
    return os.environ.get("FTD_DB_PATH", "/data/ftd.db")


@contextlib.contextmanager
def _conn():
    path = db_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    c = sqlite3.connect(path, timeout=2.0)
    try:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(_SCHEMA)
        yield c
    finally:
        c.close()


def file_names(today: date, months: int = MONTHS_BACK) -> list[str]:
    """cnsfails names for the last `months` months, newest first, excluding
    halves that cannot have ended yet."""
    out, y, m = [], today.year, today.month
    for _ in range(months + 1):
        for half in ("b", "a"):
            ends = date(y, m, 15) if half == "a" else None
            if (y, m) == (today.year, today.month) and (half == "b" or today <= ends):
                continue
            out.append(f"cnsfails{y:04d}{m:02d}{half}")
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return out[: months * 2]


def parse(blob: bytes) -> tuple[list[tuple], Optional[int]]:
    """(rows, trailer_record_count). Accepts the zip as posted, or its text."""
    if blob[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(blob))
        blob = z.read(z.namelist()[0])
    text = blob.decode("latin-1")
    rows, trailer = [], None
    for line in text.splitlines():
        if line.startswith("Trailer record count"):
            try:
                trailer = int(line.rsplit(" ", 1)[1])
            except ValueError:
                pass
            continue
        parts = line.split("|")
        if len(parts) < 6 or not parts[0].strip().isdigit():
            continue                                      # the header, or a blank line
        d, cusip, sym, qty, desc, price = (p.strip() for p in parts[:6])
        try:
            iso = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
            q = int(qty)
        except ValueError:
            continue
        try:
            px = float(price) if price not in ("", ".") else None
        except ValueError:
            px = None
        rows.append((iso, cusip, sym.upper() or None, q, desc or None, px))
    return rows, trailer


def _sec_get(url: str) -> bytes:
    """The one SEC transport. Indirection so tests replace it by name."""
    from api.services.fundamentals_pit import sec_client
    return sec_client.get_bytes(url, retries=1, timeout=60)


def ingest_file(name: str, get: Optional[Callable[[str], bytes]] = None) -> dict:
    """OFF THE REQUEST PATH ONLY. Never raises; the outcome is recorded."""
    url = f"{BASE_URL}{name}.zip"
    get = get or _sec_get
    rec = {"name": name, "url": url, "fetched_at": int(time.time())}
    try:
        rows, trailer = parse(get(url))
        state = "ok" if trailer is None or trailer == len(rows) else "count_mismatch"
        reason = None if state == "ok" else f"the file's trailer says {trailer} rows; {len(rows)} parsed"
        rec.update(state=state, rows=len(rows), trailer_rows=trailer, reason=reason,
                   first_date=min((r[0] for r in rows), default=None),
                   last_date=max((r[0] for r in rows), default=None))
        with _write_lock, _conn() as c:
            c.executemany("INSERT OR REPLACE INTO ftd (settle_date, cusip, symbol, quantity, description, "
                          "price, file) VALUES (?,?,?,?,?,?,?)", [(*r, name) for r in rows])
            c.commit()
    except Exception as exc:  # noqa: BLE001 -- recorded as a state
        status = getattr(exc, "status", None)
        if status == 404:
            rec.update(state="not_published", reason="the SEC has not posted this file yet")
        else:
            _logger.warning("ftd ingest %s failed: %s", name, exc)
            rec.update(state="error", reason=f"{type(exc).__name__}: {exc}"[:300])
    with _write_lock, _conn() as c:
        c.execute("INSERT OR REPLACE INTO ftd_file (name, url, fetched_at, state, rows, trailer_rows, "
                  "first_date, last_date, reason) VALUES (?,?,?,?,?,?,?,?,?)",
                  (name, url, rec["fetched_at"], rec["state"], rec.get("rows"), rec.get("trailer_rows"),
                   rec.get("first_date"), rec.get("last_date"), rec.get("reason")))
        c.commit()
    return rec


def run_ingest(today: Optional[date] = None, get=None) -> dict:
    """Scheduled job: fetch at most MAX_FILES_PER_RUN missing or retryable files,
    newest first. A no-op while the flag is off."""
    if not is_enabled():
        return {"skipped": "flag off"}
    today = today or date.today()
    with _conn() as c:
        have = {r[0]: (r[1], r[2]) for r in c.execute("SELECT name, state, fetched_at FROM ftd_file")}
    due = []
    for name in file_names(today):
        st = have.get(name)
        if st is None or st[0] == "error" or (st[0] == "not_published"
                                               and time.time() - st[1] > _RETRY_NOT_PUBLISHED_S):
            due.append(name)
    done = [ingest_file(n, get) for n in due[:MAX_FILES_PER_RUN]]
    return {"due": len(due), "fetched": [(d["name"], d["state"]) for d in done]}


def series(sym: str) -> dict:
    """REQUEST PATH: the local store only."""
    sym = (sym or "").upper().strip()
    with _conn() as c:
        files = c.execute("SELECT name, state, rows, first_date, last_date, fetched_at, reason FROM ftd_file "
                          "ORDER BY name").fetchall()
        rows = c.execute("SELECT settle_date, quantity, price, description, cusip FROM ftd WHERE symbol=? "
                         "ORDER BY settle_date", (sym,)).fetchall()
    ok = [f for f in files if f[1] in ("ok", "count_mismatch") and f[3]]
    base = {"ticker": sym, "source": SOURCE,
            "basis": "Each figure is the aggregate fails-to-deliver BALANCE on that settlement date, "
                     "not the day's new fails; balances are never summed across days.",
            "files": [{"name": f[0], "state": f[1], "rows": f[2], "first_date": f[3], "last_date": f[4],
                       "fetched_at": f[5], "reason": f[6]} for f in files]}
    if not ok:
        return {**base, "state": "not_ingested",
                "reason": "no fails-to-deliver file has been ingested yet"}
    window = {"from": min(f[3] for f in ok), "through": max(f[4] for f in ok)}
    points = [{"settle_date": d, "quantity": q, "price": px,
               "value": round(q * px, 2) if px is not None else None} for d, q, px, _desc, _c in rows]
    if not points:
        return {**base, "state": "none_reported", "window": window, "points": [],
                "reason": f"no fails reported for {sym} between {window['from']} and {window['through']}"}
    peak = max(points, key=lambda p: p["quantity"])
    return {**base, "state": "ok", "window": window, "points": points,
            "description": rows[-1][3], "cusip": rows[-1][4],
            "latest": points[-1], "peak": peak, "days_reported": len(points),
            "mismatched_files": [f[0] for f in ok if f[1] == "count_mismatch"]}
