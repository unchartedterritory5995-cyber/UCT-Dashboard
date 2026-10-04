"""TERM-014 (FB-OBS-03): a retained RSS series, its slope reader, and a per-subsystem
attribution of what grew.

THE GAP. The web pod's `[mem] rss_mb=… threads=…` line (api/main.py `_web_memwatch`,
every 60 s) *"writes to stdout only. Nothing reads it; nothing stores it; a deploy
ends the series."* The measured leak (+7.9 MB/min, monotonic, quartile medians
2,429 → 2,746 → 2,956 → 3,028 MB over 76 samples / 104 min) was read by hand from a
log once. Item 25's reframing is the ticket: *"That is not a memory finding; it is an
observability requirement."*

WHAT THIS IS.
  * `record()` — called from the same 60 s loop, stores one sample: RSS, threads, the
    deployment id, and a cheap per-subsystem census (entries per named TTLCache, live
    threads per name prefix). ⛔ DARK: `RSS_SERIES_ENABLED` unset ⇒ returns before ANY
    I/O, no file is created.
  * `slope()` — the reader. ⛔ OBS-3: no slope is emitted from fewer than
    `MIN_SAMPLES` (40) samples WITHIN ONE DEPLOYMENT, and every answer carries
    `deployments_sampled`, because *"5 samples on a 5-minute pod read flat-to-declining
    on a pod leaking 7.9 MB/min"*. Quartile medians + a least-squares MB/min + whether
    the medians are monotonic, which is the shape the original finding was read in.
  * OBS-4 ceilings: `page` is set when the newest sample is over RSS 3,500 MB or 200
    threads. `tools/rss_slope_report.py` exits 3 on a page; the monitor posts it.
  * `attribution` — every subsystem counter ranked by its growth between the first and
    last quartile. ⚠️ A COUNT, NOT BYTES: a cache that gained 40,000 entries is a
    candidate, not a verdict; `/api/health/memory?deep=1` is what sizes it. The census
    is chosen because it is cheap enough to take every 60 s (`len()` per cache, one
    pass over `threading.enumerate()`), where the deep walk is not.

RETENTION (OBS-5): newest `MAX_ROWS` (400) rows and nothing older than 90 days,
declared in `store_retention` as `rss_series`; the prune asks `may_prune` first and
deletes nothing if the declaration is gone. The file lives on the pod volume
(DATA_DIR), never C:\\data.

What it cannot do, stated: the READING (acceptance (a)/(c)) needs a held window on a
quiet pod — TERM-007, a person's act. This builds the instrument that reading uses.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import sqlite3
import statistics
import threading
import time

FLAG = "RSS_SERIES_ENABLED"
MIN_SAMPLES = 40
MAX_ROWS = 400
MAX_AGE_DAYS = 90
RSS_PAGE_MB = 3500.0
THREADS_PAGE = 200
STORE = "rss_series"
TABLE = "rss_samples"

_WRITE_LOCK = threading.Lock()
_INIT_DONE: set[str] = set()


def is_enabled() -> bool:
    return os.environ.get(FLAG, "").strip().lower() in ("1", "true", "yes")


def db_path() -> str:
    explicit = os.environ.get("RSS_SERIES_DB_PATH")
    if explicit:
        return explicit
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "rss_series.db")


def deployment_id() -> str:
    for k in ("RAILWAY_DEPLOYMENT_ID", "RAILWAY_GIT_COMMIT_SHA"):
        v = os.environ.get(k)
        if v:
            return v[:40]
    return "local"


def _connect(path: str) -> sqlite3.Connection:
    c = sqlite3.connect(path, timeout=2.0)
    c.row_factory = sqlite3.Row
    if path not in _INIT_DONE:
        c.execute(f"CREATE TABLE IF NOT EXISTS {TABLE} ("
                  " id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL,"
                  " deployment TEXT NOT NULL, rss_mb REAL NOT NULL, threads INTEGER NOT NULL,"
                  " subsys TEXT NOT NULL DEFAULT '{}')")
        c.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_ts ON {TABLE}(ts)")
        c.commit()
        _INIT_DONE.add(path)
    return c


# ── the per-subsystem census (cheap enough for every 60 s) ──────────────────

_DIGITS = re.compile(r"[-_]?\d+$")


def thread_prefix(name: str) -> str:
    """`cal-em_3` -> `cal-em`, `ThreadPoolExecutor-4_0` -> `ThreadPoolExecutor`."""
    out = name or "?"
    for _ in range(3):
        nxt = _DIGITS.sub("", out)
        if nxt == out:
            break
        out = nxt
    return out or "?"


def census() -> dict:
    """{"cache:<name>": entries, "threads:<prefix>": live threads}. Never raises."""
    out: dict[str, int] = {}
    try:
        from api.services.memory_probe import _find_caches
        for name, cache in _find_caches():
            try:
                out[f"cache:{name}"] = int(len(cache))
            except Exception:
                continue
    except Exception:
        pass
    try:
        for t in threading.enumerate():
            key = f"threads:{thread_prefix(t.name)}"
            out[key] = out.get(key, 0) + 1
    except Exception:
        pass
    return out


# ── write side ──────────────────────────────────────────────────────────────

def record(rss_mb, threads, *, subsys: dict | None = None, now: float | None = None,
           deployment: str | None = None) -> bool:
    """Store one sample. Dark ⇒ no I/O. Never raises (it rides the memwatch loop)."""
    if not is_enabled() or rss_mb is None:
        return False
    try:
        now = time.time() if now is None else float(now)
        sub = census() if subsys is None else subsys
        path = db_path()
        with _WRITE_LOCK, contextlib.closing(_connect(path)) as c:
            c.execute(f"INSERT INTO {TABLE} (ts, deployment, rss_mb, threads, subsys)"
                      " VALUES (?,?,?,?,?)",
                      (now, deployment or deployment_id(), float(rss_mb), int(threads),
                       json.dumps(sub, sort_keys=True)))
            c.commit()
        prune(now=now)
        return True
    except Exception as e:                               # noqa: BLE001
        print(f"[rss_series] record failed (non-fatal): {type(e).__name__}: {e}")
        return False


def prune(*, now: float | None = None) -> int:
    """OBS-5: keep the newest MAX_ROWS and nothing older than MAX_AGE_DAYS. Asks the
    retention registry first; an undeclared prune deletes nothing."""
    from api.services import store_retention
    if not store_retention.may_prune(STORE, TABLE):
        return 0
    now = time.time() if now is None else float(now)
    cutoff = now - MAX_AGE_DAYS * 86400
    with _WRITE_LOCK, contextlib.closing(_connect(db_path())) as c:
        n = c.execute(f"DELETE FROM {TABLE} WHERE ts < ?", (cutoff,)).rowcount
        n += c.execute(f"DELETE FROM {TABLE} WHERE id NOT IN"
                       f" (SELECT id FROM {TABLE} ORDER BY id DESC LIMIT ?)",
                       (MAX_ROWS,)).rowcount
        c.commit()
    return n


# ── read side ───────────────────────────────────────────────────────────────

def read_samples(path: str | None = None) -> list[dict]:
    """Every stored sample, oldest first. ⛔ Raises on an unreadable store: a series
    that cannot be opened is UNREADABLE, never an empty one. Never creates the file."""
    path = path or db_path()
    if not os.path.exists(path):
        raise FileNotFoundError(f"no RSS series at {path}")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(f"SELECT ts, deployment, rss_mb, threads, subsys FROM {TABLE}"
                           " ORDER BY ts ASC, id ASC").fetchall()
    finally:
        con.close()
    out = []
    for r in rows:
        try:
            sub = json.loads(r["subsys"] or "{}")
        except ValueError:
            sub = {}
        out.append({"ts": r["ts"], "deployment": r["deployment"], "rss_mb": r["rss_mb"],
                    "threads": r["threads"], "subsys": sub})
    return out


def _quartiles(values: list[float]) -> list[float]:
    n = len(values)
    bounds = [0, n // 4, n // 2, (3 * n) // 4, n]
    return [statistics.median(values[bounds[i]:bounds[i + 1]]) for i in range(4)]


def _lsq_slope_per_min(ts: list[float], ys: list[float]) -> float:
    t0 = ts[0]
    xs = [(t - t0) / 60.0 for t in ts]
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den


def slope(samples: list[dict], *, min_samples: int = MIN_SAMPLES) -> dict:
    """The reading over the NEWEST deployment's samples. Pure."""
    deployments = []
    for s in samples:
        if s["deployment"] not in deployments:
            deployments.append(s["deployment"])
    newest = samples[-1] if samples else None
    page = []
    if newest is not None:
        if newest["rss_mb"] > RSS_PAGE_MB:
            page.append(f"rss {newest['rss_mb']:.0f} MB > {RSS_PAGE_MB:.0f} MB")
        if newest["threads"] > THREADS_PAGE:
            page.append(f"threads {newest['threads']} > {THREADS_PAGE}")
    out = {"deployments_sampled": len(deployments), "samples_total": len(samples),
           "page": page, "latest": newest and {k: newest[k] for k in ("ts", "rss_mb", "threads")}}
    if not samples:
        return {**out, "status": "insufficient", "n": 0, "deployment": None,
                "why": "no samples stored"}
    dep = samples[-1]["deployment"]
    win = [s for s in samples if s["deployment"] == dep]
    out.update(deployment=dep, n=len(win))
    if len(win) < min_samples:
        return {**out, "status": "insufficient",
                "why": f"{len(win)} samples in deployment {dep}; a slope needs >= {min_samples} "
                       "within ONE deployment (OBS-3)"}
    ts = [s["ts"] for s in win]
    rss = [s["rss_mb"] for s in win]
    q = _quartiles(rss)
    n = len(win)
    first, last = win[: max(1, n // 4)], win[(3 * n) // 4:]
    keys = set()
    for s in win:
        keys.update(s["subsys"])
    growth = []
    for k in keys:
        a = statistics.median([s["subsys"].get(k, 0) for s in first])
        b = statistics.median([s["subsys"].get(k, 0) for s in last])
        if b - a > 0:
            growth.append({"subsystem": k, "first_quartile": a, "last_quartile": b,
                           "grew": b - a})
    growth.sort(key=lambda g: (-g["grew"], g["subsystem"]))
    return {**out, "status": "ok",
            "window_minutes": round((ts[-1] - ts[0]) / 60.0, 1),
            "slope_mb_per_min": round(_lsq_slope_per_min(ts, rss), 3),
            "quartile_medians_mb": [round(x, 1) for x in q],
            "monotonic": all(q[i] < q[i + 1] for i in range(3)),
            "attribution": growth[:8],
            "attribution_note": "entry/thread COUNTS grown first->last quartile; candidates, "
                                "not bytes (size one with /api/health/memory?deep=1)"}


def report_text(r: dict) -> str:
    lines = [f"status              : {r['status']}",
             f"deployments_sampled : {r['deployments_sampled']}",
             f"deployment          : {r.get('deployment')}  (n={r.get('n')})"]
    if r["status"] != "ok":
        lines.append(f"-> {r.get('why')}")
    else:
        lines += [f"window              : {r['window_minutes']} min",
                  f"slope               : {r['slope_mb_per_min']} MB/min",
                  f"quartile medians    : {' -> '.join(str(x) for x in r['quartile_medians_mb'])} MB",
                  f"monotonic           : {r['monotonic']}",
                  "attribution (grew first->last quartile, counts):"]
        lines += [f"  {g['subsystem']}: {g['first_quartile']} -> {g['last_quartile']} (+{g['grew']})"
                  for g in r["attribution"]] or ["  (nothing grew)"]
    lines.append("PAGE: " + "; ".join(r["page"]) if r["page"] else "ceilings: under RSS 3500 MB / 200 threads")
    return "\n".join(lines)
