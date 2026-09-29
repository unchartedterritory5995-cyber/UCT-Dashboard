"""`get_symbol_backlinks` answers from ONE pass (wave 10, lane PC) -- and the answer is the same.

The read used to run a COUNT pass and then a page pass over the symbol's note set, with the page
pass grouping every embed of the symbol. It now takes the total as the window count over the rows
its page is ordered from, and reads the embed detail for the page's ids alone
(docs/notebook/perf-budgets.md §9). This file holds the answer to an INDEPENDENT truth computed in
Python from the seeded rows -- never to a copy of either query -- over a library built to hit every
edge the one pass could get wrong:

  * the total counts past the LIMIT (a window evaluated after the LIMIT would count the page);
  * trashed notes are out, ARCHIVED notes are in (the reader's own rule, `deleted_at` only);
  * another member's notes and sidecar rows never leak in, even on the same note id space;
  * a note with an embed AND a mention counts once; a mention-only note carries refs 0 and no
    widgets; a note with several embeds of the symbol carries every one, widgets de-duplicated;
  * ties on `updated_at` are broken by id, so the page is one page and not whatever the plan
    scanned first;
  * the limit clamps to 1..25.
"""
from __future__ import annotations

import random
import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc

USERS = ("u1", "u2")
SYMS = ("AMD", "NVDA", "TSLA", "META")
WIDGETS = ("chart", "tv", "flow")


@pytest.fixture(scope="module")
def lib(tmp_path_factory):
    path = tmp_path_factory.mktemp("bl") / "bl.db"
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    rng = random.Random(2026_09_29)
    notes, embeds, mentions = [], [], []
    for i in range(240):
        user = USERS[i % 2]
        nid = f"n{rng.randrange(10**8):08d}{i:03d}"
        ts = f"2026-09-{1 + rng.randrange(20):02d}T12:00:00+00:00"   # many ties on purpose
        roll = rng.random()
        deleted = ts if roll < 0.12 else None
        archived = ts if 0.12 <= roll < 0.25 else None
        notes.append((nid, user, f"t{i}", '{"type":"doc"}', "", "[]", None, ts, ts, deleted, archived))
        for pos in range(rng.randrange(0, 4)):
            embeds.append((nid, user, pos, rng.choice(WIDGETS), rng.choice(SYMS)))
        if rng.random() < 0.3:
            mentions.append((nid, user, rng.choice(SYMS)))
    # a sidecar row under the OTHER member on a note id this member owns must never count
    embeds.append((notes[0][0], "u2" if notes[0][1] == "u1" else "u1", 99, "chart", "AMD"))
    c.executemany("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, ticker,"
                  " created_at, updated_at, deleted_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", notes)
    c.executemany("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol)"
                  " VALUES (?,?,?,?,?)", embeds)
    c.executemany("INSERT OR IGNORE INTO j2_note_mentions (note_id, user_id, symbol, created_at)"
                  " VALUES (?,?,?,'2026-09-01')", mentions)
    c.commit()
    yield c, notes, embeds, mentions
    c.close()


def _truth(notes, embeds, mentions, user, sym, limit):
    by_id = {n[0]: n for n in notes}
    hit_ids = {e[0] for e in embeds if e[1] == user and e[4] == sym}
    hit_ids |= {m[0] for m in mentions if m[1] == user and m[2] == sym}
    live = [by_id[i] for i in hit_ids if i in by_id and by_id[i][1] == user and by_id[i][9] is None]
    live.sort(key=lambda n: n[0])                       # id ascending breaks the tie ...
    live.sort(key=lambda n: n[8], reverse=True)         # ... inside updated_at descending (stable)
    page = live[:max(1, min(limit, 25))]
    out = []
    for n in page:
        mine = [e for e in embeds if e[0] == n[0] and e[1] == user and e[4] == sym]
        out.append({"id": n[0], "title": n[2] or "Untitled", "updatedAt": n[8],
                    "refs": len(mine), "widgetIds": sorted({e[3] for e in mine})})
    return len(live), out


@pytest.mark.parametrize("user", USERS)
@pytest.mark.parametrize("sym", SYMS + ("ZZZZ",))
@pytest.mark.parametrize("limit", [0, 1, 5, 25, 100])
def test_the_one_pass_answer_equals_the_independent_truth(lib, user, sym, limit):
    conn, notes, embeds, mentions = lib
    count, page = _truth(notes, embeds, mentions, user, sym, limit)
    back = notes_svc.get_symbol_backlinks(user, sym.lower(), limit=limit, conn=conn)
    assert back["symbol"] == sym
    assert back["count"] == count
    assert back["notes"] == page


def test_the_fixture_reaches_every_edge_it_claims(lib):
    """Non-vacuity: a fixture that happened to hold no archived hit, no trashed hit, no
    mention-only hit or no multi-embed hit would pass the equality above without checking the
    edge it exists for."""
    _, notes, embeds, mentions = lib
    by_id = {n[0]: n for n in notes}
    emb = {(e[0], e[1], e[4]) for e in embeds}
    men = {(m[0], m[1], m[2]) for m in mentions}
    hits = emb | men
    assert any(by_id[k[0]][9] for k in hits if k[0] in by_id and by_id[k[0]][1] == k[1])        # trashed
    assert any(by_id[k[0]][10] and not by_id[k[0]][9]
               for k in hits if k[0] in by_id and by_id[k[0]][1] == k[1])                        # archived
    assert men - emb                                                                             # mention-only
    counts = {}
    for e in embeds:
        counts[(e[0], e[1], e[4])] = counts.get((e[0], e[1], e[4]), 0) + 1
    assert any(v > 1 for v in counts.values())                                                   # multi-embed
    totals = [_truth(notes, embeds, mentions, u, s, 25)[0] for u in USERS for s in SYMS]
    assert max(totals) > 25                                                                      # past the LIMIT
    stamps = [n[8] for n in notes]
    assert len(stamps) > len(set(stamps))                                                        # ties


def test_equal_updated_at_is_ordered_by_id_not_by_the_scan(tmp_path):
    """The page is ORDER BY updated_at DESC, n.id. Four notes share one `updated_at` and are
    inserted in an order that is neither id order nor its reverse, so neither a forward nor a
    reverse scan can pass by accident (the module fixture's random ties did not reach the page
    order, which is how removing the tiebreak survived -- review of lane PC, M3)."""
    c = sqlite3.connect(str(tmp_path / "tie.db"))
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    stamp = "2026-09-20T12:00:00+00:00"
    newer = "2026-09-21T12:00:00+00:00"
    rows = [("t3", stamp), ("t1", stamp), ("t0", newer), ("t4", stamp), ("t2", stamp)]
    for nid, ts in rows:
        c.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
                  " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                  (nid, "u1", nid, '{"type":"doc"}', "", "[]", ts, ts))
        c.execute("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol)"
                  " VALUES (?,?,?,?,?)", (nid, "u1", 0, "chart", "XYZ"))
    c.commit()
    try:
        got = notes_svc.get_symbol_backlinks("u1", "XYZ", conn=c)
        assert got["count"] == 5
        assert [n["id"] for n in got["notes"]] == ["t0", "t1", "t2", "t3", "t4"], got["notes"]
        # and a page that cuts through the tie keeps the same prefix
        cut = notes_svc.get_symbol_backlinks("u1", "XYZ", limit=3, conn=c)
        assert [n["id"] for n in cut["notes"]] == ["t0", "t1", "t2"] and cut["count"] == 5
    finally:
        c.close()
