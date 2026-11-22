"""The 2026-11-10 cost cuts: current-model request shapes, the bucketed catalyst
skip hash, and the earnings warm's own line in the AI-spend ledger."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from api.services import llm_models


@pytest.mark.parametrize("model,thinking,temp", [
    ("claude-sonnet-5-5", {"type": "between_tools"}, False),   # 'disabled' is a 400 on Sonnet 5.5
    ("claude-opus-5-5", None, False),                          # cannot turn thinking off at all
    ("claude-haiku-5-5", {"type": "disabled"}, False),         # sampling params are a 400
    ("claude-sonnet-5", {"type": "disabled"}, False),
    ("claude-opus-4-8", {"type": "disabled"}, False),          # temperature 400s from Opus 4.7 on
    ("claude-sonnet-4-6", {"type": "disabled"}, True),         # an env override back to 4.6 still works
    ("claude-haiku-4-5-20251001", {"type": "disabled"}, True),
])
def test_plain_derives_the_shape_from_the_model_called(model, thinking, temp):
    kw = llm_models.plain(model, temperature=0.4)
    assert kw.get("thinking") == thinking
    assert ("temperature" in kw) is temp


def test_text_of_skips_a_leading_thinking_block():
    msg = SimpleNamespace(content=[SimpleNamespace(type="thinking", thinking=""),
                                   SimpleNamespace(type="text", text="a"), SimpleNamespace(type="text", text="b")])
    assert llm_models.text_of(msg) == "ab"
    assert llm_models.text_of(SimpleNamespace(content=None)) == ""


def test_no_sonnet_4_6_or_dated_haiku_default_is_left_in_the_migrated_modules():
    import pathlib
    import re
    root = pathlib.Path(__file__).resolve().parents[1]
    migrated = ["api/routers/modelbook.py", "api/schwab_router.py", "api/services/ai_search_dossier.py",
                "api/services/journal_two/coach.py", "api/services/journal_two/coach_chat.py",
                "api/services/journal_two/pre_trade_verdict.py", "api/services/journal_two/trade_review.py",
                "api/services/significant_catalysts.py", "api/services/news_catalysts/service.py",
                "api/services/stock_brief/service.py", "api/services/transcripts.py",
                "api/services/voice_deep_research.py", "api/services/community_ask.py",
                "api/services/trader_profile_auto.py", "api/services/company_about.py", "api/services/groups.py"]
    needle = re.compile(r"""["']claude-(sonnet-4-6|haiku-4-5-20251001)["']""")
    for rel in migrated:
        code = [ln for ln in (root / rel).read_text(encoding="utf-8").splitlines()
                if not ln.lstrip().startswith("#")]
        hits = [ln for ln in code if needle.search(ln)]
        assert hits == [], (rel, hits)
    # control: the needle does see a real occurrence
    assert needle.search('x = "claude-sonnet-4-6"')


def test_catalyst_skip_hash_ignores_tape_noise_but_not_a_material_move():
    from api.services.catalyst.synthesize import compute_signals_hash
    base = {"tweets": [], "rss": [], "price": 100.0, "gap_pct": 3.1, "vol_x": 2.1}
    assert compute_signals_hash(base) == compute_signals_hash({**base, "price": 100.4, "gap_pct": 3.4, "vol_x": 2.2})
    assert compute_signals_hash(base) != compute_signals_hash({**base, "price": 104.0})
    assert compute_signals_hash(base) != compute_signals_hash({**base, "gap_pct": 6.0})
    assert compute_signals_hash(base) != compute_signals_hash({**base, "rss": [{"t": "new headline"}]})
    assert compute_signals_hash({**base, "price": None}) == compute_signals_hash({**base, "price": None})


def test_the_warm_records_under_its_own_line_and_respects_its_budget(monkeypatch, tmp_path):
    from api.services import earnings_preview_warm as w
    from api.services import llm_usage
    seen = []

    def gen(sym, row, force_fresh_check=True):
        seen.append(llm_usage.attribute()[0])

    monkeypatch.setattr(w, "_cost_cap_reached", lambda: False)
    monkeypatch.setattr(w, "_ai_budget_ok", lambda: True)
    w._safe_gen(gen, "AAPL", {})
    assert seen == ["api/services/earnings_preview_warm.py"]
    monkeypatch.setattr(w, "_ai_budget_ok", lambda: False)  # budget spent: the job does not run
    w._safe_gen(gen, "MSFT", {})
    assert len(seen) == 1
