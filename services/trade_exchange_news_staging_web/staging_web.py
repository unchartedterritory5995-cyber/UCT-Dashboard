"""Trade Exchange News STAGING web (Checkpoint D2) -- the REAL web half, isolated.

Mounts the real ``api.routers.trade_exchange_news`` router and starts its real
pipeline + reconciler (``start_background``) on its own volume. The only thing
replaced is the admin check (see staging_auth.py). It is NOT the UCT web
service and shares nothing with it: its own Railway project, its own volume,
its own R2 bucket.

Refuses to start unless it is synthetic-only, so it can never hold a real
Trade Exchange headline:
  * TXN_SYNTHETIC_ONLY=1 is required;
  * TXN_STORAGE_PERMISSION_CONFIRMED must NOT be set.
"""
from __future__ import annotations

import contextlib
import os
import socket

import uvicorn
from fastapi import FastAPI

from api.routers import trade_exchange_news as route
from api.services.trade_exchange_news import config, pipeline


def refusal(env=os.environ) -> str | None:
    if env.get("TXN_SYNTHETIC_ONLY", "").strip() != "1":
        return "staging web requires TXN_SYNTHETIC_ONLY=1"
    if env.get("TXN_STORAGE_PERMISSION_CONFIRMED", "").strip():
        return "staging web must not carry TXN_STORAGE_PERMISSION_CONFIRMED"
    if not env.get("TXN_STAGING_READ_TOKEN_SHA256", "").strip():
        return "staging web requires TXN_STAGING_READ_TOKEN_SHA256"
    return None


@contextlib.asynccontextmanager
async def lifespan(_app):
    if config.enabled():
        await route.start_background()
    try:
        yield
    finally:
        route.stop_background()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(route.router)


@app.get("/health")
def health():
    """Healthy once the pipeline is up and its boot gate is open -- the same
    readiness a real web deploy would need before it took pushes."""
    pipe = pipeline.get()
    ready = bool(config.enabled() and pipe is not None and pipe.ready.is_set())
    from fastapi.responses import JSONResponse
    return JSONResponse({"ok": ready, "synthetic_only": config.synthetic_only()},
                        status_code=200 if ready else 503)


def main() -> None:
    why = refusal()
    if why:
        raise SystemExit(f"[txn-staging] {why}")
    port = int(os.environ.get("PORT") or 8080)
    sock = socket.create_server(("::", port), family=socket.AF_INET6, dualstack_ipv6=True)
    cfg = uvicorn.Config(app, access_log=False, proxy_headers=True, forwarded_allow_ips="*",
                         timeout_graceful_shutdown=5)
    uvicorn.Server(cfg).run(sockets=[sock])


if __name__ == "__main__":
    main()
