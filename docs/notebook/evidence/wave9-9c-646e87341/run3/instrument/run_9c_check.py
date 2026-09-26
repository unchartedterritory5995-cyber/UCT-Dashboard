"""Drive lane 9C's browser check end to end, ONE sandbox, stopped gracefully.

  1. refuse if C:\\data-9c already exists (then the dir this run deletes is provably its own);
  2. start `export/soak_sandbox_boot.py` through the perf harness's `_SHIM` (a no-op SIGBREAK
     handler, so uvicorn's re-raise cannot skip the launcher's `finally`), in its OWN process
     group, `--data-dir C:\\data-9c --port 8206 --host 127.0.0.1`, cwd = the export;
  3. wait for the integrity log path, /api/health 200, and the +15 s and +120 s checkpoints —
     all CLEAN — before a single browser request;
  4. run `w9c_browser_check.py` (it verifies the sandbox identity nonce itself);
  5. CTRL_BREAK to the process group, wait for the exit and the SHUTDOWN checkpoint;
  6. copy the integrity log + the launcher log into the evidence dir, write sandbox-run.json.
The data dir is deleted afterwards, separately, after a non-recursive ownership check.
"""
import importlib.util
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

S = pathlib.Path(__file__).resolve().parent
EXPORT = S / "export"
WT = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\notebook-w9-soak")
TIP = os.environ.get("W9C_TIP", "90e6a35d3")
OUT = WT / "docs" / "notebook" / "evidence" / f"wave9-9c-{TIP}" / os.environ.get("W9C_RUN", "run2")
DATA = r"C:\data-9c"
PORT = 8206
BASE = f"http://127.0.0.1:{PORT}"

spec = importlib.util.spec_from_file_location("nph", EXPORT / "tools" / "notebook_perf_harness.py")
nph = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nph)
PRE = "pre-boot (baseline)"

rec = {"tip": TIP, "export": str(EXPORT), "data_dir": DATA, "port": PORT, "events": []}


def ev(msg, **kw):
    rec["events"].append({"t": time.strftime("%H:%M:%S"), "msg": msg, **kw})
    print(time.strftime("%H:%M:%S"), msg, json.dumps(kw)[:300] if kw else "", flush=True)


def labels(path):
    return [c["label"] for c in nph.read_integrity(path, [])["checkpoints"]] if path else []


REUSE_AFTER = os.environ.get("W9C_REUSE_DATA_CREATED_AFTER")   # e.g. "2026-09-25 23:03:14"
if os.path.exists(DATA):
    import datetime as _dt
    created = _dt.datetime.fromtimestamp(os.stat(DATA).st_ctime)
    if not REUSE_AFTER or created < _dt.datetime.fromisoformat(REUSE_AFTER):
        print(f"REFUSED: {DATA} already exists and is not the dir a named earlier run of this lane created")
        sys.exit(3)
    rec["data_dir_existed_before"] = True
    rec["data_dir_reused"] = (f"created {created.isoformat(sep=' ', timespec='seconds')}, after "
                              f"{REUSE_AFTER} (an earlier run of this lane); a NEW participant account "
                              "keeps T1 on an empty account")
else:
    rec["data_dir_existed_before"] = False
OUT.mkdir(parents=True, exist_ok=True)
log = S / "launcher.log"
cmd = [sys.executable, "-u", "-c", nph._SHIM, str(EXPORT / "soak_sandbox_boot.py"),
       "--data-dir", DATA, "--port", str(PORT), "--host", "127.0.0.1"]
with open(log, "w", encoding="utf-8") as fh:
    proc = subprocess.Popen(cmd, cwd=str(EXPORT), stdout=fh, stderr=subprocess.STDOUT,
                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
ev("launcher started", pid=proc.pid, cmd=cmd[:1] + ["-u", "-c", "<_SHIM>"] + cmd[4:])
integ = None
browser_rc = None
try:
    end = time.time() + 90
    while time.time() < end and proc.poll() is None and not integ:
        text = log.read_text(encoding="utf-8", errors="replace")
        for line in text.splitlines():
            m = nph._INTEGRITY_PATH_RE.search(line)
            if m:
                integ = m["path"]
        time.sleep(0.5)
    ev("integrity log", path=integ)
    if not integ:
        raise SystemExit("the launcher never printed its integrity log path")
    healthy = False
    end = time.time() + 300
    while time.time() < end and proc.poll() is None:
        try:
            with urllib.request.urlopen(BASE + "/api/health", timeout=3) as r:
                if r.status == 200:
                    healthy = True
                    break
        except Exception:  # noqa: BLE001 -- not up yet
            pass
        time.sleep(0.5)
    ev("/api/health", healthy=healthy)
    if not healthy:
        raise SystemExit("the sandbox never answered /api/health 200")
    mounted = [ln for ln in log.read_text(encoding="utf-8", errors="replace").splitlines() if "[9C] mounted" in ln]
    ev("soak router mount line", line=mounted[0].strip() if mounted else None)
    end = time.time() + 240
    while time.time() < end and proc.poll() is None and not {nph.POST_BOOT, nph.PREWARM} <= set(labels(integ)):
        time.sleep(1.0)
    pre = nph.read_integrity(integ, [PRE, nph.POST_BOOT, nph.PREWARM])
    rec["integrity_before_browser"] = pre
    ev("checkpoints before the browser", line=nph.integrity_line(pre))
    if not pre["clean"]:
        raise SystemExit("the sandbox's checkpoints are not CLEAN -- no browser request is sent")
    blog = S / "browser-check.log"
    with open(blog, "w", encoding="utf-8") as bfh:
        b = subprocess.run([sys.executable, "-u", str(S / "w9c_browser_check.py"), "--base", BASE,
                            "--export", str(EXPORT), "--integrity-log", integ, "--out", str(OUT),
                            "--tip", TIP], stdout=bfh, stderr=subprocess.STDOUT, timeout=3600)
    browser_rc = b.returncode
    ev("browser check finished", rc=browser_rc)
finally:
    stop_how = None
    if proc.poll() is None:
        try:
            proc.send_signal(signal.CTRL_BREAK_EVENT)
            ev("CTRL_BREAK sent to the launcher's process group")
            # Run 1: the launcher's `finally` wrote a CLEAN shutdown checkpoint 9 s after the
            # break, then the process lingered ~170 s on the app's non-daemon background threads
            # (stock_brief / enrichment work still running after uvicorn stopped). So: wait for
            # the SHUTDOWN checkpoint first, then give the exit 60 s, then terminate -- and say
            # which of those happened.
            end, cp_at = time.time() + 180, None
            while time.time() < end and proc.poll() is None:
                if cp_at is None and integ and nph.SHUTDOWN in labels(integ):
                    cp_at = time.time()
                    ev("shutdown checkpoint written; waiting for the process to exit")
                if cp_at is not None and time.time() - cp_at > 60:
                    break
                time.sleep(0.5)
            if proc.poll() is not None:
                stop_how = f"graceful (rc {proc.returncode})"
            else:
                proc.terminate()
                proc.wait(timeout=30)
                stop_how = ("terminated 60 s AFTER its shutdown checkpoint was written (the launcher's "
                            "finally ran; the process lingered on background threads)" if cp_at
                            else "FORCED after 180 s -- no shutdown checkpoint was written")
        except (OSError, ValueError) as e:
            proc.terminate()
            proc.wait(timeout=30)
            stop_how = f"FORCED: CTRL_BREAK could not be delivered ({type(e).__name__}: {e})"
    else:
        stop_how = f"exited on its own (rc {proc.returncode})"
    rec["stop"] = stop_how
    ev("launcher stopped", how=stop_how)
    final = nph.read_integrity(integ, [PRE, nph.POST_BOOT, nph.PREWARM, nph.SHUTDOWN]) if integ else None
    rec["integrity_final"] = final
    if final:
        ev("final integrity", line=nph.integrity_line(final))
        shutil.copyfile(integ, OUT / ("sandbox-integrity-" + pathlib.Path(integ).name))
    shutil.copyfile(log, OUT / "sandbox-launcher.log")
    if (S / "browser-check.log").exists():
        shutil.copyfile(S / "browser-check.log", OUT / "browser-check.console.log")
    (OUT / "instrument").mkdir(exist_ok=True)
    for name in ("w9c_browser_check.py", "run_9c_check.py", "soak_sandbox_boot.py"):
        shutil.copyfile(S / name, OUT / "instrument" / name)
    pdf = OUT / "fixture-synthetic-10q.pdf"
    if pdf.exists():
        pdf.unlink()   # generated by the check; not committed (no *.pdf attribute + autocrlf)
    rec["browser_rc"] = browser_rc
    (OUT / "sandbox-run.json").write_text(json.dumps(rec, indent=1, default=str), encoding="utf-8")
