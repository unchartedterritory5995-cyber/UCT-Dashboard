"""Wave 7 lane H, fix round 1 -- review I-2 (and M-6): the meaning-index sweep
never holds auth.db's WRITE LOCK across a vendor call.

⚰️ THE DEFECT. `get_connection()` is Python's legacy implicit-BEGIN isolation,
so `index_member`'s `DELETE ... NOT IN json_each(?)` opened a write transaction
that stayed open through the first note's `provider.embed`, and a note with
more than one batch of blocks embedded its second batch after the first
batch's INSERT -- inside that note's transaction. The reviewer measured an
unrelated `UPDATE users` on auth.db failing after 619 ms with `database is
locked` (auth.db is the session + notes DB for every member; busy timeout 3 s).
The sweep is scheduled every 15 minutes, so this was live the moment the flag
was set.

THE RULE. Every vendor call runs with NO transaction open on the sweep's
connection; each note's writes are ONE short transaction, after its vectors
are in hand. The OpenAI provider sends one HTTP request per batch
(`input=[...]`), never one per block.

THE PROBE is the reviewer's measurement made deterministic: at the instant of
every vendor call, an unrelated writer on a SECOND connection takes the write
lock (`BEGIN IMMEDIATE`) with a short busy timeout. It runs on every call, so
a lock held at any one of them is caught -- and a CONTROL proves the probe
reports a lock when one IS held, so its silence means something.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import time
from types import SimpleNamespace

import pytest

from api.services.journal_two import note_semantic as ns

GATE = ns.SEMANTIC_GATE
U = "u-lock"


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    monkeypatch.setenv(GATE, "1")
    monkeypatch.setenv("NOTEBOOK_SEMANTIC_PROVIDER", "noop")
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def P(t):
    return {"type": "paragraph", "content": [{"type": "text", "text": t}]}


def _note(title, *paras):
    from api.services.journal_two import notes
    return notes.create_note(U, {"title": title, "bodyJson": {
        "type": "doc", "content": [P(t) for t in paras]}})


def _unrelated_write(path, timeout=0.2):
    """An unrelated writer on a SECOND connection: take auth.db's write lock,
    touch `users`, commit. None on success; the error text when locked out."""
    other = sqlite3.connect(path, timeout=timeout, isolation_level=None)
    try:
        other.execute("BEGIN IMMEDIATE")
        other.execute("UPDATE users SET display_name = display_name")
        other.execute("COMMIT")
        return None
    except sqlite3.OperationalError as e:
        return str(e)
    finally:
        other.close()


class _SlowProbeProvider(ns.NoOpEmbeddingProvider):
    """A slow vendor. At the instant of each call it runs the unrelated write
    (that is when a real request would be on the wire), then takes its time."""

    def __init__(self, path, sleep=0.02):
        self.path = path
        self.sleep = sleep
        self.calls: list[tuple[int, str | None]] = []

    def embed(self, texts, *, timeout=None):
        self.calls.append((len(texts), _unrelated_write(self.path)))
        time.sleep(self.sleep)
        return super().embed(texts)


def _locked(probe):
    return [c for c in probe.calls if c[1] is not None]


# ── the control: the probe CAN see a lock ─────────────────────────────────────

def test_CONTROL_the_probe_reports_a_lock_when_one_is_held(db_path):
    holder = sqlite3.connect(db_path, isolation_level=None)
    try:
        holder.execute("BEGIN IMMEDIATE")
        assert "locked" in (_unrelated_write(db_path) or ""), (
            "the probe cannot see a held write lock, so its silence proves nothing")
        holder.execute("ROLLBACK")
    finally:
        holder.close()
    assert _unrelated_write(db_path) is None      # and it passes when nothing is held


# ── the rule ──────────────────────────────────────────────────────────────────

def test_the_first_vendor_call_after_dropping_a_trashed_note_holds_no_lock(db_path):
    """The DELETE of dropped notes is where the transaction used to open."""
    from api.services.journal_two import notes
    keep = _note("Keep", "Alpha paragraph.")
    gone = _note("Gone", "Beta paragraph.")
    assert ns.index_member(U)["embedded"] == 4
    notes.delete_note(U, gone["id"])                                  # a row to DROP
    notes.update_note(U, keep["id"], {"bodyJson": {"type": "doc", "content": [
        P("Alpha paragraph."), P("Gamma paragraph.")]}})             # a block to EMBED
    probe = _SlowProbeProvider(db_path)
    r = ns.index_member(U, provider=probe)
    assert r["dropped"] >= 1 and probe.calls, "non-vacuity: nothing was dropped or embedded"
    assert _locked(probe) == [], (
        f"an unrelated writer was locked out of auth.db during a vendor call: {_locked(probe)}")


def test_no_batch_of_a_LONG_note_is_embedded_inside_that_notes_write(db_path):
    """More blocks than one batch: the second request must not run after the
    first batch's INSERT opened the note's transaction."""
    _note("Long", *[f"Paragraph number {i} about entries." for i in range(150)])
    probe = _SlowProbeProvider(db_path)
    r = ns.index_member(U, provider=probe)
    assert r["embedded"] == 151                                       # title + 150
    assert [n for n, _ in probe.calls] == [64, 64, 23], "one request per batch"
    assert _locked(probe) == [], f"locked out during batch {_locked(probe)}"


def test_the_scheduled_sweep_holds_no_lock_across_any_vendor_call(db_path):
    """The path the scheduler runs: several members, several notes each."""
    from api.services.journal_two import notes
    for i in range(3):
        notes.create_note(f"u{i}", {"title": f"Plan {i}", "bodyJson": {"type": "doc", "content": [
            P(f"Member {i} paragraph {j}.") for j in range(70)]}})
    probe = _SlowProbeProvider(db_path)
    total = ns.run_sweep(provider=probe)
    assert total["embedded"] == 3 * 71 and len(probe.calls) >= 6
    assert _locked(probe) == []


def test_the_vendor_door_REFUSES_to_run_inside_a_transaction(db_path):
    """The guard itself: whatever a future writer does before it, the sweep's
    one door to the vendor will not open while the connection holds a write."""
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        ns.ensure_semantic_schema(c)
        c.execute("UPDATE users SET display_name = display_name")   # opens the implicit BEGIN
        assert c.in_transaction
        called = []

        class Spy(ns.NoOpEmbeddingProvider):
            def embed(self, texts, *, timeout=None):
                called.append(texts)
                return super().embed(texts)

        with pytest.raises(RuntimeError, match="transaction is open across a vendor call"):
            ns._embed_unlocked(c, Spy(), ["a"])
        assert called == [], "the vendor was called with the write lock held"
        c.rollback()
        assert ns._embed_unlocked(c, Spy(), ["a"]) and called      # control: free, it runs
    finally:
        c.close()


def test_a_note_is_written_in_ONE_transaction_after_its_vectors_are_in_hand(db_path):
    """A vendor failure mid-note leaves that note's rows exactly as they were:
    nothing is half-written from a batch that did come back."""
    n = _note("Plan", *[f"Paragraph {i}." for i in range(70)])
    ns.index_member(U)
    before = _rows()
    assert len(before) == 71

    class Flaky(ns.NoOpEmbeddingProvider):
        name = "noop:flaky"          # a new provider name: every block re-embeds
        calls = 0

        def embed(self, texts, *, timeout=None):
            Flaky.calls += 1
            if Flaky.calls == 2:
                raise RuntimeError("vendor went away on the second batch")
            return super().embed(texts)

    with pytest.raises(RuntimeError):
        ns.index_member(U, provider=Flaky())
    assert _rows() == before, "a failed note left half its vectors from another provider"
    assert n["id"]


def _rows():
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        return sorted(tuple(r) for r in c.execute(
            "SELECT note_id, block_id, content_hash FROM j2_note_embeddings WHERE user_id = ?", (U,)))
    finally:
        c.close()


# ── the OpenAI provider batches ──────────────────────────────────────────────

class _FakeClient:
    def __init__(self, dim=3, shuffle=True, short=False):
        self.creates: list[dict] = []
        self.options: list[dict] = []
        self._dim = dim
        self._shuffle = shuffle
        self._short = short
        self.embeddings = SimpleNamespace(create=self._create)

    def with_options(self, **kw):
        self.options.append(kw)
        return self

    def _create(self, *, model, input):
        self.creates.append({"model": model, "input": list(input)})
        data = [SimpleNamespace(index=i, embedding=[float(i)] * self._dim) for i in range(len(input))]
        if self._short:
            data = data[:-1]
        if self._shuffle:
            data = list(reversed(data))       # the API does not promise order
        return SimpleNamespace(data=data)


def test_the_OpenAI_provider_sends_ONE_request_per_call_in_input_order(monkeypatch):
    from api.services import voice_openai, voice_embeddings_service as ves
    fake = _FakeClient()
    monkeypatch.setattr(voice_openai, "_get_client", lambda: fake)
    long = "x" * (ves.MAX_CHUNK_CHARS + 500)
    out = ns.OpenAIEmbeddingProvider().embed(["a", "b", long])
    assert len(fake.creates) == 1, "one HTTP request for the whole batch, never one per block"
    sent = fake.creates[0]
    assert sent["model"] == ves.EMBEDDING_MODEL
    assert sent["input"][:2] == ["a", "b"] and len(sent["input"][2]) == ves.MAX_CHUNK_CHARS
    assert out == [[0.0] * 3, [1.0] * 3, [2.0] * 3], "vectors come back in INPUT order"


def test_the_OpenAI_provider_refuses_an_answer_that_does_not_cover_the_batch(monkeypatch):
    from api.services import voice_openai
    monkeypatch.setattr(voice_openai, "_get_client", lambda: _FakeClient(short=True))
    with pytest.raises(RuntimeError):
        ns.OpenAIEmbeddingProvider().embed(["a", "b"])


# ── M-6: a spent budget stops the walk ───────────────────────────────────────

def test_a_spent_budget_stops_the_walk_instead_of_parsing_every_note(db_path, monkeypatch):
    for i in range(30):
        _note(f"Note {i}", f"First paragraph {i}.", f"Second paragraph {i}.")
    parsed = []
    real = ns.note_blocks
    monkeypatch.setattr(ns, "note_blocks", lambda *a, **k: parsed.append(1) or real(*a, **k))
    r = ns.index_member(U, max_embeds=5)                  # one 3-block note fits, the next does not
    assert r["indexed"] == 1
    assert r["deferred"] == 29, "every note still owed must be COUNTED as deferred"
    assert len(parsed) <= r["indexed"] + 1, (
        f"{len(parsed)} note bodies parsed for {r['indexed']} indexed: the walk kept "
        "parsing after its budget was spent")
    again = ns.index_member(U, max_embeds=400)            # the next run picks the rest up
    assert again["indexed"] == 29 and again["deferred"] == 0
    assert len(_rows()) == 90
