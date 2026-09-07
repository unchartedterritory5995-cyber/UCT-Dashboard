"""Web-side replication of the canonical ETF/INDEX snapshot to flow-worker.

⛔ REPLICATION IS SUBORDINATE TO SERVING MEMBERS. A flow-worker outage must never
fail web's canonical ticker_types sync, and no member request may trigger a push.
"""
import pathlib
import pytest

from api.services import optionsflow_etf_push as push
from api.services.etf_generation import generation_from_pairs

REPO = pathlib.Path(__file__).resolve().parents[1]
PAIRS = [("SPY", "ETF"), ("QQQ", "ETF")]
GEN = generation_from_pairs(PAIRS)


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    monkeypatch.setenv("OPTIONSFLOW_ETF_REPLICA_PUSH_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setattr(push, "WORKER_INTERNAL_URL", "http://flow-worker.internal:8080")
    for k in ("last_attempt_at", "last_success_at", "last_error", "last_error_at", "last_result"):
        push._STATE[k] = None
    for k in ("attempts", "pushes_sent", "skipped_already_current"):
        push._STATE[k] = 0


class FakeClient:
    """Stands in for httpx.Client. Records what was actually sent."""
    def __init__(self, remote_generation=None, fail=None, calls=None):
        self.remote_generation = remote_generation
        self.fail = fail
        self.calls = calls if calls is not None else []

    def __enter__(self): return self
    def __exit__(self, *a): return False

    class _R:
        def __init__(self, data): self._d = data
        def raise_for_status(self): pass
        def json(self): return self._d

    def get(self, url, headers=None):
        self.calls.append(("GET", url))
        if self.fail == "status":
            raise RuntimeError("worker unreachable")
        return self._R({"local_generation": self.remote_generation})

    def post(self, url, headers=None, json=None):
        self.calls.append(("POST", url, len(json.get("rows", []))))
        if self.fail == "install":
            raise RuntimeError("worker unreachable")
        return self._R({"status": "accepted", "generation": json.get("generation")})


def wire(monkeypatch, client):
    """Patch httpx.Client and the canonical snapshot read."""
    import httpx
    monkeypatch.setattr(httpx, "Client", lambda **kw: client)
    import api.ticker_types as tt
    monkeypatch.setattr(tt, "etf_index_snapshot",
                        lambda conn=None, include_pairs=False: {
                            "symbols": [t for t, _ in PAIRS], "generation": GEN,
                            "last_synced": "2026-09-07T09:30:03", "count": len(PAIRS),
                            "rows": [list(p) for p in PAIRS]})


# ── reconciliation transfers only on a real mismatch ────────────────────────
def test_a_MATCHING_generation_transfers_no_snapshot(monkeypatch):
    """The whole point of comparing first: a converged replica costs a status
    probe, not a ~19.5k-row payload."""
    c = FakeClient(remote_generation=GEN)
    wire(monkeypatch, c)
    out = push.reconcile()
    assert out["ok"] and out["transferred"] is False
    assert [m for m, *_ in c.calls] == ["GET"], "no POST may be sent"
    assert push._STATE["skipped_already_current"] == 1


def test_a_MISMATCH_pushes_the_snapshot(monkeypatch):
    c = FakeClient(remote_generation="something-else")
    wire(monkeypatch, c)
    out = push.reconcile()
    assert out["ok"] and out["transferred"] is True
    posts = [x for x in c.calls if x[0] == "POST"]
    assert len(posts) == 1 and posts[0][2] == len(PAIRS)


def test_an_ABSENT_remote_generation_pushes(monkeypatch):
    c = FakeClient(remote_generation=None)
    wire(monkeypatch, c)
    assert push.reconcile()["transferred"] is True


def test_force_skips_the_comparison(monkeypatch):
    c = FakeClient(remote_generation=GEN)
    wire(monkeypatch, c)
    assert push.reconcile(force=True)["transferred"] is True


# ── failure is subordinate, never fatal ─────────────────────────────────────
def test_a_worker_outage_is_recorded_and_NEVER_raises(monkeypatch):
    for mode in ("status", "install"):
        c = FakeClient(remote_generation="other", fail=mode)
        wire(monkeypatch, c)
        out = push.reconcile()           # must not raise
        assert out["ok"] is False
        assert push._STATE["last_error"]


def test_the_canonical_sync_still_succeeds_when_the_push_fails():
    """⛔ Derived from api/main.py: the reconcile call sits AFTER the sync's own
    except block, so a replication failure can never make the canonical sync
    look failed."""
    src = (REPO / "api" / "main.py").read_text(encoding="utf-8")
    block = src[src.index("def _ticker_types_sync():"):]
    block = block[:block.index('id="ticker_types_daily_sync"')]
    sync_except = block.index("[ticker_types] daily sync failed")
    reconcile_at = block.index("optionsflow_etf_push")
    assert reconcile_at > sync_except, "reconcile must follow the sync's own error handling"
    # ...and be independently guarded, so it cannot propagate either.
    tail = block[reconcile_at:]
    assert "except Exception" in tail


def test_reconciliation_RETRIES_a_mismatch_on_a_bounded_cadence():
    """Without this, a flow-worker outage at 05:30 leaves the replica stale until
    the NEXT day's sync — the shape of the 55-day freeze this work exists to end."""
    src = (REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert 'id="optionsflow_etf_replica_reconcile"' in src
    job = src[src.index('_scheduler.add_job(_of_etf_reconcile'):]
    job = job[:job.index(")") + 1]
    assert '"interval"' in job and "minutes=" in job


def test_a_missing_worker_url_is_reported_not_crashed(monkeypatch):
    monkeypatch.setattr(push, "WORKER_INTERNAL_URL", "")
    out = push.reconcile()
    assert out["ok"] is False
    assert push.status()["worker_internal_url_configured"] is False


def test_an_empty_canonical_snapshot_is_never_replicated(monkeypatch):
    """Replicating an empty set would classify every ETF as a stock downstream."""
    import httpx
    c = FakeClient(remote_generation="other")
    monkeypatch.setattr(httpx, "Client", lambda **kw: c)
    import api.ticker_types as tt
    monkeypatch.setattr(tt, "etf_index_snapshot",
                        lambda conn=None, include_pairs=False: {
                            "symbols": [], "generation": "g", "last_synced": None,
                            "count": 0, "rows": []})
    out = push.reconcile()
    assert out["ok"] is False
    assert not [x for x in c.calls if x[0] == "POST"]


# ── flag ────────────────────────────────────────────────────────────────────
def test_push_disabled_by_default(monkeypatch):
    monkeypatch.delenv("OPTIONSFLOW_ETF_REPLICA_PUSH_ENABLED", raising=False)
    assert push.push_enabled() is False
    assert push.reconcile()["ok"] is False


def test_sender_and_receiver_flags_have_DISTINCT_names():
    """⛔ The disproved pull design used OPTIONSFLOW_ETF_REPLICA_ENABLED. Reusing
    that name would leave an impossible architecture looking active."""
    from api.services import optionsflow_etf_replica as r
    import inspect
    send = inspect.getsource(push)
    recv = inspect.getsource(r)
    assert "OPTIONSFLOW_ETF_REPLICA_PUSH_ENABLED" in send
    assert "OPTIONSFLOW_ETF_REPLICA_RECEIVE_ENABLED" in recv
    assert "OPTIONSFLOW_ETF_REPLICA_ENABLED\"" not in send
    assert "OPTIONSFLOW_ETF_REPLICA_ENABLED\"" not in recv


# ── the endpoint: auth before parse, bounded body ───────────────────────────
def test_the_install_endpoint_authenticates_BEFORE_touching_the_body():
    """An unauthenticated caller must be rejected before any parsing or
    installing — the dependency runs before the handler body."""
    src = (REPO / "api" / "flow_router.py").read_text(encoding="utf-8")
    sig = src[src.index('@flow_router.post("/etf-replica/install")'):]
    head = sig[:sig.index("\n\n")]
    assert "Depends(require_flow_admin)" in head, "endpoint is not secret-gated"
    body = sig[:sig.index("return JSONResponse(out")]
    assert body.index("require_flow_admin") < body.index("await request.body()")


def test_the_install_endpoint_bounds_the_body():
    src = (REPO / "api" / "flow_router.py").read_text(encoding="utf-8")
    seg = src[src.index('@flow_router.post("/etf-replica/install")'):]
    seg = seg[:seg.index("return JSONResponse(out")]
    assert "_MAX_REPLICA_PUSH_BYTES" in seg
    assert "content-length" in seg
    assert "413" in seg


def test_the_secret_comparison_is_constant_time():
    src = (REPO / "api" / "flow_admin_auth.py").read_text(encoding="utf-8")
    fn = src[src.index("def _push_secret_ok"):]
    fn = fn[:fn.index("\n\n\n")]
    assert "compare_digest" in fn
    assert "authorization ==" not in fn, "a plain == leaks a prefix by timing"


def test_the_endpoint_never_echoes_the_dataset_back():
    """Responses are operational: status + generation metadata, not 19.5k rows."""
    from api.services import optionsflow_etf_replica as r
    import inspect
    fn = inspect.getsource(r.install_pushed_snapshot)
    for ret in ("accepted", "already-current"):
        assert ret in fn
    assert '"rows":' not in fn.split("return")[-1]


# ── the hardening applies to EVERY bearer check, not just the one I touched ──
def test_no_PUSH_SECRET_comparison_anywhere_uses_a_plain_equality():
    """⛔ There are FOUR separate bearer checks in this repo, not one.

    Hardening flow_admin_auth alone would have left three timing-leaky copies
    (routers/cot.py, routers/media_evidence_bridge.py, routers/journal_two.py)
    while the commit message claimed the class was fixed. This derives the set
    from the source so a fifth copy fails here instead of shipping.
    """
    import re
    offenders = []
    for path in (REPO / "api").rglob("*.py"):
        if "test_" in path.name:
            continue
        txt = path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r'^[^#\n]*==\s*f"Bearer \{', txt, re.M):
            offenders.append(f"{path.relative_to(REPO)}: {m.group(0).strip()[:70]}")
    assert not offenders, "plain == on a bearer secret leaks a prefix by timing:\n" + "\n".join(offenders)


def test_CONTROL_the_scanner_can_actually_find_a_bearer_comparison():
    """Without this the rail above passes on any regex that matches nothing."""
    import re
    hits = 0
    for path in (REPO / "api").rglob("*.py"):
        if re.search(r'f"Bearer \{', path.read_text(encoding="utf-8", errors="replace")):
            hits += 1
    assert hits >= 4, f"expected several bearer sites, found {hits}"
