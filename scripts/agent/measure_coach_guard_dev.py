"""Measure the coach guard (server, guard.py) against the DEVELOPMENT set, coachGuardDev.json.

    python scripts/agent/measure_coach_guard_dev.py [--misses] [--mode noInputs|selfInputs]

noInputs:   check(text)          -- the 'figure' code can fire on any number
selfInputs: check(text, [text])  -- every figure is traceable; isolates the language rules (the honest mode)
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from api.services.uct_agent.coach.guard import check  # noqa: E402

DEV = json.loads((ROOT / "app" / "src" / "agent" / "__fixtures__" / "coachGuardDev.json").read_text(encoding="utf-8"))


def run(mode: str, show: bool) -> dict:
    out = {}
    for set_ in ("advice", "critical", "educational"):
        cases = [c for c in DEV["cases"] if c["set"] == set_]
        wrong = []
        by_cat: dict = defaultdict(lambda: [0, 0])
        for c in cases:
            codes = check(c["text"], [c["text"]] if mode == "selfInputs" else None)
            bad = (not codes) if set_ != "educational" else bool(codes)
            by_cat[c["category"]][1] += 1
            if bad:
                by_cat[c["category"]][0] += 1
                wrong.append((c["category"], codes, c.get("base") or c["text"]))
        n, w = len(cases), len(wrong)
        rate = (n - w) / n if set_ != "educational" else w / n
        label = "recall" if set_ != "educational" else "false-positive"
        print(f"{mode:10} {set_:12} {label} {100 * rate:5.1f}%  ({n - w if set_ != 'educational' else w}/{n})")
        cats = ", ".join(f"{k} {v[0]}/{v[1]}" for k, v in by_cat.items() if v[0])
        if cats:
            print("    wrong by category:", cats)
        if show:
            for cat, codes, t in wrong:
                print(f"      [{cat}] {codes} {t}")
        out[set_] = rate
    return out


if __name__ == "__main__":
    show = "--misses" in sys.argv
    modes = [sys.argv[sys.argv.index("--mode") + 1]] if "--mode" in sys.argv else ["noInputs", "selfInputs"]
    for m in modes:
        run(m, show)
