"""Pine Seeds data, ingested from a PUBLIC mirror of the seed's own upload file.

⭐⭐ WHY THIS EXISTS. `request.seed(source, symbol, expression)` reads a Pine Seeds
series: data a script author uploads to TradingView through a GitHub repo. The repo
behind a seed is often private, so it looked like data only TradingView holds. For
RS Rating (Fred6724) it is not. The author's own workflow
(`github.com/Fred6725/relative-strength/.github/workflows/output.yml`, Apache-2.0)
writes `output/RSRATING.csv` ONCE and copies the SAME file to the private seed repo
(`Fred6725/seed_fred6725_rs_rating`, `data/RSRATING.csv`) and to the public
`Fred6725/rs-log` (`output/RSRATING.csv`). So the public file IS the uploaded file,
and its git history holds every daily upload. Ingesting it reproduces the seed
itself, not a substitute for it (`docs/pine/RS-RATING-TRANSFER.md`, L6).

⛔⛔ THE SERIES IS THE NEWEST UPLOAD ALONE: an upload REPLACES the seed. One upload
carries 35 rows dated back from "yesterday" (`rs_ranking.py::generate_tradingview_csv`).
⚰️ This file first served the UNION of every upload (a later upload winning per date),
which is how a version-controlled data repo looks like it should behave. The capture said
otherwise. `rs-seed-rsrating` on NYSE:RDDT 1D (Q-RS2, 2026-11-15, s10) reads `na` on
every chart bar before 2026-10-07 and EXACTLY the newest upload's 25 weekday rows after
it (0 mismatches), where the union held 549 different values on older bars. So
TradingView's seed is the newest upload only.
- Every upload stays in `pine_seed_commits` (provenance).
- An upload whose file is absent (empty) does not wipe the series: there is nothing to
  replace it with, and no capture shows what the vendor does then.

⭐ THIS IS WHAT RS RATING'S NUMBER DEPENDS ON. Its `var` array collects the seed's
distinct values on the FIRST bars that see them, in date order. With only the newest
upload present it collects 199.57, 125, …, 12.5 (descending, the order its comments
expect). The vendor's label read 16 for RDDT, and a hand computation from the capture's
own inputs gives 16.43.

⚠️ A MIRROR IS AN ASSERTION, AND THE CAPTURE IS WHAT PROVES IT. Q-RS2 MATCHed the
newest upload exactly on 2026-11-15. A TradingView-side validation step
(`check_data.yaml` in the seed repo) could still refuse a future upload, so the harness
keeps grading with the capture's own seed bars.

⛔ NOTHING HERE IS FABRICATED. A malformed row is skipped and counted, never repaired,
and a seed with no rows serves `[]`. Every consumer reads an empty series as absence.
"""
from __future__ import annotations

import contextlib
import json
import logging
import math
import os
import re
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

_log = logging.getLogger(__name__)
_WRITE_LOCK = threading.Lock()


@dataclass(frozen=True)
class SeedMirror:
    """Where one seed's upload file can be read publicly."""
    repo: str          # "owner/name" of the PUBLIC repo holding the same file
    path: str          # path of the file inside it
    seed_repo: str     # the seed's own (possibly private) repo, for provenance
    provenance: str    # one line: why this mirror is the seed's own data
    licensing: str     # what is known about reuse


#: ⭐ THE REGISTRY. The key is TradingView's own symbol for the seed, upper-cased:
#: `<source>:<symbol>` exactly as `request.seed(source, symbol, …)` names it. An
#: unregistered seed is NOT served, and the engine refuses it by name.
SEEDS: dict[str, SeedMirror] = {
    "SEED_FRED6725_RS_RATING:RSRATING": SeedMirror(
        repo="Fred6725/rs-log",
        path="output/RSRATING.csv",
        seed_repo="Fred6725/seed_fred6725_rs_rating",
        provenance=("relative-strength/.github/workflows/output.yml copies the one generated "
                    "output/RSRATING.csv to rs-log/output/ and to the seed repo's data/"),
        licensing=("generator Apache-2.0 (Fred6725/relative-strength); rs-log declares no "
                   "licence; the same values are published on TradingView as this seed"),
    ),
}

#: TradingView's Pine Seeds row: `YYYYMMDDT,open,high,low,close,volume`.
_ROW = re.compile(r"^(\d{4})(\d{2})(\d{2})T,([^,]*),([^,]*),([^,]*),([^,]*),([^,]*)$")

_GITHUB_API = "https://api.github.com"
_RAW = "https://raw.githubusercontent.com"
_UA = "uct-dashboard-pine-seeds/1"


def seed_key(source: str, symbol: str) -> str:
    """The registry key for `request.seed(source, symbol, …)`."""
    return f"{(source or '').strip().upper()}:{(symbol or '').strip().upper()}"


def is_seed_symbol(ticker: str) -> bool:
    return (ticker or "").strip().upper() in SEEDS


# ── storage ──────────────────────────────────────────────────────────────────

def _db_path() -> str:
    override = os.environ.get("PINE_SEEDS_DB")
    if override:
        return override
    if os.path.exists("/data"):
        return "/data/pine_seeds.db"
    local = os.path.join(os.path.dirname(__file__), "..", "..", "data", "pine_seeds.db")
    os.makedirs(os.path.dirname(local), exist_ok=True)
    return local


@contextlib.contextmanager
def _conn():
    c = sqlite3.connect(_db_path(), timeout=5.0)
    try:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=3000")
        yield c
        c.commit()
    finally:
        c.close()


_INIT_DONE = False


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _WRITE_LOCK:
        if _INIT_DONE:
            return
        with _conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS pine_seed_rows (
                    seed TEXT NOT NULL,
                    date TEXT NOT NULL,              -- 'YYYY-MM-DD'
                    o REAL, h REAL, l REAL, c REAL, v REAL,
                    commit_sha TEXT NOT NULL,        -- the upload that set this row
                    committed_at TEXT NOT NULL,
                    PRIMARY KEY (seed, date)
                )""")
            c.execute("""
                CREATE TABLE IF NOT EXISTS pine_seed_commits (
                    seed TEXT NOT NULL,
                    sha TEXT NOT NULL,
                    committed_at TEXT NOT NULL,
                    rows INTEGER NOT NULL,
                    skipped INTEGER NOT NULL,
                    PRIMARY KEY (seed, sha)
                )""")
        _INIT_DONE = True


def _reset_for_tests() -> None:
    global _INIT_DONE
    _INIT_DONE = False


def _f(v) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def parse_csv(text: str) -> tuple[list[dict], int]:
    """`([{t, o, h, l, c, v}], skipped)` from one upload. `t` an ISO day, oldest first.

    ⛔ A row that does not parse COMPLETELY is skipped and counted, never half-read: a
    seed row whose close is unreadable is not a row with close 0.
    """
    out, skipped = [], 0
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        m = _ROW.match(line)
        if not m:
            skipped += 1
            continue
        y, mo, d = m.group(1), m.group(2), m.group(3)
        vals = [_f(m.group(i)) for i in range(4, 9)]
        if any(x is None for x in vals):
            skipped += 1
            continue
        o, h, l, c, v = vals
        out.append({"t": f"{y}-{mo}-{d}", "o": o, "h": h, "l": l, "c": c, "v": v})
    out.sort(key=lambda r: r["t"])
    return out, skipped


def ingest_upload(seed: str, sha: str, committed_at: str, text: str) -> int:
    """Apply one upload. An upload WITH rows REPLACES the seed's series; an empty one
    (the file absent at that commit) is recorded and changes nothing. Callers apply
    uploads oldest first, so the series ends as the newest non-empty upload, which is
    what TradingView serves (Q-RS2, see the module docstring)."""
    _ensure_init()
    rows, skipped = parse_csv(text)
    with _WRITE_LOCK, _conn() as c:
        if rows:
            c.execute("DELETE FROM pine_seed_rows WHERE seed=?", (seed,))
        c.executemany(
            "INSERT OR REPLACE INTO pine_seed_rows (seed, date, o, h, l, c, v, commit_sha, "
            "committed_at) VALUES (?,?,?,?,?,?,?,?,?)",
            [(seed, r["t"], r["o"], r["h"], r["l"], r["c"], r["v"], sha, committed_at)
             for r in rows])
        c.execute("INSERT OR REPLACE INTO pine_seed_commits (seed, sha, committed_at, rows, "
                  "skipped) VALUES (?,?,?,?,?)", (seed, sha, committed_at, len(rows), skipped))
    return len(rows)


def bars(ticker: str, limit: int = 20000) -> list[dict]:
    """`[{t, o, h, l, c, v}]` oldest first for a registered seed. `[]` when unknown/empty."""
    seed = (ticker or "").strip().upper()
    if seed not in SEEDS:
        return []
    _ensure_init()
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT date, o, h, l, c, v FROM pine_seed_rows WHERE seed=? "
                "ORDER BY date DESC LIMIT ?", (seed, int(limit))).fetchall()
    except Exception:
        return []
    rows.reverse()
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def build_bars(ticker: str, tf: str = "D", count: int = 5000) -> dict:
    """`/api/bars`-shaped payload. ⛔ DAILY ONLY. A seed on another timeframe is served
    EMPTY, with the reason, because how TradingView folds a seed's calendar-day rows
    into a weekly or intraday chart is unmeasured."""
    tfu = (tf or "D").upper()
    sym = (ticker or "").strip().upper()
    if tfu != "D":
        return {"ticker": sym, "tf": tfu, "bars": [],
                "note": "a Pine seed is served on the daily timeframe only"}
    return {"ticker": sym, "tf": "D", "bars": bars(sym, count or 5000)}


def ingested_shas(seed: str) -> set:
    _ensure_init()
    with _conn() as c:
        return {r[0] for r in c.execute("SELECT sha FROM pine_seed_commits WHERE seed=?",
                                        (seed,)).fetchall()}


def coverage() -> dict:
    _ensure_init()
    out = {}
    with _conn() as c:
        for seed in SEEDS:
            r = c.execute("SELECT COUNT(*), MIN(date), MAX(date) FROM pine_seed_rows "
                          "WHERE seed=?", (seed,)).fetchone()
            n = c.execute("SELECT COUNT(*), MAX(committed_at) FROM pine_seed_commits "
                          "WHERE seed=?", (seed,)).fetchone()
            out[seed] = {"rows": r[0], "first": r[1], "last": r[2],
                         "uploads": n[0], "newest_upload": n[1]}
    return out


# ── fetching (GitHub) ────────────────────────────────────────────────────────

def _http_get(url: str, timeout: int = 30) -> bytes:
    import urllib.request
    headers = {"User-Agent": _UA, "Accept": "application/vnd.github+json"}
    token = os.environ.get("PINE_SEEDS_GITHUB_TOKEN") or ""
    if token and url.startswith(_GITHUB_API):
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def list_commits(mirror: SeedMirror, *, known: set, max_pages: int,
                 get: Callable[[str], bytes]) -> list[dict]:
    """The file's commits NOT yet ingested, OLDEST FIRST: `[{sha, committed_at}]`.

    GitHub lists newest first, so paging stops at the first page that reaches a known
    commit: everything older than it was ingested on an earlier refresh.
    """
    found: list[dict] = []
    for page in range(1, max_pages + 1):
        url = (f"{_GITHUB_API}/repos/{mirror.repo}/commits?path={mirror.path}"
               f"&per_page=100&page={page}")
        batch = json.loads(get(url).decode("utf-8"))
        if not isinstance(batch, list) or not batch:
            break
        reached_known = False
        for c in batch:
            sha = c.get("sha")
            if not sha:
                continue
            if sha in known:
                reached_known = True
                break
            when = ((c.get("commit") or {}).get("committer") or {}).get("date") or ""
            found.append({"sha": sha, "committed_at": when})
        if reached_known or len(batch) < 100:
            break
    found.reverse()
    return found


def refresh(seeds=None, *, max_pages: Optional[int] = None,
            get: Optional[Callable[[str], bytes]] = None) -> dict:
    """Ingest every new upload of each registered seed, oldest first. Idempotent.

    ⚠️ PER-SEED ISOLATION, like `cboe_store.refresh`: one mirror's outage must not cost
    the others; each error is reported.
    """
    get = get or _http_get
    if max_pages is None:
        max_pages = int(os.environ.get("PINE_SEEDS_MAX_PAGES", "10"))
    out = {"ok": True, "ingested": {}, "errors": {}}
    for seed in (seeds or list(SEEDS)):
        mirror = SEEDS.get(seed)
        if mirror is None:
            out["ok"] = False
            out["errors"][seed] = "not a registered seed"
            continue
        try:
            new = list_commits(mirror, known=ingested_shas(seed), max_pages=max_pages, get=get)
            n = 0
            for c in new:
                try:
                    text = get(f"{_RAW}/{mirror.repo}/{c['sha']}/{mirror.path}").decode("utf-8", "replace")
                except Exception as e:              # noqa: BLE001
                    # ⚰️ MEASURED ON THE LIVE MIRROR 2026-11-14: a commit in the file's
                    # history answers 404 for the file at that commit (it was moved or
                    # deleted there). Raising on it stopped every refresh at the same commit
                    # forever. A file ABSENT at a commit is an upload of NOTHING: it is
                    # recorded with zero rows and the replay continues. Anything else (a
                    # timeout, a 5xx) is still an error and is retried next refresh.
                    if getattr(e, "code", None) != 404:
                        raise
                    text = ""
                ingest_upload(seed, c["sha"], c["committed_at"], text)
                n += 1
            out["ingested"][seed] = n
        except Exception as e:                      # noqa: BLE001 - reported, not raised
            out["ok"] = False
            out["errors"][seed] = f"{type(e).__name__}: {e}"
    return out


def refresh_loop(interval_s: Optional[int] = None) -> None:
    """The boot job's body: refresh now, then on an interval (default 2 h; the author's
    workflow runs once a weekday at 23:30 UTC)."""
    interval = int(interval_s or os.environ.get("PINE_SEEDS_REFRESH_SECS", "7200"))
    while True:
        try:
            res = refresh()
            print(f"[pine-seeds] refresh: ingested={res['ingested']} errors={res['errors']}")
        except Exception as e:                      # noqa: BLE001
            print(f"[pine-seeds] refresh error (non-fatal): {e}")
        time.sleep(interval)
