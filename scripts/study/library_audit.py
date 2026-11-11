"""The question library's variety audit.

Reads every course unit (docs/study/courses/**/*.json) and every criteria card (docs/study/setups/criteria/*.json),
counts what a reader can only feel (the mix of formats, where the right answer sits, how the stems open, which
criteria have no question) and flags what drifts out of the rules in docs/study/LIBRARY.md.

    python -m scripts.study.library_audit            # the report
    python -m scripts.study.library_audit --json     # the same numbers, machine-readable
    python -m scripts.study.library_audit --strict   # exit 1 if any unit has a flag (for a pre-push check)
    python -m scripts.study.library_audit --stamp    # record which version of each criteria card every unit was written from
    python -m scripts.study.library_audit --drift    # units whose card changed since they were stamped (the library's "what is stale")
    python -m scripts.study.library_audit --decision D-013   # units that rest on an open decision (re-key these when the owner rules)

Pure reading: it never writes a bank file.
"""
from __future__ import annotations

import argparse
import collections
import glob
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.study.courses_lib import choice_orders  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
COURSES = os.path.join(ROOT, "docs", "study", "courses")
CARDS = os.path.join(ROOT, "docs", "study", "setups", "criteria")
LINEAGE = os.path.join(ROOT, "docs", "study", "library", "lineage.json")

# The thresholds are the rules in LIBRARY.md section 3. Change them there first.
MIN_SCENARIO = 0.20
MIN_TF = 0.15
MAX_CHOICE = 0.75            # mcq + scenario together may not be more than this share of a unit
POSITION_MIN_N = 12          # position and length tells are only judged on units with at least this many choice items
POSITION_MAX_SHARE = 0.45    # no answer slot may hold more than this share of a unit's choice answers
POSITION_MIN_SHARE = 0.08
TF_TRUE_RANGE = (0.35, 0.65)
TF_MIN_N = 8
LONGEST_MAX_SHARE = 0.40     # the right choice is the single longest choice in at most this share (chance is about 0.25)
STEM_MAX_SHARE = 0.10        # no three-word opening may start more than this share of a unit's stems
STEM_MIN_N = 20
ABSOLUTES = re.compile(r"\b(always|never|only|guarantee[sd]?|all|none|every|must)\b", re.I)
NONE_OF = re.compile(r"\b(all|none) of the (above|these)\b", re.I)


def shown(unit: dict, q: dict, orders: dict) -> dict:
    """The question as a member meets it: choices in the order the bank builder gives them."""
    if is_choice(q) and str(q.get("key")) in orders:
        q = dict(q, choices=orders[str(q["key"])])
    return q


def live_questions(unit: dict) -> list[dict]:
    """The questions a member can meet: those the cold checker passed (a unit with no verify block is all live)."""
    verify = unit.get("verify") or {}
    orders = choice_orders(unit)
    out = []
    for q in unit.get("questions", []):
        st = (verify.get(q.get("key")) or {}).get("status")
        if verify and st != "pass":
            continue
        out.append(shown(unit, q, orders))
    return out


def load_units() -> list[dict]:
    units = []
    for f in sorted(glob.glob(os.path.join(COURSES, "**", "*.json"), recursive=True)):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        if isinstance(d, dict) and "questions" in d and "unit" in d:
            d["_file"] = os.path.relpath(f, ROOT).replace("\\", "/")
            units.append(d)
    return units


def load_cards() -> dict[str, dict]:
    cards = {}
    for f in sorted(glob.glob(os.path.join(CARDS, "*.json"))):
        cards[os.path.basename(f)] = json.load(open(f, encoding="utf-8"))
    return cards


def is_choice(q: dict) -> bool:
    return q.get("format") in ("mcq", "scenario") and isinstance(q.get("choices"), list) and len(q["choices"]) >= 3


def words(s: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9']+", s or "")


def audit_unit(u: dict) -> dict:
    qs = live_questions(u)
    n = len(qs)
    flags: list[str] = []
    if n == 0:
        return {"unit": u["unit"], "n": 0, "flags": ["no live questions"], "formats": {}}
    fmt = collections.Counter(q.get("format") for q in qs)

    scen = fmt.get("scenario", 0) / n
    tf = fmt.get("tf", 0) / n
    choice_share = (fmt.get("mcq", 0) + fmt.get("scenario", 0)) / n
    if scen < MIN_SCENARIO:
        flags.append(f"scenario {scen:.0%} (rule: at least {MIN_SCENARIO:.0%})")
    if tf < MIN_TF:
        flags.append(f"true/false {tf:.0%} (rule: at least {MIN_TF:.0%})")
    if choice_share > MAX_CHOICE:
        flags.append(f"choice questions {choice_share:.0%} (rule: at most {MAX_CHOICE:.0%})")

    # where the right answer sits
    ch = [q for q in qs if is_choice(q) and q.get("answer") in q["choices"]]
    pos = collections.Counter(q["choices"].index(q["answer"]) for q in ch)
    pos_share = {}
    if len(ch) >= POSITION_MIN_N:
        four = sum(1 for q in ch if len(q["choices"]) >= 4) / len(ch) > 0.8
        for slot in range(4 if four else 3):
            share = pos.get(slot, 0) / len(ch)
            pos_share[slot] = round(share, 3)
            if share > POSITION_MAX_SHARE:
                flags.append(f"right answer sits in slot {'ABCD'[slot]} {share:.0%} of the time (rule: at most {POSITION_MAX_SHARE:.0%})")
            if share < POSITION_MIN_SHARE:
                flags.append(f"right answer sits in slot {'ABCD'[slot]} only {share:.0%} of the time (rule: at least {POSITION_MIN_SHARE:.0%})")

    # the longest-answer tell
    longest = 0
    for q in ch:
        lens = [len(c) for c in q["choices"]]
        if lens.count(max(lens)) == 1 and len(q["answer"]) == max(lens):
            longest += 1
    longest_share = longest / len(ch) if ch else 0.0
    if len(ch) >= POSITION_MIN_N and longest_share > LONGEST_MAX_SHARE:
        flags.append(f"the right choice is the longest one {longest_share:.0%} of the time (rule: at most {LONGEST_MAX_SHARE:.0%})")

    # true / false balance and its tells
    tfq = [q for q in qs if q.get("format") == "tf"]
    true_share = None
    if len(tfq) >= TF_MIN_N:
        true_share = sum(1 for q in tfq if str(q.get("answer")).lower() == "true") / len(tfq)
        lo, hi = TF_TRUE_RANGE
        if not lo <= true_share <= hi:
            flags.append(f"true/false answers are {true_share:.0%} true (rule: between {lo:.0%} and {hi:.0%})")
        n_false = sum(1 for q in tfq if str(q.get("answer")).lower() == "false")
        n_true = len(tfq) - n_false
        if n_false and n_true:
            af = sum(1 for q in tfq if str(q.get("answer")).lower() == "false" and ABSOLUTES.search(q.get("q", "")))
            at = sum(1 for q in tfq if str(q.get("answer")).lower() == "true" and ABSOLUTES.search(q.get("q", "")))
            if af / n_false - at / n_true > 0.25:
                flags.append(f"absolute words (always, never, only) mark {af / n_false:.0%} of the false statements and {at / n_true:.0%} of the true (a tell)")

    # stems
    opens = collections.Counter(" ".join(w.lower() for w in words(q.get("q", ""))[:3]) for q in qs if q.get("q"))
    top_open, top_n = (opens.most_common(1)[0] if opens else ("", 0))
    if n >= STEM_MIN_N and top_n >= 4 and top_n / n > STEM_MAX_SHARE and "stems" not in (u.get("variety_exempt") or []):
        flags.append(f"{top_n / n:.0%} of stems open with '{top_open}' (rule: at most {STEM_MAX_SHARE:.0%})")

    # all / none of the above
    nota = sum(1 for q in ch if any(NONE_OF.search(c) for c in q["choices"]))
    if nota:
        flags.append(f"{nota} question(s) offer all or none of the above")

    # difficulty
    rung = collections.Counter(q.get("rung") for q in qs)
    levels = {
        "Learn": sum(rung.get(r, 0) for r in (1, 2, 3)),
        "Practise": sum(rung.get(r, 0) for r in (4, 5, 6)),
        "Prove": sum(rung.get(r, 0) for r in (7, 8, 9)),
    }
    for name, c in levels.items():
        if c < max(1, n // 5):
            flags.append(f"only {c} of {n} on {name} (rule: at least a fifth)")

    return {
        "unit": u["unit"], "title": u.get("title"), "n": n, "formats": dict(fmt), "levels": levels,
        "answer_slots": pos_share, "longest_share": round(longest_share, 3),
        "true_share": None if true_share is None else round(true_share, 3),
        "top_opening": [top_open, top_n], "flags": flags,
    }


def audit_coverage(units: list[dict], cards: dict[str, dict]) -> dict:
    """For every settled or proposed criterion: how many live questions point at it."""
    asked = collections.Counter()
    for u in units:
        for q in live_questions(u):
            if q.get("criterion"):
                asked[q["criterion"]] += 1
    rows = []
    seed_kinds = collections.Counter()
    card_ref = {str(u.get("card") or "") for u in units}
    for fname, c in cards.items():
        crits = c.get("criteria", [])
        has_unit = any(r.endswith(fname) or fname in r for r in card_ref if r)
        for s in c.get("question_seeds", []) or []:
            seed_kinds[s.get("kind")] += 1
        unasked = [x["id"] for x in crits if x.get("status") in ("settled", "proposed") and not asked.get(x["id"])]
        rows.append({
            "card": fname, "criteria": len(crits), "asked": sum(1 for x in crits if asked.get(x["id"])),
            "settled_or_proposed_unasked": unasked, "has_unit": has_unit,
        })
    return {"rows": rows, "seed_kinds": dict(seed_kinds)}


def build() -> dict:
    units = load_units()
    cards = load_cards()
    per_unit = [audit_unit(u) for u in units]
    total = collections.Counter()
    slots = collections.Counter()
    for u in units:
        for q in live_questions(u):
            total[q.get("format")] += 1
            if is_choice(q) and q.get("answer") in q["choices"]:
                slots[q["choices"].index(q["answer"])] += 1
    return {"units": per_unit, "formats": dict(total), "answer_slots": dict(slots), "coverage": audit_coverage(units, cards)}


# ── lineage: which version of its card a unit was written from ───────────────────────────────────────────────────────
def card_sha(path: str) -> str:
    """A fingerprint of a card's content (not its formatting), so a reflow never reads as a change."""
    d = json.load(open(os.path.join(ROOT, path), encoding="utf-8"))
    return hashlib.sha1(json.dumps(d, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:12]


def stamp() -> dict:
    """Record the card version every unit stands on. Run it after a unit is written, rewritten or re-checked against its card."""
    out = {}
    for u in load_units():
        card = u.get("card")
        if card and os.path.exists(os.path.join(ROOT, card)):
            out[u["unit"]] = {"card": card, "card_sha": card_sha(card), "as_of": u.get("as_of")}
    os.makedirs(os.path.dirname(LINEAGE), exist_ok=True)
    with open(LINEAGE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1, sort_keys=True, ensure_ascii=False)
        f.write("\n")
    return out


def drift() -> list[dict]:
    """Units whose card is no longer the one they were stamped against, plus units never stamped."""
    try:
        known = json.load(open(LINEAGE, encoding="utf-8"))
    except FileNotFoundError:
        known = {}
    rows = []
    for u in load_units():
        card = u.get("card")
        if not card or not os.path.exists(os.path.join(ROOT, card)):
            continue
        now = card_sha(card)
        was = (known.get(u["unit"]) or {}).get("card_sha")
        if was is None:
            rows.append({"unit": u["unit"], "card": card, "why": "never stamped"})
        elif was != now:
            rows.append({"unit": u["unit"], "card": card, "why": f"card changed ({was} to {now})"})
    return rows


def resting_on(decision: str) -> list[dict]:
    """Units whose `conflicts` lines say they are keyed on an open decision, with the line, so a ruling can be applied."""
    rows = []
    pat = re.compile(rf"(?<![A-Za-z0-9-]){re.escape(decision)}(?![0-9])")
    for u in load_units():
        lines = [c for c in u.get("conflicts") or [] if pat.search(c)]
        if lines:
            rows.append({"unit": u["unit"], "lines": lines})
    return rows


def render(rep: dict) -> str:
    out = []
    n = sum(rep["formats"].values()) or 1
    out.append(f"LIBRARY AUDIT: {len(rep['units'])} course units, {n} live questions")
    out.append("formats: " + ", ".join(f"{k} {v} ({v / n:.0%})" for k, v in sorted(rep["formats"].items(), key=lambda kv: -kv[1])))
    s = rep["answer_slots"]
    st = sum(s.values()) or 1
    out.append("right-answer slot over the whole library: " + ", ".join(f"{'ABCD'[k]} {v / st:.0%}" for k, v in sorted(s.items()) if k < 4))
    flagged = [u for u in rep["units"] if u["flags"]]
    out.append(f"\nunits with a flag: {len(flagged)} of {len(rep['units'])}")
    for u in flagged:
        out.append(f"  {u['unit']} ({u['n']} q): " + "; ".join(u["flags"]))
    cov = rep["coverage"]
    uncovered = [(r["card"], r["settled_or_proposed_unasked"]) for r in cov["rows"] if r["has_unit"] and r["settled_or_proposed_unasked"]]
    nounit = [r["card"] for r in cov["rows"] if not r["has_unit"]]
    out.append(f"\ncriteria (settled or proposed) with no live question, on cards that have a unit: {sum(len(x[1]) for x in uncovered)} on {len(uncovered)} cards")
    for card, ids in uncovered[:60]:
        out.append(f"  {card}: {len(ids)}: " + ", ".join(ids[:6]) + (" ..." if len(ids) > 6 else ""))
    if nounit:
        out.append(f"\ncards with no course unit yet: {len(nounit)}: " + ", ".join(nounit[:12]) + (" ..." if len(nounit) > 12 else ""))
    out.append("\nquestion seeds on the cards, by kind: " + ", ".join(f"{k} {v}" for k, v in sorted(cov["seed_kinds"].items(), key=lambda kv: -kv[1])))
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--stamp", action="store_true")
    ap.add_argument("--drift", action="store_true")
    ap.add_argument("--decision", metavar="D-nnn")
    a = ap.parse_args(argv)
    if a.stamp:
        print(f"stamped {len(stamp())} units into {os.path.relpath(LINEAGE, ROOT)}")
        return 0
    if a.drift:
        rows = drift()
        print(f"{len(rows)} unit(s) to look at" if rows else "no unit has drifted from its card")
        for r in rows:
            print(f"  {r['unit']}: {r['why']}  ({r['card']})")
        return 1 if (rows and a.strict) else 0
    if a.decision:
        rows = resting_on(a.decision.upper())
        print(f"{len(rows)} unit(s) rest on {a.decision.upper()}")
        for r in rows:
            print(f"  {r['unit']}")
            for line in r["lines"]:
                print("     - " + line[:220])
        return 0
    rep = build()
    print(json.dumps(rep, indent=1, ensure_ascii=False) if a.json else render(rep))
    if a.strict and any(u["flags"] for u in rep["units"]):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
