"""P5 Task 3 -- the fifteen firm styles (three per starter pack), seeded as community gallery rows.

`api/services/journal_two/template_gallery_style_seed.json` holds the rows; `template_gallery.seed_firm_styles`
writes them on every boot (INSERT OR IGNORE by `seed_key`, so an admin's later hide is never undone). What
each section proves:

  * THE RULED TABLE: exactly the fifteen rows R-P5-3 names (pack, kind, title, blocks), three per pack,
    seed keys unique and `-v1` (R-P5-4), each carrying the category its kind maps to (P5-R-C5).
  * STYLE_PAYLOAD'S RULES (F9): a built-in kind, blocks the server can place with settings it accepts, no
    `builtin:note_kind`, the size cap, and an outline the gallery reducer leaves unchanged. Proved twice:
    by the validators themselves, and by building each row as a member's own style and asking P3a's
    `style_payload` for its portable copy, which must equal what was seeded.
  * THE SEED: the payload shape P3a's adopt reads, idempotent, wired into `ensure_gallery_schema`, and an
    admin hide that survives a reboot.
  * VISIBILITY (P5-R-C3): a firm style row is listed, and readable, only while the LIBRARY switch is on.
    The starter-packs switch alone shows nothing.
"""
from __future__ import annotations

import importlib
import json
import os
import tempfile

import pytest

from api.services.journal_two import journal_styles as js
from api.services.journal_two import note_kinds as nk
from api.services.journal_two import template_gallery as gallery

ADMIN = "user-p5-admin"
MEMBER = "user-p5-member"
LIBRARY = "NOTEBOOK_STYLE_LIBRARY_ENABLED"
STARTER = "NOTEBOOK_STARTER_PACKS_ENABLED"
STYLES = "NOTEBOOK_JOURNAL_STYLES_ENABLED"

#: R-P5-3 and the Task 3 table, verbatim: (seed key, pack, kind, title, blocks with their settings).
RULED = (
    ("uct-style-swing-trade-plan-v1", "swing", "trade_plan", "Swing trade plan",
     [("preEntryChecklist", {"includeRules": "yes", "requireAll": "no"}), ("positionSizing", {"grade": "A"}),
      ("marketcontext", {"fields": "all"}), ("chart", {"tf": "D"})]),
    ("uct-style-swing-weekend-prep-v1", "swing", "weekend_prep", "Weekend prep",
     [("prepMovers", {}), ("prepLevels", {}), ("myRules", {"which": "active"}),
      ("marketcontext", {"fields": "regime"})]),
    ("uct-style-swing-trade-review-v1", "swing", "post_trade_review", "Swing trade review",
     [("tradeReview", {}), ("myRules", {"which": "active"})]),
    ("uct-style-day-daily-prep-v1", "day", "daily_prep", "Day trading prep",
     [("prepWire", {}), ("prepEarnings", {}), ("prepMovers", {}), ("prepLevels", {}),
      ("myRules", {"which": "active"})]),
    ("uct-style-day-trade-plan-v1", "day", "trade_plan", "Intraday trade plan",
     [("preEntryChecklist", {"includeRules": "yes", "requireAll": "yes"}), ("positionSizing", {"grade": "A"}),
      ("priceStamps", {"on": "yes"}), ("chart", {"tf": "5"})]),
    ("uct-style-day-trade-review-v1", "day", "post_trade_review", "Day trade review",
     [("tradeReview", {}), ("myRules", {"which": "active"})]),
    ("uct-style-prop-daily-prep-v1", "prop", "daily_prep", "Prop desk daily prep",
     [("myRules", {"which": "all"}), ("prepWire", {}), ("prepLevels", {})]),
    ("uct-style-prop-trade-plan-v1", "prop", "trade_plan", "Prop trade plan",
     [("preEntryChecklist", {"includeRules": "yes", "requireAll": "yes"}), ("positionSizing", {"grade": "A"}),
      ("chart", {"tf": "15"})]),
    ("uct-style-prop-weekly-review-v1", "prop", "weekly_review", "Prop weekly review",
     [("myRules", {"which": "all"})]),
    ("uct-style-options-trade-plan-v1", "options", "trade_plan", "Options trade plan",
     [("preEntryChecklist", {"includeRules": "yes", "requireAll": "no"}), ("marketcontext", {"fields": "all"}),
      ("chart", {"tf": "D"})]),
    ("uct-style-options-earnings-prep-v1", "options", "earnings", "Options earnings prep",
     [("prepEarnings", {}), ("marketcontext", {"fields": "indexes"}), ("chart", {"tf": "D"})]),
    ("uct-style-options-trade-review-v1", "options", "post_trade_review", "Options trade review",
     [("tradeReview", {})]),
    ("uct-style-earnings-prep-v1", "earnings", "earnings", "Earnings prep",
     [("prepEarnings", {}), ("chart", {"tf": "D"}), ("marketcontext", {"fields": "regime"})]),
    ("uct-style-earnings-followup-v1", "earnings", "earnings_followup", "Earnings follow-up",
     [("chart", {"tf": "D"})]),
    ("uct-style-earnings-watchlist-v1", "earnings", "watchlist_note", "Earnings watchlist",
     [("chart", {"tf": "W"}), ("prepLevels", {})]),
)

#: P5-R-C5 (the pre-flight C5 mapping, accepted as proposed): the category each kind's firm style carries.
KIND_CATEGORY = {
    "trade_plan": "trade_plan",
    "daily_prep": "research", "weekend_prep": "research", "earnings": "research", "watchlist_note": "research",
    "post_trade_review": "review", "weekly_review": "review", "earnings_followup": "review",
}


# ── fixtures ────────────────────────────────────────────────────────────────────────────

def _fresh_auth_db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    return tmp.name, auth_db


def _unlink(path):
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(path + suffix)
        except OSError:
            pass


@pytest.fixture
def booted(monkeypatch):
    """A throwaway auth.db exactly as a boot leaves it: nothing removed."""
    for name in (LIBRARY, STARTER, STYLES):
        monkeypatch.delenv(name, raising=False)
    path, auth_db = _fresh_auth_db(monkeypatch)
    c = auth_db.get_connection()
    for uid, role in ((ADMIN, "admin"), (MEMBER, "member")):
        c.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                  (uid, f"{uid}@test.uct", "x", uid, role))
    c.commit()
    yield c
    c.close()
    _unlink(path)


@pytest.fixture
def conn(booted):
    """P3a's emptied-table pattern: the boot's seed removed, then ONLY the firm styles seeded, so every count
    below is a count of what `seed_firm_styles` wrote."""
    booted.execute("DELETE FROM j2_template_gallery")
    booted.commit()
    gallery.seed_firm_styles(booted)
    return booted


def _style_rows(c):
    return c.execute("SELECT * FROM j2_template_gallery WHERE kind = 'firm' AND item_type = 'style'"
                     " ORDER BY rowid").fetchall()


# ── 8. the outline conversion ───────────────────────────────────────────────────────────

def test_outline_from_headings_is_a_heading_then_an_empty_paragraph_per_heading():
    assert gallery._outline_from_headings(["A", "B"]) == [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "A"}]},
        {"type": "paragraph"},
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "B"}]},
        {"type": "paragraph"},
    ]
    assert gallery._outline_from_headings([]) == []


# ── 1. the ruled table ──────────────────────────────────────────────────────────────────

def test_the_seed_file_is_exactly_the_ruled_fifteen():
    seeds = gallery.load_style_seed()
    got = [(s["seedKey"], s["pack"], s["kindId"], s["title"],
            [(b["block"], b["settings"]) for b in s["blocks"]]) for s in seeds]
    assert got == [(k, p, kind, t, list(b)) for k, p, kind, t, b in RULED]
    assert all(b["enabled"] is True for s in seeds for b in s["blocks"])
    assert all(s["properties"] == {} for s in seeds)


def test_fifteen_rows_three_per_pack_five_packs_unique_keys(conn):
    rows = _style_rows(conn)
    assert len(rows) == 15
    packs = [r["trading_style"] for r in rows]
    assert sorted(set(packs)) == sorted({"swing", "day", "prop", "options", "earnings"})
    assert all(packs.count(p) == 3 for p in set(packs))
    assert set(packs) <= set(gallery.TRADING_STYLES)
    keys = [r["seed_key"] for r in rows]
    assert len(set(keys)) == 15
    assert all(k.startswith(f"uct-style-{r['trading_style']}-") and k.endswith("-v1") for k, r in zip(keys, rows))


def test_each_row_carries_the_category_its_kind_maps_to(conn):
    for s in gallery.load_style_seed():
        assert s["category"] == KIND_CATEGORY[s["kindId"]], s["seedKey"]
        assert s["category"] in gallery.CATEGORIES
    for r in _style_rows(conn):
        assert r["category"] == KIND_CATEGORY[json.loads(r["payload_json"])["kindId"]]


# ── 2. style_payload's rules, and 3. the outline ────────────────────────────────────────

def test_every_row_passes_style_payloads_rules(conn):
    for r in _style_rows(conn):
        payload = json.loads(r["payload_json"])
        assert set(payload) == {"kindId", "outlineBodyJson", "blocks", "properties"}, r["seed_key"]
        assert payload["kindId"] in nk.BUILTIN_KIND_IDS, r["seed_key"]
        assert payload["blocks"] and all(b["block"] in js.KNOWN_BLOCKS for b in payload["blocks"])
        assert js._clean_blocks(payload["blocks"]) == payload["blocks"], r["seed_key"]    # settings accepted
        assert nk.NOTE_KIND_PROPERTY not in payload["properties"]
        assert len(r["payload_json"].encode("utf-8")) <= gallery.MAX_BODY_BYTES
        assert gallery._safe_listed(payload) == payload, r["seed_key"]                     # adopt reads it whole


def test_every_row_is_what_style_payload_makes_of_it(conn):
    """The strongest form of case 2: build each row as a member's own style, through the style layer's
    own validation, and ask P3a's `style_payload` for the portable copy. It must be the seeded payload."""
    for r in _style_rows(conn):
        seeded = json.loads(r["payload_json"])
        mine = js.create_style(MEMBER, {"name": r["title"], **seeded}, conn)
        portable = gallery.style_payload(MEMBER, mine["id"], conn)
        assert portable.pop("droppedProperties") == 0, r["seed_key"]
        assert portable == seeded, r["seed_key"]


def test_every_outline_passes_the_gallery_reducer_unchanged():
    for s in gallery.load_style_seed():
        outline = {"type": "doc", "content": gallery._outline_from_headings(s["outlineHeadings"])}
        assert len(s["outlineHeadings"]) >= 3, s["seedKey"]
        assert gallery.sanitize_body(outline, "") == outline, s["seedKey"]


def test_the_stored_outline_is_the_body_and_the_preview_reads_it(conn):
    by_key = {s["seedKey"]: s for s in gallery.load_style_seed()}
    for r in _style_rows(conn):
        outline = json.loads(r["payload_json"])["outlineBodyJson"]
        assert outline == {"type": "doc", "content": gallery._outline_from_headings(
            by_key[r["seed_key"]]["outlineHeadings"])}
        assert json.loads(r["body_json"]) == outline
        assert json.loads(r["preview_json"]) == gallery.preview_lines(outline)
        assert (r["kind"], r["status"], r["featured"], r["hidden"], r["version"], r["user_id"]) == \
            ("firm", "approved", 1, 0, 1, None)


# ── 4. descriptions ─────────────────────────────────────────────────────────────────────

def test_every_description_is_one_plain_sentence_under_141_characters():
    for s in gallery.load_style_seed():
        d = s["description"]
        assert d and len(d) <= 140, (s["seedKey"], len(d))
        assert not any(ch in d for ch in "—–!"), s["seedKey"]
        assert d.endswith(".") and d.count(". ") == 0, s["seedKey"]
        assert not any(ch in s["title"] for ch in "—–!"), s["seedKey"]


# ── the seed itself ─────────────────────────────────────────────────────────────────────

def test_the_seed_is_idempotent(conn):
    assert gallery.seed_firm_styles(conn) == 0
    assert len(_style_rows(conn)) == 15


def test_the_seed_draws_no_random_id_and_each_id_is_its_seed_keys(booted, monkeypatch):
    """`tools/notebook_contract_fixtures.py` makes uuid4 a deterministic counter, and this seed runs inside
    every `ensure_schema`: a uuid4 draw here would shift every id the contract fixtures record after it."""
    booted.execute("DELETE FROM j2_template_gallery")
    booted.commit()

    def refuse():
        raise AssertionError("seed_firm_styles drew a uuid4")
    monkeypatch.setattr(gallery.uuid, "uuid4", refuse)
    assert gallery.seed_firm_styles(booted) == 15
    ids = [r["id"] for r in _style_rows(booted)]
    assert ids == [gallery.firm_style_id(s["seedKey"]) for s in gallery.load_style_seed()]
    assert len(set(ids)) == 15
    assert gallery.firm_style_id("uct-style-swing-trade-plan-v1") != gallery.firm_style_id(
        "uct-style-swing-trade-plan-v2")


def test_a_boot_seeds_the_styles_and_leaves_the_outline_count_alone(booted):
    styles = booted.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE kind = 'firm'"
                            " AND item_type = 'style'").fetchone()[0]
    outlines = booted.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE kind = 'firm'"
                              " AND item_type = 'outline'").fetchone()[0]
    assert styles == 15
    assert outlines == len(gallery.load_seed())
    assert 4 <= len(gallery.load_seed()) <= 6             # the outline seed rail, untouched by these rows


# ── 5. an admin choice survives a reboot ────────────────────────────────────────────────

def test_reboot_keeps_an_admin_hide(conn, monkeypatch):
    monkeypatch.setenv(LIBRARY, "1")
    target = _style_rows(conn)[0]["id"]
    assert gallery.admin_act(ADMIN, target, "hide", conn=conn) is not None
    gallery.ensure_gallery_schema(conn)                                        # a reboot
    assert conn.execute("SELECT hidden FROM j2_template_gallery WHERE id = ?", (target,)).fetchone()[0] == 1
    assert len(_style_rows(conn)) == 15
    assert target not in {x["id"] for x in gallery.list_gallery(MEMBER, conn=conn)}


# ── 6. visibility (P5-R-C3) ─────────────────────────────────────────────────────────────

def _firm_style_ids_listed(conn, **kw):
    return {x["id"] for x in gallery.list_gallery(MEMBER, conn=conn, **kw) if x["firm"] and x["itemType"] == "style"}


@pytest.mark.parametrize("starter", ["0", "1"])
def test_library_off_shows_no_firm_style_whatever_the_starter_switch(conn, monkeypatch, starter):
    monkeypatch.setenv(LIBRARY, "0")
    monkeypatch.setenv(STARTER, starter)
    ids = [r["id"] for r in _style_rows(conn)]
    assert _firm_style_ids_listed(conn) == set()
    assert _firm_style_ids_listed(conn, section="picks") == set()
    assert all(gallery.get_item(MEMBER, i, conn=conn) is None for i in ids)
    assert all(gallery.get_item(ADMIN, i, is_admin=True, conn=conn) is None for i in ids)


def test_library_on_lists_every_firm_style_as_a_uct_pick(conn, monkeypatch):
    monkeypatch.setenv(LIBRARY, "1")
    ids = {r["id"] for r in _style_rows(conn)}
    assert _firm_style_ids_listed(conn) == ids
    assert _firm_style_ids_listed(conn, section="picks") == ids
    swing = gallery.list_gallery(MEMBER, item_type="style", trading_style="swing", conn=conn)
    assert sorted(x["title"] for x in swing) == ["Swing trade plan", "Swing trade review", "Weekend prep"]
    assert all(x["author"] == "UCT" and x["authorHandle"] is None for x in swing)
    item = gallery.get_item(MEMBER, next(iter(ids)), conn=conn)
    assert item is not None and item["payload"]["kindId"] in nk.BUILTIN_KIND_IDS


def test_with_the_library_on_every_firm_style_adopts(conn, monkeypatch):
    """What Task 4 will install: each row is a style P3a's adopt can turn into a member's own copy."""
    monkeypatch.setenv(LIBRARY, "1")
    monkeypatch.setenv(STYLES, "1")
    for r in _style_rows(conn):
        out = gallery.adopt_style(MEMBER, r["id"], conn=conn)
        assert out is not None, r["seed_key"]
        assert out["style"]["kindId"] == json.loads(r["payload_json"])["kindId"]
        assert out["credit"] == f"Based on UCT's {r['title']}"
