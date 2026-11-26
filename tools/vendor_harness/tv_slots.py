"""TradingView MULTI-SLOT capture: the lock protocol and the broker-owned browser (owner + TRADINGVIEW coordinator, 2026-11-26).

    python tools/vendor_harness/tv_slots.py status  --lock-dir D       # locks, claims, broker
    python tools/vendor_harness/tv_slots.py broker ensure --lock-dir D  # start the broker if none runs; print its endpoint
    python tools/vendor_harness/tv_slots.py broker serve  --lock-dir D  # (what `ensure` starts, detached)

⭐⭐ THE DESIGN (approved, implemented as written):
  * ONE broker-owned Chrome on the EXISTING capture profile (`pine_vendor_capture.resolve_profile()`), launched by
    Playwright exactly as `batch_capture._launch` launches it (same switches, same viewport, same channel) plus a
    remote-debugging port on 127.0.0.1. Started on demand (`ensure_broker`), closed when idle (`IDLE_S` with no slot
    claim) or at once when an exclusive holder is waiting and no slot job runs. ⛔ It never creates, deletes or replaces
    the profile, never signs out, never clears cookies: the profile is the ONE TradingView sign-in (a 30-day owner event).
  * THREE SLOTS (A, B, C) = three WINDOWS of that one browser, each job driving its own (`batch_capture._launch_cdp`).
    Each slot is bound to its own saved layout (`batch_capture.SLOT_LAYOUTS`).
  * LOCKS, all in ONE directory (the directory of the legacy `tv.lock`), always taken INSIDE heavy_lock:
      tv.lock              the WHOLE-BROWSER lock. Held EXCLUSIVELY by clean-save, repair and sign-in (and by every tool
                           that knows nothing of slots: it O_EXCL-creates the file and waits while it exists), or held
                           by the GROUP of running slot jobs, when its text starts with `SHARED_MARK`. So a slot-unaware
                           tool waits for every slot job to end, and no slot job starts while it holds the file.
      tv.shared.d/<pid>-<slot>   one SHARED claim per slot job (the pids it names: the wrapper and its batch child).
                           The last claim to leave removes a shared tv.lock.
      tv.exclusive.want    an aware exclusive taker's intent: while it exists (and its pid lives) NO new slot claim is
                           made; the taker waits until tv.shared.d is empty, then takes tv.lock.
      tvslotA/B/C.lock     which slot a job drives (at most one job per slot, so at most `MAX_SLOT_JOBS` at once).
      tv.meta.lock         a short mutex around every read-modify-write of the above.
      tvbroker.lock / tvbroker.json   the broker's start/stop mutex and its state (pids, endpoint).
  ⛔ LOCK ORDER: heavy_lock FIRST, then these (the reverse deadlocked 81 minutes on 2026-11-26).
  ⛔ A claim is reclaimed only on POSITIVE evidence: every pid it names is dead.
  ⚠️ A slot-unaware tool cannot announce that it waits, so back-to-back slot jobs could keep it waiting; the aware
  exclusive path (`TvLocks.take_exclusive`, used by tv_run.py) blocks new claims while it waits.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import pathlib
import random
import subprocess
import sys
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent

SLOTS = ("A", "B", "C")
MAX_SLOT_JOBS = len(SLOTS)
LOCK_NAME = "tv.lock"
SHARED_DIR = "tv.shared.d"
WANT_NAME = "tv.exclusive.want"
META_NAME = "tv.meta.lock"
BROKER_LOCK = "tvbroker.lock"
BROKER_STATE = "tvbroker.json"
#: the first word of a tv.lock held by the slot GROUP. A legacy holder writes its own tag ("tv_run …", "b1_copy …"),
#: never this word, so any other text is an EXCLUSIVE holder.
SHARED_MARK = "shared-slots"
#: a job below this much AVAILABLE physical RAM stops itself (the design's floor, and heavy_lock's shared floor)
MIN_FREE_RAM_BYTES = 3 * 1024 ** 3
#: the broker closes after this long with no slot claim
IDLE_S = 90.0
DEFAULT_PORT = 9333
META_STALE_S = 30.0


def slot_lock_name(slot: str) -> str:
    return f"tvslot{slot}.lock"


# ─── processes and memory ────────────────────────────────────────────────────
def pid_alive(pid) -> bool:
    """True when `pid` names a running process. Unreadable: True (never reclaim on doubt)."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return ctypes.GetLastError() == 5            # ACCESS_DENIED: it exists
        try:
            code = ctypes.c_ulong()
            if not k32.GetExitCodeProcess(h, ctypes.byref(code)):
                return True
            return code.value == 259                     # STILL_ACTIVE
        finally:
            k32.CloseHandle(h)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def free_ram_bytes():
    """AVAILABLE physical RAM in bytes (what Task Manager calls available), or None when it cannot be read."""
    try:
        if os.name == "nt":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MS()
            m.dwLength = ctypes.sizeof(MS)
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
                return None
            return int(m.ullAvailPhys)
        with open("/proc/meminfo", encoding="ascii") as fh:
            for line in fh:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
    except Exception:  # noqa: BLE001 -- unreadable is "no"
        return None
    return None


def ram_refusal(min_bytes=MIN_FREE_RAM_BYTES, read=None):
    """None when a slot job may run, else why not. An unreadable figure is a refusal."""
    got = (read or free_ram_bytes)()
    if got is None:
        return "free RAM could not be read"
    if got < min_bytes:
        return f"free RAM {got / 1024 ** 3:.2f} GB is under the {min_bytes / 1024 ** 3:.0f} GB a slot job needs"
    return None


# ─── the lock protocol ───────────────────────────────────────────────────────
def _read(path: pathlib.Path):
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _create_excl(path: pathlib.Path, text: str) -> bool:
    try:
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except (FileExistsError, PermissionError):    # Windows: a file pending delete answers PermissionError: still held
        return False
    try:
        os.write(fd, text.encode("utf-8"))
    finally:
        os.close(fd)
    return True


def _unlink(path) -> bool:
    """Remove `path`; True when it is gone. ⚰️ On Windows an unlink fails while ANOTHER process or thread has the file open
    (a reader of the mutex, 2026-11-26: the swallowed failure orphaned tv.meta.lock and every taker waited out its 30 s
    staleness), so a sharing violation is retried for up to ~2 s before it is given up."""
    for _ in range(100):
        try:
            pathlib.Path(path).unlink()
            return True
        except FileNotFoundError:
            return True
        except PermissionError:
            time.sleep(0.02)
        except OSError:
            return False
    return False


def _pids_of(text) -> list:
    """The pids a claim names: `pid=<n>` tokens (several: the wrapper and its child)."""
    out = []
    for tok in str(text or "").split():
        if tok.startswith("pid="):
            try:
                out.append(int(tok[4:]))
            except ValueError:
                pass
    return out


def is_shared(text) -> bool:
    parts = str(text or "").split()
    return bool(parts) and parts[0] == SHARED_MARK


class Timeout(Exception):
    pass


class TvLocks:
    """The protocol above over one directory. `alive(pid)` and `sleep(s)` are injectable (the rails)."""

    def __init__(self, lock_dir, pid=None, alive=pid_alive, sleep=time.sleep, poll_s=2.0, now=time.time):
        self.dir = pathlib.Path(lock_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.pid = int(pid if pid is not None else os.getpid())
        self.alive, self.sleep, self.poll_s, self.now = alive, sleep, float(poll_s), now
        self.lock = self.dir / LOCK_NAME
        self.shared = self.dir / SHARED_DIR
        self.want = self.dir / WANT_NAME
        self.meta_path = self.dir / META_NAME
        self.extra_pids = []

    # ── the mutex ──
    @contextlib.contextmanager
    def meta(self, timeout_s=60.0):
        deadline = self.now() + timeout_s
        while not _create_excl(self.meta_path, f"pid={self.pid} at={self.now():.3f}"):
            try:
                age = self.now() - self.meta_path.stat().st_mtime
            except OSError:
                continue
            # read the holder only once it has held a while: a reader holding the file open is what makes the holder's
            # own unlink fail on Windows (`_unlink`)
            text = _read(self.meta_path) if age > 2.0 else None
            pids = _pids_of(text)
            if (pids and not any(self.alive(p) for p in pids)) or age > META_STALE_S:
                _unlink(self.meta_path)
                continue
            if self.now() >= deadline:
                raise Timeout(f"{META_NAME} held: {text!r}")
            self.sleep(random.uniform(0.002, 0.03))   # jittered: a fixed beat lost the mutex to a busier poller
        try:
            yield
        finally:
            _unlink(self.meta_path)

    # ── readings ──
    def _claim_alive(self, text) -> bool:
        pids = _pids_of(text)
        return any(self.alive(p) for p in pids) if pids else True

    def live_claims(self, prune=True) -> list:
        """The live shared claims (file names). Under `meta`, a claim whose every pid is dead is removed."""
        if not self.shared.exists():
            return []
        out = []
        for p in sorted(self.shared.iterdir()):
            if self._claim_alive(_read(p)):
                out.append(p.name)
            elif prune:
                _unlink(p)
        return out

    def want_live(self) -> bool:
        text = _read(self.want)
        if text is None:
            return False
        if self._claim_alive(text):
            return True
        _unlink(self.want)
        return False

    def holder(self):
        """('free' | 'shared' | 'exclusive', text)."""
        text = _read(self.lock)
        if text is None:
            return "free", None
        return ("shared" if is_shared(text) else "exclusive"), text

    def _pid_tokens(self):
        return " ".join(f"pid={p}" for p in [self.pid, *self.extra_pids])

    # ── slot jobs ──
    def try_join(self, slot) -> tuple:
        """(True, None) when a shared claim was made, else (False, why)."""
        with self.meta():
            if self.want_live():
                return False, f"an exclusive taker is waiting ({_read(self.want)!r})"
            if (self.shared / f"{self.pid}-{slot}").exists():
                return False, f"this process already claims slot {slot}"
            state, text = self.holder()
            if state == "exclusive":
                return False, f"tv.lock is held exclusively ({text!r})"
            if state == "free" and not _create_excl(self.lock, f"{SHARED_MARK} since={self.now():.0f}"):
                return False, "tv.lock was taken a moment ago"
            self.shared.mkdir(exist_ok=True)
            (self.shared / f"{self.pid}-{slot}").write_text(f"{self._pid_tokens()} slot={slot} at={self.now():.0f}",
                                                             encoding="utf-8")
            return True, None

    def leave(self, slot) -> None:
        with self.meta():
            _unlink((self.shared / f"{self.pid}-{slot}"))
            self._drop_shared_if_empty()

    def _drop_shared_if_empty(self) -> bool:
        """(under meta) A shared tv.lock with no live claim is removed. True when it was."""
        state, _ = self.holder()
        if state == "shared" and not self.live_claims():
            _unlink(self.lock)
            return True
        return False

    def slot_busy(self, slot) -> bool:
        text = _read(self.dir / slot_lock_name(slot))
        return text is not None and self._claim_alive(text)

    def try_slot(self, slot) -> bool:
        path = self.dir / slot_lock_name(slot)
        for _ in range(2):
            if _create_excl(path, f"{self._pid_tokens()} at={self.now():.0f}"):
                return True
            text = _read(path)
            if text is not None and not self._claim_alive(text):
                _unlink(path)                 # every pid it names is dead: reclaimed, then tried once more
                continue
            return False
        return False

    def add_pid(self, slot, pid) -> None:
        """Name the batch CHILD in this job's claims too: the claim then lives while either process lives."""
        self.extra_pids.append(int(pid))
        tokens = self._pid_tokens()
        with self.meta():
            p = self.shared / f"{self.pid}-{slot}"
            if p.exists():
                p.write_text(f"{tokens} slot={slot} at={self.now():.0f}", encoding="utf-8")
        sp = self.dir / slot_lock_name(slot)
        if self.pid in _pids_of(_read(sp)):
            sp.write_text(f"{tokens} at={self.now():.0f}", encoding="utf-8")

    def claim(self, slot=None, timeout_s=3600.0, log=print) -> str:
        """Join the slot group and take `slot` (or the first free one). Waits; raises Timeout."""
        want = [slot] if slot else list(SLOTS)
        for s in want:
            if s not in SLOTS:
                raise ValueError(f"slot {s!r} is not one of {SLOTS}")
        deadline = self.now() + timeout_s
        last = None
        while True:
            why = None
            for s in want:
                if self.slot_busy(s):
                    why = f"slot {s} is busy"
                    continue
                ok, why = self.try_join(s)
                if not ok:
                    break
                if self.try_slot(s):
                    return s
                self.leave(s)
                why = f"slot {s} is busy"
            if why != last:
                log(f"[slots] waiting: {why}")
                last = why
            if self.now() >= deadline:
                raise Timeout(f"no slot in {want} within {timeout_s:.0f}s: {why}")
            self.sleep(self.poll_s)

    def release(self, slot) -> None:
        path = self.dir / slot_lock_name(slot)
        if self.pid in _pids_of(_read(path)):
            _unlink(path)
        self.leave(slot)

    @contextlib.contextmanager
    def slot_job(self, slot=None, timeout_s=3600.0, log=print):
        s = self.claim(slot, timeout_s, log)
        try:
            yield s
        finally:
            self.release(s)

    # ── the exclusive whole-browser lock ──
    def take_exclusive(self, label, timeout_s=3600.0, log=print, wait_broker=True) -> None:
        """Announce (`tv.exclusive.want`: no new slot claim from now), wait until no slot claim lives, take tv.lock
        exclusively, then (`wait_broker`) wait until the broker's browser is gone, so the profile is free."""
        deadline = self.now() + timeout_s
        last = None
        while not _create_excl(self.want, f"pid={self.pid} label={label} at={self.now():.0f}"):
            if not self.want_live():
                continue
            if self.now() >= deadline:
                raise Timeout(f"another exclusive taker waits: {_read(self.want)!r}")
            self.sleep(self.poll_s)
        try:
            while True:
                with self.meta():
                    claims = self.live_claims()
                    if not claims:
                        self._drop_shared_if_empty()
                        if _create_excl(self.lock, f"{label} pid={self.pid} at={self.now():.0f}"):
                            break
                        why = f"tv.lock held: {_read(self.lock)!r}"
                    else:
                        why = f"{len(claims)} slot claim(s) still run: {claims}"
                if why != last:
                    log(f"[slots] exclusive {label!r} waiting: {why}")
                    last = why
                if self.now() >= deadline:
                    raise Timeout(f"exclusive {label!r}: {why}")
                self.sleep(self.poll_s)
        finally:
            if self.pid in _pids_of(_read(self.want)):
                _unlink(self.want)
        if wait_broker:
            while broker_alive(self.dir, self.alive):
                if self.now() >= deadline:
                    self.release_exclusive()
                    raise Timeout("the broker's browser did not close")
                self.sleep(self.poll_s)

    def release_exclusive(self) -> None:
        if self.pid in _pids_of(_read(self.lock)) and not is_shared(_read(self.lock)):
            _unlink(self.lock)

    @contextlib.contextmanager
    def exclusive(self, label, timeout_s=3600.0, log=print, wait_broker=True):
        self.take_exclusive(label, timeout_s, log, wait_broker)
        try:
            yield
        finally:
            self.release_exclusive()

    def status(self) -> dict:
        state, text = self.holder()
        return {"tvLock": state, "tvLockText": text, "claims": self.live_claims(prune=False),
                "slots": {s: _read(self.dir / slot_lock_name(s)) for s in SLOTS},
                "want": _read(self.want), "broker": broker_state(self.dir)}


# ─── the broker ──────────────────────────────────────────────────────────────
def broker_state(lock_dir):
    try:
        return json.loads((pathlib.Path(lock_dir) / BROKER_STATE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def broker_alive(lock_dir, alive=pid_alive) -> bool:
    st = broker_state(lock_dir)
    return bool(st and (alive(st.get("pid")) or (st.get("browserPid") and alive(st.get("browserPid")))))


def endpoint_answers(endpoint, timeout=3.0) -> bool:
    try:
        with urllib.request.urlopen(f"{endpoint}/json/version", timeout=timeout) as r:
            return r.status == 200 and "Browser" in json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return False


def _write_json_atomic(path: pathlib.Path, obj) -> None:
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(obj, indent=1), encoding="utf-8")
    os.replace(tmp, path)


@contextlib.contextmanager
def _broker_mutex(lock_dir, timeout_s=180.0):
    path = pathlib.Path(lock_dir) / BROKER_LOCK
    deadline = time.time() + timeout_s
    while not _create_excl(path, f"pid={os.getpid()} at={time.time():.0f}"):
        pids = _pids_of(_read(path))
        if pids and not any(pid_alive(p) for p in pids):
            _unlink(path)
            continue
        if time.time() >= deadline:
            raise Timeout(f"{BROKER_LOCK} held: {_read(path)!r}")
        time.sleep(0.2)
    try:
        yield
    finally:
        _unlink(path)


def ensure_broker(lock_dir, port=DEFAULT_PORT, channel="chrome", profile=None, wait_s=90.0, log=print) -> dict:
    """The running broker's state, starting one (detached) when none answers. ⛔ Call it holding a slot claim: the broker
    closes when no claim lives, and the claim is what keeps an exclusive holder from launching on the profile."""
    lock_dir = pathlib.Path(lock_dir)
    with _broker_mutex(lock_dir):
        st = broker_state(lock_dir)
        if st and not st.get("closing") and pid_alive(st.get("pid")) and endpoint_answers(st["endpoint"]):
            return st
        if st and pid_alive(st.get("pid")):
            raise RuntimeError(f"a broker process runs but does not answer ({st}); not starting a second one")
        cmd = [sys.executable, "-u", str(pathlib.Path(__file__).resolve()), "broker", "serve", "--lock-dir", str(lock_dir),
               "--port", str(port), "--channel", channel]
        if profile:
            cmd += ["--profile", str(profile)]
        logf = open(lock_dir / "tvbroker.log", "a", encoding="utf-8")
        flags = 0
        if os.name == "nt":
            flags = 0x00000008 | 0x00000200          # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        try:
            proc = subprocess.Popen(cmd, stdout=logf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                    creationflags=flags, close_fds=True, cwd=str(lock_dir))
        finally:
            logf.close()
        log(f"[slots] broker starting (pid {proc.pid}, port {port})")
        deadline = time.time() + wait_s
        while time.time() < deadline:
            st = broker_state(lock_dir)
            if st and st.get("pid") == proc.pid and endpoint_answers(st["endpoint"]):
                return st
            if proc.poll() is not None:
                raise RuntimeError(f"the broker exited with {proc.returncode} before it answered (see tvbroker.log)")
            time.sleep(1.0)
        raise RuntimeError(f"the broker did not answer within {wait_s:.0f}s (see tvbroker.log)")


def _browser_pid(port):
    """The Chrome BROWSER process listening on `port`, named by its command line (reported, never killed)."""
    if os.name != "nt":
        return None
    q = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like "
         f"'*--remote-debugging-port={port}*' -and $_.CommandLine -notlike '*--type=*' }} | "
         "ForEach-Object { $_.ProcessId }")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", q], capture_output=True, text=True, timeout=30)
        pids = [int(x) for x in (out.stdout or "").split() if x.strip().isdigit()]
        return pids[0] if len(pids) == 1 else None
    except Exception:  # noqa: BLE001
        return None


def broker_answers_dialog(dialog, log=print) -> str:
    """⭐⭐ THE ONE ANSWER to every JavaScript dialog of the broker's browser (its context listener): beforeunload accepted,
    anything else dismissed (Playwright's own defaults). Slot jobs listen and never answer
    (`batch_capture._slot_never_answers_dialog`).
    ⚰️ (16:56Z, round 2 of the live A/B) the broker had NO listener, so its Playwright DRIVER answered on its own, and an
    answer that lost the race to another client ("No dialog is showing") was an unhandled rejection in the driver: the
    driver died, and the browser it had launched died with it, under every running slot (C: TargetClosedError at its
    fresh-load reload). Answered here, from the client, a lost race is a caught error, logged, and the broker lives on.
    Returns what happened (the rails read it)."""
    kind = getattr(dialog, "type", None)
    try:
        if kind == "beforeunload":
            dialog.accept()
            return "accepted"
        dialog.dismiss()
        return "dismissed"
    except Exception as exc:  # noqa: BLE001 -- another client answered first: nothing to do, the browser must live
        with contextlib.suppress(Exception):
            log(f"[broker] a {kind} dialog was already answered ({type(exc).__name__}: {str(exc)[:120]})")
        return "lost"


def broker_should_close(claims, exclusive_waits, idle_for_s, idle_s=IDLE_S):
    """None while the broker must stay, else why it closes. ⛔ A LIVE SLOT CLAIM ALWAYS KEEPS IT: the browser is shared
    by every running slot job, so it closes only once the LAST claim has left (and then on idle, or at once for a
    waiting exclusive holder). A job ends its run by closing its own window, never the browser."""
    if claims:
        return None
    if exclusive_waits:
        return "an exclusive holder waits"
    if idle_for_s >= idle_s:
        return f"idle {idle_s:.0f}s"
    return None


def broker_launch_options(channel=None, port=DEFAULT_PORT) -> dict:
    """`batch_capture._launch`'s launch options, verbatim, plus the debugging port (a rail compares the two)."""
    import batch_capture as bc
    launch = dict(headless=False, viewport=dict(bc.RIG_VIEWPORT),
                  args=["--window-position=40,40", f"--remote-debugging-port={int(port)}"])
    if channel:
        launch["channel"] = channel
    return launch


def serve(lock_dir, port=DEFAULT_PORT, channel="chrome", profile=None, idle_s=IDLE_S, poll_s=2.0) -> int:
    """The broker: launch the browser, publish its endpoint, close it when idle. Never deletes the profile."""
    sys.path.insert(0, str(HERE))
    sys.path.insert(0, str(HERE.parent))
    import batch_capture as bc
    from pine_vendor_capture import _profile_holders, resolve_profile
    lock_dir = pathlib.Path(lock_dir)
    locks = TvLocks(lock_dir)
    prof = resolve_profile(profile)
    bc.refuse_owner_browser_profile(prof)
    if not prof.exists():
        print(f"[broker] REFUSED: the capture profile {prof} does not exist; the broker never creates one (sign in "
              "through the exclusive path first)", flush=True)
        return 2
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        try:
            ctx = p.chromium.launch_persistent_context(str(prof), **broker_launch_options(channel, port))
        except Exception as exc:  # noqa: BLE001
            print(f"[broker] LAUNCH FAILED: {type(exc).__name__}: {exc}", flush=True)
            for line in _profile_holders(prof):
                print(f"[broker]   {line}", flush=True)
            return 2
        # ⛔ the ONE client that answers dialogs, registered before any slot window can open (`broker_answers_dialog`)
        ctx.on("dialog", lambda dialog: broker_answers_dialog(dialog))
        endpoint = f"http://127.0.0.1:{int(port)}"
        state = {"pid": os.getpid(), "browserPid": _browser_pid(port), "port": int(port), "endpoint": endpoint,
                 "profile": prof.name, "startedAtUTC": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "closing": False}
        _write_json_atomic(lock_dir / BROKER_STATE, state)
        print(f"[broker] up: {json.dumps(state)}", flush=True)
        last_busy = time.time()
        why = "?"
        own = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            while True:
                if not ctx.pages and not endpoint_answers(endpoint):
                    why = "the browser went away"
                    break
                with locks.meta():
                    claims = locks.live_claims()
                    locks._drop_shared_if_empty()             # heals a shared tv.lock whose jobs all died
                    exclusive_waits = locks.want_live() or locks.holder()[0] == "exclusive"
                if claims:
                    last_busy = time.time()
                closing = broker_should_close(claims, exclusive_waits, time.time() - last_busy, idle_s)
                if closing:
                    with _broker_mutex(lock_dir):
                        with locks.meta():
                            if locks.live_claims():
                                continue                     # a job claimed while we decided: stay
                        state["closing"] = True
                        _write_json_atomic(lock_dir / BROKER_STATE, state)
                        why = closing
                        ctx.close()
                        _unlink((lock_dir / BROKER_STATE))
                    break
                # ⚰️ (11:08Z, the first live A/B) a `time.sleep` here starved THIS client's event loop: Playwright attaches
                # to every new target (each slot window, its workers and frames) and holds it until the client resumes
                # it, so the slot windows' navigation never reached domcontentloaded and the Pine editor never opened.
                # Waiting through Playwright keeps the loop running and every target is resumed at once.
                if own.is_closed():
                    own = ctx.new_page()                     # the broker keeps one page of its own (never a slot's)
                own.wait_for_timeout(poll_s * 1000)
        finally:
            with contextlib.suppress(Exception):
                ctx.close()
            st = broker_state(lock_dir)
            if st and st.get("pid") == os.getpid():
                _unlink((lock_dir / BROKER_STATE))
    print(f"[broker] closed: {why}", flush=True)
    bc.report_profile_lock(prof)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    st = sub.add_parser("status")
    st.add_argument("--lock-dir", required=True)
    b = sub.add_parser("broker")
    b.add_argument("action", choices=["ensure", "serve"])
    b.add_argument("--lock-dir", required=True)
    b.add_argument("--port", type=int, default=DEFAULT_PORT)
    b.add_argument("--channel", default="chrome")
    b.add_argument("--profile", default=None)
    b.add_argument("--idle-s", type=float, default=IDLE_S)
    a = ap.parse_args(argv)
    if a.cmd == "status":
        print(json.dumps(TvLocks(a.lock_dir).status(), indent=1))
        return 0
    if a.action == "serve":
        return serve(a.lock_dir, a.port, a.channel, a.profile, a.idle_s)
    print(json.dumps(ensure_broker(a.lock_dir, a.port, a.channel, a.profile)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
