"""Tests for the engine's `list_present_refs` hook (Task 4, msgraph wave) —
`engine.py::_do_sync`'s `index_refs` wiring.

Mirrors the EXACT seam `list_deleted` already uses (Task 11 MUST-RESOLVE #4,
proven in `test_note_connectors_engine.py`): `getattr(provider,
"list_present_refs", None)`, full-pass-only, catch-and-fall-back-with-a-
named-`item_failures`-entry, never aborts the sync.

Purpose of the hook: a provider whose full ENUMERATION is cheap but whose
content FETCH is expensive (OneNote, Task 6) can let `list_changed` return
only a bounded content-fetch drain while `list_present_refs` still returns
the COMPLETE current remote set. Delete detection and `_touch_remote_index`
must see the COMPLETE set (so a present-but-not-yet-fetched item is never
mistaken for a deleted one), while `_fetch_remote_notes` still only fetches
the bounded `list_changed` refs.

Uses a minimal file-local `FakeProvider` (mirrors
`test_note_connectors_engine_oauth_refresh.py`'s own pattern of a
self-contained fake rather than importing the fuller one from
`test_note_connectors_engine.py`) — this suite is entirely about the
`index_refs` wiring, not general sync mechanics. `list_present_refs` is
attached to a provider instance dynamically, per-test (never a class
method), so `getattr(provider, "list_present_refs", None)` genuinely reads
`None` for the providers that don't opt in — same pattern the wave-1 suite
uses for `list_deleted`.

Required cases (task brief):
  1. Full pass, hook present: delete detection runs over the COMPLETE set —
     an id absent from the complete set for 2 consecutive full passes
     severs; a present-but-unfetched id (in `list_present_refs`, not in the
     bounded `list_changed`) is touched, its miss_streak reset, and is NOT
     severed. `_fetch_remote_notes` is called only for the bounded
     `list_changed` refs.
  2. A raising `list_present_refs` falls back to refs-drive-everything
     (today's behavior) with a named `item_failures` entry; the sync does
     not abort.
  3. MUTATION CHECK: with the hook absent, a bounded (OneNote-shaped)
     `list_changed` drain over previously-tracked items trips the wave-1
     <50% refuse guard even though nothing was actually deleted remotely;
     with the SAME bounded drain and the hook wired (returning the complete,
     unchanged remote set), the guard does not refuse. Same starting state,
     same bounded drain — the only variable is hook presence — proving the
     hook is what makes a bounded-drain full pass correct.
  4. CONTROL: a provider without `list_present_refs` behaves byte-for-byte
     like wave-1 (mirrors `test_delete_detection_needs_two_consecutive_
     full_misses` in `test_note_connectors_engine.py`) — this would fail if
     the no-hook path (`index_refs` defaulting to `refs`) were changed.
"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine, errors
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo, NoteProvider, RemoteNote, RemoteRef,
)

T1 = "2026-08-01T00:00:00+00:00"
T2 = "2026-08-02T00:00:00+00:00"


# ---------------------------------------------------------------------------
# Fixtures — mirrors test_note_connectors_engine.py's own `db` fixture
# exactly (isolated tmp DB, resolved live via auth_db.get_connection()).
# ---------------------------------------------------------------------------

@pytest.fixture
def db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    import api.services.journal_two.note_connectors.connections as conns
    return conns


class FakeProvider(NoteProvider):
    """Minimal in-memory provider for this suite. `list_present_refs` is
    deliberately NOT a class method — tests that need it attach it to the
    instance directly (`provider.list_present_refs = ...`), mirroring how
    the wave-1 suite attaches `list_deleted`, so a control test can assert
    `getattr(provider, "list_present_refs", None) is None` for a provider
    that never opts in."""

    name = "fake"

    def __init__(self) -> None:
        self.list_changed_refs: list[RemoteRef] = []
        self.notes_by_id: dict[str, RemoteNote] = {}
        self.fetch_many_calls: list[list[str]] = []
        # Every cursor value `list_changed` was actually called with, in
        # order -- mirrors `test_note_connectors_engine.py`'s own
        # `FakeProvider.list_changed_calls` field exactly, added here for
        # fix-round-1's cursor-reset-gating test below (this file previously
        # never needed to inspect what cursor the engine passed through).
        self.list_changed_calls: list[str | None] = []
        self._enumerated = False

    async def validate(self, credentials):
        return AccountInfo(label="fake")

    async def list_changed(self, credentials, cursor=None):
        self._enumerated = True
        self.list_changed_calls.append(cursor)
        return list(self.list_changed_refs)

    async def fetch(self, credentials, ref):
        if not self._enumerated:
            raise RuntimeError("fetch called before list_changed")
        return self.notes_by_id[ref.remote_id]

    async def fetch_many(self, credentials, refs):
        if not self._enumerated:
            raise RuntimeError("fetch_many called before list_changed")
        self.fetch_many_calls.append([r.remote_id for r in refs])
        return [self.notes_by_id[r.remote_id] for r in refs]

    async def fetch_media(self, credentials, ref):
        raise AssertionError("not used in this suite")


def _doc(text: str) -> dict:
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def _rn(remote_id, title, *, updated_at=T1) -> RemoteNote:
    return RemoteNote(
        remote_id=remote_id, title=title, doc=_doc(title),
        media=[], links=[], tags=[], folder_path=[],
        created_at=T1, updated_at=updated_at,
    )


@pytest.fixture
def provider(monkeypatch):
    p = FakeProvider()
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    return p


@pytest.fixture
def source(db, provider):
    db.upsert_connector("u1", "fake", {"token": "abc"})
    return db.create_source("u1", "fake", "fake-graph")


def _remote_index_rows(source_id: str) -> list[dict]:
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_remote_index WHERE source_id = ?", (source_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 1. Complete-set delete detection + touch, bounded-drain fetch.
# ---------------------------------------------------------------------------

async def test_full_pass_with_hook_uses_complete_set_for_delete_detection_and_touch(source, provider):
    refs_all = [RemoteRef(remote_id=f"p{i}", updated_at=T1) for i in (1, 2, 3, 4)]
    provider.notes_by_id = {r.remote_id: _rn(r.remote_id, f"Note {r.remote_id}") for r in refs_all}
    provider.list_changed_refs = refs_all

    result1 = await engine.sync_source(source["id"], full=True)
    assert result1["status"] == "ok"
    assert {r["remote_id"] for r in _remote_index_rows(source["id"])} == {"p1", "p2", "p3", "p4"}

    # Round 2: the bounded content-fetch drain (list_changed) only re-visits
    # p1 -- an expensive-fetch budget, not a full listing. The COMPLETE
    # present set (list_present_refs) still contains p1, p2, p4; p3 has
    # genuinely vanished from the remote.
    provider.fetch_many_calls = []  # isolate round 2's fetch calls from round 1's
    provider.list_changed_refs = [RemoteRef(remote_id="p1", updated_at=T2)]
    complete_round2 = [
        RemoteRef(remote_id="p1", updated_at=T2),
        RemoteRef(remote_id="p2", updated_at=T1),
        RemoteRef(remote_id="p4", updated_at=T1),
    ]

    async def _present2(credentials):
        return complete_round2

    provider.list_present_refs = _present2

    result2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert result2["status"] == "ok"

    # _fetch_remote_notes must only fetch the BOUNDED list_changed refs.
    fetched = {rid for call in provider.fetch_many_calls for rid in call}
    assert fetched == {"p1"}

    idx = {r["remote_id"]: r for r in _remote_index_rows(source["id"])}
    assert set(idx) == {"p1", "p2", "p3", "p4"}  # p3 not yet severed -- 1st miss
    assert idx["p1"]["miss_streak"] == 0
    # present-but-unfetched -- still touched by the complete set, reset.
    assert idx["p2"]["miss_streak"] == 0
    assert idx["p4"]["miss_streak"] == 0
    assert idx["p3"]["miss_streak"] == 1

    p3_note = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Note p3")
    assert "source-deleted" not in p3_note["tags"]

    # Round 3: p3 still absent from the complete present set -> 2nd
    # consecutive miss -> severed. p1/p2/p4 keep being reported present.
    provider.list_changed_refs = []
    complete_round3 = complete_round2

    async def _present3(credentials):
        return complete_round3

    provider.list_present_refs = _present3

    result3 = await engine.sync_source(source["id"], full=True, manual=True)
    assert result3["status"] == "ok"
    assert result3["sourceDeleted"] == 1

    idx = {r["remote_id"]: r for r in _remote_index_rows(source["id"])}
    assert "p3" not in idx
    assert set(idx) == {"p1", "p2", "p4"}
    p3_note = next(n for n in notes_svc.list_notes("u1") if n["title"] == "Note p3")
    assert "source-deleted" in p3_note["tags"]


# ---------------------------------------------------------------------------
# 2. A raising hook falls back to refs-drive-everything + a named failure.
# ---------------------------------------------------------------------------

async def test_raising_list_present_refs_falls_back_to_refs_with_named_failure(source, provider):
    provider.list_changed_refs = [
        RemoteRef(remote_id="p1", updated_at=T1),
        RemoteRef(remote_id="p2", updated_at=T1),
    ]
    provider.notes_by_id = {"p1": _rn("p1", "Keeper"), "p2": _rn("p2", "AlsoThere")}
    await engine.sync_source(source["id"], full=True)
    assert {r["remote_id"] for r in _remote_index_rows(source["id"])} == {"p1", "p2"}

    # Round 2: the hook raises -- must fall back to the bounded list_changed
    # driving BOTH delete detection and remote_index, exactly like a
    # provider without the hook at all.
    provider.list_changed_refs = [RemoteRef(remote_id="p1", updated_at=T2)]

    async def _boom(credentials):
        raise errors.NoteConnTransient("OneNote delta enumeration rate limited")

    provider.list_present_refs = _boom

    result = await engine.sync_source(source["id"], full=True, manual=True)
    assert result["status"] == "ok"  # never aborts
    assert any("list_present_refs sweep failed" in f for f in result["failures"])

    idx = {r["remote_id"]: r for r in _remote_index_rows(source["id"])}
    assert idx["p1"]["miss_streak"] == 0
    assert idx["p2"]["miss_streak"] == 1  # fell out of the (now sole) signal


# ---------------------------------------------------------------------------
# 3. MUTATION CHECK — hook absence trips the <50% refuse guard on a bounded
#    drain that changed nothing remotely; hook presence does not.
# ---------------------------------------------------------------------------

async def test_mutation_check_hook_is_load_bearing_for_the_50pct_refuse_guard(source, provider):
    """Identical underlying remote state (nothing genuinely deleted),
    identical bounded list_changed drain in both branches -- the ONLY
    variable is whether list_present_refs is wired. Without it, the engine
    cannot distinguish "a content-fetch budget only reached 1 of 4 items"
    from "3 of 4 items vanished", so the wave-1 <50% refuse guard correctly
    goes blind. With it, the guard sees the true (unchanged) 4-of-4
    enumeration and proceeds normally. This is the proof the hook is
    load-bearing, not merely convenient."""
    refs_all = [RemoteRef(remote_id=f"p{i}", updated_at=T1) for i in range(4)]
    provider.notes_by_id = {r.remote_id: _rn(r.remote_id, f"Note {r.remote_id}") for r in refs_all}
    provider.list_changed_refs = refs_all
    await engine.sync_source(source["id"], full=True)
    assert len(_remote_index_rows(source["id"])) == 4

    # A OneNote-shaped bounded drain: content fetch only reaches 1 of 4 --
    # nothing has actually been deleted from the remote.
    bounded = [RemoteRef(remote_id="p0", updated_at=T2)]

    # WITHOUT the hook: index_refs falls back to the bounded drain alone.
    assert getattr(provider, "list_present_refs", None) is None
    provider.list_changed_refs = bounded
    result_without = await engine.sync_source(source["id"], full=True, manual=True)
    assert result_without["status"] == "warning"
    warning = result_without["deleteDetectionWarning"] or ""
    assert "50%" in warning or "known items" in warning
    assert result_without["sourceDeleted"] == 0
    assert len(_remote_index_rows(source["id"])) == 4  # nothing touched by the refused pass

    # WITH the hook: index_refs becomes the COMPLETE (unchanged) set -- same
    # bounded drain, same starting state, different outcome.
    async def _present(credentials):
        return refs_all

    provider.list_present_refs = _present
    provider.list_changed_refs = bounded
    result_with = await engine.sync_source(source["id"], full=True, manual=True)
    assert result_with["status"] == "ok"
    assert result_with["deleteDetectionWarning"] is None
    assert result_with["sourceDeleted"] == 0
    assert len(_remote_index_rows(source["id"])) == 4

    # The two outcomes differ in the expected direction on identical inputs.
    assert result_without["status"] != result_with["status"]


# ---------------------------------------------------------------------------
# 4. CONTROL — a provider without the hook is byte-for-byte wave-1.
# ---------------------------------------------------------------------------

async def test_control_provider_without_hook_matches_wave1_two_strike_behavior(source, provider):
    """Mirrors test_note_connectors_engine.py's own
    test_delete_detection_needs_two_consecutive_full_misses. This assertion
    would fail if the no-hook path (`index_refs` defaulting to `refs`) were
    ever changed by this task -- proving the existing four (Roam, Craft,
    Notion, Dropbox, OneDrive -- none define list_present_refs) are
    unaffected."""
    assert getattr(provider, "list_present_refs", None) is None
    refs = [
        RemoteRef(remote_id="a", updated_at=T1),
        RemoteRef(remote_id="b", updated_at=T1),
        RemoteRef(remote_id="c", updated_at=T1),
    ]
    provider.notes_by_id = {"a": _rn("a", "A"), "b": _rn("b", "B"), "c": _rn("c", "C")}
    provider.list_changed_refs = refs
    await engine.sync_source(source["id"], full=True)
    c_note_id = next(n["id"] for n in notes_svc.list_notes("u1") if n["title"] == "C")

    # Full sync #2: "c" is missing -> first miss, NOT deleted yet.
    provider.list_changed_refs = refs[:2]
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["status"] == "ok"
    idx_rows = {r["remote_id"]: r for r in _remote_index_rows(source["id"])}
    assert idx_rows["c"]["miss_streak"] == 1
    c_note = notes_svc.get_note("u1", c_note_id)
    assert "source-deleted" not in c_note["tags"]

    # Full sync #3: "c" STILL missing -> second consecutive miss -> severed.
    r3 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r3["status"] == "ok"
    idx_rows = {r["remote_id"]: r for r in _remote_index_rows(source["id"])}
    assert "c" not in idx_rows
    c_note = notes_svc.get_note("u1", c_note_id)
    assert "source-deleted" in c_note["tags"]
    assert notes_svc.get_note("u1", c_note_id) is not None  # never actually deleted


# ---------------------------------------------------------------------------
# 5. Fix-round-1 Important #1 (Finding B) — a full pass must NOT reset the
#    `list_changed` cursor to None for a provider that exposes
#    `list_present_refs`. Confirmed via `repro_fullpass.py` against the real
#    OneNoteProvider: incremental ticks reached watermark T99, then one
#    nightly full pass (which used to call `list_changed(cursor=None)`)
#    regressed the cursor to T39 — re-draining old content and, on a large
#    enough account, starving new edits forever. This suite proves the fix
#    at the ENGINE level (the layer that owns the cursor-reset decision)
#    using `FakeProvider.list_changed_calls`, which now records every
#    cursor value the engine actually passed through.
# ---------------------------------------------------------------------------

async def test_full_pass_does_not_regress_the_cursor_for_a_present_refs_provider(source, provider):
    """A OneNote-shaped provider: `list_changed` publishes a resumable
    opaque watermark on itself (mirrors OneDrive/OneNote's `opaque_cursor`
    convention) regardless of `full`. Round 1 (incremental) advances the
    stored cursor to a watermark; round 2 (a NIGHTLY FULL PASS, with
    `list_present_refs` wired) must hand that SAME stored watermark back to
    `list_changed` — never `None` — so the bounded drain continues forward
    instead of restarting from the epoch. `list_present_refs` independently
    supplies the complete set delete detection needs, so nothing about
    delete-detection correctness is traded away by keeping the cursor."""
    refs_all = [RemoteRef(remote_id=f"p{i}", updated_at=T1) for i in (1, 2, 3, 4)]
    provider.notes_by_id = {r.remote_id: _rn(r.remote_id, f"Note {r.remote_id}") for r in refs_all}

    # Round 1 -- incremental tick, no cursor stored yet (source is brand
    # new). The provider "reaches" watermark A this tick.
    provider.list_changed_refs = [refs_all[0]]
    provider.opaque_cursor = "onenote-watermark-A"
    r1 = await engine.sync_source(source["id"], full=False)
    assert r1["status"] == "ok"
    assert provider.list_changed_calls == [None]  # nothing stored yet -- correct either way
    got1 = engine.connections.get_source_by_id(source["id"])
    assert got1["cursor"] == "onenote-watermark-A"

    # Round 2 -- a NIGHTLY FULL PASS. `list_present_refs` is wired (the
    # engine's own signal that this provider owns a resumable, bounded
    # `list_changed` rather than needing a forced full re-list). The
    # provider "reaches" watermark B this tick, continuing PAST A.
    provider.list_changed_refs = [refs_all[1]]
    provider.opaque_cursor = "onenote-watermark-B"

    async def _present(credentials):
        return refs_all

    provider.list_present_refs = _present

    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["status"] == "ok"

    # THE FIX: the full pass must hand the STORED cursor (watermark A) back
    # to list_changed -- NOT None. A regression here reintroduces the
    # backward-cursor-jump `repro_fullpass.py` demonstrated against the
    # real provider.
    assert provider.list_changed_calls[-1] == "onenote-watermark-A"

    # The opaque cursor this tick's (bounded) list_changed produced still
    # persists unconditionally, exactly as before this fix -- advancing
    # forward to watermark B, never backward.
    got2 = engine.connections.get_source_by_id(source["id"])
    assert got2["cursor"] == "onenote-watermark-B"

    # And delete detection still saw the COMPLETE set via list_present_refs
    # on this same full pass -- the two concerns stayed independent.
    idx = {r["remote_id"]: r for r in _remote_index_rows(source["id"])}
    assert set(idx) == {"p1", "p2", "p3", "p4"}
    assert idx["p3"]["miss_streak"] == 0  # present via list_present_refs, not severed


async def test_full_pass_still_resets_cursor_to_none_without_the_hook_control(source, provider):
    """CONTROL, mirroring `test_control_provider_without_hook_matches_wave1_
    two_strike_behavior` above: a provider WITHOUT `list_present_refs`
    (Roam/Craft/Notion/Dropbox/OneDrive's own shape) must keep resetting to
    `None` on every full pass -- byte-identical to pre-fix behavior. This
    is what would fail if the cursor-reset gate were accidentally widened
    to apply to every provider instead of just present-refs-having ones."""
    assert getattr(provider, "list_present_refs", None) is None
    provider.notes_by_id = {"p1": _rn("p1", "P1")}
    provider.list_changed_refs = [RemoteRef(remote_id="p1", updated_at=T1)]

    r1 = await engine.sync_source(source["id"], full=False)
    assert r1["status"] == "ok"
    got1 = engine.connections.get_source_by_id(source["id"])
    assert got1["cursor"] == T1  # timestamp-mode cursor, derived from refs

    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["status"] == "ok"
    assert provider.list_changed_calls[-1] is None  # full pass still resets -- unchanged
