"""Track 4, unit E2 (2026-11-22): record what PRODUCTION's events door answers for each symbol a capture reads, for
the vendor harness to grade the engine's event reads on (`ourSide.js::otherSymbolSupply`, `EVENTS_KEY`).

Our side of an event read is graded on the events OUR SERVER serves (E1, `GET /api/pine/events/<symbol>`), never on
TradingView's, exactly as another symbol's bars are (RS RATING L8). Those events are licensed vendor data (earnings,
dividends and splits; licensing register T-35/T-36, T-07: member display only), so a record NEVER enters the public
repository: it is written to the HELD supply directory (`ourSide.js::supplyHeldDir`,
`%LOCALAPPDATA%/uct-vendor-batch/supply-held`), and a graded row names it `supplyHeld`.

    python tools/vendor_harness/record_event_supply.py --base https://uctintelligence.com --captures <run dir>
        reads production as the operator's synthetic admin (SMOKE_EMAIL / SMOKE_PASSWORD from the operator's own
        environment, never printed, never written), waiting out `pending` (202), and writes one held record per
        capture: `<capture id>.json` = {"schema": "uct.harness-supply/v1", "capture", "events": {"doc", "source",
        "servedBy", "recordedAtUTC"}}. Nothing is printed but counts.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import tempfile
import time

SCHEMA = "uct.harness-supply/v1"


def held_dir() -> pathlib.Path:
    env = os.environ.get("UCT_HARNESS_SUPPLY_HELD")
    if env:
        return pathlib.Path(env).resolve()
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP") or tempfile.gettempdir()
    return pathlib.Path(base) / "uct-vendor-batch" / "supply-held"


def _write_atomic(path: pathlib.Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, path)


def _captures(run: str) -> list[tuple[str, str]]:
    """`(capture id, plain symbol)` for every capture in a run directory (its `captures/` folder, or itself)."""
    d = pathlib.Path(run)
    if (d / "captures").is_dir():
        d = d / "captures"
    out = []
    for f in sorted(d.glob("*.json")):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(doc, dict):
            continue
        sym = doc.get("symbol")
        if isinstance(sym, dict):   # a capture's symbol block (`tv_capture.js`): its plain name
            sym = sym.get("name") or sym.get("pro_name") or sym.get("full_name")
        cid = doc.get("id") or f.stem
        if isinstance(sym, str) and sym:
            out.append((cid, sym.split(":")[-1].strip().upper()))
    return out


def read_production(base: str, syms: list[str], wait_s: int = 180) -> dict:
    """Each symbol's answer from production, signed in as the synthetic admin (never printed)."""
    import httpx
    email, password = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
    if not email or not password:
        raise SystemExit("SMOKE_EMAIL / SMOKE_PASSWORD are not set in this environment")
    out = {}
    with httpx.Client(base_url=base, timeout=30, follow_redirects=True) as cl:
        r = cl.post("/api/auth/login", json={"email": email, "password": password})
        if r.status_code != 200:
            raise SystemExit(f"sign-in refused: HTTP {r.status_code}")
        for sym in syms:
            deadline = time.time() + wait_s
            while True:
                r = cl.get(f"/api/pine/events/{sym}")
                if r.status_code == 202 and time.time() < deadline:
                    time.sleep(5)
                    continue
                out[sym] = {"status": r.status_code, "doc": r.json() if r.status_code in (200, 202) else None}
                break
            # our STORE's class for the symbol (Stock / ADR / ETF), the field the chart binds as `securityType`
            # (`StockChart.jsx`: ticker meta's `security_type`): an ETF reads earnings as `na` (E2 ruling 3)
            m = cl.get(f"/api/ticker-meta/{sym}")
            st = (m.json() or {}).get("security_type") if m.status_code == 200 else None
            out[sym]["securityType"] = st if st in ("Stock", "ADR", "ETF") else None
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--base", required=True)
    ap.add_argument("--captures", required=True, nargs="+", help="capture run directories")
    a = ap.parse_args(argv)
    caps = [c for run in a.captures for c in _captures(run)]
    syms = sorted({s for _, s in caps})
    got = read_production(a.base, syms)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    wrote = 0
    for cid, sym in caps:
        ans = got.get(sym) or {}
        if ans.get("status") != 200 or not isinstance(ans.get("doc"), dict):
            print(f"{cid}: production answered HTTP {ans.get('status')} for {sym}; not recorded")
            continue
        rec = {"schema": SCHEMA, "capture": cid,
               **({"store": {"securityType": {"value": ans["securityType"],
                                              "source": f"GET /api/ticker-meta/{sym} (production, `security_type`)"}}}
                  if ans.get("securityType") else {}),
               "events": {"doc": ans["doc"], "symbol": sym,
                          "source": f"GET /api/pine/events/{sym} (E1, api/services/pine_events.py)",
                          "servedBy": f"{a.base} as the synthetic admin", "recordedAtUTC": now}}
        _write_atomic(held_dir() / f"{cid}.json", rec)
        fams = ans["doc"].get("families") or {}
        print(f"{cid}: " + ", ".join(f"{k} {len((v or {}).get('rows') or [])} ({(v or {}).get('state')})" for k, v in sorted(fams.items())))
        wrote += 1
    print(f"recorded {wrote} of {len(caps)} captures into {held_dir()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
