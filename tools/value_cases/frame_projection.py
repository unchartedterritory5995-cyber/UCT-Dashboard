"""Place a higher-timeframe calculation on the chart's bars with the PRODUCT'S OWN projection, in node.

An answer that sets a calculation timeframe ("the whole indicator runs on daily bars") is computed on that
timeframe's bars and then placed on the chart's bars by `mtfProjection.projectFrameColumns`. Which daily value a
5 minute bar shows is the product's rule (the last period that had closed before the bar's own began), so the value
cases call the function that decides it and restate nothing.

Raises `LaneUnavailable` where node or the app's modules are missing: a caller must treat that as "not graded",
never as a pass.
"""
from __future__ import annotations

import io
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List

from tools.converse_eval import APP, LaneUnavailable, _node

from .script_lane import _build_script

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "frame_projection.mjs"


def project(jobs: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """jobs: [{id, frameBars, columns: {key: [...]}, frame, chartBars, chartTf, newestFinal}] ->
    {id: {columns: {key: [number | None]}, stale}}"""
    esbuild = APP / "node_modules" / "esbuild" / "lib" / "main.js"
    if not esbuild.exists():
        raise LaneUnavailable(f"esbuild not found at {esbuild} (app/node_modules missing?)")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        build, bundle = work / "build_frame_projection.mjs", work / "frame_projection.bundle.mjs"
        job, out = work / "job.json", work / "out.json"
        with io.open(build, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(_build_script())
        try:
            proc = subprocess.run([_node(), str(build), str(esbuild), str(SOURCE), str(bundle), str(APP)],
                                  capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
        except FileNotFoundError as exc:
            raise LaneUnavailable(f"node is not here: {exc}") from exc
        if proc.returncode != 0 or not bundle.exists():
            raise LaneUnavailable(f"bundling the projection failed ({proc.returncode}): {(proc.stderr or proc.stdout)[-2000:]}")
        job.write_text(json.dumps({"jobs": jobs}), encoding="utf-8")
        proc = subprocess.run([_node(), str(bundle), str(job), str(out)], cwd=str(work), capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=300)
        if proc.returncode != 0 or not out.exists():
            raise LaneUnavailable(f"the projection failed ({proc.returncode}): {(proc.stderr or proc.stdout)[-2000:]}")
        return json.loads(out.read_text(encoding="utf-8"))["jobs"]
