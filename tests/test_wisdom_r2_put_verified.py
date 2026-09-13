"""A canonical R2 key is written once, via staging, and only after it verifies.

Owner ruling CONTRACTS §8c.1.3, checkpoint 3. `put_immutable` writes the canonical key directly,
so a caller that computed an empty or truncated payload burns it into a key this module can never
delete or rewrite. S-A hit exactly that: a capture run for a past date returned zero rows and wrote
an EMPTY object to `wisdom/context/<date>/<dataset>.json.gz`; the later genuine backfill was exiled
to a sha-suffixed key, leaving the empty capture canonical forever.

⛔ The load-bearing property is not "it writes" — it is that **nothing reaches the canonical key
unless it verified**, and that the caller can tell the difference. A watermark advances on
`verified is True` and on nothing else.
"""
from __future__ import annotations

import pytest

from api.services.wisdom.core import ids, r2

KEY = "wisdom/context/2026-09-13/detections.json.gz"
BODY = b"\x1f\x8b" + b"payload-bytes" * 8


class FakeR2:
    """Mirrors the shape put_verified depends on, and records the ORDER of operations."""

    def __init__(self, *, corrupt_sha=False, lose_object=False, wrong_length=False, drop_sha=False):
        self.objects: dict[str, tuple[bytes, dict]] = {}
        self.calls: list[str] = []
        self.corrupt_sha, self.lose_object = corrupt_sha, lose_object
        self.wrong_length, self.drop_sha = wrong_length, drop_sha

    def put_object(self, Bucket, Key, Body, ContentType, Metadata):
        self.calls.append(f"put:{Key}")
        meta = dict(Metadata)
        if self.corrupt_sha:
            meta["sha256"] = "0" * 64
        if self.drop_sha:
            meta.pop("sha256", None)
        self.objects[Key] = (Body, meta)

    def head_object(self, Bucket, Key):
        self.calls.append(f"head:{Key}")
        if Key not in self.objects or (self.lose_object and Key.startswith(r2.STAGING_PREFIX)):
            raise _Missing()
        body, meta = self.objects[Key]
        length = 1 if self.wrong_length else len(body)
        return {"Metadata": meta, "ContentLength": length}

    def copy_object(self, Bucket, Key, CopySource):
        self.calls.append(f"copy:{CopySource['Key']}->{Key}")
        self.objects[Key] = self.objects[CopySource["Key"]]


class _Missing(Exception):
    response = {"Error": {"Code": "404"}}


@pytest.fixture()
def fake(monkeypatch):
    bucket = FakeR2()
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (bucket, "fake-bucket"))
    return bucket


# ── the happy path, and the ORDER ────────────────────────────────────────────

def test_it_stages_verifies_copies_and_verifies_again(fake):
    out = r2.put_verified(KEY, BODY, "application/gzip")

    assert out["verified"] is True and out["created"] is True
    assert out["sha256"] == ids.sha256_bytes(BODY)
    assert fake.objects[KEY][0] == BODY

    staged = out["staging_key"]
    assert staged.startswith(r2.STAGING_PREFIX) and out["sha256"] in staged
    # The order is the guarantee: staging is written and checked BEFORE the canonical key exists.
    assert fake.calls.index(f"put:{staged}") < fake.calls.index(f"copy:{staged}->{KEY}")
    assert any(c == f"head:{staged}" for c in fake.calls[:fake.calls.index(f"copy:{staged}->{KEY}")])
    assert fake.calls[-1] == f"head:{KEY}"          # verified after the copy, not before


def test_the_staging_key_is_sha_addressed_so_a_repeat_does_not_accumulate(fake):
    first = r2.put_verified(KEY, BODY, "application/gzip")
    before = set(fake.objects)
    second = r2.put_verified(KEY, BODY, "application/gzip")
    assert second["staging_key"] == first["staging_key"]
    assert set(fake.objects) == before
    assert second["created"] is False and second["verified"] is True


# ── the attack this exists to refuse ─────────────────────────────────────────

def test_an_empty_payload_never_reaches_a_canonical_key(fake):
    """The S-A defect. An empty capture must not be written at all — this module has no delete
    path, so an empty object on a canonical key is permanent."""
    with pytest.raises(r2.R2VerificationFailed) as exc:
        r2.put_verified(KEY, b"", "application/gzip")
    assert "EMPTY" in str(exc.value)
    assert fake.objects == {}, "nothing at all may be written, not even to staging"


def test_put_immutable_would_have_written_it_which_is_why_put_verified_exists(fake):
    """CONTROL for the test above. Without it, 'empty was refused' could be an artifact of the
    fake rather than a property of put_verified — this shows the OLD path really does write it."""
    r2.put_immutable(KEY, b"", "application/gzip")
    assert fake.objects[KEY][0] == b""


# ── a failure anywhere leaves the canonical key untouched ────────────────────

@pytest.mark.parametrize("mode", ["corrupt_sha", "lose_object", "wrong_length"])
def test_a_staging_failure_never_touches_the_canonical_key(monkeypatch, mode):
    bucket = FakeR2(**{mode: True})
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (bucket, "fake-bucket"))
    with pytest.raises((r2.R2VerificationFailed, r2.R2ImmutableConflict)):
        r2.put_verified(KEY, BODY, "application/gzip")
    assert KEY not in bucket.objects
    assert not any(c.startswith("copy:") for c in bucket.calls)


def test_a_missing_checksum_is_a_failure_not_a_pass(monkeypatch):
    """⛔ 'We could not check' and 'it matched' are different facts. Only one may advance a
    watermark, so an absent sha256 must raise rather than fall through."""
    bucket = FakeR2(drop_sha=True)
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (bucket, "fake-bucket"))
    with pytest.raises(r2.R2VerificationFailed):
        r2.put_verified(KEY, BODY, "application/gzip")
    assert KEY not in bucket.objects


# ── immutability still holds ─────────────────────────────────────────────────

def test_the_same_bytes_twice_is_a_no_op_and_still_verified(fake):
    r2.put_verified(KEY, BODY, "application/gzip")
    again = r2.put_verified(KEY, BODY, "application/gzip")
    assert again["created"] is False and again["verified"] is True


def test_different_bytes_on_an_existing_canonical_key_still_conflicts(fake):
    r2.put_verified(KEY, BODY, "application/gzip")
    with pytest.raises(r2.R2ImmutableConflict):
        r2.put_verified(KEY, BODY + b"different", "application/gzip")
    assert fake.objects[KEY][0] == BODY, "the original canonical object is unchanged"


def test_the_key_guard_still_applies_to_both_keys(fake):
    with pytest.raises(ValueError):
        r2.put_verified("desk_audio/not-ours.m4a", BODY, "application/gzip")
    assert fake.objects == {}


def test_the_pytest_isolation_guard_is_still_in_front_of_all_of_this():
    """Control tying this file to the R2 test-isolation rail: without a monkeypatched bucket,
    put_verified must refuse to build a real client rather than reach production."""
    with pytest.raises(r2.R2TestIsolation):
        r2.put_verified(KEY, BODY, "application/gzip")
