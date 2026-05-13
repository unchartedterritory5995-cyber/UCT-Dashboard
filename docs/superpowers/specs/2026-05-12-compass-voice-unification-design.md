# Compass × Voice — Unification Design

**Date:** 2026-05-12
**Goal:** Merge the Voice Assistant (5 agents, 93 tools, 3 modes) and Compass AI Coach (10 surfaces, 22+ tools) into one unified, institutional-grade AI trading assistant called **Compass**. One brand, one identity, one voice, one memory, one conversation — text or audio.

---

## Vision

The user experiences **Compass** as a single elite-tier AI trading coach:

- It speaks, listens, types, and reads.
- It knows their entire trading history, their profile, their tendencies, their psychology, their playbook.
- It sees the market in real-time and proactively warns them when they're tilting, missing setups, or breaking their own rules.
- It approves or vetoes trades using deterministic risk rules.
- It writes their post-mortems, recaps their days, scouts opportunities, and walks them through pre-trade verdicts — all in one continuous conversation that spans tabs, mics, and pages.
- The user never thinks about "agents" or "modes." They think about Compass.

What lives under the hood — the routing, the 93 tools, the 5 former specialist personas, the proactive daemon, the regime classifier, the position-sizing engine, the hallucination audit, the active learning loops — all of that survives. It just stops being visible.

---

## Architecture: One Agent, Two Surfaces, Three I/O Modes

### One Agent: Compass

A single unified agent with **all 93 voice tools + all 22+ Compass tools** in one allowlist (de-duplicated). No orchestrator routing layer. No specialist handoffs. No latency penalty.

The specialist disciplines (Risk Officer's veto, Coach's behavioral honesty, Analyst's data-density, Scout's filtering, Orchestrator's triage) are **preserved as conditional mandates inside Compass's system prompt** — explicit "when X, then Y" rules the model follows per turn.

### Two Surfaces

| Surface | Today | After unification |
|---------|-------|-------------------|
| **Compass tab** | Text chat + 10 Compass surfaces (Overview, Pre-Trade Verdict, Post-Mortem, EOD Recap, Onboarding, Interventions, Feedback Trimming, etc.) | Adds a mic button → opens Realtime voice session that appends to the same conversation. Surfaces unchanged. |
| **Voice orb** | Global floating orb opens voice-only Realtime session | Opens the **same** Compass conversation, with audio I/O. Conversation history merged with Compass tab. |

Both surfaces read from and write to **one conversation log** and **one memory store**.

### Three I/O Modes (preserved)

| Mode | Use case |
|---|---|
| **Read-aloud** | Compass reads morning wire, earnings transcripts, UCT20 picks, post-mortems, EOD recaps, setup library. |
| **Push-to-talk one-shot** | Quick question → quick answer. Hotkey or tap. |
| **Full Realtime conversation** | Open dialog with barge-in, tool calling, persistent transcript. |

All three modes route to the same Compass agent.

---

## Phased Rollout

### Phase 1 — Compass Agent Foundation (silent, no UI changes)

**Goal:** every voice turn is handled by unified Compass. Orb still looks the same. No user-visible change yet.

**Work:**

1. Write the **unified Compass system prompt** that absorbs the 5 specialist mandates as conditional rules. Structured sections: Identity → Auto-injected Context → Skill Mandates (trade approval, performance review, market analysis, opportunity scouting, post-mortems) → Behavioral Rules → Format.
2. Register `compass` as the default agent in `voice_agents.py`. Tool allowlist = union of all 5 existing specialist allowlists + Compass's 22+ tools (de-duplicated).
3. Wire `session_token` mint to default to `compass` agent.
4. Keep the existing 5 specialists in code as **fallback / shadow A/B variants** for the first 2 weeks. They become invisible to the user but available for prompt-quality regression testing.
5. The Compass Chat backend continues to use its own pipeline for now — only voice sessions route to the new unified prompt. (Compass Chat already has a polished pipeline; we don't disrupt it yet.)

**Files touched:**
- `api/services/voice_agents.py` — add `compass` agent definition.
- `api/services/voice_prompts/compass.py` — new file, holds the unified system prompt.
- `api/routers/voice.py` — default `agent="compass"` if no explicit override.

**Ship gate:** voice quality regression test passes on the existing eval set. Hallucination audit flag rate ≤ current baseline.

---

### Phase 2 — Surface Unification (orb opens Compass conversation)

**Goal:** voice orb and Compass tab share one conversation log.

**Work:**

1. Unify the data model. Either:
   - **Option A (preferred):** create `compass_threads` table with `thread_id, user_id, created_at, updated_at`. Move `compass_chat_messages` and voice `voice_transcripts` to share a `thread_id` foreign key. One thread can contain text + voice + tool calls + proactive messages.
   - **Option B:** keep separate tables, build a "unified view" that joins them by `(user_id, time_window)`. Lighter touch but messier reads.
2. Add a **mic button** to the Compass Chat panel that triggers a Realtime session. The session writes its transcript to the active Compass thread.
3. Change the voice orb to open a slide-out **Compass conversation panel** (not just a transcript bubble). Panel shows recent conversation, lets the user scroll, switch between voice and typing.
4. Bridge the Compass Chat hallucination audit + sliding-window summarizer to also process voice turns in the same thread.

**Ship gate:** typing in Compass tab and speaking through the orb both append to the same `compass_threads` row, and both UIs show all messages.

---

### Phase 3 — Branding, Memory Merge, Voice Picker

**Goal:** the product is fully Compass. Voice is just an input/output channel, not a separate feature.

**Work:**

1. **Rename:** "Voice Settings" → "Compass Settings". "Voice Memory" → "Compass Memory". "Voice Usage" → "Compass Usage". Update all UI labels, page titles, settings sections.
2. **Memory unification:** merge `voice_facts` + Compass `trader_profile` Q&A archive + saved facts into one `compass_facts` store. Dual-write during migration window (~1 week), then cutover. Compass Memory panel exposes the union with category tags (style, risk, account, preferences, behavioral).
3. **Voice picker UI:** new card in Compass Settings. 8 OpenAI Realtime voices (alloy, ash, ballad, coral, echo, sage, shimmer, verse) each with a "Preview" button that hits `/api/voice/tts` and plays a 10-second sample. User picks one. Stored in `compass_settings.tts_voice`.
4. **Proactive behavior:**
   - Inbox always logs every daemon-fired insight (existing behavior).
   - New setting: "Compass can speak proactive alerts (high-severity only)" — default OFF.
   - When ON, regime flips / tilt detection / drift / intervention rule hits trigger a Compass-authored message in the active thread + audio readout if the orb is open.
5. Decommission the 5 specialist agents from the UI selectable list (they stay in code as A/B references for one more cycle, then removed).

**Ship gate:** new user signing up sees nothing about "voice" or "agents" anywhere in the UI. Existing users with saved settings get a one-time migration.

---

## What Survives From Each Side

### From Voice Assistant (preserved verbatim)
- All 93 voice tools (market data, journal deep reads, write actions, chart vision, document Q&A, knowledge base, regime classifier, position-sizing engine, drift detection, temporal awareness)
- RAG memory layer (vector embeddings, cosine recall)
- Within-session scratchpad
- Hallucination audit (post-session forensic check)
- Confidence calibration
- Trace replay + lineage + explainability endpoint
- Reward modeling from 👎 feedback + A/B prompt selection
- Proactive daemon (PM + RTH + AH windows, nightly consolidate)
- Self-recovery hints on tool failures
- Cost observability per mode
- Wake word integration (Picovoice)

### From Compass (preserved verbatim)
- All 10 Compass surfaces (Overview, Chat, Pre-Trade Verdict, Per-Trade Post-Mortem, Real-Time Intervention banner, Active Feedback Trimming, EOD Recap, Onboarding interview, Voice → Compass Bridge, [10th surface])
- 22+ Compass tools (read/analyze/act)
- Preview-confirm flow with elevated-warning pattern
- `trader_profile` structured store + Q&A archive
- Sliding-window summarization
- Adaptive onboarding (10-category intake interview)
- Compass-authored EOD daily recap
- Tilt-detection rule engine (4 rules: rapid_fire, daily_loss_approach, loss_streak, cooling_off_active)
- 👎 feedback → profile refinement loop with preview-confirm

### What Merges
- Conversation history → one thread store
- Memory facts → one `compass_facts` store
- Feedback events → one feedback store (already mostly shared)
- Hallucination audit → runs on all turns (text + voice)
- System prompt → one unified Compass prompt

### What Disappears (from user view)
- Agent picker UI (the 5 specialist orbs/buttons)
- "Voice" as a brand-facing word — replaced by Compass
- Separate "voice settings" page (folded into Compass Settings)
- Separate "voice memory" panel (folded into Compass Memory)
- Manual mode toggling (Compass infers the right mode per turn)

---

## Operating Mode Behavior

Compass infers context per turn — the user never picks a mode:

| Trigger | Compass behavior |
|---|---|
| User opens Compass tab and types | Text-only conversation. Tools run silently. Markdown formatting OK. |
| User clicks orb (or hits hotkey) and speaks one sentence | One-shot voice answer via Realtime API. Plays through TTS. Transcript appends to thread. |
| User clicks orb and holds for conversation | Full Realtime barge-in conversation. Tools called inline. |
| User clicks "Read aloud" on morning wire / transcript / post-mortem | Compass reads it. No conversation, just TTS playback. |
| Proactive daemon fires high-severity insight + voice-enabled | Compass speaks the insight + writes the message to thread. |
| User asks for a trade entry | Compass MUST run `validate_trade` → if ok=true, preview-confirm flow; if ok=false, refuse + quote `refusal_basis`. |
| User asks "how am I doing" | Compass pulls journal psychology + recent mistakes + setup performance + P&L. Names specific numbers. Never gushes. |
| User asks about a ticker or sector | Compass anchors every claim in tool-returned data. Cites the regime. |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Unified prompt dilutes specialist sharpness | Phase 1 keeps the 5 specialists as shadow variants. We run an eval set (e.g. 50 representative turns: 10 trade approvals, 10 performance reviews, 10 market questions, 10 scouting, 10 mixed) on both prompts and require Compass prompt to match or beat specialist quality before Phase 2 starts. |
| Hallucination rate jumps after merge | Hallucination audit runs on all turns; if flag rate goes up, we tighten the system prompt's "anchor every claim in tool data" rule. |
| Conversation thread merge causes data loss | Dual-write during the migration window. Old `voice_transcripts` / `compass_chat_messages` tables stay readable until thread consolidation verified. |
| Memory merge creates duplicate facts | Run cosine de-dup on first merge (≥0.92 = same fact). Compass Memory panel exposes a "review duplicates" surface during migration. |
| Voice orb users miss the agent picker | They didn't ask for it. The picker was a developer feature, never a user requirement. We log the change in release notes. |
| Other Claude instance still tweaks Compass during Phase 1 | Phase 1 is additive — adds a new `compass` voice agent, doesn't touch Compass Chat backend. Zero collision risk. |

---

## Out of Scope (v1)

- Wake word retrained to "Hey Compass" (current "Hey UCT" works; rename later)
- Multi-language support
- Cross-device session sync
- Voice-driven onboarding (text onboarding is fine for now)
- LoRA fine-tune on Compass conversation transcripts (12c deferred, still deferred)

---

## Success Criteria

1. A new user signs up. Lands on dashboard. Sees the orb. Clicks it. Says "what's the market doing today." Compass answers with regime + breadth + top movers + a forward-looking note. No mention of agents, no mode picker, no separate "voice settings" they had to set up.
2. The same user, an hour later, opens the Compass tab. Types a question about NVDA. Sees the morning's voice conversation already in the thread.
3. They click 🧭 Check with Compass on a trade. Compass runs the verdict pipeline, says "HOLD — your daily loss is approaching the rule limit, and this setup historically performs poorly in the current regime." User asks "are you sure?" Compass cites the journal data verbatim.
4. End of day, Compass posts the EOD recap directly into the thread. User clicks read-aloud, listens to it on their walk home.
5. Daemon fires a "rapid_fire" intervention next morning. Compass speaks aloud: "You've taken three trades in the last fifteen minutes. Your rule says step away after two. Take a break." User says "you're right" and closes the orb.

That's the product.

---

## Implementation Order (Phase 1)

1. Eval set creation — pick 50 representative turns from existing voice + Compass transcripts, label each with expected behavior + expected tool calls.
2. Draft unified Compass system prompt (`api/services/voice_prompts/compass.py`).
3. Add `compass` agent to `voice_agents.py` with full tool union.
4. Wire `voice/session_token` to default to `compass`.
5. Run eval set on both prompts (specialist-routed vs unified Compass). Compare quality scores.
6. If Compass matches/beats, ship Phase 1. If not, iterate prompt and retest.

After Phase 1 ships and runs clean for a few days, Phase 2 starts.
