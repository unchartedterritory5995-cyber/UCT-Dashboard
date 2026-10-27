"""Trade Exchange News receiver service -- credential, limits, durability, redaction.

Synthetic payloads only. The receiver lives in its own image
(``services/trade_exchange_news_receiver``); these tests import it the way that
image does, flat.
"""
from __future__ import annotations

import asyncio
import json
import logging
import pathlib
import re
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from tests.support.txn_fakes import RECEIVER_DIR, FakeS3, load_receiver

M = load_receiver()
rx, jr, fw, red, appmod = (M["txn_receiver"], M["txn_journal"], M["txn_forwarder"],
                           M["txn_redaction"], M["txn_app"])

TOKEN = "txn_" + "A" * 43
TOKEN2 = "txn_" + "B" * 43
GOOD = {"source": "TXNews1", "content": "SYNTHETIC: Example Corp announces a test event"}


def _cfg(**over):
    env = {"TXN_RECEIVER_ENABLED": "1", "TXN_WEBHOOK_TOKEN_SHA256": rx.token_sha256(TOKEN),
           "TXN_INGEST_TOKEN": "ingest-test", "TXN_WEB_INGEST_URL": "http://web.test/ingest"}
    env.update(over)
    return rx.Config(env)


class Pushes:
    """An httpx transport standing in for web's ingest route."""

    def __init__(self, status: int = 200) -> None:
        self.status = status
        self.bodies: list[dict] = []
        self.auth: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.bodies.append(json.loads(request.content))
        self.auth.append(request.headers.get("authorization", ""))
        return httpx.Response(self.status, json={"status": "new", "seq": len(self.bodies)})


def _client(cfg=None, journal=None, pushes=None):
    cfg = cfg or _cfg()
    journal = journal if journal is not None else jr.MemoryJournal()
    pushes = pushes or Pushes()
    forwarder = fw.Forwarder(cfg.web_ingest_url, cfg.ingest_token,
                             client=httpx.AsyncClient(transport=httpx.MockTransport(pushes)))
    app = appmod.create_app(cfg, journal, forwarder)
    return TestClient(app), journal, pushes, app


# ── the credential ───────────────────────────────────────────────────────────

def test_dark_flag_off_answers_404_even_for_the_right_token():
    c, journal, _, _ = _client(_cfg(TXN_RECEIVER_ENABLED=""))
    with c:
        r = c.post(f"/hook/{TOKEN}", json=GOOD)
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    assert journal.objects == {}


def test_unknown_token_is_a_plain_404_and_the_body_is_never_read():
    c, journal, pushes, _ = _client()
    with c:
        r = c.post("/hook/txn_wrong", content=b"x" * 10_000_000)
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    assert journal.objects == {} and pushes.bodies == []


def test_only_hashes_are_configured_and_two_may_be_live_for_rotation():
    cfg = _cfg(TXN_WEBHOOK_TOKEN_SHA256=f"{rx.token_sha256(TOKEN)},{rx.token_sha256(TOKEN2)}")
    assert TOKEN not in repr(vars(cfg))
    c, journal, _, _ = _client(cfg)
    with c:
        assert c.post(f"/hook/{TOKEN}", json=GOOD).status_code == 200
        assert c.post(f"/hook/{TOKEN2}", json=GOOD).status_code == 200
    assert len(journal.objects) == 2
    # After rotation completes the old hash is removed and the old URL stops.
    c, _, _, _ = _client(_cfg(TXN_WEBHOOK_TOKEN_SHA256=rx.token_sha256(TOKEN2)))
    with c:
        assert c.post(f"/hook/{TOKEN}", json=GOOD).status_code == 404


def test_verify_token_bounds_and_constant_time_compare():
    hashes = (rx.token_sha256(TOKEN),)
    assert rx.verify_token(TOKEN, hashes)
    assert not rx.verify_token("", hashes)
    assert not rx.verify_token(TOKEN, ())
    assert not rx.verify_token("x" * (rx.MAX_TOKEN_CHARS + 1), hashes)
    src = (RECEIVER_DIR / "txn_receiver.py").read_text(encoding="utf-8")
    body = src.split("def verify_token", 1)[1].split("\n\n\n", 1)[0]
    assert "hmac.compare_digest" in body and "break" not in body and "return True" not in body


def test_source_is_not_authentication():
    """A correct source with a wrong token is refused; source is checked after."""
    c, journal, _, _ = _client()
    with c:
        assert c.post("/hook/txn_guess", json=GOOD).status_code == 404
        r = c.post(f"/hook/{TOKEN}", json={"source": "Other", "content": "SYNTHETIC"})
    assert r.status_code == 422 and journal.objects == {}


# ── limits and validation ────────────────────────────────────────────────────

@pytest.mark.parametrize("body,status", [
    (b"not json", 400),
    (b"\xff\xfe", 400),
    (b"[1,2]", 422),
    (json.dumps({"source": "TXNews1"}).encode(), 422),
    (json.dumps({"source": "TXNews1", "content": "   "}).encode(), 422),
    (json.dumps({"source": "TXNews1", "content": 5}).encode(), 422),
    (json.dumps({"content": "SYNTHETIC"}).encode(), 422),
])
def test_malformed_payloads_are_refused_and_not_journaled(body, status):
    c, journal, pushes, _ = _client()
    with c:
        r = c.post(f"/hook/{TOKEN}", content=body, headers={"content-type": "application/json"})
    assert r.status_code == status
    assert journal.objects == {} and pushes.bodies == []


def test_body_cap_and_content_cap():
    c, journal, _, _ = _client(_cfg(TXN_MAX_BODY_BYTES="512", TXN_MAX_CONTENT_CHARS="100"))
    with c:
        big = c.post(f"/hook/{TOKEN}", content=b"{" + b" " * 600 + b"}")
        long = c.post(f"/hook/{TOKEN}", json={"source": "TXNews1", "content": "S" * 101})
    assert big.status_code == 413 and long.status_code == 413
    assert journal.objects == {}


def test_rate_limit_answers_429_with_retry_after():
    c, journal, _, _ = _client(_cfg(TXN_RATE_BURST="2", TXN_RATE_PER_SEC="0.001"))
    with c:
        codes = [c.post(f"/hook/{TOKEN}", json=GOOD).status_code for _ in range(3)]
        last = c.post(f"/hook/{TOKEN}", json=GOOD)
    assert codes == [200, 200, 429]
    assert last.headers.get("retry-after") == "5" and len(journal.objects) == 2


def test_token_bucket_refills():
    now = [0.0]
    b = rx.TokenBucket(1, 2.0, clock=lambda: now[0])
    assert b.take() and not b.take()
    now[0] += 0.5
    assert b.take()


# ── the record ───────────────────────────────────────────────────────────────

def test_record_preserves_content_verbatim_and_invents_nothing():
    c, journal, _, _ = _client()
    payload = {"source": "TXNews1", "content": "  SYNTHETIC:  Two  spaces\nand a newline  ",
               "undocumented": {"k": 1}}
    with c:
        r = c.post(f"/hook/{TOKEN}", json=payload,
                   headers={"authorization": "Bearer should-not-be-kept",
                            "cookie": "a=b", "x-delivery-id": "d-1", "user-agent": "SyntheticUA"})
    assert r.status_code == 200
    (raw,) = journal.objects.values()
    rec = json.loads(raw)
    assert rec["content"] == payload["content"]                    # byte-for-byte
    assert rec["extra"] == {"undocumented": {"k": 1}}              # kept, not interpreted
    assert set(rec) == {"v", "id", "received_at_ms", "received_at", "source", "content",
                        "extra", "delivery", "receiver"}           # no invented fields
    assert rec["id"] == r.json()["id"] and jr.EVENT_ID_RE.match(rec["id"])
    assert rec["received_at"].endswith("Z")
    d = rec["delivery"]
    assert d["headers"]["x-delivery-id"] == "d-1" and d["headers"]["user-agent"] == "SyntheticUA"
    assert "authorization" not in d["header_names"] and "cookie" not in d["header_names"]
    assert "should-not-be-kept" not in raw.decode()


def test_ack_status_is_configurable_for_the_provider():
    for status in ("200", "202", "204"):
        c, _, _, _ = _client(_cfg(TXN_ACK_STATUS=status))
        with c:
            assert c.post(f"/hook/{TOKEN}", json=GOOD).status_code == int(status)


# ── durability before acknowledgement ────────────────────────────────────────

def test_journal_failure_is_503_not_an_ack_and_the_push_still_went():
    journal = jr.MemoryJournal()
    journal.fail = True
    c, _, pushes, app = _client(journal=journal)
    with c:
        r = c.post(f"/hook/{TOKEN}", json=GOOD)
        time.sleep(0.05)
    assert r.status_code == 503 and r.headers["retry-after"] == "5"
    assert app.state.counters.values["journal_failed"] == 1
    assert len(pushes.bodies) == 1          # the live path never waited on storage


def test_journal_timeout_is_503():
    s3 = FakeS3()
    s3.put_delay_s = 0.5
    c, _, _, _ = _client(_cfg(TXN_JOURNAL_TIMEOUT_S="0.1"), journal=jr.S3Journal(s3, "b"))
    with c:
        assert c.post(f"/hook/{TOKEN}", json=GOOD).status_code == 503


def test_s3_journal_error_carries_the_type_only():
    s3 = FakeS3()
    s3.fail_put = True
    with pytest.raises(jr.JournalError) as e:
        jr.S3Journal(s3, "b").put({"id": jr.new_event_id(), "x": 1})
    assert str(e.value) == "journal put failed: ConnectionError"


def test_file_journal_survives_a_receiver_restart(tmp_path):
    c, _, _, _ = _client(journal=jr.FileJournal(str(tmp_path)))
    with c:
        ids = [c.post(f"/hook/{TOKEN}", json=GOOD).json()["id"] for _ in range(3)]
    # A NEW app instance over the same directory -- the restart.
    j2 = jr.FileJournal(str(tmp_path))
    names = sorted(p.stem for p in pathlib.Path(j2.dir).glob("*.json"))
    assert names == sorted(ids)
    assert not list(pathlib.Path(j2.dir).glob(".tmp-*"))


def test_push_carries_the_ingest_bearer_not_the_webhook_secret():
    c, _, pushes, app = _client()
    with c:
        c.post(f"/hook/{TOKEN}", json=GOOD)
        time.sleep(0.05)
    assert pushes.auth == ["Bearer ingest-test"]
    assert TOKEN not in json.dumps(pushes.bodies)
    assert app.state.counters.values["forwarded"] == 1


def test_web_down_never_blocks_or_fails_the_ack():
    def down(_req):
        raise httpx.ConnectError("web deploying")
    cfg = _cfg()
    forwarder = fw.Forwarder(cfg.web_ingest_url, cfg.ingest_token,
                             client=httpx.AsyncClient(transport=httpx.MockTransport(down)))
    journal = jr.MemoryJournal()
    app = appmod.create_app(cfg, journal, forwarder)
    with TestClient(app) as c:
        t0 = time.perf_counter()
        r = c.post(f"/hook/{TOKEN}", json=GOOD)
        elapsed = time.perf_counter() - t0
        time.sleep(0.7)
    assert r.status_code == 200 and len(journal.objects) == 1
    assert elapsed < 0.4                      # did not wait for the push retries
    assert app.state.counters.values["forward_failed"] == 1


# ── readiness ────────────────────────────────────────────────────────────────

def test_health_fails_closed_on_railway_without_a_durable_journal(tmp_path):
    c, _, _, _ = _client(_cfg(RAILWAY_ENVIRONMENT="production"), journal=jr.MemoryJournal())
    with c:
        r = c.get("/health")
    assert r.status_code == 503 and "journal_not_durable" in r.json()["problems"]
    c, _, _, _ = _client(_cfg(RAILWAY_ENVIRONMENT="production"), journal=jr.FileJournal(str(tmp_path)))
    with c:
        assert c.get("/health").status_code == 200
    c, _, _, _ = _client(_cfg(TXN_WEBHOOK_TOKEN_SHA256=""))
    with c:
        assert "no_webhook_token_hash" in c.get("/health").json()["problems"]


def test_health_says_nothing_about_traffic():
    c, _, _, _ = _client()
    with c:
        c.post(f"/hook/{TOKEN}", json=GOOD)
        body = c.get("/health").json()
    assert set(body) == {"ok", "problems", "journal", "t"}


def test_journal_from_env_refuses_half_configured_s3():
    with pytest.raises(RuntimeError):
        jr.journal_from_env({"TXN_JOURNAL": "s3", "TXN_JOURNAL_ENDPOINT_URL": "https://x"})
    with pytest.raises(RuntimeError):
        jr.journal_from_env({"TXN_JOURNAL": "carrier-pigeon"})


# ── the secret never reaches a log or Sentry ─────────────────────────────────

def test_no_log_line_carries_the_secret(caplog):
    red.install_log_redaction()
    caplog.set_level(logging.DEBUG)
    c, _, _, _ = _client()
    with c:
        c.post(f"/hook/{TOKEN}", json=GOOD)
        c.post("/hook/txn_wrong", json=GOOD)
    logging.getLogger("txn.test").info("leak attempt POST /hook/%s HTTP/1.1", TOKEN)
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert TOKEN not in text
    assert "/hook/[REDACTED]" in text


def test_access_log_is_off_in_the_entrypoint():
    src = (RECEIVER_DIR / "txn_serve.py").read_text(encoding="utf-8")
    assert re.search(r"access_log\s*=\s*False", src)


def test_sentry_scrubber_drops_request_data_and_redacts_urls():
    ev = {"request": {"url": f"https://rx.example/hook/{TOKEN}", "headers": {"x": "y"},
                      "data": GOOD, "query_string": "a=b", "cookies": {"c": "d"}},
          "transaction": f"/hook/{TOKEN}",
          "breadcrumbs": {"values": [{"message": f"POST /hook/{TOKEN}"}]},
          "exception": {"values": [{"value": f"boom at /hook/{TOKEN}"}]}}
    out = red.scrub_event(ev)
    assert TOKEN not in json.dumps(out)
    assert set(out["request"]) == {"url"}


def test_sentry_is_initialised_with_the_scrubber():
    src = (RECEIVER_DIR / "txn_redaction.py").read_text(encoding="utf-8")
    init = src.split("sentry_sdk.init(", 1)[1].split(")\n", 1)[0]
    for needle in ("send_default_pii=False", "include_local_variables=False",
                   'max_request_body_size="never"', "before_send=scrub_event",
                   "before_send_transaction=scrub_event"):
        assert needle in init


# ── the image ────────────────────────────────────────────────────────────────

def test_dockerfile_copies_every_module_and_mounts_no_volume():
    docker = (RECEIVER_DIR / "Dockerfile").read_text(encoding="utf-8")
    for p in RECEIVER_DIR.glob("*.py"):
        assert f"COPY {p.name} ." in docker, f"{p.name} is not copied into the image"
    assert not re.search(r"^\s*VOLUME\b", docker, re.M)
    rail = json.loads((RECEIVER_DIR / "railway.json").read_text(encoding="utf-8"))
    assert rail["deploy"]["healthcheckPath"] == "/health"
    assert "volume" not in json.dumps(rail).lower()


def test_receiver_never_imports_web():
    for p in RECEIVER_DIR.glob("*.py"):
        assert not re.search(r"^\s*(from|import)\s+api\b", p.read_text(encoding="utf-8"), re.M), p.name


# ── event ids ────────────────────────────────────────────────────────────────

def test_event_ids_sort_in_receipt_order_even_within_one_millisecond(monkeypatch):
    monkeypatch.setattr(jr, "_last_ms", -1)     # other tests minted ids at later times
    ids = [jr.new_event_id(1_800_000_000_000) for _ in range(50)]
    assert ids == sorted(ids) and len(set(ids)) == 50
    assert all(jr.event_id_ms(i) == 1_800_000_000_000 for i in ids)
    later = jr.new_event_id(1_800_000_000_001)
    assert later > ids[-1]
    assert jr.cursor_for_ms(1_800_000_000_000) < ids[0]
    assert jr.cursor_for_ms(1_800_000_000_001) > ids[-1]


def test_forwarder_does_not_retry_a_refusal():
    calls = []

    def refuse(req):
        calls.append(1)
        return httpx.Response(401)

    f = fw.Forwarder("http://web.test/ingest", "t",
                     client=httpx.AsyncClient(transport=httpx.MockTransport(refuse)))
    assert asyncio.run(f.push({"id": "x"})) is False
    assert calls == [1]


def test_a_clock_step_backwards_never_breaks_id_order(monkeypatch):
    monkeypatch.setattr(jr, "_last_ms", -1)
    a = jr.new_event_id(1_900_000_000_000)
    b = jr.new_event_id(1_899_999_999_000)       # NTP stepped the clock back 1 s
    assert b > a


# ── the minting tool ─────────────────────────────────────────────────────────

def test_mint_tool_prints_digests_only_and_refuses_the_repo(tmp_path, capsys):
    from tools import txn_mint_secrets as mint
    out = tmp_path / "s.json"
    assert mint.main(["--out", str(out)]) == 0
    printed = capsys.readouterr().out
    pair = json.loads(out.read_text(encoding="utf-8"))
    for v in pair.values():
        assert v not in printed and mint.digest(v) in printed
    assert pair["webhook_token"].startswith("txn_") and len(pair["webhook_token"]) == 47
    assert rx.verify_token(pair["webhook_token"], (mint.digest(pair["webhook_token"]),))
    assert mint.main(["--out", str(out)]) == 2                       # never overwrite
    assert mint.main(["--out", str(mint.REPO / "x.json")]) == 2       # never in the repo
    assert not (mint.REPO / "x.json").exists()
