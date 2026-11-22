"""Run scripts the assistant wrote through the member pane's own path, in node, and hand back the numbers.

`run(scripts)` bundles `script_lane.mjs` with the esbuild in `app/node_modules` (the evaluation runner's
precedent, and its loader map), runs it once, and returns what each script computed and drew, with the bars it
ran on. The two build flags a member's build carries for scripts (the objects-only pane and the bar-by-bar pane)
are set, because the lane answers what a member's chart would show.

Raises `LaneUnavailable` where node or the app's modules are missing: a caller must treat that as "not graded",
never as a pass.
"""
from __future__ import annotations

import io
import json
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List

from tools.converse_eval import APP, ASSET_LOADERS, CODE_LOADERS, LaneUnavailable, _node

HERE = Path(__file__).resolve().parent
LANE_SOURCE = HERE / "script_lane.mjs"
ENGINE = APP / "src" / "components" / "chart" / "engine"


def _flag(module: str) -> str:
    """The build flag a gate reads, taken from the gate's own source (never typed here)."""
    text = (ENGINE / module).read_text(encoding="utf-8")
    found = re.search(r"source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'", text)
    if not found:
        raise LaneUnavailable(f"{module} no longer reads its flag the way this lane expects")
    return found.group(1)


def _build_script() -> str:
    env = {"MODE": "production", "DEV": False, "PROD": True, "SSR": False, "BASE_URL": "/",
           _flag("objectsOnlyPaneGate.js"): "1", _flag("runtimePaneGate.js"): "1"}
    return f"""
import {{ pathToFileURL }} from 'node:url'
const [esbuildPath, entry, outfile, appDir] = process.argv.slice(2)
const esbuild = await import(pathToFileURL(esbuildPath).href)
await esbuild.build({{
  entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  absWorkingDir: appDir, logLevel: 'error',
  loader: {json.dumps({**CODE_LOADERS, **ASSET_LOADERS})},
  jsx: 'automatic',
  define: {{ 'import.meta.env': JSON.stringify({json.dumps(env)}) }},
  banner: {{ js: "import {{ createRequire as __cr }} from 'node:module'; const require = __cr(import.meta.url);" }},
}})
"""


def run(scripts: List[Dict[str, Any]], workdir: Path | None = None) -> Dict[str, Any]:
    """scripts: [{id, source, chart}] -> {charts: {kind: {bars, others}}, scripts: {id: {ok, columns, drawn, ...}}}"""
    esbuild = APP / "node_modules" / "esbuild" / "lib" / "main.js"
    if not esbuild.exists():
        raise LaneUnavailable(f"esbuild not found at {esbuild} (app/node_modules missing?)")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(workdir or tmp)
        work.mkdir(parents=True, exist_ok=True)
        build, bundle = work / "build_script_lane.mjs", work / "script_lane.bundle.mjs"
        job, out = work / "job.json", work / "out.json"
        with io.open(build, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(_build_script())
        try:
            proc = subprocess.run([_node(), str(build), str(esbuild), str(LANE_SOURCE), str(bundle), str(APP)],
                                  capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
        except FileNotFoundError as exc:
            raise LaneUnavailable(f"node is not here: {exc}") from exc
        if proc.returncode != 0 or not bundle.exists():
            raise LaneUnavailable(f"bundling the script lane failed ({proc.returncode}): {(proc.stderr or proc.stdout)[-2000:]}")
        job.write_text(json.dumps({"scripts": scripts}), encoding="utf-8")
        proc = subprocess.run([_node(), str(bundle), str(job), str(out)], cwd=str(work), capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=900)
        if proc.returncode != 0 or not out.exists():
            raise LaneUnavailable(f"the script lane failed ({proc.returncode}): {(proc.stderr or proc.stdout)[-2000:]}")
        answer = json.loads(out.read_text(encoding="utf-8"))
    if answer.get("blocked"):
        raise LaneUnavailable(f"the script lane tried to reach the network: {answer['blocked'][:3]}")
    return answer
