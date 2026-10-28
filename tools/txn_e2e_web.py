"""A minimal LOCAL "web" process for the Trade Exchange News synthetic end-to-end run.

Mounts the REAL ``api.routers.trade_exchange_news`` router and starts its REAL
pipeline + reconciler in the lifespan (exactly ``start_background``), behind a
stub admin session — the one thing replaced, because this process has no auth
store. Everything else a browser asks for gets a small synthetic answer.

⛔ SYNTHETIC AND SANDBOXED. Started only by tools/txn_local_e2e.py, which points
DATA_DIR / TXN_DB_PATH / TXN_JOURNAL_DIR at a temp folder. As a second lock, any
open()/sqlite3.connect() under C:\\data (the owner's LIVE files on this machine)
raises before it happens.

    python tools/txn_e2e_web.py <port>
"""
from __future__ import annotations

import builtins
import contextlib
import os
import pathlib
import sqlite3
import sys

_LIVE = pathlib.Path("C:/data").resolve()


def _guard(path) -> None:
    try:
        p = pathlib.Path(os.fspath(path)).resolve()
    except (TypeError, ValueError):
        return
    if p == _LIVE or _LIVE in p.parents:
        raise PermissionError(f"txn_e2e_web refuses to touch the live data root: {p}")


_open, _connect = builtins.open, sqlite3.connect
builtins.open = lambda f, *a, **k: (_guard(f) if isinstance(f, (str, os.PathLike)) else None) or _open(f, *a, **k)
sqlite3.connect = lambda db, *a, **k: (_guard(db) if isinstance(db, (str, os.PathLike)) and db != ":memory:" else None) or _connect(db, *a, **k)

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

# The shared-root census (tests/test_tools_pin_the_root.py): leaves the harness's own
# temp DATA_DIR / TXN_DB_PATH / TXN_JOURNAL_DIR alone, redirects anything else.
import conftest  # noqa: E402,F401  side effect: redirects every *_DB_PATH/*_DIR to an isolated sandbox

import uvicorn  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from api.middleware import auth_middleware  # noqa: E402
from api.routers import trade_exchange_news as route  # noqa: E402

ADMIN = {"id": "e2e-admin", "email": "e2e@local", "role": "admin", "display_name": "E2E"}


@contextlib.asynccontextmanager
async def lifespan(_app):
    await route.start_background()
    try:
        yield
    finally:
        route.stop_background()


app = FastAPI(lifespan=lifespan)
app.include_router(route.router)
app.dependency_overrides[auth_middleware.get_current_user] = lambda: ADMIN


@app.get("/api/auth/me")
def me():
    return {"user": ADMIN, "plan": "pro", "subscription": None, "trial": None}


@app.get("/api/auth/preferences")
def prefs():
    return {"theme": "dark"}


@app.get("/api/watchlists")
@app.get("/api/watchlists/prebuilt")
def lists():
    return []


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE"])
def anything_else(rest: str):
    return JSONResponse({}, status_code=200)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]), log_level="warning", access_log=False)
