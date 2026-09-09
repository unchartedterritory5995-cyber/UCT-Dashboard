"""Wave N §12/§15 — is the evidence picker still usable with real research in it?

⛔ BOUNDED ON PURPOSE. §15 says measure enough to answer one question and do not
build a benchmark suite: does a member with a migrated research corpus wait
seconds for the candidate list because the endpoint materialises everything?

⛔ AND IT MEASURES THE MEMBER'S PATH, not a service call in-process: every
number here is a real HTTP round trip through the running backend, with the
member's own session cookie, because that is what the picker does.

    python tools/local_backend_sandbox.py --port 8077
    python tools/wave_n_perf.py --base http://127.0.0.1:8077

⛔⛔ USE 127.0.0.1, NOT `localhost`. The first run of this harness reported
~2050ms for EVERY operation — a capture, a picker open, a filtered search
returning ZERO rows, and a write — with a spread of about 30ms. An operation
that returns nothing cannot cost the same as one that returns fifty rows and
the same as a write: an INVARIANT MEASUREMENT IS A BROKEN INSTRUMENT. It was
name resolution: `/api/health` measured 2040ms via `localhost` and 1.8ms via
`127.0.0.1` on this machine. Reporting the first set would have invented a
two-second product defect out of the harness's own DNS. `calibrate()` below now
measures that floor every run and REFUSES to publish product numbers when it is
large.

Writes tools/wave_n_perf_out/report.json. Exits non-zero if a budget is missed.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys
import time
import urllib.error
import urllib.request
import uuid

OUT_DIR = pathlib.Path(__file__).parent / "wave_n_perf_out"

# ⛔ THE SHAPE OF A REAL RESEARCH CORPUS, not a uniform stress load: one thesis
# a member has been building for months, several sibling research notes, and a
# couple of real filings. The picker is scoped to ONE note, so the numbers that
# matter are the busy note's — the rest exists to prove the scope holds.
THESIS_CAPTURES = 120
SIBLING_NOTES = 3
SIBLING_CAPTURES = 40
PDF_DOCS = 2
PDF_EXCERPTS = 40

# Budgets. Deliberately generous — this is a "does a member WAIT" gate, not a
# micro-benchmark. A picker that opens in under a third of a second feels
# instant; a second is noticeable; several seconds is the failure §15 names.
BUDGET_MS = {"picker_open": 700, "picker_search": 700, "attach": 900}

#: Above this, the harness is measuring itself. See the module docstring.
_FLOOR_CEILING_MS = 50


class Client:
    def __init__(self, base: str) -> None:
        self.base = base
        import http.cookiejar
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))

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


def _capture(c: Client, note_id: str, i: int, tok: str):
    return c.call("POST", "/api/j2/capture", {
        "tier": "passage",
        "url": f"https://www.reuters.com/markets/{tok}-{i}",
        "title": f"Reuters brief {i}",
        "passage": f"{tok} passage {i}: gross margin normalises toward the mid-70s.",
        "annotation": f"my read {i}", "noteId": note_id})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8077")
    ap.add_argument("--email", default="mobtest@local.dev")
    ap.add_argument("--password", default="LocalTest2026!")
    args = ap.parse_args()

    OUT_DIR.mkdir(exist_ok=True)
    c = Client(args.base)

    # ⛔⛔ CALIBRATE FIRST. `/api/health` does almost nothing, so whatever it
    # costs is the floor under every other number here — transport, name
    # resolution, and the sandbox's own event loop. Publishing product timings
    # without it is how a harness's DNS becomes a two-second product defect.
    floor = []
    for _ in range(8):
        _, _, ms = c.call("GET", "/api/health")
        floor.append(ms)
    floor.sort()
    floor_p50 = round(statistics.median(floor), 1)
    print(f"transport floor (/api/health): p50 {floor_p50}ms", flush=True)
    if floor_p50 > _FLOOR_CEILING_MS:
        report = {"findings": [
            f"HARNESS, NOT PRODUCT: the transport floor is {floor_p50}ms — every "
            f"measurement below it is this harness, not the picker. Use "
            f"--base http://127.0.0.1:PORT rather than localhost."],
            "transport_floor_ms": floor_p50}
        (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2),
                                             encoding="utf-8")
        print(report["findings"][0], file=sys.stderr)
        return 2

    st, _, _ = c.call("POST", "/api/auth/login",
                      {"email": args.email, "password": args.password})
    if st != 200:
        print(f"login failed ({st}) — start the sandbox first", file=sys.stderr)
        return 2

    tok = "zq" + uuid.uuid4().hex[:8]
    print(f"seeding a research corpus ({tok}) …", flush=True)
    st, made, _ = c.call("POST", "/api/j2/notes", {
        "title": f"NVDA thesis {tok}", "ticker": "NVDA", "tags": ["thesis"],
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    thesis_id = (made.get("note") or made)["id"]
    # ⭐ The seed is itself a measurement: capture is a member action too, and
    # a corpus that takes minutes to build tells you what one capture costs.
    capture_ms: list[float] = []
    for i in range(THESIS_CAPTURES):
        _, _, ms = _capture(c, thesis_id, i, tok)
        capture_ms.append(ms)
        if (i + 1) % 20 == 0:
            print(f"  … {i + 1}/{THESIS_CAPTURES} into the thesis "
                  f"(last {ms:.0f}ms)", flush=True)
    for s in range(SIBLING_NOTES):
        st, sib, _ = c.call("POST", "/api/j2/notes", {
            "title": f"NVDA research {tok}-{s}", "ticker": "NVDA",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
        sib_id = (sib.get("note") or sib)["id"]
        for i in range(SIBLING_CAPTURES):
            _, _, ms = _capture(c, sib_id, i, tok)
            capture_ms.append(ms)
        print(f"  … sibling note {s + 1}/{SIBLING_NOTES} filled", flush=True)
    capture_ms.sort()

    corpus = {"thesis_captures": THESIS_CAPTURES,
              "sibling_notes": SIBLING_NOTES,
              "sibling_captures_each": SIBLING_CAPTURES,
              "total_captures": THESIS_CAPTURES + SIBLING_NOTES * SIBLING_CAPTURES}
    print(f"corpus: {corpus}")

    def timed(label: str, fn, n: int = 12):
        times = []
        last = None
        for _ in range(n):
            st, body, ms = fn()
            times.append(ms)
            last = (st, body)
        times.sort()
        return {"label": label, "n": n,
                "p50": round(statistics.median(times), 1),
                "p95": round(times[int(0.95 * (n - 1))], 1),
                "max": round(times[-1], 1),
                "status": last[0],
                "rows": len(last[1].get("candidates", []))
                if isinstance(last[1], dict) else None}

    results = [
        timed("picker_open",
              lambda: c.call("GET", f"/api/j2/notes/{thesis_id}/evidence-candidates")),
        timed("picker_search",
              lambda: c.call(
                  "GET",
                  f"/api/j2/notes/{thesis_id}/evidence-candidates?q=passage%20137")),
    ]

    # Attach: a WRITE, measured once per fresh target so the duplicate guard
    # cannot turn the measurement into a timing of the 400 path.
    st, cands, _ = c.call("GET", f"/api/j2/notes/{thesis_id}/evidence-candidates")
    ids = [x["id"] for x in cands.get("candidates", [])][:8]
    attach_times = []
    for cid in ids:
        st, body, ms = c.call("POST", f"/api/j2/notes/{thesis_id}/evidence", {
            "targetType": "document_excerpt", "targetId": cid, "stance": "supports"})
        if st == 200:
            attach_times.append(ms)
    if attach_times:
        attach_times.sort()
        results.append({"label": "attach", "n": len(attach_times),
                        "p50": round(statistics.median(attach_times), 1),
                        "p95": round(attach_times[-1], 1),
                        "max": round(attach_times[-1], 1),
                        "status": 200, "rows": None})

    # ⛔ THE BOUND ITSELF, not just the clock. "Fast" is worthless if the
    # endpoint got there by shipping every passage in the notebook.
    st, all_c, _ = c.call("GET", f"/api/j2/notes/{thesis_id}/evidence-candidates")
    returned = len(all_c.get("candidates", []))
    payload_bytes = len(json.dumps(all_c))

    findings = []
    for r in results:
        budget = BUDGET_MS.get(r["label"])
        if budget and r["p95"] > budget:
            findings.append(f"{r['label']}: p95 {r['p95']}ms over the {budget}ms budget")
    if returned > 50:
        findings.append(f"the candidate endpoint returned {returned} rows — it is "
                        "not bounding what it sends the client")

    report = {"transport_floor_ms": floor_p50,
              "corpus": corpus, "results": results,
              "capture_ms": {"n": len(capture_ms),
                             "p50": round(statistics.median(capture_ms), 1),
                             "p95": round(capture_ms[int(0.95 * (len(capture_ms) - 1))], 1),
                             "max": round(capture_ms[-1], 1)},
              "returned_rows": returned, "payload_bytes": payload_bytes,
              "findings": findings}
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    for r in results:
        print(f"  {r['label']:<14} p50 {r['p50']:>7.1f}ms  p95 {r['p95']:>7.1f}ms  "
              f"rows={r['rows']}")
    print(f"  returned {returned} rows, {payload_bytes:,} bytes")
    if findings:
        print("FINDINGS:")
        for f in findings:
            print(f"  [X] {f}")
        return 1
    print("Wave N picker performance: within budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
