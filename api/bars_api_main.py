"""Dedicated bars-SERVING tier (Path B, 2026-09-02).

⭐ WHY THIS EXISTS. Charts are slow-on-deploy because the WEB (app) pod serves
the live chart data, so every app/partner deploy restarts it and the charts blip
+ cold-start. This entrypoint serves ONLY the chart-data HTTP endpoints
(`/api/bars` + `/api/bars-history`) from a fresh, R2-synced `bars.db`, with NO
warmers, NO market-data socket, and (once its Railway watch paths are narrowed)
its OWN deploy triggers — so app/partner deploys can NEVER restart chart serving.

It runs the SAME shared serve core as the web pod — `api.routers.bars.serve_bars`
and `serve_bars_history` — so the two can never diverge. Selected by the
railway.json dispatcher when `BARS_API_ENABLED=1`.

⛔ Does NOT run the prewarmer, R2 uploader, Massive WS, or reconciliation/audit.
⛔ NEVER opens a Massive WS (~1 conn/key — a second kicks web's live feed offline).
⛔ Only READS + newer-wins MERGES the local db. NEVER force_resync / replace-pull.

── The boot install (2026-09-02, hard-won) ─────────────────────────────────────
On a fresh pod the local bars.db is INSTALLED from R2 via `download_snapshot`
(streams the tarball to disk in 8MB chunks — data_sync.py:599). Two traps this
survived:
  1. init_db() before the pull created an EMPTY db → the slow row-by-row merge
     (loads whole snapshot into RAM). Fixed: install first, init_db after.
  2. The install ran in a lifespan THREAD → its GIL-heavy extract starved
     /api/health → Railway silently restart-looped it (even with 32GB/50GB).
     Fixed: run the install SYNCHRONOUSLY in main() BEFORE uvicorn, so it's
     covered by the 600s startup-healthcheck grace and there is no live health
     to starve. Also extract onto the 50GB VOLUME (TMPDIR), not the small
     ephemeral /tmp.
"""
import os
import logging
import threading
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Query

_log = logging.getLogger("uvicorn.error")
_DATA_DIR = os.environ.get("DATA_DIR", "/data")


def _rss_mb():
    try:
        import resource
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    except Exception:
        return None


def _ensure_local_db_installed() -> None:
    """SYNCHRONOUS boot install — CALLED FROM main() BEFORE uvicorn.

    A real R2 install holds thousands of distinct tickers; a db contaminated only
    by a few on-demand cold-fetches holds <100 (but easily >1000 bar ROWS — which
    a row-count check wrongly reads as populated). So gate on DISTINCT TICKERS.
    Remove a sparse/missing db so `download_snapshot` does a FAST streamed full
    install (not a RAM-heavy merge into an empty db). Step-logged so any failure
    is pinpointed. Never raises (serving cold-fetches until the periodic pull lands).
    """
    from api.services import data_sync
    import sqlite3
    import shutil
    p = os.path.join(_DATA_DIR, "bars.db")
    # ⭐ Clear stale temp from interrupted prior installs FIRST. A redeploy mid-download
    # leaves download_snapshot's tmpdir uncleaned; across many deploys these accumulated
    # in /data/tmp and filled the 50GB volume → "[Errno 28] No space left on device".
    # Start each boot with a clean temp dir so a clean install fits. Never touches bars.db.
    try:
        du = shutil.disk_usage(_DATA_DIR)
        _log.info("[bars-api] volume %s: %.1fGB used / %.1fGB total (%.1fGB free) BEFORE cleanup",
                  _DATA_DIR, (du.used) / 1e9, du.total / 1e9, du.free / 1e9)
        # Log the biggest offenders on /data so we KNOW what filled it (not guess).
        for name in sorted(os.listdir(_DATA_DIR)):
            fp = os.path.join(_DATA_DIR, name)
            try:
                if os.path.isfile(fp):
                    sz = os.path.getsize(fp)
                else:
                    sz = sum(os.path.getsize(os.path.join(r, f))
                             for r, _, fs in os.walk(fp) for f in fs
                             if os.path.exists(os.path.join(r, f)))
                if sz > 50e6:
                    _log.info("[bars-api]   /data/%s = %.2fGB", name, sz / 1e9)
            except Exception:  # noqa: BLE001
                pass
    except Exception as e:  # noqa: BLE001
        _log.warning("[bars-api] disk-usage probe failed (non-fatal): %s", e)
    try:
        _tmp = os.path.join(_DATA_DIR, "tmp")
        if os.path.isdir(_tmp):
            shutil.rmtree(_tmp, ignore_errors=True)
        os.makedirs(_tmp, exist_ok=True)
        _log.info("[bars-api] cleared stale temp dir %s before install", _tmp)
    except Exception as e:  # noqa: BLE001
        _log.warning("[bars-api] temp cleanup failed (non-fatal): %s", e)
    try:
        populated = False
        if os.path.exists(p):
            c = sqlite3.connect(p, timeout=5)
            try:
                row = c.execute(
                    "SELECT COUNT(*) FROM (SELECT ticker FROM ohlcv GROUP BY ticker LIMIT 3000)"
                ).fetchone()
                n = int(row[0]) if row else 0
                populated = n >= 2000
                _log.info("[bars-api] local bars.db ~%d distinct tickers (populated=%s)", n, populated)
            except Exception:
                populated = False
            finally:
                c.close()
        if populated and os.environ.get("FORCE_BOOT_R2_PULL") != "1":
            _log.info("[bars-api] boot install skipped — local bars.db already populated")
            return
        if os.path.exists(p) and not populated:
            for f in (p, p + "-wal", p + "-shm"):
                try:
                    os.remove(f)
                except FileNotFoundError:
                    pass
                except Exception as e:  # noqa: BLE001
                    _log.warning("[bars-api] could not remove %s: %s", f, e)
            _log.info("[bars-api] removed sparse local bars.db → R2 full install")
        latest = data_sync.get_latest_snapshot_ts()
        if not latest:
            _log.warning("[bars-api] no R2 snapshot available yet — will cold-fetch "
                         "until the periodic pull lands one")
            return
        _log.info("[bars-api] STEP install: download+extract snapshot %s onto %s …",
                  latest, os.environ.get("TMPDIR", "/tmp"))
        t0 = time.time()
        ok = data_sync.download_snapshot(latest)
        _log.info("[bars-api] STEP install: download_snapshot returned %s in %.1fs",
                  ok, time.time() - t0)
        try:
            from api.services import bars_sqlite
            bars_sqlite.init_db()
            _log.info("[bars-api] STEP install: init_db done — boot install COMPLETE")
        except Exception as e:  # noqa: BLE001
            _log.warning("[bars-api] post-install init_db failed (non-fatal): %s", e)
    except Exception as e:  # noqa: BLE001
        _log.warning("[bars-api] boot install FAILED (non-fatal, cold cache): %s", e)


def _start_periodic_pull() -> None:
    """Periodic R2 newer-wins pull (same as the web pod). Runs post-startup in a
    daemon thread; applies small deltas onto the already-installed db (low GIL)."""
    from api.services import data_sync

    def _loop():
        legacy = os.environ.get("R2_PERIODIC_PULL_LEGACY_REPLACE") == "1"
        while True:
            time.sleep(data_sync.SNAPSHOT_INTERVAL_SECONDS)
            try:
                if data_sync.DELTA_ENABLED:
                    data_sync.sync_with_deltas()
                elif legacy:
                    data_sync.sync_if_newer()
                else:
                    data_sync.sync_if_newer_merge()   # newer-wins; never wipes
            except Exception as e:  # noqa: BLE001
                _log.warning("[bars-api] periodic pull error (non-fatal): %s", e)

    threading.Thread(target=_loop, daemon=True, name="bars-api-s3-pull").start()
    _log.info("[bars-api] periodic R2 puller started (%s-min cadence)",
              data_sync.SNAPSHOT_INTERVAL_SECONDS // 60)


def _start_hotset_push() -> None:
    """Publish THIS tier's recorded hot-set to R2 so the worker prewarmer keeps
    prioritising what users view. Gated BARS_API_PUSH_HOTSET (default OFF) — flips
    ON at cutover when the web pod's own hot-set push flips OFF."""
    from api.services import data_sync
    from api.services.bars_fetch import get_hot_intraday_tickers

    def _loop():
        while True:
            time.sleep(120)
            try:
                hs = get_hot_intraday_tickers(500)
                if hs:
                    data_sync.put_hotset(hs)
            except Exception as e:  # noqa: BLE001
                _log.warning("[bars-api] hotset push error (non-fatal): %s", e)

    threading.Thread(target=_loop, daemon=True, name="bars-api-hotset-push").start()
    _log.info("[bars-api] hot-set push loop started")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # ⭐ Install the DB in a BACKGROUND THREAD (uvicorn has already bound the port,
    # so Railway's readiness check is satisfied — running the install BEFORE uvicorn
    # made the port bind too late and Railway restart-looped the container at ~40s).
    # The extract goes to the 50GB volume (TMPDIR set in main), not ephemeral /tmp.
    # Serving cold-fetches until this completes; then it serves from the R2-installed db.
    threading.Thread(target=_ensure_local_db_installed, daemon=True,
                     name="bars-api-boot-install").start()
    _start_periodic_pull()
    try:
        from api.services import bars_wal_checkpointer
        bars_wal_checkpointer.start_bars_wal_checkpointer()
    except Exception as e:  # noqa: BLE001
        _log.warning("[bars-api] WAL checkpointer start failed: %s", e)
    try:
        if os.environ.get("BARSPACK_WEB_INGEST_ENABLED") == "1":
            from api.services import barspack_web_ingest as _bpwi
            _bpwi.start_web_ingest()
            _log.info("[bars-api] barspack web-ingest started")
    except Exception as e:  # noqa: BLE001
        _log.warning("[bars-api] barspack ingest start failed (non-fatal): %s", e)
    if os.environ.get("BARS_API_PUSH_HOTSET") == "1":
        _start_hotset_push()
    _log.info("[bars-api] serving tier UP — /api/bars + /api/bars-history "
              "(no warmers, no uploader, no WS)")
    yield


def _build_app() -> FastAPI:
    app = FastAPI(title="UCT Bars API", docs_url=None, redoc_url=None, lifespan=_lifespan)
    from api.routers.bars import serve_bars, serve_bars_history

    def _health():
        return {"alive": True, "service": "bars-api",
                "threads": threading.active_count(), "rss_mb": _rss_mb()}

    @app.get("/api/health")
    def health():
        return _health()

    @app.get("/internal/health")
    def internal_health():
        return _health()

    @app.get("/api/ready")
    def ready():
        return {"ready": True, "service": "bars-api", "pending": []}

    @app.get("/api/bars/{ticker}")
    def bars_route(
        ticker: str,
        tf: str = "D",
        bars: int = Query(default=200, ge=1, le=60000),
        since: str = "",
        to: str = "",
        warm: int = 0,
    ):
        return serve_bars(ticker, tf, bars, since=since, to=to, warm=warm)

    @app.get("/api/bars-history/{ticker}")
    def bars_history_route(
        ticker: str,
        tf: str = "D",
        bars: int = Query(default=60000, ge=1, le=60000),
        v: str = "",
        d: str = "",
    ):
        return serve_bars_history(ticker, tf, bars, v, d)

    return app


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    # Extract/install onto the 50GB VOLUME, not the small ephemeral /tmp (a big
    # extract there was a suspected silent-kill cause). Set in-process so it also
    # overrides any mangled Railway TMPDIR value.
    try:
        import tempfile
        _tmp = os.path.join(_DATA_DIR, "tmp")
        os.makedirs(_tmp, exist_ok=True)
        # ⭐ Set BOTH the env vars AND tempfile.tempdir directly. tempfile CACHES its
        # dir on first use (during imports, before main runs) → the env var alone was
        # ignored and the ~GB snapshot download went to the tiny ephemeral /tmp →
        # "[Errno 28] No space left on device" after 78s. Setting tempfile.tempdir
        # overrides the cache so download_snapshot's mkdtemp uses the 50GB volume.
        os.environ["TMPDIR"] = _tmp
        os.environ["TEMP"] = _tmp
        os.environ["TMP"] = _tmp
        tempfile.tempdir = _tmp
    except Exception as e:  # noqa: BLE001
        _log.warning("[bars-api] could not set volume TMPDIR (%s): %s", _DATA_DIR, e)
    # The DB install runs in a background thread from the lifespan (AFTER uvicorn
    # binds the port), so the container passes Railway's readiness check immediately.
    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(_build_app(), host="0.0.0.0", port=port, log_level="info",
                timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
