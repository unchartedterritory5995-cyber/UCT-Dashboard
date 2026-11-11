"""Claude's first-pass call on every question, from evidence the library already holds. It reads nothing new.

    python first_pass.py <repo worktree> <data folder>      writes <data folder>/calls.json

A call is one of:
    keep     no signal: the question passed the second reader's cold check, has no near-duplicate, no length tell,
             and rests on no rule the owner has not ruled. It was NOT re-read today; this is a triage, not a review.
    confirm  keep, but it rests on a rule that is only our card's proposal, or on a held decision the unit's own
             notes name. The question is fine; the RULE is the owner's to confirm.
    look     a concrete concern with a proposed action (fix or cut) and the reason.

The owner accepts or overrules each one in the page. Nothing here is a verdict until he accepts it.
"""
import glob
import json
import os
import re
import sys

REPO = os.path.abspath(sys.argv[1])
DATA = os.path.abspath(sys.argv[2])
sys.path.insert(0, REPO)
os.chdir(REPO)

from api.services import study_import  # noqa: E402

HELD = re.compile(r"pending|held|re-key|rests on|waiting|waits|owner|proposed|not ruled|unresolved", re.I)
DID = re.compile(r"D-\d{3}")
KEYTOK = re.compile(r"\bq(\d+)\b")
NUM = re.compile(r"\d+(?:[.,]\d+)?")


def text_of(q):
    parts = [q.get("q") or "", q.get("story") or "", q.get("sentence") or ""]
    parts += [str(c) for c in q.get("choices") or []]
    return " ".join(parts)


def main():
    units = {}
    for f in sorted(glob.glob(DATA + "/track-*.json")):
        units.update(json.load(open(f, encoding="utf-8")))
    cards = {}

    def card_status(path):
        if path not in cards:
            m = {}
            try:
                for c in json.load(open(os.path.join(REPO, path), encoding="utf-8")).get("criteria", []):
                    m[c["id"]] = (c.get("status"), c.get("owner_question"))
            except Exception:
                pass
            cards[path] = m
        return cards[path]

    rows = []   # (unit, key, id, token set, numbers, term)
    for u, d in units.items():
        for q in d["questions"]:
            toks = study_import.normalise_question(text_of(q))
            rows.append({"unit": u, "key": q["key"], "id": q["id"], "toks": toks, "nums": frozenset(NUM.findall(text_of(q))),
                         "term": (q.get("term") or "").casefold(), "q": q})

    # near-duplicates: flag the LATER question of each close pair (same unit 0.80, across units 0.85)
    order = {(r["unit"], r["key"]): i for i, r in enumerate(rows)}
    dup = {}
    by_size = sorted(range(len(rows)), key=lambda i: len(rows[i]["toks"]))
    for ai in range(len(by_size)):
        a = rows[by_size[ai]]
        la = len(a["toks"])
        if la < 4:
            continue
        for bi in range(ai + 1, len(by_size)):
            b = rows[by_size[bi]]
            lb = len(b["toks"])
            if lb > la / 0.78:
                break
            if a["term"] and b["term"] and a["term"] != b["term"]:
                continue
            if a["nums"] != b["nums"]:
                continue
            inter = len(a["toks"] & b["toks"])
            j = inter / (la + lb - inter)
            same = a["unit"] == b["unit"]
            if j >= (0.80 if same else 0.85):
                later, earlier = (a, b) if order[(a["unit"], a["key"])] > order[(b["unit"], b["key"])] else (b, a)
                prev = dup.get(later["id"])
                if prev is None or j > prev[0]:
                    dup[later["id"]] = (j, earlier["unit"] + "#" + earlier["key"])

    calls, stats = {}, {"keep": 0, "confirm": 0, "look": 0}
    for u, d in units.items():
        status = card_status(d.get("card") or "")
        held = {}
        for line in d.get("conflicts") or []:
            for m in KEYTOK.finditer(line):
                win = line[max(0, m.start() - 160): m.end() + 160]
                if HELD.search(win):
                    ids = DID.findall(line[max(0, m.start() - 160): m.start() + 20]) or DID.findall(win)
                    held.setdefault("q" + m.group(1), set()).update(ids)
        for q in d["questions"]:
            look, confirm = [], []
            proposed = "keep"
            if q["id"] in dup:
                j, other = dup[q["id"]]
                look.append(f"asks nearly the same thing as {other.replace('#', ' ')} ({round(j * 100)}% the same words); keep one")
                proposed = "cut" if j >= 0.92 else "fix"
            if q.get("tell") and q.get("choices") and q.get("answer") in q["choices"]:
                right = len(q["answer"])
                others = [len(c) for c in q["choices"] if c != q["answer"]]
                # only a clear gap is a tell; being the longest by a few characters happens a quarter of the time by chance
                if others and right - max(others) >= 8 and right >= 1.3 * (sum(others) / len(others)):
                    look.append(f"the right choice is far the longest ({right} characters against {max(others)} at most), which a quiz-wise member can pick without knowing the subject")
                    if proposed == "keep":
                        proposed = "fix"
            crit = q.get("criterion")
            st = status.get(crit, (None, None)) if crit else (None, None)
            if st[0] == "proposed":
                confirm.append(f"teaches {crit}, which is our card's proposal and not yet your ruling" + (f" ({st[1]})" if st[1] else ""))
            elif st[0] == "pending-owner":
                confirm.append(f"teaches {crit}, which waits on your decision" + (f" ({st[1]})" if st[1] else ""))
            if q["key"] in held:
                ids = ", ".join(sorted(held[q["key"]])) or "a held decision"
                confirm.append(f"the unit's notes say this touches {ids}")
            if look:
                c, p, r = "look", proposed, "; ".join(look)
            elif confirm:
                c, p, r = "confirm", "keep", "; ".join(confirm)
            else:
                c, p, r = "keep", "keep", "passed the second reader's cold check; no duplicate, no length tell, no unruled rule"
            calls[q["id"]] = {"c": c, "p": p, "r": r}
            stats[c] += 1
    with open(DATA + "/calls.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(calls, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"calls for {len(calls)} questions: {stats['keep']} clean keep, {stats['confirm']} keep but confirm the rule, {stats['look']} look")


main()
