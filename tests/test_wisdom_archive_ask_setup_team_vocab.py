"""Ask AI's setup resolver on the team's own words (api/services/wisdom/archive/ask_setup.py).

SYNTHETIC data only: the repo is public. Setup ids and vocabulary words, no quotes, no names, no
record ids. The store below mirrors the shape of the real archive taxonomy only where it matters to
resolution: inside_day carries the bare alias "tight" and support_level is named "Support / ...",
the two collisions the team-vocabulary pass of 2026-10-18 measured.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a team phrase routing to the wrong setup or to nothing ("tight flag" -> inside_day, "flagging"
   -> nothing, a PEG question -> flag_htf);
2. a broad word (support, base, pullback, breakout, tight, reclaim, launch, trendline) resolving
   differently from before the pass. MAX_SETUPS is 1, so a broad word that starts resolving would
   hijack free member text;
3. the -ing form of a doubling word not matching, or a plain "+ing" (blocking, tailing, hammering)
   becoming a hit.
"""
from __future__ import annotations

import pytest

from api.services.wisdom.archive import ask_setup, service
from api.services.wisdom.core import store, vocab


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    ask_setup.clear_cache()


def _stats(n=40):
    return {"n": n, "n_scored": n, "win20": 0.5, "med_r20": 0.0, "mean_r20": 0.0, "med_edge20": 0.0,
            "mean_simR": 0.0, "mean_edgeR": 0.0, "edgeR_z": 0.0, "thin": False}


def _setup(sid, name, aliases=()):
    return {"setup_id": sid, "name": name, "family": None, "aliases": list(aliases), "used_by": [],
            "stats": _stats(), "stats_trades": _stats(), "context": {}, "teachings": [], "winners": [],
            "failures": []}


#: The archive setups the pass routes to, plus the two whose names or aliases collide with a broad
#: word. Names and aliases are synthetic vocabulary, shaped like the real taxonomy's.
SETUPS = [
    _setup("flag_htf", "Flag / high tight flag / continuation", ["bull flag", "continuation"]),
    _setup("inside_day", "Inside day / double inside", ["inside day", "double inside day", "tight"]),
    _setup("pullback_ma", "Moving-average pullback", ["MA pullback"]),
    _setup("vcp", "Volatility contraction pattern (VCP)", ["VCP", "coiled"]),
    _setup("flat_top_breakout", "Flat-top / flat base", ["flat top", "flat base"]),
    _setup("undercut_reclaim", "Undercut & reclaim / shakeout", ["shakeout"]),
    _setup("launch_pad", "Launch pad", ["launch pad"]),
    _setup("intraday_pivot", "30-minute pivot", ["30 min pivot", "red to green"]),
    _setup("capitulation_long", "Capitulation snapback long", ["capitulation"]),
    _setup("parabolic_short", "Parabolic short", ["parabolic short"]),
    _setup("classical_pattern", "Classical chart pattern", ["double bottom"]),
    _setup("peg_flag", "Post-earnings gap flag", ["PEG", "PEG flag"]),
    _setup("support_level", "Support / level hold", ["level hold"]),
    _setup("trendline_break", "Trendline break", ["trendline break"]),
]


def _seed():
    with store.write() as conn:
        out = service.upsert_batch(conn, "setups", SETUPS)
        assert out["rejected"] == 0, out


def _resolve(text):
    with store.read() as conn:
        return ask_setup.resolve_setups(conn, text)


#: (member question in the team's words, the setup it means). Recommendations 1 and 2.
TEAM_PHRASES = [
    ("show me a tight flag", "flag_htf"),
    ("falling flag examples", "flag_htf"),
    ("is this a weekly flag", "flag_htf"),
    ("is a pennant the same thing", "flag_htf"),
    ("how does the team trade names that are flagging?", "flag_htf"),
    ("what does flag out mean", "flag_htf"),
    ("it keeps flagging out", "flag_htf"),
    ("pullback to the 20 ema", "pullback_ma"),
    ("holding the 20ema", "pullback_ma"),
    ("what is an 8 ema tap", "pullback_ma"),
    ("bounce off the 9 ema", "pullback_ma"),
    ("ma tap entries", "pullback_ma"),
    ("a stock coiling under highs", "vcp"),
    ("volume dry up before the move", "vcp"),
    ("base breakout examples", "flat_top_breakout"),
    ("stock pressing a flat line", "flat_top_breakout"),
    ("pressing highs", "flat_top_breakout"),
    ("green line breakout", "flat_top_breakout"),
    ("failed breakdown", "undercut_reclaim"),
    ("bear trap reversal", "undercut_reclaim"),
    ("pinched between the MAs", "launch_pad"),
    ("inside week setup", "inside_day"),
    ("opening range entries", "intraday_pivot"),
    ("oversold bounce", "capitulation_long"),
    ("mean reversion trades", "capitulation_long"),
    ("parabolic stock", "parabolic_short"),
    ("triangle breakout", "classical_pattern"),
    ("post earnings drift flag", "peg_flag"),
]


@pytest.mark.parametrize("text, want", TEAM_PHRASES)
def test_team_phrases_route_to_their_setup(wisdom_db, text, want):
    _seed()
    assert _resolve(text) == [want], text


#: How the broad words resolve against this store. Pinned from origin/master before the pass
#: (ea04da888c, measured by running this test against that version of ask_setup.py): "support"
#: hits support_level's name and "tight" inside_day's taxonomy alias; the rest resolve to nothing.
#: The pass must not move any of them.
BROAD_WORDS = [
    ("support", ["support_level"]),
    ("base", []),
    ("pullback", []),
    ("breakout", []),
    ("tight", ["inside_day"]),
    ("reclaim", []),
    ("launch", []),
    ("trendline", []),
    ("is this a breakout or a pullback", []),
    ("tight base", ["inside_day"]),
    ("reclaim of the 50", []),
    ("launching off support", ["support_level"]),
]


@pytest.mark.parametrize("text, want", BROAD_WORDS)
def test_broad_words_resolve_as_they_did_before(wisdom_db, text, want):
    _seed()
    assert _resolve(text) == want, text


def test_no_team_phrase_source_holds_a_broad_word():
    """The broad words stay out of TEAM_SLANG and the flag vocabulary entry, as phrases: a broad
    word added there would resolve on its own and could not be caught by the store above."""
    broad = {"support", "base", "pullback", "breakout", "tight", "reclaim", "launch", "trendline"}
    slang = {p.lower() for phrases in ask_setup.TEAM_SLANG.values() for p in phrases}
    assert not slang & broad, slang & broad
    flag = next(e for e in vocab.load_vocabulary()["entries"] if e["vocab_id"] == "flag")
    assert not {a.lower() for a in flag["aliases"]} & broad


def test_every_slang_target_is_a_setup_ask_ai_can_answer():
    """A slang key that is a bucket, or a typo, would never resolve and nothing would say so."""
    rows = {r["external_name"] for r in vocab.load_vocabulary()["maps"]["trader_archive"]["rows"]}
    for sid in ask_setup.TEAM_SLANG:
        assert sid in rows, sid
        assert sid not in ask_setup.NON_SETUP_BUCKETS, sid


def test_the_flag_vocabulary_entry_carries_the_team_flag_words():
    flag = next(e for e in vocab.load_vocabulary()["entries"] if e["vocab_id"] == "flag")
    for alias in ("tight flag", "falling flag", "weekly flag", "pennant", "flagging", "flag out",
                  "flagging out"):
        assert alias in flag["aliases"], alias


@pytest.mark.parametrize("phrase, text, hit", [
    ("flag", "names that are flagging", True),          # the doubled consonant + ing
    ("flag", "the flags we watched", True),             # the plural still matches
    ("wedge pop", "wedge popping out", True),
    ("undercut", "undercutting the low", True),
    ("flat top", "flat topping action", True),
    ("flag", "flaging", False),                         # not a word, and not the doubled form
    ("flag", "flagpole", False),                        # still word-bounded
    ("block", "what is blocking this", False),          # a plain "+ing" stays a miss
    ("tail", "tailing off", False),
    ("hammer", "hammering lower", False),
    ("spring", "springing back", False),
    ("HTF", "HTFing", False),                           # short caps stay exact
])
def test_the_ing_form_matches_only_a_doubling_word(phrase, text, hit):
    assert bool(ask_setup._phrase_pattern(phrase).search(text)) is hit, (phrase, text)
