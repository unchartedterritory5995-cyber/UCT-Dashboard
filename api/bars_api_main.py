"""Dedicated bars-SERVING tier (Path B, 2026-09-02).

⭐ WHY THIS EXISTS. Charts are slow-on-deploy because the WEB (app) pod serves
the live chart data, so every app/partner deploy restarts it and the charts blip
+ cold-start. This entrypoint serves ONLY the chart-data HTTP endpoints
(`/api/bars` + `/api/bars-history`) from a fresh, R2-synced `bars.db`, with NO
warmers, NO market-data socket, and (once its Railway watch paths are narrowed)
its OWN deploy triggers — so app/partner deploys can NEVER restart chart serving.
"Charts stop living on the deployable app server."

It runs the SAME shared serve core as the web pod — `api.routers.bars.serve_bars`
and `serve_bars_history` (extracted in Phase 0) — so the two can never diverge.
Selected by the railway.json dispatcher when `BARS_API_ENABLED=1`.

What it runs (all reused from the web pod's exact code):
  • the R2 newer-wins pull (`data_sync.sync_if_newer_merge` / `sync_with_deltas`)
    — same freshness the web pod gets; the serve-path bg heals fill depth on view.
  • the bars.db WAL checkpointer (keeps reads fast — the 2026-09-02 fix).
  • optionally the barspack web-ingest + hot-set publish (flag-gated; they turn on
    at cutover so they don't double up with the web pod's copies).

⛔ It DELIBERATELY does NOT run: the prewarmer, the R2 UPLOADER, the Massive WS
   consumer, or the reconciliation/audit watchdogs. Those stay on the worker/web.
⛔ NEVER opens a Massive WS (Massive allows ~1 conn/key — a second would kick the
   web pod's live price/candle feed offline).
⛔ Only READS + newer-wins MERGES the local db. NEVER force_resync / replace-pull.

The live developing candle is UNAFFECTED: it streams over a SEPARATE SSE
connection served by the web pod. This tier serves only the one-shot historical
tail; the client stitches the live bar on top by timestamp, origin-agnostically.
"""
import os
import logging
import threading
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Query

_log = logging.getLogger("uvicorn.error")

# Keep in sync with data_sync's own boot-skip probe on the web pod (main.py).
_DATA_DIR = os.environ.get("DATA_DIR", "/data")


def _rss_mb():
    try:
        import resource
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    except Exception:
        return None


# ── R2 freshness: boot pull + periodic newer-wins pull (SAME as the web pod) ──
def _start_r2_sync() -> None:
    from api.services import data_sync

    def _boot_pull():
        # Skip the boot pull when the local db already holds bars (preserve local
        # writes) — mirrors main.py's `_skip_boot_pull`. FORCE_BOOT_R2_PULL=1 overrides.
        try:
            import sqlite3
            skip = False
            p = os.path.join(_DATA_DIR, "bars.db")
            if os.path.exists(p) and os.environ.get("FORCE_BOOT_R2_PULL") != "1":
                c = sqlite3.connect(p, timeout=5)
                try:
                    row = c.execute(
                        "SELECT COUNT(*) FROM (SELECT 1 FROM ohlcv LIMIT 1000)"
                    ).fetchone()
                    if row and int(row[0]) >= 1000:
                        skip = True
                finally:
                    c.close()
            if skip:
                _log.info("[bars-api] boot pull skipped — local bars.db already populated")
                return
            ts = (data_sync.sync_with_deltas() if data_sync.DELTA_ENABLED
                  else data_sync.sync_if_newer())
            _log.info("[bars-api] boot snapshot pull done (%s)", ts)
        except Exception as e:  # noqa: BLE001
            _log.warning("[bars-api] boot pull failed (non-fatal, cold cache): %s", e)

    def _pull_loop():
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
                _log.warning("[bars-api] pull error (non-fatal): %s", e)

    threading.Thread(target=_boot_pull, daemon=True, name="bars-api-boot-pull").start()
    threading.Thread(target=_pull_loop, daemon=True, name="bars-api-s3-pull").start()
    _log.info("[bars-api] R2 newer-wins puller started (%s-min cadence)",
              data_sync.SNAPSHOT_INTERVAL_SECONDS // 60)


def _start_hotset_push() -> None:
    """Publish THIS tier's recorded hot-set to R2 so the worker prewarmer keeps
    prioritising what users actually view. Gated `BARS_API_PUSH_HOTSET` (default
    OFF) — flips ON at cutover, when the web pod's own hot-set push flips OFF, so
    the two never write conflicting hot-sets."""
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
    _log.info("[bars-api] hot-set push loop started (this tier -> R2)")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Ensure the schema exists so serving works even before the first pull lands.
    try:
        from api.services import bars_sqlite
        bars_sqlite.init_db()
    except Exception as e:  # noqa: BLE001
        _log.warning("[bars-api] init_db failed (non-fatal): %s", e)

    _start_r2_sync()

    try:
        from api.services import bars_wal_checkpointer
        bars_wal_checkpointer.start_bars_wal_checkpointer()
    except Exception as e:  # noqa: BLE001
        _log.warning("[bars-api] WAL checkpointer start failed: %s", e)

    # Long-tail depth fill (add-only, missing-series-only) — same as the web pod.
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
    # The shared serve core (Phase 0 extraction) — one implementation, both pods.
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
    port = int(os.environ.get("PORT", "8080"))
    # exec'd as PID 1 by the dispatcher so it receives SIGTERM; graceful shutdown
    # bounded so the (short) bars requests drain fast.
    uvicorn.run(_build_app(), host="0.0.0.0", port=port, log_level="info",
                timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
