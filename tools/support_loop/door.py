# -*- coding: utf-8 -*-
"""Ask the real member door, exactly the way the census does.

It runs the census itself: ``coverageMapDoorCensus.measure.test.js`` (every script
through ``memberPaneDefinition`` then ``installUserDefinitions`` with production's
flag state, peeled up to ``cap`` times), driven by the same two env variables
``tools/pine_coverage/run_census.py`` sets. Nothing here decides what is
supported; it reads what the door answered.

⛔ The input list, the answers (which QUOTE refused lines) and the console log are
all written to ``out_dir``, which the caller places in the support-loop work
directory. Nothing the door prints reaches this process's stdout.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Callable, Optional

REPO = Path(__file__).resolve().parents[2]
APP = REPO / "app"
CENSUS = "src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js"


class DoorError(RuntimeError):
    pass


def _rows(path: Path) -> list[dict]:
    out = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    return out


def run_door(items: list[dict], out_dir: Path, *, app_dir: Optional[Path] = None,
             runner: Optional[Callable[..., int]] = None, timeout: int = 1800) -> dict[str, dict]:
    """``items``: [{key, path, cap}]. Returns {key: census row}."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    inp, out, log = out_dir / "door_input.json", out_dir / "door_out.jsonl", out_dir / "door.log"
    for p in (out, out_dir / "current.txt"):
        if p.exists():
            p.unlink()
    inp.write_text(json.dumps(items, indent=1), encoding="utf-8")
    app = Path(app_dir or APP)
    if runner is None:
        if not (app / "node_modules" / "vitest").exists():
            raise DoorError(f"{app}/node_modules has no vitest: junction it from a worktree that "
                            "has one (mklink /J), never npm install")
        env = dict(os.environ, COVERAGE_INPUT=str(inp), COVERAGE_OUT=str(out),
                   NODE_OPTIONS="--max-old-space-size=6144")
        with open(log, "w", encoding="utf-8") as fh:
            try:
                subprocess.run(["node", "node_modules/vitest/vitest.mjs", "run", CENSUS],
                               cwd=str(app), env=env, stdout=fh, stderr=subprocess.STDOUT,
                               timeout=timeout, check=False)
            except subprocess.TimeoutExpired:
                raise DoorError(f"the door did not answer within {timeout}s (log: {log})") from None
    else:
        runner(inp=inp, out=out, log=log)
    rows = {r.get("key"): r for r in _rows(out)}
    missing = [i["key"] for i in items if i["key"] not in rows]
    # ⛔ vitest exits 0 when it selects nothing, so success is the ROW COUNT.
    if missing:
        raise DoorError(f"the door answered {len(rows)} of {len(items)} scripts (log: {log})")
    return rows


def walls(row: dict) -> list[dict]:
    """Every refusal the door raised across the peel, deduplicated by (guard, token)."""
    seen, out = set(), []
    for step in (row or {}).get("steps") or []:
        for r in step.get("refusals") or []:
            k = (r.get("guard"), r.get("token"))
            if k in seen:
                continue
            seen.add(k)
            out.append({"guard": r.get("guard"), "token": r.get("token"), "line": r.get("line"),
                        "message": r.get("message"), "text": r.get("text")})
        if step.get("threw"):
            k = ("threw", None)
            if k not in seen:
                seen.add(k)
                out.append({"guard": "threw", "token": None, "line": None,
                            "message": step.get("threw"), "text": None})
    return out
