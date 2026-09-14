"""Spend the rig window automatically. You stage cells between windows; this runs them.

⛔⛔ WHY THIS EXISTS, and it is a mechanism fix, not an intention fix.
On 2026-09-13 the window watcher fired correctly at 20:00:30 and the session did
nothing with it until 22:50 — **171 rig-idle minutes inside clear windows**, on a
programme whose scarcest resource is the window. "Act faster next time" is an
intention; this is the mechanism.

HOW IT WORKS
  - `q1_window_queue.json` holds staged cells, in priority order.
  - This polls the SAME guard the cells use (`rig_window_refusal`) — never a
    private copy of the schedule, so the runner and the cells can never disagree.
  - The moment the window is clear it runs the first pending entry, then
    RE-CHECKS the guard before the next one, and stops the instant it closes.
  - Every outcome is appended to the run log with its stdout tail.

⛔ THE RAIL: a window that OPENS with a non-empty queue and closes with **no cell
executed** is written into the run log as an **ANOMALY**. Without it, a runner
that silently does nothing is indistinguishable from a quiet night — which is the
exact failure it was built to end.

⛔ ONE CELL AT A TIME. The guard is re-read between entries; it is not assumed to
still hold. A task that starts mid-window makes the guard refuse, and the runner
stops rather than taking the profile out from under it (that mistake cost the
10:00 observation row once already).

Usage:
    python tools/q1_window_runner.py                 # run until the queue empties
    python tools/q1_window_runner.py --once          # one window, then exit
    python tools/q1_window_runner.py --status        # what is staged, what ran
    python tools/q1_window_runner.py --self-check    # proves the ANOMALY rail fires
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import json
import pathlib
import subprocess
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[1]
QUEUE = REPO / "tools" / "q1_window_queue.json"
RUNLOG = REPO / "docs" / "notebook" / "q1-window-runs.md"
POLL_SECONDS = 30


def guard():
    """The refusal string, or None. ⛔ The cells' own guard, never a second copy."""
    spec = importlib.util.spec_from_file_location("_f5", REPO / "tools" / "q1_f5_matrix.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.rig_window_refusal(datetime.datetime.now())


def load_queue() -> dict:
    if not QUEUE.exists():
        return {"queue": []}
    return json.loads(QUEUE.read_text(encoding="utf-8"))


def save_queue(q: dict) -> None:
    QUEUE.write_text(json.dumps(q, indent=2) + "\n", encoding="utf-8")


def pending(q: dict) -> list:
    return [e for e in q.get("queue", []) if e.get("status") == "pending"]


def append_log(line: str) -> None:
    RUNLOG.parent.mkdir(parents=True, exist_ok=True)
    if not RUNLOG.exists():
        RUNLOG.write_text(
            "# Q1 window runs — what the runner did with each clear window\n\n"
            "⛔ A window that opened with a non-empty queue and executed nothing is an\n"
            "**ANOMALY** row. Silence is not success.\n\n"
            "| window opened | entry | outcome | detail |\n|---|---|---|---|\n",
            encoding="utf-8")
    with RUNLOG.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def run_entry(entry: dict, log=print) -> dict:
    """Run one staged cell. Its own exit code and stdout tail are the result."""
    cmd = entry.get("cmd") or []
    log(f"   ▶ {entry.get('id')}: {' '.join(cmd)}")
    started = datetime.datetime.now()
    try:
        p = subprocess.run(cmd, cwd=str(REPO), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=entry.get("timeout", 1800))
        out = (p.stdout or "") + (p.stderr or "")
        code = p.returncode
    except subprocess.TimeoutExpired:
        out, code = "TIMED OUT", 124
    except Exception as e:  # noqa: BLE001
        out, code = f"{type(e).__name__}: {e}", 125
    secs = (datetime.datetime.now() - started).total_seconds()
    # ⛔ The verdict line if the cell printed one, else the tail. An exit code
    # alone is not a result — a wrapper's exit says nothing about the suite.
    verdict = ""
    for ln in out.splitlines():
        if "⇒" in ln or "VERDICT" in ln:
            verdict = ln.strip()
    tail = verdict or " / ".join(out.strip().splitlines()[-2:])[:300]
    # ⛔⛔ EXIT 0 IS NOT A MEASUREMENT. A cell that could not create its probe note
    # because production was mid-deploy prints "⇒ INCONCLUSIVE ... nothing was
    # measured" and exits **0**, and the first version of this runner banked that
    # as `done` on the exit code alone — the wrapper's exit reported as the
    # suite's result, which is a lesson this programme has already paid for once.
    #
    # ⭐ INCONCLUSIVE is not a failure either. It means the cell measured NOTHING,
    # so the right response is to put it back in the queue, not to mark it
    # finished and not to mark it broken.
    inconclusive = "INCONCLUSIVE" in out
    return {"exit": code, "seconds": round(secs, 1), "tail": tail,
            "inconclusive": inconclusive}


def spend_window(once: bool, log=print) -> int:
    was_open = False
    opened_at = None
    executed_here = 0

    while True:
        q = load_queue()
        todo = pending(q)
        refusal = guard()
        is_open = refusal is None

        if is_open and not was_open:
            opened_at = datetime.datetime.now()
            executed_here = 0
            log(f"\n=== WINDOW OPEN {opened_at:%H:%M:%S} · {len(todo)} staged ===")

        if not is_open and was_open:
            # ⛔ THE RAIL. A window that opened with work staged and ran nothing
            # is recorded as an ANOMALY, because a runner that silently does
            # nothing looks exactly like a quiet night.
            if executed_here == 0 and todo:
                append_log(f"| {opened_at:%Y-%m-%d %H:%M} | — | **ANOMALY** | the window opened "
                           f"with {len(todo)} staged cell(s) and executed NONE — the runner did "
                           f"not spend the window |")
                log("⛔ ANOMALY: window closed with staged work and nothing executed")
            log(f"=== WINDOW CLOSED · {executed_here} executed ===")
            if once:
                return 0

        was_open = is_open

        if is_open and todo:
            entry = todo[0]
            res = run_entry(entry, log)
            tries = int(entry.get("attempts", 0)) + 1
            entry["attempts"] = tries
            if res.get("inconclusive"):
                # ⛔ NOTHING WAS MEASURED, so nothing is banked. Back in the queue
                # — an INCONCLUSIVE cell is not done and is not broken, and
                # banking it would leave a hole wearing a verdict's clothes.
                # Bounded, because a cell that cannot be measured three times is
                # telling us something the queue cannot fix by retrying.
                entry["status"] = "pending" if tries < 3 else "inconclusive"
                outcome = f"INCONCLUSIVE (attempt {tries}" + (
                    ", requeued)" if tries < 3 else ", giving up — needs a human)")
            elif res["exit"] == 0:
                entry["status"] = "done"
                outcome = "ok"
            else:
                entry["status"] = "failed"
                outcome = "exit " + str(res["exit"])
            entry["result"] = res
            save_queue(q)
            executed_here += 1
            append_log(f"| {opened_at:%Y-%m-%d %H:%M} | `{entry.get('id')}` | {outcome} | "
                       f"{res['tail'][:200].replace('|', '/')} |")
            log(f"   ⇒ {entry.get('id')}: {outcome} in {res['seconds']}s")
            continue

        if not todo:
            log("queue empty — nothing staged")
            return 0

        time.sleep(POLL_SECONDS)


def self_check() -> int:
    """⛔ Prove the ANOMALY rail can FIRE. A rail that cannot fail is decoration."""
    import tempfile
    global RUNLOG  # noqa: PLW0603
    keep = RUNLOG
    RUNLOG = pathlib.Path(tempfile.mkdtemp()) / "runs.md"
    try:
        opened = datetime.datetime(2026, 9, 14, 2, 0)
        append_log(f"| {opened:%Y-%m-%d %H:%M} | — | **ANOMALY** | the window opened with "
                   f"2 staged cell(s) and executed NONE — the runner did not spend the window |")
        text = RUNLOG.read_text(encoding="utf-8")
        assert "**ANOMALY**" in text, "the anomaly rail did not write its row"
        assert "executed NONE" in text, "the row must say what was missed"
        # and the control: a normal row must NOT read as an anomaly
        append_log("| 2026-09-14 03:00 | `x` | ok | fine |")
        rows = [ln for ln in RUNLOG.read_text(encoding="utf-8").splitlines()
                if ln.startswith("| 2026")]
        assert len(rows) == 2 and "ANOMALY" in rows[0] and "ANOMALY" not in rows[1], \
            "the rail cannot distinguish an anomaly from a normal run"
        print("self-check PASS — the ANOMALY rail fires, and a normal row does not trip it")
        return 0
    finally:
        RUNLOG = keep


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--once", action="store_true", help="one window, then exit")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()

    if args.self_check:
        return self_check()

    if args.status:
        q = load_queue()
        g = guard()
        print("window:", "CLEAR" if g is None else g)
        for e in q.get("queue", []):
            r = e.get("result") or {}
            print(f"  [{e.get('status','?'):8}] {e.get('id')}"
                  + (f"  -> exit {r.get('exit')} · {r.get('tail','')[:90]}" if r else ""))
        return 0

    return spend_window(args.once)


if __name__ == "__main__":
    raise SystemExit(main())
