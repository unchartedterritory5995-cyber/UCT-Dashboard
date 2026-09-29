"""TERM-044 / FB-A6-02 — span-anchored citations on the call recap's key points.

Every bullet travels with the verbatim passage the model says it rests on; the
SERVER finds that passage in the transcript and computes {segment, start, end}.
A passage it cannot find yields no anchor, so the bullet renders uncited rather
than wrongly cited.

No network: the transcript is the recorded DIS excerpt the quote gate already
uses, and the model response is a recorded-shape fixture fed through
`finish_from_message` — the same function the live and Batch lanes share.
"""
import json
import pathlib

import pytest

import api.services.call_recap_grounded as g
import api.services.fmp_transcripts as ft

_FIXTURES = pathlib.Path(__file__).parent / "fixtures"
_EXCERPTS = json.loads((_FIXTURES / "fmp_transcript_excerpts.json").read_text(encoding="utf-8"))
_RESPONSE = json.loads(
    (_FIXTURES / "call_recap_bullet_anchor_response.json").read_text(encoding="utf-8"))
SEGMENTS = ft._segment(_EXCERPTS[_RESPONSE["transcript_fixture"]])
MODEL_PAYLOAD = json.loads(_RESPONSE["text"])


class _Block:
    type = "text"

    def __init__(self, text):
        self.text = text


class _Usage:
    def __init__(self, i, o):
        self.input_tokens, self.output_tokens = i, o


class _Message:
    """The recorded response, in the Message shape both lanes hand over."""

    def __init__(self, text, stop_reason="end_turn", usage=(1, 1)):
        self.stop_reason = stop_reason
        self.content = [_Block(text)]
        self.usage = _Usage(*usage)


def _recorded():
    return _Message(_RESPONSE["text"], _RESPONSE["stop_reason"],
                    (_RESPONSE["usage"]["input_tokens"], _RESPONSE["usage"]["output_tokens"]))


def _finish(payload_or_message):
    msg = payload_or_message if isinstance(payload_or_message, _Message) else \
        _Message(json.dumps(payload_or_message))
    return g.finish_from_message("DIS", {"segments": SEGMENTS, "quarter": "2026Q3"}, msg)


# ── the gate ─────────────────────────────────────────────────────────────────

class TestVerifiedSpan:
    def test_a_real_passage_maps_back_to_the_transcripts_own_characters(self):
        content = SEGMENTS[2]["content"]
        evidence = content[186:300]
        assert g.verified_span(evidence, content) == (186, 300)

    def test_the_span_is_the_transcripts_text_even_when_the_copy_was_tidied(self):
        # Smart quotes, doubled spaces and a case change are the folds the quote
        # gate forgives; the SPAN still lands on the transcript's own bytes.
        content = SEGMENTS[2]["content"]
        clean = content[41:184]
        mangled = clean.replace("'", "’").replace(" ", "  ").upper()
        assert g.verified_span(mangled, content) == g.verified_span(clean, content)
        s, e = g.verified_span(mangled, content)
        assert content[s:e] == clean.strip()

    @pytest.mark.parametrize("evidence", [
        "We now expect Experiences margins to expand by 40% next fiscal year.",   # invented
        "Disney+ and ESPN both grew their user bases compared with last year.",  # paraphrase
        "executing well",                                                        # too short
        "",
        "…",
    ])
    def test_a_passage_that_is_not_in_the_turn_is_refused(self, evidence):
        for seg in SEGMENTS:
            assert g.verified_span(evidence, seg["content"]) is None

    def test_runs_out_of_order_are_refused(self):
        content = SEGMENTS[2]["content"]
        head, tail = content[41:100], content[186:260]
        assert g.verified_span(f"{head} … {tail}", content) is not None
        assert g.verified_span(f"{tail} … {head}", content) is None

    def test_an_ellipsis_stitched_across_most_of_an_answer_is_refused(self, monkeypatch):
        content = SEGMENTS[0]["content"]
        head, tail = content[:60], content[-60:]
        assert g.verified_span(f"{head} … {tail}", content) is not None
        monkeypatch.setattr(g, "_MAX_SPAN", 200)
        assert g.verified_span(f"{head} … {tail}", content) is None

    def test_the_offset_map_folds_exactly_as_normalize_does(self):
        # The span is only honest if the folded text it is found in IS
        # `normalize`'s output, character for character.
        samples = [s["content"] for s in SEGMENTS] + [
            "  Leading and trailing  \n\t whitespace  ",
            "Smart “quotes” — and NBSP ’s",
            "Straße CASE fold",
        ]
        for raw in samples:
            folded, idx = g._normalized_with_map(raw)
            assert folded == g.normalize(raw)
            assert len(idx) == len(folded)
            assert idx == sorted(idx)


class TestAnchorFor:
    def test_the_speaker_is_read_off_the_located_turn(self):
        a = g.anchor_for(SEGMENTS[1]["content"][120:220], SEGMENTS)
        assert a["segment"] == 1
        assert a["speaker"] == SEGMENTS[1]["speaker"]
        assert a["text"] == SEGMENTS[1]["content"][a["start"]:a["end"]]

    def test_a_passage_stitched_from_two_speakers_has_no_anchor(self):
        a = SEGMENTS[1]["content"][:60]
        b = SEGMENTS[2]["content"][:60]
        assert g.anchor_for(f"{a} … {b}", SEGMENTS) is None


# ── the recorded response, end to end ────────────────────────────────────────

class TestRecordedResponse:
    def test_every_bullets_text_survives_unchanged_and_in_order(self):
        out = _finish(_recorded())
        assert out["bullets"] == [b["text"] for b in MODEL_PAYLOAD["bullets"]]
        assert all(isinstance(b, str) for b in out["bullets"])

    def test_anchors_align_by_index_and_only_real_passages_get_one(self):
        out = _finish(_recorded())
        anchors = out["bullet_anchors"]
        assert len(anchors) == len(out["bullets"])
        # 0-2 are in the transcript; 3 is invented, 4 a paraphrase, 5 too short.
        assert [a is not None for a in anchors] == [True, True, True, False, False, False]

    def test_a_hallucinated_span_is_dropped_not_rendered(self):
        out = _finish(_recorded())
        i = next(i for i, b in enumerate(MODEL_PAYLOAD["bullets"])
                 if "40%" in b["evidence"])
        assert out["bullet_anchors"][i] is None
        # ...and no anchor anywhere quotes the invented words.
        assert not any("40%" in (a or {}).get("text", "") for a in out["bullet_anchors"])

    def test_each_anchor_is_the_transcripts_own_text_at_its_span(self):
        out = _finish(_recorded())
        for a in filter(None, out["bullet_anchors"]):
            content = SEGMENTS[a["segment"]]["content"]
            assert a["text"] == content[a["start"]:a["end"]]
            assert 0 <= a["start"] < a["end"] <= len(content)
            assert a["speaker"] == SEGMENTS[a["segment"]]["speaker"]

    def test_the_ui_fixture_is_exactly_what_the_server_produces(self):
        # The recap UI test renders `callRecapAnchored.json`. It is only a
        # recording if it still equals this pipeline's output; a hand edit or a
        # server change without regenerating it goes red here, by name.
        ui = json.loads((pathlib.Path(__file__).parent.parent / "app" / "src" / "components"
                         / "calendar" / "__fixtures__" / "callRecapAnchored.json")
                        .read_text(encoding="utf-8"))
        out = _finish(_recorded())
        out.pop("_usage", None)
        assert ui["recap"] == json.loads(json.dumps(out))

    def test_the_model_evidence_itself_is_not_stored(self):
        # What is stored is the transcript's text; the model's copy is spent.
        out = _finish(_recorded())
        assert "evidence" not in json.dumps(out["bullets"])


class TestLegacyShapeUnchanged:
    def test_a_pre_anchor_response_passes_through_with_no_anchor_key(self):
        # A Batch submitted before this landed returns bare-string bullets.
        # Its bullets must come out exactly as they always did, and the recap
        # must carry NO `bullet_anchors` — so it renders as a legacy recap.
        legacy = dict(MODEL_PAYLOAD)
        legacy["bullets"] = [b["text"] for b in MODEL_PAYLOAD["bullets"]]
        out = _finish(legacy)
        assert out["bullets"] == legacy["bullets"]
        assert "bullet_anchors" not in out

    def test_empty_or_missing_bullets_never_raise(self):
        for bullets in ([], None):
            payload = dict(MODEL_PAYLOAD, bullets=bullets)
            out = _finish(payload)
            assert out["bullets"] == bullets
            assert "bullet_anchors" not in out

    def test_ragged_bullets_are_skipped_without_misaligning(self):
        real = MODEL_PAYLOAD["bullets"][0]
        payload = dict(MODEL_PAYLOAD, bullets=[None, {"text": "", "evidence": "x"},
                                              7, real, "a bare string"])
        out = _finish(payload)
        assert out["bullets"] == [real["text"], "a bare string"]
        assert out["bullet_anchors"][0]["segment"] == 2
        assert out["bullet_anchors"][1] is None


# ── the prompt: what the recap SAYS is governed by the same rules ────────────

class TestPromptRulesUnchanged:
    def test_the_pre_anchor_prompt_is_intact_with_only_the_evidence_lines_added(self):
        """The bullets' TEXT is governed by exactly the rules it was before this
        landed: every line of the pinned pre-TERM-044 prompt is still present,
        in order, and the only lines added are the four that ask for evidence."""
        before = (_FIXTURES / "call_recap_prompt_pre_term044.txt").read_text(
            encoding="utf-8").splitlines()
        after = g._PROMPT.splitlines()
        added = [ln for ln in after if ln not in before]
        assert [ln for ln in after if ln in before] == before
        assert len(added) == 4
        assert all("evidence" in ln or "verbatim" in ln or "quote rules" in ln
                   or "takeaway" in ln for ln in added)
        bullet_rule = "- bullets: 5-8 concrete takeaways, each carrying a specific figure or fact."
        assert bullet_rule in before and bullet_rule in after

    def test_the_model_is_still_never_asked_for_a_location(self):
        blob = json.dumps(g.RECAP_SCHEMA)
        for key in ('"segment"', '"start"', '"end"', '"bullet_anchors"'):
            assert key not in blob

    def test_the_bullet_schema_asks_for_text_and_evidence_only(self):
        item = g.RECAP_SCHEMA["properties"]["bullets"]["items"]
        assert item["additionalProperties"] is False
        assert set(item["required"]) == {"text", "evidence"} == set(item["properties"])
