"""THE VALUE-CASE AUDIT (2026-11-25): could each recorded right answer have been graded wrong?

For every case recorded RIGHT on the formula or the script lane, two kinds of slip of its OWN recorded answer, each graded
by the case's own rule (on its edge chart too, when it names one):
  WINDOW  every length one bar longer: on the formula lane every argument whose role in the engine's table is a length
          (`period`, `length`, ...) as a whole number of at least 2, + 1; on the script lane every whole number from 5 to
          300 in the code + 1 and every look-back one bar deeper (`test_value_cases_scripts._every_window_one_longer`);
  STRICT  each comparison flipped ALONE: > <-> >=, < <-> <=. One at a time: a symmetric pair flipped together can cancel
          ("up minus down" with both flipped still nets a tie to 0) and hide what either slip alone would show.
`audit(cases)` -> {case id: {"window": "seen" | "unseen" | None, "strict": (unseen, of)}}. None / (0, 0): nothing to
mutate. No model, no network; the script lane needs node (`script_lane.run`).

`tests/test_value_cases_blind_ratchet.py` holds the answer to a list of ACCEPTED blind spots, each with its reason.
"""
from __future__ import annotations

import copy
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from . import grade as G
from . import script_grade

FLIP = {">": ">=", ">=": ">", "<": "<=", "<=": "<"}
LENGTH_ROLES = re.compile(r"period|length|len$|bars|window|lookback", re.I)


def formula_window_mutant(answer: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    from api.services import ast_table
    functions = ast_table.TABLE["functions"]
    out, n = copy.deepcopy(answer), [0]

    def walk(x: Any) -> None:
        if isinstance(x, list):
            for y in x:
                walk(y)
            return
        if not isinstance(x, dict):
            return
        if x.get("type") == "call" and x.get("name") in functions:
            roles = tuple((functions[x["name"]] or {}).get("argRoles") or ())
            for i, arg in enumerate(x.get("args") or []):
                if (i < len(roles) and LENGTH_ROLES.search(str(roles[i])) and isinstance(arg, dict)
                        and arg.get("type") == "num" and isinstance(arg.get("value"), int) and arg["value"] >= 2):
                    arg["value"] += 1
                    n[0] += 1
        for v in x.values():
            walk(v)

    walk(out.get("ops"))
    return out, n[0]


def formula_single_flips(answer: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    def paths(x: Any, path: tuple = ()) -> Iterable[tuple]:
        if isinstance(x, list):
            for i, y in enumerate(x):
                yield from paths(y, path + (i,))
        elif isinstance(x, dict):
            if x.get("type") == "op" and x.get("name") in FLIP:
                yield path
            for k, v in x.items():
                yield from paths(v, path + (k,))
    for p in list(paths(answer.get("ops"))):
        m = copy.deepcopy(answer)
        node: Any = m["ops"]
        for q in p:
            node = node[q]
        node["name"] = FLIP[node["name"]]
        yield m


def script_single_flips(source: str) -> Iterable[str]:
    found: List[Tuple[int, int, str]] = []
    lines = source.splitlines()
    for li, line in enumerate(lines):
        code = line.partition("//")[0]
        parts = re.split(r'("(?:[^"\\]|\\.)*")', code)                  # never inside a string
        offset = 0
        for i, part in enumerate(parts):
            if i % 2 == 0:
                for m in re.finditer(r"(?<![<>=!])(>=|<=|>|<)(?!=)", part):
                    found.append((li, offset + m.start(), m.group(1)))
            offset += len(part)
    for li, col, op in found:
        line = lines[li]
        yield "\n".join(lines[:li] + [line[:col] + FLIP[op] + line[col + len(op):]] + lines[li + 1:])


def audit(cases: List[Dict[str, Any]], window_of_script=None) -> Dict[str, Dict[str, Any]]:
    """`window_of_script(source, case) -> (mutated source, hit)`: the script lane's window slip (the test file's own)."""
    out: Dict[str, Dict[str, Any]] = {}
    script_jobs: List[Dict[str, Any]] = []
    script_answers: Dict[str, Dict[str, Any]] = {}
    for c in cases:
        if c.get("recorded_verdict") == "wrong" or c["lane"] not in ("formula", "script"):
            continue
        if c["lane"] == "formula":
            m, n = formula_window_mutant(c["answer"])
            window: Optional[str] = None
            if n:
                window = "unseen" if G.grade_case({**c, "answer": m}, m)["verdict"] == "right" else "seen"
            flips = list(formula_single_flips(c["answer"]))
            unseen = sum(1 for f in flips if G.grade_case({**c, "answer": f}, f)["verdict"] == "right")
            out[c["id"]] = {"window": window, "strict": (unseen, len(flips))}
            continue
        src = c["answer"]["script"]["pine"]
        out[c["id"]] = {"window": None, "strict": (0, 0)}
        if window_of_script is not None:
            w, hit = window_of_script(src, c)
            if hit:
                jid = f"{c['id']}#window"
                script_jobs.append({**c, "id": jid, "holds": c["id"]})
                script_answers[jid] = {"turn": "script", "script": {"pine": w}}
        for j, f in enumerate(script_single_flips(src)):
            jid = f"{c['id']}#flip{j}"
            script_jobs.append({**c, "id": jid, "holds": c["id"]})
            script_answers[jid] = {"turn": "script", "script": {"pine": f}}
    if script_jobs:
        got = script_grade.grade_all(script_jobs, script_answers)
        for job in script_jobs:
            base, kind = job["holds"], job["id"].split("#", 1)[1]
            right = got[job["id"]]["verdict"] == "right"
            if kind == "window":
                out[base]["window"] = "unseen" if right else "seen"
            else:
                unseen, of = out[base]["strict"]
                out[base]["strict"] = (unseen + (1 if right else 0), of + 1)
    return out
