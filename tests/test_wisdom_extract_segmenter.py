"""Segmenter rails (stream S-D). Synthetic text only: this repository is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a normalisation that drifts from tools/wisdom_golden_verify.py (golden quotes would
   stop being findable inside segments) — checked against the TOOL ITSELF, not a copy;
2. a segment whose text is not the exact slice of the source it claims to be;
3. a transcript cue that no window covers, a window that crosses a chapter, a fallback
   tiling without its overlap, a request over MAX_SEGMENT_CHARS;
4. a Sunday Scans preamble segmented as content, a list line read as a heading, an
   unsigned section not credited per D4;
5. a re-segmentation that duplicates rows.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

import pytest

from api.services.wisdom.core import store
from api.services.wisdom.extract import golden, segmenter

REPO = pathlib.Path(__file__).resolve().parents[1]
DATA = pathlib.Path(r"C:/Users/Patrick/uct-worktrees/wisdom-loop/data/wisdom")


def _tool():
    spec = importlib.util.spec_from_file_location("wisdom_golden_verify", REPO / "tools" / "wisdom_golden_verify.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    return tmp_path / "wisdom.db"


def _cues(n=60, step=10.0, mention_at=None, speaker="Host Name"):
    out = []
    for i in range(n):
        body = f"sentence number {i} about the tape."
        if mention_at is not None and i == mention_at:
            body = "watching $ZZZT here closely."
        out.append({"t": i * step, "text": f"{speaker}: {body}" if speaker else body})
    return out


# ── 1. parity with the golden verifier ───────────────────────────────────────

def test_cue_normalisation_is_byte_identical_to_the_golden_verifier(tmp_path):
    tool = _tool()
    cues = [
        {"t": 1, "text": "Host Name: good morning"},
        {"t": 2, "text": "no speaker on this one"},
        {"t": 3, "text": ""},
        {"t": "4", "text": "Here is the deal: short head stripped by both"},
        {"t": 5, "text": "A very long preface that is certainly longer than forty characters: kept"},
        {"t": 6, "text": "a: b: c"},
    ]
    path = tmp_path / "x.transcript_cues.json"
    path.write_text(json.dumps({"cues": cues}), encoding="utf-8")
    ours, offsets = segmenter.normalized_cue_text(segmenter.cues_from_raw(cues))
    assert ours == tool.normalised_text(path)
    # control: the comparison can fail — a join with a different separator differs
    assert "  ".join(c.text for c in segmenter.cues_from_raw(cues)) != tool.normalised_text(path)
    assert offsets[1] == len("good morning") + 1


def test_the_speaker_strip_matches_the_tool_on_every_shape():
    tool = _tool()
    for text in ["Name: x", "no colon", ": leading", "x" * 40 + ": y", "x" * 41 + ": y", "Two: parts: here"]:
        head, rest = segmenter.strip_speaker(text)
        assert rest == tool.strip_speaker(text)


# ── 2-3. transcripts ─────────────────────────────────────────────────────────

def test_every_window_is_an_exact_slice_and_every_cue_is_covered():
    raw = _cues(n=150, mention_at=70)
    segs = segmenter.segment_transcript(raw, [], universe=frozenset({"ZZZT"}))
    norm, offsets = segmenter.normalized_cue_text(segmenter.cues_from_raw(raw))
    assert segs
    covered = set()
    for s in segs:
        assert norm[s.char_start:s.char_end] == s.text
        for entry in s.cue_map:
            covered.add(entry[0] + s.char_start)
    assert covered == set(offsets)


def test_a_ticker_mention_gets_a_window_around_it():
    raw = _cues(n=150, mention_at=70)  # t = 700
    segs = segmenter.segment_transcript(raw, [], universe=frozenset({"ZZZT"}))
    around = [s for s in segs if "$ZZZT" in s.text]
    assert around and any(s.t_start_s >= 700 - segmenter.TICKER_PAD_S - 1e-6 for s in around)
    assert any("ZZZT" in s.mentions for s in around)


def test_fallback_windows_tile_with_the_stated_overlap():
    windows = segmenter.time_windows([], 0.0, 1200.0)
    assert windows[0] == (0.0, segmenter.FALLBACK_WINDOW_S)
    for (a0, b0), (a1, b1) in zip(windows, windows[1:]):
        assert pytest.approx(b0 - a1) == segmenter.FALLBACK_OVERLAP_S or b1 == 1200.0
        assert b1 - a1 <= segmenter.TILE_THRESHOLD_S
    assert windows[-1][1] == 1200.0
    # control: a span under the tiling threshold is one window
    assert segmenter.time_windows([], 0.0, 200.0) == [(0.0, 200.0)]


def test_windows_cross_a_chapter_only_by_the_stated_overlap_and_tiny_chapters_merge():
    raw = _cues(n=150)
    segs = segmenter.segment_transcript(raw, [{"t": 0, "title": "one"}, {"t": 600, "title": "two"}])
    crossing = []
    for s in segs:
        times = [e[1] for e in s.cue_map]
        if min(times) < 600 <= max(times):
            crossing.append(s)
            assert max(times) < 600 + segmenter.CHAPTER_OVERLAP_S and s.path == "one", (min(times), max(times))
    assert len(crossing) == 1
    assert {s.path for s in segs} == {"one", "two"}
    bounds = segmenter._chapter_bounds([600, 630], 0.0, 1500.0)
    assert bounds == [(0.0, 600.0), (600.0, 1500.0)]


def test_a_sentence_spoken_across_a_chapter_cut_lands_whole_in_one_segment(monkeypatch):
    raw = [{"t": i * 10.0, "text": f"filler line {i}."} for i in range(40)]
    raw[20] = {"t": 200.0, "text": "The rule is that you wait"}
    raw[21] = {"t": 208.0, "text": "for the first candle to close."}
    chapters = [{"t": 0, "title": "one"}, {"t": 205, "title": "two"}]
    sentence = "The rule is that you wait for the first candle to close."
    assert any(sentence in s.text for s in segmenter.segment_transcript(raw, chapters))
    # control: with no overlap the cut splits the sentence and no segment holds it whole
    monkeypatch.setattr(segmenter, "CHAPTER_OVERLAP_S", 0.0)
    assert not any(sentence in s.text for s in segmenter.segment_transcript(raw, chapters))


def test_a_sentence_spoken_across_a_ticker_window_edge_lands_whole_in_one_segment(monkeypatch):
    raw = [{"t": i * 10.0, "text": f"filler line {i}."} for i in range(150)]
    raw[70] = {"t": 700.0, "text": "watching $ZZZT here closely."}
    raw[75] = {"t": 750.0, "text": "The rule is that you wait"}
    raw[76] = {"t": 760.0, "text": "for the first candle to close."}
    sentence = "The rule is that you wait for the first candle to close."
    universe = frozenset({"ZZZT"})
    windows = segmenter.time_windows([700.0], 0.0, 1500.0)
    assert all(b0 > a1 for (_, b0), (a1, _) in zip(windows, windows[1:])), windows
    assert any(sentence in s.text for s in segmenter.segment_transcript(raw, [], universe=universe))
    # control: with no overlap the ticker window stops at 760 and the sentence is split
    monkeypatch.setattr(segmenter, "FALLBACK_OVERLAP_S", 0.0)
    assert not any(sentence in s.text for s in segmenter.segment_transcript(raw, [], universe=universe))


def test_a_window_over_the_char_cap_is_split_with_overlap(monkeypatch):
    monkeypatch.setattr(segmenter, "MAX_SEGMENT_CHARS", 400)
    raw = _cues(n=24, step=5.0)
    segs = segmenter.segment_transcript(raw, [])
    assert len(segs) > 1
    assert all(len(s.text) <= 400 for s in segs)
    firsts = [s.cue_map[0][1] for s in segs]
    lasts = [s.cue_map[-1][1] for s in segs]
    assert any(firsts[i + 1] <= lasts[i] for i in range(len(segs) - 1)), "no overlap between split windows"


def test_mentions_use_cashtags_and_the_universe_minus_common_words():
    uni = frozenset({"ZZZT", "AMD", "IT", "ON"})
    got = segmenter.detect_mentions("buy $abcd and AMD, IT is ON the list, not XYZQ", uni)
    assert got == ["ABCD", "AMD"]


def test_a_single_speaker_window_carries_its_label():
    segs = segmenter.segment_transcript(_cues(n=10, speaker="Host Name"), [])
    assert segs[0].speaker_label == "Host Name"
    mixed = _cues(n=10, speaker="Host Name")
    mixed[3]["text"] = "Other Person: hello"
    assert segmenter.segment_transcript(mixed, [])[0].speaker_label is None


# ── 4. Sunday Scans ──────────────────────────────────────────────────────────

ISSUE = "\n".join([
    "=== HEADER ===",
    "WHAT WE WILL COVER TODAY",
    "-Intro/Thoughts",
    "-Bracco\u2019s Breakdown and Top Ideas",
    "GIVEAWAY promotional text",
    "INTRO",
    "An intro paragraph about the week.",
    "Index & ETFs",
    "QQQ SPY",
    "QQQ (Daily, Weekly, and Hourly)",
    "A note under the QQQ chart.",
    "SPY (Daily)",
    "A note under the SPY chart.",
    "Bracco\u2019s Breakdown & Top Ideas",
    "Prose from the second author.",
    "ZZZT (Daily)",
    "A synthetic trade note.",
    "TSDR's Weekly Outlook & Watchlist",
    "Current Positions",
    "ZZZT 10.00 stop 9.00",
    "Honorable Mention",
    "AAA BBB CCC",
]) + "\n"


def test_sections_are_exact_slices_keep_the_opening_and_credit_authors():
    segs = segmenter.segment_sunday_scans(ISSUE)
    assert segs
    for s in segs:
        assert ISSUE[s.char_start:s.char_end] == s.text
    # the opening (welcome, contents, and in some issues the whole intro) is kept for recall,
    # as its own section, and the contents list inside it never became a heading
    assert "".join(s.text for s in segs) == ISSUE
    paths = [s.path for s in segs]
    assert paths[0] == segmenter.OPENING_PATH and segs[0].author_id == "tsdr"
    assert "-Bracco" in segs[0].text and paths[1] == "INTRO"
    by_top = {p.split(" > ")[0]: s for p, s in zip(paths, segs)}
    assert by_top["INTRO"].author_id == "tsdr" and by_top["INTRO"].speaker_confidence == "medium"
    bracco = [s for s in segs if s.path.startswith("Bracco's Breakdown")]
    assert bracco and all(s.author_id == "bracco" and s.speaker_confidence == "high" for s in bracco)
    assert any("Current Positions" in p for p in paths)


def test_a_list_line_is_not_a_heading_and_labels_need_a_timeframe():
    assert segmenter.top_heading("-Bracco\u2019s Breakdown and Top Ideas") is None
    assert segmenter.top_heading("Bracco\ufffds Breakdown & Top Ideas").startswith("Bracco's Breakdown")
    assert segmenter.is_chart_label("SNDK (Daily)")
    assert segmenter.is_chart_label("QQQ (Daily, Weekly, and Hourly)")
    assert not segmenter.is_chart_label("ZZZT (the ticker)")
    assert not segmenter.is_chart_label("Some sentence (Daily) with words")


def test_small_chart_sections_pack_and_a_big_one_stands_alone(monkeypatch):
    segs = segmenter.segment_sunday_scans(ISSUE)
    idx = [s for s in segs if s.path.startswith("Index & ETFs")]
    assert len(idx) == 1 and "QQQ (Daily, Weekly, and Hourly)" in idx[0].path and "SPY (Daily)" in idx[0].path
    monkeypatch.setattr(segmenter, "SECTION_PACK_CHARS", 10)
    unpacked = [s for s in segmenter.segment_sunday_scans(ISSUE) if s.path.startswith("Index & ETFs")]
    assert len(unpacked) == 3


def test_html_becomes_block_lines_and_images_take_the_nearest_earlier_label():
    html = ("<p>Opening &amp; welcome</p><div><hr></div><h2>INTRO</h2><p>body</p>"
            "<p><strong>ZZZT (Daily)</strong></p><figure><picture><img src=\"https://x/1.png\" width=\"1456\">"
            "</picture></figure><p>after</p>")
    assert segmenter.html_to_text(html) == "Opening & welcome\nINTRO\nbody\nZZZT (Daily)\nafter"
    images = segmenter.html_images(html)
    assert images == [{"src": "https://x/1.png", "label": "ZZZT (Daily)", "width": "1456", "height": None}]


def test_discord_is_one_message_per_segment():
    segs = segmenter.segment_discord_message("taking ZZZT over 10")
    assert len(segs) == 1 and segs[0].kind == "message" and segs[0].text == "taking ZZZT over 10"
    assert segmenter.segment_discord_message("   ") == []


# ── 5. persistence ───────────────────────────────────────────────────────────

def _source(conn, source_id="src1", stream="zoom_live"):
    conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, ingest_version, "
                 "ingested_at) VALUES (?, ?, ?, 1, 'x', 't', '2026-09-13T00:00:00-04:00')",
                 (source_id, stream, f"test:{source_id}"))


def test_write_segments_is_idempotent_and_keeps_the_cue_map(wisdom_db):
    segs = segmenter.segment_transcript(_cues(n=40), [])
    with store.write() as conn:
        _source(conn)
        first = segmenter.write_segments(conn, "src1", 1, segs)
        second = segmenter.write_segments(conn, "src1", 1, segs)
    assert first == len(segs) and second == 0
    with store.read() as conn:
        n = conn.execute("SELECT COUNT(*) FROM wisdom_segments").fetchone()[0]
        cue_map = segmenter.cue_map_for(conn, segs[0].segment_id("src1", 1))
    assert n == len(segs)
    assert cue_map and segmenter.time_at(cue_map, cue_map[2][0] + 1) == cue_map[2][1]


# ── the real samples (gitignored; skipped when absent) ───────────────────────

def test_every_golden_quote_lands_inside_a_segment():
    path, _version = golden.golden_file(DATA)
    samples = DATA / "samples"
    if path is None or not samples.exists():
        pytest.skip("golden set / samples are gitignored and not present on this checkout")
    records = golden.load_golden(path)
    files = {}
    for key in sorted({golden.sample_key(r) for r in records}):
        if not (samples / key.partition("#")[0]).exists():
            pytest.skip(f"sample {key} not present")
        files[key] = golden.segments_for_sample(samples, key)
    placed, unplaced = golden.place(records, files)
    assert unplaced == [], f"golden records no single segment contains: {unplaced}"
    assert sum(len(v["records"]) for v in placed.values()) == len(records)
