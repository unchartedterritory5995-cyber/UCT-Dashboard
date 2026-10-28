"""Trade Exchange News — measure webhook availability across a STAGING receiver deploy.

Railway documents that the old deployment gets SIGTERM once the new one is
healthy, with configurable overlap and draining — it does NOT document how its
edge routes requests during that window. This measures it instead of assuming:

    TXN_PROBE_URL_FILE=<file holding the staging hook URL>  \\
      python tools/txn_deploy_probe.py --rate 5 --seconds 240 --out probe.json
    # ...trigger `railway redeploy -s trade-exchange-news-receiver` (STAGING) meanwhile

Sends SYNTHETIC webhooks (``SYNTHETIC deploy-probe <n>``) at a fixed rate and
records every status and latency. Summary: sent, 2xx, non-2xx by status,
transport errors, and the longest run of consecutive non-2xx (the effective
outage). The URL is read from a FILE so the credential never sits in a command
line or shell history, and it is never printed.

⛔ STAGING ONLY. Refuses any URL on uctintelligence.com, and refuses to run
without --i-confirm-staging. Never point this at production.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import time
from urllib.parse import urlsplit

import httpx


def summarize(results: list[dict]) -> dict:
    ok = [r for r in results if r.get("status") and 200 <= r["status"] < 300]
    by_status: dict[str, int] = {}
    longest = run = 0
    run_start = longest_span = None
    for r in results:
        good = bool(r.get("status") and 200 <= r["status"] < 300)
        if not good:
            key = str(r.get("status") or r.get("error"))
            by_status[key] = by_status.get(key, 0) + 1
            if run == 0:
                run_start = r["t"]
            run += 1
            if run > longest:
                longest, longest_span = run, (run_start, r["t"])
        else:
            run = 0
    lat = sorted(r["ms"] for r in ok)
    return {"sent": len(results), "ok": len(ok), "failed_by_status": by_status,
            "longest_failure_run": longest,
            "longest_failure_seconds": round(longest_span[1] - longest_span[0], 2) if longest_span else 0.0,
            "latency_ms_p50": lat[len(lat) // 2] if lat else None,
            "latency_ms_p99": lat[int(len(lat) * 0.99) - 1] if len(lat) >= 100 else None}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rate", type=float, default=5.0, help="requests per second")
    ap.add_argument("--seconds", type=float, default=240.0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--i-confirm-staging", action="store_true")
    args = ap.parse_args(argv)
    if not args.i_confirm_staging:
        print("refusing: pass --i-confirm-staging (this sends synthetic headlines)")
        return 2
    path = os.environ.get("TXN_PROBE_URL_FILE")
    if not path:
        print("refusing: set TXN_PROBE_URL_FILE to a file holding the STAGING hook URL")
        return 2
    url = pathlib.Path(path).read_text(encoding="utf-8").strip()
    host = urlsplit(url).hostname or ""
    if host.endswith("uctintelligence.com"):
        print("refusing: production domain")
        return 2
    results = []
    gap = 1.0 / args.rate
    t0 = time.monotonic()
    n = 0
    with httpx.Client(timeout=10, headers={"User-Agent": "uct-txn-deploy-probe/1"}) as c:
        while time.monotonic() - t0 < args.seconds:
            n += 1
            start = time.monotonic()
            rec = {"n": n, "t": round(start - t0, 3)}
            try:
                r = c.post(url, json={"source": "TXNews1", "content": f"SYNTHETIC deploy-probe {n}"})
                rec["status"] = r.status_code
            except httpx.HTTPError as e:
                rec["error"] = type(e).__name__
            rec["ms"] = round((time.monotonic() - start) * 1000, 1)
            results.append(rec)
            time.sleep(max(0.0, gap - (time.monotonic() - start)))
    summary = summarize(results)
    pathlib.Path(args.out).write_text(json.dumps({"summary": summary, "results": results}, indent=1))
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
