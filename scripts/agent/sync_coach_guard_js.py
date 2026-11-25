"""Regenerate the pattern blocks of the browser coach guard (app/src/agent/coach/guard.js) from the server guard
(api/services/uct_agent/coach/guard.py): CLASS_PATTERNS and RECALL_PATTERNS carry the IDENTICAL pattern strings.

    python scripts/agent/sync_coach_guard_js.py          # rewrite guard.js in place
    python scripts/agent/sync_coach_guard_js.py --check  # exit 1 if guard.js is stale

tests/test_uct_agent_coach_guard.py compares the blocks, so a stale mirror fails the suite.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from api.services.uct_agent.coach import guard  # noqa: E402

JS = ROOT / "app" / "src" / "agent" / "coach" / "guard.js"


def class_block() -> str:
    rows = ",\n".join("  " + json.dumps(list(p)) for p in guard.CLASS_PATTERNS)
    return "export const CLASS_PATTERNS = [\n" + rows + ",\n]"


def recall_block() -> str:
    rows = ",\n".join(f"  {json.dumps(k)}: {json.dumps(v)}" for k, v in guard.RECALL_PATTERNS.items())
    return "export const RECALL_PATTERNS = {\n" + rows + ",\n}"


def render(src: str) -> str:
    for head, block, end in (("export const CLASS_PATTERNS = [", class_block(), "\n]"),
                             ("export const RECALL_PATTERNS = {", recall_block(), "\n}")):
        i = src.index(head)
        j = src.index(end, i) + len(end)
        src = src[:i] + block + src[j:]
    return src


if __name__ == "__main__":
    src = JS.read_text(encoding="utf-8")
    out = render(src)
    if "--check" in sys.argv:
        sys.exit(0 if out == src else 1)
    JS.write_text(out, encoding="utf-8")
    print("guard.js", "unchanged" if out == src else "updated")
