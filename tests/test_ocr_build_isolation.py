"""Wave P1.5 — OCR system packages belong to the WEB image and nowhere else.

⛔⛔ THIS IS A STRUCTURAL RAIL, NOT A GREP. The Dockerfile is parsed into stages
and instructions, its `apt-get install` package lists are extracted as sets, and
both Railway config files are parsed as JSON and compared field by field. A grep
for "tesseract" would pass just as happily on a commented-out line, and would say
nothing about WHICH STAGE installs it.

⚰️ IT ALSO GUARDS THE PARITY HALF, WHICH IS THE HALF THAT BITES. A build
boundary that quietly drops a dependency is worse than no boundary: `node` is
executed at RUNTIME (COT narrative prewarm, Fridays) and `ffmpeg` at RUNTIME
(Desk background audio), so losing either would look perfectly healthy for days.
The list below is the measured inventory of the nixpacks image this replaces.

⛔ AND IT PINS THE START COMMAND TO ONE AUTHORITY. `railway.web.json` is a second
config file carrying the same deploy block; two copies of a start command is
exactly the second-authority-over-one-value defect, so the deploy blocks must be
EQUAL — not similar.
"""
from __future__ import annotations

import json
import pathlib
import re
import shlex
import tomllib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SHARED_NIXPACKS = ROOT / "nixpacks.toml"
SHARED_RAILWAY = ROOT / "railway.json"
WEB_RAILWAY = ROOT / "railway.web.json"
WEB_DOCKERFILE = ROOT / "Dockerfile.web"

# The packages Wave P adds, and the ONLY OCR packages any image may install.
OCR_APT_PKGS = {"tesseract-ocr", "tesseract-ocr-eng"}
# Names that must never appear in a build for a service that cannot OCR.
OCR_MARKERS = ("tesseract", "leptonica", "onnxruntime", "opencv")
# Measured on the live web image, 2026-09-08, before this boundary existed.
# Every one of these is a RUNTIME dependency of code that already ships.
RUNTIME_PARITY_APT = {"ffmpeg", "git", "curl"}
OCR_WHEELS = ("onnxruntime", "opencv-python", "rapidocr", "pytesseract")


# ── a very small Dockerfile reader ──────────────────────────────────────────
def _instructions(text):
    """Yield (stage, verb, argument) per instruction, continuations joined."""
    joined, buf = [], ""
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        buf += line[:-1] + " " if line.endswith("\\") else line
        if not line.endswith("\\"):
            joined.append(buf.strip())
            buf = ""
    if buf:
        joined.append(buf.strip())

    stage = None
    for entry in joined:
        verb, _, arg = entry.partition(" ")
        verb = verb.upper()
        if verb == "FROM":
            m = re.search(r"\bAS\s+(\S+)", arg, re.I)
            stage = m.group(1) if m else arg.strip()
        yield stage, verb, arg.strip()


def _apt_packages(text, stage):
    """Every package named to `apt-get install` inside one stage."""
    pkgs = set()
    for st, verb, arg in _instructions(text):
        if st != stage or verb != "RUN" or "apt-get install" not in arg:
            continue
        for command in arg.split("&&"):
            command = command.strip()
            if not command.startswith("apt-get install"):
                continue
            for tok in shlex.split(command)[2:]:
                if not tok.startswith("-"):
                    pkgs.add(tok)
    return pkgs


def _in(text, stage, verb):
    return [arg for st, v, arg in _instructions(text) if st == stage and v == verb]


def _image_cmd(text):
    """The command the IMAGE runs, as a string.

    ⛔ THIS IS NOW THE ONLY START AUTHORITY FOR WEB. The first canary's container
    died in under two seconds with no output while a Railway start command was
    overriding the image; the second removes that override, so the CMD here has
    to carry the real web command — not an approximation of it.
    """
    cmds = [a for st, v, a in _instructions(text) if v == "CMD"]
    assert cmds, "the image defines no CMD"
    argv = json.loads(cmds[-1])
    return argv[-1] if isinstance(argv, list) else str(argv)


def _web_branch(start_command):
    """The `else` branch of the shared start command — what web actually runs."""
    tail = start_command.rsplit("else ", 1)[-1]
    return re.sub(r";\s*fi\s*$", "", tail).strip()


def _normalise_port(command):
    """`$PORT` and `${PORT:-8080}` are the same instruction to the same server;
    the image simply also works when run without Railway."""
    return command.replace("${PORT:-8080}", "$PORT")


@pytest.fixture(scope="module")
def dockerfile():
    return WEB_DOCKERFILE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def shared_railway():
    return json.loads(SHARED_RAILWAY.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def web_railway():
    return json.loads(WEB_RAILWAY.read_text(encoding="utf-8"))


class TestTheSharedBuildStaysClean:
    def test_the_shared_nixpacks_config_installs_no_ocr_packages(self):
        # ⛔ worker, flow-worker and bars-api build from this file. They cannot
        # perform OCR, cannot reach the Notebook database, and must not pay for
        # a capability they will never invoke.
        with SHARED_NIXPACKS.open("rb") as fh:
            shared = tomllib.load(fh)
        setup = shared.get("phases", {}).get("setup", {})
        for field in ("nixPkgs", "aptPkgs"):
            for pkg in setup.get(field, []):
                assert not any(m in pkg.lower() for m in OCR_MARKERS), (
                    "the SHARED build config installs %r — that reaches every "
                    "service, not just the OCR owner" % pkg)

    def test_the_shared_railway_config_still_builds_with_nixpacks(self, shared_railway):
        # The other three services read THIS file. If Wave P ever moved them
        # onto a Dockerfile the isolation would be gone, silently.
        assert shared_railway["build"]["builder"] == "NIXPACKS"
        assert "dockerfilePath" not in shared_railway["build"]

    def test_the_shared_requirements_gained_no_ocr_wheels(self):
        req = (ROOT / "requirements.txt").read_text(encoding="utf-8").lower()
        for pkg in OCR_WHEELS:
            assert pkg not in req, (
                "%s is in the SHARED requirements.txt — every service would "
                "install it" % pkg)


class TestTheWebImageOwnsOcr:
    def test_the_runtime_stage_installs_exactly_the_ocr_packages(self, dockerfile):
        apt = _apt_packages(dockerfile, "runtime")
        assert apt & OCR_APT_PKGS == OCR_APT_PKGS
        extra = {p for p in apt if any(m in p.lower() for m in OCR_MARKERS)}
        assert not (extra - OCR_APT_PKGS), (
            "the web image installs OCR packages beyond the two Wave P needs: %s"
            % sorted(extra - OCR_APT_PKGS))

    def test_english_language_data_is_a_package_not_a_download(self, dockerfile):
        # ⛔ An engine that fetched traineddata at runtime would make every boot
        # depend on a third-party download succeeding.
        assert "tesseract-ocr-eng" in _apt_packages(dockerfile, "runtime")
        for st, verb, arg in _instructions(dockerfile):
            if verb == "RUN" and "traineddata" in arg.lower():
                pytest.fail("the image fetches traineddata: " + arg[:120])

    def test_no_ocr_python_wheels_creep_in(self, dockerfile):
        # The rejected candidate's ~169 MB of wheels must not return through the
        # web image either. Tesseract needs no Python dependency at all.
        low = dockerfile.lower()
        for pkg in OCR_WHEELS:
            assert pkg not in low

    def test_the_image_installs_ocr_but_does_not_enable_it(self, dockerfile):
        # ⛔ Presence of the binary and activation of the feature are different
        # facts. An image that set the flag would switch OCR on for every member
        # the moment it deployed.
        for st, verb, arg in _instructions(dockerfile):
            if verb in ("ENV", "ARG"):
                assert "J2_OCR_ENABLED" not in arg, (
                    "the web image switches OCR ON: " + arg)


class TestTheBoundaryIsSelectedByRepoOwnedConfig:
    def test_the_web_config_names_this_dockerfile(self, web_railway):
        assert web_railway["build"]["builder"] == "DOCKERFILE"
        named = web_railway["build"]["dockerfilePath"]
        assert named == "Dockerfile.web"
        assert (ROOT / named).exists(), "%s is named but does not exist" % named

    def test_the_web_config_carries_no_nixpacks_build_command(self, web_railway):
        # A leftover buildCommand would be a second, silent build definition.
        assert "buildCommand" not in web_railway["build"]

    def test_the_dockerfile_is_not_auto_detected_for_everyone(self):
        # ⛔ A root `Dockerfile` is auto-detected by Railway. This boundary is
        # opt-IN by name; a bare `Dockerfile` would be opt-OUT by accident.
        assert not (ROOT / "Dockerfile").exists(), (
            "a root Dockerfile exists — any service that loses its explicit "
            "builder setting would start building from it")

    def test_the_abandoned_nixpacks_selector_is_gone(self):
        # The `NIXPACKS_CONFIG_FILE` mechanism was measured, failed, and is
        # abandoned. A config file nothing selects is operational debt that
        # reads as an active isolation mechanism to the next engineer.
        assert not (ROOT / "nixpacks.web.toml").exists()


class TestStartupSemanticsAreNotForked:
    """Changing the BUILD boundary must not create a second source of truth for
    how the application starts.

    ⚰️ THE FIRST CANARY BUILT PERFECTLY AND DIED IN UNDER TWO SECONDS with a
    Railway start command overriding the image. So web's start command moved
    INTO the image — but "moved" is the whole point: it must still be the same
    command, character for character, that every other service runs out of
    `railway.json`. One authority, in a new place, not a second one."""

    def test_the_web_config_supplies_no_start_command(self, web_railway):
        assert "startCommand" not in web_railway["deploy"], (
            "the web config supplies a start command again — the image CMD is "
            "supposed to be authoritative")

    def test_every_other_deploy_setting_is_identical_to_the_shared_one(
            self, shared_railway, web_railway):
        shared = {k: v for k, v in shared_railway["deploy"].items()
                  if k != "startCommand"}
        assert web_railway["deploy"] == shared, (
            "the web service would deploy differently from every other service "
            "reading railway.json, beyond the start command it is meant to own")

    def test_the_image_runs_the_shared_web_start_command(
            self, shared_railway, dockerfile):
        expected = _web_branch(shared_railway["deploy"]["startCommand"])
        actual = _normalise_port(_image_cmd(dockerfile))
        assert actual == expected, (
            "the image's CMD is not the web branch of the shared start "
            "command:\n  image:  %s\n  shared: %s" % (actual, expected))

    def test_the_health_check_is_unchanged(self, web_railway):
        # ☠️ Never point Railway's healthcheck at /api/ready.
        assert web_railway["deploy"]["healthcheckPath"] == "/api/health"


class TestTheWebImageKeepsTodaysRuntime:
    """⚰️ The measured inventory of the image this replaces. Each of these is
    invoked by code that already ships, on a schedule, far from any request."""

    def test_it_keeps_the_runtime_system_dependencies(self, dockerfile):
        missing = RUNTIME_PARITY_APT - _apt_packages(dockerfile, "runtime")
        assert not missing, (
            "the web image drops %s, which the nixpacks image has today — "
            "ffmpeg is Desk background audio, git is the eval runners' commit "
            "stamp" % sorted(missing))

    def test_node_reaches_the_runtime_image(self, dockerfile):
        # `cot_prewarm` and `flow_aggregate` both exec `node` off PATH. Without
        # it the COT weekly read silently stops generating.
        assert [c for c in _in(dockerfile, "runtime", "COPY") if "/node" in c], \
            "no node binary is copied into the runtime stage"

    def test_the_frontend_is_built_by_the_same_node_that_ships(self, dockerfile):
        # One node version, one authority — the runtime binary is copied out of
        # the very stage that built the bundle.
        node_copies = [c for c in _in(dockerfile, "runtime", "COPY") if "/node" in c]
        assert any("--from=frontend" in c for c in node_copies), (
            "the runtime node comes from somewhere other than the build stage — "
            "that is a second node version waiting to drift")

    def test_the_venv_lives_where_the_start_command_expects_it(self, dockerfile):
        # The image's CMD runs a BARE `uvicorn`, so the venv has to be on PATH
        # under exactly the path the nixpacks image uses.
        assert any("/opt/venv/bin" in a for a in _in(dockerfile, "runtime", "ENV")), \
            "/opt/venv/bin is not on PATH in the runtime stage"
        assert any("/opt/venv" in a for a in _in(dockerfile, "runtime", "COPY"))
        assert "uvicorn api.main:app" in _image_cmd(dockerfile)

    def test_python_stays_on_the_production_minor(self, dockerfile):
        # Tesseract creates no Python-version dependency, and this slice must
        # not move production off 3.12 as a side effect.
        bases = [arg.split()[0] for st, verb, arg in _instructions(dockerfile)
                 if verb == "FROM" and arg.lower().startswith("python:")]
        assert bases, "no python base image found"
        for image in bases:
            assert image.startswith("python:3.12"), (
                "base image %s is not python 3.12" % image)


class TestTheOtherServicesAreUntouched:
    def test_chart_renderer_keeps_its_own_independent_build(self):
        # It already owned a Dockerfile and requirements — it is the precedent
        # for this boundary, not a participant in it.
        d = ROOT / "services" / "chart_renderer"
        assert (d / "Dockerfile").exists()
        assert (d / "requirements.txt").exists()
        text = (d / "Dockerfile").read_text(encoding="utf-8") + \
               (d / "requirements.txt").read_text(encoding="utf-8")
        for m in OCR_MARKERS:
            assert m not in text.lower(), "chart_renderer gained %r" % m
