"""Wave P1.5 §33 — OCR system packages belong to the web build and nowhere else.

⛔⛔ THIS IS A STRUCTURAL RAIL, NOT A GREP. Both build files are PARSED as TOML
and compared field by field, so the assertions are about configuration
semantics rather than about whether a string happens to appear in a file. A
grep for "tesseract" would pass just as happily on a commented-out line.

⛔ AND IT PINS THE COPY, NOT ONLY THE ADDITION (§15). `nixpacks.web.toml` is a
hand-maintained duplicate of `nixpacks.toml`, which is exactly the shape that
silently drops a dependency: somebody adds a package to the shared file, forgets
the web one, and the web service quietly builds without it. The diff between
the two files must be EXACTLY the OCR packages — nothing more, nothing less,
nothing missing.
"""
from __future__ import annotations

import pathlib
import tomllib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SHARED = ROOT / "nixpacks.toml"
WEB = ROOT / "nixpacks.web.toml"

# The packages Wave P adds, and the ONLY difference permitted between the two
# build files.
OCR_APT_PKGS = {"tesseract-ocr", "tesseract-ocr-eng"}
# Names that must never appear in a build config for a service that cannot OCR.
OCR_MARKERS = ("tesseract", "leptonica", "onnxruntime", "opencv")


def _load(p: pathlib.Path) -> dict:
    with p.open("rb") as fh:
        return tomllib.load(fh)


@pytest.fixture(scope="module")
def shared():
    return _load(SHARED)


@pytest.fixture(scope="module")
def web():
    return _load(WEB)


class TestTheSharedBuildStaysClean:
    def test_the_shared_config_installs_no_ocr_packages(self, shared):
        # ⛔ worker, flow-worker and bars-api build from this file. They cannot
        # perform OCR, cannot reach the Notebook database, and must not pay for
        # a capability they will never invoke.
        setup = shared.get("phases", {}).get("setup", {})
        for field in ("nixPkgs", "aptPkgs"):
            for pkg in setup.get(field, []):
                assert not any(m in pkg.lower() for m in OCR_MARKERS), (
                    f"the SHARED build config installs {pkg!r} — that reaches "
                    f"every service, not just the OCR owner")

    def test_the_shared_config_has_no_apt_packages_at_all_today(self, shared):
        # A statement of the current baseline: if this ever becomes false, the
        # comparison below needs to learn about it rather than silently
        # treating a new shared apt package as an OCR addition.
        assert shared.get("phases", {}).get("setup", {}).get("aptPkgs") is None


class TestTheWebBuildOwnsOcr:
    def test_the_web_config_installs_exactly_the_ocr_packages(self, web):
        apt = set(web.get("phases", {}).get("setup", {}).get("aptPkgs", []))
        assert apt == OCR_APT_PKGS, (
            f"the web build's apt packages are {sorted(apt)}; Wave P adds "
            f"exactly {sorted(OCR_APT_PKGS)}")

    def test_english_language_data_is_requested_explicitly(self, web):
        # ⛔ §16 — the language data is part of the runtime dependency and is
        # named, not inherited. An engine that had to fetch traineddata at
        # runtime would make every boot depend on a third-party download.
        apt = set(web.get("phases", {}).get("setup", {}).get("aptPkgs", []))
        assert "tesseract-ocr-eng" in apt

    def test_it_does_not_pull_ocr_python_wheels(self, web):
        # The rejected candidate's ~169 MB of wheels must not creep back in
        # through the web build either. Tesseract needs no Python dependency.
        text = WEB.read_text(encoding="utf-8")
        for pkg in ("onnxruntime", "opencv-python", "rapidocr"):
            assert pkg not in text.split("# ⛔ APT")[0] + text.split("[phases.install]")[-1], (
                f"{pkg} appears in the web build's install phase")


class TestTheTwoFilesDifferOnlyByOcr:
    """§15 — a requirements/build split that saves nothing but silently drops a
    dependency is not success."""

    def test_every_other_phase_is_identical(self, shared, web):
        s_phases = shared.get("phases", {})
        w_phases = web.get("phases", {})
        assert set(s_phases) == set(w_phases), "the two configs have different phases"
        for name in s_phases:
            s = dict(s_phases[name])
            w = dict(w_phases[name])
            # The ONLY sanctioned difference.
            w.pop("aptPkgs", None)
            assert s == w, (
                f"phase [{name}] differs between the shared and web build "
                f"configs beyond the OCR packages:\n shared={s}\n web={w}")

    def test_variables_and_start_command_are_identical(self, shared, web):
        assert shared.get("variables") == web.get("variables")
        assert shared.get("start") == web.get("start"), (
            "the web service must start exactly the way it does today")

    def test_the_python_version_matches_production(self, shared, web):
        # The engine choice is Python-independent, but the wrapper-free
        # subprocess adapter still runs inside this interpreter.
        for cfg in (shared, web):
            assert cfg["variables"]["NIXPACKS_PYTHON_VERSION"] == "3.12"


class TestTheOtherServicesAreUntouched:
    def test_chart_renderer_keeps_its_own_independent_build(self):
        # It already owns a Dockerfile and requirements. Wave P must not have
        # reached into it — it is the precedent, not a participant.
        d = ROOT / "services" / "chart_renderer"
        assert (d / "Dockerfile").exists()
        assert (d / "requirements.txt").exists()
        text = (d / "Dockerfile").read_text(encoding="utf-8") + \
               (d / "requirements.txt").read_text(encoding="utf-8")
        for m in OCR_MARKERS:
            assert m not in text.lower(), f"chart_renderer gained {m!r}"

    def test_the_shared_requirements_gained_no_ocr_wheels(self):
        req = (ROOT / "requirements.txt").read_text(encoding="utf-8").lower()
        for pkg in ("onnxruntime", "opencv-python", "rapidocr", "pytesseract"):
            assert pkg not in req, (
                f"{pkg} is in the SHARED requirements.txt — every service "
                f"would install it")
