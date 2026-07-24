import importlib

import pytest
from botocore.exceptions import ClientError

import api.services.data_sync as ds


@pytest.fixture(autouse=True)
def _clear_object_exists_cache():
    # object_exists() has a 60s in-process TTL cache keyed by object key — clear
    # it before every test so tests using the same key don't see a stale hit.
    ds._object_exists_cache.clear()
    yield
    ds._object_exists_cache.clear()


def test_presigned_get_returns_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(ds, "_client", lambda: None)
    assert ds.presigned_get("desk_audio/x.m4a") is None


def test_presigned_get_delegates_to_boto3(monkeypatch):
    calls = {}
    class FakeClient:
        def generate_presigned_url(self, op, Params, ExpiresIn):
            calls.update(op=op, Params=Params, ExpiresIn=ExpiresIn)
            return "https://r2.example/signed"
    monkeypatch.setattr(ds, "_client", lambda: FakeClient())
    monkeypatch.setattr(ds, "_bucket", lambda: "mybucket")
    url = ds.presigned_get("desk_audio/x.m4a", expires=1200)
    assert url == "https://r2.example/signed"
    assert calls["op"] == "get_object"
    assert calls["Params"] == {"Bucket": "mybucket", "Key": "desk_audio/x.m4a"}
    assert calls["ExpiresIn"] == 1200


def test_object_exists_false_when_client_unconfigured(monkeypatch):
    monkeypatch.setattr(ds, "_client", lambda: None)
    assert ds.object_exists("desk_audio/unconfigured.m4a") is False


def test_object_exists_true_on_head_success(monkeypatch):
    calls = []
    class FakeClient:
        def head_object(self, Bucket, Key):
            calls.append((Bucket, Key))
            return {"ContentLength": 123}
    monkeypatch.setattr(ds, "_client", lambda: FakeClient())
    monkeypatch.setattr(ds, "_bucket", lambda: "mybucket")
    assert ds.object_exists("desk_audio/abc.m4a") is True
    assert calls == [("mybucket", "desk_audio/abc.m4a")]


def test_object_exists_false_on_head_client_error(monkeypatch):
    class FakeClient:
        def head_object(self, Bucket, Key):
            raise ClientError(
                {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
            )
    monkeypatch.setattr(ds, "_client", lambda: FakeClient())
    monkeypatch.setattr(ds, "_bucket", lambda: "mybucket")
    assert ds.object_exists("desk_audio/missing.m4a") is False


def test_object_exists_caches_within_ttl(monkeypatch):
    calls = []
    class FakeClient:
        def head_object(self, Bucket, Key):
            calls.append((Bucket, Key))
            return {"ContentLength": 1}
    monkeypatch.setattr(ds, "_client", lambda: FakeClient())
    monkeypatch.setattr(ds, "_bucket", lambda: "mybucket")

    assert ds.object_exists("desk_audio/cached.m4a") is True
    assert ds.object_exists("desk_audio/cached.m4a") is True
    # Second call within the 60s TTL must be a cache hit — no second HEAD.
    assert len(calls) == 1
