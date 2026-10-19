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
  * VISIBILITY (P5-AUD-1, superseding P5-R-C3): a firm style row is listed, and readable, in EVERY gallery
    read path (the list, UCT picks, one item, the feed, an author page, the update list and plan, the review
    queue, and the adopt, helpful, report and review doors) only while BOTH the library switch and the
    starter-packs switch are on. Either one alone shows nothing, so NOTEBOOK_STARTER_PACKS_ENABLED=0 hides
    them again. The one rule (`template_gallery._hidden_styles`) and its two renderings are held equal over
    every switch state.
"""
from __future__ import annotations

import importlib
import json
import os
import tempfile
import uuid

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
    monkeypatch.setenv(STARTER, "1")                  # a firm style is reviewable only with both on (P5-AUD-1)
    target = _style_rows(conn)[0]["id"]
    assert gallery.admin_act(ADMIN, target, "hide", conn=conn) is not None
    gallery.ensure_gallery_schema(conn)                                        # a reboot
    assert conn.execute("SELECT hidden FROM j2_template_gallery WHERE id = ?", (target,)).fetchone()[0] == 1
    assert len(_style_rows(conn)) == 15
    assert target not in {x["id"] for x in gallery.list_gallery(MEMBER, conn=conn)}


# ── 6. visibility (P5-AUD-1, superseding P5-R-C3) ───────────────────────────────────────

def _firm_style_ids_listed(conn, **kw):
    return {x["id"] for x in gallery.list_gallery(MEMBER, conn=conn, **kw) if x["firm"] and x["itemType"] == "style"}


#: Every (library, starter) state that must hide the firm style rows. ("1", "0") is the state production is in
#: while P5 ships dark: the library is ARMED and the starter switch is not.
HIDING_STATES = [("0", "0"), ("0", "1"), ("1", "0")]


def _member_style_row(conn, user_id):
    gid = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json, status,"
        " listed_at, created_at, updated_at, preview_json, item_type) VALUES (?, ?, 'member', 'Mine', '',"
        " 'journal', '{}', 'approved', '2026-10-10', '2026-10-10', '2026-10-10', '[]', 'style')",
        (gid, user_id))
    conn.commit()
    return gid


@pytest.mark.parametrize("starter", ["0", "1"])
def test_library_off_shows_no_firm_style_whatever_the_starter_switch(conn, monkeypatch, starter):
    monkeypatch.setenv(LIBRARY, "0")
    monkeypatch.setenv(STARTER, starter)
    ids = [r["id"] for r in _style_rows(conn)]
    assert _firm_style_ids_listed(conn) == set()
    assert _firm_style_ids_listed(conn, section="picks") == set()
    assert all(gallery.get_item(MEMBER, i, conn=conn) is None for i in ids)
    assert all(gallery.get_item(ADMIN, i, is_admin=True, conn=conn) is None for i in ids)


@pytest.mark.parametrize("starter", ["0", "1"])
def test_library_off_still_lists_the_outlines_and_refuses_a_style_filter(conn, monkeypatch, starter):
    """The library-off gallery is what it was before P5: outline rows only, and a style filter is the one 400
    (`Unknown item type.`), whatever the starter switch says."""
    gallery.seed_firm_templates(conn)
    monkeypatch.setenv(LIBRARY, "0")
    monkeypatch.setenv(STARTER, starter)
    listed = gallery.list_gallery(MEMBER, conn=conn)
    assert listed and {x["itemType"] for x in listed} == {"outline"}
    assert {x["itemType"] for x in gallery.admin_queue(conn=conn)["hidden"]} <= {"outline"}
    with pytest.raises(gallery.GalleryError, match="Unknown item type"):
        gallery.list_gallery(MEMBER, item_type="style", conn=conn)


def _starter_installed_copy(conn, monkeypatch, gid):
    """A member's copy of firm style `gid`, adopted while both switches are on, with the row then listed at a
    newer version so an update is waiting for it. Returns the copy's style id."""
    monkeypatch.setenv(LIBRARY, "1")
    monkeypatch.setenv(STARTER, "1")
    monkeypatch.setenv(STYLES, "1")
    out = gallery.adopt_style(MEMBER, gid, conn=conn)
    assert out is not None
    conn.execute("UPDATE j2_template_gallery SET version = version + 1 WHERE id = ?", (gid,))
    conn.commit()
    return out["style"]["id"]


def _every_read(conn, gid, hidden_gid, style_id):
    """What each gallery read path says about firm style `gid` (and the member's copy `style_id` of it, and the
    admin-hidden firm style `hidden_gid`). Each value is True exactly when that path shows the firm row."""
    queue = gallery.admin_queue(conn=conn)
    return {
        "list": gid in _firm_style_ids_listed(conn),
        "picks": gid in _firm_style_ids_listed(conn, section="picks"),
        "list:style": gid in {x["id"] for x in gallery.list_gallery(MEMBER, item_type="style", conn=conn)},
        "list:pack": gid in {x["id"] for x in gallery.list_gallery(MEMBER, trading_style="swing", conn=conn)},
        "list:search": gid in {x["id"] for x in gallery.list_gallery(MEMBER, q="Swing", conn=conn)},
        "item": gallery.get_item(MEMBER, gid, conn=conn) is not None,
        "item:admin": gallery.get_item(ADMIN, gid, is_admin=True, conn=conn) is not None,
        "updates": gid in {u["galleryId"] for u in gallery.list_updates(MEMBER, conn=conn)},
        "plan": gallery.plan_update(MEMBER, style_id, conn=conn) is not None,
        "queue:hidden": hidden_gid in {x["id"] for x in queue["hidden"]},
        "queue:reported": gid in {x["id"] for x in queue["reported"]},
    }


def test_starter_off_hides_every_firm_style_in_every_read_path(conn, monkeypatch):
    """THE LOAD-BEARING RAIL (P5-AUD-1). With the library on and the starter switch off (production while P5
    ships dark), no firm style row appears anywhere a gallery read can reach it, UCT picks included. The same
    world with both switches on shows it on every one of those paths, so a path that shows nothing in either
    state cannot pass for one that hides."""
    rows = _style_rows(conn)
    gid = next(r["id"] for r in rows if r["trading_style"] == "swing")
    hidden_gid = next(r["id"] for r in rows if r["trading_style"] == "day")
    style_id = _starter_installed_copy(conn, monkeypatch, gid)
    # A report on the firm row and an admin hide of another one, both made while both switches were on.
    assert gallery.report(MEMBER, gid, reason="other", conn=conn) == {"reported": True, "already": False}
    assert gallery.admin_act(ADMIN, hidden_gid, "hide", conn=conn) is not None

    shown = _every_read(conn, gid, hidden_gid, style_id)
    assert all(shown.values()), {k: v for k, v in shown.items() if not v}

    monkeypatch.setenv(STARTER, "0")
    gone = _every_read(conn, gid, hidden_gid, style_id)
    assert not any(gone.values()), {k: v for k, v in gone.items() if v}
    # Not one firm style anywhere in the list, in either section, nor as a single item.
    assert _firm_style_ids_listed(conn) == set() and _firm_style_ids_listed(conn, section="picks") == set()
    assert all(gallery.get_item(MEMBER, r["id"], conn=conn) is None for r in rows)
    # The write doors read it as absent too: nothing is adopted, marked, reported, used or reviewed.
    assert gallery.adopt_style(MEMBER, gid, conn=conn) is None
    assert gallery.set_helpful(MEMBER, gid, True, conn=conn) is None
    assert gallery.report(MEMBER, rows[2]["id"], reason="other", conn=conn) is None
    assert gallery.use_template(MEMBER, gid, conn=conn) is None
    assert gallery.admin_act(ADMIN, gid, "unfeature", conn=conn) is None
    open_report = conn.execute("SELECT id FROM j2_template_gallery_reports WHERE gallery_id = ?", (gid,)).fetchone()
    assert gallery.admin_report_act(ADMIN, open_report[0], "dismiss", conn=conn) is False
    # Hidden is a visibility state: nothing was deleted, the pick is still featured, the member's copy is theirs.
    assert len(_style_rows(conn)) == 15
    assert conn.execute("SELECT featured FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0] == 1
    assert js.get_style(MEMBER, style_id, conn) is not None


def test_with_both_switches_on_every_firm_style_is_a_uct_pick(conn, monkeypatch):
    monkeypatch.setenv(LIBRARY, "1")
    monkeypatch.setenv(STARTER, "1")
    ids = {r["id"] for r in _style_rows(conn)}
    assert _firm_style_ids_listed(conn) == ids
    assert _firm_style_ids_listed(conn, section="picks") == ids
    swing = gallery.list_gallery(MEMBER, item_type="style", trading_style="swing", conn=conn)
    assert sorted(x["title"] for x in swing) == ["Swing trade plan", "Swing trade review", "Weekend prep"]
    assert all(x["author"] == "UCT" and x["authorHandle"] is None for x in swing)
    item = gallery.get_item(MEMBER, next(iter(ids)), conn=conn)
    assert item is not None and item["payload"]["kindId"] in nk.BUILTIN_KIND_IDS


@pytest.mark.parametrize("library,starter", HIDING_STATES)
def test_a_hiding_state_hides_only_firm_styles(conn, monkeypatch, library, starter):
    """The starter switch hides firm STYLE rows only: a member's listed style (while the library is on) and the
    firm outlines stay where they were, so the rule cannot pass by hiding everything."""
    gallery.seed_firm_templates(conn)
    member_style = _member_style_row(conn, ADMIN)
    monkeypatch.setenv(LIBRARY, library)
    monkeypatch.setenv(STARTER, starter)
    listed = gallery.list_gallery(MEMBER, conn=conn)
    assert _firm_style_ids_listed(conn) == set()
    assert any(x["firm"] and x["itemType"] == "outline" for x in listed)
    assert (member_style in {x["id"] for x in listed}) is (library == "1")


@pytest.mark.parametrize("library", ["0", "1"])
@pytest.mark.parametrize("starter", ["0", "1"])
def test_the_one_rule_and_its_two_renderings_agree(conn, monkeypatch, library, starter):
    """`_library_hides` (one row) and `_hidden_styles_sql` (a list's WHERE) are the same decision: over every
    switch state, the rows the SQL term keeps are exactly the rows the row predicate does not hide."""
    gallery.seed_firm_templates(conn)
    _member_style_row(conn, ADMIN)
    monkeypatch.setenv(LIBRARY, library)
    monkeypatch.setenv(STARTER, starter)
    every = conn.execute("SELECT id, item_type, kind FROM j2_template_gallery g").fetchall()
    assert {(r["item_type"], r["kind"]) for r in every} == {("outline", "firm"), ("style", "firm"), ("style", "member")}
    kept = {r[0] for r in conn.execute(f"SELECT g.id FROM j2_template_gallery g WHERE {gallery._hidden_styles_sql()}")}
    assert {r["id"] for r in every if not gallery._library_hides(r)} == kept
    firm_styles = {r["id"] for r in every if r["item_type"] == "style" and r["kind"] == "firm"}
    assert (firm_styles <= kept) is (library == "1" and starter == "1")


EXAMPLES = "NOTEBOOK_EXAMPLE_NOTES_ENABLED"
PAGE_LAYOUTS = "JOURNAL_PAGE_LAYOUTS_ENABLED"
SHARING = "NOTEBOOK_LAYOUT_SHARING_ENABLED"
#: Every switch a row's visibility can turn on: (library, examples, starter, page layouts, layout sharing).
EVERY_STATE = [tuple("1" if (i >> b) & 1 else "0" for b in range(5)) for i in range(32)]


def _typed_row(conn, item_type, kind, user_id=ADMIN, **cols):
    """One APPROVED, visible gallery row of `item_type`/`kind`, written directly (a probe, never a member path)."""
    gid = uuid.uuid4().hex
    extra = ", ".join(cols)
    conn.execute(
        "INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json, status,"
        " listed_at, created_at, updated_at, preview_json, item_type" + (f", {extra}" if extra else "") + ")"
        " VALUES (?, ?, ?, ?, '', 'journal', '{\"type\": \"doc\", \"content\": []}', 'approved', '2026-10-10',"
        " '2026-10-10', '2026-10-10', '[]', ?" + ", ?" * len(cols) + ")",
        (gid, user_id, kind, f"{item_type} {kind}", item_type, *cols.values()))
    conn.commit()
    return gid


@pytest.mark.parametrize("state", EVERY_STATE, ids=lambda s: "lib{}-ex{}-starter{}-pl{}-share{}".format(*s))
def test_the_one_order_holds_for_every_row_type_in_every_switch_state(conn, monkeypatch, state):
    """P4b final I-M2 (T1). `_library_hides` keeps ONE order -- the example branch, the layout branch, then P5's
    style rule -- and it is the same decision as the list WHERE (`_hidden_styles_sql AND _type_visible_clause`) for
    EVERY kind of row: an outline, a firm style, a member's style, an example note and a page layout, over all 32
    states of the five switches (library, examples, starter packs, page layouts, layout sharing), the "library on,
    sharing off" mixed state included (triage 4). Then each answer is held to what the switches MEAN, so the two
    renderings cannot agree by both being wrong, and two readers that ask the rule are checked against it: an
    admin's single read (`get_item`) and the member's list, where `_NEVER_LISTED` also keeps every example out."""
    library, examples, starter, page_layouts, sharing = (v == "1" for v in state)
    for name, value in zip((LIBRARY, EXAMPLES, STARTER, PAGE_LAYOUTS, SHARING), state):
        monkeypatch.setenv(name, value)
    ids = {
        "outline": _typed_row(conn, "outline", "firm", user_id=None),
        "firm_style": _typed_row(conn, "style", "firm", user_id=None),
        "member_style": _typed_row(conn, "style", "member"),
        "example": _typed_row(conn, gallery.EXAMPLE_ITEM, "member"),
        "layout": _typed_row(conn, gallery.LAYOUT_ITEM, "member", source_page="trade"),
    }
    ours = set(ids.values())
    rows = conn.execute(f"SELECT id, item_type, kind FROM j2_template_gallery WHERE id IN ({','.join('?' * 5)})",
                        tuple(ours)).fetchall()
    shown = {r["id"] for r in rows if not gallery._library_hides(r)}
    where = f"{gallery._hidden_styles_sql()} AND {gallery._type_visible_clause()}"
    kept = {r[0] for r in conn.execute(f"SELECT g.id FROM j2_template_gallery g WHERE {where}")} & ours
    assert shown == kept, "the row rule and the list WHERE disagree"
    want = {"outline": True, "firm_style": library and starter, "member_style": library,
            "example": library and examples, "layout": library and page_layouts and sharing}
    assert {k: ids[k] in shown for k in ids} == want
    # Two readers that ask the rule: an admin's single read sees exactly the shown rows (a hidden type reads as
    # absent for an admin too), and the member's list lists exactly the shown rows minus every example.
    assert {i for i in ours if gallery.get_item(ADMIN, i, is_admin=True, conn=conn) is not None} == shown
    listed = {x["id"] for x in gallery.list_gallery(MEMBER, conn=conn)} & ours
    assert listed == shown - {ids["example"]}


def test_one_list_request_reads_the_switches_once(conn, monkeypatch):
    """P5-T5b-R1. `list_gallery` decides once per request: a library switch that flips between two reads (off,
    then on, with the starter switch on) cannot pair the library-off branch, which adds no item-type filter, with
    a WHERE term that lets style rows through. The flipping switch also proves the request read it ONCE."""
    gallery.seed_firm_templates(conn)
    _member_style_row(conn, ADMIN)
    monkeypatch.setenv(STARTER, "1")
    reads = []

    def flips() -> bool:
        reads.append(1)
        return len(reads) > 1           # off on the first read, on on every later one

    monkeypatch.setattr(gallery, "library_enabled", flips)
    listed = gallery.list_gallery(MEMBER, conn=conn)
    assert listed, "the outlines must still list, or this proves nothing"
    assert {x["itemType"] for x in listed} == {"outline"}
    assert len(reads) == 1


@pytest.mark.parametrize("section,item_type", [("all", None), ("picks", None), ("mine", None),
                                               ("all", "outline"), ("all", "page_layout"), ("all", "style")])
def test_every_list_request_reads_the_library_switch_once(conn, monkeypatch, section, item_type):
    """P4b final I-M3. With P3b's example rule and P4b's layout rule merged in, a list still reads `library_enabled`
    ONCE, in every section and for every type filter: the example and layout halves take this request's
    `library_on` (`_example_switch_on`, `_layout_switches_on`) instead of re-reading the library switch. Every
    other switch is on, so a stray second read could not hide behind a short-circuit."""
    for name in ("NOTEBOOK_EXAMPLE_NOTES_ENABLED", "JOURNAL_PAGE_LAYOUTS_ENABLED", "NOTEBOOK_LAYOUT_SHARING_ENABLED"):
        monkeypatch.setenv(name, "1")
    monkeypatch.setenv(STARTER, "1")
    reads = []

    def counted() -> bool:
        reads.append(1)
        return True

    monkeypatch.setattr(gallery, "library_enabled", counted)
    gallery.list_gallery(ADMIN if section == "mine" else MEMBER, section=section, item_type=item_type, conn=conn)
    assert len(reads) == 1


def test_the_feed_and_an_author_page_apply_the_same_rule(conn, monkeypatch):
    """A firm row has no author, so neither read can reach one in a real database. This PROBE gives one firm
    style row an author the member follows, to prove both reads carry the rule rather than relying on that
    absence: shown with the starter switch on, hidden with it off."""
    gid = _style_rows(conn)[0]["id"]
    conn.execute("UPDATE j2_template_gallery SET user_id = ? WHERE id = ?", (ADMIN, gid))
    conn.commit()
    monkeypatch.setenv(LIBRARY, "1")
    handle = gallery.author_handle(ADMIN, conn)
    assert gallery.set_follow(MEMBER, handle, True, conn=conn) == {"following": True}
    for starter, want in (("1", True), ("0", False)):
        monkeypatch.setenv(STARTER, starter)
        assert (gid in {x["id"] for x in gallery.feed(MEMBER, conn=conn)}) is want
        page = gallery.author_page(MEMBER, handle, conn=conn)
        assert (gid in {x["id"] for x in page["items"]}) is want
        assert page["author"]["itemCount"] == (1 if want else 0)


def test_with_both_switches_on_every_firm_style_adopts(conn, monkeypatch):
    """What Task 4 installs: each row is a style P3a's adopt can turn into a member's own copy."""
    monkeypatch.setenv(LIBRARY, "1")
    monkeypatch.setenv(STARTER, "1")
    monkeypatch.setenv(STYLES, "1")
    for r in _style_rows(conn):
        out = gallery.adopt_style(MEMBER, r["id"], conn=conn)
        assert out is not None, r["seed_key"]
        assert out["style"]["kindId"] == json.loads(r["payload_json"])["kindId"]
        assert out["credit"] == f"Based on UCT's {r['title']}"
