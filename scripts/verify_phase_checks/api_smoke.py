"""Hit the live /api/patterns/* endpoints on Railway and verify response shapes."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


_BASE = os.environ.get("UCT_API_BASE", "https://uctintelligence.com")


def _get(path: str) -> tuple[int, dict | str]:
    req = urllib.request.Request(f"{_BASE}{path}", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode("utf-8")
            try:
                return r.status, json.loads(body)
            except json.JSONDecodeError:
                return r.status, body
    except Exception as e:
        return 0, str(e)


def _post(path: str, payload: dict) -> tuple[int, dict | str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{_BASE}{path}", data=data, method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode("utf-8")
            return r.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body
    except Exception as e:
        return 0, str(e)


def run(skip: bool = False) -> dict:
    if skip:
        return {"status": "WARN", "summary": "skipped (--skip-api)", "details": ""}

    checks = []
    fails = 0

    code, body = _get("/api/patterns/types")
    if code == 200 and isinstance(body, dict) and "patterns" in body:
        checks.append(("GET /api/patterns/types", "PASS", f"{len(body['patterns'])} types"))
    else:
        checks.append(("GET /api/patterns/types", "FAIL", f"code={code} body={str(body)[:80]}"))
        fails += 1

    code, body = _get("/api/patterns/AAPL?tf=D")
    if code == 200 and isinstance(body, dict) and "detections" in body and "count" in body:
        checks.append(("GET /api/patterns/AAPL", "PASS", f"{body['count']} detections"))
    else:
        checks.append(("GET /api/patterns/AAPL", "FAIL", f"code={code} body={str(body)[:80]}"))
        fails += 1

    code, body = _post("/api/patterns/nonexistent-test-id/feedback",
                       {"rating": "garbage", "user_id": "test"})
    if code == 400:
        checks.append(("POST feedback (bad rating)", "PASS", "rejected with 400"))
    else:
        checks.append(("POST feedback (bad rating)", "FAIL", f"expected 400, got {code}"))
        fails += 1

    lines = ["| Endpoint | Status | Detail |", "|---|---|---|"]
    for ep, st, detail in checks:
        lines.append(f"| {ep} | {st} | {detail} |")

    status = "PASS" if fails == 0 else "FAIL"
    summary = f"{len(checks) - fails}/{len(checks)} endpoints OK"
    return {"status": status, "summary": summary, "details": "\n".join(lines)}
