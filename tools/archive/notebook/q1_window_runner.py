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
import os
import pathlib
import shutil
import subprocess
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[1]
# ⛔⛔ THE OPERATOR CONSOLE ON THIS BOX IS cp1252, AND THIS IS THE TOOL THAT CAN
# LEAST AFFORD TO DIE PRINTING. `--help` raised UnicodeEncodeError here on
# 2026-09-17: the runner exists so a window is never lost, and it could be lost
# to the runner's own banner. `q1_f5_matrix.py` has carried this guard since it
# was written; the runner did not, which is the same "one copy has it, the other
# is the hole" shape as Q1 fix 6 itself.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

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


def save_entry(entry_id: str, fields: dict) -> None:
    """Write back ONLY this runner's own fields on ONE entry, onto the CURRENT file.

    ⛔⛔ NEVER save the whole `q` the loop is holding. It was read BEFORE a cell that
    can run for 55 minutes, so writing it back reverts every edit made in the
    meantime — silently, and with the run still reporting its own result correctly,
    so the window looks fine and the cost lands on the NEXT one as a window that
    opens with nothing staged.

    ⚰️ Measured 2026-09-18: the W2/P3 cells were split into two while 2.8b was
    running, and the pre-run snapshot would have reverted both.
    """
    cur = load_queue()
    for e in cur.get("queue", []):
        if e.get("id") == entry_id:
            e.update(fields)
            break
    else:
        # ⛔ The entry is GONE from the file. Do not re-create it — somebody
        # removed it deliberately, and resurrecting it with a stale body is
        # how a queue grows a cell nobody staged. Say so and write nothing.
        print(f"  [runner] ⚠️ {entry_id} is no longer in the queue — result NOT "
              f"written back. It is in the log and in the evidence directory.",
              flush=True)
        return
    QUEUE.write_text(json.dumps(cur, indent=2) + "\n", encoding="utf-8")


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


EVIDENCE_ROOT = REPO / "docs" / "notebook" / "evidence"


def _rel(path: pathlib.Path) -> str:
    """Repo-relative when it can be; absolute otherwise. ⛔ Never raises: the self-check
    redirects EVIDENCE_ROOT to a temp dir, and a path helper that throws there would make
    the rail untestable — which is how a rail stops being run."""
    try:
        return path.relative_to(REPO).as_posix()
    except ValueError:
        return path.as_posix()


def evidence_dir_for(entry_id: str, started: datetime.datetime) -> pathlib.Path:
    """`docs/notebook/evidence/<run-id>/` — one directory per spent window cell."""
    safe = "".join(c if (c.isalnum() or c in "-_.") else "-" for c in str(entry_id))[:60]
    return EVIDENCE_ROOT / f"{started:%Y%m%dT%H%M%S}-{safe}"


def write_raw_evidence(ev: pathlib.Path, *, entry: dict, cmd, out: str, code, started, secs) -> dict:
    """⛔⛔ R-RAW. The raw bytes hit disk BEFORE any summary is computed.

    ⚰️ WHY THIS EXISTS. A window on 2026-09-15 produced the decisive ring, the console
    showed it, and NOTHING WAS WRITTEN DOWN. `summarise()` surfaced only the dirty flips
    and discarded the rest, so the one fact the window was spent to obtain — which write
    dropped the sentence — was computed, displayed and destroyed in the same breath. Two
    days later `docs/notebook/evidence/` still did not exist and `sentence_lost_writes`
    had never been read from a real run.

    ⛔ SO THE ORDER IS THE RULE, not a convenience: write, THEN interpret. A run with no
    raw artifact on disk is INCONCLUSIVE regardless of what the console showed.
    """
    report = {"written": False, "why": None, "dir": str(ev), "bytes": 0}
    try:
        ev.mkdir(parents=True, exist_ok=True)
        raw = ev / "raw.txt"
        raw.write_text(out if out is not None else "", encoding="utf-8", newline=chr(10))
        meta = {
            "id": entry.get("id"), "cmd": list(cmd), "exit": code,
            "started": started.isoformat(timespec="seconds"), "seconds": round(secs, 1),
            "why": entry.get("why"),
        }
        (ev / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8", newline=chr(10))
        report["bytes"] = raw.stat().st_size
        # ⛔ AN EMPTY ARTIFACT IS NOT AN ARTIFACT. A zero-byte raw.txt is exactly what a
        # cell that printed nothing and a capture that silently failed both look like, and
        # banking either as evidence is how a hole gets a verdict's clothes.
        report["written"] = report["bytes"] > 0
        if not report["written"]:
            report["why"] = "raw.txt is ZERO BYTES — the cell produced no output to preserve"
    except OSError as e:
        report["why"] = f"could not write evidence: {e}"
    return report


def teardown_rig_browser(log=print) -> None:
    """Close the rig BROWSER, keep the rig PROFILE. Best-effort, never fatal.

    ⛔ BY MARKER, NEVER BY NAME. `chrome.exe` alone would take the owner's own
    browser with it; the marker is the rig profile path, which only the rig's
    browser carries on its command line.
    ⛔ THE PROFILE IS NEVER DELETED — a fresh profile is a SIGNED-OUT profile,
    and a sign-in is a 30-day event, not a session event.
    """
    try:
        _ps = shutil.which("powershell") or "powershell"
        subprocess.run(
            [_ps, "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
             "Where-Object { $_.CommandLine -like '*canary-chrome-profile-persistent*' } | "
             "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
            capture_output=True, timeout=60)
    except Exception as _e:                          # noqa: BLE001
        # ⛔ Teardown must never change a verdict. The next cell refuses loudly
        # if the profile is still held, which is the real safety net.
        log(f"  [runner] ⚠️ teardown failed: {type(_e).__name__}")


def run_entry(entry: dict, log=print) -> dict:
    """Run one staged cell. Its own exit code and stdout tail are the result."""
    cmd = entry.get("cmd") or []
    log(f"   ▶ {entry.get('id')}: {' '.join(cmd)}")
    started = datetime.datetime.now()
    ev = evidence_dir_for(entry.get("id") or "cell", started)
    # ⭐ The cell is TOLD where to put its own raw artifacts (a ring, a probe dump), so a
    # cell that has more than stdout to preserve can write it beside raw.txt without the
    # runner needing to know that cell's shape.
    env = {**os.environ, "UCT_EVIDENCE_DIR": str(ev)}
    try:
        ev.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    try:
        p = subprocess.run(cmd, cwd=str(REPO), capture_output=True, text=True, env=env,
                           encoding="utf-8", errors="replace", timeout=entry.get("timeout", 1800))
        out = (p.stdout or "") + (p.stderr or "")
        code = p.returncode
    except subprocess.TimeoutExpired as e:
        # ⛔⛔ KEEP WHAT THE RUN ALREADY SAID. `TimeoutExpired` CARRIES the output
        # captured before the kill, and this handler used to discard it and write
        # the literal string "TIMED OUT" instead.
        #
        # ⚰️ Measured 2026-09-18: a 2.8b run hit 1800s and its raw.txt held exactly
        # those two words — no cells, no swap-waits, not even the startup banner. I
        # read that emptiness as "it hung at startup"; the rig Chrome's own creation
        # timestamp proved it had started normally 3 seconds in.
        #
        # ⛔ R-RAW makes a run with no raw artifact INCONCLUSIVE, so this handler
        # turned every timeout into an unreadable one — and a timeout is PRECISELY
        # the run whose trail you most need.
        def _txt(v):
            if v is None:
                return ""
            return v if isinstance(v, str) else v.decode("utf-8", "replace")

        partial = _txt(getattr(e, "stdout", None)) + _txt(getattr(e, "stderr", None))
        budget = entry.get("timeout", 1800)
        if partial.strip():
            out = (partial
                   + "\n\n⛔ TIMED OUT after " + str(budget) + "s — the run was KILLED"
                   + " here. Everything above is what it had already said; what it"
                   + " would have said next is genuinely unknown.")
        else:
            # ⛔ An EMPTY capture is its own finding, and it is not "it hung".
            out = ("TIMED OUT after " + str(budget) + "s with NO captured output. "
                   "⛔ Check the child is LINE-BUFFERED before concluding anything: a"
                   " block-buffered child writes nothing into the pipe until it exits,"
                   " so a kill discards the lot and an entirely healthy run reads as a"
                   " hang at startup.")
        code = 124
        # ⛔⛔ A KILLED CELL LEAVES ITS BROWSER HOLDING THE PROFILE, AND THE
        # NEXT CELL THEN REFUSES TO START.
        #
        # ⚰️ Measured twice on 2026-09-18. A 2.8b run hit its ceiling; the
        # kill reached the PYTHON process and not the Chrome it had spawned,
        # so the four metadata cells behind it each died in ~7s with "the rig
        # profile is locked by a running Chrome". Four cells lost to one
        # timeout - and they refused CORRECTLY, which is why nothing looked
        # broken until the whole window had been spent.
        #
        # ⛔ BY MARKER, NEVER BY NAME. `chrome.exe` alone would take the
        # owner's 25 browser processes with it. The marker is the rig
        # profile path, which only the rig's own browser carries.
        # ⛔ THE PROFILE ITSELF IS NEVER TOUCHED: a fresh profile is a
        # SIGNED-OUT profile, and a sign-in is a 30-day event.
        try:
            _ps = shutil.which("powershell") or "powershell"
            subprocess.run(
                [_ps, "-NoProfile", "-Command",
                 "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
                 "Where-Object { $_.CommandLine -like '*canary-chrome-profile-persistent*' } | "
                 "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
                capture_output=True, timeout=60)
            print("  [runner] timed-out cell: tore down the rig browser BY MARKER "
                  "(profile kept) so the next cell can start", flush=True)
        except Exception as _e:                      # noqa: BLE001
            # ⛔ Teardown is best-effort and must never mask the timeout that
            # caused it. The next cell refuses loudly if this did not work.
            print(f"  [runner] ⚠️ teardown after timeout failed: {type(_e).__name__}",
                  flush=True)
    except Exception as e:  # noqa: BLE001
        out, code = f"{type(e).__name__}: {e}", 125
    secs = (datetime.datetime.now() - started).total_seconds()

    # ⛔⛔ R-RAW: BEFORE the verdict below. Everything after this line is a summary.
    ev_report = write_raw_evidence(ev, entry=entry, cmd=cmd, out=out, code=code,
                                   started=started, secs=secs)
    if ev_report["written"]:
        extra = sorted(f.name for f in ev.iterdir() if f.name not in ("raw.txt", "meta.json"))
        log(f"   💾 evidence: {_rel(ev)} "
            f"({ev_report['bytes']}B raw" + (f", +{len(extra)} artifact(s)" if extra else "") + ")")
    else:
        log(f"   ⛔ NO RAW ARTIFACT: {ev_report['why']} — this run is INCONCLUSIVE")
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
    # ⛔⛔ AND A TOOL THAT *SAYS* IT FAILED IS A FAILURE, WHATEVER IT EXITS.
    # ⚰️ 2026-09-14: the T-12 smoke reported "2 PASS, 3 FAIL … ⛔ FAIL at step(s)
    # 2, 3, STOP" and exited 0. The runner recorded it as `done · ok`. That is
    # the same defect as banking an INCONCLUSIVE on an exit code, one verdict
    # over — fixed for one word and left open for the other, which is how a
    # class survives its own fix.
    declared_fail = ("FAIL at step" in out) or ("⛔ FAIL" in out)
    # ⛔ R-RAW, enforced rather than asserted: no artifact on disk ⇒ INCONCLUSIVE,
    # whatever the console showed and whatever the cell exited.
    if not ev_report["written"]:
        inconclusive = True
        tail = f"INCONCLUSIVE — {ev_report['why']} (R-RAW) / {tail}"[:300]
    # ⛔⛔ AFTER EVERY CELL, NOT JUST A TIMED-OUT ONE. Measured 2026-09-19: a
    # cell that ended NORMALLY left nine rig Chrome processes holding the
    # profile, and the next two cells died in under 7s on "the rig profile is
    # locked by a running Chrome". The existing guard lived in the timeout
    # branch only — the fix had been put where the symptom was first seen
    # rather than where the cause lives.
    teardown_rig_browser(log)
    return {"exit": code, "seconds": round(secs, 1), "tail": tail,
            "inconclusive": inconclusive, "declared_fail": declared_fail,
            "evidence": _rel(ev), "evidence_ok": ev_report["written"]}


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
            elif res.get("declared_fail"):
                # It ran and it measured; it just failed. Not requeued - a retry
                # cannot fix a real FAIL - but never recorded as ok.
                entry["status"] = "failed"
                outcome = "FAILED (the tool declared it, exit code said 0)"
            elif res["exit"] == 0:
                entry["status"] = "done"
                outcome = "ok"
            else:
                entry["status"] = "failed"
                outcome = "exit " + str(res["exit"])
            entry["result"] = res
            # ⛔ Merge onto the CURRENT file — `q` is a pre-run snapshot and writing
            # it back would revert anything staged while the cell ran.
            save_entry(entry.get("id"), {
                "status": entry["status"],
                "attempts": entry["attempts"],
                "result": res,
            })
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
        # ── R-RAW: the evidence rail, both directions ────────────────────────────────
        # ⛔ A rule that writes a file is worthless unless the ABSENCE of that file
        # actually changes the verdict. Both cases are driven through the real run_entry.
        global EVIDENCE_ROOT  # noqa: PLW0603
        keep_ev = EVIDENCE_ROOT
        EVIDENCE_ROOT = pathlib.Path(tempfile.mkdtemp()) / "evidence"
        try:
            speaks = run_entry({"id": "selfcheck-speaks", "cmd":
                                [sys.executable, "-c", "print('a real cell said something')"]},
                               log=lambda *a, **k: None)
            assert speaks["evidence_ok"] is True, "a cell that printed was not preserved"
            assert speaks["inconclusive"] is False, "a preserved run must not read INCONCLUSIVE"
            raw = pathlib.Path(speaks["evidence"]) / "raw.txt"
            assert raw.exists() and raw.stat().st_size > 0, "raw.txt missing or empty"
            assert "said something" in raw.read_text(encoding="utf-8"), "raw.txt lost the output"

            # ⭐ THE CONTROL, and the one that matters: a cell that emits NOTHING leaves no
            # artifact, and R-RAW says that is INCONCLUSIVE however it exited. Without this
            # case the rule would be satisfied by any run at all.
            silent = run_entry({"id": "selfcheck-silent", "cmd": [sys.executable, "-c", "pass"]},
                               log=lambda *a, **k: None)
            assert silent["evidence_ok"] is False, "a silent cell was treated as preserved"
            assert silent["inconclusive"] is True, (
                "a run with NO raw artifact was not forced INCONCLUSIVE — R-RAW is decoration")
            assert "R-RAW" in silent["tail"], "the verdict does not say WHY it is inconclusive"
            assert silent["exit"] == 0, (
                "the control must have EXITED CLEANLY, or it proves nothing about a run that "
                "succeeded and preserved nothing")
        finally:
            EVIDENCE_ROOT = keep_ev

        print("self-check PASS — the ANOMALY rail fires, a normal row does not trip it, "
              "and a run with no raw artifact is forced INCONCLUSIVE (R-RAW)")
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
