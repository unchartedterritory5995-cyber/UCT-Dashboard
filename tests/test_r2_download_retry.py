"""Rail: a multi-GB snapshot download survives a transient stall (bars-api 2026-11-13: one 60 s read
timeout left a boot serving from an empty store)."""
import io

from api.services import data_sync as ds


class _Client:
    def __init__(self, fail_times):
        self.fail_times, self.calls = fail_times, 0

    def get_object(self, Bucket, Key):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise TimeoutError("Read timeout on endpoint URL")
        return {"Body": io.BytesIO(b"x" * (3 << 20))}


def test_a_stall_is_retried_and_the_download_completes(tmp_path, monkeypatch):
    c = _Client(fail_times=2)
    monkeypatch.setattr(ds, "_client", lambda: c)
    monkeypatch.setattr(ds, "_bucket", lambda: "b")
    seen = {}
    monkeypatch.setattr(ds.tarfile, "open", lambda p, mode=None: (_ for _ in ()).throw(RuntimeError("stop")))
    real = ds._stream_object_to

    def spy(client, bucket, key, path):
        real(client, bucket, key, path)
        seen["bytes"] = __import__("os").path.getsize(path)

    monkeypatch.setattr(ds, "_stream_object_to", spy)
    ds.download_snapshot("123")                 # extraction is stubbed to stop; the download is the subject
    assert c.calls == 3 and seen["bytes"] == 3 << 20


def test_it_gives_up_after_the_configured_attempts(monkeypatch):
    c = _Client(fail_times=99)
    monkeypatch.setattr(ds, "_client", lambda: c)
    monkeypatch.setattr(ds, "_bucket", lambda: "b")
    assert ds.download_snapshot("123") is False
    assert c.calls == ds.SNAPSHOT_DOWNLOAD_ATTEMPTS


def test_the_client_gets_a_long_read_timeout_and_retries(monkeypatch):
    for k, v in (("DATA_SYNC_ENDPOINT_URL", "https://example.invalid"), ("DATA_SYNC_ACCESS_KEY", "a"),
                 ("DATA_SYNC_SECRET_KEY", "b")):
        monkeypatch.setenv(k, v)
    cfg = ds._client().meta.config
    assert cfg.read_timeout >= 300 and cfg.retries.get("total_max_attempts", 0) >= 8
