"""The prebuilt endpoint tags dated lists (the Sunday Scans archive) with their
issue date and orders them newest-first inside their section — the picker
would otherwise re-sort them A→Z (April < August < July)."""
from __future__ import annotations


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
    monkeypatch.setattr(wl, "list_prebuilt_watchlists", lambda limit=1000: rows)
    monkeypatch.setattr(wp, "category_map", lambda: {
        "sunday scans — august 2, 2026": "UCT Community",
        "sunday scans — august 16, 2026": "UCT Community",
        "sunday scans — august 9, 2026": "UCT Community",
        "liquid major etfs": "UCT ETF Lists",
        "bull & bear etfs": "UCT ETF Lists",
        "community picks": "UCT Community",
    })
    monkeypatch.setattr(wp, "sample_map", lambda: {})
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

    out = r.list_prebuilt(user={"id": "u", "role": "member"})
    assert [o["id"] for o in out] == ["bb", "liq", "a16", "a9", "a2", "cp"]
    assert out[2]["issue_date"] == "2026-08-16"
    assert out[4]["issue_date"] == "2026-08-02"
    assert "issue_date" not in out[0] and "issue_date" not in out[5]   # undated rows carry no key
    # The newest issue ALSO answers to a stable alias; no other row does.
    assert out[2]["alias"] == "sunday-scans-latest" and out[2]["alias_label"] == "Sunday Scans — Latest issue"
    assert all("alias" not in o for o in out if o["id"] != "a16")
