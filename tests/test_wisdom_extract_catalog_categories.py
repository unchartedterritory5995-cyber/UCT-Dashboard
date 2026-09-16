"""R15 — catalog category labels fold onto one spelling each, and folding loses no segments.

⛔ The category is FREE TEXT on each transcript record, so both defects this covers live in the
DATA: a typo'd "LIVE TRAIDNG" and two casings of "Sharpen your trading skills". The owner's
2026-09-14 ruling (R15) is to fix them in the READER and leave the artifact and the source
records alone — so these tests exercise `normalize_category`, never a rewritten artifact.

⭐ The fixture below is aggregate corpus metadata (category label, source count, segment count).
It carries no transcript text, no quotes, no levels and no member data, so it is safe in a public
repo under §0.4f — the same class of figure `PROGRAM-MANIFEST.md` already records in git.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools" / "wisdom"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import extract_catalog_batch as cat  # noqa: E402

# Measured from data/wisdom/extract/catalog-estimate-defaults.json (measured_at 20260913T184934Z,
# segmenter seg-v0). That artifact is GITIGNORED, so the numbers are pinned here and
# `test_the_fixture_still_matches_the_artifact` re-checks them whenever it is present.
BY_CATEGORY_RAW = [
    ("Evening Update", 10, 58),
    ("Interviews", 35, 1041),
    ("LIVE TRAIDNG", 1, 54),
    ("Live Trading Sessions", 56, 3499),
    ("Market Analysis & Breadth", 13, 324),
    ("Mindset & Psychology", 7, 150),
    ("Options & Flow", 22, 492),
    ("Post-Market Recaps", 10, 90),
    ("Risk & Trade Management", 18, 367),
    ("Scanning & Stock Selection", 16, 267),
    ("Setups & Strategies", 37, 799),
    ("Sharpen Your Trading Skills", 1, 32),
    ("Sharpen your trading skills", 1, 28),
    ("Sunday Scans", 69, 587),
    ("The Mental Game", 54, 1122),
    ("Thoughts on the Market", 9, 119),
    ("Workshops & Fireside Chats", 24, 704),
]

RAW_CATEGORIES = 17
NORMALISED_CATEGORIES = 15
TOTAL_SEGMENTS = 9733
TOTAL_SOURCES = 383

ARTIFACT = pathlib.Path(__file__).resolve().parents[1] / "data" / "wisdom" / "extract" / "catalog-estimate-defaults.json"


def _fold(rows):
    """Re-aggregate rows under the normalised label, exactly as `estimate()`'s by_kind would."""
    out: dict = {}
    for label, sources, segments in rows:
        slot = out.setdefault(cat.normalize_category(label), {"sources": 0, "segments": 0})
        slot["sources"] += sources
        slot["segments"] += segments
    return out


def test_the_fixture_is_the_corpus_we_think_it_is():
    """Non-vacuity control: the numbers this file reasons about must be the real ones."""
    assert len(BY_CATEGORY_RAW) == RAW_CATEGORIES
    assert sum(r[2] for r in BY_CATEGORY_RAW) == TOTAL_SEGMENTS
    assert sum(r[1] for r in BY_CATEGORY_RAW) == TOTAL_SOURCES


def test_normalised_category_count_is_15():
    folded = _fold(BY_CATEGORY_RAW)
    assert len(folded) == NORMALISED_CATEGORIES, sorted(folded)
    # and it folded by MERGING, not by dropping — the whole point
    assert RAW_CATEGORIES - len(folded) == 2


def test_folding_loses_no_segments_and_no_sources():
    folded = _fold(BY_CATEGORY_RAW)
    assert sum(v["segments"] for v in folded.values()) == TOTAL_SEGMENTS
    assert sum(v["sources"] for v in folded.values()) == TOTAL_SOURCES


def test_the_two_merges_are_the_ones_intended_and_carry_their_counts():
    folded = _fold(BY_CATEGORY_RAW)
    assert "LIVE TRAIDNG" not in folded
    assert "Sharpen your trading skills" not in folded
    # 56 + 1 sources, 3499 + 54 segments
    assert folded["Live Trading Sessions"] == {"sources": 57, "segments": 3553}
    # 1 + 1 sources, 32 + 28 segments
    assert folded["Sharpen Your Trading Skills"] == {"sources": 2, "segments": 60}


def test_every_other_category_is_untouched():
    """A fold that quietly renamed a third category would still pass the count test."""
    folded = _fold(BY_CATEGORY_RAW)
    merged_away = {"LIVE TRAIDNG", "Sharpen your trading skills"}
    for label, sources, segments in BY_CATEGORY_RAW:
        if label in merged_away or label == "Sharpen Your Trading Skills" or label == "Live Trading Sessions":
            continue
        assert folded[label] == {"sources": sources, "segments": segments}, label


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("LIVE TRAIDNG", "Live Trading Sessions"),
        ("live traidng", "Live Trading Sessions"),
        ("Live Trading Sessions", "Live Trading Sessions"),
        ("Sharpen your trading skills", "Sharpen Your Trading Skills"),
        ("Sharpen Your Trading Skills", "Sharpen Your Trading Skills"),
        ("SHARPEN YOUR TRADING SKILLS", "Sharpen Your Trading Skills"),
        ("  Live   Trading  Sessions ", "Live Trading Sessions"),  # whitespace collapses
        ("Interviews", "Interviews"),                              # pass-through
        ("Some Future Category", "Some Future Category"),          # unknown passes through
        ("", ""),
        (None, None),
    ],
)
def test_normalize_category_cases(raw, expected):
    assert cat.normalize_category(raw) == expected


def test_the_fold_does_not_change_any_stream_assignment():
    """⛔ The load-bearing safety property: R15 relabels, it must not re-route.

    `CATEGORY_STREAM` is consulted with the NORMALISED label now, so this proves the typo entry
    was safe to delete — every raw label still resolves to the stream it did before.
    """
    before = {"Live Trading Sessions": "zoom_live", "LIVE TRAIDNG": "zoom_live",
              "Workshops & Fireside Chats": "workshop", "Interviews": "interview"}
    for label, _, _ in BY_CATEGORY_RAW:
        was = before.get(label, "education")
        now = cat.CATEGORY_STREAM.get(cat.normalize_category(label), "education")
        assert now == was, f"{label}: stream changed {was} -> {now}"


def test_the_typo_has_exactly_ONE_authority_repo_wide():
    """⭐ R19 (2026-09-14) folded the second copy in, so this can now assert the strong thing.

    ⚰️ Session 4 left `tools/wisdom_golden_verify.py` carrying its own `CATEGORY_STREAM` with a
    duplicate `"LIVE TRAIDNG"` key, and the test here said so out loud rather than claiming a
    repo-wide uniqueness that was false at the time. Both tools now import
    `tools/wisdom/category_norm.py`, so the rule has one definition and the maps hold canonical
    spellings only.
    """
    import sys as _sys

    tools = str(pathlib.Path(__file__).resolve().parents[1] / "tools")
    if tools not in _sys.path:
        _sys.path.insert(0, tools)
    import wisdom_golden_verify as gv

    assert "live traidng" in cat.CATEGORY_ALIASES
    for name, stream_map in (("catalog reader", cat.CATEGORY_STREAM),
                             ("golden verifier", gv.CATEGORY_STREAM)):
        assert "LIVE TRAIDNG" not in stream_map, f"{name} still carries the typo as a key"
        # non-vacuity: the map must still be a real map with the canonical spelling in it
        assert stream_map.get("Live Trading Sessions") == "zoom_live", name

    # and the typo still ROUTES correctly through both, which is what makes deleting it safe
    for stream_map in (cat.CATEGORY_STREAM, gv.CATEGORY_STREAM):
        assert stream_map.get(cat.normalize_category("LIVE TRAIDNG")) == "zoom_live"

    # one definition, imported by both — not two copies kept in step by hope
    assert cat.normalize_category is gv.normalize_category


def test_both_tools_fold_the_seventeen_labels_onto_the_same_fifteen():
    """⛔ R19's real assertion: the two streams must agree on the category SET, not just on the typo."""
    import sys as _sys

    tools = str(pathlib.Path(__file__).resolve().parents[1] / "tools")
    if tools not in _sys.path:
        _sys.path.insert(0, tools)
    import wisdom_golden_verify as gv

    labels = [label for label, _, _ in BY_CATEGORY_RAW]
    via_reader = {cat.normalize_category(x) for x in labels}
    via_verifier = {gv.normalize_category(x) for x in labels}
    assert via_reader == via_verifier
    assert len(via_reader) == NORMALISED_CATEGORIES == 15
    assert len(labels) == RAW_CATEGORIES == 17, "control: the input really is 17 labels"


@pytest.mark.skipif(not ARTIFACT.exists(), reason=f"gitignored artifact absent: {ARTIFACT}")
def test_the_fixture_still_matches_the_artifact():
    """Drift guard: the pinned fixture must equal the real artifact wherever it is present."""
    data = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    actual = {k: (v["sources"], v["segments"]) for k, v in data["by_category"].items()}
    pinned = {label: (sources, segments) for label, sources, segments in BY_CATEGORY_RAW}
    assert actual == pinned
    assert data["requests"] == TOTAL_SEGMENTS
    assert data["sources"] == TOTAL_SOURCES
