"""Wave Q1 — the Sunday gate reading, written to a file for a PERSON to act on.

⛔⛔ IT DOES NOT MERGE ANYTHING. A REVERT verdict is WRITTEN, never executed. An
instrument that can deploy is an instrument that can deploy by mistake, and this
wave produced seven instrument defects - every one of which made the product look
broken. The one thing none of them could do was ship.

Reads the observation log against the four triggers in
`docs/notebook/wave-q1-sunday-gate.md`, checks the sampler's heartbeat, and writes
`wave-q1-gate-verdict.md`. Run it any time; it is idempotent.
"""
from __future__ import annotations

import datetime
import os
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
LOG = pathlib.Path(os.environ.get("NB_OBSERVE_LOG", "") or (HERE / "wave-q1-observation-log.md"))
OUT = pathlib.Path(os.environ.get("NB_GATE_VERDICT", "") or (HERE / "wave-q1-gate-verdict.md"))

# Every opt-in up to here is the rig. Newer, with no canary at that minute, is a member.
RIG_LAST = "2026-09-12 05:17:56"
PRESERVED_CONFLICTS = 3          # the round-3 evidence set; historical, never new


def heartbeat() -> tuple[str, str]:
    """Task Scheduler is the ONLY signal that the job ran at all."""
    try:
        out = subprocess.run(["schtasks", "/Query", "/TN", "UCT-WaveQ1-Observe", "/FO", "LIST", "/V"],
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60).stdout
        last = re.search(r"Last Run Time:\s*(.+)", out)
        res = re.search(r"Last Result:\s*(.+)", out)
        return (last.group(1).strip() if last else "UNREADABLE",
                res.group(1).strip() if res else "UNREADABLE")
    except Exception as e:                                   # noqa: BLE001
        return (f"ERR {type(e).__name__}", "ERR")


def rows() -> list[list[str]]:
    if not LOG.exists():
        return []
    out = []
    for line in LOG.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|") or line.startswith("|---") or "at (ET)" in line:
            continue
        out.append([c.strip() for c in line.strip("|").split("|")])
    return out


def main() -> int:
    at = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-4))).strftime("%Y-%m-%d %H:%M ET")
    last_run, last_result = heartbeat()
    r = rows()
    fails = []

    # ⛔ HEARTBEAT FIRST. An unobserved window is not a clean one.
    hb_ok = last_result.strip() == "0"
    if not hb_ok:
        fails.append(f"heartbeat: Last Result {last_result!r} (expected 0) - the window is UNOBSERVED, not clean")

    # trigger 1 - any row whose flag is not OK
    bad = [x for x in r if x and not x[-1].startswith("OK")]
    t1 = "PASS" if not bad else "FAIL"
    if bad:
        fails.append(f"trigger 1: {len(bad)} non-OK row(s), first at {bad[0][0]}")

    # trigger 2 - conflict count above the preserved evidence set
    conf = []
    for x in r:
        try:
            if int(x[4]) > PRESERVED_CONFLICTS:
                conf.append(x)
        except (ValueError, IndexError):
            pass
    t2 = "PASS" if not conf else "NEEDS ATTRIBUTION"
    if conf:
        fails.append(f"trigger 2: sync-conflict rose above {PRESERVED_CONFLICTS} at {conf[0][0]} "
                     f"- attribute it (canary in flight? two tabs?) before calling it a defect")

    # trigger 3 - NOT readable here, by construction
    t3 = "n/a - canary or member report only"

    # trigger 4 - console errors seen by the rig (same bundle a member runs)
    errs = []
    for x in r:
        try:
            if int(x[6]) > 0:
                errs.append(x)
        except (ValueError, IndexError):
            pass
    t4 = "PASS" if not errs else "FAIL"
    if errs:
        fails.append(f"trigger 4: console errors at {errs[0][0]}")

    member = "none - latest opt-in is still the rig's " + RIG_LAST
    for x in r:
        if len(x) > 1 and x[1] not in ("-", "—", "") and x[1] > RIG_LAST:
            member = f"FIRST MEMBER OPT-IN {x[1]} (row {x[0]})"
            break

    verdict = "KEEP" if (hb_ok and not bad and not errs and not conf) else "REVERT"
    body = f"""# Wave Q1 — gate verdict

VERDICT: **{verdict}**
at:        {at}
heartbeat: Last Run Time {last_run} | Last Result {last_result}
rows read: {len(r)}  ({r[0][0] if r else 'none'} .. {r[-1][0] if r else 'none'})
member:    {member}

| trigger | result |
|---|---|
| 1 · unexplained red | {t1} |
| 2 · unattributable fork | {t2} |
| 3 · outbox stuck >5 min | {t3} |
| 4 · member console error | {t4} |

"""
    NLV = chr(10)
    if fails:
        body += '## Why this is not a clean KEEP' + NLV + NLV
        body += NLV.join('- ' + f for f in fails) + NLV + NLV
    tail = [
        '- This file does not merge anything. A REVERT verdict is a reading for a person',
        '  to act on: merge the draft rollback PR for',
        '  `rollback/notebook-offline-default-off` @ `3db89e205` with a MERGE COMMIT,',
        '  then verify `offlineFlag.js` reads `false` on `origin/master` and that `web`',
        '  redeployed. Full procedure: `docs/notebook/wave-q1-sunday-gate.md`.',
    ]
    body += NLV.join(tail) + NLV
    OUT.write_text(body, encoding="utf-8")
    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
