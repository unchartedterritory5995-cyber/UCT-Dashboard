#!/usr/bin/env python3
"""Turn the owner's taps into triage rows. W2 / owner ruling R2 (2026-09-17).

    python tools/hub_reports_intake.py --db <path>            # read the volume directly
    python tools/hub_reports_intake.py --base https://...     # read through the admin endpoint
    python tools/hub_reports_intake.py --self-check           # prove the decoder can fail

⭐ WHY THIS EXISTS. The owner judged the hub unfit on real glass and will not type a bug list. W2
put a Report button on his phone; this turns the resulting table into something a session can act
on. **His note is the first field of every block, verbatim** — it is the only part a human wrote and
it must never be summarised, re-worded, or moved below the machine's opinion.

⛔ THE DECODER NEVER INVENTS INTENT. A trace says what FIRED; it cannot say what was WANTED. Only
the note can, and most reports will not have one. So a row is classified only where the registry
settles it, and everything else is UNDECIDED — an honest blank, not a guess dressed as a verdict.
This is the same rule `tools/hub_trace_analyze.py` follows and for the same reason.

⛔ AND A SLOW FLICK IS A TRANSPORT FINDING, NOT A PRODUCT ONE. `elapsed > flickMs` means the
pointer pair arrived outside the window. On a mirror that is the mirror (measured floor 260-427 ms
against a 120 ms window). On the owner's own phone it is a real finding about a real finger. The
row says which surface it came from and refuses to collapse the two.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REGISTRY = REPO / "app" / "src" / "hub" / "registry.js"


# ── the registry, ASKED rather than parsed ─────────────────────────────────────────────────────
APP = REPO / "app"

_DUMP_JS = """
import('./src/hub/registry.js').then((m) => {
  const out = {};
  for (const mode of Object.values(m.modesById || {})) {
    for (const a of (mode.fan || mode.actions || [])) {
      out[a.id] = {
        flickable: a.flickable !== false,
        ring: a.ring ?? null,
        kind: a.kind ?? null,
        mode: mode.id ?? null,
      };
    }
  }
  process.stdout.write(JSON.stringify(out));
}).catch((e) => { process.stderr.write(String(e && e.message || e)); process.exit(3); });
"""


def registry_actions(fake: dict | None = None) -> dict[str, dict]:
    """Every action the registry declares, ASKED OF THE MODULE.

    ⛔ NOT PARSED FROM SOURCE, AND THE REASON IS MEASURED. A regex over `registry.js` finds 25
    actions; importing the module finds **62** — the documented surface. Many actions are not
    literal `id:` lines in the file, so a source scan is structurally blind to them and would have
    silently decoded a third of the hub's surface as "not declared by the registry", i.e. as
    DEFECT rows. `lesson_grep_for_a_name_finds_one_ask_the_module_finds_ten`, and the repo's own
    precedent is the COT rail shelling out to node rather than re-implementing JS in Python.

    `fake` is for `--self-check` only; nothing else may inject.
    """
    if fake is not None:
        return dict(fake)
    proc = subprocess.run(["node", "--input-type=module", "-e", _DUMP_JS],
                          cwd=str(APP), capture_output=True, text=True, timeout=120)
    if proc.returncode != 0 or not proc.stdout.strip():
        raise RuntimeError(
            "could not read registry.js through node — refusing to fall back to a regex, which "
            f"would under-count the surface and manufacture DEFECT rows. stderr: {proc.stderr[:200]}")
    actions = json.loads(proc.stdout)
    if len(actions) < 50:
        # Non-vacuity: the documented surface is 10 modes / 62 actions. A short read means the
        # shape moved, and a decoder working from a short list calls real actions undeclared.
        raise RuntimeError(f"registry.js yielded only {len(actions)} actions — expected ~62. "
                           "The registry's shape changed; fix this reader before trusting a verdict.")
    return actions


# ── the decoder ────────────────────────────────────────────────────────────────────────────────
def classify_row(row: dict, actions: dict[str, dict]) -> tuple[str, str]:
    """(verdict, why) for one trace row. Verdicts: DEFECT / PASS / TRANSPORT / UNDECIDED."""
    decision = row.get("decision")
    target = row.get("target")
    elapsed = row.get("elapsed")
    flick_ms = row.get("flickMs")

    if decision is None and target is None:
        return "UNDECIDED", "no decision recorded on this row (a move or a down, not an outcome)"

    # A flick that arrived outside the window is about the TRANSPORT, not the product.
    if (isinstance(elapsed, (int, float)) and isinstance(flick_ms, (int, float))
            and elapsed > flick_ms and decision in {"flick", "flick-miss", "open"}):
        return "TRANSPORT", (f"the pointer pair took {elapsed:.0f} ms against a {flick_ms:.0f} ms "
                             f"window — outside it, so the engine is not what decided this")

    if target and target in actions and not actions[target]["flickable"] and decision != "fire":
        return "PASS", (f"{target} is declared flickable: false, so not firing on a flick is the "
                        f"registry's own rule, not a defect")

    if target and target not in actions:
        return "DEFECT", f"fired a target the registry does not declare: {target!r}"

    if decision == "fire" and target:
        return "UNDECIDED", (f"fired {target} — whether that was WANTED is not in the trace. "
                             f"The note is the only source of intent.")

    return "UNDECIDED", f"decision={decision!r} target={target!r}"


def block(rep: dict, actions: dict[str, dict]) -> str:
    p = rep.get("payload") or {}
    note = rep.get("note")
    tr = p.get("trace") or {}
    win = tr.get("window") or {}
    rows = tr.get("rows") or []
    vis = p.get("visibility") or {}
    dev = p.get("device") or {}

    lines = [
        "=" * 78,
        f"REPORT #{rep.get('id')}   {rep.get('user_email') or rep.get('user_id')}   "
        f"created_at={rep.get('created_at')}",
        "=" * 78,
        # ⛔ HIS WORDS FIRST, VERBATIM. Never summarised, never below the machine's opinion.
        f"  NOTE: {note if note else '(no note — a one-tap report; the context below is the report)'}",
        "",
        f"  page={p.get('page')!r}  mode={p.get('mode')!r}  stage={p.get('stage')}  "
        f"flags={p.get('flags')}",
        f"  viewport={dev.get('viewport')} dpr={dev.get('dpr')}",
        f"  hub visibility: present={vis.get('present')} hiddenAttr={vis.get('hiddenAttr')} "
        f"display={vis.get('display')!r} box={vis.get('box')}",
    ]

    if not rows:
        lines += ["", "  TRACE: none attached — gesture recording was OFF when this was filed.",
                  "         The note and the context above are the whole report. That is a valid",
                  "         report, not a broken one."]
    else:
        lines += ["", f"  TRACE: kept={win.get('kept')} recorded={win.get('recorded')} "
                      f"dropped={win.get('dropped')} seq {win.get('firstSeq')}..{win.get('lastSeq')}"]
        if win.get("dropped"):
            lines.append("         ⛔ DROPPED > 0 — the beginning of this capture is gone. A window "
                         "that lost rows cannot be read as a complete gesture sequence.")
        for r in rows:
            if r.get("decision") is None and r.get("target") is None:
                continue
            verdict, why = classify_row(r, actions)
            lines.append(f"    [{verdict:<9}] {r.get('type'):<12} decision={r.get('decision')!r} "
                         f"target={r.get('target')!r} elapsed={r.get('elapsed')}")
            lines.append(f"                 {why}")
    return "\n".join(lines)


# ── sources ────────────────────────────────────────────────────────────────────────────────────
def from_db(db: str, limit: int) -> list[dict]:
    with closing(sqlite3.connect(db)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, user_id, user_email, created_at, note, payload_json FROM hub_reports "
            "ORDER BY created_at DESC, id DESC LIMIT ?", (limit,)).fetchall()
    out = []
    for r in rows:
        try:
            payload = json.loads(r["payload_json"])
        except (ValueError, TypeError):
            payload = {"_unparseable": True}
        out.append({**dict(r), "payload": payload})
    return out


def self_check() -> int:
    """⛔ Prove the decoder can FAIL. A classifier nobody has watched separate two cases is not a
    classifier — it is a function that returns a string."""
    actions = registry_actions(fake={
        "journal.close": {"flickable": False, "ring": 0, "kind": "confirm", "mode": "journal"},
        "scan.chart": {"flickable": True, "ring": 0, "kind": "navigate", "mode": "scan"},
    })

    cases = [
        ({"decision": "open", "target": "journal.close", "elapsed": 90, "flickMs": 120}, "PASS"),
        ({"decision": "fire", "target": "scan.chart", "elapsed": 90, "flickMs": 120}, "UNDECIDED"),
        ({"decision": "flick", "target": "scan.chart", "elapsed": 310, "flickMs": 120}, "TRANSPORT"),
        ({"decision": "fire", "target": "ghost.action", "elapsed": 50, "flickMs": 120}, "DEFECT"),
        ({"decision": None, "target": None}, "UNDECIDED"),
    ]
    bad = []
    for row, want in cases:
        got, _why = classify_row(row, actions)
        if got != want:
            bad.append(f"  {row} -> {got}, expected {want}")
    if bad:
        print("self-check FAILED:\n" + "\n".join(bad))
        return 1
    # Non-vacuity: the four verdicts are genuinely distinguishable, not one answer four times.
    verdicts = {classify_row(r, actions)[0] for r, _ in cases}
    if len(verdicts) < 4:
        print(f"self-check FAILED: the decoder only ever says {verdicts}")
        return 1
    print("self-check PASSED — 4 distinct verdicts, each reached by the row that means it")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=os.environ.get("HUB_REPORTS_DB_PATH", "/data/hub_reports.db"))
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()

    if args.self_check:
        return self_check()

    if not Path(args.db).exists():
        print(f"no report table at {args.db} — nothing has been filed yet, or the path is wrong.")
        print("⛔ That is ABSENCE OF INTAKE, not absence of defects. Do not read it as good news.")
        return 0

    actions = registry_actions()
    reports = from_db(args.db, args.limit)
    if not reports:
        print(f"the table at {args.db} is EMPTY — nothing filed yet.")
        print("⛔ Absence of intake, not absence of defects.")
        return 0

    print(f"{len(reports)} report(s), newest first. Registry declares {len(actions)} actions.\n")
    for rep in reports:
        print(block(rep, actions))
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
