"""A lean is not a spike, and a tolerance cannot tell them apart.

The threshold check pages when drift is BIG. It is structurally blind to drift
that is small and never goes away — which is the shape that actually reached a
member. The owner's own hero sat $19.96 from the broker's reported total every
day for weeks, under every tolerance, and was found only by comparing two
screens by hand. Ten of eleven books belong to members; nobody compares those.

⛔ "Not enough readings yet" must never render as "clean". A digest that
conflates them is reassurance the data does not support.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import mirror_check as mc


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    accounts_service.create_account("u1", {"name": "B", "color": "blue",
                                           "startingBalance": 1.0})
    return {}


def _series(ba, dollars, pcts=None):
    conn = auth_db.get_connection()
    try:
        for i, d in enumerate(dollars):
            pct = (pcts[i] if pcts else (d / 10000.0))
            conn.execute(
                "INSERT INTO j2_broker_drift_series (user_id, broker_account_id, "
                "checked_at, drift_dollar, drift_pct, ok) VALUES (?,?,?,?,?,1)",
                ("u1", ba, "2026-08-30T07:40:00+00:00", d, pct))
        conn.commit()
    finally:
        conn.close()


class TestLeanVsSpike:
    def test_the_owners_own_shape_is_caught(self, env):
        # $19.96 every check on a ~$9.7k book: 0.2%, spread zero.
        _series("acc-lean", [-19.96] * 8)
        out = mc.bias_scan(days=3650)
        assert [r["label"] for r in out["leaning"]] == ["? "] or out["leaning"]
        r = out["leaning"][0]
        assert r["mean"] == -19.96 and r["spread"] == 0.0

    def test_symmetric_noise_of_the_same_size_is_NOT_flagged(self, env):
        # Same magnitude, but it swings — the distinction a threshold cannot make.
        _series("acc-noise", [20.0, -19.0, 21.0, -20.5, 18.0, -19.5, 20.0, -20.0])
        out = mc.bias_scan(days=3650)
        assert out["leaning"] == []
        assert out["accounts"][0]["verdict"] == "clean"

    def test_a_single_big_spike_never_reads_as_a_lean(self, env):
        _series("acc-spike", [0.0, 0.0, 900.0, 0.0, 0.0, 0.0, 0.0])
        assert mc.bias_scan(days=3650)["leaning"] == []

    def test_a_lean_too_small_in_PERCENT_is_noise_on_a_big_book(self, env):
        # $12 on a $1.6M account is nothing; the dollar test alone would flag it.
        _series("acc-whale", [12.0] * 8, pcts=[0.0000075] * 8)
        assert mc.bias_scan(days=3650)["leaning"] == []

    def test_a_lean_too_small_in_DOLLARS_is_noise_on_a_tiny_book(self, env):
        # 0.5% of a $400 account is $2 — real in percent, immaterial in money.
        _series("acc-small", [2.0] * 8, pcts=[0.005] * 8)
        assert mc.bias_scan(days=3650)["leaning"] == []


class TestHonestAboutNotKnowing:
    def test_too_few_readings_is_insufficient_never_clean(self, env):
        _series("acc-new", [-19.96] * 3)
        out = mc.bias_scan(days=3650)
        assert out["leaning"] == []
        assert [r["brokerAccountId"] for r in out["insufficient"]] == ["acc-new"]
        assert out["accounts"][0]["verdict"] == "insufficient"

    def test_the_digest_says_so_out_loud(self, env):
        _series("acc-new", [-19.96] * 3)
        text = mc.bias_digest_text(mc.bias_scan(days=3650))
        assert "not a clean bill" in text.lower()

    def test_the_digest_names_accounts_never_counts_them(self, env):
        _series("acc-lean", [-19.96] * 8)
        text = mc.bias_digest_text(mc.bias_scan(days=3650))
        assert "acc-lean" in text or "?" in text
        assert "-19.96" in text and "every check" in text

    def test_a_clean_fleet_says_so_rather_than_going_silent(self, env):
        _series("acc-ok", [0.0] * 8)
        text = mc.bias_digest_text(mc.bias_scan(days=3650))
        assert "No account is leaning" in text


class TestTheDigestActuallyRuns:
    def test_it_is_registered_on_the_real_app(self):
        """A monitor wired to no scheduler is the defect this repo keeps paying
        for — the insights pass was 'written, documented as scheduled, wired to
        nothing' for weeks. Derived from main.py's AST, not grepped."""
        import ast
        from pathlib import Path
        src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(
            encoding="utf-8", errors="ignore")
        ids = set()
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                    and node.func.attr == "add_job":
                for kw in node.keywords:
                    if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                        ids.add(kw.value.value)
        assert "broker_bias_digest" in ids, "the digest has no scheduler entry"
        # Control: the probe can see a sibling it is not looking for.
        assert "broker_live_sentinel" in ids

    def test_it_posts_even_when_everything_is_clean(self, env, monkeypatch):
        posted = []
        monkeypatch.setattr(mc, "_post_discord", lambda t, d: posted.append((t, d)))
        _series("acc-ok", [0.0] * 8)
        mc.run_bias_digest()
        assert posted, "silent-green is indistinguishable from dead"
        assert "🟢" in posted[0][0]

    def test_it_flags_and_names_a_leaning_book(self, env, monkeypatch):
        posted = []
        monkeypatch.setattr(mc, "_post_discord", lambda t, d: posted.append((t, d)))
        _series("acc-lean", [-19.96] * 8)
        out = mc.run_bias_digest()
        assert out["leaning"], "a steady lean must be reported"
        assert "🔴" in posted[0][0]

    def test_it_never_raises_into_the_scheduler(self, env, monkeypatch):
        monkeypatch.setattr(mc, "bias_scan", lambda *a, **k: (_ for _ in ()).throw(
            RuntimeError("db gone")))
        assert "error" in mc.run_bias_digest()


class TestBasisRidesTheSameChannel:
    def test_a_basis_divergence_reaches_the_daily_digest(self, env):
        """Recorded by the mirror check at sync time (the only place the payload
        exists); surfaced here so it is not a number sitting in a JSON column
        that nobody reads."""
        import json
        conn = auth_db.get_connection()
        try:
            conn.execute(
                "INSERT INTO j2_broker_accounts (id, user_id, snaptrade_account_id, "
                "brokerage_name, account_number_masked, j2_account_id, status, "
                "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                ("bk9", "u1", "s9", "Schwab", "..783", "acct-x", "active", "x", "x"))
            conn.execute(
                "INSERT INTO j2_broker_mirror_checks (user_id, broker_account_id, "
                "checked_at, ok, drift_dollar, drift_pct, consecutive_drifts, detail_json) "
                "VALUES (?,?,?,?,?,?,?,?)",
                ("u1", "bk9", "2026-08-30T07:40:00+00:00", 1, 0.0, 0.0, 0,
                 json.dumps({"positions": [], "options": [],
                             "basis": ["AAPL Long: journal cost 100.0000 vs "
                                       "broker 118.4200 (-15.56%)"]})))
            conn.commit()
        finally:
            conn.close()
        text = mc.bias_digest_text(mc.bias_scan(days=3650))
        assert "AAPL" in text and "118.42" in text
        assert "Schwab" in text, "name the account, not just the symbol"
        assert "not an alarm" in text, "it must read as an observation, not a page"
