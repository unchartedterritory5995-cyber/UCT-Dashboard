# Morning Wire — Voice Upgrade & Agenda Header

**Date:** 2026-03-15
**Status:** Approved

---

## Context

The Morning Wire rundown is AI-generated narrative (700–900 words) via `generate_rundown()` in `morning_wire_engine.py`. The current prompt produces a confident, opinionated brief but speaks to "the reader" as a narrator — not as a team leader addressing his traders. The desired feel is a fund manager opening a pre-market team meeting: direct address, shared ownership, a fast-scan agenda before the narrative, and a closing that sends the team to their desks.

---

## Changes

### A — Voice & Carry-Forward

Three targeted edits to the `system` prompt and `_editorial_directives` in `generate_rundown()`:

**1. Voice instruction update**
Replace the current voice description:
> "Direct, confident, community-facing."

With:
> "Direct, confident, team-leader. Speak as the head of the desk addressing your traders — use 'we', 'our', 'let's'. Not 'traders should watch X' — 'we're watching X here.' Not 'the community' — 'the team'. Ownership is shared. The brief belongs to everyone in the room."

**2. New mandatory opening directive (yesterday carry-forward)**
Prepend as item **0** at the top of the `_editorial_directives` string (before the existing item 1), renumbering is not required — the existing items 1–7 remain unchanged:

> **0. OPEN WITH YESTERDAY'S CARRY-FORWARD**
> The first 2–3 sentences of the brief must address yesterday directly. What happened — specifically. What it means for today's tape. What positions, themes, or setups we're carrying into this session. This is how every pre-market team meeting opens: you don't start with today's macro until the team knows where we stand from yesterday. Keep it tight — 2–3 sentences maximum, then move forward.

**3. Closing reframe**
Replace the current directive 6 example tone:
> "Today is observation with selective engagement. Exposure stays at 29%..."

With:
> "End with a team directive, not a posture summary. Address the room directly. State what we're doing, what we're watching for, and send them to their desks. Example: 'That's the brief. Eyes on NVDA at the open — $135 is the line. If the tape firms and that holds, we add. If it fails, we wait. Exposure stays at 29% until we see follow-through. Let's go.'"

---

### B — Meeting Agenda Header

**Prompt change — insertion point:**
Inside the `system` string in `generate_rundown()`, the existing OUTPUT FORMAT sentence ends with:
> "Just flowing paragraphs — one coherent brief."

Replace that sentence with the following (adds the agenda carve-out and the full agenda block directive):

```
EXCEPTION: The very first element in your output must be a <div class="rd-agenda"> block — see
AGENDA BLOCK below. After that block: plain HTML paragraphs only. No other section header divs,
no card wrappers, no bullet points, no outer wrapper divs anywhere else in the output.

AGENDA BLOCK — OUTPUT THIS FIRST, BEFORE ANY PARAGRAPHS:
Output a single <div class="rd-agenda"> block containing:
  <span class="rd-agenda-label">TODAY'S FOCUS</span>
  <ul class="rd-agenda-list">
    <li>...</li>  (3–5 items)
  </ul>
Each item is one sharp line: the topic, the key level or name, the reason it matters today.
Fragments are fine — no full sentences needed. This is the meeting handout the team scans
before the brief begins. Examples:
  - "NVDA — $135 gap support · earnings follow-through read"
  - "Regime: Rally Attempt day 4 · watching for distribution or confirmation"
  - "CRWV base tightening · pivot watch, catalyst pending"
  - "Exposure: 29% · add trigger = leadership follow-through at open"
Do not repeat these points verbatim in the narrative — the agenda is a preview, not a summary.
After the </div>, continue with flowing <p> paragraphs as the narrative.
```

**CSS addition** (`MorningWire.module.css`):
Add scoped under `.rundownWrap` to survive the existing `* { background: transparent !important }` wildcard reset:

```css
.rundownWrap :global(.rd-agenda) {
  background: rgba(201, 168, 76, 0.06) !important;
  border: 1px solid rgba(201, 168, 76, 0.2);
  border-left: 3px solid #c9a84c;
  border-radius: 4px;
  padding: 12px 16px;
  margin-bottom: 24px;
}
.rundownWrap :global(.rd-agenda-label) {
  display: block;
  font-size: 10px;
  font-family: 'IBM Plex Mono', monospace;
  letter-spacing: 2px;
  color: #c9a84c;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.rundownWrap :global(.rd-agenda-list) {
  margin: 0;
  padding-left: 14px;
  list-style: disc;
}
.rundownWrap :global(.rd-agenda-list li) {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.7;
  padding: 0;
}
```

---

## Files Modified

| File | Change |
|------|--------|
| `C:\Users\Patrick\morning-wire\morning_wire_engine.py` | `generate_rundown()` — system prompt voice instruction, `_editorial_directives` items 0 and 6 |
| `C:\Users\Patrick\uct-dashboard\app\src\pages\MorningWire.module.css` | Add `:global(.rd-agenda)`, `.rd-agenda-label`, `.rd-agenda-list`, `.rd-agenda-list li` |

---

## What Is NOT Changed

- No new API calls — single `generate_rundown()` call, same token budget
- No layout changes to `MorningWire.jsx`
- No changes to `generate_top_picks()` or analyst activity block
- No wire_data schema changes

---

## Verification

1. Run `python morning_wire_engine.py` from `C:\Users\Patrick\morning-wire\`
2. Confirm `rundown_html` opens with `<div class="rd-agenda">` containing 3–5 bullets
3. Confirm narrative opens with a yesterday carry-forward (2–3 sentences about the prior session)
4. Confirm narrative uses "we/our/let's" throughout rather than "traders/the community"
5. Confirm closing reads as a team directive with direct address
6. Open dashboard → Morning Wire tab → agenda card renders as gold-bordered card above prose
