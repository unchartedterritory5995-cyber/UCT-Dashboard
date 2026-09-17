"""R53 — the per-night REQUEST throttle is a VALUE, and an unusable one refuses.

⛔⛔ THE SAME DISTINCTION `test_wisdom_daily_budget.py` IS WRITTEN AROUND, one number over.
`WISDOM_DAILY_SEGMENT_LIMIT` is a QUANTITY, not a gate: unset cannot mean "submit nothing" (an
invisible outage) or "submit everything" (an invisible bill), so it defaults to the ruled 400 —
and a value that is PRESENT but nonsensical is refused rather than defaulted, because
`WISDOM_DAILY_SEGMENT_LIMIT=4OO` (letter O) quietly becoming 400 is how a night gets re-sized by
nobody.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a throttle a typo can change (a non-numeric, fractional, zero or negative value defaulting
   instead of raising);
2. THE LOAD-BEARING ONE — the value being captured at IMPORT instead of read per call. A default
   argument (`limit: int = DAILY_SEGMENT_LIMIT`) is evaluated once, when the module is first
   imported, so the whole point of the variable — changing the throttle without a deploy — would
   be silently undone while every other test in this file still passed;
3. the default drifting off 400, or the env name growing a second reader.
"""
from __future__ import annotations

import inspect
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services.wisdom import registry                          # noqa: E402
from api.services.wisdom.core import store, timeutil              # noqa: E402
from api.services.wisdom.extract import batch                     # noqa: E402


def _ctx(dry_run=False):
    return registry.JobContext(job_id="wisdom_test", now_et=timeutil.now_et(), due_key=None, force=False,
                               dry_run=dry_run, run_id="run-test")


@pytest.fixture()
def clean_env(monkeypatch):
    """⛔ The variable is deleted, never set: every test below decides its own state."""
    monkeypatch.delenv(batch.DAILY_SEGMENT_LIMIT_ENV, raising=False)
    return batch


@pytest.fixture()
def wisdom_db(tmp_path, monkeypatch, clean_env):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    monkeypatch.setenv(batch.PASSES_ENV, "1")
    monkeypatch.delenv("WISDOM_EXTRACT_MODEL", raising=False)
    monkeypatch.delenv("WISDOM_EXTRACT_EFFORT", raising=False)
    store.init_db()
    return tmp_path / "wisdom.db"


# ── 1. the value ─────────────────────────────────────────────────────────────

def test_unset_is_the_ruled_400(clean_env):
    assert batch.DAILY_SEGMENT_LIMIT == 400, "the ruled default; changing it is a decision, not a refactor"
    assert batch.daily_segment_limit() == 400


@pytest.mark.parametrize("raw,want", [("133", 133), ("1", 1), ("2000", 2000), ("  250  ", 250)])
def test_a_set_value_wins(clean_env, monkeypatch, raw, want):
    monkeypatch.setenv(batch.DAILY_SEGMENT_LIMIT_ENV, raw)
    assert batch.daily_segment_limit() == want


@pytest.mark.parametrize("raw", ["", "   "])
def test_a_blank_value_is_the_default_not_a_refusal(clean_env, monkeypatch, raw):
    """An operator clearing the variable means "use the ruled number", which is well-defined."""
    monkeypatch.setenv(batch.DAILY_SEGMENT_LIMIT_ENV, raw)
    assert batch.daily_segment_limit() == 400


# ── 2. refusal ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw", ["4OO", "abc", "400.5", "1e3", "400,000"])
def test_a_non_numeric_value_REFUSES_and_never_falls_back(clean_env, monkeypatch, raw):
    """⛔⛔ A typo must never quietly become a throttle. `400.5` and `1e3` are typos too — a
    request count is a whole number, and silently truncating one is the same class of guess."""
    monkeypatch.setenv(batch.DAILY_SEGMENT_LIMIT_ENV, raw)
    with pytest.raises(batch.DailySegmentLimitUnusable) as exc:
        batch.daily_segment_limit()
    assert batch.DAILY_SEGMENT_LIMIT_ENV in str(exc.value)
    assert "400" in str(exc.value), "the refusal should say what it declined to fall back to"


def test_zero_and_negative_REFUSE_and_the_message_names_the_right_lever(clean_env, monkeypatch):
    for bad in ("0", "-5"):
        monkeypatch.setenv(batch.DAILY_SEGMENT_LIMIT_ENV, bad)
        with pytest.raises(batch.DailySegmentLimitUnusable) as exc:
            batch.daily_segment_limit()
        assert "WISDOM_EXTRACT_ENABLED" in str(exc.value), (
            "zero is not a pause button; the refusal must point at the switch that is")


def test_the_refusal_is_the_same_shape_as_the_budgets():
    """⭐ One idiom for "a VALUE that is set but unusable", so a reader who knows one knows both."""
    from api.services.wisdom.extract import budget

    assert issubclass(batch.DailySegmentLimitUnusable, ValueError)
    assert issubclass(budget.DailyBudgetUnusable, ValueError)


# ── 3. read PER CALL — the load-bearing section ──────────────────────────────

def test_the_value_is_read_after_import_not_at_it(clean_env, monkeypatch):
    """⛔⛔ THE POINT OF THE WHOLE CHANGE. `batch` was imported at the top of this file, long
    before this line runs; a value captured at import could not possibly see this setenv."""
    assert batch.daily_segment_limit() == 400
    monkeypatch.setenv(batch.DAILY_SEGMENT_LIMIT_ENV, "37")
    assert batch.daily_segment_limit() == 37, "the throttle was captured at import, not read now"
    monkeypatch.setenv(batch.DAILY_SEGMENT_LIMIT_ENV, "38")
    assert batch.daily_segment_limit() == 38, "it is read once per process, not once per call"


def test_neither_signature_CAPTURES_the_limit_as_a_default_argument():
    """⛔ THE STRUCTURAL HALF, and it is not redundant with the behavioural ones below: Python
    evaluates a default argument ONCE, at function definition, i.e. at import. `limit: int =
    DAILY_SEGMENT_LIMIT` would pin the number to whatever the environment held when the pod
    booted, and no amount of setting the variable afterwards would move it."""
    for fn in (batch.submit_pending, batch.run_daily):
        default = inspect.signature(fn).parameters["limit"].default
        assert default is None, (
            f"{fn.__name__}'s `limit` default is {default!r}, evaluated at import — resolve it "
            "inside the function instead")


def test_submit_pending_resolves_the_throttle_ON_EVERY_CALL(wisdom_db, monkeypatch):
    """⛔⛔ THE BEHAVIOURAL ONE — the variable is set AFTER the module was imported AND after the
    first call, and the second call must use the new number. The seams are the two queries the
    limit is actually spent on, so this reads the number the product submits against."""
    seen = []
    monkeypatch.setattr(batch, "retry_rows",
                        lambda conn, version, purpose, limit: seen.append(limit) or [])
    monkeypatch.setattr(batch, "pending_segments",
                        lambda conn, version, limit: seen.append(limit) or [])

    assert batch.submit_pending(_ctx())["status"] == "nothing_to_do"
    assert seen == [400, 400], "the default throttle did not reach the queries that spend it"

    monkeypatch.setenv(batch.DAILY_SEGMENT_LIMIT_ENV, "17")
    seen.clear()
    assert batch.submit_pending(_ctx())["status"] == "nothing_to_do"
    assert seen == [17, 17], "the override was not read on this call — it was captured earlier"


def test_run_daily_resolves_the_throttle_ON_EVERY_CALL(wisdom_db, monkeypatch):
    monkeypatch.setattr(batch, "segment_pending_sources", lambda **kw: {"sources_considered": 0})
    monkeypatch.setattr(batch.golden, "gate_status",
                        lambda conn, **kw: {"accepted": True, "run_id": "g", "reason": None})
    seen = []
    monkeypatch.setattr(batch, "submit_pending",
                        lambda ctx, **kw: seen.append(kw.get("limit")) or {"status": "nothing_to_do"})

    batch.run_daily(_ctx())
    monkeypatch.setenv(batch.DAILY_SEGMENT_LIMIT_ENV, "42")
    batch.run_daily(_ctx())
    assert seen == [400, 42], "run_daily read the throttle once, not once per run"


def test_an_explicit_limit_still_wins_over_the_environment(wisdom_db, monkeypatch):
    """⛔ THE CALLER THAT MUST NOT CHANGE: `extract/audit.py` passes `limit=len(segments)` — the
    weekly audit sizes itself by its own sample, and the nightly throttle must not touch it."""
    monkeypatch.setenv(batch.DAILY_SEGMENT_LIMIT_ENV, "9")
    seen = []
    monkeypatch.setattr(batch, "retry_rows",
                        lambda conn, version, purpose, limit: seen.append(limit) or [])
    monkeypatch.setattr(batch, "pending_segments",
                        lambda conn, version, limit: seen.append(limit) or [])
    batch.submit_pending(_ctx(), limit=3)
    assert seen == [3, 3]


# ── 4. one authority ─────────────────────────────────────────────────────────

def test_the_env_name_is_read_from_exactly_one_place():
    """⛔ A second reader is a second authority over one number."""
    import ast

    hits = []
    for path in (REPO / "api" / "services" / "wisdom").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and node.value == "WISDOM_DAILY_SEGMENT_LIMIT":
                hits.append(f"{path.relative_to(REPO).as_posix()}:{node.lineno}")
    assert len(hits) == 1, f"the env name is read in more than one place: {hits}"
    assert hits[0].startswith("api/services/wisdom/extract/batch.py")


def test_it_is_a_different_ceiling_from_the_dollar_caps(clean_env, monkeypatch):
    """⛔ A REQUEST count is not a DOLLAR cap; the two must never be wired to one variable."""
    from api.services.wisdom.extract import budget

    monkeypatch.setenv(batch.DAILY_SEGMENT_LIMIT_ENV, "40")
    monkeypatch.delenv(budget.DAILY_BUDGET_ENV, raising=False)
    monkeypatch.delenv("WISDOM_EXTRACT_BUDGET_USD", raising=False)
    assert batch.daily_segment_limit() == 40
    assert budget.daily_budget_usd() == budget.DEFAULT_DAILY_BUDGET_USD
    assert budget.budget_cap_usd() == budget.DEFAULT_BUDGET_USD
    assert batch.DAILY_SEGMENT_LIMIT_ENV not in (budget.DAILY_BUDGET_ENV, "WISDOM_EXTRACT_BUDGET_USD")
