"""The stock-brief prompt must describe the move in the direction it went.

The prompt was written for the Model Book, whose entries are all big winners, so
it hardcoded "rose". The Company Panel reuses the same generator across the whole
universe, so it was telling the model "The stock rose about -15% that year" for
AAL. Caught 8 Sep 2026 while prewarming stories for 3,269 symbols.
"""
import pytest


def _prompt(gain):
    from api.routers.modelbook import _desc_messages
    _system, prompt = _desc_messages("AAL", "American Airlines", 2026, gain)
    return prompt


class TestStockBriefPromptDirection:
    def test_a_decline_is_described_as_a_fall(self):
        p = _prompt(-15.1)
        assert "fell about 15%" in p
        assert "rose about -15%" not in p
        assert "rose" not in p.split("Return JSON")[0]

    def test_a_gain_is_still_described_as_a_rise(self):
        p = _prompt(240.0)
        assert "rose about 240%" in p

    def test_a_flat_year_never_claims_a_big_move(self):
        """A SPAC at +0.9% has not made a 'big move'; asking why it did invites
        the model to invent one."""
        p = _prompt(0.9)
        assert "rose about 1%" in p
        assert "big move" not in p

    def test_unknown_gain_stays_neutral(self):
        p = _prompt(None)
        assert "made a large move" in p
        assert "rose" not in p.split("Return JSON")[0]

    @pytest.mark.parametrize("gain", [-99.9, -0.4, 0.0, 0.4, 5000.0])
    def test_never_emits_a_negative_percentage(self, gain):
        """The sign belongs in the verb, not in the number."""
        p = _prompt(gain).split("Return JSON")[0]
        assert "-" not in p.replace("American Airlines", ""), p
