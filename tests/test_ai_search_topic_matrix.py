"""AI Search topic-matrix audit — Layer 1 of the pre-launch diagnostic.

Hundreds of parameterized cases proving every question CATEGORY gets the
PROPER pipeline treatment: model tier, recency filter, ticker extraction,
which desk feeds inject, and cache salting. No LLM calls — this asserts the
routing/grounding machinery, and stays as a permanent regression guard.
"""
import itertools

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)

# ⚠️ REPAIRED 2026-08-09 — AI Search (LLM spend on the firm's key) became `require_paid`.
# These tests overrode `get_current_user` and asserted 200, which ENCODED THE
# HOLE the auth sweep found: they proved a caller with A SESSION got the data,
# and signup is open and free, so that was never the same claim as "a member who
# paid". The override moved to `get_current_user_with_plan` (the gate's INPUT) —
# ⛔ NOT to `require_paid` itself, because overriding a gate means never running
# it (`lesson_injected_dependency_hides_the_fetch`).
PAID = {"id": 1, "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": 2, "email": "free@example.test", "role": "member", "plan": "free"}

# A representative slice of the cap universe for extraction checks.
TICKERS = [
    "NVDA", "SMCI", "AMD", "TSLA", "AAPL", "MSFT", "PLTR", "COHR", "NBIS",
    "HOOD", "MU", "AVGO", "META", "CRWD", "NFLX", "JPM", "GS", "XOM", "LLY",
    "UNH", "CAT", "BA", "DE", "SHOP", "COIN", "MSTR", "ARM", "VRT", "ANET",
    "DELL", "ORCL", "TSM", "ASML", "LRCX", "KLAC", "AMAT", "QCOM", "INTC",
    "GOOGL", "AMZN",
]

_captured: dict = {}


@pytest.fixture()
def client(monkeypatch):
    _captured.clear()

    def fake_search(query, **kw):
        _captured.update(kw)
        _captured["query"] = query
        return {"answer": "ok", "citations": [], "related_questions": [], "cached": True}

    monkeypatch.setattr(ai.perplexity_search, "web_search", fake_search)
    monkeypatch.setattr(ai, "_UNI", set(TICKERS))
    monkeypatch.setattr(ai, "_regime_provider", lambda: {"regime": "bull_trend", "confidence": 0.7})
    monkeypatch.setattr(ai, "_quote_provider", lambda s: {"last": 100.0, "direction": "up", "abs_pct": 1.0})
    monkeypatch.setattr(ai, "_ctx_catalyst", lambda s: f"[CATALYST:{s}]")
    monkeypatch.setattr(ai, "_ctx_tape", lambda s: f"[TAPE:{s}]")
    monkeypatch.setattr(ai, "_ctx_patterns", lambda s: f"[PATTERNS:{s}]")
    monkeypatch.setattr(ai, "_ctx_flow_ticker", lambda s: f"[FLOW:{s}]")
    monkeypatch.setattr(ai, "_ctx_movers", lambda: "[MOVERS]")
    monkeypatch.setattr(ai, "_ctx_breadth", lambda: "[BREADTH]")
    monkeypatch.setattr(ai, "_ctx_earnings", lambda: "[EARNINGS]")
    monkeypatch.setattr(ai, "_ctx_uct20", lambda: "[UCT20]")
    monkeypatch.setattr(ai, "_ctx_candidates", lambda: "[CANDIDATES]")
    monkeypatch.setattr(ai, "_ctx_news", lambda: "[NEWS]")
    ai._usage_day = ""
    ai._usage_by_user = {}
    ai._usage_global = 0
    ai._stats = ai._fresh_stats()

    app = FastAPI()
    app.include_router(ai.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    return TestClient(app)


def ask(client, q):
    r = client.post("/api/ai-search", json={"query": q})
    assert r.status_code == 200, q
    return dict(_captured)


# ── Category: live price checks ──────────────────────────────────────────────
@pytest.mark.parametrize("t,phrase", list(itertools.product(TICKERS, [
    "What is the current price of {t}?",
    "Where is {t} trading right now?",
    "{t} price check",
])))
def test_price_check(client, t, phrase):
    c = ask(client, phrase.format(t=t))
    assert c["mode"] == "fast"                       # sonar-pro default
    assert f"{t}: last $100.0" in c["system"]        # live quote grounded
    assert f"[PATTERNS:{t}]" in c["system"]          # setups always ride along
    assert "[FLOW" not in c["system"]                # no flow hop without intent
    assert "[MOVERS]" not in c["system"]


# ── Category: why-is-it-moving (hot; day recency + full ticker context) ─────
@pytest.mark.parametrize("t,phrase", list(itertools.product(TICKERS, [
    "Why is {t} moving today?",
    "Why did {t} gap this morning?",
    "What's going on with {t} right now?",
])))
def test_why_moving(client, t, phrase):
    c = ask(client, phrase.format(t=t))
    assert c["recency"] == "day"
    for marker in (f"[CATALYST:{t}]", f"[TAPE:{t}]", f"[PATTERNS:{t}]"):
        assert marker in c["system"], marker
    # hot queries get the 5-min freshness bucket in the salt
    assert c["cache_salt"].split("|")[-1].startswith(("b", "off"))


# ── Category: options flow ───────────────────────────────────────────────────
@pytest.mark.parametrize("t,phrase", list(itertools.product(
    TICKERS[:10],
    ["What is the options flow saying on {t}?",
     "Any big sweeps in {t} today?",
     "Is there unusual activity in {t}?"],
)))
def test_flow_questions(client, t, phrase):
    c = ask(client, phrase.format(t=t))
    assert f"[FLOW:{t}]" in c["system"], "flow tape must ground flow questions"


# ── Category: setups / patterns ──────────────────────────────────────────────
@pytest.mark.parametrize("t", TICKERS[:10])
def test_setup_questions(client, t):
    # A per-ticker setup question gets that ticker's pattern-engine detections,
    # but NOT the market-wide scanner-candidates feed (that fires on "scanner /
    # candidates / pullbacks", not "setup on X") — refined 2026-07-18 audit.
    c = ask(client, f"Is there a setup on {t} right now?")
    assert f"[PATTERNS:{t}]" in c["system"]
    assert "[CANDIDATES]" not in c["system"]
    assert c["recency"] == "day"                     # "right now"


@pytest.mark.parametrize("q", [
    "Any scanner candidates today?",
    "Best pullback setups on the scan right now?",
    "Any trade candidates on the scanner?",
])
def test_scanner_questions_get_candidates_feed(client, q):
    c = ask(client, q)
    assert "[CANDIDATES]" in c["system"], q


# ── Category: comparison / peers → sonar-pro ────────────────────────────────
@pytest.mark.parametrize("a,b", list(itertools.combinations(TICKERS[:8], 2)))
def test_comparisons(client, a, b):
    c = ask(client, f"Compare {a} versus {b} for a swing trade")
    assert c["mode"] == "fast"
    assert f"{a}: last" in c["system"] and f"{b}: last" in c["system"]


# ── Category: deep analysis → sonar-reasoning-pro, bills 2 units ────────────
@pytest.mark.parametrize("t,phrase", list(itertools.product(
    TICKERS[:8],
    ["Give me the bull case and bear case for {t}",
     "Analyze {t}'s valuation",
     "Full breakdown of the {t} thesis"],
)))
def test_deep_analysis(client, t, phrase):
    ai._usage_global = 0
    c = ask(client, phrase.format(t=t))
    assert c["mode"] == "reasoning"


# ── Category: earnings calendar vs earnings history ─────────────────────────
@pytest.mark.parametrize("q,wants_feed", [
    ("Who reports earnings today?", True),
    ("Which names are reporting tonight?", True),
    ("Any BMO reporters I should watch?", True),
    # 'beats this week' is history — web recency handles it, not today's calendar
    ("What were the biggest beats this week?", False),
] + [(f"What was {t}'s last earnings report like?", False) for t in TICKERS[:8]])
def test_earnings_routing(client, q, wants_feed):
    c = ask(client, q)
    assert ("[EARNINGS]" in c["system"]) == wants_feed, q


# ── Category: market-wide reads ──────────────────────────────────────────────
@pytest.mark.parametrize("q,marker", [
    ("What's moving right now?", "[MOVERS]"),
    ("Biggest gainers this morning?", "[MOVERS]"),
    ("Show me the premarket movers", "[MOVERS]"),
    ("How are market internals looking?", "[BREADTH]"),
    ("How's breadth today?", "[BREADTH]"),
    ("New highs vs new lows?", "[BREADTH]"),
    ("What's in the UCT20 right now?", "[UCT20]"),
    ("What are the firm's top names?", "[UCT20]"),
    ("Any scanner candidates today?", "[CANDIDATES]"),
    ("Best pullback setups on the scan?", "[CANDIDATES]"),
    ("What's on the tape this morning?", "[NEWS]"),
    ("Any headlines I should know about?", "[NEWS]"),
])
def test_market_reads(client, q, marker):
    c = ask(client, q)
    assert marker in c["system"], q


# ── Category: recency inference ──────────────────────────────────────────────
@pytest.mark.parametrize("q,expected", [
    ("Why is SMCI moving today?", "day"),
    ("Biggest premarket gappers?", "day"),
    ("What happened after hours?", "day"),
    ("Recent analyst upgrades on NVDA", "week"),
    ("Latest news on COHR", "week"),
    ("Any downgrades this week?", "week"),
    ("What was JPM's last earnings report like?", None),
    ("Who are COHR's closest competitors?", None),
    ("How does the VIX work?", None),
])
def test_recency_inference(client, q, expected):
    c = ask(client, q)
    assert c["recency"] == expected, q


# ── Category: ticker extraction safety ──────────────────────────────────────
@pytest.mark.parametrize("q", [
    "IS ALL OF THE MARKET UP TODAY",
    "WHAT DOES THE CEO SAY ABOUT EPS",
    "HOW HIGH CAN THE SEC PUSH THIS",
    "WHY DID THE IPO GET PULLED",
    "IS NOW A GOOD TIME TO GO LONG",
    "WHAT IS THE BEST ETF FOR AI",
])
def test_no_false_ticker_extraction(client, q):
    c = ask(client, q)
    assert ": last $" not in c["system"], q          # no phantom quote lines


@pytest.mark.parametrize("t", TICKERS)
def test_cashtag_always_extracts(client, t):
    c = ask(client, f"thoughts on ${t.lower()}?")
    assert f"{t}: last $" in c["system"]


# ── Category: conversation memory plumbing ──────────────────────────────────
@pytest.mark.parametrize("t", TICKERS[:6])
def test_history_threads_through(client, t):
    r = client.post("/api/ai-search", json={
        "query": "how did it react?",
        "history": [{"q": f"What was {t}'s report like?", "a": f"{t} beat."}],
    })
    assert r.status_code == 200
    assert _captured["history"][0]["q"] == f"What was {t}'s report like?"
    assert "h" in _captured["cache_salt"]


# ── Category: adversarial mis-routing probes (found by this audit) ──────────
@pytest.mark.parametrize("q", [
    "Did NVDA beat estimates last quarter?",
    "Has SMCI missed on revenue before?",
])
def test_history_beat_questions_dont_inject_todays_calendar(client, q):
    # AUDIT FIX: 'beats?/missed' used to wrongly pull today's BMO/AMC feed
    # into earnings-HISTORY questions.
    c = ask(client, q)
    assert "[EARNINGS]" not in c["system"], q


def test_premium_valuation_is_not_a_flow_question(client):
    # AUDIT FIX: bare 'premium' used to fire the flow-worker HTTP hop on
    # valuation questions.
    c = ask(client, "Is NVDA trading at a premium valuation versus AMD?")
    assert "[FLOW" not in c["system"]


def test_flow_shorthand_still_grounds(client):
    c = ask(client, "what's the flow on SMCI")
    assert "[FLOW:SMCI]" in c["system"]


def test_lowercase_bare_ticker_not_extracted_documented(client):
    # DOCUMENTED TRADEOFF (diagnostic finding F-1): bare lowercase tickers are
    # NOT extracted — too collision-prone with English words (now→NOW,
    # open→OPEN, path→PATH). Members get grounding via UPPERCASE or $cashtag;
    # the widget's examples model that. Revisit with a curated-safe list.
    c = ask(client, "thoughts on nvda here?")
    assert "NVDA: last $" not in c["system"]


# ── Category: guardrails present on every request ───────────────────────────
@pytest.mark.parametrize("q", [
    "Why is NVDA up?", "What's moving?", "Compare AMD vs MU",
    "bull case for TSLA", "who reports today?",
])
def test_scope_and_format_rules_always_present(client, q):
    c = ask(client, q)
    assert "SCOPE — HARD RULE" in c["system"]
    assert "CRITICAL FORMATTING" in c["system"]
    assert "finance" == c["domain_pack"]
    assert c["related"] is True


# ── Category: crypto & macro (web-answered; must not false-ground) ──────────
@pytest.mark.parametrize("q", [
    "Where is Bitcoin trading and what's driving it this week?",
    "Is Ethereum outperforming Bitcoin lately?",
    "What did the Fed signal at the last meeting?",
    "When is the next CPI print and what's expected?",
    "How are treasury yields affecting growth stocks?",
    "What's the market pricing for rate cuts this year?",
    "Is the dollar strength hurting multinationals?",
    "What sectors lead late in the cycle?",
])
def test_crypto_macro_clean_routing(client, q):
    c = ask(client, q)
    # no phantom ticker quotes, guardrails intact
    assert ": last $" not in c["system"], q
    assert "SCOPE — HARD RULE" in c["system"]


# ── Category: options education / greeks (no flow hop — not tape questions) ─
@pytest.mark.parametrize("q", [
    "How does theta decay work on weekly options?",
    "What is gamma exposure and why does it matter?",
    "How should I think about IV crush around earnings?",
    "What's a good delta for swing trade calls?",
])
def test_options_education_no_flow_hop(client, q):
    c = ask(client, q)
    assert "[FLOW" not in c["system"], q


# ── Category: risk management / trading craft ───────────────────────────────
@pytest.mark.parametrize("q", [
    "How do I size a position with a 2% risk budget?",
    "Where should a stop go on a breakout entry?",
    "How many positions is too many for a swing book?",
    "When should I move a stop to breakeven?",
])
def test_trading_craft_routes(client, q):
    c = ask(client, q)
    assert c["mode"] in ("fast", "reasoning"), q
    assert "SCOPE — HARD RULE" in c["system"]


# ── Category: sympathy / theme questions ────────────────────────────────────
@pytest.mark.parametrize("t", TICKERS[:12])
def test_sympathy_questions(client, t):
    c = ask(client, f"Best sympathy stocks for {t}?")
    assert c["mode"] == "fast"                    # list question → sonar-pro
    assert f"{t}: last $" in c["system"]


# ── Category: analyst actions ───────────────────────────────────────────────
@pytest.mark.parametrize("t", TICKERS[:12])
def test_analyst_action_questions(client, t):
    c = ask(client, f"Recent analyst upgrades on {t}?")
    assert c["recency"] == "week", t
    assert f"{t}: last $" in c["system"]


# ── Category: short interest / squeeze ──────────────────────────────────────
@pytest.mark.parametrize("t", TICKERS[:8])
def test_short_interest_questions(client, t):
    c = ask(client, f"What's the short interest on {t} and is a squeeze setting up?")
    assert f"{t}: last $" in c["system"]
    assert f"[PATTERNS:{t}]" in c["system"]


# ── Category: multi-ticker basket questions (3-ticker cap honored) ──────────
def test_many_tickers_capped_at_three(client):
    c = ask(client, "Rank NVDA, AMD, MU, AVGO and TSM for the next month")
    quoted = [t for t in ("NVDA", "AMD", "MU", "AVGO", "TSM") if f"{t}: last $" in c["system"]]
    assert len(quoted) == 3, quoted


# ── Category: dividends / fundamentals ──────────────────────────────────────
@pytest.mark.parametrize("t", TICKERS[:8])
def test_dividend_fundamental_questions(client, t):
    c = ask(client, f"What's {t}'s dividend yield and payout history?")
    assert c["recency"] is None, t                 # timeless fundamental
    assert f"{t}: last $" in c["system"]


# ── Category: explicit client-mode override honored ─────────────────────────
@pytest.mark.parametrize("mode", ["fast", "reasoning"])
def test_client_mode_override(client, mode):
    r = client.post("/api/ai-search", json={"query": "quick check on breadth", "mode": mode})
    assert r.status_code == 200
    assert _captured["mode"] == mode
