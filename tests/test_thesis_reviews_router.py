"""Wave O — the review endpoints, end to end through the real app.

⛔ A SERVICE RAIL IS NOT A ROUTE RAIL. Wave L shipped a capability that was
correct, tested and reachable from no door; every wave since has paid for that
by proving the wire separately. These mount the real app and drive the real
HTTP surface.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services.journal_two import thesis_reviews as tr


@pytest.fixture()
def app():
    auth_db.init_db()
    from api.main import app as real
    return real


@pytest.fixture()
def client(app):
    return TestClient(app)


def _login(app, user_id: str):
    from api.routers.journal_two import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": user_id}
    return user_id


def _thesis(client) -> str:
    r = client.post("/api/j2/notes", json={
        "title": "NVDA thesis", "ticker": "NVDA", "tags": ["thesis"],
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    assert r.status_code == 200, r.text
    body = r.json()
    return (body.get("note") or body)["id"]


class TestTheDoorExists:
    def test_open_returns_a_draft(self, app, client):
        _login(app, f"u-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        r = client.post(f"/api/j2/notes/{nid}/reviews", json={})
        assert r.status_code == 200, r.text
        assert r.json()["review"]["status"] == tr.STATUS_DRAFT

    def test_opening_twice_resumes_the_same_draft(self, app, client):
        _login(app, f"u-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        a = client.post(f"/api/j2/notes/{nid}/reviews", json={}).json()["review"]
        b = client.post(f"/api/j2/notes/{nid}/reviews", json={}).json()["review"]
        assert a["id"] == b["id"]

    def test_the_full_loop_over_http(self, app, client):
        _login(app, f"u-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        rid = client.post(f"/api/j2/notes/{nid}/reviews", json={}).json()["review"]["id"]
        client.patch(f"/api/j2/reviews/{rid}", json={"memberNote": "still holds"})
        done = client.post(f"/api/j2/reviews/{rid}/complete", json={
            "outcome": "no_change", "nextReviewAt": "2026-06-01"}).json()["review"]
        assert done["status"] == tr.STATUS_COMPLETED
        assert done["memberNote"] == "still holds"
        assert done["nextReviewAt"] == "2026-06-01"
        hist = client.get(f"/api/j2/notes/{nid}/reviews").json()
        assert [h["id"] for h in hist["reviews"]] == [rid]

    def test_history_carries_the_attention_block(self, app, client):
        _login(app, f"u-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        body = client.get(f"/api/j2/notes/{nid}/reviews").json()
        assert body["attention"]["reasons"][0]["code"] == "never_reviewed"


class TestRefusals:
    def test_an_unknown_outcome_is_a_400_not_a_500(self, app, client):
        _login(app, f"u-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        rid = client.post(f"/api/j2/notes/{nid}/reviews", json={}).json()["review"]["id"]
        r = client.post(f"/api/j2/reviews/{rid}/complete",
                        json={"outcome": "84% conviction"})
        assert r.status_code == 400
        assert "outcome" in r.json()["detail"].lower()

    def test_a_completed_review_cannot_be_patched(self, app, client):
        _login(app, f"u-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        rid = client.post(f"/api/j2/notes/{nid}/reviews", json={}).json()["review"]["id"]
        client.post(f"/api/j2/reviews/{rid}/complete", json={"outcome": "no_change"})
        r = client.patch(f"/api/j2/reviews/{rid}", json={"memberNote": "rewrite"})
        assert r.status_code == 400

    def test_a_foreign_thesis_is_refused_without_confirming_it_exists(self, app, client):
        owner = _login(app, f"u-own-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        _login(app, f"u-other-{uuid.uuid4().hex[:8]}")
        r = client.post(f"/api/j2/notes/{nid}/reviews", json={})
        assert r.status_code == 400
        assert "not found" in r.json()["detail"].lower()
        assert owner not in r.text

    def test_a_foreign_review_id_cannot_be_completed(self, app, client):
        _login(app, f"u-own-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        rid = client.post(f"/api/j2/notes/{nid}/reviews", json={}).json()["review"]["id"]
        _login(app, f"u-other-{uuid.uuid4().hex[:8]}")
        r = client.post(f"/api/j2/reviews/{rid}/complete", json={"outcome": "no_change"})
        assert r.status_code == 400

    def test_listing_a_foreign_thesis_404s(self, app, client):
        _login(app, f"u-own-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        _login(app, f"u-other-{uuid.uuid4().hex[:8]}")
        assert client.get(f"/api/j2/notes/{nid}/reviews").status_code == 404


class TestTheRequestBodyCannotChangeTheThesis:
    def test_there_is_no_thesis_status_field_to_send(self, app, client):
        # ⛔⛔ §4. Even a hostile client cannot ask the review endpoint to set a
        # thesis status, because the endpoint reads no such field. This asserts
        # the ABSENCE of a lever, which is the only durable form of that
        # guarantee — a validation check could be relaxed later by accident.
        _login(app, f"u-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        rid = client.post(f"/api/j2/notes/{nid}/reviews", json={}).json()["review"]["id"]
        client.post(f"/api/j2/reviews/{rid}/complete", json={
            "outcome": "invalidated",
            "thesisStatus": "invalidated",
            "properties": {"builtin:thesis_status": "invalidated"}})
        note = client.get(f"/api/j2/notes/{nid}").json()
        props = (note.get("note") or note).get("propertiesJson") or {}
        assert props.get("builtin:thesis_status") != "invalidated"


# ── Wave O6: the search door ────────────────────────────────────────────────

class TestTheReviewSearchDoor:
    """A SERVICE RAIL IS NOT A ROUTE RAIL — and this route has a second way to
    be wrong that a service test cannot see: `GET /reviews/search` sits beside
    `/reviews/{review_id}`, and declared in the wrong order it would be matched
    as an id and 404 with every service test still green."""

    def test_the_route_is_reachable_and_finds_the_members_own_words(self, app, client):
        _login(app, f"u-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        rid = client.post(f"/api/j2/notes/{nid}/reviews", json={}).json()["review"]["id"]
        client.post(f"/api/j2/reviews/{rid}/complete", json={
            "outcome": "invalidated",
            "memberNote": "The kimberlite grades were the thing I got wrong."})
        r = client.get("/api/j2/reviews/search", params={"q": "kimberlite"})
        assert r.status_code == 200, r.text
        [hit] = r.json()["results"]
        assert hit["reviewId"] == rid
        assert hit["noteId"] == nid
        # ⛔ The DECISION travels with the prose. A result showing only what the
        # member wrote makes "I was wrong about this" and "no change" look like
        # the same kind of finding.
        assert hit["outcome"] == "invalidated"
        assert hit["completedAt"]
        assert "<mark>kimberlite</mark>" in hit["snippet"]

    def test_it_is_not_shadowed_by_the_parameterised_review_routes(self, app):
        # Declared BEFORE `/reviews/{review_id}`. Asserting the ORDER rather
        # than just the 200 above, because a future insertion is what breaks it.
        paths = [getattr(r, "path", "") for r in app.routes]
        assert paths.index("/api/j2/reviews/search") < paths.index(
            "/api/j2/reviews/{review_id}")

    def test_another_members_review_is_not_searchable(self, app, client):
        owner = _login(app, f"u-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        rid = client.post(f"/api/j2/notes/{nid}/reviews", json={}).json()["review"]["id"]
        client.post(f"/api/j2/reviews/{rid}/complete", json={
            "outcome": "no_change", "memberNote": "kimberlite grades held up"})
        _login(app, f"u-{uuid.uuid4().hex[:8]}")
        assert owner  # the first tenant is gone from the dependency override
        r = client.get("/api/j2/reviews/search", params={"q": "kimberlite"})
        assert r.status_code == 200
        assert r.json()["results"] == []

    def test_an_empty_query_is_an_empty_result_not_the_whole_history(self, app, client):
        _login(app, f"u-{uuid.uuid4().hex[:8]}")
        nid = _thesis(client)
        rid = client.post(f"/api/j2/notes/{nid}/reviews", json={}).json()["review"]["id"]
        client.post(f"/api/j2/reviews/{rid}/complete", json={
            "outcome": "no_change", "memberNote": "anything at all"})
        assert client.get("/api/j2/reviews/search").json()["results"] == []
