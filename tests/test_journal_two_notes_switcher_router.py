"""The command palette's quick switcher — GET /api/j2/notes/switcher.

Title search over the member's WHOLE library (the palette used to reach only
favourites and recents). Same standalone-FastAPI-app + temp-auth.db pattern as
tests/test_journal_two_notes_favorites_recents_router.py.

What each test pins, because a switcher that "returns something" can still be
wrong in every way that matters:
  * auth + ownership — another member's titles never appear;
  * trash — a note that cannot be opened is never offered;
  * the ranking tiers, one test per boundary, so reordering any two tiers reds
    a named test rather than a vague "order changed";
  * the recents boost is INSIDE a tier, never across one;
  * `%` / `_` in the query are text, not wildcards;
  * folder / ticker context and the limit/hasMore contract;
  * (fix round 1) case folds beyond ASCII (N2); the two bounded fuzzy tiers —
    letters in order, one slip — and their scope (S5); `strong` / `exact`
    come from the server, never a client copy of the tier numbers (S3); the
    keystroke's reads are served by the covering index and start from the
    member's own recents/favourites (N1); `prefixExhausted` is only ever
    claimed when no longer query could match.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def app(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _note(client, title, **extra):
    r = client.post("/api/j2/notes", json={"title": title, **extra})
    assert r.status_code == 200, r.text
    return r.json()["note"]["id"]


def _search(client, q, **params):
    r = client.get("/api/j2/notes/switcher", params={"q": q, **params})
    assert r.status_code == 200, r.text
    return r.json()


def _titles(body):
    return [n["title"] for n in body["notes"]]


# ── auth + ownership ─────────────────────────────────────────────────────────

def test_requires_a_signed_in_member(client):
    # No dependency override: the real cookie check runs and refuses.
    r = client.get("/api/j2/notes/switcher", params={"q": "x"})
    assert r.status_code == 401


def test_never_offers_another_members_notes(app, client):
    _login_as(app, "owner")
    _note(client, "Semis thesis")
    _login_as(app, "intruder")
    _note(client, "Semis — my own")
    body = _search(client, "semis")
    assert _titles(body) == ["Semis — my own"]


def test_a_trashed_note_is_never_offered(app, client):
    _login_as(app, "u1")
    keep = _note(client, "Energy plan")
    gone = _note(client, "Energy old")
    assert client.delete(f"/api/j2/notes/{gone}").status_code == 200
    body = _search(client, "energy")
    assert [n["id"] for n in body["notes"]] == [keep]


def test_blank_query_is_an_empty_answer_not_an_error(app, client):
    _login_as(app, "u1")
    _note(client, "Anything")
    assert _search(client, "") == {"notes": [], "hasMore": False, "prefixExhausted": False}
    assert _search(client, "   ") == {"notes": [], "hasMore": False, "prefixExhausted": False}


# ── ranking tiers ────────────────────────────────────────────────────────────

def test_exact_title_beats_prefix(app, client):
    _login_as(app, "u1")
    _note(client, "Semis outlook")
    _note(client, "Semis")
    body = _search(client, "semis")
    assert _titles(body) == ["Semis", "Semis outlook"]
    assert [n["matchTier"] for n in body["notes"]] == [0, 1]


def test_prefix_beats_word_start(app, client):
    _login_as(app, "u1")
    _note(client, "The semis rotation")
    _note(client, "Semis rotation")
    assert _titles(_search(client, "semis")) == ["Semis rotation", "The semis rotation"]


def test_word_start_beats_substring(app, client):
    _login_as(app, "u1")
    _note(client, "Antisemis note")      # substring only
    _note(client, "Big semis week")      # a word starts with it
    body = _search(client, "semis")
    assert _titles(body) == ["Big semis week", "Antisemis note"]
    assert [n["matchTier"] for n in body["notes"]] == [2, 4]


def test_a_word_break_character_starts_a_word(app, client):
    _login_as(app, "u1")
    _note(client, "NVDA-Q3 earnings")
    _note(client, "Aq3 misc")            # substring only
    body = _search(client, "q3")
    assert _titles(body) == ["NVDA-Q3 earnings", "Aq3 misc"]


def test_every_typed_word_must_appear(app, client):
    _login_as(app, "u1")
    _note(client, "Q3 NVDA thesis")
    _note(client, "Q3 AMD thesis")
    body = _search(client, "nvda thesis")
    assert _titles(body) == ["Q3 NVDA thesis"]


def test_all_words_starting_beats_words_only_contained(app, client):
    _login_as(app, "u1")
    _note(client, "Xnvda Xthesis")       # both words present, neither starts a word
    _note(client, "Thesis for NVDA")     # both words start title words
    body = _search(client, "nvda thesis")
    assert _titles(body) == ["Thesis for NVDA", "Xnvda Xthesis"]
    assert [n["matchTier"] for n in body["notes"]] == [3, 5]


def test_percent_and_underscore_are_text_not_wildcards(app, client):
    _login_as(app, "u1")
    _note(client, "q3_plan")
    _note(client, "q3Xplan")
    body = _search(client, "q3_plan")
    # Every exact tier (0-5) finds only the real title. "q3Xplan" may still be
    # offered BELOW it — as letters in order (tier 6), never as if `_` matched X.
    assert [n["title"] for n in body["notes"] if n["matchTier"] <= 5] == ["q3_plan"]
    assert _titles(body)[0] == "q3_plan"
    assert all(n["matchTier"] >= 6 for n in body["notes"] if n["title"] == "q3Xplan")
    _note(client, "50% position")
    _note(client, "50X position")
    assert _titles(_search(client, "50%")) == ["50% position"]


def test_matching_is_case_insensitive(app, client):
    _login_as(app, "u1")
    _note(client, "NVDA Thesis")
    assert _titles(_search(client, "nvda THESIS")) == ["NVDA Thesis"]


# ── recents / favourites boost inside a tier ────────────────────────────────

def test_a_recently_opened_note_leads_its_tier(app, client):
    _login_as(app, "u1")
    older = _note(client, "Macro weekly A")
    _note(client, "Macro weekly B")      # edited more recently
    assert client.post(f"/api/j2/notes/{older}/opened").status_code == 200
    body = _search(client, "macro")
    assert _titles(body) == ["Macro weekly A", "Macro weekly B"]
    assert body["notes"][0]["isRecent"] is True
    assert body["notes"][1]["isRecent"] is False


def test_the_recents_boost_never_crosses_a_tier(app, client):
    _login_as(app, "u1")
    opened = _note(client, "Old macro notes")   # word-start tier
    _note(client, "Macro")                      # exact
    assert client.post(f"/api/j2/notes/{opened}/opened").status_code == 200
    assert _titles(_search(client, "macro")) == ["Macro", "Old macro notes"]


def test_a_favourite_leads_equal_non_favourites(app, client):
    _login_as(app, "u1")
    fav = _note(client, "Rates A")
    _note(client, "Rates B")
    assert client.post(f"/api/j2/notes/{fav}/favorite").status_code == 200
    body = _search(client, "rates")
    assert _titles(body) == ["Rates A", "Rates B"]
    assert body["notes"][0]["isFavorite"] is True


# ── context + limits ────────────────────────────────────────────────────────

def test_rows_carry_folder_path_and_ticker(app, client):
    _login_as(app, "u1")
    parent = client.post("/api/j2/note-folders", json={"name": "Research"}).json()["folder"]["id"]
    child = client.post("/api/j2/note-folders",
                        json={"name": "Semis", "parentId": parent}).json()["folder"]["id"]
    _note(client, "NVDA supply chain", folderId=child, ticker="NVDA")
    _note(client, "NVDA unfiled")
    body = _search(client, "nvda")
    rows = {n["title"]: n for n in body["notes"]}
    assert rows["NVDA supply chain"]["folderPath"] == "Research / Semis"
    assert rows["NVDA supply chain"]["ticker"] == "NVDA"
    assert rows["NVDA unfiled"]["folderPath"] is None
    assert rows["NVDA unfiled"]["folderId"] is None


def test_limit_and_has_more(app, client):
    _login_as(app, "u1")
    for i in range(5):
        _note(client, f"Journal {i}")
    body = _search(client, "journal", limit=3)
    assert len(body["notes"]) == 3
    assert body["hasMore"] is True
    body = _search(client, "journal", limit=5)
    assert len(body["notes"]) == 5
    assert body["hasMore"] is False


def test_limit_is_clamped(app, client):
    _login_as(app, "u1")
    for i in range(3):
        _note(client, f"Clamp {i}")
    assert len(_search(client, "clamp", limit=0)["notes"]) == 3   # 0 falls back to the default
    assert len(_search(client, "clamp", limit=10_000)["notes"]) == 3


# ── fix round 1 ─────────────────────────────────────────────────────────────

def test_case_folds_beyond_ascii(app, client):
    # SQLite's lower() folds ASCII only; the member reads "É" and "é" as one letter.
    _login_as(app, "u1")
    _note(client, "Élan vital")
    _note(client, "ÉCOLE notes")
    for q in ["élan", "Élan", "ÉLAN"]:
        assert _titles(_search(client, q)) == ["Élan vital"], q
    body = _search(client, "élan vital")
    assert body["notes"][0]["matchTier"] == 0 and body["notes"][0]["exact"] is True
    assert _titles(_search(client, "école")) == ["ÉCOLE notes"]


def test_letters_in_order_find_a_title(app, client):
    _login_as(app, "u1")
    _note(client, "NVDA thesis")
    _note(client, "Earnings recap")
    body = _search(client, "nvth")
    assert _titles(body) == ["NVDA thesis"]
    assert body["notes"][0]["matchTier"] == 6
    assert _titles(_search(client, "earnigs")) == ["Earnings recap"]


def test_the_first_letter_must_start_a_word(app, client):
    # "vth" is in "NVDA thesis" in order, but no word starts with "v".
    _login_as(app, "u1")
    _note(client, "NVDA thesis")
    assert _titles(_search(client, "vth")) == []


def test_one_slip_in_a_long_word_is_forgiven(app, client):
    _login_as(app, "u1")
    _note(client, "Semis rotation")
    _note(client, "Earnings recap")
    for q, title in [("smeis", "Semis rotation"),       # swapped letters
                     ("earbings", "Earnings recap"),    # one wrong letter
                     ("rtoation", "Semis rotation"),    # swap inside a word
                     ("earbin", "Earnings recap")]:     # half-typed, with a slip
        body = _search(client, q)
        assert _titles(body) == [title], q
        assert body["notes"][0]["matchTier"] == 7, q


def test_no_slip_is_forgiven_in_a_short_word_or_a_number(app, client):
    _login_as(app, "u1")
    _note(client, "Q3 gap")
    _note(client, "Note 4999")
    assert _titles(_search(client, "gab")) == []        # 3 letters: exact only
    assert _titles(_search(client, "4990")) == []       # a number is not a slip


def test_every_exact_tier_outranks_the_fuzzy_ones(app, client):
    _login_as(app, "u1")
    fuzzy = _note(client, "Semi-annual stats")         # s..e..m..i..s in order only
    _note(client, "Antisemis note")                      # substring
    assert client.post(f"/api/j2/notes/{fuzzy}/opened").status_code == 200
    body = _search(client, "semis")
    assert _titles(body) == ["Antisemis note", "Semi-annual stats"]
    assert [n["matchTier"] for n in body["notes"]] == [4, 6]


def test_the_fuzzy_tiers_read_a_bounded_scope_that_always_holds_recents(app, client, monkeypatch):
    from api.services.journal_two import notes as notes_service
    monkeypatch.setattr(notes_service, "SWITCHER_FUZZY_SCOPE", 1)
    _login_as(app, "u1")
    oldest = _note(client, "NVDA thesis old")
    _note(client, "NVDA thesis mid")
    _note(client, "NVDA thesis new")                     # the one note in scope
    body = _search(client, "nvth")
    assert _titles(body) == ["NVDA thesis new"]
    assert client.post(f"/api/j2/notes/{oldest}/opened").status_code == 200
    assert _titles(_search(client, "nvth")) == ["NVDA thesis old", "NVDA thesis new"]
    # The exact tiers are NEVER bounded: every title is still ranked.
    assert len(_search(client, "nvda thesis")["notes"]) == 3


def test_rows_say_strong_and_exact_so_the_palette_never_restates_tiers(app, client):
    _login_as(app, "u1")
    _note(client, "Semis")                 # 0 exact
    _note(client, "Semis outlook")         # 1 prefix
    _note(client, "Big semis week")        # 2 word start
    _note(client, "Antisemis note")        # 4 substring
    _note(client, "Semi-annual stats")    # 6 letters in order
    body = _search(client, "semis")
    flags = {n["title"]: (n["matchTier"], n["strong"], n["exact"]) for n in body["notes"]}
    assert flags == {
        "Semis": (0, True, True),
        "Semis outlook": (1, True, False),
        "Big semis week": (2, True, False),
        "Antisemis note": (4, False, False),
        "Semi-annual stats": (6, False, False),
    }


def test_prefix_exhausted_is_claimed_only_when_no_longer_query_can_match(app, client):
    _login_as(app, "u1")
    _note(client, "Semis rotation")
    assert _search(client, "zzzz")["prefixExhausted"] is True
    assert _search(client, "zzz")["prefixExhausted"] is False      # a 4th letter earns a slip
    assert _search(client, "zz")["prefixExhausted"] is False
    assert _search(client, "semis")["prefixExhausted"] is False    # it matched


def test_prefix_exhausted_waits_for_the_in_order_tier_as_well(app, client, monkeypatch):
    # Today a word earning typo tolerance (4 letters) already clears the in-order
    # minimum (3), so the second condition looks redundant — it is what keeps
    # the claim sound if either constant moves.
    from api.services.journal_two import notes as notes_service
    monkeypatch.setattr(notes_service, "SWITCHER_FUZZY_MIN_CHARS", 5)
    _login_as(app, "u1")
    _note(client, "Semis rotation")
    assert _search(client, "zzzz")["prefixExhausted"] is False
    assert _search(client, "zzzzz")["prefixExhausted"] is True


def test_prefix_exhausted_is_sound_across_extensions(app, client):
    """Property rail, fixed seed: whenever a query claims `prefixExhausted`,
    EVERY query that extends it answers nothing — the palette relies on that
    to stop asking while the member types."""
    import random
    _login_as(app, "u1")
    for title in ["Semis rotation", "NVDA thesis", "Earnings recap", "Q3 gap plan",
                  "Rates — FOMC week", "élan vital", "Rotation into semis"]:
        _note(client, title)
    rng = random.Random(20260923)
    alphabet = "semiortanvdhqgp -3é"
    claimed = 0
    for _ in range(120):
        q = "".join(rng.choice(alphabet) for _ in range(rng.randint(3, 7))).strip()
        if not q or not _search(client, q)["prefixExhausted"]:
            continue
        claimed += 1
        for _ in range(4):
            longer = q + "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 4)))
            assert _search(client, longer)["notes"] == [], (q, longer)
    assert claimed >= 5, "the property rail exercised too few exhausted queries"


def _plan(sql):
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        return [tuple(r)[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, ("u1",))]
    finally:
        conn.close()


def test_the_keystroke_scan_is_served_by_the_covering_index(app, client):
    # N1: at 50k notes the same read off the table cost ~150 ms, off this index ~30 ms.
    from api.services.journal_two import notes as notes_service
    # Wave 6: the scan also skips archived notes, so the covering index is the
    # one that carries archived_at -- still covering, still no table read.
    plan = _plan(notes_service._SWITCHER_SCAN_SQL)
    assert plan == ["SEARCH j2_notes USING COVERING INDEX idx_j2_notes_switcher_live"
                    " (user_id=? AND deleted_at=? AND archived_at=?)"], plan


def test_recents_and_favourites_reads_start_from_the_members_own_lists(app, client):
    from api.services.journal_two import notes as notes_service
    for sql, outer in [(notes_service._SWITCHER_RECENTS_SQL, "SEARCH r "),
                       (notes_service._SWITCHER_FAVORITES_SQL, "SEARCH f ")]:
        plan = _plan(sql)
        assert plan[0].startswith(outer), plan
        assert all("j2_notes_switcher" not in step and not step.startswith("SCAN") for step in plan), plan
