"""Every CI job that installs a browser runs on an explicitly pinned image, never `*-latest` (2026-11-19).

Measured 2026-11-19: GitHub's `ubuntu-latest` is ubuntu-26.04 (every job's "Image:" line in that day's runs), and
Playwright 1.58 has no Chromium for it: the first run of pine-host-parity-chromium.yml died in its install step
("Playwright does not support chromium on ubuntu26.04-x64") before testing anything. A browser job on a moving
image breaks on the image's schedule, not on any change of ours, and reads as a red on whatever PR was open.

So: a job that installs Playwright's browsers (or launches one through Playwright or Puppeteer) names its image
exactly (`ubuntu-24.04`), and moves it deliberately together with its Playwright pin. The census that day found
exactly one such job (the host-parity Chromium half); every other job ran on 26.04 and passed, none installs a
browser. The rail finds them by reading the steps, so a new browser job is held to it the day it lands.

Standard library + PyYAML.
"""
from __future__ import annotations

import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
#: What a step that brings up a real browser says.
BROWSER = re.compile(r"playwright\s+install|playwright==|npx\s+playwright|puppeteer|@playwright/test", re.I)
PINNED = re.compile(r"^(ubuntu|windows|macos)-\d+(\.\d+)?$")


def browser_jobs_with_their_images(docs: dict[str, dict]) -> list[tuple[str, str, object]]:
    """(workflow, job, runs-on) for every job one of whose steps installs or launches a browser."""
    out = []
    for name, doc in docs.items():
        for job_name, job in (doc.get("jobs") or {}).items():
            steps = job.get("steps") or []
            text = "\n".join(str(s.get("run") or "") + " " + str(s.get("uses") or "") for s in steps)
            if BROWSER.search(text):
                out.append((name, job_name, job.get("runs-on")))
    return out


def unpinned(found: list[tuple[str, str, object]]) -> list[str]:
    return [f"{w}::{j} runs-on {r!r}" for w, j, r in found if not (isinstance(r, str) and PINNED.match(r))]


def _docs() -> dict[str, dict]:
    files = sorted(WORKFLOWS.glob("*.y*ml"))
    assert len(files) >= 10, f"only {len(files)} workflow files under {WORKFLOWS}"
    return {f.name: yaml.safe_load(f.read_text(encoding="utf-8")) for f in files}


def test_every_job_that_brings_up_a_browser_names_its_image():
    found = browser_jobs_with_their_images(_docs())
    # non-vacuous: the census of 2026-11-19 found the host-parity Chromium half, and it must still be found
    assert ("pine-host-parity-chromium.yml", "chromium-half") in [(w, j) for w, j, _ in found], found
    bad = unpinned(found)
    assert not bad, "browser jobs on a moving image (pin one, e.g. ubuntu-24.04, with its Playwright pin):\n" + "\n".join(bad)


def test_the_rail_can_tell_a_pinned_browser_job_from_a_moving_one_and_ignores_the_rest():
    docs = {
        "a.yml": {"jobs": {
            "moving": {"runs-on": "ubuntu-latest", "steps": [{"run": "python -m playwright install --with-deps chromium"}]},
            "pinned": {"runs-on": "ubuntu-24.04", "steps": [{"run": "npx playwright install chromium"}]},
            "expr": {"runs-on": "${{ matrix.os }}", "steps": [{"run": "pip install playwright==1.58.0"}]},
            "no-browser": {"runs-on": "ubuntu-latest", "steps": [{"run": "npx vitest run src/"}]},
            "prose": {"runs-on": "ubuntu-latest", "steps": [{"name": "playwright install is not here", "run": "echo hi"}]},
        }},
    }
    found = browser_jobs_with_their_images(docs)
    assert sorted(j for _, j, _ in found) == ["expr", "moving", "pinned"]
    assert sorted(unpinned(found)) == ["a.yml::expr runs-on '${{ matrix.os }}'", "a.yml::moving runs-on 'ubuntu-latest'"]
