"""The AI-door table (TERM-078, FB-I1-04): every module under api/ that calls a
model API, what reaches it, and the budget it draws from TODAY.

⛔ THIS TABLE IS NOT THE CENSUS. The census is DERIVED by AST every run
(`tools/ai_door_census.py`: SDK client constructions, model-method call sites,
model-host literals, and one hop through a `shared-client` wrapper).
`tests/test_ai_doors_census.py` fails BY NAME on a module the census finds that
this table does not describe, and on an entry here the census no longer finds.
So a new model call cannot land undescribed, and a deleted one cannot leave a
row claiming it still exists.

KINDS
  member        -- a model call runs on a member's request (directly, or as
                   background work the request starts)
  background    -- scheduler / worker only; members read its stored output
  operator      -- admin or PUSH_SECRET routes, CLI tools
  eval          -- offline graders and harnesses
  shared-client -- a wrapper other modules call instead of the SDK; the census
                   follows one hop from it, so its callers appear here too

FIELDS
  budget   -- what bounds it today, in words, with the counter's home
              (verified by reading the code 2026-09-28; see the ticket report)
  meter    -- the `ai_meters.METERS` key a member reads it through, or None
  pop_cap  -- the module that calls `ai_population_cap.admit` for this door
              (the rail proves that module really does), or "" when unwired
  gap      -- REQUIRED for a member door with no meter or no population cap:
              why, so an unmetered door is a decision on the page, not an
              omission nobody can see
"""
from __future__ import annotations

from typing import NamedTuple

KINDS = ("member", "background", "operator", "eval", "shared-client")


class Door(NamedTuple):
    kind: str
    surface: str
    budget: str
    meter: str | None = None
    pop_cap: str = ""
    gap: str = ""


_ROUTER_AI = "api/routers/ai_search.py"
_NB_WRITING = "api/routers/notebook_writing_help.py"

DOORS: dict[str, Door] = {
    # ── AI Search ────────────────────────────────────────────────────────────
    "api/routers/ai_search.py": Door(
        "member", "POST /api/ai-search, /stream, /deep (require_paid)",
        "per-member 40 units/ET day + global 2000 (`_reserve`; in-process, write-through "
        "to ai_search_log's usage ledger and re-seeded after a deploy); Claude synthesis "
        "under narrative_cost_guard $5/day; Perplexity global 500/day",
        meter="ai_search", pop_cap=_ROUTER_AI),
    "api/services/ai_search_agent.py": Door(
        "member", "agent lane of POST /api/ai-search/stream",
        "2 of the member's 40 AI Search units + narrative_cost_guard $15/day (durable)",
        meter="ai_search", pop_cap=_ROUTER_AI),
    "api/services/ai_search_deep.py": Door(
        "member", "POST /api/ai-search/deep; scheduled weekly deep",
        "5 of the member's 40 units + 3 jobs/member/UTC day (ais_deep_jobs) + $10/day global",
        meter="ai_search", pop_cap=_ROUTER_AI),
    "api/services/ai_search_personal.py": Door(
        "member", "personal branch of POST /api/ai-search (AI_SEARCH_PERSONAL_ENABLED, dark)",
        "1 AI Search unit + reserve_synth 20/member/day and $25 est. global (in-process)",
        meter="ai_search_personal", pop_cap=_ROUTER_AI),
    "api/services/ai_search_dossier.py": Door(
        "background", "daemon thread kicked from the ask path; admin /admin/synthesize",
        "6h throttle + in-process $3/day flat-estimate counter (AI_SEARCH_DOSSIER_ENABLED, dark)"),
    "api/services/ai_search_briefings.py": Door(
        "background", "scheduled pre/post-market briefings",
        "Perplexity global 500/day"),
    "api/services/brain_kb_service.py": Door(
        "member", "embeddings inside AI Search, Compass voice/chat tools, community ask",
        "none of its own; bounded by each calling door's cap",
        gap="an embedding step inside other doors, never a door a member opens"),
    # ── Notebook (durable daily_counters) ────────────────────────────────────
    "api/services/note_ask.py": Door(
        "member", "the Ask / writing-help client and reservation ledger",
        "daily_counters: notebook_ask 40/member, notebook_writing_help 60/member, "
        "notebook_llm_spend_usd $25/day global",
        meter="notebook_ask", pop_cap="api/routers/journal_two.py"),
    "api/services/journal_two/ask_service.py": Door(
        "member", "POST /api/j2/ask/stream, /notes/{id}/ask/stream (require_paid)",
        "daily_counters notebook_ask 40/member + $25/day shared",
        meter="notebook_ask", pop_cap="api/routers/journal_two.py"),
    "api/services/journal_two/writing_help.py": Door(
        "member", "POST /api/j2/notes/{id}/writing-help/stream (NOTEBOOK_WRITING_HELP_ENABLED)",
        "daily_counters notebook_writing_help 60/member + $25/day shared",
        meter="notebook_writing_help", pop_cap=_NB_WRITING),
    "api/services/journal_two/property_autofill.py": Door(
        "member", "POST /api/j2/notes/{id}/writing-help/autofill",
        "daily_counters notebook_writing_help 60/member + $25/day shared",
        meter="notebook_writing_help", pop_cap=_NB_WRITING),
    "api/services/journal_two/voice_notes.py": Door(
        "member", "/api/j2/voice-notes/* (NOTEBOOK_VOICE_NOTES_ENABLED, require_paid): Whisper "
        "per 5-minute part + one summary call",
        "voice_usage mode D 60 min/month (whole file checked up front) + daily_counters "
        "notebook_voice_note 20/member + $25/day shared",
        meter="notebook_voice_notes", pop_cap="api/routers/notebook_voice_notes.py"),
    "api/services/journal_two/ai_actions.py": Door(
        "member", "POST /api/j2/ai-actions/plan (NOTEBOOK_AI_ACTIONS_ENABLED, dark; require_paid)",
        "daily_counters notebook_ai_actions 20/member + $25/day shared (one call per plan, "
        "charged its own estimate)",
        meter="notebook_ai_actions", pop_cap="api/routers/notebook_ai_actions.py"),
    "api/services/journal_two/note_semantic.py": Door(
        "member", "meaning search on GET /api/j2/notes (NOTEBOOK_SEMANTIC_SEARCH_ENABLED); sweep",
        "daily_counters notebook_semantic_query_embed 200/member; sweep 2000/run",
        gap="over the cap search silently falls back to word search -- nothing is refused"),
    # ── Compass (journal coach + voice) ──────────────────────────────────────
    "api/services/journal_two/coach_chat.py": Door(
        "member", "POST .../coach/chat/stream + confirm/cancel/onboarding (Compass paywall)",
        "200 messages/member/account/UTC day counted from j2_chat_messages; "
        "compass_cost_guard in-process, off unless COMPASS_COST_CAP_DAILY > 0",
        meter="compass_chat", pop_cap="api/services/journal_two/coach_chat.py"),
    "api/services/journal_two/coach.py": Door(
        "member", "weekly-review / EOD-recap generate + regenerate; scheduler",
        "idempotent per week/day, but regenerate is unbounded; no counter",
        gap="no counter exists to meter; not wired to the population cap in this ticket"),
    "api/services/journal_two/pre_trade_verdict.py": Door(
        "member", "POST .../coach/pre-trade-verdict; a chat tool",
        "nothing", gap="no counter exists to meter; not wired in this ticket"),
    "api/services/journal_two/trade_review.py": Door(
        "member", "trade-reviews generate / regenerate",
        "idempotent per trade except regenerate; no counter",
        gap="no counter exists to meter; not wired in this ticket"),
    "api/routers/voice.py": Door(
        "member", "/api/voice/tts, /oneshot, /transcribe, /session_token (requires_voice_access)",
        "voice_usage_monthly per member per UTC month: A 120 min, B 200 calls, C 100 min, "
        "D 60 min (admins uncapped)",
        meter="voice", gap="monthly per-member caps; not wired to the daily population cap"),
    "api/services/voice_openai.py": Door(
        "shared-client", "OpenAI TTS / Whisper / classify / realtime mint for voice",
        "the voice_usage mode caps at its callers", meter="voice",
        gap="a shared client; its member callers carry the caps"),
    "api/services/voice_intent.py": Door(
        "member", "Mode B one-shot via /api/voice/oneshot",
        "voice_usage mode B 200 calls/month", meter="voice",
        gap="monthly per-member cap; not wired to the daily population cap"),
    "api/services/voice_prewarm.py": Door(
        "background", "scheduled read-aloud prewarm", "disk audio cache"),
    "api/services/voice_chart_vision.py": Door(
        "member", "POST /api/voice/vision/describe, /upload; describe_chart tool",
        "slowapi per-IP 20/min and 10/min only; not counted in voice_usage",
        gap="no counter exists to meter; not wired in this ticket"),
    "api/services/voice_deep_research.py": Door(
        "member", "deep_research tool via POST /api/voice/exec",
        "30-min cache; Perplexity global 500/day; Claude leg uncapped",
        gap="no counter exists to meter; not wired in this ticket"),
    "api/services/voice_embeddings_service.py": Door(
        "member", "voice embeddings reindex/search, KB reindex, memory, documents",
        "slowapi per-IP limits only", gap="no counter exists to meter"),
    "api/services/voice_summarizer.py": Door(
        "member", "background work from POST /api/voice/session/end",
        "60/min per IP only", gap="no counter exists to meter"),
    "api/services/voice_tool_impls.py": Door(
        "member", "web_search / transcript tools via POST /api/voice/exec",
        "Perplexity global 500/day; /exec 120/min per IP",
        gap="no per-member counter exists to meter"),
    "api/services/trader_profile_auto.py": Door(
        "member", "background work from POST /api/voice/session/end",
        "60/min per IP; input capped at 60 turns", gap="no counter exists to meter"),
    # ── Options flow / research / terminal ───────────────────────────────────
    "api/flow_explain.py": Door(
        "member", "POST /api/flow-explain (require_paid)",
        "50/member/ET day in flow_explain.db (in-memory fallback) + $5/day global",
        meter="flow_explain", gap="not wired to the population cap in this ticket"),
    "api/services/ticker_explain.py": Door(
        "member", "POST /api/research/explain/{sym} (get_current_user)",
        "narrative_cost_guard $10/day global, durable", gap="no per-member counter exists"),
    "api/services/research/comparison_ai_adapter.py": Door(
        "member", "POST /api/research/compare/{sym}/{cmp}/explain (get_current_user)",
        "narrative_cost_guard $10/day global, durable", gap="no per-member counter exists"),
    "api/services/company_about.py": Door(
        "member", "GET /api/about/{sym} (get_current_user)",
        "30-day in-process cache only", gap="no counter exists to meter"),
    "api/services/groups.py": Door(
        "member", "GET /api/groups/peers; GET /api/about/{sym}",
        "6h cache + 3 concurrent", gap="no counter exists to meter"),
    "api/schwab_router.py": Door(
        "member", "GET /api/schwab/market-narrative (partner-owned file)",
        "30-min cache + narrative_cost_guard $5/day, durable", gap="no per-member counter"),
    "api/services/calendar_sector_read.py": Door(
        "member", "GET /api/calendar/sector-read (require_paid)",
        "catalyst cost_guard $15 hard, durable; per (sector, week) cache",
        gap="no per-member counter"),
    "api/services/call_recap.py": Door(
        "member", "GET /api/earnings/call-recap/{t}, /sentiment/{t} (require_paid)",
        "catalyst cost_guard; 24h/12h caches", gap="no per-member counter"),
    "api/services/call_recap_grounded.py": Door(
        "background", "call_recap_warmer (scheduler + warm-on-miss)",
        "CALL_RECAP_DAILY_CAP_USD $10/day, durable"),
    "api/services/call_recap_warmer.py": Door(
        "background", "scheduler sweep / batch reaper; warm-on-miss from call-recap routes",
        "CALL_RECAP_DAILY_CAP_USD $10/day, durable"),
    "api/services/cot_narrative.py": Door(
        "member", "POST /api/cot/{symbol}/narrative (require_paid); Friday prewarm",
        "300 generations/UTC day global (cot.db); cached per facts hash",
        gap="no per-member counter"),
    "api/services/definition_concierge.py": Door(
        "member", "POST /api/user-definitions/propose (require_paid)",
        "40/hour/member + $0.75/member/day (in-process) + catalyst member budget",
        gap="in-process windows, not the durable store this meter surface reads"),
    "api/services/definition_conversation.py": Door(
        "operator", "POST /api/user-definitions/converse (require_paid + require_admin: "
        "ADMIN-ONLY while conversational authoring is dark, 2026-10-06)",
        "SHARES the concierge's budget: the same 40/hour/member window + the same "
        "per-member daily $ ledger (in-process), capped at CONVERSE_USER_CAP_DAILY "
        "(default = CONCIERGE_USER_CAP_DAILY, $0.75) or, for role admin, "
        "CONVERSE_ADMIN_CAP_DAILY (default $10) + catalyst member budget; 2 calls max "
        "per turn, 0 HTTP retries, input byte caps refused before any call",
        gap="in-process windows, not the durable store this meter surface reads"),
    "api/services/uct_agent/turn.py": Door(
        "operator", "POST /api/agent/turn (require_paid + require_admin: ADMIN-ONLY while UCT Agent "
        "is dark, 2026-10-07); web_research tool via the shared Perplexity client",
        "UCT_AGENT_DAILY_CAP 300/member/ET day (daily_counters scope uct_agent_turn, durable) + "
        "ai_population_cap 'uct_agent'; narrative_cost_guard surface 'uct_agent' records spend; "
        "<= 3 model calls and <= 2 research calls per turn, 0 HTTP retries",
        pop_cap="api/routers/uct_agent.py"),
    "api/services/screener/nl_compile.py": Door(
        "member", "POST /api/screener/compile (SCREENER_NL_COMPILE_ENABLED, dark)",
        "SCREENER_NL_DAILY_CAP 30/member/ET day (daily_counters scope "
        "screener_nl_compile, durable) + ai_population_cap 'screener_nl'",
        pop_cap="api/routers/screener_nl.py",
        gap="no ai_meters key yet; the durable daily counter is the bound"),
    "api/services/indicator_from_image.py": Door(
        "member", "POST /api/indicator-vision/candidates (INDICATOR_VISION_ENABLED, dark)",
        "10/hour/member in-process + catalyst member budget",
        gap="in-process hourly window, not a daily counter"),
    "api/services/earnings_enrichment.py": Door(
        "member", "inside GET /api/earnings-analysis/{sym}",
        "engine's earnings cache + 60/min per IP", gap="no counter exists"),
    "api/services/engine.py": Door(
        "member", "GET /api/earnings-analysis/{sym}; shared Anthropic client factory",
        "60/min per IP + 12h cache + generate-once store", gap="no counter exists"),
    "api/routers/earnings.py": Door(
        "member", "GET /api/debug/earnings-sources/{sym} (no route auth)",
        "nothing", gap="a debug ping, gated only by OPEN_READS_GATE (off)"),
    "api/routers/modelbook.py": Door(
        "member", "generate-once jobs fired by GET /stock/{id}, /year-recap; admin routes",
        "store-once stamps; no dollar cap", gap="no counter exists"),
    "api/services/significant_catalysts.py": Door(
        "member", "Model Book first view; news-catalysts fallback",
        "store-once / 300 generations/day (news_catalysts.db)", gap="no per-member counter"),
    "api/services/news_catalysts/service.py": Door(
        "member", "GET /api/news-catalysts/{sym} (require_paid)",
        "Perplexity global 500/day + 300/day generation cap", gap="no per-member counter"),
    "api/services/community_ask.py": Door(
        "member", "POST /api/community/chat/channels/{slug}/ask (COMMUNITY_ASK_ENABLED, dark)",
        "20 s cooldown/member in-process", gap="no daily counter exists"),
    "api/services/transcripts.py": Door(
        "member", "GET /api/transcripts/{symbol} (no auth dependency)",
        "10/min per IP + 24h cache", gap="no counter exists"),
    "api/services/perplexity_search.py": Door(
        "shared-client", "Perplexity wrapper (web_search / stream_search)",
        "PERPLEXITY_DAILY_LIMIT 500 calls/ET day global, durable"),
    "api/services/llm_batch.py": Door(
        "shared-client", "Anthropic batch submit for call_recap_warmer",
        "call_recap $10/day, durable"),
    # ── Catalysts / themes / patterns (scheduler) ────────────────────────────
    "api/services/catalyst/engine.py": Door(
        "background", "catalyst refresh; member self-heal from GET /api/catalysts/today",
        "catalyst cost_guard $8 soft / $15 hard, durable"),
    "api/services/catalyst/sources.py": Door(
        "background", "catalyst refresh discovery", "Perplexity global 500/day"),
    "api/services/catalyst/curator.py": Door(
        "background", "catalyst refresh (CATALYST_CURATOR_ENABLED, dark)", "catalyst cost_guard"),
    "api/services/catalyst/hunter.py": Door(
        "background", "hunt ticks (CATALYST_HUNTER_ENABLED, dark)", "catalyst cost_guard"),
    "api/services/catalyst/rule_learner.py": Door(
        "background", "nightly learner; admin learn-now", "catalyst cost_guard"),
    "api/services/catalyst/synthesize.py": Door(
        "background", "catalyst refresh synthesis", "catalyst cost_guard; signals-hash skip"),
    "api/services/theme_engine/improve.py": Door(
        "background", "weekly theme engine (THEME_ENGINE_ENABLED)", "$5/ET day, durable"),
    "api/services/theme_engine/orphans.py": Door(
        "background", "nightly orphan absorption; admin dry-run", "$5/ET day, durable"),
    "api/services/pattern_vision/vision_judge.py": Door(
        "background", "pattern_vision_judge scheduler; admin judge", "$10/day, pattern_vision.db"),
    # ── The Desk / Discord (scheduler + operator) ────────────────────────────
    "api/services/desk_creative.py": Door(
        "operator", "Desk titles/covers (scheduler + PUSH_SECRET routes)", "flags; retry cap"),
    "api/services/desk_session_insights.py": Door(
        "operator", "Desk insights pass (scheduler + PUSH_SECRET)", "flag-gated"),
    "api/services/desk_session_recap.py": Door(
        "operator", "Desk recap (scheduler + PUSH_SECRET)", "flag-gated"),
    "api/services/discord_close_note.py": Door(
        "operator", "index-close Discord post (scheduler + PUSH_SECRET)", "once per session"),
    # ── Evals / offline ──────────────────────────────────────────────────────
    "api/services/compass_eval/judge.py": Door("eval", "report-card judge", "operator-run"),
    "api/services/compass_eval/runner.py": Door("eval", "report-card runner", "operator-run"),
    "api/services/ticker_explain_eval/judge.py": Door("eval", "golden-set judge", "operator-run"),
    "api/services/wisdom/evals/grounding.py": Door("eval", "grounding eval CLI", "$5 per run"),
    "api/services/wisdom/extract/batch.py": Door(
        "background", "wisdom daily extract chain (WISDOM_EXTRACT_ENABLED)",
        "WISDOM_EXTRACT_BUDGET_USD + nightly budget, durable"),
}


def shared_client_paths() -> list[str]:
    """The modules the census follows one hop through."""
    return sorted(p for p, d in DOORS.items() if d.kind == "shared-client")


def member_doors() -> dict[str, Door]:
    return {p: d for p, d in DOORS.items() if d.kind == "member"}
