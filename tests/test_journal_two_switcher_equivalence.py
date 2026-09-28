"""The quick switcher's wave-10 read path answers EXACTLY what the old one did (lane 10A).

Wave 10 stopped reading every live title into Python on each keystroke (the ~140 ms
docs/notebook/perf-budgets.md §7 attributes at 50k notes). The exact tiers now read the
CANDIDATES a SQL superset test returns, and the fuzzy tiers read their bounded scope with
a LIMIT. The ranking code is unchanged; what changed is which rows reach it, and in what
order, so the rail is a DIFFERENTIAL: the pre-wave-10 algorithm, frozen below verbatim
(names re-pointed at the module, its three SQL statements kept as they shipped at
c7e140b9e), against the live function, over randomized libraries and queries built to hit
every place the two could part:

  * non-ASCII titles, where Python's case folding and SQLite's `lower()` disagree
    ("Élan"/"élan", the Kelvin sign folding to an ASCII "k", a dotted capital I);
  * empty titles, word-break punctuation, `%`/`_` as text, tied `updated_at` values;
  * trashed and archived notes, another member's notes;
  * recents and favourites on BOTH sides of the fuzzy scope, which is shrunk so a
    small library crosses it (the old code placed a note by its position in the
    whole list; the new one by its placement order -- equal only if the reads
    arrive in the same order);
  * single letters, words, several words, typos, letters-in-order, limits 1 to 50.

The whole answer is compared: every row and field, `hasMore`, `prefixExhausted`.

⭐ Wave 10, follow-up F6: the switcher's answer is now its TITLE half
(`notes._switcher_title_search`, the function this rail always described) plus a body
half filled from the search box's relevance pass when the titles leave room. The oracle
is a title search, so the differential compares it with the title half; the body half
is railed in tests/test_journal_two_switcher_body_fallback.py.
"""
from __future__ import annotations

import random
import sqlite3
import uuid
from typing import Any

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

U = "u1"

# ── the oracle: the pre-wave-10 switcher, frozen ─────────────────────────────

_OLD_SCAN_SQL = (
    "SELECT rowid, title FROM j2_notes"
    " WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL"
    " ORDER BY updated_at DESC, title ASC, rowid ASC"
)
# CROSS JOIN pins the recents/favourites table as the OUTER loop — left to
# itself the planner chose to walk all 50k notes and probe each one (~115 ms).
_OLD_RECENTS_SQL = (
    "SELECT n.rowid, r.opened_at FROM j2_note_recents r"
    " CROSS JOIN j2_notes n ON n.id = r.note_id AND n.user_id = r.user_id"
    " WHERE r.user_id = ? AND n.deleted_at IS NULL AND n.archived_at IS NULL"
)
_OLD_FAVORITES_SQL = (
    "SELECT n.rowid FROM j2_note_favorites f"
    " CROSS JOIN j2_notes n ON n.id = f.note_id AND n.user_id = f.user_id"
    " WHERE f.user_id = ? AND n.deleted_at IS NULL AND n.archived_at IS NULL"
)



def _reference_switcher_search(
    user_id: str,
    q: str,
    limit: int = notes_svc.SWITCHER_DEFAULT_LIMIT,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """The pre-wave-10 algorithm, verbatim but for the names it reads."""
    text = " ".join(str(q or "").lower().split())[:notes_svc._SWITCHER_MAX_QUERY_CHARS]
    if not text:
        return {"notes": [], "hasMore": False, "prefixExhausted": False}
    limit = max(1, min(int(limit or notes_svc.SWITCHER_DEFAULT_LIMIT), notes_svc.SWITCHER_MAX_LIMIT))
    tokens = text.split()[:notes_svc._SWITCHER_MAX_TOKENS]
    word_query = notes_svc._switcher_word_text(text)
    word_tokens = [t for t in (notes_svc._switcher_word_text(tok) for tok in tokens) if t]
    words = word_query.split()          # every typed word, breaks split out
    letters = "".join(words)
    run_fuzzy = len(letters) >= notes_svc.SWITCHER_FUZZY_MIN_CHARS
    single = tokens[0] if len(tokens) == 1 else None

    owned = conn is None
    conn = conn or notes_svc.get_connection()
    try:
        cur = conn.cursor()
        cur.row_factory = None           # plain tuples: 50k Row objects cost real time
        # Served from idx_j2_notes_switcher alone (a rail pins the plan).
        live = cur.execute(_OLD_SCAN_SQL, (user_id,)).fetchall()
        recent_at = dict(cur.execute(_OLD_RECENTS_SQL, (user_id,)).fetchall())
        favs = {rid for (rid,) in cur.execute(_OLD_FAVORITES_SQL, (user_id,)).fetchall()}

        tiers: list[list[int]] = [[] for _ in range(notes_svc.SWITCHER_TIER_TYPO + 1)]
        # Recents and favourites lead their tier, so they are noted as they are
        # placed; everything else is read lazily, in newest-edit order, only as
        # far as the page needs.
        specials = set(recent_at) | favs
        special_in: dict[int, list[int]] = {}
        special_pos: set[int] = set()

        def _place(pos: int, rid: int, tier: int) -> None:
            tiers[tier].append(pos)
            if rid in specials:
                special_in.setdefault(tier, []).append(pos)
                special_pos.add(pos)

        misses: list[tuple[int, str]] = []   # (position, lowered title) no exact tier matched
        needle = " " + word_query
        for pos, (rid, title) in enumerate(live):
            t = (title or "").lower()
            if single is not None:
                hit = single in t
            else:
                hit = all(tok in t for tok in tokens)
            if not hit:
                misses.append((pos, t))
                continue
            if t == text:
                tier = notes_svc.SWITCHER_TIER_EXACT
            elif t.startswith(text):
                tier = notes_svc.SWITCHER_TIER_PREFIX
            elif word_query and needle in " " + t:
                # A word starts with it before any break is even replaced —
                # the common case, found without building the word text.
                tier = notes_svc.SWITCHER_TIER_WORD_START
            else:
                wt = " " + t.translate(notes_svc._SWITCHER_BREAK_TABLE)
                if word_query and needle in wt:
                    tier = notes_svc.SWITCHER_TIER_WORD_START
                elif len(word_tokens) > 1 and all((" " + w) in wt for w in word_tokens):
                    tier = notes_svc.SWITCHER_TIER_ALL_WORDS_START
                elif text in t:
                    tier = notes_svc.SWITCHER_TIER_SUBSTRING
                else:
                    tier = notes_svc.SWITCHER_TIER_ALL_WORDS
            _place(pos, rid, tier)

        def _ranked(tier: int):
            """One tier in display order: recents (last opened first), then
            favourites, then everything else — each in newest-edit order."""
            sp = special_in.get(tier, [])
            rec = [p for p in sp if live[p][0] in recent_at]
            fav = [p for p in sp if live[p][0] not in recent_at]
            rec.sort(key=lambda p: (live[p][0] not in favs, p))
            rec.sort(key=lambda p: recent_at[live[p][0]], reverse=True)
            yield from rec
            yield from fav
            for p in tiers[tier]:
                if p not in special_pos:
                    yield p

        picked: list[tuple[int, int]] = []

        def _take(tier: int) -> bool:
            for p in _ranked(tier):
                picked.append((p, tier))
                if len(picked) > limit:
                    return True
            return False

        full = False
        for tier in range(notes_svc.SWITCHER_TIER_ALL_WORDS + 1):
            if _take(tier):
                full = True
                break

        if not full and words and misses:
            # ── the bounded fuzzy tiers ──
            scope = [(p, t) for p, t in misses
                     if p < notes_svc.SWITCHER_FUZZY_SCOPE or live[p][0] in recent_at or live[p][0] in favs]
            typo_words = [w for w in words if notes_svc._typo_eligible(w)]
            slip_memo: dict[tuple[str, str], bool] = {}
            for p, t in scope:
                wt = " " + t.translate(notes_svc._SWITCHER_BREAK_TABLE)
                if run_fuzzy and notes_svc._in_order_from_word_start(wt, letters):
                    _place(p, live[p][0], notes_svc.SWITCHER_TIER_FUZZY)
                    continue
                title_words = None
                ok = True
                for w in words:
                    if w in t:
                        continue
                    if w not in typo_words:
                        ok = False
                        break
                    if title_words is None:
                        title_words = wt.split()
                    found = False
                    for tw in title_words:
                        key = (w, tw)
                        hit = slip_memo.get(key)
                        if hit is None:
                            hit = slip_memo[key] = notes_svc._typo_starts_word(w, tw)
                        if hit:
                            found = True
                            break
                    if not found:
                        ok = False
                        break
                if ok:
                    _place(p, live[p][0], notes_svc.SWITCHER_TIER_TYPO)
            for tier in (notes_svc.SWITCHER_TIER_FUZZY, notes_svc.SWITCHER_TIER_TYPO):
                if _take(tier):
                    break

        has_more = len(picked) > limit
        picked = picked[:limit]
        prefix_exhausted = (not picked and run_fuzzy and bool(words)
                            and notes_svc._typo_eligible(words[-1]))
        if not picked:
            return {"notes": [], "hasMore": False, "prefixExhausted": prefix_exhausted}

        rowids = [live[p][0] for p, _tier in picked]
        placeholders = ",".join("?" * len(rowids))
        detail = {r["rowid"]: r for r in conn.execute(
            "SELECT rowid, id, title, folder_id, ticker, updated_at FROM j2_notes"
            f" WHERE rowid IN ({placeholders}) AND user_id = ?",
            [*rowids, user_id],
        ).fetchall()}
        paths = (notes_svc._folder_paths(conn, user_id)
                 if any(r["folder_id"] for r in detail.values()) else {})
        notes = []
        for p, tier in picked:
            rid = live[p][0]
            r = detail.get(rid)
            if r is None:                # deleted between the two reads
                continue
            notes.append({
                "id": r["id"],
                "title": r["title"] or "",
                "folderId": r["folder_id"],
                "folderPath": paths.get(r["folder_id"]) if r["folder_id"] else None,
                "ticker": r["ticker"],
                "updatedAt": r["updated_at"],
                "isRecent": rid in recent_at,
                "isFavorite": rid in favs,
                "matchTier": tier,
                "strong": tier <= notes_svc.SWITCHER_STRONG_TIER_MAX,
                "exact": tier == notes_svc.SWITCHER_TIER_EXACT,
            })
        return {"notes": notes, "hasMore": has_more, "prefixExhausted": False}
    finally:
        if owned:
            conn.close()


# ── the differential ─────────────────────────────────────────────────────────

_WORDS = ["nvda", "thesis", "setup", "earnings", "semis", "breakout", "review", "macro",
          "rates", "q3", "plan", "élan", "Élan", "straße", "Kelvin", "kelvin", "İstanbul",
          "istanbul", "50%", "a_b", "NVDA-Q3", "$amd", "(draft)", "x/y", "4999"]


def _title(rng: random.Random) -> str:
    if rng.random() < 0.04:
        return ""
    t = " ".join(rng.choice(_WORDS) for _ in range(rng.randint(1, 4)))
    if rng.random() < 0.3:
        t = t.upper() if rng.random() < 0.5 else t.title()
    return t


def _library(tmp_path, seed: int, n: int):
    rng = random.Random(seed)
    c = sqlite3.connect(str(tmp_path / f"sw{seed}.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    ids = []
    for _ in range(n):
        nid = uuid.UUID(int=rng.getrandbits(128)).hex
        # coarse timestamps: many ties, so the title and rowid tiebreaks decide
        ts = f"2026-09-{1 + rng.randint(0, 20):02d}T00:00:00+00:00"
        deleted = ts if rng.random() < 0.05 else None
        archived = ts if (deleted is None and rng.random() < 0.05) else None
        user = U if rng.random() < 0.93 else "u2"
        c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at,"
                  " updated_at, deleted_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (nid, user, _title(rng), '{"type":"doc"}', "", "[]", ts, ts, deleted, archived))
        if user == U:
            ids.append(nid)
    for nid in rng.sample(ids, min(25, len(ids))):
        c.execute("INSERT INTO j2_note_recents (user_id, note_id, opened_at) VALUES (?,?,?)",
                  (U, nid, f"2026-09-{1 + rng.randint(0, 25):02d}T12:00:00+00:00"))
    for nid in rng.sample(ids, min(15, len(ids))):
        c.execute("INSERT OR IGNORE INTO j2_note_favorites (user_id, note_id, created_at) VALUES (?,?,?)",
                  (U, nid, "2026-09-01T00:00:00+00:00"))
    c.commit()
    return c, rng


def _queries(rng: random.Random) -> list[str]:
    alphabet = "semiortanvdhqgp -3é%_k$"
    out = ["n", "e", "k", "é", "nvda", "nvda setup", "setup nvda", "élan", "ÉLAN", "kelvin", "istanbul",
           "50%", "a_b", "q3", "nvth", "semsi", "earbin", "thesis review macro", "(draft)", "x/y", "4999",
           "zzzz", "straße", "strasse", "NVDA-Q3 plan", "$amd"]
    for _ in range(60):
        out.append("".join(rng.choice(alphabet) for _ in range(rng.randint(1, 7))))
    for _ in range(40):
        w = rng.choice(_WORDS).lower()
        if len(w) > 3 and rng.random() < 0.6:
            i = rng.randrange(len(w))
            w = w[:i] + w[i + 1:]                       # a slip
        out.append(w if rng.random() < 0.7 else w + " " + rng.choice(_WORDS))
    return out


@pytest.mark.parametrize("seed,n,scope", [(1, 400, 60), (2, 900, 150), (3, 250, 5000), (4, 1200, 40)])
def test_the_new_read_path_answers_exactly_what_the_old_one_did(tmp_path, monkeypatch, seed, n, scope):
    monkeypatch.setattr(notes_svc, "SWITCHER_FUZZY_SCOPE", scope)
    c, rng = _library(tmp_path, seed, n)
    try:
        compared = nonempty = 0
        queries = _queries(rng)
        for q in queries:
            for limit in (1, 8, 50):
                want = _reference_switcher_search(U, q, limit=limit, conn=c)
                got = notes_svc._switcher_title_search(U, q, limit=limit, conn=c)
                assert got == want, (q, limit, got, want)
                compared += 1
                nonempty += bool(want["notes"])
        # non-vacuity: the corpus really reached answers, fuzzy ones included
        assert compared == 3 * len(queries) >= 360 and nonempty >= compared // 3, (compared, nonempty)
        fuzzy = [q for q in ("nvth", "semsi", "earbin")
                 if any(r["matchTier"] >= notes_svc.SWITCHER_TIER_FUZZY
                        for r in _reference_switcher_search(U, q, limit=50, conn=c)["notes"])]
        assert fuzzy, "the corpus never reached a fuzzy tier"
    finally:
        c.close()


def test_a_non_ascii_title_is_found_through_the_candidate_read(tmp_path):
    """The superset clause is load-bearing: SQLite's lower() leaves the Kelvin sign
    alone while Python folds it to "k", so an ASCII-only test would drop this note."""
    c = sqlite3.connect(str(tmp_path / "k.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
              " VALUES ('k1', ?, ?, '{}', '', '[]', '2026-09-01', '2026-09-01')", (U, "KELVIN plan"))
    c.commit()
    got = notes_svc._switcher_title_search(U, "kelvin", conn=c)
    assert [n["id"] for n in got["notes"]] == ["k1"], got
    assert got == _reference_switcher_search(U, "kelvin", conn=c)
    c.close()


def test_the_candidate_and_scope_reads_are_served_by_the_covering_index_alone(tmp_path):
    c = sqlite3.connect(str(tmp_path / "p.db"))
    j2db.ensure_schema(c)
    want = ["SEARCH j2_notes USING COVERING INDEX idx_j2_notes_switcher_live"
            " (user_id=? AND deleted_at=? AND archived_at=?)"]
    for tokens in (["x"], ["x", "y", "z"], ["élan", "x"]):
        sql, params = notes_svc._switcher_candidates_sql(tokens)
        plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + sql, ("u1", *params))]
        assert plan == want, plan
    plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + notes_svc._SWITCHER_SCOPE_SQL, ("u1", 10))]
    assert plan == want, plan
    c.close()


def test_the_folding_to_ascii_characters_are_derived_not_remembered():
    """`_SWITCHER_ASCII_FOLDING_CHARS` is typed in the code (a derivation over every
    code point costs a third of a second, too slow for a module import); this derives
    the set the superset argument depends on -- every non-ASCII character whose
    Python `lower()` holds an ASCII character -- and fails by name if the running
    Python's Unicode database disagrees."""
    import sys
    derived = {chr(cp) for cp in range(128, sys.maxunicode + 1)
               if any(ord(x) < 128 for x in chr(cp).lower())}
    assert derived == set(notes_svc._SWITCHER_ASCII_FOLDING_CHARS), sorted(hex(ord(c)) for c in derived)


def test_a_dotted_capital_i_title_is_found_by_its_ascii_letter(tmp_path):
    """Python folds the dotted capital I to "i" plus a combining dot, so "qi" is inside
    "QİX plan".lower() while SQLite's lower() keeps the capital -- only the
    folding clause admits this title. (A control first: SQLite really misses it.)"""
    c = sqlite3.connect(str(tmp_path / "i.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    title = "QİX plan"
    c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
              " VALUES ('i1', ?, ?, '{}', '', '[]', '2026-09-01', '2026-09-01')", (U, title))
    c.commit()
    assert c.execute("SELECT instr(lower(?), 'qi')", (title,)).fetchone()[0] == 0
    assert "qi" in title.lower()
    for q in ("qi", "qi plan"):
        got = notes_svc._switcher_title_search(U, q, conn=c)
        assert [n["id"] for n in got["notes"]] == ["i1"], (q, got)
        assert got == _reference_switcher_search(U, q, conn=c), q
    c.close()
