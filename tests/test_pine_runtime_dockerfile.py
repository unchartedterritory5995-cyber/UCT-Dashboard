"""The pine-runtime image must agree with web's, copy every module, and carry the L4 flags.

W5-T10, docs/pine/SERVER-RUNTIME-DESIGN.md section 3.1 and L4. ONE AUTHORITY, READ NOT RETYPED:
the Node pin and the VITE_* ARG/ENV set are parsed out of Dockerfile.web and compared with
services/pine_runtime/Dockerfile; the module list comes from the directory, so a new
services/pine_runtime/*.mjs (T9's canary.mjs) is caught the day it lands without anyone
editing this file.

Mutation proof: docs/pine/evidence/2026-11-04-w5-t10/EVIDENCE.md.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVC = os.path.join(REPO, "services", "pine_runtime")
WEB = os.path.join(REPO, "Dockerfile.web")
IMG = os.path.join(SVC, "Dockerfile")
RAILWAY = os.path.join(SVC, "railway.json")

sys.path.insert(0, REPO)
from tools import vite_flag_index  # noqa: E402


def _read(p: str) -> str:
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def _logical_lines(text: str) -> list[str]:
    """Dockerfile instructions with continuations joined and comments dropped."""
    out, cur = [], ""
    for raw in text.splitlines():
        if not cur and (not raw.strip() or raw.lstrip().startswith("#")):
            continue
        if raw.rstrip().endswith("\\"):
            cur += raw.rstrip()[:-1] + " "
            continue
        out.append((cur + raw).strip())
        cur = ""
    return out


def _stages(lines: list[str]) -> list[tuple[str, list[str]]]:
    stages: list[tuple[str, list[str]]] = []
    for ln in lines:
        m = re.match(r"FROM\s+(\S+)(?:\s+AS\s+(\S+))?$", ln, re.I)
        if m:
            stages.append((m.group(2) or m.group(1), [ln]))
        elif stages:
            stages[-1][1].append(ln)
    return stages


def _stage(path: str, name: str) -> list[str]:
    for n, body in _stages(_logical_lines(_read(path))):
        if n == name:
            return body
    raise AssertionError("%s has no stage %r" % (path, name))


def _args(body: list[str]) -> set[str]:
    return {m.group(1) for ln in body if (m := re.match(r"ARG\s+(VITE_[A-Z0-9_]+)$", ln))}


def _env_pairs(body: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for ln in body:
        if ln.startswith("ENV "):
            for m in re.finditer(r"([A-Z][A-Z0-9_]*)=(\S+)", ln[4:]):
                out[m.group(1)] = m.group(2)
    return out


def _mjs_on_disk() -> list[str]:
    return sorted(f for f in os.listdir(SVC) if f.endswith(".mjs") and os.path.isfile(os.path.join(SVC, f)))


def _copies(body: list[str]) -> list[tuple[str, str, str | None]]:
    out = []
    for ln in body:
        m = re.match(r"COPY\s+(?:--from=(\S+)\s+)?(\S+)\s+(\S+)$", ln)
        if m:
            out.append((m.group(2), m.group(3), m.group(1)))
    return out


# ---- the rail can see things (non-vacuity) ------------------------------------------------

def test_the_parsers_see_both_dockerfiles():
    assert len(_args(_stage(WEB, "frontend"))) >= 5
    assert len(_args(_stage(IMG, "frontend"))) >= 5
    assert len(_mjs_on_disk()) >= 6, "the directory scan found too few services/pine_runtime/*.mjs"
    assert "server.mjs" in _mjs_on_disk()


# ---- one authority: node pin and VITE_* set -----------------------------------------------

def test_node_pin_equals_dockerfile_web():
    web = _stage(WEB, "frontend")[0]
    img = _stage(IMG, "frontend")[0]
    assert web == img, "the build stage FROM differs from Dockerfile.web: %r vs %r" % (web, img)
    assert re.match(r"FROM node:\d+\.\d+\.\d+-", img), "the Node pin must be an exact version"


def test_vite_arg_set_equals_dockerfile_web():
    assert _args(_stage(IMG, "frontend")) == _args(_stage(WEB, "frontend"))


def test_vite_env_block_equals_dockerfile_web():
    web = _env_pairs(_stage(WEB, "frontend"))
    img = _env_pairs(_stage(IMG, "frontend"))
    assert web and web == img
    assert all(v == "$" + k for k, v in img.items()), "each ENV must mirror its own ARG"


def test_every_vite_flag_the_frontend_reads_is_declared():
    missing = sorted(vite_flag_index.names_read(REPO) - _args(_stage(IMG, "frontend")))
    assert not missing, "bundle would bake these VITE_* as undefined: %s" % ", ".join(missing)


def test_the_build_runs_the_same_frontend_build_then_the_bundle():
    web = [ln for ln in _stage(WEB, "frontend") if ln.startswith("RUN cd app && npm install")]
    img = [ln for ln in _stage(IMG, "frontend") if ln.startswith("RUN cd app && npm install")]
    assert len(web) == 1 and len(img) == 1
    assert img[0].startswith(web[0]), "the web `npm run build` invocation is not reproduced"
    assert img[0].endswith("node scripts/build-pine-runtime.mjs")


# ---- the runtime stage ---------------------------------------------------------------------

def test_every_service_module_is_copied_individually():
    run = _stage(IMG, "runtime")
    copied = {src for src, _dst, frm in _copies(run) if frm is None}
    for f in _mjs_on_disk():
        src = "services/pine_runtime/%s" % f
        assert src in copied, "%s is not copied: an unlisted module is an ImportError at boot" % src
    for src, dst, frm in _copies(run):
        if frm is None:
            assert src.startswith("services/pine_runtime/") and src.endswith(".mjs"), \
                "only individually listed service modules may be copied from the context: %r" % src
            assert os.path.isfile(os.path.join(REPO, src)), "%s does not exist" % src
            assert dst == "/app/" + src


def test_the_bundle_and_node_are_copied_from_the_build_stage_to_where_server_looks():
    run = _copies(_stage(IMG, "runtime"))
    assert ("/src/app/dist-server/pine-runtime.mjs", "/app/app/dist-server/pine-runtime.mjs", "frontend") in run
    assert ("/usr/local/bin/node", "/usr/local/bin/node", "frontend") in run
    # server.mjs resolves ../../app/dist-server/pine-runtime.mjs from its own folder
    assert "'..', '..', 'app', 'dist-server', 'pine-runtime.mjs'" in _read(os.path.join(SVC, "server.mjs"))


def test_runs_non_root():
    users = [ln.split(None, 1)[1] for ln in _stage(IMG, "runtime") if ln.startswith("USER ")]
    assert users, "no USER: the container would run as root"
    assert users[-1].split(":")[0] not in ("root", "0")


def test_l4_node_flags_on_the_process():
    cmd = [ln for ln in _stage(IMG, "runtime") if ln.startswith("CMD ")]
    assert len(cmd) == 1
    argv = json.loads(cmd[0][4:])
    assert argv[0] == "node" and argv[-1] == "/app/services/pine_runtime/server.mjs"
    flags = argv[1:-1]
    # Node 20.18 spells the permission model --experimental-permission (22+: --permission).
    assert "--experimental-permission" in flags
    assert "--allow-fs-read=/app" in flags
    assert "--allow-worker" in flags
    assert "--disallow-code-generation-from-strings" in flags
    assert not any(f.startswith("--allow-fs-write") or f in ("--allow-child-process", "--allow-addons") for f in flags)


def test_image_sets_no_env_the_service_would_refuse():
    """L2: the service refuses to boot on any variable outside ENV_ALLOWLIST."""
    url = "file:///" + os.path.join(SVC, "server.mjs").replace("\\", "/").lstrip("/")
    out = subprocess.run(
        ["node", "-e", "import(process.argv[1]).then(m=>console.log(JSON.stringify(m.ENV_ALLOWLIST)))", url],
        capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    allowed = set(json.loads(out.stdout))
    assert allowed, "the allowlist read came back empty"
    for name in _env_pairs(_stage(IMG, "runtime")):
        assert name in allowed, "ENV %s in the runtime stage would make the service refuse to boot" % name
    assert not [ln for ln in _stage(IMG, "runtime") if ln.startswith("ARG ")], "no build arg may reach the runtime image"


# ---- railway.json ---------------------------------------------------------------------------

def test_railway_json_points_at_the_image_and_watches_the_closure():
    cfg = json.loads(_read(RAILWAY))
    assert cfg["build"]["builder"] == "DOCKERFILE"
    assert cfg["build"]["dockerfilePath"] == "services/pine_runtime/Dockerfile"
    assert os.path.isfile(os.path.join(REPO, cfg["build"]["dockerfilePath"]))
    watch = set(cfg["build"]["watchPatterns"])
    for p in ("services/pine_runtime/**", "app/src/components/chart/engine/**", "app/src/lib/marketClock/**",
              "app/src/components/chart/indicators.js",
              "app/src/components/chart/builder/authoring/crossContext.json",
              "app/package*.json", "app/vite.config.js"):
        assert p in watch, "watch pattern %s (design section 3.1) is missing" % p
    assert cfg["deploy"]["healthcheckPath"] == "/health"
    assert cfg["deploy"]["restartPolicyType"] == "ALWAYS"
    assert "volume" not in json.dumps(cfg).lower(), "the service is volume-less (design 3.1)"
    assert "startCommand" not in cfg["deploy"], "the CMD in the image is the one authority for the node flags"
