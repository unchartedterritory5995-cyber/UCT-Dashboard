"""Wave O6 §25 — is recalling a review fast enough to live in the search box?

BOUNDED. Three measurements, one question: does a member with a real review
history wait when they search? Review search is the one genuinely NEW read
O6 adds to a high-frequency surface, and it deliberately has NO index — it
scans. That is a decision this file has to justify with a number rather than
an argument.

⛔⛔ CALIBRATE FIRST. Wave N's first performance run reported ~2050ms for every
operation — a capture, a read returning zero rows, and a write, all within 30ms
of each other — because `localhost` cost 2s per request on this machine. AN
INVARIANT MEASUREMENT ACROSS DIFFERENT OPERATIONS IS AN INSTRUMENT DEFECT. This
measures /api/health first and refuses to publish product numbers if that floor
is large.

⛔ AND IT MEASURES A MISS AS WELL AS A HIT. A term-AND scan is fastest when it
matches everything and slowest when it matches nothing, because nothing can
stop early. Publishing only the hit would be measuring the friendly case.

    python tools/local_backend_sandbox.py --port 8077
    python tools/wave_o6_perf.py --base http://127.0.0.1:8077
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

OUT_DIR = pathlib.Path(__file__).parent / "wave_o6_perf_out"

# A corpus shaped like a member several years into using this: a dozen theses,
# each reviewed repeatedly. The scan cost is a function of the REVIEW count, so
# that is the axis this varies.
THESES = 12
REVIEWS_PER_THESIS = 8

BUDGET_MS = {"review_search_hit": 400, "review_search_miss": 400,
             "note_review_panel": 400, "research_home": 800}
_FLOOR_CEILING_MS = 50

TOKEN = "zq" + uuid.uuid4().hex[:8]
RARE = f"anorthosite{TOKEN}"      # in exactly one review
NEVER = f"peridotite{TOKEN}"      # in none — the worst case for a term-AND scan


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

    print(f"seeding {THESES} theses x {REVIEWS_PER_THESIS} reviews ({TOKEN}) …",
          flush=True)
    ids = []
    for i in range(THESES):
        _, made, _ = c.call("POST", "/api/j2/notes", {
            "title": f"NVDA thesis {TOKEN}-{i}", "ticker": "NVDA", "tags": ["thesis"],
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
        ids.append((made.get("note") or made)["id"])

    total = 0
    for n, nid in enumerate(ids):
        for j in range(REVIEWS_PER_THESIS):
            _, opened, _ = c.call("POST", f"/api/j2/notes/{nid}/reviews", {})
            rid = opened["review"]["id"]
            # One review in the whole corpus carries the rare term. Everything
            # else shares vocabulary, so the scan cannot shortcut its way to a
            # small candidate set.
            body = (f"Review {j} of thesis {n}: margins, pricing and the "
                    f"datacenter build-out all still look the way I thought.")
            if n == THESES - 1 and j == REVIEWS_PER_THESIS - 1:
                body = f"{RARE}: {body}"
            c.call("POST", f"/api/j2/reviews/{rid}/complete",
                   {"outcome": "no_change", "memberNote": body})
            total += 1
        print(f"  … thesis {n + 1}/{THESES}", flush=True)

    def timed(label, fn, n=12):
        xs, last = [], None
        for _ in range(n):
            st, body, ms = fn()
            xs.append(ms)
            last = (st, body)
        xs.sort()
        return {"label": label, "n": n,
                "p50": round(statistics.median(xs), 1),
                "p95": round(xs[int(0.95 * (n - 1))], 1),
                "max": round(xs[-1], 1), "status": last[0],
                "rows": len((last[1] or {}).get("results", []))
                        if isinstance(last[1], dict) else None}

    results = [
        timed("review_search_hit",
              lambda: c.call("GET", f"/api/j2/reviews/search?q={RARE}")),
        timed("review_search_miss",
              lambda: c.call("GET", f"/api/j2/reviews/search?q={NEVER}")),
        timed("note_review_panel",
              lambda: c.call("GET", f"/api/j2/notes/{ids[0]}/reviews")),
        timed("research_home",
              lambda: c.call("GET", "/api/j2/notebook/home")),
    ]

    findings = [f"{r['label']}: p95 {r['p95']}ms over the {BUDGET_MS[r['label']]}ms budget"
                for r in results
                if r["label"] in BUDGET_MS and r["p95"] > BUDGET_MS[r["label"]]]
    # ⛔ AN INVARIANT MEASUREMENT IS A BROKEN INSTRUMENT. A hit and a miss over
    # the same corpus do different work; if they came back identical, the
    # numbers are the transport, not the query.
    hit, miss = results[0]["p50"], results[1]["p50"]
    if hit and miss and abs(hit - miss) < 0.5 and hit > 20:
        findings.append(
            f"a search HIT and a search MISS measured identically ({hit}ms) — "
            f"that is an instrument reading, not a product one")
    # And the rail on the rail: the hit must actually have found something.
    if results[0]["rows"] != 1:
        findings.append(
            f"the 'hit' case returned {results[0]['rows']} rows — it is not "
            f"measuring a search that found anything")
    if results[1]["rows"] != 0:
        findings.append(
            f"the 'miss' case returned {results[1]['rows']} rows — it is not "
            f"measuring the worst case")

    corpus = {"theses": THESES, "reviews_per_thesis": REVIEWS_PER_THESIS,
              "total_reviews": total}
    report = {"transport_floor_ms": floor_p50, "corpus": corpus,
              "results": results, "findings": findings}
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2),
                                         encoding="utf-8")
    print(f"corpus: {corpus}")
    for r in results:
        print(f"  {r['label']:<20} p50 {r['p50']:>7.1f}ms  p95 {r['p95']:>7.1f}ms  "
              f"rows={r['rows']}")
    if findings:
        print("FINDINGS:")
        for f in findings:
            print(f"  [X] {f}")
        return 1
    print("Wave O6 recall performance: within budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
