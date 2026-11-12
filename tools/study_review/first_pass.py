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
import subprocess
import sys

# The commit just before Claude's first-pass fixes. The old wording of each changed question is read from it, so the
# review page can show "was" next to "now".
FIRST_PASS_BASE = "b0279f8b51^"
# The commit the overbuild started from (docs/study/OVERBUILD_PLAN.md): a question that differs from it is "upgraded".
UPGRADE_BASE = "overbuild-base"

REPO = os.path.abspath(sys.argv[1])
DATA = os.path.abspath(sys.argv[2])
sys.path.insert(0, REPO)
os.chdir(REPO)

from api.services import study_import  # noqa: E402

HELD = re.compile(r"pending|held|re-key|rests on|waiting|waits|owner|proposed|not ruled|unresolved", re.I)
DID = re.compile(r"D-\d{3}")
KEYTOK = re.compile(r"\bq(\d+)\b")
NUM = re.compile(r"\d+(?:[.,]\d+)?")


_OLD = {}


def _unit_at(base, unit):
    """{key: question} of one unit file as it stood at a git ref; {} when the file did not exist there."""
    cache = _OLD.setdefault(base, {})
    if unit not in cache:
        track = unit.split(".")[0]
        try:
            raw = subprocess.run(["git", "show", f"{base}:docs/study/courses/{track}/{unit}.json"],
                                 cwd=REPO, capture_output=True, check=True).stdout.decode("utf-8")
            cache[unit] = {x["key"]: x for x in json.loads(raw).get("questions", [])}
        except Exception:
            cache[unit] = {}
    return cache[unit]


def old_question(unit, key, base=None):
    """The question as it stood at a git ref (default: before the first-pass fixes), trimmed to the fields a reader
    compares; None if unknown."""
    o = _unit_at(base or FIRST_PASS_BASE, unit).get(key)
    if not o:
        return None
    keep = {k: o[k] for k in ("story", "q", "sentence", "bank", "choices", "answer", "prefix", "suffix", "why", "simple")
            if o.get(k) not in (None, "", [])}
    return keep or None


_NOW = {}


def _unit_now(unit):
    """{key: question} of one unit file as it stands in the working tree (raw, so it compares like with like)."""
    if unit not in _NOW:
        track = unit.split(".")[0]
        try:
            with open(os.path.join(REPO, "docs", "study", "courses", track, unit + ".json"), encoding="utf-8") as fh:
                _NOW[unit] = {x["key"]: x for x in json.load(fh).get("questions", [])}
        except (OSError, ValueError):
            _NOW[unit] = {}
    return _NOW[unit]


def upgrade_note(unit, q):
    """What the overbuild changed in this question since UPGRADE_BASE: (sentence, old question or None), or None.
    Both sides are the RAW unit-file question, so a dash or a reorder is never mistaken for an edit."""
    base = _unit_at(UPGRADE_BASE, unit)
    cur = _unit_now(unit).get(q["key"])
    if not base or cur is None:
        return None
    old = base.get(q["key"])
    if old is None:
        return ("a new question, added by the overbuild", None)
    parts = []
    oc, nc = old.get("choices") or [], cur.get("choices") or []
    if len(oc) == 3 and len(nc) == 4:
        parts.append("a fourth answer was added")
    elif set(oc) != set(nc):
        parts.append("the answer choices changed")
    if cur.get("simple") and not old.get("simple"):
        parts.append("a simple answer was added")
    elif cur.get("simple") and cur.get("simple") != old.get("simple"):
        parts.append("the simple answer was reworded")
    if (cur.get("why") or "") != (old.get("why") or ""):
        parts.append("the full answer was rewritten")
    if (cur.get("q") or "") != (old.get("q") or "") or (cur.get("story") or "") != (old.get("story") or ""):
        parts.append("the question wording changed")
    if cur.get("answer") != old.get("answer"):
        parts.append("the right answer changed")
    if not parts:
        return None
    return ("Upgraded: " + "; ".join(parts), old_question(unit, q["key"], UPGRADE_BASE))


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

    # questions the first pass already acted on: docs/study/library/resolved_looks.json {"UNIT#qNN": "what was changed"}
    resolved = {}
    try:
        resolved = json.load(open(os.path.join(REPO, "docs", "study", "library", "resolved_looks.json"), encoding="utf-8"))
    except (OSError, ValueError):
        pass
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
            done = resolved.get(u + "#" + q["key"])
            upg = upgrade_note(u, q)
            if done or upg:
                # the first-pass note and the overbuild note can both apply: say both, newest last
                c, p, r = "look", "keep", " ".join(x for x in (done, upg[0] if upg else "") if x)
            elif look:
                c, p, r = "look", proposed, "; ".join(look)
            elif confirm:
                c, p, r = "confirm", "keep", "; ".join(confirm)
            else:
                c, p, r = "keep", "keep", "passed the second reader's cold check; no duplicate, no length tell, no unruled rule"
            calls[q["id"]] = {"c": c, "p": p, "r": r}
            if done or upg:
                calls[q["id"]]["k"] = "changed"
                if upg:
                    rk = ((_unit_now(u).get(q["key"]) or {}).get("risk") or {}).get("score")
                    if isinstance(rk, int):
                        calls[q["id"]]["rk"] = rk
                was = upg[1] if upg else old_question(u, q["key"])
                if was:
                    calls[q["id"]]["was"] = was
            stats[c] += 1
    with open(DATA + "/calls.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(calls, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"calls for {len(calls)} questions: {stats['keep']} clean keep, {stats['confirm']} keep but confirm the rule, {stats['look']} look")


main()
