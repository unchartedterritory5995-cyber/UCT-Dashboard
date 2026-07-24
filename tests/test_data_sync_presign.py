import importlib
import api.services.data_sync as ds


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
