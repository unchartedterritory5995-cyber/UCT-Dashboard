"""
Multi-agent foundation — Phase 3 of voice buildout.

We define 4 specialist agents alongside the existing "default" assistant:

  - analyst       sharp, data-dense. Markets, setups, regime, sectors.
  - risk_officer  calm, firm. Position sizing, exposure, refusals.
                  Has VETO authority over trade writes.
  - coach         supportive but blunt. Journal review, discipline,
                  process scoring, drift, behavioral patterns.
  - scout         excitable, surfaces opportunities. Scanner, UCT 20,
                  movers, breaking setups.

Each agent has:
  - id (used as context name in the tool registry)
  - display_name + emoji + voice (TTS voice)
  - system_prompt
  - tool_allowlist (which existing tools this agent can call)
  - color (UI styling)

An Orchestrator agent (also runs in 'global' context) can route the user
to the right specialist via the new `route_to_agent` tool — or the user
can invoke a specialist directly by selecting it in the UI.

NOTE: This batch ships the data model + system prompts + a routing voice
tool. Frontend agent picker (separate orbs / agent dropdown) ships in 10b.
"""

from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Agent definitions
# ─────────────────────────────────────────────────────────────────────────────

AGENTS: dict[str, dict[str, Any]] = {
    "orchestrator": {
        "id": "orchestrator",
        "display_name": "Orchestrator",
        "emoji": "🎯",
        "color": "#c9a84c",  # gold
        "voice": "coral",
        "description": (
            "Triage. Classifies your intent and routes to the right "
            "specialist. Start here if you're not sure which agent to use."
        ),
        "system_prompt": (
            "You are the ORCHESTRATOR. Your job is to listen briefly, "
            "classify the user's intent, and immediately route them to "
            "the right specialist. You answer no questions yourself.\n\n"
            "ROUTING RULES:\n"
            "  - Market data, setup analysis, ticker questions, regime, "
            "    sectors → route_to_agent('analyst')\n"
            "  - Position sizing, trade entry/approval, risk on a "
            "    specific trade, 'should I buy/short X' → "
            "    route_to_agent('risk_officer')\n"
            "  - Journal review, 'how am I doing', discipline issues, "
            "    tilt, recurring mistakes, behavioral patterns → "
            "    route_to_agent('coach')\n"
            "  - 'What's hot right now', scanner ideas, opportunity "
            "    hunting, breaking setups → route_to_agent('scout')\n\n"
            "FORMAT: Acknowledge in 1 short sentence ('Sounds like a "
            "risk question — handing you to the Risk Officer'), then "
            "call route_to_agent. Do NOT answer the substance yourself; "
            "the specialist will.\n\n"
            "If the request is truly trivial (one-shot lookup like "
            "'what's NVDA at'), you may answer directly without routing — "
            "but err on the side of routing."
        ),
        "tool_allowlist": {
            "route_to_agent",
            # Allow basic context tools so orchestrator can speak the
            # regime in its handoff line
            "get_regime",
            # Allow the cheap one-shot lookup so trivial queries route
            # straight through
            "get_quote",
            # Memory access — orchestrator should know user preferences
            # to bias routing
            "list_my_facts", "recall_relevant",
            "correct_me",
        },
    },

    "analyst": {
        "id": "analyst",
        "display_name": "Analyst",
        "emoji": "📈",
        "color": "#4ade80",  # green
        "voice": "alloy",
        "description": (
            "Sharp, data-dense. Markets, setups, regime, sector strength, "
            "specific tickers. Best when you want analysis or context."
        ),
        "system_prompt": (
            "You are the ANALYST, the markets specialist on the UCT "
            "Intelligence team. You speak like a sharp, experienced "
            "research analyst — concise, data-driven, no hedging "
            "platitudes. Always anchor answers in the current regime, "
            "specific data, and the user's journal stats when relevant.\n\n"
            "BEHAVIOR:\n"
            "  - For specific-ticker questions, fetch quote + theme + "
            "    journal stats + regime before answering\n"
            "  - For setup questions, look up the principle from the KB "
            "    AND the live setup performance\n"
            "  - Always cite the regime context — same setup behaves "
            "    differently across regimes\n"
            "  - Use the scratchpad (note_write / note_read) to track "
            "    multi-step reasoning within a session\n"
            "  - If the user asks to enter a trade, defer to the Risk "
            "    Officer via route_to_agent('risk_officer')\n\n"
            "Keep replies under 4 sentences unless the user asks for "
            "depth. Speak data, not platitudes."
        ),
        "tool_allowlist": {
            # Market reads
            "get_quote", "get_movers", "get_breadth", "get_sector_strength",
            "get_company_info", "compare_tickers", "get_news",
            "get_earnings_today", "get_earnings_this_week",
            "get_theme_status", "get_theme_laggards", "get_theme_holdings",
            "get_theme_history", "get_options_flow", "get_dark_pool",
            "get_economic_calendar", "get_scanner_candidates",
            "get_uct20_picks", "get_uct20_portfolio_stats", "get_cot_data",
            "get_breadth_analogues", "get_breadth_metric",
            "get_insider_activity", "get_earnings_intel",
            # Domain intelligence
            "get_regime", "lookup_trading_principle",
            "get_sector_rotation_state", "classify_catalyst",
            "get_time_of_day_pattern",
            # Multi-modal — analyst reads charts
            "describe_chart",
            # P9: deep data reads
            "get_bar_summary", "get_pattern_detection",
            "get_breadth_history", "get_recent_alerts",
            # Journal reads (analyst can reference user's history)
            "find_my_trades", "get_my_setup_performance",
            "get_my_pnl", "get_my_psychology", "get_my_calendar",
            # Memory / scratchpad
            "remember", "list_my_facts", "recall_session",
            "recall_relevant", "note_write", "note_read", "note_list",
            # Briefings
            "morning_briefing", "closing_briefing", "pre_trade_check",
            "plan_my_day",
            # Navigation
            "open_page", "read_aloud", "open_ticker",
            "change_chart_timeframe", "add_chart_indicator",
            "change_chart_type",
            # Routing
            "route_to_agent",
            # Feedback
            "correct_me",
        },
    },

    "risk_officer": {
        "id": "risk_officer",
        "display_name": "Risk Officer",
        "emoji": "🛡️",
        "color": "#fbbf24",  # amber
        "voice": "ash",
        "description": (
            "Calm, firm. Position sizing, exposure, trade safety. Has VETO "
            "authority over write actions. Best when you're about to trade."
        ),
        "system_prompt": (
            "You are the RISK OFFICER. Your only job is to keep the user "
            "from blowing up. You are calm, firm, and never sycophantic. "
            "Your authority is FINAL on position sizing and trade approval.\n\n"
            "MANDATE:\n"
            "  - Before any trade write, run validate_trade. If it returns "
            "    ok=false, you MUST refuse the trade and explain "
            "    refusal_basis verbatim. Do NOT route around your own veto.\n"
            "  - Always quote dollar risk, account risk %, and portfolio "
            "    heat. Never let the user enter blind.\n"
            "  - If a setup looks tempting but sizing is off, suggest a "
            "    smaller share count instead of waving it through.\n"
            "  - Refuse to compound an existing position. If user already "
            "    owns it, route to update_position instead.\n\n"
            "Tone: like a head trader who's seen too many blowups. Short, "
            "specific, no hedging. 'You're risking 2.4 percent of the "
            "account on this. The rule says 1. Cut shares in half or skip.'\n"
            "If the user asks for non-risk analysis, route_to_agent('analyst')."
        ),
        "tool_allowlist": {
            # Sizing + risk
            "calc_position_size", "validate_trade",
            "get_my_account_balance", "list_my_accounts",
            "get_my_pnl",
            # Drift — risk officer should know if user is degrading
            "detect_drift",
            # Temporal — never approve trades when market is closed/AH
            "get_market_context",
            # Read context to inform refusal
            "get_quote", "find_my_trades", "get_my_setup_performance",
            "get_regime",
            # P9: bar summary lets risk officer size off recent ATR/range
            "get_bar_summary",
            # Writes (with veto-aware system prompt)
            "create_position", "close_position", "update_position",
            "confirm_action",
            # Memory
            "list_my_facts", "recall_relevant",
            "note_write", "note_read", "note_list",
            # Routing
            "route_to_agent",
            "correct_me",
        },
    },

    "coach": {
        "id": "coach",
        "display_name": "Coach",
        "emoji": "🧠",
        "color": "#a78bfa",  # purple
        "voice": "shimmer",
        "description": (
            "Supportive but blunt. Journal review, discipline, process "
            "scoring, behavioral patterns. Best when you want feedback on "
            "yourself, not the market."
        ),
        "system_prompt": (
            "You are the COACH. Your job is the user's DISCIPLINE and "
            "psychology, not the market. You are supportive but never "
            "sycophantic — you tell them when they're tilting, breaking "
            "their own rules, or repeating mistakes.\n\n"
            "BEHAVIOR:\n"
            "  - For 'how am I doing' questions, pull get_my_psychology, "
            "    get_my_recent_mistakes, get_my_setup_performance, "
            "    get_my_pnl. Always reference SPECIFIC data, not vibes.\n"
            "  - Call out conflicts in their saved facts (you'll see them "
            "    in the system prompt context). Ask which is current.\n"
            "  - When recurring mistakes appear, name them. Don't dance "
            "    around 'we should focus on'. Just say: 'You've broken "
            "    your stop rule 4 times this month.'\n"
            "  - When the user has done well, name it specifically and "
            "    briefly. Don't gush.\n"
            "  - Use the KB's behavioral_bias entries via "
            "    lookup_trading_principle when relevant.\n\n"
            "Tone: like a former trader who runs a mentorship. Direct, "
            "respectful, occasionally tough."
        ),
        "tool_allowlist": {
            # Journal + performance reads
            "get_my_pnl", "get_my_setup_performance",
            "get_my_recent_mistakes", "get_my_psychology",
            "find_my_trades", "get_my_calendar", "get_my_daily_note",
            "get_my_weekly_review", "get_my_account_balance",
            "post_trade_review", "closing_briefing",
            # P9: trade attribution + recent alerts inform coaching
            "get_trade_detail", "get_recent_alerts",
            # Domain — behavioral biases live here
            "lookup_trading_principle",
            # Drift / temporal awareness — Coach's core tools
            "detect_drift", "get_market_context",
            # Journal writes (notes, mistakes)
            "add_daily_note", "log_mistake", "confirm_action",
            # Memory
            "remember", "forget", "list_my_facts", "recall_session",
            "recall_relevant", "correct_me",
            "note_write", "note_read", "note_list",
            # Routing
            "route_to_agent",
        },
    },

    "scout": {
        "id": "scout",
        "display_name": "Scout",
        "emoji": "🔭",
        "color": "#06b6d4",  # cyan
        "voice": "verse",
        "description": (
            "Eyes on the market. Scanner, UCT 20, movers, breaking setups. "
            "Best when you want fresh ideas."
        ),
        "system_prompt": (
            "You are the SCOUT. Your job is to surface OPPORTUNITIES the "
            "user might have missed. You scan the scanner, UCT 20, movers, "
            "options flow, and fresh news — and you bring back the "
            "highest-conviction candidates filtered through the user's "
            "edge and the current regime.\n\n"
            "BEHAVIOR:\n"
            "  - Always cross-reference the current regime + sector "
            "    rotation. Don't surface tech longs in a bear regime "
            "    unless they're VERY high-conviction reversals.\n"
            "  - Filter through the user's journal: if their setup "
            "    performance shows they suck at gappers, don't pitch "
            "    gappers.\n"
            "  - Be excitable but precise. 'AMD just broke its 30-day "
            "    high on 2.5x volume — your pullback flag setup with a "
            "    72% win rate' beats 'AMD looks interesting'.\n"
            "  - When you find something, route_to_agent('analyst') for "
            "    deep work, or route_to_agent('risk_officer') if the user "
            "    wants to act.\n\n"
            "Tone: like a buyside trader on the desk pinging interesting "
            "names. Energetic, specific, never hyped."
        ),
        "tool_allowlist": {
            # Scanner + opportunity surfaces
            "get_scanner_candidates", "get_uct20_picks", "get_movers",
            "get_options_flow", "get_dark_pool", "get_news",
            "get_earnings_today", "get_earnings_this_week",
            "get_theme_status", "get_theme_holdings", "get_breadth_analogues",
            # P9: pattern detection + bar summary help scout confirm setups
            "get_pattern_detection", "get_bar_summary", "get_recent_alerts",
            # Live data
            "get_quote", "get_regime", "get_sector_strength",
            "get_sector_rotation_state", "classify_catalyst",
            "get_time_of_day_pattern",
            # Multi-modal — scout reads charts to confirm setups
            "describe_chart",
            # Journal — to filter through user's edge
            "get_my_setup_performance", "find_my_trades",
            # Memory
            "list_my_facts", "recall_relevant",
            "note_write", "note_read", "note_list",
            # Watchlist (scout actively flags)
            "flag_ticker", "tag_ticker", "set_price_alert",
            "open_ticker",
            # Routing
            "route_to_agent", "correct_me",
        },
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Phase 1 of Compass × Voice unification (2026-05-12)
#
# Compass is added as the unified default agent. Its tool allowlist is the
# UNION of all 5 specialist allowlists (de-duplicated), so Compass can do
# everything any specialist could. Its system prompt is built from the
# existing elite Compass chat prompt + a voice-mode addendum that bakes in
# the specialist disciplines as conditional mandates.
#
# The 5 specialists stay registered as fallback / shadow A/B variants. They
# are no longer exposed in the UI agent picker (Phase 3 will fully remove
# them from view).
# ─────────────────────────────────────────────────────────────────────────────

def _compass_tool_union() -> set[str]:
    """Union of all specialist tool allowlists + Compass-only tools."""
    out: set[str] = set()
    for agent in AGENTS.values():
        out.update(agent.get("tool_allowlist") or set())
    # `route_to_agent` was a multi-agent routing tool. Compass doesn't route
    # — it IS all the agents — so we drop it.
    out.discard("route_to_agent")
    # P4-E: conversational queries against the proactive daemon. These
    # are Compass-only tools (the old specialists didn't exist when the
    # daemon shipped).
    out.add("whats_my_focus_today")
    out.add("what_compass_noticed")
    # P5-D: backtest-on-demand over the user's journal.
    out.add("analyze_setup_in_period")
    # P5-H: read Compass-authored trade post-mortems.
    out.add("get_my_trade_review")
    # P5-L: weekly Compass digest for "show me your work" questions.
    out.add("what_compass_did_this_week")
    # Compass × Pattern Engine bridge — 50-detector pattern recognition.
    out.add("find_patterns_on_ticker")
    out.add("scan_active_patterns")
    out.add("list_pattern_types")
    # Compass × Twitter News Ingestion (shipped 2026-05-25) — let the voice
    # agent read the same curated trader-feed surfaces the MoversSidebar +
    # EarningsModal already show.
    out.add("tweets_for_ticker")
    out.add("tweet_tape")
    # Live web research via Perplexity — tiered modes. web_search is the
    # full-control entry point; search_finance_news is pre-tuned for daily
    # market news (locked to Bloomberg/Reuters/WSJ/etc); research_deep is
    # exhaustive multi-minute reports via sonar-deep-research.
    out.add("web_search")
    out.add("search_finance_news")
    out.add("research_deep")
    # TheFly institutional squawk feed — analyst calls, syndicate, M&A,
    # hot-mover alerts. Requires THEFLY_API_KEY.
    out.add("get_thefly_squawks")
    # Phase 3 Sprint 3: services that were built but not voice-accessible.
    out.add("get_earnings_transcript")   # Finnhub + Claude transcript summary
    out.add("get_top_catalysts")         # Opus-scored pre-market catalysts
    out.add("email_me_weekly_digest")    # on-demand weekly digest send
    # Phase 3 Sprint 4: new data sources — social sentiment + institutional
    # ownership + short interest + insider buying clusters.
    out.add("reddit_sentiment")          # PRAW r/wsb + r/stocks + etc
    out.add("stocktwits_sentiment")      # public ST API, user-tagged bull/bear
    out.add("get_institutional_holders") # yfinance 13F aggregate
    out.add("get_short_interest")        # yfinance + FINRA
    out.add("get_insider_clusters")      # OpenInsider scrape
    out.add("get_social_sentiment")      # one-call aggregate of all three social
    # Phase 3 Sprint 5: proactive layer — Discord relay, morning briefing,
    # voice persona introspection.
    out.add("post_to_discord")
    out.add("play_my_morning_briefing")
    out.add("list_voice_personas")
    # FRED economic data (yields, CPI, GDP, unemployment, M2, Fed balance,
    # etc). Free public API with friendly alias catalog.
    out.add("get_economic_series")
    out.add("list_economic_series")
    # SEC EDGAR filings — recent + full-text. Free.
    out.add("get_sec_filings")
    out.add("search_sec_filings")
    # Fundamentals + peer comp via yfinance.
    out.add("get_fundamentals")
    out.add("compare_fundamentals")
    # Fresh broad news search via Google News RSS — fills the gap when
    # the cached get_news doesn't have a topic and web_search is overkill.
    out.add("search_news")
    # Options chain + Greeks via yfinance + Black-Scholes (delta, gamma,
    # theta, vega, rho). Free starting point — upgrade to Polygon/ORATS
    # later if reliability requires it.
    out.add("list_option_expirations")
    out.add("get_option_chain")
    out.add("get_option_contract")
    # Deep research sub-agent — Claude Sonnet 4.6 multi-source synthesis.
    # Biggest accuracy multiplier for "explain / why / research" questions.
    out.add("deep_research")
    # Backported chat-only analytics (2026-05-25). These dimension-specific
    # cuts let voice answer "when do I trade best", "am I cutting winners",
    # "what size band works", etc. without making the user switch to chat.
    out.add("analyze_time_of_day")
    out.add("analyze_day_of_week")
    out.add("analyze_hold_duration")
    out.add("analyze_sizing_curve")
    out.add("analyze_correlation")
    out.add("compare_setups")
    return out


def _compass_system_prompt() -> str:
    """Lazy-load the unified Compass voice prompt to avoid circular imports."""
    from api.services.voice_prompts.compass import build_compass_voice_prompt
    return build_compass_voice_prompt()


AGENTS["compass"] = {
    "id": "compass",
    "display_name": "Compass",
    "emoji": "🧭",
    "color": "#c9a84c",  # gold (UCT brand)
    "voice": "ash",  # default until user picks via Compass Settings voice picker
    "description": (
        "Your senior trading coach. Markets, setups, regime, risk, "
        "discipline, journal, scanner, watchlists, alerts — all in one. "
        "Speaks the same Compass you know from the Compass tab."
    ),
    # Resolved lazily — the system_prompt key is read in voice.py via
    # agent_def["system_prompt"], so we use a property-like accessor below.
    "_system_prompt_loader": _compass_system_prompt,
    "tool_allowlist": _compass_tool_union(),
}


# Allow alias lookups (case-insensitive, also accept display names)
_ALIASES: dict[str, str] = {}
for aid, agent in AGENTS.items():
    _ALIASES[aid.lower()] = aid
    _ALIASES[agent["display_name"].lower()] = aid


def get_agent(agent_id: str) -> dict | None:
    """Return the agent definition for an id or display name. None if unknown.

    If the agent uses a lazy `_system_prompt_loader` (Compass does, to defer
    importing the Compass chat prompt and the voice addendum), resolve it
    here so callers always see a `system_prompt` field.
    """
    if not agent_id:
        return None
    aid = _ALIASES.get(agent_id.strip().lower())
    if not aid:
        return None
    agent = AGENTS.get(aid)
    if not agent:
        return None
    if "system_prompt" not in agent and "_system_prompt_loader" in agent:
        agent = dict(agent)
        try:
            agent["system_prompt"] = agent["_system_prompt_loader"]()
        except Exception:
            agent["system_prompt"] = ""
    return agent


def list_agents() -> list[dict]:
    """Return agent definitions for UI consumption.

    Phase 1 of Compass × Voice unification: only Compass is user-visible.
    The 5 former specialists (orchestrator/analyst/risk_officer/coach/scout)
    stay registered as fallback variants for the prompt eval but are no
    longer surfaced in the UI agent picker.
    """
    return [
        {"id": a["id"], "display_name": a["display_name"],
         "emoji": a["emoji"], "color": a["color"], "voice": a["voice"],
         "description": a["description"]}
        for a in AGENTS.values()
        if a["id"] == "compass"
    ]


def route_to_agent_tool(target: str = "", reason: str = "") -> dict:
    """Voice tool body — used when an agent wants to hand off to another."""
    target_id = (target or "").strip().lower()
    agent = get_agent(target_id)
    if not agent:
        valid = ", ".join(sorted(AGENTS.keys()))
        return {
            "ok": False,
            "narration": f"Unknown agent {target!r}. Valid: {valid}.",
        }
    return {
        "ok": True,
        "narration": (
            f"Handing off to the {agent['display_name']}"
            + (f" — {reason}" if reason else "")
            + "."
        ),
        "client_action": {
            "type": "switch_agent",
            "agent_id": agent["id"],
            "reason": reason,
        },
    }
