"""The gate tool's own extractor_version computation (R80, session 25).

⛔⛔ THE HOLE THIS FILE EXISTS TO CLOSE. `extract_golden_gate.py`'s CLI has its OWN `--model`
flag, threaded correctly into cost estimation and request-building — but `version =
prompt.extractor_version()` was called BARE, which resolves its model from
`config.configured_model()` (the WISDOM_EXTRACT_MODEL env var), a DIFFERENT source than the
tool's own `--model`. A `--model claude-haiku-4-5` invocation recorded its version as
wx-v0-fc47bc97 — IDENTICAL to Opus's, byte-for-byte the pinned literal in production's
accepted gate row. Caught by a --dry-run before any real spend: every other printed line
correctly named Haiku; only the extractor_version line silently named Opus.

Uses --dry-run throughout: no API call, no key needed, no spend possible.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
if str(REPO / "tools" / "wisdom") not in sys.path:
    sys.path.insert(0, str(REPO / "tools" / "wisdom"))

GOLDEN_DIR = REPO / "data" / "wisdom"
PAID_VERSION = "wx-v0-fc47bc97"


def _run_dry(tmp_path, monkeypatch, extra_args):
    """Runs the real CLI's main() with --dry-run, reads back the report it wrote. Skips
    loudly if the golden set (gitignored, quote-bearing) is absent."""
    from tools.wisdom import extract_golden_gate as gate

    path, _ = None, None
    try:
        from api.services.wisdom.extract import golden
        path, _ = golden.golden_file(GOLDEN_DIR, prefer="golden-v1.1.jsonl")
    except Exception:
        pass
    if not path or not path.exists():
        pytest.skip("needs the real golden-v1.1.jsonl (gitignored)")

    db = tmp_path / "gate.db"
    out_dir = tmp_path / "out"
    gate_runs = tmp_path / "gate-runs"
    argv = ["extract_golden_gate.py", "--data-dir", str(GOLDEN_DIR), "--db", str(db),
            "--out-dir", str(out_dir), "--gate-runs-dir", str(gate_runs),
            "--golden-file", "golden-v1.1.jsonl", "--split", "dev", "--phases", "gate",
            "--max-usd", "3.0", "--dry-run", *extra_args]
    monkeypatch.setattr(sys, "argv", argv)
    monkeypatch.delenv("WISDOM_EXTRACT_MODEL", raising=False)
    monkeypatch.delenv("WISDOM_EXTRACT_BACKEND", raising=False)
    rc = gate.main()
    assert rc == 0
    reports = sorted(out_dir.glob("gate-dryrun-*.json"))
    assert reports, "dry-run must write a report file"
    return json.loads(reports[-1].read_text(encoding="utf-8"))


def test_the_DEFAULT_model_dry_run_reports_the_PINNED_version(tmp_path, monkeypatch):
    report = _run_dry(tmp_path, monkeypatch, [])
    assert report["extractor_version"] == PAID_VERSION
    assert report["model"] == "claude-opus-5"


def test_a_NON_DEFAULT_CLI_model_flag_reports_a_DIFFERENT_version(tmp_path, monkeypatch):
    """⛔⛔ THE LOAD-BEARING CASE. `--model claude-haiku-4-5` on the CLI, with NO env var set
    at all, must NOT report wx-v0-fc47bc97 -- that would be Haiku's real spend recorded
    under Opus's exact pinned version."""
    report = _run_dry(tmp_path, monkeypatch, ["--model", "claude-haiku-4-5"])
    assert report["model"] == "claude-haiku-4-5"
    assert report["extractor_version"] != PAID_VERSION
    assert "haiku" in report["extractor_version"]


def test_two_different_CLI_models_never_share_a_version(tmp_path, monkeypatch):
    haiku = _run_dry(tmp_path / "a", monkeypatch, ["--model", "claude-haiku-4-5"])
    sonnet = _run_dry(tmp_path / "b", monkeypatch, ["--model", "claude-sonnet-5"])
    assert haiku["extractor_version"] != sonnet["extractor_version"]
