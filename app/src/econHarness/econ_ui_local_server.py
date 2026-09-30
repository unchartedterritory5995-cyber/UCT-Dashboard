"""Dev-only: the Phase 2 economic UI acceptance server (LOCAL ONLY, never production).

Mounts the REAL routers the member's browser talks to for the economic UI:
  * `api.routers.econ`          -- /api/econ/catalog, /api/econ/series/*, /api/econ/status
                                   (the real ECON_ENABLED router flag + the real
                                   `require_bars_access` entitlement gate)
  * `api.routers.ticker_search` -- /api/ticker-search (the real econ merge + gate)
on a bare FastAPI app, plus three dev stubs the chart page needs and nothing else:
  * /api/auth/me                -- the harness member for the app's AuthProvider
  * /api/bars/<SYM>, /api/bars-history/<SYM>
                                -- a SYNTHETIC seeded random-walk host (NOT market
                                   data) for the equity overlay scenarios. `ECON:*`
                                   answers the same explicit 404 the real bars router
                                   gives ("economic series are served by /api/econ").

ENTITLEMENT, FOR REAL, WITHOUT A REAL ACCOUNT: `validate_session` / `get_user_plan`
are replaced (in `bars_auth` AND `ticker_search`, which binds its own copies) by a
three-member table keyed on the `uct_session` cookie value:
    local-paid -> plan pro (entitled)   local-free -> plan free (403)   absent -> 401
`meets_plan_gate` itself is untouched, so 401/403/200 are the product's own answers.

⛔ LOCAL ONLY: binds 127.0.0.1; ECON_SERVING_SOURCE=local over a local artifact dir;
every R2 / provider credential is blanked before import; no scheduler, no warmers.

    PYTHONPATH=<repo> ECON_ARTIFACT_DIR='C:\\w\\econ1-data\\artifacts' \\
      python app/src/econHarness/econ_ui_local_server.py --port 8792 [--dark]

`--dark` leaves ECON_ENABLED unset (the production default): every econ route 404s
and /api/ticker-search never enters its econ block.
"""
from __future__ import annotations

import argparse
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone

_CREDS = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "R2_ACCESS_KEY_ID",
          "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET", "R2_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN",
          "CLOUDFLARE_ACCOUNT_ID", "BLS_API_KEY", "BEA_API_KEY", "CENSUS_API_KEY", "EIA_API_KEY",
          "DATABASE_URL", "PUSH_SECRET", "MASSIVE_API_KEY")

MEMBERS = {
    "local-paid": {"id": "harness-paid", "email": "paid@harness.local", "role": "member", "plan": "pro"},
    "local-free": {"id": "harness-free", "email": "free@harness.local", "role": "member", "plan": "free"},
}


def _validate(token):
    m = MEMBERS.get(token) if isinstance(token, str) else None
    return dict(m) if m else None


def _plan(uid):
    for m in MEMBERS.values():
        if m["id"] == uid:
            return m["plan"]
    return "free"


# ─── the synthetic host (seeded random walk, NOT market data) ────────────────

def _rng(seed):
    s = seed

    def nxt():
        nonlocal s
        s = (s * 1103515245 + 12345) % 2147483648
        return s / 2147483648
    return nxt


def _daily(sym, through):
    rnd = _rng(20260929 + sum(map(ord, sym)))
    out, px = [], 470.0
    d = date(2019, 1, 2)
    while d <= through:
        if d.weekday() < 5:
            o = px
            c = round(o * (1 + (rnd() - 0.48) * 0.02), 2)
            h = round(max(o, c) * (1 + rnd() * 0.006), 2)
            lo = round(min(o, c) * (1 - rnd() * 0.006), 2)
            out.append({"t": d.isoformat(), "o": round(o, 2), "h": h, "l": lo, "c": c, "v": 40_000_000})
            px = c
        d += timedelta(days=1)
    return out


def _bucket(daily, tf):
    out = []
    for b in daily:
        d = date.fromisoformat(b["t"])
        key = (d - timedelta(days=d.weekday())).isoformat() if tf == "W" else d.replace(day=1).isoformat()
        if out and out[-1]["t"] == key:
            w = out[-1]
            w["h"] = max(w["h"], b["h"]); w["l"] = min(w["l"], b["l"]); w["c"] = b["c"]; w["v"] += b["v"]
        else:
            out.append({**b, "t": key})
    return out


def _et_offset_hours(d):
    # US DST: second Sunday of March .. first Sunday of November
    y = d.year
    mar = date(y, 3, 8); mar += timedelta(days=(6 - mar.weekday()) % 7)
    nov = date(y, 11, 1); nov += timedelta(days=(6 - nov.weekday()) % 7)
    return 4 if mar <= d < nov else 5


def _intraday(sym, daily, tf_min, sessions):
    rnd = _rng(777 + sum(map(ord, sym)))
    out = []
    for b in daily[-sessions:]:
        d = date.fromisoformat(b["t"])
        start = int(datetime(d.year, d.month, d.day, 4 + _et_offset_hours(d), 0, tzinfo=timezone.utc).timestamp())
        p = b["o"]
        for k in range(int(16 * 60 / tf_min)):          # 04:00-20:00 ET
            o = p
            c = round(o * (1 + (rnd() - 0.5) * 0.002), 2)
            out.append({"t": start + k * tf_min * 60, "o": o, "h": max(o, c), "l": min(o, c), "c": c, "v": 200_000})
            p = c
    return out


def host_bars(sym, tf, n, through):
    daily = _daily(sym, through)
    if tf in ("W", "M"):
        bars = _bucket(daily, tf)
    elif tf in ("1", "5", "15", "30", "60"):
        bars = _intraday(sym, daily, int(tf), 6)
    else:
        bars = daily
    return bars[-n:] if n and n > 0 else bars


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8792)
    ap.add_argument("--dark", action="store_true", help="leave ECON_ENABLED unset (production default)")
    ap.add_argument("--through", default=None, help="last synthetic host session (YYYY-MM-DD)")
    args = ap.parse_args()

    if not os.environ.get("ECON_ARTIFACT_DIR"):
        print("ECON_ARTIFACT_DIR is required (local artifacts only)", file=sys.stderr)
        return 2
    for k in _CREDS:
        os.environ.pop(k, None)
    if args.dark:
        os.environ.pop("ECON_ENABLED", None)
    else:
        os.environ["ECON_ENABLED"] = "1"
    os.environ["ECON_SERVING_SOURCE"] = "local"
    os.environ["ECON_PUBLISH_R2"] = "0"
    os.environ.setdefault("ECON_CACHE_TTL", "5")
    through = date.fromisoformat(args.through) if args.through else date.today()

    import uvicorn
    from fastapi import Cookie, FastAPI, Query
    from fastapi.responses import JSONResponse

    import api.bars_auth as bars_auth
    import api.routers.ticker_search as ticker_search
    from api.routers import econ

    for mod in (bars_auth, ticker_search):
        mod.validate_session = _validate
        mod.get_user_plan = _plan

    app = FastAPI(title="econ-ui-harness (local, real econ + search routers)")
    app.include_router(econ.router)
    app.include_router(ticker_search.router)

    @app.get("/api/auth/me")
    def me(uct_session: str | None = Cookie(None)):
        u = _validate(uct_session)
        if not u:
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        return {"user": {k: u[k] for k in ("id", "email", "role")}, "plan": u["plan"]}

    def _bars(sym: str, tf: str, bars: int):
        s = (sym or "").upper()
        if s.startswith("ECON:"):
            return JSONResponse({"error": "economic series are served by /api/econ"}, status_code=404)
        if s not in ("SPY", "QQQ", "AAPL"):
            return JSONResponse({"ticker": s, "tf": tf, "bars": [], "no_data": True}, status_code=200)
        return {"ticker": s, "tf": tf, "bars": host_bars(s, tf, bars, through), "delta": False,
                "_provenance": "SYNTHETIC seeded random walk (NOT market data)"}

    @app.get("/api/bars/{sym}")
    def bars(sym: str, tf: str = Query("D"), bars: int = Query(600)):
        return _bars(sym, tf, bars)

    @app.get("/api/bars-history/{sym}")
    def bars_history(sym: str, tf: str = Query("D"), bars: int = Query(5000)):
        return _bars(sym, tf, bars)

    print(f"econ-ui-harness on 127.0.0.1:{args.port} ECON_ENABLED={os.environ.get('ECON_ENABLED')}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
