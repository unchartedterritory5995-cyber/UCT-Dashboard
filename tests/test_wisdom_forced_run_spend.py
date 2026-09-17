"""R52 (Q-3) — `force` bypasses scheduling, never the switch that spends.

⛔⛔ THE HOLE THIS CLOSES, and it was one admin request wide. Both extract entry points read
`if not ctx.force and not flags.extract_enabled()`, so a forced run skipped the spend gate. And
`force` is a QUERY PARAMETER on `POST /api/admin/wisdom/core/jobs/{job_id}/run?force=true&
dry_run=false` (`wisdom_core.py:138-156`), guarded only by `require_admin`. The golden gate and
the budget still sat behind it, so this was never an open till — but `WISDOM_EXTRACT_ENABLED` is
the one switch in the programme that costs money, and on the forced path it did not apply.

⭐ `force` KEEPS EVERYTHING ELSE. It still bypasses the master switch, the job's kill switch and
the trading-day check — those bound WHEN work happens. Spending is a different kind of thing.

⚰️ Found because session 14's own rehearsal forced the chain and watched `extract` report `ok`
with the flag unset.
"""
from __future__ import annotations

import pathlib
import sys
from types import SimpleNamespace as NS

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))


@pytest.fixture()
def batch(monkeypatch):
    from api.services.wisdom.extract import batch as mod

    monkeypatch.delenv("WISDOM_EXTRACT_ENABLED", raising=False)
    monkeypatch.delenv(mod.ACCEPT_SPEND_ENV, raising=False)
    return mod


def _ctx(*, force: bool):
    return NS(force=force, dry_run=False, run_id="t", job_id="t", log=lambda *_: None)


# ── the four branches ────────────────────────────────────────────────────────

def test_unforced_and_dark_refuses_naming_the_switch(batch):
    assert not batch.spend_allowed(_ctx(force=False))
    assert batch.spend_refusal(_ctx(force=False)) == "WISDOM_EXTRACT_ENABLED is off"


def test_FORCED_and_dark_refuses_too_and_says_what_is_missing(batch):
    """⛔⛔ THE LOAD-BEARING ONE — this is the branch that used to spend."""
    assert not batch.spend_allowed(_ctx(force=True))
    why = batch.spend_refusal(_ctx(force=True))
    assert batch.ACCEPT_SPEND_ENV in why and batch.ACCEPT_SPEND_VALUE in why
    assert "force bypasses scheduling, never the switch that spends" in why


def test_forced_and_dark_WITH_acceptance_is_allowed(batch, monkeypatch):
    monkeypatch.setenv(batch.ACCEPT_SPEND_ENV, batch.ACCEPT_SPEND_VALUE)
    assert batch.spend_allowed(_ctx(force=True))


def test_the_flag_alone_is_enough_when_it_is_on(batch, monkeypatch):
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    assert batch.spend_allowed(_ctx(force=False)) and batch.spend_allowed(_ctx(force=True))


# ── the acceptance cannot be met by accident ─────────────────────────────────

@pytest.mark.parametrize("value", ["1", "true", "yes", "I-ACCEPT", "", "   ",
                                   "i-accept-extraction-spend"])
def test_a_near_miss_acceptance_does_not_count(batch, monkeypatch, value):
    """⛔ Not a truthy env var — the EXACT literal, case-sensitive. A switch you can satisfy with
    `=1` is a switch somebody sets while meaning something else."""
    monkeypatch.setenv(batch.ACCEPT_SPEND_ENV, value)
    assert not batch.spend_allowed(_ctx(force=True))


def test_acceptance_without_force_is_not_a_standing_grant(batch, monkeypatch):
    """⭐ The acceptance only opens the FORCED door. Left in a shell profile it grants nothing on
    its own, so it cannot become a permanent quiet bypass."""
    monkeypatch.setenv(batch.ACCEPT_SPEND_ENV, batch.ACCEPT_SPEND_VALUE)
    assert not batch.spend_allowed(_ctx(force=False))


# ── both entry points, end to end ────────────────────────────────────────────

@pytest.mark.parametrize("entry", ["run_daily", "reap"])
def test_both_entry_points_skip_a_forced_dark_run(batch, entry):
    """⛔ run_daily AND reap carried the identical bypass; fixing one would leave the other."""
    out = getattr(batch, entry)(_ctx(force=True))
    assert out["status"] == "skipped"
    assert batch.ACCEPT_SPEND_ENV in out["reason"]


@pytest.mark.parametrize("entry", ["run_daily", "reap"])
def test_both_entry_points_still_skip_an_unforced_dark_run(batch, entry):
    out = getattr(batch, entry)(_ctx(force=False))
    assert out["status"] == "skipped" and out["reason"] == "WISDOM_EXTRACT_ENABLED is off"


def test_no_entry_point_still_carries_the_old_bypass():
    """⛔ CODE, NEVER PROSE: the comment above the fix has to quote the old expression, so this
    reads the AST for the actual boolean, not the file's text."""
    import ast

    src = (REPO / "api" / "services" / "wisdom" / "extract" / "batch.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.BoolOp) or not isinstance(node.op, ast.And):
            continue
        rendered = ast.unparse(node)
        if "ctx.force" in rendered and "extract_enabled" in rendered:
            offenders.append(node.lineno)
    assert not offenders, (
        f"batch.py:{offenders} still ANDs ctx.force with extract_enabled — that is the bypass")
    # ⭐ control: the probe can see a boolean of that shape when one exists
    planted = ast.parse("x = not ctx.force and not flags.extract_enabled()")
    assert any(isinstance(n, ast.BoolOp) and "ctx.force" in ast.unparse(n)
               for n in ast.walk(planted))
