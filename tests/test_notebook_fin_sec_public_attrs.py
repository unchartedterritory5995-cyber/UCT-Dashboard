"""Security lane, round 2: a SHARE LINK and a PUBLISHED PAGE carry only named, checked
attributes, exactly as a gallery template does (tests/test_notebook_fin_sec_gallery_attrs.py).

These pages are public and served from our own domain. The page renders the reduced body
with the real editor extensions, read-only (`public/ReadOnlyNote.jsx`), and TipTap's
FontFamily and FontSize write their attribute into an inline `style`. Before this change the
share and publish reducers kept every attribute, so an author's
`fontFamily = "x; position:fixed; inset:0; background-image:url(...)"` reached a visitor's
browser as inline CSS, and a link could carry any `class`, `target` and `rel`. That predates
waves 12 to 15; it was measured on the rendered page before it was changed
(docs/notebook/fin-sec.md has the recorded HTML).

What is pinned here:
  * hostile values survive nowhere in a share or publish copy, through the reducer AND through
    the real public routes (`GET /api/j2/shared/{token}`, `GET /api/j2/published/{slug}`);
  * what the editor's own controls write passes through unchanged, including what these two
    modes keep and a gallery does not: images, checked tasks, mailto links;
  * `tests/fixtures/notebook_public_hostile.json` is the reducer's CURRENT output for a hostile
    note. The client test `public/ReadOnlyNote.hostile.test.jsx` renders that file on the real
    public page component and asserts on the final HTML, so the two halves cannot drift.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.journal_two import public_note_payload as public
from tests.test_notebook_fin_sec_gallery_attrs import (
    HOSTILE, _assert_clean, _hostile_body, _strings, _toolbar_body, p, t,
)
from tests.test_share_publish_authorization import (  # noqa: F401 -- fixtures
    _fresh_limiter, _note, app, att_root, client, db_path, gates_on,
)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "notebook_public_hostile.json"
MODES = ("share", "publish")
A = "user-sec-public-author"


def _reduce(body, mode, base=None):
    return public.reduce(body, mode=mode, owner_id=A, note_id="n1",
                         attachment_base=base or f"/api/j2/{mode}d/x/att/", facts={}, note_links={})


# ── the reducer ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("label,hostile,fragment", HOSTILE, ids=[h[0] for h in HOSTILE])
def test_a_hostile_value_survives_nowhere_in_a_public_copy(mode, label, hostile, fragment):
    out = _reduce(_hostile_body(hostile), mode)
    _assert_clean(out, fragment, f"the {mode} copy")
    flat = json.dumps(out)
    for kept in ("Plan", "styled", "coloured", "marked", "link", "note", "x = 1", "one", "task",
                 "inside", "https://example.com/ok"):
        assert kept in flat, kept


def test_CONTROL_the_hostile_fixture_really_carries_the_value():
    hostile, fragment = HOSTILE[0][1], HOSTILE[0][2]
    assert sum(1 for s in _strings(_hostile_body(hostile)) if fragment in s) >= 20


def _public_extras(base):
    """What share and publish keep that a gallery does not."""
    return [
        {"type": "image", "attrs": {"src": base + "inline/pic.png", "alt": "my chart", "title": None,
                                    "width": 480, "height": None, "align": "center"}},
        {"type": "image", "attrs": {"src": "https://example.com/c.png", "alt": None, "title": "web",
                                    "width": None, "height": None, "align": "full"}},
        {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": True}, "content": [p(t("done"))]},
            {"type": "taskItem", "attrs": {"checked": False}, "content": [p(t("todo"))]}]},
        p(t("mail me", {"type": "link", "attrs": {"href": "mailto:desk@example.com", "target": "_blank",
                                                  "rel": "noreferrer"}}),
          t("hex", {"type": "textColor", "attrs": {"color": "#1a2b3c"}}),
          t("hex mark", {"type": "highlight", "attrs": {"color": "#ffcc00"}})),
        {"type": "linkPreview", "attrs": {"url": "https://example.com/a", "title": "A page",
                                          "description": "About it", "domain": "example.com",
                                          "image": "https://example.com/i.png"}},
    ]


@pytest.mark.parametrize("mode", MODES)
def test_what_the_editor_writes_passes_through_a_public_copy_unchanged(mode):
    base = f"/api/j2/{mode}d/x/att/"
    body = _toolbar_body()
    body["content"].extend(_public_extras(base))
    assert _reduce(body, mode, base) == body


@pytest.mark.parametrize("mode", MODES)
def test_the_public_filter_is_stable_run_twice(mode):
    for body in (_toolbar_body(), _hostile_body(HOSTILE[0][1])):
        once = _reduce(body, mode)
        assert _reduce(once, mode) == once


@pytest.mark.parametrize("mode", MODES)
def test_a_public_link_is_http_https_or_mailto_with_fixed_target_and_rel(mode):
    def link_after(attrs):
        out = _reduce({"type": "doc", "content": [p(t("x", {"type": "link", "attrs": attrs}))]}, mode)
        marks = out["content"][0]["content"][0].get("marks") or []
        return marks[0]["attrs"] if marks else None
    assert link_after({"href": "https://example.com/a", "target": "_self", "rel": "opener", "class": "overlay",
                       "title": "x"}) == {"href": "https://example.com/a", "target": "_blank", "rel": "noreferrer"}
    assert link_after({"href": "mailto:desk@example.com"})["href"] == "mailto:desk@example.com"
    for bad in ("javascript:alert(1)", "data:text/html,x", "vbscript:x", "ftp://example.com/x",
                "mailto:a@example.com\"onmouseover=x", "https://example.com/<script>",
                "https://example.com/" + "a" * 3000):
        assert link_after({"href": bad}) is None, bad


@pytest.mark.parametrize("mode", MODES)
def test_an_image_keeps_its_size_and_alignment_and_nothing_else(mode):
    base = f"/api/j2/{mode}d/x/att/"
    bad = HOSTILE[0][1]
    out = _reduce({"type": "doc", "content": [
        {"type": "image", "attrs": {"src": "https://example.com/c.png", "alt": "ok", "title": bad, "width": bad,
                                    "height": "100%;position:fixed", "align": bad, "style": bad, "class": bad,
                                    "onerror": "alert(1)", "srcset": "https://evil.example/x 2x"}}]}, mode, base)
    attrs = out["content"][0]["attrs"]
    assert attrs == {"src": "https://example.com/c.png", "alt": "ok", "title": bad[:300]}
    # the title is the image's WORDS (an HTML attribute value, escaped by the DOM): kept, capped


# ── the real public routes ───────────────────────────────────────────────────

def _seed_user():
    from api.services.auth_db import get_connection
    c = get_connection()
    c.execute("INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
              (A, "sec-public@example.com", "x", "Author", "member"))
    c.commit()
    c.close()


@pytest.mark.parametrize("label,hostile,fragment", HOSTILE[:6], ids=[h[0] for h in HOSTILE[:6]])
def test_the_public_routes_never_serve_a_hostile_value(client, gates_on, att_root, label, hostile, fragment):
    from api.services.journal_two import note_publish, note_shares
    _seed_user()
    note = _note(A, "Hostile", bodyJson=_hostile_body(hostile))
    token = note_shares.create_share(A, note["id"])["token"]
    slug = note_publish.publish_note(A, note["id"])["slug"]

    shared = client.get(f"/api/j2/shared/{token}")
    published = client.get(f"/api/j2/published/{slug}")
    assert shared.status_code == 200 and published.status_code == 200, (shared.text[:120], published.text[:120])
    assert "styled" in shared.text and "styled" in published.text          # the note really is in there
    _assert_clean(shared.json(), fragment, "GET /api/j2/shared/{token}")
    _assert_clean(published.json(), fragment, "GET /api/j2/published/{slug}")
    for resp in (shared, published):
        for name, value in public.PUBLIC_HEADERS.items():
            assert resp.headers.get(name) == value, name


# ── the fixture the client test renders ──────────────────────────────────────

def _fixture_now():
    hostile = "x; position:fixed; inset:0; opacity:0.01; background-image:url(https://evil.example/p)"
    raw = {"type": "doc", "content": [p(
        t("family", {"type": "textStyle", "attrs": {"fontFamily": hostile}}),
        t("size", {"type": "textStyle", "attrs": {"fontSize": "12px; position:fixed; top:0"}}),
        t("colour", {"type": "textColor", "attrs": {"color": "red; position:fixed"}}),
        t("mark", {"type": "highlight", "attrs": {"color": "x\" style=\"position:fixed"}}),
        t("link", {"type": "link", "attrs": {"href": "https://evil.example/go", "class": "uct-overlay modal-backdrop",
                                             "target": "_self", "rel": "opener", "title": "t"}}),
        t("js", {"type": "link", "attrs": {"href": "javascript:alert(1)"}}),
        t("good family", {"type": "textStyle", "attrs": {"fontFamily": "Georgia, serif", "fontSize": "18px"}}),
        t("good colour", {"type": "textColor", "attrs": {"color": "red"}}),
    )]}
    return {
        "_comment": "GENERATED by tests/test_notebook_fin_sec_public_attrs.py. `raw` is a hostile note as "
                    "stored; `share` and `publish` are what the server's reducer serves for it. Rendered by "
                    "app/src/pages/journal-2-0/public/ReadOnlyNote.hostile.test.jsx.",
        "raw": raw,
        "share": _reduce(raw, "share"),
        "publish": _reduce(raw, "publish"),
    }


def test_the_fixture_the_client_renders_is_the_reducers_current_output():
    now = json.dumps(_fixture_now(), indent=1, sort_keys=True) + "\n"
    if not FIXTURE.exists() or FIXTURE.read_text(encoding="utf-8").replace("\r\n", "\n") != now:
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        with open(FIXTURE, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(now)
        pytest.fail(f"{FIXTURE.name} was out of date and has been rewritten from the reducer's current "
                    "output. Read the diff, commit it, and run the client test that renders it.")
    data = json.loads(now)
    for mode in MODES:
        for fragment in ("position", "url(", "evil.example/p", "uct-overlay", "_self", "opener", "javascript"):
            _assert_clean(data[mode], fragment, f"the {mode} fixture")
        flat = json.dumps(data[mode])
        assert "Georgia, serif" in flat and "18px" in flat and "https://evil.example/go" in flat
