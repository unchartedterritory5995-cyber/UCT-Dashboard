"""The Monday-morning shadow line, as a command rather than a manual read.

    python tools/railway_env_logs.py --filter drender \
        --since 2026-09-14T00:00:00Z --until 2026-09-14T13:30:00Z --out shadow.jsonl
    python docs/discord-render/instruments/shadow_report.py shadow.jsonl
    python docs/discord-render/instruments/shadow_report.py --self-check

Reads `drender` log lines and reports what shadow mode saw: how many records, the outcome
distribution, latency percentiles per command, and the divergences with an example `cid` each.

⛔⛔ IT REPORTS A **FLOOR**, NEVER A TOTAL, AND IT SAYS WHICH. `tools/railway_env_logs.py` prints
`STOPPED: no progress past <ts>` when its pager cannot advance, and a count taken from a truncated
pull is a smaller number that reads exactly like a quieter system. Pass `--pager-stopped` (or let
this read the pull's own warning) and every count is printed as `>= n`.

⛔⛔ A DIVERGENCE OF ZERO IS NOT EVIDENCE OF AGREEMENT UNTIL YOU KNOW THE DENOMINATOR. Zero
divergences across four records and zero across four hundred are the same headline and different
facts. The sample size is printed FIRST, before any rate, for that reason.

⛔ AND `agree` IS NOT THE SAME AS `could_not_tell`. `shadow.outcome()` emits five words —
`error | divergence | could_not_tell | budget | agree` — precisely so a shadow that answered
nothing cannot be counted as a shadow that answered the same thing. They are never summed here.

⭐ WHAT WOULD BLOCK A FLIP, stated before the numbers are read: a divergence class implying V2
would have produced a **WRONG** chart — not a slower or a degraded one. `--flip-blocking` lists
exactly those and exits 1 if there are any.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import statistics
import sys

#: `outcome()`'s vocabulary. ⛔ Kept as a tuple, not derived from what happens to be in the file —
#: a word that never appeared must still print as 0, or an absent class reads as a class that
#: does not exist.
OUTCOMES = ("agree", "divergence", "could_not_tell", "budget", "error")
#: The classes that mean V2 would have answered a member differently in a way that is WRONG,
#: rather than slower or degraded. These are the flip blockers.
BLOCKING = ("divergence", "error")


_DEC = json.JSONDecoder()


def parse(text: str) -> list[dict]:
    """Every `evt=shadow` record in a log dump, however the line is wrapped.

    ⚰️ THE FIRST VERSION READ **ZERO** RECORDS OUT OF A FILE HOLDING EIGHT, AND ITS SELF-CHECK WAS
    GREEN. `tools/railway_env_logs.py` writes JSONL — one object per line whose `message` field is
    a STRING containing the log text, so the `drender` blob inside arrives with every quote
    backslash-escaped. The fixture in the self-check was a bare, unescaped line, so the test and
    the product disagreed about the input and only the test was consulted.

    ⭐ That is `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` in its purest form, and the
    only reason it surfaced is that the report refuses to print "0 divergences" as good news: a
    parser returning nothing produced NOTHING TO REPORT instead of a clean bill of health. Unwrap
    first, then scan — and the self-check now carries the real wrapper shape."""
    out = []
    for line in text.splitlines():
        payloads = [line]
        try:
            outer = json.loads(line)
            if isinstance(outer, dict) and isinstance(outer.get("message"), str):
                payloads = [outer["message"]]
        except Exception:  # noqa: BLE001 — a bare log line is the other supported shape
            pass
        for payload in payloads:
            for m in re.finditer(r'\{"t":\s*"drender"', payload):
                try:
                    rec, _ = _DEC.raw_decode(payload, m.start())
                except Exception:  # noqa: BLE001 — a truncated line is not a record
                    continue
                if isinstance(rec, dict) and rec.get("evt") == "shadow":
                    out.append(rec)
    return out


def _pcts(values: list[float]) -> dict:
    if not values:
        # ⛔ NOT ZERO. No sample is not a fast sample.
        return {"n": 0, "p50": None, "p95": None}
    ordered = sorted(values)
    return {"n": len(ordered), "p50": statistics.median(ordered),
            "p95": ordered[min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))]}


def report(records: list[dict], *, truncated: bool = False) -> tuple[str, int]:
    ge = ">= " if truncated else ""
    lines = [f"records: {ge}{len(records)}"]
    if truncated:
        lines.append("  ⚠️ the log pager stopped before it ran out of window — every count below "
                     "is a FLOOR, not a total.")
    if not records:
        lines.append("  ⛔ NOTHING TO REPORT. Zero records is not zero divergences — it is no "
                     "measurement. Do not read it as agreement.")
        return "\n".join(lines), 2

    by_outcome = collections.Counter(r.get("outcome") or "?" for r in records)
    lines.append("outcomes: " + " · ".join(f"{k}={by_outcome.get(k, 0)}" for k in OUTCOMES)
                 + "".join(f" · {k}={v}" for k, v in sorted(by_outcome.items())
                           if k not in OUTCOMES))

    by_cmd: dict = collections.defaultdict(list)
    for r in records:
        if isinstance(r.get("ms"), (int, float)):
            by_cmd[r.get("cmd") or "?"].append(float(r["ms"]))
    for cmd, ms in sorted(by_cmd.items()):
        p = _pcts(ms)
        lines.append(f"  /{cmd}: n={p['n']} shadow p50 {p['p50']:.1f} ms · p95 {p['p95']:.1f} ms")

    blockers = [r for r in records if (r.get("outcome") or "") in BLOCKING]
    if blockers:
        seen: dict = {}
        for r in blockers:
            seen.setdefault((r.get("cmd"), r.get("detail") or ""), r)
        lines.append(f"⛔ FLIP BLOCKERS: {len(blockers)} record(s) in {BLOCKING}")
        for (cmd, detail), r in list(seen.items())[:3]:
            lines.append(f"    /{cmd} {r.get('outcome')} cid={r.get('cid') or '—'} {detail[:90]}")
        lines.append("    → each of these is a forensics row. A divergence that implies a WRONG "
                     "chart blocks the flip; a slower or degraded one does not.")
        return "\n".join(lines), 1

    absent = [c for c in ("chart", "flow") if c not in by_cmd]
    if absent:
        # ⛔ An absence is only evidence if the instrument could have seen a presence.
        lines.append(f"⚠️ no shadow record at all for: {', '.join('/' + c for c in absent)}. "
                     "That is 'nobody ran it' OR 'it is not being shadowed' and this cannot tell "
                     "them apart — check the command actually ran before reading it as clean.")
    lines.append("no divergence and no error in this sample.")
    return "\n".join(lines), 0


def self_check() -> int:
    def rec(**kw):
        return {"t": "drender", "evt": "shadow", "cmd": "chart", "ms": 1.0, "outcome": "agree",
                "detail": "", **kw}

    cases = []
    text = ('x INFO drender {"t":"drender","evt":"shadow","cmd":"flow","ms":0.1,"outcome":"agree",'
            '"detail":"n=1"}\ny INFO drender {"t":"drender","evt":"ack","cmd":"flow"}')
    cases.append(("only shadow records are parsed, out of a real log line",
                  len(parse(text)) == 1))
    # ⛔ THE SHAPE THE TOOL ACTUALLY WRITES: JSONL whose `message` is a string, so the inner blob
    # arrives escaped. Copied from a real pull, not invented — the version of `parse` before this
    # case existed read 0 records out of a file holding 8 and this suite stayed green.
    wrapped = json.dumps({"timestamp": "2026-09-14T04:51:48Z", "message":
                          '2026-09-14 04:51:40,523 INFO discord_render: drender '
                          '{"t":"drender","evt":"shadow","cmd":"flow","ms":0.1,'
                          '"outcome":"agree","detail":"n=0 refuse=- unans=- idx=1 pre=8"}'})
    cases.append(("a JSONL line whose message carries an ESCAPED blob is parsed",
                  len(parse(wrapped)) == 1 and parse(wrapped)[0]["cmd"] == "flow"))
    cases.append(("two records on one line are both read",
                  len(parse(text + "\n" + text)) == 2))
    cases.append(("a divergence is a flip blocker",
                  report([rec(outcome="divergence")])[1] == 1))
    cases.append(("an error is a flip blocker", report([rec(outcome="error")])[1] == 1))
    cases.append(("a budget bail is NOT a flip blocker",
                  report([rec(outcome="budget"), rec()])[1] == 0))
    cases.append(("could_not_tell is NOT counted as agreement",
                  "could_not_tell=1" in report([rec(outcome="could_not_tell")])[0]))
    cases.append(("no records is INCONCLUSIVE, never clean", report([])[1] == 2))
    cases.append(("a truncated pull prints counts as a floor",
                  ">= 1" in report([rec()], truncated=True)[0]))
    cases.append(("an outcome that never appeared still prints as 0",
                  "divergence=0" in report([rec()])[0]))
    cases.append(("a missing command is named, not read as clean",
                  "/flow" in report([rec()])[0] and "no shadow record at all" in report([rec()])[0]))
    cases.append(("a blocker is reported with its cid",
                  "cid=abc123" in report([rec(outcome="divergence", cid="abc123")])[0]))
    # ⛔ the discriminator: the blocker check must not fire on a healthy sample
    cases.append(("a healthy sample is not reported as blocked", report([rec(), rec()])[1] == 0))

    failed = sum(not ok for _, ok in cases)
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    print(f"TOTALS shadow_report --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={failed}")
    return 0 if not failed else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("path", nargs="?", default="")
    ap.add_argument("--pager-stopped", action="store_true",
                    help="the log pull printed 'STOPPED: no progress past …'")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    if not args.path:
        ap.error("give a log dump, or --self-check")
    text = open(args.path, encoding="utf-8", errors="replace").read()
    out, code = report(parse(text), truncated=args.pager_stopped)
    print(out)
    return code


if __name__ == "__main__":
    sys.exit(main())
