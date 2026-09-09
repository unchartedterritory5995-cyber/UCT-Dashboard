"""Wave O §43 — is the review loop fast enough to live in Research Home?

⛔ BOUNDED. Four measurements, one question: does a member with a real research
corpus wait? Research Home is the highest-frequency surface in the Notebook and
it now does extra work per row, so this measures the surface, not a service call.

⛔⛔ CALIBRATE FIRST. Wave N's first performance run reported ~2050ms for every
operation — a capture, a read returning zero rows, and a write, all within 30ms
of each other — because `localhost` cost 2s per request on this machine. AN
INVARIANT MEASUREMENT ACROSS DIFFERENT OPERATIONS IS AN INSTRUMENT DEFECT. This
measures /api/health first and refuses to publish product numbers if that floor
is large.

    python tools/local_backend_sandbox.py --port 8077
    python tools/wave_o_perf.py --base http://127.0.0.1:8077
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import pathlib
import statistics
import sys
import time
import urllib.error
import urllib.request
import uuid

OUT_DIR = pathlib.Path(__file__).parent / "wave_o_perf_out"

# A corpus shaped like real research: several theses, and one of them heavily
# evidenced — because the per-row work Research Home now does scales with the
# EVIDENCE on each thesis, not with the number of theses.
THESES = 8
EVIDENCE_PER_THESIS = 25
HEAVY_THESIS_EVIDENCE = 60

BUDGET_MS = {"research_home": 800, "open_review": 400,
             "changes_since": 400, "complete_review": 600}
_FLOOR_CEILING_MS = 50


class Client:
    def __init__(self, base: str) -> None:
        self.base = base
        self.op = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method: str, path: str, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.base + path, data=data,
            headers={"Content-Type": "application/json"}, method=method)
        t0 = time.perf_counter()
        try:
            resp = self.op.open(req)
            payload = json.loads(resp.read().decode() or "{}")
            status = resp.status
        except urllib.error.HTTPError as e:
            payload = {"detail": e.read().decode()[:200]}
            status = e.code
        return status, payload, (time.perf_counter() - t0) * 1000


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8077")
    ap.add_argument("--email", default="mobtest@local.dev")
    ap.add_argument("--password", default="LocalTest2026!")
    args = ap.parse_args()

    OUT_DIR.mkdir(exist_ok=True)
    c = Client(args.base)

    floor = sorted(c.call("GET", "/api/health")[2] for _ in range(8))
    floor_p50 = round(statistics.median(floor), 1)
    print(f"transport floor (/api/health): p50 {floor_p50}ms", flush=True)
    if floor_p50 > _FLOOR_CEILING_MS:
        msg = (f"HARNESS, NOT PRODUCT: transport floor {floor_p50}ms — every "
               f"number below it would be this harness. Use 127.0.0.1, not localhost.")
        (OUT_DIR / "report.json").write_text(
            json.dumps({"findings": [msg], "transport_floor_ms": floor_p50}, indent=2),
            encoding="utf-8")
        print(msg, file=sys.stderr)
        return 2

    if c.call("POST", "/api/auth/login",
              {"email": args.email, "password": args.password})[0] != 200:
        print("login failed — start the sandbox first", file=sys.stderr)
        return 2

    tok = "zq" + uuid.uuid4().hex[:8]
    print(f"seeding {THESES} theses ({tok}) …", flush=True)
    yesterday = time.strftime("%Y-%m-%d",
                              time.gmtime(time.time() - 86400))
    ids = []
    for i in range(THESES):
        _, made, _ = c.call("POST", "/api/j2/notes", {
            "title": f"NVDA thesis {tok}-{i}", "ticker": "NVDA", "tags": ["thesis"],
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
        nid = (made.get("note") or made)["id"]
        # Every one is DUE, so Research Home's section is genuinely full.
        c.call("PUT", f"/api/j2/notes/{nid}",
               {"properties": {"builtin:review_date": yesterday}})
        ids.append(nid)

    heavy = ids[0]
    for nid in ids:
        n = HEAVY_THESIS_EVIDENCE if nid == heavy else EVIDENCE_PER_THESIS
        for j in range(n):
            _, cap, _ = c.call("POST", "/api/j2/capture", {
                "tier": "passage",
                "url": f"https://www.reuters.com/{uuid.uuid4().hex[:8]}",
                "title": "Reuters: NVDA margins",
                "passage": f"{tok} passage {j}: margins normalise.",
                "annotation": "my read", "noteId": nid})
            c.call("POST", f"/api/j2/notes/{nid}/evidence", {
                "targetType": "document_excerpt", "targetId": cap.get("excerptId"),
                "stance": "opposes" if j % 3 == 0 else "supports"})
        print(f"  … {nid[:8]} filled with {n}", flush=True)

    # One completed review on the heavy thesis, so the change calculation has an
    # anchor and actually does its work.
    _, opened, _ = c.call("POST", f"/api/j2/notes/{heavy}/reviews", {})
    c.call("POST", f"/api/j2/reviews/{opened['review']['id']}/complete",
           {"outcome": "no_change", "memberNote": "baseline"})

    def timed(label, fn, n=10):
        xs = []
        last = None
        for _ in range(n):
            st, body, ms = fn()
            xs.append(ms)
            last = (st, body)
        xs.sort()
        return {"label": label, "n": n,
                "p50": round(statistics.median(xs), 1),
                "p95": round(xs[int(0.95 * (n - 1))], 1),
                "max": round(xs[-1], 1), "status": last[0]}

    results = [
        timed("research_home", lambda: c.call("GET", "/api/j2/notebook/home")),
        timed("changes_since", lambda: c.call("GET", f"/api/j2/notes/{heavy}/reviews")),
        timed("open_review", lambda: c.call("POST", f"/api/j2/notes/{heavy}/reviews", {})),
    ]

    # Completing is a write, measured on fresh drafts so the duplicate guard
    # cannot turn this into a timing of the refusal path.
    times = []
    for _ in range(5):
        _, o, _ = c.call("POST", f"/api/j2/notes/{ids[1]}/reviews", {})
        st, _b, ms = c.call("POST", f"/api/j2/reviews/{o['review']['id']}/complete",
                            {"outcome": "no_change"})
        if st == 200:
            times.append(ms)
    if times:
        times.sort()
        results.append({"label": "complete_review", "n": len(times),
                        "p50": round(statistics.median(times), 1),
                        "p95": round(times[-1], 1), "max": round(times[-1], 1),
                        "status": 200})

    findings = [f"{r['label']}: p95 {r['p95']}ms over the {BUDGET_MS[r['label']]}ms budget"
                for r in results
                if r["label"] in BUDGET_MS and r["p95"] > BUDGET_MS[r["label"]]]

    corpus = {"theses": THESES, "evidence_per_thesis": EVIDENCE_PER_THESIS,
              "heavy_thesis_evidence": HEAVY_THESIS_EVIDENCE,
              "total_evidence": (THESES - 1) * EVIDENCE_PER_THESIS + HEAVY_THESIS_EVIDENCE}
    report = {"transport_floor_ms": floor_p50, "corpus": corpus,
              "results": results, "findings": findings}
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"corpus: {corpus}")
    for r in results:
        print(f"  {r['label']:<16} p50 {r['p50']:>8.1f}ms  p95 {r['p95']:>8.1f}ms")
    if findings:
        print("FINDINGS:")
        for f in findings:
            print(f"  [X] {f}")
        return 1
    print("Wave O review performance: within budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
