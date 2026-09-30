"""Dev-only: the REAL econ member router, alone, over the LOCAL store's artifacts.

Serves `?src=api` for app/econ-harness.html. It mounts ONLY `api.routers.econ`
(the real routes, the real `ECON_ENABLED` router dependency and the real
`api.bars_auth.require_bars_access` entitlement gate) on a bare FastAPI app --
nothing else from `api.main` (no scheduler, no warmers, no web boot hooks).

Entitlement is exercised for real: the harness authenticates through the
push-secret door `require_bars_access` already accepts (`_push_secret_ok`,
`Authorization: Bearer $PUSH_SECRET`). The secret is a THROWAWAY generated per
run by the caller and passed in `ECON_HARNESS_PUSH_SECRET`; no session cookie is
ever read (the dev proxy injects the header for /api/econ only). A request
without it takes the real member path: `validate_session(None)` -> 401.

⛔ LOCAL ONLY: binds 127.0.0.1, serves `ECON_SERVING_SOURCE=local` from a local
artifact dir, and blanks every R2 / provider credential before any import.

    PYTHONPATH=<repo> ECON_HARNESS_PUSH_SECRET=<random> \
      ECON_ARTIFACT_DIR='C:\\w\\econ1-data\\artifacts' \
      python app/src/econHarness/econ_local_server.py --port 8791
"""
from __future__ import annotations

import argparse
import os
import sys

_CREDS = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "R2_ACCESS_KEY_ID",
          "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET", "R2_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN",
          "CLOUDFLARE_ACCOUNT_ID", "BLS_API_KEY", "BEA_API_KEY", "CENSUS_API_KEY", "EIA_API_KEY",
          "DATABASE_URL")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8791)
    args = ap.parse_args()

    secret = (os.environ.get("ECON_HARNESS_PUSH_SECRET") or "").strip()
    if len(secret) < 16:
        print("ECON_HARNESS_PUSH_SECRET (>=16 chars, throwaway) is required", file=sys.stderr)
        return 2
    if not os.environ.get("ECON_ARTIFACT_DIR"):
        print("ECON_ARTIFACT_DIR is required (local artifacts only)", file=sys.stderr)
        return 2
    for k in _CREDS:
        os.environ.pop(k, None)
    os.environ["PUSH_SECRET"] = secret
    os.environ["ECON_ENABLED"] = "1"
    os.environ["ECON_SERVING_SOURCE"] = "local"
    os.environ["ECON_PUBLISH_R2"] = "0"
    os.environ.setdefault("ECON_CACHE_TTL", "5")

    import uvicorn
    from fastapi import FastAPI

    from api.routers import econ

    app = FastAPI(title="econ-harness (local, router only)")
    app.include_router(econ.router)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
