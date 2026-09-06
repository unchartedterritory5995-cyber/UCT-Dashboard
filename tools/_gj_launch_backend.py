"""One-shot isolated backend launcher for Golden Journey #1-3 automation.

Imports the repo-root conftest.py FIRST (as a plain module, not via pytest) so
its AST-derived env-pin census redirects every *_DB_PATH/*_DIR var to an
isolated temp sandbox BEFORE api.main is ever imported -- the same mechanism
the test suite relies on, applied here to a live uvicorn process instead of a
pytest run, so this script can never write into the real C:\\data.

Usage: python tools/_gj_launch_backend.py --port 18734
"""
import argparse
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Heavy jobs off, mirroring tools/mobile_audit.py's documented CLAUDE.md loop.
os.environ.setdefault("WORKER_ENABLED", "0")
os.environ.setdefault("CATALYST_ENGINE_ENABLED", "0")
os.environ.setdefault("TWITTERAPI_IO_ENABLED", "0")
os.environ.setdefault("BARS_PREWARM_DISABLED", "1")
os.environ.setdefault("TICKER_NAMES_PREWARM_DISABLED", "1")
os.environ.setdefault("COMPASS_AUTOMATION_ENABLED", "0")
os.environ.setdefault("AWARENESS_ENGINE_ENABLED", "0")
os.environ.setdefault("BROKER_SYNC_ENABLED", "0")
os.environ.setdefault("DESK_DAILY_SESSION_ENABLED", "0")
os.environ.setdefault("SCAN_SWEEP_ENABLED", "0")
os.environ.setdefault("ADMIN_EMAILS", "gj_automation@local.dev")

import conftest  # noqa: E402  side effect: redirects every *_DB_PATH/*_DIR to an isolated sandbox

print(f"[gj-backend] isolated sandbox: {os.environ.get('AUTH_DB_PATH')}", flush=True)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18734)
    args = ap.parse_args()

    import uvicorn

    uvicorn.run("api.main:app", host="127.0.0.1", port=args.port, log_level="warning")
