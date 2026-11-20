"""Stamp a capability row of api/data/pine_runtime_allowlist.json with the engine its evidence was graded at.

    python tools/pine_coverage/stamp_admission.py <capability> [<capability> ...]   # after regrading at TODAY's engine
    python tools/pine_coverage/stamp_admission.py --check                          # what the rail checks, as a report

Why (2026-11-18): the A8 rail (tests/test_pine_capability_admission.py) checked that each evidence id EXISTS in the
runtime-on snapshot and grades MATCH, never WHICH engine graded it. The snapshots were last regenerated at engine 78
(f9a976fb47) while master shipped 80, so a new row could have been admitted on evidence two engines old.

The stamp is `"admission": {"scriptEngineVersion": N, "rowSha256": <digest>}` on each admitted row:
  * N is the engine of the runtime-on snapshot the row was checked against; this tool REFUSES to stamp unless that
    snapshot was graded at the CURRENT engine (SCRIPT_ENGINE_VERSION), so a new or changed row needs fresh evidence;
  * rowSha256 covers the row's admission-relevant fields (`DIGEST_FIELDS`, not `note`), so a copied stamp, or an
    edit to the evidence after stamping, no longer matches and the rail names the row. No git history is needed.
An engine bump does NOT invalidate a stamped row: it was valid when admitted (coordinator ruling).

⛔ The allowlist is hand-formatted, so a stamp is a TEXT edit of one line (`"admitted": true,` keeps its place and
the stamp goes on the line after it). The file is never round-tripped through a serialiser.

`--seed` (2026-11-18 only, coordinator ruling C2): stamps every admitted row that has NO stamp yet at the snapshot's
own engine (78), the engine its A8 check passed against. It never re-stamps a stamped row.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALLOWLIST = ROOT / "api" / "data" / "pine_runtime_allowlist.json"
SNAPSHOT_RT = ROOT / "docs" / "pine" / "vendor-harness" / "runtime-on" / "verdicts.json"
ENGINE_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "scriptEngineVersion.js"
#: The fields whose change makes a row a different admission. `note` is prose and is left out on purpose.
DIGEST_FIELDS = ("admitted", "status", "scope", "sha256", "evidence")


def row_digest(row: dict) -> str:
    """sha256 over the admission-relevant fields of one capability row, canonical JSON. The ONE definition."""
    body = {k: row.get(k) for k in DIGEST_FIELDS if k in row}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode("utf-8")).hexdigest()


def current_engine() -> int:
    """SCRIPT_ENGINE_VERSION as declared in scriptEngineVersion.js (the server reads the same line)."""
    m = re.search(r"^export const SCRIPT_ENGINE_VERSION = (\d+)\s*$", ENGINE_JS.read_text(encoding="utf-8"), re.M)
    if not m:
        raise SystemExit(f"stamp_admission: no SCRIPT_ENGINE_VERSION line in {ENGINE_JS}")
    return int(m.group(1))


def snapshot_engine(path: Path = SNAPSHOT_RT) -> int | None:
    v = json.loads(path.read_text(encoding="utf-8")).get("scriptEngineVersion")
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _row_span(text: str, cap: str) -> tuple[int, int]:
    """(start, end) character offsets of capability `cap`'s object inside the "capabilities" block."""
    cstart = text.index('\n  "capabilities": {')
    m = re.compile(r'\n    "' + re.escape(cap) + r'": \{').search(text, cstart)
    if not m:
        raise SystemExit(f"stamp_admission: capability {cap!r} not found")
    nxt = re.compile(r'\n    "[^"\n]+": \{|\n  \}').search(text, m.end())
    return m.start(), (nxt.start() if nxt else len(text))


def stamp_text(text: str, cap: str, engine: int, digest: str) -> str:
    """The allowlist text with `cap`'s stamp line written (replaced if present), nothing else changed."""
    a, b = _row_span(text, cap)
    block = text[a:b]
    line = f'      "admission": {{"scriptEngineVersion": {engine}, "rowSha256": "{digest}"}},'
    if re.search(r'\n      "admission": \{[^\n]*\},?', block):
        block = re.sub(r'\n      "admission": \{[^\n]*\},?', "\n" + line, block, count=1)
    else:
        anchor = '\n      "admitted": true,'
        if block.count(anchor) != 1:
            raise SystemExit(f"stamp_admission: {cap!r} has no single `\"admitted\": true,` line to stamp after")
        block = block.replace(anchor, anchor + "\n" + line, 1)
    return text[:a] + block + text[b:]


def stamp(caps: list[str], *, seed: bool = False, allowlist: Path = ALLOWLIST, snapshot: Path = SNAPSHOT_RT,
          engine_now: int | None = None) -> list[str]:
    """Stamp `caps` (or, with seed, every unstamped admitted row). Returns the capabilities stamped.
    Raises SystemExit, writing NOTHING, when the snapshot is not at the current engine (outside seed)."""
    now = current_engine() if engine_now is None else engine_now
    snap = snapshot_engine(snapshot)
    if snap is None:
        raise SystemExit(f"stamp_admission: {snapshot} carries no scriptEngineVersion: regenerate it")
    if not seed and snap != now:
        raise SystemExit(f"stamp_admission: REFUSED - the runtime-on snapshot was graded at engine {snap}, "
                         f"today's engine is {now}. Regenerate it (both lanes) first, then stamp.")
    text = allowlist.read_text(encoding="utf-8")
    rows = json.loads(text)["capabilities"]
    if seed:
        caps = [c for c, r in rows.items() if isinstance(r, dict) and r.get("admitted") is True and "admission" not in r]
    done = []
    for cap in caps:
        row = rows.get(cap)
        if not isinstance(row, dict) or row.get("admitted") is not True:
            raise SystemExit(f"stamp_admission: {cap!r} is not an admitted row")
        text = stamp_text(text, cap, snap, row_digest(row))
        done.append(cap)
    json.loads(text)                                  # the result must still parse, or nothing is written
    tmp = allowlist.with_suffix(".json.tmp")
    tmp.write_text(text, encoding="utf-8", newline="")
    os.replace(tmp, allowlist)
    return done


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("caps", nargs="*")
    ap.add_argument("--seed", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    if a.check:
        rows = json.loads(ALLOWLIST.read_text(encoding="utf-8"))["capabilities"]
        for cap, row in rows.items():
            if isinstance(row, dict) and row.get("admitted") is True:
                st = row.get("admission") or {}
                ok = st.get("rowSha256") == row_digest(row)
                print(f"{cap:28} engine {st.get('scriptEngineVersion')!s:>4}  {'ok' if ok else 'CHANGED or UNSTAMPED'}")
        print(f"snapshot engine {snapshot_engine()}, today's engine {current_engine()}")
        return 0
    if not a.caps and not a.seed:
        ap.error("name the capabilities to stamp, or --seed")
    print("stamped:", ", ".join(stamp(a.caps, seed=a.seed)) or "(nothing)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
