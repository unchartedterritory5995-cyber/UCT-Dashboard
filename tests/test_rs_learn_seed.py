"""RS Learn-link seed rail (UCT Relative Strength, unit 2a-16).

``tests/fixtures/indicators/rs_learn_videos.json`` names the Desk videos the RS
About readout links to. This rail pins two things, with no database involved:

1. every ``youtubeId`` in the fixture is a row of
   ``api.services.education_seed.SEED_VIDEOS`` with a non-empty title — the
   seed is regenerated from a sheet (``tools/gen_education_seed.py``), and a
   regenerated sheet that drops a workshop would otherwise turn a Learn link
   into a Desk page that plays nothing;
2. the JS map ``RS_LEARN_VIDEOS`` in ``app/src/lib/deskVideoHref.js`` agrees
   with the fixture, read by regex so neither lane's copy is a third authority.

The JS lane reads the SAME fixture in ``app/src/lib/deskVideoHref.test.js``.

What this rail CANNOT check: production ``edu_videos.chapters`` (the JSON
column served by ``/api/education/videos/{id}/insights``) — that lives in the
Railway volume's education.db, not in the seed. The seed rows carry no
chapter field at all (see ``test_seed_rows_carry_no_chapter_timestamps``).
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

from api.services import education_seed

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "indicators" / "rs_learn_videos.json"
JS_MAP = ROOT / "app" / "src" / "lib" / "deskVideoHref.js"

EXPECTED_KEYS = {"rsLine", "phase", "newHigh", "beforePrice", "redDay", "fourChecks"}
YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


@pytest.fixture(scope="module")
def fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def seed_by_id() -> dict[str, dict]:
    rows = education_seed.SEED_VIDEOS
    assert isinstance(rows, list) and rows, "SEED_VIDEOS must be a non-empty list"
    return {r["youtube_id"]: r for r in rows}


# ── fixture shape ───────────────────────────────────────────────────────────────

def test_fixture_names_the_plan_section(fixture):
    assert "2a-16" in fixture["note"]
    assert "§2.8" in fixture["note"]


def test_fixture_has_exactly_the_six_lesson_keys(fixture):
    assert set(fixture["videos"]) == EXPECTED_KEYS


def test_fixture_entries_are_well_formed(fixture):
    for key, entry in fixture["videos"].items():
        assert YT_ID.match(entry["youtubeId"]), f"{key}: bad youtube id {entry['youtubeId']!r}"
        assert isinstance(entry["label"], str) and entry["label"].strip(), f"{key}: empty label"
        t = entry["t"]
        assert t is None or (isinstance(t, int) and t >= 1), f"{key}: t must be null or an int >= 1, got {t!r}"


# ── the seed rail ───────────────────────────────────────────────────────────────

def test_every_fixture_id_is_a_seed_row_with_a_title(fixture, seed_by_id):
    missing = []
    for key, entry in fixture["videos"].items():
        row = seed_by_id.get(entry["youtubeId"])
        if row is None:
            missing.append(f"{key} -> {entry['youtubeId']} (not in SEED_VIDEOS)")
            continue
        title = row.get("title")
        if not (isinstance(title, str) and title.strip()):
            missing.append(f"{key} -> {entry['youtubeId']} (empty title)")
    assert not missing, "Learn-link targets missing from the Desk seed:\n  " + "\n  ".join(missing)


def test_seed_rail_cannot_pass_vacuously(seed_by_id):
    # A present-sibling control: the rail above answers "yes" to real ids only.
    assert "sM-aFdyOps4" in seed_by_id
    assert "AAAAAAAAAAA" not in seed_by_id


def test_seed_rows_carry_no_chapter_timestamps(fixture, seed_by_id):
    """The seed is title/description/category/duration/sort_order only. Chapter
    seconds for the Learn links therefore come from the fixture, and production
    ``chapters`` (if any were generated) is a separate, unverifiable-here store."""
    for key, entry in fixture["videos"].items():
        row = seed_by_id[entry["youtubeId"]]
        assert "chapters" not in row, f"{key}: seed row grew a chapters field — revisit the fixture's t values"
        assert set(row) == {"youtube_id", "title", "description", "category", "duration", "sort_order"}, (
            f"{key}: seed row shape changed: {sorted(row)}"
        )


# ── JS map ⇄ fixture ────────────────────────────────────────────────────────────

_ENTRY_RE = re.compile(
    r"(?P<key>[A-Za-z]+):\s*Object\.freeze\(\{\s*"
    r"youtubeId:\s*'(?P<id>[^']+)',\s*"
    r"t:\s*(?P<t>undefined|\d+)[^\n]*\n\s*"
    r"label:\s*'(?P<label>[^']*)',",
    re.S,
)


def _parse_js_map() -> dict[str, dict]:
    src = JS_MAP.read_text(encoding="utf-8")
    start = src.index("export const RS_LEARN_VIDEOS")
    end = src.index("export function learnHref", start)
    block = src[start:end]
    out = {}
    for m in _ENTRY_RE.finditer(block):
        out[m.group("key")] = {
            "youtubeId": m.group("id"),
            "t": None if m.group("t") == "undefined" else int(m.group("t")),
            "label": m.group("label"),
        }
    assert out, "could not parse any RS_LEARN_VIDEOS entry out of deskVideoHref.js"
    return out


def test_js_map_matches_the_fixture(fixture):
    js = _parse_js_map()
    assert set(js) == set(fixture["videos"]), f"key drift: js={sorted(js)} fixture={sorted(fixture['videos'])}"
    for key, fx in fixture["videos"].items():
        assert js[key] == {"youtubeId": fx["youtubeId"], "t": fx["t"], "label": fx["label"]}, (
            f"{key}: js={js[key]} fixture={fx}"
        )


def test_js_builder_omits_t_zero_and_requires_t_at_least_one():
    """Pins the documented consumer rule in the builder's source, so a later
    edit that starts emitting `&t=0` (the deskMentionHref behaviour) is caught
    without a JS runtime."""
    src = JS_MAP.read_text(encoding="utf-8")
    assert "if (t >= 1) seek = `&t=${t}`" in src
    assert re.search(r"^const YOUTUBE_ID_RE = /\^\[A-Za-z0-9_-\]\{11\}\$/", src, re.M)
