"""`app/scripts/precompress-assets.mjs`, run for real by node on a temporary dist,
and the build wiring that puts its output in the deployed image."""
from __future__ import annotations

import gzip
import importlib.util
import json
import os
import shutil
import subprocess
import tomllib
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "app" / "scripts" / "precompress-assets.mjs"
TEXT = b"export const answer = 'a very compressible hashed chunk';\n" * 400

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")


def run(dist: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["node", str(SCRIPT), "--dist", str(dist)],
        capture_output=True, text=True, timeout=120,
    )


def brotli_decode(path: Path) -> bytes:
    """Decoded by node's own zlib, so the rail needs no Python Brotli package."""
    done = subprocess.run(
        ["node", "-e", "process.stdout.write(require('zlib').brotliDecompressSync("
                       "require('fs').readFileSync(process.argv[1])))", str(path)],
        capture_output=True, timeout=60,
    )
    assert done.returncode == 0, done.stderr
    return done.stdout


@pytest.fixture()
def dist(tmp_path):
    root = tmp_path / "dist"
    (root / "assets" / "nested").mkdir(parents=True)
    return root


@pytest.mark.parametrize("name", ["app-1.js", "app-2.css", "nested/worker-3.js"])
def test_both_sidecars_decode_to_the_exact_plain_bytes(dist, name):
    plain = dist / "assets" / name
    plain.write_bytes(TEXT)
    assert run(dist).returncode == 0
    br, gz = Path(f"{plain}.br"), Path(f"{plain}.gz")
    assert brotli_decode(br) == TEXT
    assert gzip.decompress(gz.read_bytes()) == TEXT
    assert br.stat().st_size < len(TEXT) and gz.stat().st_size < len(TEXT)


def test_the_plain_file_is_not_touched(dist):
    plain = dist / "assets" / "app-1.js"
    plain.write_bytes(TEXT)
    os.utime(plain, (1_000_000_000, 1_000_000_000))
    assert run(dist).returncode == 0
    assert plain.read_bytes() == TEXT
    assert plain.stat().st_mtime == 1_000_000_000


@pytest.mark.parametrize("name", ["font-v4.woff2", "logo-1.png", "app-1.js.map", "data-1.json"])
def test_only_js_and_css_are_compressed(dist, name):
    (dist / "assets" / name).write_bytes(TEXT)
    assert run(dist).returncode == 0
    assert sorted(p.name for p in (dist / "assets").iterdir() if p.is_file()) == [name]


def test_a_file_outside_assets_is_left_alone(dist):
    (dist / "index.js").write_bytes(TEXT)
    assert run(dist).returncode == 0
    assert not (dist / "index.js.br").exists()


def test_no_sidecar_when_compressing_does_not_help(dist):
    noise = os.urandom(4096)
    plain = dist / "assets" / "noise-1.js"
    plain.write_bytes(noise)
    Path(f"{plain}.br").write_bytes(b"stale")
    assert run(dist).returncode == 0
    assert not Path(f"{plain}.br").exists()
    assert not Path(f"{plain}.gz").exists()
    assert plain.read_bytes() == noise


def test_a_second_run_is_idempotent_and_leaves_no_temp_files(dist):
    (dist / "assets" / "app-1.js").write_bytes(TEXT)
    assert run(dist).returncode == 0
    assert run(dist).returncode == 0
    names = sorted(p.name for p in (dist / "assets").iterdir() if p.is_file())
    assert names == ["app-1.js", "app-1.js.br", "app-1.js.gz"]


def test_a_dist_with_no_assets_directory_fails_loudly(tmp_path):
    assert run(tmp_path / "missing").returncode != 0


def test_the_notebook_byte_budget_measures_the_same_thing_after_precompress(dist):
    """The budget sums plain JS named by Vite's manifest. Sidecars must not move it."""
    spec = importlib.util.spec_from_file_location(
        "notebook_perf_budgets", REPO / "tools" / "notebook_perf_budgets.py")
    budgets = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(budgets)
    (dist / ".vite").mkdir()
    manifest = {
        "index.html": {"file": "assets/app-1.js", "imports": ["_b.js"]},
        "_b.js": {"file": "assets/b-2.js"},
    }
    (dist / ".vite" / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (dist / "assets" / "app-1.js").write_bytes(TEXT)
    (dist / "assets" / "b-2.js").write_bytes(TEXT * 2)
    keys = budgets.static_closure(budgets.load_manifest(dist), ["index.html"])
    before = budgets.closure_bytes(manifest, dist, keys)
    assert run(dist).returncode == 0
    assert budgets.closure_bytes(budgets.load_manifest(dist), dist, keys) == before
    assert before[0] == len(TEXT) * 3


# ── wiring: the sidecars must exist in the image Railway builds ───────────────

def test_npm_build_precompresses_last():
    build = json.loads((REPO / "app" / "package.json").read_text(encoding="utf-8"))["scripts"]["build"]
    steps = [s.strip() for s in build.split("&&")]
    assert steps[0] == "vite build"
    assert steps[-1] == "node scripts/precompress-assets.mjs"


def _dockerfile_stages() -> dict[str, list[str]]:
    """Instruction lines by stage name; comments cannot satisfy a rail."""
    stages: dict[str, list[str]] = {}
    current: list[str] = []
    for raw in (REPO / "Dockerfile.web").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("FROM "):
            current = stages.setdefault(line.split()[-1], [])
        elif line and not line.startswith("#"):
            current.append(line)
    return stages


def test_the_web_image_builds_with_npm_run_build():
    runs = [l for l in _dockerfile_stages()["frontend"] if l.startswith("RUN ")]
    assert any(l.startswith("RUN cd app && ") and l.endswith("npm run build") for l in runs)


def test_nixpacks_builds_with_npm_run_build():
    config = tomllib.loads((REPO / "nixpacks.toml").read_text(encoding="utf-8"))
    cmds = config["phases"]["build"]["cmds"]
    assert any(c.startswith("cd app && ") and c.endswith("npm run build") for c in cmds)


def test_the_runtime_stage_copies_the_whole_dist():
    assert "COPY --from=frontend /src/app/dist /app/app/dist" in _dockerfile_stages()["runtime"]
