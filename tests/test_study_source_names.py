"""What a member reads under "Sources" on a course reveal: never our repo paths, "criteria card", "dossier" or "the
owner", and one line per source (the 2026-11-17 localhost review showed the same internal path three times, as a dead
link). REVIEW_LEARNINGS rule 27."""
import glob
import json

from scripts.study import courses_lib as cl

WORKING_WORDS = ("docs/", ".json", ".md", "criteria card", "dossier", "the owner")


def test_our_files_read_as_what_they_are():
    card = {"publisher": "UCT setup criteria card", "url": "repo:docs/study/setups/criteria/01-flat-base.json",
            "title": "Flat Base Breakout criteria card (docs/study/setups/criteria/01-flat-base.json, as of 2026-11-09)"}
    dossier = {"publisher": "UCT setup research", "url": "repo:docs/study/setups/research/01-flat-base.md#12",
               "title": "Flat Base dossier, sections 12 and 13: examples"}
    rules = {"publisher": "UCT house rule", "url": "repo:docs/study/sizing_rule.md#9",
             "title": "The account rulebook, section 9 (the owner, 2026-11-09)"}
    assert cl.member_source_name(card) == "Our Flat Base Breakout playbook"
    assert cl.member_source_name(dossier) == "Our Flat Base research, on real charts"
    assert cl.member_source_name(rules) == "Our trading rules"
    assert cl._source_cite(card, {"quote": "x"})["url"] is None          # no dead repo link


def test_substack_titles_lose_the_owner_asides():
    s = {"publisher": "UCT Substack (the owner's published writing)", "url": "https://unchartedterritoryy.substack.com/p/x",
         "title": "The Parabolic Short (2025-06-13): the post the owner named for B26"}
    assert cl.member_source_name(s) == "UCT Substack: The Parabolic Short (2025-06-13)"


def test_same_source_merges_and_keeps_every_quote():
    a = {"name": "Our trading rules", "url": None, "quote": "stop up to 5%"}
    b = {"name": "Our trading rules", "url": None, "quote": "1-3% preferred"}
    out = cl._merge_cites([a, b])
    assert len(out) == 1 and "5%" in out[0]["quote"] and "1-3%" in out[0]["quote"]


def test_no_working_words_reach_a_member_anywhere_in_the_library():
    bad = []
    for f in glob.glob(str(cl.REPO / "docs" / "study" / "courses" / "*" / "*.json")):
        for s in json.load(open(f, encoding="utf-8")).get("sources") or []:
            name = cl.member_source_name(s)
            if any(w in name.lower() for w in WORKING_WORDS):
                bad.append(name)
    assert bad == []
