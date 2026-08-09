"""The verbatim-grounding gate.

These run against a VERBATIM excerpt of the live DIS FY26Q3 call, so the
paraphrases below are the kind a model actually produces — a real near-miss,
not a strawman that any substring check would catch.
"""
import json
import pathlib

import pytest

import api.services.call_recap_grounded as g

_FIX = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "fmp_transcript_excerpts.json")
    .read_text(encoding="utf-8")
)

# Segment the real excerpt exactly as the service does.
import api.services.fmp_transcripts as ft
SEGMENTS = ft._segment(_FIX["DIS_2026Q3_qa_excerpt"])
BEN = "Benjamin Daniel Swinburne, C.F.A."


def _seg(speaker):
    return next(s for s in SEGMENTS if s["speaker"] == speaker)


class TestLocate:
    def test_finds_a_verbatim_quote_and_returns_its_segment(self):
        body = _seg(BEN)["content"]
        quote = body[20:120]
        idx = g.locate(quote, SEGMENTS)
        assert idx is not None
        assert SEGMENTS[idx]["speaker"] == BEN

    def test_a_paraphrase_is_not_located(self):
        # Same claim, different words — exactly what the old prompt invited when
        # it asked for a "paraphrased or verbatim" quote.
        assert g.locate(
            "Management said they were pleased with how the quarter turned out.",
            SEGMENTS,
        ) is None

    def test_smart_quotes_and_whitespace_do_not_defeat_a_real_quote(self):
        body = _seg("Josh D’Amaro")["content"]
        quote = body[:80]
        mangled = quote.replace("'", "’").replace(" ", "  ").replace("-", "—")
        assert g.locate(mangled, SEGMENTS) == g.locate(quote, SEGMENTS)

    def test_an_ellipsis_may_elide_within_one_passage(self):
        body = _seg(BEN)["content"]
        head, tail = body[10:60], body[120:180]
        assert g.locate(f"{head} … {tail}", SEGMENTS) is not None

    def test_runs_must_appear_IN_ORDER(self):
        # Reversing the halves quotes words that exist but a passage that does
        # not — the elision would misrepresent what was actually said.
        body = _seg(BEN)["content"]
        head, tail = body[10:60], body[120:180]
        assert g.locate(f"{tail} … {head}", SEGMENTS) is None

    def test_words_stitched_from_two_speakers_are_not_located(self):
        a = _seg("Operator")["content"][:60]
        b = _seg(BEN)["content"][:60]
        assert g.locate(f"{a} … {b}", SEGMENTS) is None

    def test_empty_and_junk_never_match(self):
        for junk in ["", "   ", "…", None]:
            assert g.locate(junk, SEGMENTS) is None


class TestGroundItems:
    def test_drops_the_ungrounded_and_keeps_the_grounded(self):
        real = _seg(BEN)["content"][:90]
        items = [
            {"topic": "Real", "quote": real},
            {"topic": "Invented", "quote": "We are guiding to 40% revenue growth next year."},
        ]
        out = g.ground_items(items, SEGMENTS)
        assert [i["topic"] for i in out] == ["Real"]

    def test_speaker_comes_from_the_LOCATED_segment_not_the_model(self):
        # The model can copy a quote perfectly and still name the wrong person.
        # Attribution is derived from where the text actually sits.
        real = _seg(BEN)["content"][:90]
        out = g.ground_items(
            [{"topic": "x", "quote": real, "speaker": "Hugh Johnston"}], SEGMENTS)
        assert out[0]["speaker"] == BEN
        assert SEGMENTS[out[0]["segment"]]["speaker"] == BEN

    def test_the_segment_index_is_computed_not_taken_from_the_model(self):
        real = _seg(BEN)["content"][:90]
        out = g.ground_items([{"topic": "x", "quote": real, "segment": 99}], SEGMENTS)
        assert out[0]["segment"] == g.locate(real, SEGMENTS)
        assert out[0]["segment"] != 99

    def test_an_alternate_verbatim_field_can_be_gated(self):
        real = _seg("Josh D’Amaro")["content"][:70]
        out = g.ground_items(
            [{"answer": real, "takeaway": "t"}, {"answer": "never said", "takeaway": "t"}],
            SEGMENTS, field="answer")
        assert len(out) == 1

    def test_survives_ragged_input_without_raising(self):
        assert g.ground_items(None, SEGMENTS) == []
        assert g.ground_items([None, 7, {}, {"quote": ""}], SEGMENTS) == []


class TestPreparedRemarksEnd:
    def test_returns_None_when_the_transcript_has_no_marker(self):
        # DIS, MSFT and JPM genuinely contain no "question-and-answer" phrasing.
        # None means "omit the chip", which is honest; a guess would not be.
        assert g.prepared_remarks_end(SEGMENTS) is None

    def test_finds_the_boundary_when_the_operator_states_it(self):
        segs = [
            {"speaker": "Operator", "content": "Welcome to the call."},
            {"speaker": "CEO", "content": "Revenue was a record."},
            {"speaker": "Operator", "content": "We will now begin the question-and-answer session."},
            {"speaker": "Analyst", "content": "Thanks for taking my question."},
        ]
        assert g.prepared_remarks_end(segs) == 3

    def test_never_points_past_the_end(self):
        segs = [{"speaker": "Operator", "content": "question-and-answer session"}]
        assert g.prepared_remarks_end(segs) == 0


class TestRenderTranscript:
    def test_numbers_every_turn_and_names_its_speaker(self):
        rendered = g.render_transcript(SEGMENTS)
        assert rendered.startswith("[0] Operator:")
        assert BEN in rendered
        for i in range(len(SEGMENTS)):
            assert f"[{i}] " in rendered

    def test_an_unnamed_speaker_still_renders(self):
        assert "Unknown:" in g.render_transcript([{"speaker": "", "content": "x"}])


class TestSchema:
    def test_the_model_is_never_asked_for_a_location(self):
        # The whole guarantee rests on the server computing this. If `segment`
        # were ever accepted from the model, a hallucinated quote could arrive
        # with a plausible index attached and read as verified.
        blob = json.dumps(g.RECAP_SCHEMA)
        assert "segment" not in blob
        assert "prepared_remarks_end" not in blob

    def test_forward_looking_requires_a_verbatim_quote_to_rest_on(self):
        fl = g.RECAP_SCHEMA["properties"]["forward_looking"]["items"]
        assert "quote" in fl["required"]
        assert fl["additionalProperties"] is False


class TestSynthesizeGuards:
    def test_returns_None_on_an_empty_transcript_without_calling_the_model(self, monkeypatch):
        called = []
        monkeypatch.setattr(g, "_client", lambda: called.append(1))
        assert g.synthesize("DIS", {"segments": []}) is None
        assert g.synthesize("DIS", None) is None
        assert not called, "spent a model call on a transcript that isn't there"

    def test_a_refusal_is_not_mistaken_for_a_recap(self, monkeypatch):
        class _Resp:
            stop_reason = "refusal"
            content = []
            usage = type("U", (), {"input_tokens": 0, "output_tokens": 0})()

        monkeypatch.setattr(g, "_client", lambda: type("C", (), {
            "messages": type("M", (), {"create": staticmethod(lambda **k: _Resp())})()
        })())
        assert g.synthesize("DIS", {"segments": SEGMENTS}) is None

    def test_ungrounded_quotes_never_survive_a_full_synthesis(self, monkeypatch):
        real = _seg(BEN)["content"][:90]
        payload = {
            "headline": "h", "sentiment": "positive", "bullets": ["b"],
            "guidance": "raised", "guidance_detail": "d",
            "quotes": [{"topic": "real", "quote": real},
                       {"topic": "fake", "quote": "We will double revenue."}],
            "forward_looking": [{"topic": "t", "horizon": "full_year",
                                 "detail": "d", "quote": "Margins will expand 500bps."}],
            "qa_highlights": [],
            "speakers": [{"name": BEN, "role": "Analyst"}],
        }

        class _Resp:
            stop_reason = "end_turn"
            content = [type("B", (), {"type": "text", "text": json.dumps(payload)})()]
            usage = type("U", (), {"input_tokens": 100, "output_tokens": 10})()

        monkeypatch.setattr(g, "_client", lambda: type("C", (), {
            "messages": type("M", (), {"create": staticmethod(lambda **k: _Resp())})()
        })())

        out = g.synthesize("DIS", {"segments": SEGMENTS, "quarter": "2026Q3"})
        assert [q["topic"] for q in out["quotes"]] == ["real"]
        assert out["forward_looking"] == []          # invented -> dropped entirely
        assert out["speakers"] == {BEN: "Analyst"}
        assert out["quarter"] == "2026Q3"
        assert out["grounded"] is True


def test_the_operator_is_never_a_source_of_forward_guidance(monkeypatch):
    """The Operator reads instructions and introduces analysts; it does not
    state company outlook. An item landing on that turn is mis-sourced by
    construction, so it is dropped structurally rather than by asking the
    prompt more firmly (the live run showed prompt wording alone doesn't hold).
    """
    segs = [
        {"speaker": "Operator", "content": "We expect to open the lines shortly for questions."},
        {"speaker": "CFO", "content": "We expect margins to expand next year."},
    ]
    payload = {
        "headline": "h", "sentiment": "positive", "bullets": [],
        "guidance": "maintained", "guidance_detail": "", "quotes": [],
        "qa_highlights": [], "speakers": [],
        "forward_looking": [
            {"topic": "logistics", "horizon": "unspecified", "detail": "d",
             "quote": "We expect to open the lines shortly for questions."},
            {"topic": "margins", "horizon": "full_year", "detail": "d",
             "quote": "We expect margins to expand next year."},
        ],
    }

    class _Resp:
        stop_reason = "end_turn"
        content = [type("B", (), {"type": "text", "text": json.dumps(payload)})()]
        usage = type("U", (), {"input_tokens": 1, "output_tokens": 1})()

    monkeypatch.setattr(g, "_client", lambda: type("C", (), {
        "messages": type("M", (), {"create": staticmethod(lambda **k: _Resp())})()
    })())

    out = g.synthesize("X", {"segments": segs})
    assert [f["topic"] for f in out["forward_looking"]] == ["margins"]
