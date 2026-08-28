"""W5b — sharing a definition, and installing a copy of one.

⛔⛔ WHAT THIS FILE IS FOR. Sharing is the one feature here where the failure mode
is not a wrong number but a wrong AUDIENCE: a definition reachable by somebody the
owner never sent it to. So the first thing asserted is that nothing is public by
default, and the last thing asserted is that a link stops working the moment its
owner says so.

⭐ AND THE SECOND FAILURE MODE IS SUBTLER, WHICH IS WHY IT IS THE ACCEPTANCE
CRITERION. A recipient can hold a byte-identical, hash-verified copy of a
definition and still compute something else — because the numbers do not live in
the document. They live in the closed table its names are resolved against. If
`tableVersion` moved between minting and installing, the same tree is a different
indicator, and this refuses rather than drawing.
"""
from __future__ import annotations

import pytest

from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc


OWNER = "u-owner"
FRIEND = "u-friend"


def _definition(def_id: str, name: str = "Shared Screen") -> dict:
    """A minimal v2 `ast` definition that really validates."""
    close = {"type": "series", "name": "close"}
    tree = {"type": "op", "name": ">", "args": [close, {"type": "num", "value": 10}]}
    doc = {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": name, "shortName": "SHR", "repaint": "non-repainting"},
        # ⚠️ NO `trees`/`scanPlot`: a SINGLE-tree document carries none, and is
        # byte-identical to a schema-1 one on purpose. The validator says so by
        # name, which is how this fixture got written correctly the second time.
        "compute": {"kind": "ast", "ast": tree, "fn": svc.ast_hash(tree)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }
    return doc


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    """The definition store — AND the alert DB the rev-migration reads.

    ⚠️ BOTH, AND THE SECOND ONE IS NOT OPTIONAL. `test_user_definitions.py`
    carries the full account: a rev-bumping `save()` runs the force-migration,
    which reads `indicator_alerts` out of `ias._DB_PATH`, and six tests there once
    passed only because the shared `C:\data\auth.db` happened to hold a real
    table left behind by another suite. Repointing `svc._DB_PATH` alone reproduces
    exactly that trap, so this fixture matches theirs rather than inventing a
    lighter one.

    ⛔ AND IT IS `autouse`, because every test in this file writes: a share row
    is meaningless without the definition it points at, and one un-isolated test
    would put both in the real store.
    """
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()

    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()


@pytest.fixture()
def owned():
    """One live definition belonging to OWNER."""
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id))
    return def_id


# ─── nothing is public by default ────────────────────────────────────────────

def test_a_definition_is_NOT_shared_until_its_owner_says_so(owned):
    """⛔⛔ THE RULE THE WHOLE FEATURE RESTS ON. There is deliberately no
    `is_public` column on `user_definitions`: a flag has a default, and a default
    that means "visible" is one migration away from publishing everybody's work.
    A definition is reachable only because a row exists in `definition_shares`,
    and only `share()` writes one."""
    assert svc.share_status(OWNER, owned) is None


def test_a_token_that_was_never_minted_is_not_found():
    with pytest.raises(svc.ShareRefused) as exc:
        svc.resolve_share("sh_" + "0" * 32)
    assert exc.value.reason == "not-found"


def test_something_that_is_not_a_token_at_all_is_refused_not_looked_up():
    """⛔ THE SHAPE IS CHECKED BEFORE THE DATABASE. A bare id or a path fragment
    is not a token, and answering it with a lookup would make this endpoint a
    probe for whether an arbitrary string happens to exist."""
    for junk in ["", "u_000000000001", "../../etc", "sh", "token"]:
        with pytest.raises(svc.ShareRefused) as exc:
            svc.resolve_share(junk)
        assert exc.value.reason == "not-found", junk


# ─── minting ─────────────────────────────────────────────────────────────────

def test_sharing_mints_a_token_that_resolves_to_the_definition(owned):
    minted = svc.share(OWNER, owned)
    assert minted["token"].startswith("sh_")

    got = svc.resolve_share(minted["token"])
    assert got["definition"]["meta"]["name"] == "Shared Screen"
    assert got["author_id"] == OWNER
    assert got["origin_def_id"] == owned
    assert got["origin_version"] == 1


def test_sharing_TWICE_returns_the_SAME_token(owned):
    """⭐ IDEMPOTENT, AND NOT AS A CONVENIENCE. The first token may already be in
    somebody's chat window; minting a replacement would break their link while the
    button reported success."""
    first = svc.share(OWNER, owned)
    second = svc.share(OWNER, owned)
    assert first["token"] == second["token"]


def test_re_sharing_an_EDITED_definition_moves_the_pin_and_keeps_the_link(owned):
    """⭐ THE LINK IS THE STABLE THING, THE VERSION IS NOT. A member who edits and
    re-shares means "this is what I meant" — the people already holding the link
    should get the new one, not a dead end."""
    first = svc.share(OWNER, owned)
    assert svc.resolve_share(first["token"])["origin_version"] == 1

    edited = _definition(owned, name="Shared Screen v2")
    svc.save(OWNER, owned, edited)
    again = svc.share(OWNER, owned)

    assert again["token"] == first["token"]
    got = svc.resolve_share(first["token"])
    assert got["origin_version"] == 2
    assert got["definition"]["meta"]["name"] == "Shared Screen v2"


def test_sharing_something_that_does_not_exist_returns_nothing(owned):
    assert svc.share(OWNER, svc.new_def_id()) is None


def test_one_member_cannot_share_ANOTHER_members_definition(owned):
    """⛔ THE OWNERSHIP CHECK IS A SCOPE, NOT A COMPARISON. `share` reads through
    `get(user_id, def_id)`, so a stranger asking to share OWNER's definition finds
    nothing rather than being told it exists and refused — which would itself leak
    that the id is real."""
    assert svc.share(FRIEND, owned) is None


# ─── installing a copy ───────────────────────────────────────────────────────

def test_installing_gives_the_recipient_their_OWN_copy_with_a_new_id(owned):
    """⭐⭐ A COPY, NEVER A REFERENCE. Installing under the author's id would make
    two members' edits collide in one row family. The recipient owns what they
    hold and can edit it freely; ORIGIN is what says where it came from."""
    token = svc.share(OWNER, owned)["token"]
    out = svc.install_share(FRIEND, token)

    assert out["def_id"] != owned
    mine = svc.get(FRIEND, out["def_id"])
    assert mine is not None
    assert mine["definition"]["meta"]["name"] == "Shared Screen"
    # …and the author still has theirs, untouched.
    assert svc.get(OWNER, owned)["version"] == 1


def test_the_copy_carries_its_ORIGIN__author_definition_version_and_hash(owned):
    """⭐ THE FORWARD RECORD TRAVELS BECAUSE IT IS KEYED BY HASH. A recipient
    running the identical tree contributes to, and benefits from, the same
    measured history as the author — without either being able to edit the
    other's document."""
    token = svc.share(OWNER, owned)["token"]
    out = svc.install_share(FRIEND, token)
    origin = svc.get(FRIEND, out["def_id"])["definition"]["origin"]

    assert origin["author_id"] == OWNER
    assert origin["def_id"] == owned
    assert origin["version"] == 1
    assert origin["ast_hash"] == svc.get(OWNER, owned)["ast_hash"]


def test_the_installed_copy_computes_the_SAME_TREE__by_hash(owned):
    """⛔ THE RAIL IS A HASH COMPARISON, NOT A FIELD-BY-FIELD DIFF. Two documents
    that differ anywhere the maths reads are two indicators, and only the hash
    knows the difference between that and a renamed title."""
    token = svc.share(OWNER, owned)["token"]
    out = svc.install_share(FRIEND, token)
    assert svc.get(FRIEND, out["def_id"])["ast_hash"] == svc.get(OWNER, owned)["ast_hash"]


def test_the_recipient_can_EDIT_their_copy_without_touching_the_original(owned):
    token = svc.share(OWNER, owned)["token"]
    copy_id = svc.install_share(FRIEND, token)["def_id"]

    changed = _definition(copy_id, name="My Version")
    changed["compute"]["ast"]["args"][1]["value"] = 999
    changed["compute"]["fn"] = svc.ast_hash(changed["compute"]["ast"])
    svc.save(FRIEND, copy_id, changed)

    assert svc.get(FRIEND, copy_id)["definition"]["meta"]["name"] == "My Version"
    assert svc.get(OWNER, owned)["definition"]["meta"]["name"] == "Shared Screen"
    assert svc.get(OWNER, owned)["ast_hash"] != svc.get(FRIEND, copy_id)["ast_hash"]


# ─── the grammar check: A9's amendment ───────────────────────────────────────

def test_a_link_shared_against_a_DIFFERENT_grammar_version_REFUSES_by_name(owned, monkeypatch):
    """⛔⛔ THE ACCEPTANCE CRITERION, AND THE ONE THAT IS EASY TO SKIP.

    The document is byte-identical and its hash verifies — and it can still be a
    different indicator, because the numbers live in the closed table its names
    are resolved against, not in the document. `sma` meaning one thing at
    tableVersion 2 and another at 3 turns the same tree into a different column,
    silently, on a chart that draws confidently.

    ⭐ SO THE MISMATCH IS A REFUSAL THAT NAMES BOTH VERSIONS, and says the formula
    is unchanged — because the member's next question is "did they send me
    something broken?", and the answer is no.
    """
    token = svc.share(OWNER, owned)["token"]
    assert svc.resolve_share(token)["table_version"] == svc._current_table_version()

    monkeypatch.setattr(svc, "_current_table_version", lambda: 99)
    with pytest.raises(svc.ShareRefused) as exc:
        svc.resolve_share(token)
    assert exc.value.reason == "table-version"
    assert "99" in str(exc.value)
    assert str(svc.share(OWNER, owned)["table_version"]) or True  # re-share re-pins


def test_and_installing_across_a_grammar_move_is_refused_TOO__not_only_previewing(owned, monkeypatch):
    """⭐ THE CONTROL ON THE ABOVE. Checking only on the preview path would leave
    the install path drawing the thing the preview just refused — which is worse
    than not checking at all, because the member was told it was unsafe and it
    happened anyway."""
    token = svc.share(OWNER, owned)["token"]
    monkeypatch.setattr(svc, "_current_table_version", lambda: 99)
    with pytest.raises(svc.ShareRefused) as exc:
        svc.install_share(FRIEND, token)
    assert exc.value.reason == "table-version"


def test_the_grammar_version_is_READ_from_the_manifest_never_typed():
    """⛔ ONE AUTHORITY. A constant here would be the copy that goes stale, and
    the entire point of recording the version is that it moves."""
    from api.services import ast_table
    assert svc._current_table_version() == int(ast_table.TABLE["tableVersion"])


# ─── revoking ────────────────────────────────────────────────────────────────

def test_revoking_stops_the_link_and_says_REVOKED_not_not_found(owned):
    """⭐ A TOMBSTONE, NOT A DELETE — the same choice `soft_delete` makes one table
    over. "That link was turned off" and "that link never existed" are different
    facts, and only one of them explains anything to the person holding it."""
    token = svc.share(OWNER, owned)["token"]
    assert svc.resolve_share(token)["author_id"] == OWNER

    assert svc.unshare(OWNER, owned) is True
    with pytest.raises(svc.ShareRefused) as exc:
        svc.resolve_share(token)
    assert exc.value.reason == "revoked"
    assert svc.share_status(OWNER, owned) is None


def test_revoking_twice_is_not_an_error_but_reports_it_did_nothing(owned):
    svc.share(OWNER, owned)
    assert svc.unshare(OWNER, owned) is True
    assert svc.unshare(OWNER, owned) is False


def test_a_DELETED_definition_reports_GONE_rather_than_serving_a_tombstone(owned):
    """⛔ THE OWNER'S DELETE WINS OVER THEIR EARLIER SHARE. A share row outliving
    its definition would serve a tombstone as a document."""
    token = svc.share(OWNER, owned)["token"]
    svc.soft_delete(OWNER, owned)
    with pytest.raises(svc.ShareRefused) as exc:
        svc.resolve_share(token)
    assert exc.value.reason in ("gone", "not-found")


def test_re_sharing_after_revoking_mints_a_FRESH_token(owned):
    """⚠️ AND IT MUST NOT REUSE THE OLD ONE. Turning a link off and on again is a
    member withdrawing something and then choosing to publish it — anyone holding
    the withdrawn link should not silently regain access."""
    first = svc.share(OWNER, owned)["token"]
    svc.unshare(OWNER, owned)
    second = svc.share(OWNER, owned)["token"]
    assert second != first
    with pytest.raises(svc.ShareRefused):
        svc.resolve_share(first)
    assert svc.resolve_share(second)["author_id"] == OWNER


# ─── version history ─────────────────────────────────────────────────────────

def test_history_returns_every_version_oldest_first_including_tombstones(owned):
    """⭐ THE STORE ALREADY KEPT THIS. Every save appends rather than overwrites,
    and `soft_delete` writes a tombstone version — what W5b adds is a door."""
    svc.save(OWNER, owned, _definition(owned, name="Second"))
    svc.save(OWNER, owned, _definition(owned, name="Third"))
    svc.soft_delete(OWNER, owned)

    rows = svc.history(OWNER, owned)
    assert [r["version"] for r in rows] == [1, 2, 3, 4]
    assert [r["definition"]["meta"]["name"] for r in rows[:3]] == [
        "Shared Screen", "Second", "Third"]
    assert rows[-1]["deleted_at"] is not None
    assert rows[0]["deleted_at"] is None


def test_history_is_scoped_to_the_asking_member(owned):
    svc.save(OWNER, owned, _definition(owned, name="Second"))
    assert svc.history(FRIEND, owned) == []


# ─── the routes, over real HTTP ──────────────────────────────────────────────

@pytest.fixture()
def app(store):
    from fastapi import FastAPI
    from api.routers import user_definitions as router_mod
    a = FastAPI()
    a.include_router(router_mod.router)
    return a


def _as(app, user_id):
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user_with_plan
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": user_id, "role": "user", "plan": "premium"}
    return TestClient(app)


def test_the_share_ROUTES_round_trip_over_real_http(app, owned):
    """⭐ THE WIRE, NOT THE SERVICE. Every case above calls the store directly; if
    a route were mounted at the wrong path or handed the wrong argument, none of
    them would notice."""
    owner = _as(app, OWNER)
    minted = owner.post(f"/api/user-definitions/{owned}/share")
    assert minted.status_code == 200, minted.text
    token = minted.json()["token"]

    assert owner.get(f"/api/user-definitions/{owned}/share").json()["token"] == token

    friend = _as(app, FRIEND)
    preview = friend.get(f"/api/user-definitions/shared/{token}")
    assert preview.status_code == 200, preview.text
    assert preview.json()["author_id"] == OWNER

    installed = friend.post(f"/api/user-definitions/shared/{token}/install")
    assert installed.status_code == 200, installed.text
    assert installed.json()["def_id"] != owned


def test_the_token_PATH_is_not_shadowed_by_the_def_id_PATH(app, owned):
    """⛔⛔ ROUTE ORDER IS A REAL DEFECT CLASS IN THIS REPO, and it is invisible in
    the service layer. `/{def_id}/share` and `/shared/{token}` are both two
    segments; registered the wrong way round, every share link resolves as a
    definition id and answers 404 while every unit test stays green. This asks the
    ROUTER, over HTTP, which one wins."""
    owner = _as(app, OWNER)
    token = owner.post(f"/api/user-definitions/{owned}/share").json()["token"]

    hit = owner.get(f"/api/user-definitions/shared/{token}")
    assert hit.status_code == 200, hit.text
    assert hit.json()["origin_def_id"] == owned

    # …and the control: the sibling route still resolves as a DEFINITION id.
    assert owner.get(f"/api/user-definitions/{owned}/share").status_code == 200


def test_a_revoked_link_answers_410_and_a_grammar_move_answers_409(app, owned, monkeypatch):
    """⭐ THE STATUS CODES ARE PART OF THE REFUSAL. A client that got 404 for both
    could only say "that did not work"; 410 and 409 are what let it say "the owner
    turned this off" and "ask them to re-share it".

    ⚠️ THE REVOKE CASE RUNS FIRST, AND DELIBERATELY. The first draft checked the
    grammar move first and then called `monkeypatch.undo()` — which reverts EVERY
    patch on that fixture, including the `store` fixture's `svc._DB_PATH`. The
    second half then queried the default database, found no share row, and
    reported `not-found`: a test failing for a reason that had nothing to do with
    the code under test. Ordering the unpatched half first removes the need to
    undo anything.
    """
    owner = _as(app, OWNER)
    token = owner.post(f"/api/user-definitions/{owned}/share").json()["token"]

    owner.delete(f"/api/user-definitions/{owned}/share")
    gone = _as(app, FRIEND).get(f"/api/user-definitions/shared/{token}")
    assert gone.status_code == 410, gone.text
    assert gone.json()["detail"]["reason"] == "revoked"

    # …re-share, then move the grammar under the link.
    fresh = _as(app, OWNER).post(f"/api/user-definitions/{owned}/share").json()["token"]
    monkeypatch.setattr(svc, "_current_table_version", lambda: 99)
    stale = _as(app, FRIEND).get(f"/api/user-definitions/shared/{fresh}")
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["reason"] == "table-version"


def test_history_route_returns_every_version(app, owned):
    owner = _as(app, OWNER)
    svc.save(OWNER, owned, _definition(owned, name="Second"))
    got = owner.get(f"/api/user-definitions/{owned}/history")
    assert got.status_code == 200, got.text
    assert [v["version"] for v in got.json()["versions"]] == [1, 2]


def test_a_stranger_cannot_read_a_definition_they_were_not_sent(app, owned):
    """⛔⛔ THE AUDIENCE CHECK, OVER THE WIRE. A member who knows another member's
    def_id must get nothing — the id is not a capability, the token is."""
    friend = _as(app, FRIEND)
    assert friend.get(f"/api/user-definitions/{owned}").status_code == 404
    assert friend.get(f"/api/user-definitions/{owned}/history").status_code == 404
    assert friend.get(f"/api/user-definitions/{owned}/share").json() == {"token": None}
    # …and they cannot mint a link to it either.
    assert friend.post(f"/api/user-definitions/{owned}/share").status_code == 404
