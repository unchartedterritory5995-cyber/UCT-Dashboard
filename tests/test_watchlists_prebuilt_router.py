"""The prebuilt endpoint tags dated lists (the Sunday Scans archive) with their
issue date and orders them newest-first inside their section — the picker
would otherwise re-sort them A→Z (April < August < July)."""
from __future__ import annotations

import json


class _Req:
    """The slice of `Request` the route reads — a conditional-GET header lookup."""

    def __init__(self, headers=None):
        self.headers = headers or {}


def _body(resp):
    return json.loads(resp.body)


def test_prebuilt_rows_carry_issue_date_and_order_newest_first_within_the_section(monkeypatch):
    from api.routers import watchlists as r
    from api.services import watchlist_service as wl
    from api.services import watchlist_prebuilt as wp

    def row(name, wid):
        return {"id": wid, "name": name, "items": [], "user_id": "admin"}

    rows = [
        row("Sunday Scans — August 2, 2026", "a2"),
        row("Sunday Scans — August 16, 2026", "a16"),
        row("Liquid Major ETFs", "liq"),
        row("Sunday Scans — August 9, 2026", "a9"),
        row("Bull & Bear ETFs", "bb"),
        # An UNDATED list in the same section as the dated archive: it must sort
        # AFTER every dated row, by name — never interleave with the issues.
        row("Community Picks", "cp"),
    ]
    monkeypatch.setattr(wl, "list_prebuilt_watchlists",
                        lambda limit=1000, include_items=True: rows)
    monkeypatch.setattr(wp, "category_map", lambda: {
        "sunday scans — august 2, 2026": "UCT Community",
        "sunday scans — august 16, 2026": "UCT Community",
        "sunday scans — august 9, 2026": "UCT Community",
        "liquid major etfs": "UCT ETF Lists",
        "bull & bear etfs": "UCT ETF Lists",
        "community picks": "UCT Community",
    })
    monkeypatch.setattr(wp, "category_order", lambda: ["UCT ETF Lists", "UCT Community"])
    monkeypatch.setattr(wp, "alias_map", lambda: {
        "sunday scans — august 16, 2026": {"alias": "sunday-scans-latest",
                                            "label": "Sunday Scans — Latest issue"},
    })
    monkeypatch.setattr(wp, "issue_date_map", lambda: {
        "sunday scans — august 2, 2026": "2026-08-02",
        "sunday scans — august 16, 2026": "2026-08-16",
        "sunday scans — august 9, 2026": "2026-08-09",
    })

    out = _body(r.list_prebuilt(_Req(), user={"id": "u", "role": "member"}))
    assert [o["id"] for o in out] == ["bb", "liq", "a16", "a9", "a2", "cp"]
    assert out[2]["issue_date"] == "2026-08-16"
    assert out[4]["issue_date"] == "2026-08-02"
    assert "issue_date" not in out[0] and "issue_date" not in out[5]   # undated rows carry no key
    # The newest issue ALSO answers to a stable alias; no other row does.
    assert out[2]["alias"] == "sunday-scans-latest" and out[2]["alias_label"] == "Sunday Scans — Latest issue"
    assert all("alias" not in o for o in out if o["id"] != "a16")


# ── The directory/membership split (2026-09-20) ──────────────────────────────
#
# Measured before the split: `GET /api/watchlists/prebuilt` answered with 33 lists
# carrying 4,704 item rows / 607,445 bytes, to render a picker of 33 NAMES, and the
# same request ranged 172 ms warm to 9,859 ms cold on prod. The picker reads `name`,
# `item_count`, `category`, `issue_date` and `alias` — never `items`.


def _fake_service(monkeypatch, rows, seen):
    from api.services import watchlist_service as wl
    from api.services import watchlist_prebuilt as wp

    def fake(limit=1000, include_items=True):
        seen["include_items"] = include_items
        if include_items:
            return [{**r, "items": [{"sym": "AAA"}], "item_count": 1} for r in rows]
        return [{**r, "item_count": 1} for r in rows]

    monkeypatch.setattr(wl, "list_prebuilt_watchlists", fake)
    for name, val in (("category_map", {}), ("issue_date_map", {}), ("alias_map", {})):
        monkeypatch.setattr(wp, name, lambda v=val: v)
    monkeypatch.setattr(wp, "category_order", lambda: [])


def test_include_items_is_forwarded_to_the_service_not_merely_accepted(monkeypatch):
    """The trap `list_user_watchlists` documents: a slim mode the route never passes
    on is built, green and unreachable. Assert the flag reaches the service."""
    from api.routers import watchlists as r

    rows = [{"id": "x", "name": "Russell 2000", "user_id": "admin"}]
    seen = {}
    _fake_service(monkeypatch, rows, seen)

    out = _body(r.list_prebuilt(_Req(), include_items=False, user={"id": "u"}))
    assert seen["include_items"] is False
    assert "items" not in out[0], "the directory must not carry membership"
    assert out[0]["item_count"] == 1, "the count survives the slim mode"

    out = _body(r.list_prebuilt(_Req(), user={"id": "u"}))
    assert seen["include_items"] is True, "the default stays byte-identical for old callers"
    assert out[0]["items"] == [{"sym": "AAA"}]


def test_directory_is_privately_cacheable_and_answers_304(monkeypatch):
    from api.routers import watchlists as r

    seen = {}
    _fake_service(monkeypatch, [{"id": "x", "name": "N", "user_id": "admin"}], seen)

    first = r.list_prebuilt(_Req(), include_items=False, user={"id": "u"})
    etag = first.headers["etag"]
    # ⛔ `private`, never `public` — the response is cookie-authenticated and carries
    # per-row `owner_name`. A shared cache must never hold it.
    assert first.headers["cache-control"].startswith("private,")
    assert etag

    again = r.list_prebuilt(_Req({"if-none-match": etag}), include_items=False, user={"id": "u"})
    assert again.status_code == 304
    assert again.headers["etag"] == etag
