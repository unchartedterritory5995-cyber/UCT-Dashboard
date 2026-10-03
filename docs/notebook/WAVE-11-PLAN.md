# Notebook wave 11 and after: the owner's next scope (2026-10-01)

Owner direction, in chat, 2026-10-01. Recorded by the controller; it extends `NOTEBOOK-10-OF-10-PLAN.md` and does not replace it.

> "These top 2 things sound really awesome": an AI that acts across the workspace, and formulas / rollups / automations on note properties.
> "These sound awesome as well": voice and meeting notes, formulas and rollups, a trade-plan canvas.
> "I do want to have a full UCT Intelligence app for the App Store and Android soon."
> "The plugin marketplace sounds cool, but might be difficult."
> After everything in the plan: "better, more robust, detailed and thorough templates. People like to be handheld. People also like to create. So a marketplace or community templates."
> "I want every single avenue and bit of functionality and every possible feature and use case tested thoroughly before the build is 100% complete. Every click and type and feature tested in a variety of ways and scenarios. EASY is the key."

## Order

1. **Finish wave 10.** The quiet-box readings (typing, the scale curve), the Screener / COT / Model Book capture doors (lane CX, G-040), the L15 rollback chain, and L16.
2. **Wave 11: trader features.** Up to three lanes at a time:
   - **11A, voice and meeting notes.** Record in the browser, or upload an audio file (a voice memo, a trading-room call), or pick a Desk session that already has a transcript. Produces a note with the transcript, a short summary, the tickers mentioned (linked), and action items as tasks.
   - **11B, formulas and rollups on note properties.** A `formula` property computed from the note's own number properties (R-multiple, risk per share, position size) through a small safe expression language; never `eval`. A `rollup` property that summarises a property across a set of notes or linked trades (count, sum, average, min, max, win rate). Sortable and filterable in the table view.
   - **11C, an AI that acts across your notes.** One request ("update my thesis notes for everything reporting this week", "tag every note that mentions NVDA earnings") becomes a planned list of changes. The member sees every change before anything is written, can approve or reject each one, and every applied change is undoable from version history. This builds on Compass's preview-then-confirm actions and Ask's retrieval.
   - **11D, a trade-plan canvas.** An infinite board holding notes, live or frozen charts, price levels and arrows, saved as its own note type and linkable from a thesis.
3. **Wave 12: templates.** A much deeper built-in library for traders: trade plans by setup, earnings prep, post-mortems, weekly and monthly reviews, sector notes, position tracking with the 11B formulas already wired in. Each template comes with a short walkthrough. Then members save their own notes as templates, share them, and browse a community template gallery (reviewed before publishing; no code, so no plugin security risk).
4. **Wave 13: the full test program.** Built as a standing suite, not a one-off. Every surface and every control is driven in a real browser by mouse, keyboard and touch, at phone, tablet and desktop sizes. Every workflow is run end to end from a new member's first minute (capture, write, organise, search, ask, share, export, restore). Each step is timed against an "easy" bar: steps to complete, time to complete, and whether a first-time user finishes unaided. Plus the error paths (offline, slow network, a locked note, a full quota) and the trader scenarios, run at real scale (50,000 notes).
5. **The native apps** (UCT Intelligence on the App Store and Google Play). A separate program, with its own plan, after wave 13.
6. **A plugin marketplace.** Deferred. Community templates (wave 12) deliver most of the value without running other people's code.

## Rulings that apply to every lane

- Every new feature ships behind its own flag, dark first, and is armed only after its real-browser walk passes.
- Anything AI-written is labelled as such (the provenance labels from G-064), and nothing an AI proposes is written without the member's approval.
- Audio and note text sent to an outside model follow the same vendor terms the Notebook already uses (Anthropic for writing and summaries, OpenAI Whisper for speech), with the same daily cost caps (`daily_usage_counters`).
- No feature lands without tests that would fail if it broke, a real-browser proof, and a keyboard path.
