"""Study -- check the bank files against every owner ruling on a question or a chart example (repo side, no pod read).

WHY
---
docs/study/audits/NOTE_LEDGER.md section 14: about 300 of the owner's rulings are on single questions and chart
examples (bank passes 1 to 4, the fixtures, the scanner, the Go Signal hourly and the Bear gap sets). Each was applied
when it was made: a cut item is retired, a keep stays. This checks that the bank, as the repo holds it, still agrees:

* a KEEP (keep, keep_lesser, keep_failed_lesson, keep_with_note, good_setup_bad_result, okay, owner_chosen) names an item
  that is still in a bank file and on no retire list;
* a CUT (cut, cut_as_kicker, cut_as_kicker_batch, cut_as_peg) names no item left in a bank file that is not retired.

A ruling names its item by id, or by its setup, ticker and date (the bank passes); his latest keep or cut on an item
stands. One that names neither, or a verdict that is neither (pending, rule, note, finding ...), is counted and left
alone. Whether the LIVE database
agrees (approved, rejected) needs the pod; this is the repo half.

HOW TO RUN (local, read-only)
-----------------------------
  python -X utf8 scripts/study/check_rulings.py              # the summary and every disagreement
  python -X utf8 scripts/study/check_rulings.py --json out.json
"""
from __future__ import annotations

import argparse
import glob
import json
import pathlib
import sys
from collections import Counter

REPO = pathlib.Path(__file__).resolve().parents[2]
VERDICTS = REPO / "docs" / "study" / "audits" / "2026-10-24" / "owner_verdicts.jsonl"
KEEP = {"keep", "keep_lesser", "keep_failed_lesson", "keep_with_note", "good_setup_bad_result", "okay", "owner_chosen"}
CUT = {"cut", "cut_as_kicker", "cut_as_kicker_batch", "cut_as_peg"}
# the setup names the rulings use, to the skills the bank files carry
SETUPS = {"kicker": "setup.family3.kicker", "launchpad": "setup.family1.launchpad", "slingshot": "setup.family4.slingshot",
          "oops": "setup.family4.oops", "high volume edge": "setup.family3.hve", "hve": "setup.family3.hve",
          "gap support": "setup.family3.gap_support", "bear gap": "setup.family3.bear_gap", "go signal": "setup.intraday.go_signal"}


def skill_of(setup: str) -> str | None:
    s = str(setup or "").lower()
    return next((v for k, v in SETUPS.items() if k in s), None)


def bank_items() -> list[dict]:
    out = []
    for f in sorted(glob.glob(str(REPO / "docs" / "study" / "bank" / "*.json")) + glob.glob(str(REPO / "docs" / "study" / "bank_v2" / "*.json"))):
        try:
            data = json.loads(pathlib.Path(f).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        items = data.get("items", data) if isinstance(data, dict) else data
        for it in items if isinstance(items, list) else []:
            if not isinstance(it, dict) or not it.get("id"):
                continue
            spec = it.get("bars") if isinstance(it.get("bars"), dict) else {}
            out.append({"id": it["id"], "file": pathlib.Path(f).relative_to(REPO).as_posix(), "skill": it.get("skill_id"),
                        "sym": str(it.get("sym") or spec.get("sym") or "").upper(),
                        "asof": str(it.get("asof") or spec.get("asof") or "")[:10], "type": it.get("type")})
    return out


def retired_ids() -> set:
    out = set()
    for f in glob.glob(str(REPO / "docs" / "study" / "audits" / "*" / "retire*.json")):
        data = json.loads(pathlib.Path(f).read_text(encoding="utf-8"))
        ids = data.get("ids", data) if isinstance(data, dict) else data
        if isinstance(ids, dict):
            for v in ids.values():
                out.update(v)
        else:
            out.update(ids)
    return out


def check() -> dict:
    rulings = [json.loads(line) for line in VERDICTS.read_text(encoding="utf-8").splitlines() if line.strip()]
    bank = bank_items()
    by_id = {}
    for it in bank:
        by_id.setdefault(it["id"], []).append(it)
    retired = retired_ids()
    tally: Counter = Counter()
    problems = []
    # his LATEST keep or cut on an item stands (a provisional "Okay" on the full window, then "Cut" on the open close-up,
    # is a cut): earlier rulings on the same item are counted as superseded
    def key(r):
        iid = r.get("item") if r.get("item") not in (None, "None", "") else None
        return ("id", iid) if iid else ("chart", skill_of(r.get("setup")), str(r.get("sym") or "").upper(), str(r.get("asof") or "")[:10])
    last = {}
    for i, r in enumerate(rulings):
        if str(r.get("verdict") or "") in KEEP | CUT:
            last[key(r)] = i
    for i, r in enumerate(rulings):
        v = str(r.get("verdict") or "")
        if v not in KEEP and v not in CUT:
            tally["not a keep or a cut"] += 1
            continue
        if last.get(key(r)) != i:
            tally["superseded by a later ruling"] += 1
            continue
        iid = r.get("item") if r.get("item") not in (None, "None", "") else None
        if iid:
            found = by_id.get(iid, [])
            how = "id"
        elif r.get("sym") and r.get("asof"):
            sk = skill_of(r.get("setup"))
            sym, asof = str(r["sym"]).upper(), str(r["asof"])[:10]
            found = [it for it in bank if it["sym"] == sym and it["asof"] == asof and (sk is None or it["skill"] == sk)]
            how = "setup, ticker and date"
        else:
            tally["names no item"] += 1
            continue
        live = [it for it in found if it["id"] not in retired]
        ref = {"pass": r.get("pass"), "setup": r.get("setup"), "sym": r.get("sym"), "asof": r.get("asof"), "item": iid,
               "verdict": v, "owner_words": str(r.get("owner_words") or "")[:120], "matched_by": how}
        if v in KEEP:
            tally["keeps checked"] += 1
            if not found:
                # a keep the bank no longer carries under that id: it may have been re-cut under a new id (a re-draft)
                problems.append({**ref, "problem": "a keep with no item in the bank"})
            elif not live:
                problems.append({**ref, "problem": "a keep whose items are all retired", "items": [it["id"] for it in found]})
        else:
            tally["cuts checked"] += 1
            if live:
                problems.append({**ref, "problem": "a cut still in the bank and not retired", "items": [(it["id"], it["file"]) for it in live]})
    tally["problems"] = len(problems)
    return {"rulings": len(rulings), "bank_items": len(bank), "retired": len(retired), "tally": dict(tally), "problems": problems}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", default="", help="also write the full result here")
    args = ap.parse_args(argv)
    res = check()
    print(json.dumps({k: res[k] for k in ("rulings", "bank_items", "retired", "tally")}, indent=1))
    for p in res["problems"]:
        print(f"- {p['problem']}: pass {p['pass']} {p['setup']} {p['sym'] or ''} {p['asof'] or ''} {p['item'] or ''} "
              f"({p['verdict']}, by {p['matched_by']}) \"{p['owner_words']}\" {p.get('items', '')}")
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
