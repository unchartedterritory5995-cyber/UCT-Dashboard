"""S7 alert taxonomy — the arming and disagreement state of EVERY type, in one read.

WHY THIS EXISTS
───────────────
`docs/terminal-research/10-roadmap/s7-alerts-completion-plan.md` §1 carries an ordering
table written 2026-09-11 that marks two of the seven types merged and five "to do". The
code moved past it: all seven have a `*_compare.py` AND a `*_projection.py`, and on
2026-09-25 six of the seven were observing real spans. A hand-typed status table beside
the system it describes is the drift this repo pays for over and over
(`lesson_a_second_authority_over_one_value`), so this derives the status instead.

⛔ THE TYPE LIST IS NEVER TYPED HERE. It comes back from the report itself, which builds
it from `dark_report.known_types()`. A type added tomorrow appears the day it lands, and a
typo cannot silently drop one from the inventory.

⛔ WHAT `legacy_only` MEANS, because the number is the whole point. From
`price_level_compare.py`'s own docstring: *"the legacy twin fired, the dark side did not →
a LOST member alert on flip"*, counted per TICK. `new_only` is an EXTRA alert on flip.
`not_comparable` is neither — it is "no honest comparison existed", and folding it into
`agreed` is exactly the flattering error `CoverageLine` exists to prevent. So this prints
all four, always, and NEVER a pass rate.

⚰️ AND IT PRINTS `predicate_count` AND `legacy_only` FIRST-CLASS BECAUSE EVERY RECORDED
DARK READ IN THIS PROGRAM OMITTED THE SECOND. On 2026-09-25 the price-level report carried
2,344 `legacy_only` on one predicate while the program's own records said "agreed 1,
new_only 0" and stopped there. A four-outcome receipt reported as two outcomes is a
one-sided receipt.

⛔ ZERO PREDICATES IS NOT AUTOMATICALLY A DEFECT. `indicator-condition` is sequenced behind
D2 by the completion plan's §2b, so zero is its CORRECT state. This tool reports the fact
and refuses to grade it — which of the silent types is legitimately silent is a question
for the plan, not for a counter.

USAGE
─────
    python tools/s7_arming_inventory.py                  # against production, admin read
    python tools/s7_arming_inventory.py --json out.json  # keep the raw report
    python tools/s7_arming_inventory.py --self-check     # prove the verdicts can fail

Reads as the synthetic smoke admin (`SMOKE_EMAIL`/`SMOKE_PASSWORD` from the environment,
never printed, never logged). No member id is emitted: predicate ids are truncated and the
arming census already emits counts for members and names only for definitions.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

BASE = "https://uctintelligence.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/128.0 Safari/537.36 s7-arming-inventory")
REPORT_PATH = "/api/admin/alert-taxonomy/dark-report"

OUTCOMES = ("agreed", "new_only", "legacy_only", "not_comparable")


def summarize(all_types: dict) -> dict:
    """Pure: a raw dark-report-all payload → the inventory. Separated from the fetch so
    `--self-check` can prove every verdict without a network or a browser."""
    rows = []
    for name, d in sorted((all_types or {}).items()):
        preds = d.get("predicates") or []
        totals = {k: sum(int(p.get(k) or 0) for p in preds) for k in OUTCOMES}
        arming = d.get("arming")
        silent_defs = None
        if isinstance(arming, dict) and "error" not in arming:
            silent_defs = len(arming.get("armed_but_never_compared") or [])
        rows.append({
            "alert_type": name,
            "predicate_count": int(d.get("predicate_count") or 0),
            "ready": sum(1 for p in preds if p.get("verdict_ready")),
            **totals,
            "observing": bool(d.get("predicate_count")),
            "disagreements": totals["legacy_only"] + totals["new_only"],
            "arming": arming if isinstance(arming, dict) else None,
            "armed_but_never_compared": silent_defs,
            # The predicates carrying a disagreement, NAMED (truncated ids) — a count
            # alone sends the next reader back to the raw JSON to find which one.
            "disagreeing": sorted(
                ({"predicate": (p.get("predicate_id") or "")[-14:],
                  "legacy_only": int(p.get("legacy_only") or 0),
                  "new_only": int(p.get("new_only") or 0),
                  "agreed": int(p.get("agreed") or 0),
                  "sessions": len(p.get("sessions_covered") or [])
                  if isinstance(p.get("sessions_covered"), list)
                  else int(p.get("sessions_covered") or 0)}
                 for p in preds if (p.get("legacy_only") or p.get("new_only"))),
                key=lambda x: -(x["legacy_only"] + x["new_only"])),
        })
    return {
        "types": rows,
        "type_count": len(rows),
        "observing": [r["alert_type"] for r in rows if r["observing"]],
        "silent": [r["alert_type"] for r in rows if not r["observing"]],
        "with_a_disagreement": [r["alert_type"] for r in rows if r["disagreements"]],
        "totals": {k: sum(r[k] for r in rows) for k in OUTCOMES},
        "predicates": sum(r["predicate_count"] for r in rows),
    }


def render(inv: dict) -> str:
    out = [f"{'alert type':24} {'preds':>5} {'ready':>5} {'agreed':>7} {'new_only':>8} "
           f"{'legacy_only':>11} {'not_cmp':>7}  arming"]
    for r in inv["types"]:
        a = r["arming"]
        arm = "-"
        if isinstance(a, dict):
            arm = ("ERROR" if "error" in a else
                   f"subs {a.get('subscriptions')} · members {a.get('members')} · "
                   f"silent {r['armed_but_never_compared']}")
        out.append(f"{r['alert_type']:24} {r['predicate_count']:>5} {r['ready']:>5} "
                   f"{r['agreed']:>7} {r['new_only']:>8} {r['legacy_only']:>11} "
                   f"{r['not_comparable']:>7}  {arm}")
    t = inv["totals"]
    out += [
        "",
        f"{inv['type_count']} types · {inv['predicates']} predicates · "
        f"agreed {t['agreed']} · new_only {t['new_only']} · legacy_only {t['legacy_only']} "
        f"· not_comparable {t['not_comparable']}",
        f"OBSERVING ({len(inv['observing'])}/{inv['type_count']}): "
        f"{', '.join(inv['observing']) or 'none'}",
        f"ZERO PREDICATES ({len(inv['silent'])}/{inv['type_count']}): "
        f"{', '.join(inv['silent']) or 'none'}",
        "  ⛔ zero is not automatically a defect — `indicator-condition` is sequenced "
        "behind D2 (completion plan §2b), so zero is its CORRECT state. This tool reports "
        "the fact and does not grade it.",
        f"DISAGREEMENTS ({len(inv['with_a_disagreement'])} type(s)): "
        f"{', '.join(inv['with_a_disagreement']) or 'none'}",
    ]
    for r in inv["types"]:
        for d in r["disagreeing"]:
            out.append(f"  {r['alert_type']}: …{d['predicate']} legacy_only={d['legacy_only']} "
                       f"new_only={d['new_only']} agreed={d['agreed']} sessions={d['sessions']}")
    out.append("  (legacy_only = a LOST member alert on flip · new_only = an EXTRA one · "
               "not_comparable = no honest comparison existed, NEVER folded into agreed)")
    return "\n".join(out)


def fetch(base: str) -> dict:
    email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
    if not (email and pw):
        raise SystemExit("INCONCLUSIVE: SMOKE_EMAIL/SMOKE_PASSWORD not in the environment")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(user_agent=UA)
        pg = ctx.new_page()
        try:
            r = pg.request.post(f"{base}/api/auth/login",
                                data=json.dumps({"email": email, "password": pw}),
                                headers={"Content-Type": "application/json"})
            if r.status != 200:
                raise SystemExit(f"INCONCLUSIVE: login returned {r.status}")
            resp = pg.request.get(f"{base}{REPORT_PATH}")
            if resp.status != 200:
                raise SystemExit(f"INCONCLUSIVE: {REPORT_PATH} returned {resp.status}")
            return resp.json()
        finally:
            ctx.close(); b.close()


def self_check() -> int:
    """Rule 14: prove each verdict can FAIL, with no network and no browser."""
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad += 0 if ok else 1

    clean = {"predicate_count": 2, "predicates": [
        {"predicate_id": "legacy:aaa", "agreed": 5, "new_only": 0, "legacy_only": 0,
         "not_comparable": 0, "verdict_ready": True, "sessions_covered": ["d1", "d2"]},
        {"predicate_id": "legacy:bbb", "agreed": 1, "new_only": 0, "legacy_only": 0,
         "not_comparable": 0, "verdict_ready": False, "sessions_covered": ["d1"]}]}
    lost = {"predicate_count": 1, "predicates": [
        {"predicate_id": "legacy:ccc", "agreed": 0, "new_only": 0, "legacy_only": 2344,
         "not_comparable": 0, "verdict_ready": True, "sessions_covered": ["d1"] * 5}]}
    empty = {"predicate_count": 0, "predicates": []}

    inv = summarize({"clean": clean, "lost": lost, "empty": empty})
    case("a type with predicates reads as OBSERVING", inv["observing"] == ["clean", "lost"])
    case("⛔ a type with none reads as SILENT, not as agreement", inv["silent"] == ["empty"])
    case("⛔ a legacy_only cluster is reported as a DISAGREEMENT",
         inv["with_a_disagreement"] == ["lost"])
    case("⭐ CONTROL — a clean type is NOT reported as disagreeing",
         "clean" not in inv["with_a_disagreement"])
    # ⛔ BY NAME, NEVER BY POSITION. `types` is sorted alphabetically, so the first
    # version of these two cases indexed `[1]` expecting "lost" and got "empty" — the
    # self-check caught my own off-by-sort before the tool was ever run for real, which is
    # the whole argument for writing it.
    by_name = {r["alert_type"]: r for r in inv["types"]}
    case("the disagreeing predicate is NAMED, not just counted",
         by_name["lost"]["disagreeing"][0]["legacy_only"] == 2344)
    case("⭐ CONTROL — a clean type's disagreeing list is empty",
         by_name["clean"]["disagreeing"] == [])
    case("ready is counted per predicate, not per type",
         (by_name["clean"]["ready"], by_name["lost"]["ready"], by_name["empty"]["ready"]) == (1, 1, 0))
    case("⛔ not_comparable is never folded into agreed",
         summarize({"x": {"predicate_count": 1, "predicates": [
             {"predicate_id": "p", "agreed": 0, "new_only": 0, "legacy_only": 0,
              "not_comparable": 9, "verdict_ready": False, "sessions_covered": []}]}}
         )["totals"] == {"agreed": 0, "new_only": 0, "legacy_only": 0, "not_comparable": 9})
    case("⛔ the type list is DERIVED from the payload, never typed here",
         summarize({"a-brand-new-type": empty})["silent"] == ["a-brand-new-type"])
    case("an arming census, when a type has one, is carried through",
         summarize({"t": {"predicate_count": 0, "predicates": [], "arming": {
             "subscriptions": 4, "members": 2,
             "armed_but_never_compared": [{"definition": "d", "name": "n"}]}}}
         )["types"][0]["armed_but_never_compared"] == 1)
    case("⭐ CONTROL — a census that errored is not read as zero silent definitions",
         summarize({"t": {"predicate_count": 0, "predicates": [],
                          "arming": {"error": "boom"}}}
                   )["types"][0]["armed_but_never_compared"] is None)
    case("render() names every disagreeing predicate it was given",
         "2344" in render(inv) and "legacy_only" in render(inv))
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 1 if bad else 0


def _utf8_stdout() -> None:
    """⚰️ A TOOL THAT CANNOT PRINT ITS OWN OUTPUT ON THIS BOX IS BROKEN ON THIS BOX.
    Windows consoles here default to cp1252, which cannot encode the ⛔/⭐ markers this
    repo's output uses, so the first marker raised `UnicodeEncodeError` and killed the run
    — and a crash in the middle of a report reads like a failure of the thing being
    reported. Same family as `flag_ledger_audit.py`'s cp1252 pipe-decode bug, which was
    misread as an auth problem for weeks. `errors="replace"` so a codepage can degrade a
    glyph but can never end the run. Line buffering so a killed run still has its output
    (the `subprocess.TimeoutExpired` lesson)."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except (AttributeError, ValueError):
            pass


def main(argv=None) -> int:
    _utf8_stdout()
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--json", default=None, help="write the RAW report here before summarizing")
    ap.add_argument("--from-json", default=None, help="summarize a saved raw report instead of fetching")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    if a.from_json:
        with open(a.from_json, encoding="utf-8") as fh:
            raw = json.load(fh)
    else:
        raw = fetch(a.base)
        if a.json:
            with open(a.json, "w", encoding="utf-8") as fh:
                json.dump(raw, fh, indent=1)
    print(render(summarize(raw)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
