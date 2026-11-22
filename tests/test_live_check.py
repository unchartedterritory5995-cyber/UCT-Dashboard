"""Rails for tools/live_check.py: the "is everything live?" report.

The tool's own --self-check holds the verdict table (stuck / on the way / hand / can't check / live, the glob
rules, the alert rule). These rails make that table part of the suite, prove it can FAIL (a self-check that
cannot fail proves nothing), and pin the two workflow properties that matter: it never gates a deploy, and it
never reads Railway variables in this public repo's Actions logs.
"""
from __future__ import annotations

import importlib.util
import pathlib

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "live-check.yml"


def _tool():
    spec = importlib.util.spec_from_file_location("_live_check_under_test", ROOT / "tools" / "live_check.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _big_rows(mod):
    rows = [mod.row("service", f"svc-{i}", mod.LIVE, "running the tip of master (" + "x" * 60 + ")") for i in range(40)]
    rows.append(mod.row("pipeline", "master -> production", mod.STUCK, "checks FAILED on abc; " + "y" * 150))
    rows.append(mod.row("off", "switched-off features", mod.NOTE, "95 built features are switched off on purpose"))
    return rows


def test_discord_text_fits_and_keeps_what_needs_attention():
    # the first real post (2026-11-15) overflowed 2,000 characters and lost whole sections
    mod = _tool()
    now = mod._parse_ts("2026-11-15T12:00:00+00:00")
    text = mod.discord_text(_big_rows(mod), now, "https://example.invalid/run/1")
    assert len(text) <= 1900
    assert "[STUCK] master -> production" in text
    assert "Railway services: 40 live" in text
    assert "95 built features are switched off" in text
    assert "svc-7" not in text  # a live row is counted, not listed


def test_a_failed_post_is_the_check_breaking_not_a_report(monkeypatch, tmp_path):
    # a post failure once exited 1 ("stuck"), and the job stayed green while nothing reached Discord
    mod = _tool()
    rows = [mod.row("pipeline", "master -> production", mod.LIVE, "every master commit is promoted")]
    monkeypatch.setattr(mod, "collect", lambda **k: {"now": "2026-11-15T12:00:00+00:00", "errors": {}})
    monkeypatch.setattr(mod, "evaluate", lambda f: rows)
    monkeypatch.setenv("LIVE_CHECK_DISCORD_WEBHOOK", "unchartedterritory5995-cyber/UCT-Dashboard")
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    code = mod.main(["--no-fetch", "--post", "--morning", "--state", str(tmp_path / "s.json")])
    assert code == mod.EXIT_BROKEN == 3
    assert not (tmp_path / "s.json").exists()  # nothing remembered: the next run tries again


def test_self_check_passes(capsys):
    assert _tool().self_check() == 0, capsys.readouterr().out


def test_self_check_can_fail_when_the_stuck_threshold_is_broken(capsys):
    # control: with an unreachable threshold an unpromoted commit is never "stuck", and the table must notice
    mod = _tool()
    mod.PROMOTE_STUCK_MIN = 10 ** 9
    assert mod.self_check() == 1
    assert "BAD unpromoted 3h, no hold -> STUCK" in capsys.readouterr().out


def test_self_check_can_fail_when_cant_check_reads_as_live(capsys):
    # control: a missing source must never be reported as live
    mod = _tool()
    mod.exit_code = lambda rows: 0
    assert mod.self_check() == 1
    assert "BAD no Railway -> CAN'T CHECK, exit 2" in capsys.readouterr().out


def test_workflow_never_gates_a_deploy():
    head = "\n".join(WORKFLOW.read_text(encoding="utf-8").splitlines()[:5])
    assert "# promotion-gate: no" in head


def _commands(doc):
    return [s.get("run", "") for job in doc["jobs"].values() for s in job["steps"]]


def test_workflow_never_reads_railway_variables():
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    runs = _commands(doc)
    assert any("tools/live_check.py" in r and "--post" in r for r in runs), "the check step is missing"
    assert not any("--flag-values" in r for r in runs)


def test_workflow_sparse_checkout_carries_every_file_the_tool_reads():
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    checkout = next(s for s in doc["jobs"]["check"]["steps"] if str(s.get("uses", "")).startswith("actions/checkout"))
    listed = set(checkout["with"]["sparse-checkout"].split())
    src = (ROOT / "tools" / "live_check.py").read_text(encoding="utf-8")
    freeze = (ROOT / "tools" / "deploy_freeze.py").read_text(encoding="utf-8")
    assert '"deploy_freeze.py"' in src and "tools/deploy_freeze.py" in listed
    assert '"feature_flags.json"' in src and "docs/feature_flags.json" in listed
    assert '"measurement_window.py"' in freeze and "api/services/measurement_window.py" in listed


def test_a_red_report_does_not_end_the_step_before_its_exit_is_read():
    # Actions runs `bash -e`: a bare `code=$?` after the command is never reached when the report exits 1 or 2
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    step = next(r for r in _commands(doc) if "tools/live_check.py" in r and "--post" in r)
    call = next(line for line in step.splitlines() if "tools/live_check.py" in line and not line.strip().startswith("#"))
    assert call.rstrip().endswith("|| code=$?"), call


def test_runs_queue_instead_of_cancelling_each_other():
    # a skipped promotion run cancelled the first real run while cancel-in-progress was true
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert doc["concurrency"]["cancel-in-progress"] is False


def test_repo_is_derived_not_hardcoded(monkeypatch):
    # the repo is moving to an organization: the tool must follow the checkout, not a baked-in owner
    mod = _tool()
    monkeypatch.setenv("GITHUB_REPOSITORY", "some-org/UCT-Dashboard")
    assert mod._this_repo("fallback/x") == "some-org/UCT-Dashboard"
    monkeypatch.delenv("GITHUB_REPOSITORY")
    for url, want in [("https://github.com/northstar-quarry/UCT-Dashboard.git", "northstar-quarry/UCT-Dashboard"),
                      ("git@github.com:northstar-quarry/UCT-Dashboard.git", "northstar-quarry/UCT-Dashboard"),
                      ("https://github.com/a/b", "a/b"),
                      ("", "fallback/x"),
                      ("https://example.com/not/github.git", "fallback/x")]:
        monkeypatch.setattr(mod.subprocess, "run", lambda *a, url=url, **k: type("R", (), {"stdout": url + "\n"})())
        assert mod._this_repo("fallback/x") == want, url

