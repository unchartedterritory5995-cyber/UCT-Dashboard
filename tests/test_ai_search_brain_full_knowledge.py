"""Ask AI receives the whole distilled setup_knowledge entry (utilization P1, 2026-10-18).

`_brain_context` used to cut every KB hit to its first 350 characters. A setup_knowledge
entry (de-identified, trader "UCT Team") carries its Trigger, Stop and measured record at
roughly characters 400-1,400, so the model saw the description and never the part a member
asks for. A hit with source == "setup_knowledge" now gets its whole chunk (capped at
_BRAIN_SETUP_KNOWLEDGE_CHARS), other hits keep the 350 lead, and _BRAIN_TEXT_BUDGET bounds
all hits' text together.

Each test can fail: the Trigger test reds when the per-source cap is removed (350 for all),
the control proves a generic hit is still cut, and the budget test reds when the budget is
removed (two full 1,500 entries would pass 2,400).
"""
import api.routers.ai_search as ai


def _entry(n_chars: int, marker_at: int, marker: str = "Trigger: flag-high break. Stop: low of day.") -> str:
    """A synthetic de-identified playbook chunk with `marker` starting at `marker_at`."""
    lead = ("Bull flag. A strong move then a shallow, orderly flag into rising averages. " * 40)[:marker_at]
    body = lead + marker
    tail = " Measured record: no measured edge (n 855). " * 60
    return (body + tail)[:n_chars]


def _patch(monkeypatch, hits):
    import api.services.brain_kb_service as kb
    monkeypatch.setattr(kb, "search", lambda q, k=3: hits)
    monkeypatch.delenv("AI_SEARCH_BRAIN_ENABLED", raising=False)


def _segment_texts(out: str) -> list[str]:
    body = out.split("cite as 'the UCT playbook'): ", 1)[1]
    return [s.split("] ", 1)[1] for s in body.split(" | ")]


def test_a_trigger_past_char_350_reaches_the_block_for_setup_knowledge(monkeypatch):
    text = _entry(1400, marker_at=600)
    assert text.index("Trigger:") > 350
    _patch(monkeypatch, [{"trader": "UCT Team", "title": "UCT team playbook: Bull flag",
                          "score": 0.7, "source": "setup_knowledge", "text": text}])
    out = ai._brain_context("how do I trade a bull flag?", "setup-technical", False)
    assert "Trigger: flag-high break. Stop: low of day." in out
    assert _segment_texts(out) == [text.strip()]          # the whole chunk, not a lead


def test_a_generic_kb_hit_is_still_cut_at_350(monkeypatch):
    """Control: the same text from any other source keeps the 350 lead, so the test above
    is about the source rule and not about a cap that vanished for everyone."""
    text = _entry(1400, marker_at=600)
    _patch(monkeypatch, [{"trader": None, "title": "Flag notes", "score": 0.7,
                          "source": "curated", "text": text}])
    out = ai._brain_context("how do I trade a bull flag?", "setup-technical", False)
    assert "Trigger:" not in out
    assert len(_segment_texts(out)[0]) == ai._BRAIN_HIT_CHARS


def test_a_setup_knowledge_chunk_is_capped(monkeypatch):
    text = _entry(4000, marker_at=600)
    _patch(monkeypatch, [{"trader": "UCT Team", "title": "UCT team playbook: Bull flag",
                          "score": 0.7, "source": "setup_knowledge", "text": text}])
    out = ai._brain_context("how do I trade a bull flag?", "setup-technical", False)
    assert len(_segment_texts(out)[0]) == ai._BRAIN_SETUP_KNOWLEDGE_CHARS == 1500


def test_the_total_text_budget_holds_with_two_full_setup_entries(monkeypatch):
    a, b = _entry(1500, marker_at=500), _entry(1500, marker_at=450)
    _patch(monkeypatch, [
        {"trader": "UCT Team", "title": "UCT team playbook: A", "score": 0.8, "source": "setup_knowledge", "text": a},
        {"trader": "UCT Team", "title": "UCT team playbook: B", "score": 0.7, "source": "setup_knowledge", "text": b},
    ])
    out = ai._brain_context("compare a flag and a pullback", "setup-technical", False)
    segs = _segment_texts(out)
    assert len(segs) == 2
    assert segs[0] == a.strip()                                     # the first keeps its whole chunk
    assert sum(len(s) for s in segs) <= ai._BRAIN_TEXT_BUDGET == 2400
    assert len(segs[1]) == ai._BRAIN_TEXT_BUDGET - len(segs[0])     # the second gets the remainder
    # the whole block stays bounded: budget + two short headers + the fixed preamble
    assert len(out) < ai._BRAIN_TEXT_BUDGET + 400


def test_a_remainder_under_the_floor_is_dropped_not_a_stub(monkeypatch):
    a = _entry(1500, marker_at=500)
    monkeypatch.setattr(ai, "_BRAIN_TEXT_BUDGET", 1550)
    _patch(monkeypatch, [
        {"trader": "UCT Team", "title": "A", "score": 0.8, "source": "setup_knowledge", "text": a},
        {"trader": None, "title": "B", "score": 0.7, "source": "curated", "text": "x" * 900},
    ])
    out = ai._brain_context("how do I trade a bull flag?", "setup-technical", False)
    assert _segment_texts(out) == [a.strip()]
