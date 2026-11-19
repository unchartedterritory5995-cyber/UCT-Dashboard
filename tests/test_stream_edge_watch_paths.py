"""stream-edge rebuilds only when a file it RUNS changes (railway.edge.json watchPatterns).
A module it loads but does not watch would ship to web while stream-edge kept running the
old code. The list is checked against what the process actually imports."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

PROBE = r"""
import sys, asyncio
from api.stream_edge_main import build_app
build_app(start_feed=False)
from api.services import remote_broadcaster, bar_stream, bar_broadcaster, feed_client  # start_remote
from api import chart_edge_token                                                      # edge_access
from api.services import bar_contract
for lazy in ("api.services.bars_fetch", "api.services.bars_sqlite"):                  # stream_fields
    try:
        __import__(lazy)
    except Exception:
        pass
root = sys.argv[1]
for m in sorted(sys.modules):
    if m == "api" or m.startswith("api."):
        f = getattr(sys.modules[m], "__file__", None) or ""
        if f.startswith(root):
            print(f[len(root) + 1:].replace("\\", "/"))
"""


def test_every_module_stream_edge_loads_is_a_watch_path():
    out = subprocess.run([sys.executable, "-c", PROBE, str(ROOT)], cwd=ROOT, capture_output=True,
                         text=True, timeout=120, check=True).stdout.split()
    loaded = {p for p in out if not p.endswith("__init__.py")}
    watched = set(json.loads((ROOT / "railway.edge.json").read_text(encoding="utf-8"))["build"]["watchPatterns"])
    assert "api/stream_edge_main.py" in loaded
    missing = sorted(loaded - watched)
    assert not missing, f"add to railway.edge.json watchPatterns: {missing}"
    # nixpacks.toml stays watched although Railway STORES builder RAILPACK for stream-edge: the build
    # log of its last successful deployment (2026-11-19) says "using build driver nixpacks-v1.41.0"
    # and runs nixpacks.toml's own setup and install (python312, nodejs_20, ffmpeg, /opt/venv).
    # So that file shapes stream-edge's image, and a change to it must rebuild stream-edge.
    for f in ("requirements.txt", "nixpacks.toml", "runtime.txt", "railway.edge.json"):
        assert f in watched
