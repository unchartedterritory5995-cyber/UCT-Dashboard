"""R64 — a FORCED run can never spend. R52 (Q-3) is its predecessor and got half of it.

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

⛔⛔ R64, 2026-09-17 — R52 GUARDED THE WRONG HALF. It required an acceptance literal for a
forced run WHILE THE SWITCH WAS OFF. The dangerous case is force WITH THE SWITCH ON, where
`spend_allowed` short-circuited to True on the flag before it ever looked at `force`. And the
chain runs `sources` immediately before `extract` IN THE SAME RUN, with `sources` letting
`force` bypass its own switch outright — so one admin request took the store from 0 sources to
thousands of segments to three passes. R64: force NEVER spends, and the acceptance literal is
gone from the force path. It is not a key; there is no combination of variables that opens it.
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


def test_FORCED_and_dark_refuses_and_names_R64(batch):
    assert not batch.spend_allowed(_ctx(force=True))
    why = batch.spend_refusal(_ctx(force=True))
    assert "force never spends" in why
    # ⛔ the refusal must NOT advertise an escape hatch that no longer exists.
    assert batch.ACCEPT_SPEND_ENV not in why


def test_forced_WITH_the_acceptance_literal_is_STILL_refused(batch, monkeypatch):
    """⚰️ INVERTED BY R64. Under R52 this literal opened the forced door; it no longer does."""
    monkeypatch.setenv(batch.ACCEPT_SPEND_ENV, batch.ACCEPT_SPEND_VALUE)
    assert not batch.spend_allowed(_ctx(force=True))


def test_THE_SWITCH_ON_PLUS_FORCE_IS_THE_HAZARD_AND_IS_REFUSED(batch, monkeypatch):
    """⛔⛔ THE LOAD-BEARING ONE UNDER R64, and it is the exact case R52 allowed.

    The old test asserted `spend_allowed(force=True)` was True here and called that correct.
    That assertion WAS the hazard, written down as a requirement.
    """
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    assert batch.spend_allowed(_ctx(force=False)), "the scheduled path must still spend"
    assert not batch.spend_allowed(_ctx(force=True)), "a forced run must never spend"


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
    assert "force never spends" in out["reason"]


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


# ── R64: EVERY entry point, forced, WITH THE SWITCH ON ───────────────────────

class _TripwireClient:
    """Any attribute access at all is a failure: a paid client should never be built."""

    def __init__(self):
        self.touched = []

    def __getattr__(self, name):
        self.touched.append(name)
        raise AssertionError(
            f"R64 VIOLATED: a forced run reached the API client (.{name}). A forced run must never spend.")


@pytest.mark.parametrize("entry", ["run_daily", "reap"])
def test_forced_with_the_switch_ON_reaches_no_client(batch, monkeypatch, entry):
    """⛔⛔ THE CASE R52 ALLOWED AND R64 CLOSES — force WITH the switch on.

    Asserting on the RETURN VALUE is not enough: a refusal that had already built a client, or
    already sent a batch, would still return `skipped`. The tripwire fails on the first attribute
    touch, so this can only pass if nothing reached the API at all.
    """
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    tripwire = _TripwireClient()
    out = getattr(batch, entry)(_ctx(force=True), client=tripwire)
    assert out["status"] == "skipped"
    assert "force never spends" in out["reason"]
    assert tripwire.touched == []


def test_the_forced_AUDIT_entry_point_reaches_no_client(batch, monkeypatch):
    """The third entry point. It reaches submit_pending directly, which has no gate of its own."""
    from api.services.wisdom.extract import audit

    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("WISDOM_EXTRACT_AUDIT_ENABLED", "1")
    tripwire = _TripwireClient()
    out = audit.run_audit(_ctx(force=True), client=tripwire)
    assert out["status"] == "skipped"
    assert "force never spends" in out["reason"]
    assert tripwire.touched == []


def test_POSITIVE_CONTROL_the_gate_is_not_simply_refusing_everything(batch, monkeypatch):
    """⭐ Without a control, every tripwire assertion above would pass just as well against a
    system that refuses all work or never calls the API at all — which is exactly how a spend
    guard gets mistaken for a working one.

    Two facts, because neither alone is enough:
      1. with the switch on and NO force, the gate SAYS YES — so the refusals above are about
         `force`, not about a system that is simply shut;
      2. the tripwire really does fire when something touches it — so `touched == []` above is
         evidence of silence, not of a broken instrument.

    ⚠️ It deliberately does NOT drive a real entry point to the client: on an empty store every
    path short-circuits before building one (`reap` returns `idle`, `run_daily` stops at the
    golden gate), so a 'the client was used' assertion there would fail for reasons that have
    nothing to do with spending.
    """
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    assert batch.spend_allowed(_ctx(force=False))

    tripwire = _TripwireClient()
    with pytest.raises(AssertionError, match="reached the API client"):
        tripwire.messages
    assert tripwire.touched == ["messages"]

