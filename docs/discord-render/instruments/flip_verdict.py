"""The flip verdict — one word, three exit codes, and an explicit refusal to guess.

    python docs/discord-render/instruments/flip_verdict.py --self-check
    python docs/discord-render/instruments/flip_verdict.py --confirm-observed
    python docs/discord-render/instruments/flip_verdict.py --json health.json --confirm-observed

Reads `GET /api/discord/render-health` (bearer `PUSH_SECRET`) and answers the question
`06-flip-packet.md` §4.0b asks: **do the first five sessions pass?**

⛔⛔ THREE EXIT CODES, AND COLLAPSING TWO OF THEM IS THE DEFECT THIS EXISTS TO AVOID.
    0  PASS           every criterion it can measure held, over enough sessions
    1  FAIL           a criterion was measured false — roll back (§5), then diagnose
    2  INCONCLUSIVE   not enough sessions, or something could not be read
"We could not compute it" and "it is broken" are different facts. Rolling back on the first one
teaches everyone to stop running the check (rule H15); shipping on it is worse.

⛔⛔ IT REFUSES TO SCORE THE TWO ROWS A MACHINE CANNOT SEE. Criteria 1 and 5 of §4.0b — "the member
saw a chart, once" and "every degraded delivery carried its label" — live in the Discord channel,
not in a metric. This tool will not pretend: without `--confirm-observed` it answers INCONCLUSIVE
and names them. ⭐ That is deliberate friction. C-06's three unlabelled stand-ins were invisible to
every counter in the system and visible to anyone who read the message; a verdict tool that quietly
scored 3 of 5 rows and printed PASS would be the instrument that hid them.

⛔ A METRIC THAT COULD NOT BE READ IS NOT A METRIC THAT PASSED. A missing key is INCONCLUSIVE and
NAMED, never treated as zero — a zero here reads as "no failures", which is the
saturated-instrument shape (`lesson_a_saturated_instrument_reports_zero`).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

PASS, FAIL, INCONCLUSIVE = 0, 1, 2
BASE = os.environ.get("UCT_BASE_URL", "https://uctintelligence.com")
PATH = "/api/discord/render-health"
#: Cloudflare 1010-blocks the default urllib UA on this origin.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")

#: §4.0b: five real sessions. ⛔ SESSIONS, NOT MINUTES — a quiet ten minutes and a working system
#: are the same observation when nobody is using it.
MIN_SESSIONS = 5
WINDOW = "1h"
#: S2 p99 (03 §1). Stated here as the number the packet states, not re-derived.
FINAL_P99_MS = 8000.0
#: The two classes this whole programme was opened for. `ack_late` is C-02's 23 × 10015;
#: `discord_rejected` carries C-04's 23 × ATTACHMENT_NOT_FOUND and C-03's 33 refused trees.
BLOCKING_CLASSES = ("ack_late", "discord_rejected")
#: What a human has to read in the channel. Named, because an unnamed gap is one nobody closes.
OBSERVED_ROWS = (
    "1. The member saw a chart, ONCE — not a stand-in that never healed.",
    "5. Every degraded delivery carried its label; every failure ended in a sentence.",
)


class Unreadable(Exception):
    """A metric that is absent. Distinct from a metric that is bad."""


def _dig(payload, *path):
    cur = payload
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            raise Unreadable("/".join(str(p) for p in path))
        cur = cur[key]
    return cur


def fetch(base: str = BASE, *, secret: str | None = None, timeout: float = 15.0) -> dict:
    secret = secret or os.environ.get("PUSH_SECRET") or ""
    if not secret:
        raise Unreadable("PUSH_SECRET is not set; the endpoint answers 401 without it")
    req = urllib.request.Request(base.rstrip("/") + PATH, headers={
        "Authorization": f"Bearer {secret}", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # ⛔ The status, never the body: the body can echo a URL and the URL carries a token.
        raise Unreadable(f"render-health answered HTTP {e.code}") from None
    except Exception as e:  # noqa: BLE001
        raise Unreadable(f"render-health unreachable ({type(e).__name__})") from None


def evaluate(payload: dict, *, confirmed: bool, min_sessions: int = MIN_SESSIONS) -> tuple[int, list]:
    """`(exit_code, rows)`. Each row is `(verdict, criterion, evidence)`."""
    rows: list[tuple[str, str, str]] = []
    unreadable: list[str] = []

    def measure(name: str, fn):
        try:
            ok, evidence = fn()
        except Unreadable as u:
            unreadable.append(str(u))
            rows.append(("UNREADABLE", name, str(u)))
            return
        rows.append(("PASS" if ok else "FAIL", name, evidence))

    try:
        win = _dig(payload, "slo", "windows", WINDOW, "all")
    except Unreadable as u:
        return INCONCLUSIVE, [("UNREADABLE", f"the {WINDOW} window", str(u))]

    sessions = win.get("jobs")
    if not isinstance(sessions, int):
        return INCONCLUSIVE, [("UNREADABLE", "session count", "windows/%s/all/jobs" % WINDOW)]

    measure("2. Ack under 3 s", lambda: (
        _dig(win, "ack_ms", "over_3s") == 0,
        f"{_dig(win, 'ack_ms', 'over_3s')} ack(s) over 3 s"))

    def _p99():
        v = _dig(win, "final_ms", "p99")
        if v is None:
            # ⛔ NOT A PASS. No delivered job in the window means nothing was measured.
            raise Unreadable("no delivered job in the window, so p99 is undefined")
        return v <= FINAL_P99_MS, f"delivered p99 {v:.0f} ms (ceiling {FINAL_P99_MS:.0f})"
    measure("3. Delivered under 8 s (S2 p99)", _p99)

    def _classes():
        by_class = _dig(win, "failures_by_class")
        hits = {k: v for k, v in by_class.items() if k in BLOCKING_CLASSES and v}
        return not hits, ("none" if not hits else
                          ", ".join(f"{k}×{v}" for k, v in sorted(hits.items())))
    measure("4. Zero 10015 and zero ATTACHMENT_NOT_FOUND", _classes)

    measure("S7. No stuck job", lambda: (
        _dig(payload, "slo", "stuck") == 0, f"{_dig(payload, 'slo', 'stuck')} stuck"))

    for row in OBSERVED_ROWS:
        rows.append(("CONFIRMED" if confirmed else "NOT CONFIRMED", row,
                     "you read the channel" if confirmed else "re-run with --confirm-observed"))

    if any(v == "FAIL" for v, _, _ in rows):
        return FAIL, rows
    if unreadable:
        return INCONCLUSIVE, rows
    if sessions < min_sessions:
        rows.append(("SHORT", "enough sessions",
                     f"{sessions} session(s) in the last {WINDOW}; {min_sessions} needed"))
        return INCONCLUSIVE, rows
    if not confirmed:
        return INCONCLUSIVE, rows
    rows.append(("PASS", "enough sessions", f"{sessions} session(s) in the last {WINDOW}"))
    return PASS, rows


def _print(code: int, rows: list) -> None:
    word = {PASS: "PASS", FAIL: "FAIL", INCONCLUSIVE: "INCONCLUSIVE"}[code]
    for verdict, name, evidence in rows:
        print(f"  {verdict:<14} {name:<52} {evidence}")
    print(f"\nVERDICT {word}")
    if code == INCONCLUSIVE:
        print("  ⛔ INCONCLUSIVE is not a pass and not a failure. Do not flip forward and do not "
              "roll back on it — get the missing sessions or fix the reading.")
    if code == FAIL:
        print("  ⛔ Roll back FIRST (06-flip-packet.md §5), diagnose SECOND. Rule H15.")


# ── self-check: the gate must be able to fail ───────────────────────────────

def _payload(*, jobs=6, over_3s=0, p99=3000.0, classes=None, stuck=0) -> dict:
    return {"slo": {"stuck": stuck, "windows": {WINDOW: {"all": {
        "jobs": jobs, "ack_ms": {"over_3s": over_3s}, "final_ms": {"p99": p99},
        "failures_by_class": dict(classes or {})}}}}}


def self_check() -> int:
    cases = [
        ("a clean run over enough sessions PASSES", _payload(), True, PASS),
        ("an ack over 3 s FAILS", _payload(over_3s=1), True, FAIL),
        ("a p99 over the ceiling FAILS", _payload(p99=9001.0), True, FAIL),
        ("one 10015 FAILS", _payload(classes={"ack_late": 1}), True, FAIL),
        ("one refused attachment FAILS", _payload(classes={"discord_rejected": 1}), True, FAIL),
        ("a user error does NOT fail", _payload(classes={"symbol_not_found": 4}), True, PASS),
        ("a stuck job FAILS", _payload(stuck=1), True, FAIL),
        ("four sessions is INCONCLUSIVE, never a pass", _payload(jobs=4), True, INCONCLUSIVE),
        ("unconfirmed observation is INCONCLUSIVE, never a pass", _payload(), False, INCONCLUSIVE),
        ("no delivered job is INCONCLUSIVE, not a p99 of zero", _payload(p99=None), True, INCONCLUSIVE),
        ("a missing window is INCONCLUSIVE, not zero failures", {"slo": {"windows": {}}}, True, INCONCLUSIVE),
        ("a missing metric is INCONCLUSIVE and NAMED", {"slo": {"stuck": 0, "windows": {WINDOW: {"all": {
            "jobs": 9, "final_ms": {"p99": 1.0}, "failures_by_class": {}}}}}}, True, INCONCLUSIVE),
        # ⛔ The discriminator: a FAIL must beat a short run, or a real break inside the first
        # four sessions would be filed as "not enough data" and the canary would carry on.
        ("a measured FAIL beats a short run", _payload(jobs=1, over_3s=3), True, FAIL),
    ]
    failed = 0
    for name, payload, confirmed, expect in cases:
        got, _ = evaluate(payload, confirmed=confirmed)
        ok = got == expect
        failed += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {name}"
              + ("" if ok else f"   (expected {expect}, got {got})"))
    print(f"TOTALS flip_verdict --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={failed}")
    return PASS if not failed else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--confirm-observed", action="store_true",
                    help="you have read the channel and criteria 1 and 5 hold")
    ap.add_argument("--json", default="", help="read a saved health payload instead of the network")
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--min-sessions", type=int, default=MIN_SESSIONS)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()
    if not args.confirm_observed:
        print("  ⚠️ Criteria 1 and 5 are in the Discord channel and this tool cannot see them:")
        for row in OBSERVED_ROWS:
            print(f"     {row}")
    try:
        payload = (json.loads(open(args.json, encoding="utf-8").read()) if args.json
                   else fetch(args.base))
    except Unreadable as u:
        _print(INCONCLUSIVE, [("UNREADABLE", "the health payload", str(u))])
        return INCONCLUSIVE
    code, rows = evaluate(payload, confirmed=args.confirm_observed, min_sessions=args.min_sessions)
    _print(code, rows)
    return code


if __name__ == "__main__":
    sys.exit(main())
