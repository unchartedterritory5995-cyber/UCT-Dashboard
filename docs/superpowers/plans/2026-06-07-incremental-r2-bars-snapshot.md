# Incremental R2 Bars Snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the every-cycle full ~688 MB `bars.db` tarball upload with a small time-windowed **delta** snapshot (a few MB) plus a once-daily **base** snapshot, decoupling worker→web egress + CPU from total DB size.

**Architecture:** The worker keeps producing a full "base" snapshot once per day (cold-start seed + drift self-heal). On every other cycle it exports only the rows whose `ts` falls inside a rolling recency window (where bars actually change) into a tiny **delta** tarball. The web pod, which already merges newer-wins (idempotent), applies the latest base on cold start and then applies each new delta in `ts` order. Both paths reuse the existing `_merge_ohlcv_from` merge — no merge-semantics change. A feature flag (`SNAPSHOT_DELTA_ENABLED`) gates the whole scheme so it can be rolled back to the current full-snapshot behavior instantly.

**Tech Stack:** Python 3.12, SQLite (WAL, online backup API), boto3 → Cloudflare R2, `tarfile`/`io.BytesIO`. No new dependencies.

---

## Background — current mechanism (read before starting)

- **Worker** (`api/services/data_sync.py`): `upload_snapshot()` → `_make_tarball()` does `_backup_sqlite_db()` (full online backup of the whole `bars.db`, now ~18 GB) → `tarfile … w:gz` into an `io.BytesIO` → `client.put_object(key="snapshots/<ts>.tar.gz")` + writes `latest.txt`. Runs every `SNAPSHOT_INTERVAL_SECONDS` (now 1200s) during the active window. `_snapshot_fingerprint()` skips when `bars.db` mtime/size is unchanged (only helps overnight).
- **Web** (`api/main.py` `_s3_pull_loop`): every `SNAPSHOT_INTERVAL_SECONDS`, `sync_if_newer_merge()` → `merge_snapshot(ts)` → downloads `snapshots/<ts>.tar.gz`, extracts `bars.db`, `_verify_snapshot_db()` (integrity_check), then `_merge_ohlcv_from(src_db)` — **newer-wins INSERT, never replaces local rows**. `bars_cache/` is ignored on this path (as of 2026-06-07 it's no longer shipped).
- **Schema:** the only table the merge cares about is `ohlcv` (and, if present, `bars_provenance`). Confirm exact columns in `api/services/bars_sqlite.py` before writing the delta export.

**Why a delta works:** intraday bars only mutate for the most recent few sessions (live bar close, late prints, reconciliation heals). Anything older is immutable. So a rolling window of recent rows captures 100% of real changes; the daily base backstops anything outside the window and any missed delta.

**Key invariants that MUST survive (from CLAUDE.md "Bars Freshness & Reliability"):**
- Newest bar wins per `(ticker, tf, ts)` on every path. The delta apply MUST go through the same newer-wins merge — never a replace.
- NEVER bump `CACHE_LOGIC_VERSION` as part of this (client-side; unrelated and stampede-risky).
- The web pod must never regress a fresher local row from an older snapshot. `_merge_ohlcv_from` already guarantees this; the delta apply reuses it verbatim.

---

## R2 key scheme

```
snapshots/<ts>.tar.gz          # EXISTING full snapshots (legacy + new "base"); keep writing for back-compat
latest.txt                     # EXISTING — points at newest full snapshot (base). Unchanged.
deltas/<ts>.tar.gz             # NEW — each contains a small delta.db (rows with ts >= window cutoff)
deltas/latest.txt              # NEW — newline-separated list of recent delta ts (newest last), pruned to last ~50
```

A delta is only valid relative to a base that is **older-or-equal** to it. Web logic: apply `latest.txt` base, then every `deltas/*` whose `ts > base_ts AND ts > last_applied_delta_ts`, in ascending `ts` order.

---

## Rolling window (cutoffs)

`_delta_cutoffs()` returns a dict of `{tf: cutoff_unix_seconds}`. Defaults (env-overridable, all generous so the daily base is never load-bearing for correctness):

| tf | window | rationale |
|----|--------|-----------|
| `1`,`5`,`15`,`30`,`60` | 5 trading days (`DELTA_WINDOW_INTRADAY_DAYS=7` calendar default) | covers live + recently-revised intraday |
| `D` | 10 days (`DELTA_WINDOW_DAILY_DAYS=10`) | covers today's bar + any recent daily heal |
| `W`,`M` | 45 days (`DELTA_WINDOW_SLOW_DAYS=45`) | weekly/monthly bars change rarely |

Anything older that somehow changes is picked up by the next daily base. Windows are deliberately wide — egress is still tiny because the window is bounded and independent of universe size.

---

## File Structure

- **Modify** `api/services/data_sync.py` — add delta export/upload/apply functions + base/delta cadence helpers. This is the right home: it already owns tarball build, R2 client, and merge.
- **Modify** `api/worker_main.py` — `_start_uploader()` loop decides base-vs-delta per cycle.
- **Modify** `api/main.py` `_s3_pull_loop` — apply base + deltas when delta mode is on.
- **Test** `tests/api/test_delta_snapshot.py` — new, self-contained (uses tmp dirs + a fake/in-memory S3 client double; follow the pattern in `tests/api/test_snapshot.py` / `tests/test_bar_reconcile.py`).

No frontend changes. No schema changes.

---

### Task 1: Define the delta window cutoffs

**Files:**
- Modify: `api/services/data_sync.py` (add near the other `SNAPSHOT_*` constants, ~line 62-80)
- Test: `tests/api/test_delta_snapshot.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_delta_snapshot.py
import importlib
from api.services import data_sync

def test_delta_cutoffs_are_per_tf_and_ordered():
    cuts = data_sync._delta_cutoffs(now=1_700_000_000)
    # every tf the merge serves must have a cutoff
    for tf in ("1", "5", "15", "30", "60", "D", "W", "M"):
        assert tf in cuts
        assert cuts[tf] < 1_700_000_000          # cutoff is in the past
    # intraday window is tighter than the slow-tf window
    assert cuts["5"] > cuts["W"]                 # 5m cutoff is more recent than weekly
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_delta_snapshot.py::test_delta_cutoffs_are_per_tf_and_ordered -v`
Expected: FAIL — `AttributeError: module 'api.services.data_sync' has no attribute '_delta_cutoffs'`

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/data_sync.py  (near the SNAPSHOT_* constants)
_DAY = 86400
DELTA_WINDOW_INTRADAY_DAYS = int(os.environ.get("DELTA_WINDOW_INTRADAY_DAYS", "7"))
DELTA_WINDOW_DAILY_DAYS = int(os.environ.get("DELTA_WINDOW_DAILY_DAYS", "10"))
DELTA_WINDOW_SLOW_DAYS = int(os.environ.get("DELTA_WINDOW_SLOW_DAYS", "45"))

def _delta_cutoffs(now: Optional[int] = None) -> dict:
    """Per-tf unix-seconds cutoff: rows with ts >= cutoff go in the delta.
    Windows are wide on purpose — the daily base backstops anything older."""
    now = int(now if now is not None else time.time())
    intraday = now - DELTA_WINDOW_INTRADAY_DAYS * _DAY
    return {
        "1": intraday, "5": intraday, "15": intraday, "30": intraday, "60": intraday,
        "D": now - DELTA_WINDOW_DAILY_DAYS * _DAY,
        "W": now - DELTA_WINDOW_SLOW_DAYS * _DAY,
        "M": now - DELTA_WINDOW_SLOW_DAYS * _DAY,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_delta_snapshot.py::test_delta_cutoffs_are_per_tf_and_ordered -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/data_sync.py tests/api/test_delta_snapshot.py
git commit -m "feat(data_sync): per-tf delta window cutoffs"
```

---

### Task 2: Export a delta SQLite of recent rows

**Files:**
- Modify: `api/services/data_sync.py`
- Test: `tests/api/test_delta_snapshot.py`

**Precondition — confirm the `ohlcv` schema.** Open `api/services/bars_sqlite.py`, find the `CREATE TABLE` for the bars table (columns are likely `ticker, tf, ts, o, h, l, c, v` plus maybe a provenance/epoch column). Use the EXACT column list + table name in the export below. If a `bars_provenance` table exists and the web merge reads it, include it in the delta the same way.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_delta_snapshot.py
import os, sqlite3, tempfile
from api.services import data_sync

def _seed_db(path, rows):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT, tf TEXT, ts INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL, PRIMARY KEY(ticker,tf,ts))")
    c.executemany("INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
    c.commit(); c.close()

def test_export_delta_only_includes_recent_rows(tmp_path, monkeypatch):
    src = str(tmp_path / "bars.db")
    # one ancient daily bar, one recent 5m bar
    _seed_db(src, [
        ("AAPL", "D", 1_000_000_000, 1,1,1,1,1),       # ancient -> excluded
        ("AAPL", "5", 1_699_999_000, 2,2,2,2,2),       # recent  -> included
    ])
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    out_db = str(tmp_path / "delta.db")
    n = data_sync._export_delta_db(out_db, now=1_700_000_000)
    assert n == 1
    got = sqlite3.connect(out_db).execute("SELECT ticker,tf,ts FROM ohlcv").fetchall()
    assert got == [("AAPL", "5", 1_699_999_000)]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_delta_snapshot.py::test_export_delta_only_includes_recent_rows -v`
Expected: FAIL — no attribute `_export_delta_db`.

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/data_sync.py
def _export_delta_db(out_path: str, now: Optional[int] = None) -> int:
    """Build a small SQLite at out_path containing only rows newer than the
    per-tf cutoff. Returns rows exported. Reads the live bars.db read-only
    (WAL allows concurrent reads while the prewarmer writes)."""
    cutoffs = _delta_cutoffs(now)
    src_path = os.path.join(_DATA_DIR, "bars.db")
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    try:
        out = sqlite3.connect(out_path)
        try:
            out.execute(
                "CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT, tf TEXT, ts INTEGER, "
                "o REAL, h REAL, l REAL, c REAL, v REAL, PRIMARY KEY(ticker,tf,ts))"
            )
            total = 0
            for tf, cut in cutoffs.items():
                rows = src.execute(
                    "SELECT ticker,tf,ts,o,h,l,c,v FROM ohlcv WHERE tf=? AND ts>=?",
                    (tf, cut),
                ).fetchall()
                if rows:
                    out.executemany("INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
                    total += len(rows)
            out.commit()
            return total
        finally:
            out.close()
    finally:
        src.close()
```

> **IMPORTANT:** match the real column list from `bars_sqlite.py`. If the table is not named `ohlcv` or has extra columns (e.g. a provenance/source column), update both the `SELECT` and the `CREATE TABLE`. If `bars_provenance` is read by the web merge, repeat the same windowed export for it.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_delta_snapshot.py::test_export_delta_only_includes_recent_rows -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/data_sync.py tests/api/test_delta_snapshot.py
git commit -m "feat(data_sync): windowed delta SQLite export"
```

---

### Task 3: Upload a delta tarball + maintain deltas/latest.txt

**Files:**
- Modify: `api/services/data_sync.py`
- Test: `tests/api/test_delta_snapshot.py` (use a fake S3 client double)

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_delta_snapshot.py
class _FakeS3:
    def __init__(self): self.objs = {}
    def put_object(self, Bucket, Key, Body, **kw): self.objs[Key] = Body if isinstance(Body, bytes) else Body.encode()
    def get_object(self, Bucket, Key): return {"Body": type("B", (), {"read": lambda s: self.objs[Key]})()}
    def list_objects_v2(self, Bucket, Prefix): 
        return {"Contents": [{"Key": k} for k in self.objs if k.startswith(Prefix)]}
    def delete_object(self, Bucket, Key): self.objs.pop(Key, None)

def test_upload_delta_writes_tarball_and_index(tmp_path, monkeypatch):
    fake = _FakeS3()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")
    _seed_db(str(tmp_path / "bars.db"), [("AAPL","5",1_699_999_000,2,2,2,2,2)])
    ts = data_sync.upload_delta(now=1_700_000_000)
    assert ts and f"deltas/{ts}.tar.gz" in fake.objs
    assert b"deltas/" not in b""  # sanity
    assert "deltas/latest.txt" in fake.objs
    assert ts in fake.objs["deltas/latest.txt"].decode()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_delta_snapshot.py::test_upload_delta_writes_tarball_and_index -v`
Expected: FAIL — no attribute `upload_delta`.

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/data_sync.py
_DELTA_PREFIX = "deltas/"
_DELTA_INDEX_KEY = "deltas/latest.txt"
DELTA_KEEP = int(os.environ.get("DELTA_KEEP", "50"))

def _make_delta_tarball(now: Optional[int] = None) -> Optional[bytes]:
    tmpdir = tempfile.mkdtemp(prefix="data_sync_delta_")
    try:
        delta_db = os.path.join(tmpdir, "delta.db")
        n = _export_delta_db(delta_db, now=now)
        if n == 0:
            return None
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(delta_db, arcname="delta.db")
        return buf.getvalue()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

def upload_delta(now: Optional[int] = None) -> Optional[str]:
    client, bucket = _client(), _bucket()
    if not (client and bucket):
        return None
    data = _make_delta_tarball(now=now)
    if not data:
        return None
    ts = str(int(now if now is not None else time.time()))
    client.put_object(Bucket=bucket, Key=f"{_DELTA_PREFIX}{ts}.tar.gz", Body=data,
                      ContentType="application/gzip")
    # append ts to the index, keep last DELTA_KEEP
    try:
        existing = client.get_object(Bucket=bucket, Key=_DELTA_INDEX_KEY)["Body"].read().decode().split()
    except Exception:
        existing = []
    keep = (existing + [ts])[-DELTA_KEEP:]
    client.put_object(Bucket=bucket, Key=_DELTA_INDEX_KEY, Body="\n".join(keep).encode(),
                      ContentType="text/plain")
    _prune_old_deltas(keep)
    return ts

def _prune_old_deltas(keep_list) -> None:
    client, bucket = _client(), _bucket()
    if not (client and bucket):
        return
    keepset = {f"{_DELTA_PREFIX}{t}.tar.gz" for t in keep_list}
    try:
        for o in client.list_objects_v2(Bucket=bucket, Prefix=_DELTA_PREFIX).get("Contents", []):
            k = o["Key"]
            if k.endswith(".tar.gz") and k not in keepset:
                client.delete_object(Bucket=bucket, Key=k)
    except Exception as e:
        logger.warning(f"[data_sync] delta prune failed (non-fatal): {e}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_delta_snapshot.py::test_upload_delta_writes_tarball_and_index -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/data_sync.py tests/api/test_delta_snapshot.py
git commit -m "feat(data_sync): upload windowed delta tarball + pruned index"
```

---

### Task 4: Apply base + deltas on the web side

**Files:**
- Modify: `api/services/data_sync.py`
- Test: `tests/api/test_delta_snapshot.py`

- [ ] **Step 1: Write the failing test** (end-to-end: seed worker DB, base, mutate, delta, apply to a fresh web DB)

```python
# tests/api/test_delta_snapshot.py
def test_base_then_delta_round_trip(tmp_path, monkeypatch):
    fake = _FakeS3()
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")

    # --- worker side: seed + full base, then a fresh recent bar + delta ---
    worker_dir = tmp_path / "worker"; worker_dir.mkdir()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(worker_dir))
    _seed_db(str(worker_dir / "bars.db"), [("AAPL","D",1_699_900_000,1,1,1,1,1)])
    base_ts = data_sync.upload_snapshot(force=True)          # existing full path
    _seed_db(str(worker_dir / "bars.db"), [("AAPL","5",1_699_999_000,9,9,9,9,9)])  # new recent row
    delta_ts = data_sync.upload_delta(now=1_700_000_000)

    # --- web side: cold DB, apply base then delta ---
    web_dir = tmp_path / "web"; web_dir.mkdir()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(web_dir))
    applied = data_sync.sync_with_deltas()                   # new orchestrator
    rows = sqlite3.connect(str(web_dir / "bars.db")).execute(
        "SELECT ticker,tf,ts FROM ohlcv ORDER BY ts").fetchall()
    assert ("AAPL","D",1_699_900_000) in rows                # from base
    assert ("AAPL","5",1_699_999_000) in rows                # from delta
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_delta_snapshot.py::test_base_then_delta_round_trip -v`
Expected: FAIL — no attribute `sync_with_deltas`.

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/data_sync.py
def apply_delta(ts: str) -> bool:
    """Download deltas/<ts>.tar.gz and merge its delta.db newer-wins into the
    local bars.db. Reuses the exact merge the full path uses."""
    client, bucket = _client(), _bucket()
    if not (client and bucket):
        return False
    tmpdir = tempfile.mkdtemp(prefix="data_sync_delta_apply_")
    try:
        data = client.get_object(Bucket=bucket, Key=f"{_DELTA_PREFIX}{ts}.tar.gz")["Body"].read()
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            tar.extractall(tmpdir)
        src = os.path.join(tmpdir, "delta.db")
        if not os.path.exists(src) or not _verify_snapshot_db(src):
            logger.warning(f"[data_sync] delta {ts} missing/invalid; skipping")
            return False
        adopted = _merge_ohlcv_from(src)        # SAME newer-wins merge as full path
        _write_marker(".last_delta_ts", ts)
        logger.info(f"[data_sync] applied delta {ts}: {adopted} rows")
        return adopted >= 0
    except Exception as e:
        logger.warning(f"[data_sync] apply_delta {ts} failed (non-fatal): {e}")
        return False
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

def _list_remote_deltas() -> list:
    client, bucket = _client(), _bucket()
    if not (client and bucket):
        return []
    try:
        raw = client.get_object(Bucket=bucket, Key=_DELTA_INDEX_KEY)["Body"].read().decode()
        return [t for t in raw.split() if t.strip()]
    except Exception:
        return []

def sync_with_deltas() -> Optional[str]:
    """Cold start: install latest full base. Then apply every delta newer than
    the base and newer than the last applied delta, in ascending ts order.
    Returns the newest ts applied, or None."""
    base_ts = get_latest_snapshot_ts()
    newest = None
    if base_ts and not os.path.exists(os.path.join(_DATA_DIR, "bars.db")):
        if download_snapshot(base_ts):           # existing full installer
            newest = base_ts
    elif base_ts:
        # periodic: fold the daily base in too (newer-wins, cheap if unchanged)
        if merge_snapshot(base_ts):
            newest = base_ts
    last_delta = (get_local_marker(".last_delta_ts") or "0")
    floor = max(int(base_ts or 0), int(last_delta or 0))
    for ts in sorted(_list_remote_deltas(), key=lambda x: int(x)):
        if int(ts) > floor:
            if apply_delta(ts):
                newest = ts
    return newest
```

> `get_local_marker` may need a tiny read helper mirroring `_write_marker`; if absent, add `def get_local_marker(name): try: return open(os.path.join(_DATA_DIR,name)).read().strip() except: return None`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_delta_snapshot.py::test_base_then_delta_round_trip -v`
Expected: PASS

- [ ] **Step 5: Run the FULL existing snapshot/merge suite to prove no regression**

Run: `python -m pytest tests/api/test_snapshot.py tests/api/test_data_sync_throttle.py tests/test_bar_reconcile.py -q`
Expected: all PASS (delta code is additive; full path untouched)

- [ ] **Step 6: Commit**

```bash
git add api/services/data_sync.py tests/api/test_delta_snapshot.py
git commit -m "feat(data_sync): apply base + ordered deltas (newer-wins) on web"
```

---

### Task 5: Wire the cadence — worker emits deltas, base once/day

**Files:**
- Modify: `api/worker_main.py` (`_start_uploader` loop, ~line 64-100)

- [ ] **Step 1: Add the base-vs-delta decision in the uploader loop**

```python
# api/worker_main.py inside _start_uploader.loop(), replacing the body that
# currently always calls upload_snapshot():
from api.services import data_sync
DELTA_ON = os.environ.get("SNAPSHOT_DELTA_ENABLED", "0") == "1"
_last_base_day = {"d": None}

# ... inside the while loop, after credentials_ok() check:
if DELTA_ON:
    # one full base per calendar day (ET) for cold-start + drift backstop
    import datetime as _dt
    from zoneinfo import ZoneInfo
    today = _dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    if _last_base_day["d"] != today:
        if data_sync.upload_snapshot(force=True):   # full base
            _last_base_day["d"] = today
            outcome = "base"
    else:
        ts = data_sync.upload_delta()
        outcome = "delta" if ts else "unchanged"
else:
    # existing full-snapshot path (unchanged)
    ts = data_sync.upload_snapshot()
    ...
```

- [ ] **Step 2: Manual verification (no unit test — it's glue)**

Run locally with `SNAPSHOT_DELTA_ENABLED=1`, a seeded `bars.db`, and R2 creds pointed at a scratch bucket/prefix. Confirm: first cycle writes `snapshots/<ts>.tar.gz` (base) + `latest.txt`; subsequent cycles write `deltas/<ts>.tar.gz` (a few MB) + update `deltas/latest.txt`.

- [ ] **Step 3: Commit**

```bash
git add api/worker_main.py
git commit -m "feat(worker): emit daily base + per-cycle deltas under SNAPSHOT_DELTA_ENABLED"
```

---

### Task 6: Wire the web pull loop to delta mode

**Files:**
- Modify: `api/main.py` `_s3_pull_loop` (~line 1107-1123)

- [ ] **Step 1: Branch the pull loop on the flag**

```python
# api/main.py inside _s3_pull_loop():
_delta_on = os.environ.get("SNAPSHOT_DELTA_ENABLED") == "1"
# ... inside the while loop:
if _delta_on:
    ts = data_sync.sync_with_deltas()
    if ts:
        print(f"[data_sync] synced via base+deltas through {ts}")
elif _legacy_replace:
    ...                       # existing
else:
    ts = data_sync.sync_if_newer_merge()   # existing
```

- [ ] **Step 2: Manual verification**

Boot a web instance with `SNAPSHOT_DELTA_ENABLED=1`, empty `/data`. Confirm it installs the base then applies deltas; `GET /api/health/cache` reports a recent sync; open a chart for a recently-active ticker and confirm fresh bars.

- [ ] **Step 3: Commit**

```bash
git add api/main.py
git commit -m "feat(web): consume base + deltas under SNAPSHOT_DELTA_ENABLED"
```

---

### Task 7: Rollout + observability

- [ ] **Step 1:** Add `delta` / `base` to the worker health `uploader_last_outcome` enum doc in `api/worker_main.py` (already set via `outcome` above — just confirm the health payload surfaces it).
- [ ] **Step 2:** Document the new env vars in `.env.example`: `SNAPSHOT_DELTA_ENABLED`, `DELTA_WINDOW_INTRADAY_DAYS`, `DELTA_WINDOW_DAILY_DAYS`, `DELTA_WINDOW_SLOW_DAYS`, `DELTA_KEEP`.
- [ ] **Step 3:** Commit, then enable in prod by setting `SNAPSHOT_DELTA_ENABLED=1` on **both** web and worker. Watch `/api/health/cache` (web) + `/internal/health` (worker) and the Railway egress graph for ~1 trading day before removing the full-snapshot fallback.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| A delta is missed/corrupt → web slightly stale | Low | Low | Daily base re-merges everything (newer-wins); `_verify_snapshot_db` rejects corrupt deltas; reconciliation worker still heals drift |
| Window too narrow → a changed old bar never ships | Very low | Low | Windows are deliberately wide (5–45 d); daily base catches anything older; this only affects historical-revision edge cases users rarely view |
| Delta applied out of order regresses a row | None | — | Merge is **newer-wins per (ticker,tf,ts)** — order-independent and idempotent by construction; reused verbatim from the full path |
| Cold-start race (base not yet uploaded) | Low | Low | `sync_with_deltas` cold path requires a base; if absent it no-ops and retries next cycle (same as today) |
| Schema mismatch in delta export | Medium if rushed | High | Task 2 precondition: copy exact `ohlcv` columns + include `bars_provenance` if the merge reads it. Round-trip test (Task 4) catches mismatches |
| Flag drift (web on, worker off or vice-versa) | Low | Medium | If worker emits deltas but web is off, web still merges the daily base (stale-by-≤1-day, not broken). If web on but worker off, web finds no deltas and just merges base. Both degrade gracefully |

**Rollback:** unset `SNAPSHOT_DELTA_ENABLED` on both services → instant return to the current full-snapshot-every-cycle behavior. No data migration, no schema change.

## Expected payoff

- **Egress:** intraday uploads drop from ~688 MB/cycle to a few MB/cycle. With a 20-min cadence over a 16 h window that's ~33 GB/day → roughly **~1 GB/day of deltas + one 688 MB base = ~1.7 GB/day** (~95% further cut, ~99% vs. the original 5-min full-snapshot baseline).
- **CPU/memory:** no full 18 GB SQLite backup + 18 GB gzip per cycle — just a windowed `SELECT` + a few-MB gzip. The big per-cycle sawtooth collapses to a once-daily base spike.
- **Scale:** delta size is bounded by *recent market activity*, not by universe size or DB age — so worker egress/CPU stay flat as `bars.db` grows toward 30 GB+ and the universe expands. This is the change that makes the bars bridge scale.

## Out of scope (future)

- Horizontal web scale (multiple replicas) is blocked by the single-writer SQLite/volume model; the delta scheme is a prerequisite but not a solution. A read-replica or Postgres/Turso migration is a separate, larger initiative.
- Compressing/columnar-encoding the bars store. Separate effort.
