"""RF (2026-10-02) — `tools/runtime_pane_smoke.py`'s helpers can say yes AND no.

The smoke is never run against production from a lane, so its first real run is
the post-flip step of `docs/pine/runtime-pane-switch-on-plan.md`. These rails keep
the parts that decide its verdict honest until then (rule 14: an instrument that
cannot fail is not an instrument).
"""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("runtime_pane_smoke", ROOT / "tools" / "runtime_pane_smoke.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_self_check_passes():
    assert _load().self_check() == 0


def test_the_self_check_fails_when_the_worker_matcher_is_broken():
    mod = _load()
    mod.WORKER_RE = re.compile("never-matches-anything")
    assert mod.self_check() == 1


def test_the_flag_matcher_reads_on_and_off_apart():
    mod = _load()
    assert mod.flag_on('{VITE_PINE_RUNTIME_PANE_ENABLED:"1"}')
    assert not mod.flag_on('{VITE_PINE_RUNTIME_PANE_ENABLED:""}')
    assert not mod.flag_on('{VITE_PINE_OBJECTS_ONLY_PANE_ENABLED:"1"}')


def test_without_credentials_it_is_INCONCLUSIVE_never_a_pass(monkeypatch):
    monkeypatch.delenv("SMOKE_EMAIL", raising=False)
    monkeypatch.delenv("SMOKE_PASSWORD", raising=False)
    assert _load().main(["--base", "http://127.0.0.1:9", "--auth"]) == 2


def test_the_smoke_document_is_in_the_fixture():
    import json
    mod = _load()
    docs = json.loads(mod.FIXTURE.read_text(encoding="utf-8"))["documents"]
    assert any(d["slug"] == mod.SMOKE_SLUG for d in docs)


def test_GT_the_stage_check_says_yes_and_no():
    """GT: `--expect-pane` turns the per-member gate into a verdict. It must fail
    on the wrong answer, on a missing key, and on an allowlist without the graded
    script; and report-only (no expectation) never fails."""
    mod = _load()
    g = "d0853c4724651a1d3c63542a2ae767861030137cb1c75ea57a376c53a1630499"
    assert mod.stage_verdict("on", True, [g], g) == []
    assert mod.stage_verdict("off", False, [g], g) == []
    assert mod.stage_verdict(None, "anything", None, g) == []
    assert mod.stage_verdict("on", False, [g], g)
    assert mod.stage_verdict("off", True, [g], g)
    assert mod.stage_verdict("on", None, [g], g)
    assert mod.stage_verdict("on", True, [], g)


def test_GT_the_self_check_fails_when_the_stage_check_is_broken():
    mod = _load()
    mod.stage_verdict = lambda expect, pane, allow, graded_hash: []
    assert mod.self_check() == 1
