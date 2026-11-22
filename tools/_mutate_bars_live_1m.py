"""Mutation harness for live 1m coverage on the serving tier (BARS_LIVE_1M_ENABLED).

Same discipline as `tools/_mutate_bars_integrity.py`:
  * THE VERDICT IS A BARE EXIT CODE (no pipe, no capture).
  * CONTROL A runs first and aborts on zero collected tests or a red control.
  * Every mutation is PROVEN APPLIED (sha changes AND the new text is present) and
    PROVEN RESTORED (sha back to the original) — restored from the copy saved before
    the edit (in memory, plus an on-disk backup for a crash), NEVER `git checkout`.
  * `python -B` + a pycache purge, so a stale .pyc can never stand in for the edit.

Run from the repo root:  python -B tools/_mutate_bars_live_1m.py
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

LF = chr(10)
CRLF = chr(13) + chr(10)
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

SUITE = [
    "tests/test_bars_live_1m.py",
    "tests/test_bars_live_ingest.py",
    "tests/test_bars_live_store.py",
    "tests/test_bars_review_followups.py",
]

STORE = "api/services/bars_live_store.py"
FWD = "api/services/bars_live_ingest.py"
READ = "api/services/bars_fetch.py"

#: (label, path, old, new). `old` must appear EXACTLY once.
MUTATIONS = [
    ("store: ingest writes every ticker's minutes, covered or not", STORE,
     "        if sym in _covered1:\n            out.append((sym, mts) + row)",
     "        if True:\n            out.append((sym, mts) + row)"),
    ("store: the provider beats the stream (the overlay is skipped)", STORE,
     "        if rows:\n            _write_rows(\"1\", rows)",
     "        if False:\n            _write_rows(\"1\", rows)"),
    ("store: the race rewrite is skipped", STORE,
     "    if stale:\n        _rewrite1(sym, epoch)",
     "    if False:\n        _rewrite1(sym, epoch)"),
    ("store: 1m coverage survives a new epoch", STORE,
     "    again = _covered1 | _repairing1\n    _covered1.clear()",
     "    again = _covered1 | _repairing1\n    pass"),
    ("forwarder: the 1m flag is ignored", FWD,
     "    if enabled_1m():\n        payload[\"m1\"]",
     "    if True:\n        payload[\"m1\"]"),
    ("store: the 1m flag is ignored", STORE,
     "    \"\"\"1m coverage: its own flag, and only on top of the coverage flag.\"\"\"\n    return enabled() and",
     "    \"\"\"1m coverage: its own flag, and only on top of the coverage flag.\"\"\"\n    return enabled() or"),
    ("store: covered ignores whether minutes are flowing", STORE,
     "            return stream_alive() and m1_alive()\n        _want1(sym)",
     "            return stream_alive()\n        _want1(sym)"),
    ("read: _needs_fresh never consults 1m coverage", READ,
     "    if ticker and tf in (\"1\", \"5\", \"D\"):",
     "    if ticker and tf in (\"5\", \"D\"):"),
    ("read: the stream proof does not verify a 1m tail", READ,
     "    if tf in (\"1\", \"5\"):\n        try:",
     "    if tf == \"5\":\n        try:"),
    ("read: the 1m boundary grace is a whole minute", READ,
     "_LIVE_PROOF_BOUNDARY_GRACE_1M_S = 30", "_LIVE_PROOF_BOUNDARY_GRACE_1M_S = 60"),
    ("store: the recent-minutes ring is never pruned", STORE,
     "    floor = newest - RECENT1_S\n    for k in sorted(_recent1):",
     "    floor = newest - RECENT1_S\n    return\n    for k in sorted(_recent1):"),
    ("store: the repair writes the forming minute", STORE,
     "    closed = [b for b in bars if int(b[\"t\"]) < now_min]",
     "    closed = list(bars)"),
    ("store: a gap note is ignored (always the depth)", STORE,
     "    if gap is not None and gap >= floor:\n        frm, kind = gap, \"repairs_gap\"",
     "    if False:\n        frm, kind = gap, \"repairs_gap\""),
    ("store: a same-socket restart forgets 1m coverage", STORE,
     "        for sym in r.get(\"covered1\") or ():\n            _covered1.add(sym)",
     "        for sym in r.get(\"covered1\") or ():\n            pass"),
    ("store: stream minutes outside the extended session are written", STORE,
     "        if mts % MINUTE_S or not _in_eth(mts):",
     "        if mts % MINUTE_S:"),
    ("store: a warm sweep queues repairs (interactive check dropped)", STORE,
     "        if not bars_fetch._request_is_interactive():\n            return",
     "        if False:\n            return"),
    ("forwarder: m1 leaves out the boundary bucket", FWD,
     "    for sym in b0_syms:\n        for t_ms, (o, h, l, c, v) in sorted((_b0_minutes.get(sym) or {}).items()):\n"
     "            out.append(",
     "    for sym in ():\n        for t_ms, (o, h, l, c, v) in sorted((_b0_minutes.get(sym) or {}).items()):\n"
     "            out.append("),
    ("store: the 1m proof's watermark never advances", STORE,
     "                if payload.get(\"watermark_ms\"):\n                    _s1[\"m1_watermark_ms\"]",
     "                if False:\n                    _s1[\"m1_watermark_ms\"]"),
    ("store: a push without m1 keeps 1m coverage", STORE,
     "        if _covered1:\n            _s1[\"feed_lost\"] += 1",
     "        if False:\n            _s1[\"feed_lost\"] += 1"),
    ("store: a failed repair is re-queued at once", STORE,
     "                    _retry1_after[sym] = _now_mono() + RETRY1_S",
     "                    pass"),
]


def _sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _purge_pycache() -> None:
    for top in ("api", "tests"):
        for base, dirs, _files in os.walk(os.path.join(ROOT, top)):
            for d in list(dirs):
                if d == "__pycache__":
                    shutil.rmtree(os.path.join(base, d), ignore_errors=True)
                    dirs.remove(d)


def _run_suite() -> int:
    """Bare exit code. NO pipe, NO capture — the verdict is the status."""
    _purge_pycache()
    return subprocess.run(
        [sys.executable, "-B", "-m", "pytest", *SUITE, "-q", "-x", "--tb=no",
         "-p", "no:cacheprovider", "-p", "no:randomly", "--no-header"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


def _collected() -> int:
    out = subprocess.run(
        [sys.executable, "-B", "-m", "pytest", *SUITE, "--collect-only", "-q",
         "-p", "no:cacheprovider", "-p", "no:randomly", "--color=no"],
        cwd=ROOT, capture_output=True, text=True, errors="replace")
    return len([ln for ln in out.stdout.splitlines() if "::" in ln])


def main() -> int:
    print("CONTROL A - the suite, unmutated")
    n = _collected()
    print(f"  collected: {n}")
    if n == 0:
        print("  ABORT: zero tests collected; every verdict below would be a lie")
        return 2
    rc = _run_suite()
    print(f"  exit code: {rc}")
    if rc != 0:
        print("  ABORT: the control is not green")
        return 2

    backup_dir = tempfile.mkdtemp(prefix="mutate_live_1m_")
    print(f"  backups of every mutated file: {backup_dir}")
    rows, survivors = [], []
    for label, rel, old, new in MUTATIONS:
        path = os.path.join(ROOT, rel)
        before = _sha(path)
        with open(path, "r", encoding="utf-8", newline="") as f:
            src = f.read()
        shutil.copy2(path, os.path.join(backup_dir, os.path.basename(path)))
        eol = CRLF if CRLF in src else LF   # anchors use LF; the tree may be CRLF
        old_e, new_e = old.replace(LF, eol), new.replace(LF, eol)
        count = src.count(old_e)
        if count != 1:
            print(f"\n{label}\n  ABORT: anchor appears {count}x in {rel}")
            return 2
        try:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(src.replace(old_e, new_e))
            with open(path, "r", encoding="utf-8", newline="") as f:
                applied = _sha(path) != before and new_e in f.read()
            if not applied:
                print(f"\n{label}\n  ABORT: the mutation did not reach the file")
                return 2
            rc = _run_suite()
        finally:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(src)
            if _sha(path) != before:
                raise SystemExit(f"ABORT: {rel} was not restored (backup in {backup_dir})")
        verdict = "RED (killed)" if rc else "GREEN (SURVIVED)"
        print(f"\n{label}\n  file: {rel}\n  exit code: {rc} -> {verdict}\n  restored: True")
        rows.append((label, verdict))
        if rc == 0:
            survivors.append(label)

    _purge_pycache()
    print(f"\n{len(MUTATIONS) - len(survivors)}/{len(MUTATIONS)} mutations went red")
    for s in survivors:
        print(f"  SURVIVED: {s}")
    return 1 if survivors else 0


if __name__ == "__main__":
    raise SystemExit(main())
