"""Wave 13 lane 13D -- the mutation proof for the resurfacing rails.

Each mutation breaks ONE load-bearing property, runs the rail(s) that claim to guard it, and
expects them RED; then the file is restored from the bytes captured before the mutation and the
restore is verified against the COMMITTED blob (`git cat-file blob HEAD:<path>`, CR-normalised),
never against the capture alone (CLAUDE.md: a sha proves the capture, not that the capture was
the original). Never `git checkout`.

A CONTROL run of every named rail on the unmutated tree comes first and must be GREEN -- a rail
that is red before the mutation proves nothing by being red after it.

Each pytest child gets a FRESH `PYTHONPYCACHEPREFIX`, so a same-length mutation can never be
masked by a stale .pyc (lesson_python_pycache_defeats_same_length_mutation).

    python tools/notebook_w13d_mutation.py --out docs/notebook/evidence/wave13-13d/mutation-<sha>.json

Exit 0 = control green and every mutation killed; 1 = a mutation survived or the control was red;
2 = a restore could not be verified (STOP: the tree is not what was committed).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
T = "tests/test_awareness_resurface.py"

MUTATIONS = [
    {
        "id": "M1-R1-edited",
        "claim": "R1-R6 are byte-identical (S7 is absorbing them)",
        "path": "api/services/awareness/rules.py",
        "old": "NEAR_STOP_PCT = 0.03  # 3%",
        "new": "NEAR_STOP_PCT = 0.04  # 3%",
        "rails": [f"{T}::test_R1_to_R6_source_is_byte_identical_to_the_pre_13D_blob",
                  f"{T}::test_R1_to_R6_output_is_unchanged_on_a_fixture"],
    },
    {
        "id": "M2-subcap-uses-shared-count",
        "claim": "a full shared 8/day budget never blocks a resurfacing; the sub-cap is 2",
        "path": "api/services/voice_proactive_service.py",
        "old": "        if kind in RESURFACE_KINDS:\n",
        "new": "        if False:\n",
        "rails": [f"{T}::test_with_the_shared_cap_full_a_resurfacing_still_fires_and_the_sub_cap_is_two"],
    },
    {
        "id": "M3-shared-count-includes-resurfacing",
        "claim": "resurfacing rows never spend a shared slot",
        "path": "api/services/voice_proactive_service.py",
        "old": "WHERE user_id = ? AND created_at >= ? AND kind NOT IN ({marks})",
        "new": "WHERE user_id = ? AND created_at >= ? AND (kind NOT IN ({marks}) OR 1)",
        "rails": [f"{T}::test_resurfacing_rows_never_spend_a_shared_slot"],
    },
    {
        "id": "M4-touch-band-widened",
        "claim": "R7 fires inside the 0.5% band and not just off it",
        "path": "api/services/awareness/rules.py",
        "old": "NOTE_TOUCH_BAND_PCT = 0.005",
        "new": "NOTE_TOUCH_BAND_PCT = 0.006",
        "rails": [f"{T}::test_R7_fires_inside_the_band_and_not_just_off_it"],
    },
    {
        "id": "M5-big-move-threshold-lowered",
        "claim": "R8 fires at 8% and not just under",
        "path": "api/services/awareness/rules.py",
        "old": "NOTE_BIG_MOVE_PCT = 8.0",
        "new": "NOTE_BIG_MOVE_PCT = 7.9",
        "rails": [f"{T}::test_R8_fires_at_8_percent_and_not_just_under"],
    },
    {
        "id": "M6-resurface-through-the-delivering-path",
        "claim": "no deliver_alert_payload is reachable from resurfacing",
        "path": "api/services/awareness/engine.py",
        "old": "    insight_id, _importance = _queue_candidate(user_id, candidate)\n    if insight_id is None:\n        return False  # the sub-cap",
        "new": "    insight_id, _importance = (1 if _fire_candidate(user_id, candidate) else None), 0\n    if insight_id is None:\n        return False  # the sub-cap",
        "rails": [f"{T}::test_no_deliver_alert_payload_is_reachable_even_at_importance_10"],
    },
    {
        "id": "M7-ledger-ignored",
        "claim": "one per level per day (a second cross the same day is silent)",
        "path": "api/services/awareness/engine.py",
        "old": "        if note_levels.already_fired(conn, user_id, candidate.fire_key, day_et, once=candidate.once):",
        "new": "        if False and note_levels.already_fired(conn, user_id, candidate.fire_key, day_et, once=candidate.once):",
        "rails": [f"{T}::test_a_new_day_rearms_the_level"],
    },
    {
        "id": "M8-purge-misses-the-index",
        "claim": "account purge covers j2_note_levels",
        "path": "api/services/journal_two/account_purge.py",
        "old": '    "j2_note_levels",\n',
        "new": "",
        "rails": [f"{T}::test_account_purge_takes_both_tables_and_only_that_member"],
    },
    {
        "id": "M9-flag-gate-removed",
        "claim": "inert while the flag is off",
        "path": "api/services/awareness/engine.py",
        "old": "    if _note_resurface_enabled():\n        try:\n            result[\"resurface\"]",
        "new": "    if True:\n        try:\n            result[\"resurface\"]",
        "rails": [f"{T}::test_flag_off_the_pass_never_runs_and_no_link_is_attached"],
    },
    {
        "id": "M10-a-second-level-reader",
        "claim": "levels are read only through plan_extract",
        "path": "api/services/journal_two/note_levels.py",
        "old": "        levels = plan_note_levels(body_json, properties_json, prop_defs, symbol)\n",
        "new": ("        import re as _re\n"
                "        levels = [{'shape': 'text', 'role': m.group(1).lower(), 'price': float(m.group(2))}\n"
                "                  for m in _re.finditer(r'(Entry|Stop|Target): (\\d+)', json.dumps(body_json))]\n"),
        "rails": [f"{T}::test_levels_come_only_from_plan_extract"],
    },
]


def _norm(b: bytes) -> bytes:
    return b.replace(b"\r\n", b"\n")


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _committed(path: str) -> bytes:
    r = subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", f"HEAD:{path}"],
                       capture_output=True, check=True)
    if not r.stdout:
        raise RuntimeError(f"git cat-file returned nothing for {path}")
    return r.stdout


def _pytest(nodes: list[str]) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    env["PYTHONPYCACHEPREFIX"] = tempfile.mkdtemp(prefix="w13d-mut-pyc-")
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    t0 = time.time()
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *nodes],
                       cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=900)
    out = (r.stdout or "") + (r.stderr or "")
    totals = [ln for ln in out.splitlines() if (" passed" in ln or " failed" in ln) and " in " in ln]
    return {"rc": r.returncode, "totals": totals[-1] if totals else None, "seconds": round(time.time() - t0, 1),
            "tail": out[-1500:]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True,
                          text=True, check=True).stdout.strip()
    record = {"tool": "tools/notebook_w13d_mutation.py", "head": head, "control": None, "mutations": []}

    all_rails = sorted({n for m in MUTATIONS for n in m["rails"]})
    control = _pytest(all_rails)
    record["control"] = {"rails": all_rails, **control}
    print(f"CONTROL rc={control['rc']} {control['totals']}")
    if control["rc"] != 0 or not control["totals"]:
        record["verdict"] = "CONTROL RED -- nothing below would mean anything"
        Path(args.out).write_text(json.dumps(record, indent=1), encoding="utf-8")
        return 1

    survived = []
    for m in MUTATIONS:
        p = REPO / m["path"]
        original = p.read_bytes()
        if _sha(_norm(original)) != _sha(_norm(_committed(m["path"]))):
            raise SystemExit(f"STOP: {m['path']} differs from HEAD before mutating -- commit first")
        text = original.decode("utf-8")
        crlf = "\r\n" in text
        lf = text.replace("\r\n", "\n")
        if lf.count(m["old"]) != 1:
            raise SystemExit(f"STOP: {m['id']}: the mutation's anchor occurs {lf.count(m['old'])} times")
        mutated = lf.replace(m["old"], m["new"])
        if crlf:
            mutated = mutated.replace("\n", "\r\n")
        try:
            p.write_bytes(mutated.encode("utf-8"))
            res = _pytest(m["rails"])
        finally:
            p.write_bytes(original)
        restored_ok = _sha(_norm(p.read_bytes())) == _sha(_norm(_committed(m["path"])))
        killed = res["rc"] != 0 and bool(res["totals"]) and " failed" in (res["totals"] or "")
        row = {"id": m["id"], "claim": m["claim"], "path": m["path"], "rails": m["rails"],
               "killed": killed, "restored_verified_against_HEAD": restored_ok, **res}
        record["mutations"].append(row)
        print(f"{m['id']}: {'KILLED' if killed else 'SURVIVED'} ({res['totals']}); restore "
              f"{'verified' if restored_ok else 'NOT VERIFIED'}")
        if not restored_ok:
            record["verdict"] = f"STOP: {m['path']} restore not verified against HEAD"
            Path(args.out).write_text(json.dumps(record, indent=1), encoding="utf-8")
            return 2
        if not killed:
            survived.append(m["id"])

    record["verdict"] = ("PASS: control green, " f"{len(MUTATIONS)} of {len(MUTATIONS)} killed"
                         if not survived else f"FAIL: survived {survived}")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(record, indent=1), encoding="utf-8")
    print("VERDICT:", record["verdict"])
    return 0 if not survived else 1


if __name__ == "__main__":
    sys.exit(main())
