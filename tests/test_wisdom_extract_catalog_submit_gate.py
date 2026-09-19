"""extract_catalog_batch.py::submit() -- the kill switch and golden gate must actually apply.

⛔⛔ BUG FOUND 2026-09-19 (adversarial review, session 28 part 3): this manual submit door called
batch.submit_pending directly with neither WISDOM_EXTRACT_ENABLED nor the golden gate checked,
despite the module's own docstring claiming "the budget and the gate still apply" -- only the raw
numeric budget cap actually applied. `extract_common.job_context()` defaults `force=True` for
every tool in this family, and R64 makes `spend_allowed()` unconditionally refuse a forced
context -- so simply adding a `spend_allowed(ctx)` check without also using `force=False` for
this ctx would make the tool NEVER able to spend, which is a different (safer, but still wrong)
defect: the tool's whole purpose is to spend, once the operator has confirmed it via
--i-understand-this-spends.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. submit() reaching batch.submit_pending while WISDOM_EXTRACT_ENABLED is off;
2. submit() reaching batch.submit_pending while the golden gate has not accepted this
   extractor_version/model/effort;
3. the ctx passed to spend_allowed() being force=True, which would make the door permanently
   unable to spend regardless of the flag (a "fix" that silently disables the tool).
"""
from __future__ import annotations

import pathlib
import sys
from types import SimpleNamespace as NS

import pytest

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools" / "wisdom"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import extract_catalog_batch as cat  # noqa: E402

from api.services.wisdom.core import store  # noqa: E402
from api.services.wisdom.extract import batch, golden  # noqa: E402


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.delenv("WISDOM_EXTRACT_ENABLED", raising=False)
    store.init_db()
    return tmp_path


def _args():
    return NS(submit_limit=None)


def test_submit_refuses_when_the_kill_switch_is_off(env, monkeypatch):
    monkeypatch.delenv("WISDOM_EXTRACT_ENABLED", raising=False)
    called = []
    monkeypatch.setattr(batch, "submit_pending", lambda *a, **k: called.append(1) or {})
    rc = cat.submit([], _args())
    assert rc != 0
    assert called == [], "submit_pending was reached despite WISDOM_EXTRACT_ENABLED being off"


def test_submit_refuses_when_the_golden_gate_has_not_accepted(env, monkeypatch):
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    monkeypatch.setattr(golden, "gate_status",
                        lambda conn, **kw: {"accepted": False, "run_id": None, "reason": "no accepted run"})
    called = []
    monkeypatch.setattr(batch, "submit_pending", lambda *a, **k: called.append(1) or {})
    rc = cat.submit([], _args())
    assert rc != 0
    assert called == [], "submit_pending was reached despite the golden gate refusing"


def test_submit_proceeds_when_both_gates_pass(env, monkeypatch):
    """⭐ CONTROL: with the switch on and the gate accepted, the door must still work -- a naive
    fix (checking spend_allowed() against a force=True ctx) would refuse this too, since R64
    makes a forced context NEVER spend regardless of the flag."""
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    monkeypatch.setattr(golden, "gate_status",
                        lambda conn, **kw: {"accepted": True, "run_id": "g1", "reason": None})
    called = []
    monkeypatch.setattr(batch, "submit_pending", lambda *a, **k: called.append(k) or {"status": "submitted"})
    rc = cat.submit([], _args())
    assert rc == 0
    assert len(called) == 1, "submit_pending was never reached even though both gates passed"


def test_the_ctx_used_for_the_spend_check_is_never_force_True(env, monkeypatch):
    """⛔⛔ THE TRAP A NAIVE FIX FALLS INTO. force=True (the tool default) makes
    batch.spend_allowed() unconditionally False (R64), so a fix that adds the check without also
    setting force=False on this ctx would make the door permanently refuse -- a quieter version
    of the same defect (the tool no longer does what its own docstring says)."""
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    seen_ctx = []

    def fake_spend_allowed(ctx):
        seen_ctx.append(ctx)
        return batch.flags.extract_enabled() and not getattr(ctx, "force", False)

    monkeypatch.setattr(batch, "spend_allowed", fake_spend_allowed)
    monkeypatch.setattr(golden, "gate_status",
                        lambda conn, **kw: {"accepted": True, "run_id": "g1", "reason": None})
    monkeypatch.setattr(batch, "submit_pending", lambda *a, **k: {"status": "submitted"})
    rc = cat.submit([], _args())
    assert rc == 0
    assert len(seen_ctx) == 1 and seen_ctx[0].force is False, (
        "the spend-check ctx was force=True -- R64 makes this door permanently unable to spend")
