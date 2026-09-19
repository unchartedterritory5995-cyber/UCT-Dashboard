# Core Golden Journey #5 — Screenshot (Vision) Door

Fifth and final Core Golden Journey of this wave (addendum item 4). This wave's mandated focus: verify the
product distinguishes inference from exact translation, and never implies source-code recovery when
evidence is insufficient. Like Journey #4, **this journey did not complete a live vision-model round-trip**
— cleanly and honestly ENVIRONMENT-BLOCKED, in a way worth contrasting directly with Journey #4's messier
blocker.

## Fixture

A known-answer image, not an external asset: the current chart itself (SPY, daily, with EMA9/EMA20/SMA50/
SMA200 overlaid and a freshly-added, unmodified prebuilt RSI in its own pane), screenshotted at
`C:\Users\Patrick\AppData\Local\Temp\claude-chrome-screenshots-kgquzL\screenshot-1788552093714-1.png` and
re-uploaded through the product's own Screenshot tab via `upload_image`. Chosen because the exact contents
are independently known in advance (this session added the RSI itself, moments earlier, via the Library
tab) — a genuine known-answer check, same discipline as CGJ#1-#3's corpus fixtures.

## What happened, in order

1. Opened "New formula" → "Screenshot" tab. **Before touching anything else**, read the tab's own static
   copy, present regardless of upload/analysis outcome: *"RECREATE IT FROM A SCREENSHOT — **A picture does
   not tell us the formula.** These are the engine's best guesses at what would draw something like it —
   read what it saw, check the plain-English read-back, and pick one only if it matches."*
2. Uploaded the known-answer chart screenshot via the file input, then clicked "Read the picture".
3. Result: **"reading an indicator from a picture is not switched on — paste the script on the Import tab,
   or build it on the Formula tab — both reach the same engine."** Confirmed via `read_network_requests`:
   `POST /api/indicator-vision/candidates` → **200** (not a 4xx) — the refusal arrived through the correct,
   documented channel.
4. Traced the refusal to its source: `api/services/indicator_from_image.py`'s `vision_enabled()` reads
   `INDICATOR_VISION_ENABLED` from the environment (default: off) — unset in this isolated sandbox, so the
   handler refused before attempting any model call at all. `api/routers/indicator_vision.py`'s own module
   docstring predicts exactly this behavior: *"A flag that gates `include_router` makes the route answer
   405 — a path that exists in the source, is absent from the served app, and reports a verb problem. This
   way the route always exists and an off switch says so IN WORDS, with the variable that turns it on named
   in the sentence."* Confirmed live, not just in code: the route existed, answered 200, and named the
   reason in words a member can act on ("not switched on") rather than a bare verb-mismatch error.

## Finding: this is a materially cleaner failure mode than Journey #4's, and that distinction matters

Both remaining Golden Journeys hit a wall short of a live model call. They are **not the same kind of
wall**, and reporting them identically would understate real engineering quality on this door:

- **Journey #4 (plain language):** an unhandled edge case (8,000 cached bars vs. a 5,000 cap) produced a
  raw 400 that **actively misrepresents** the cause to the member ("the assistant could not be reached" —
  sounds like a network problem; is actually a client payload-size bug) and **bypasses** the codebase's own
  documented "refusal is 200, not 4xx" contract. A real defect (RISK-016).
- **Journey #5 (screenshot):** a deliberate feature flag, off by design in an environment with no
  provisioning for it, refused **through** the documented 200/`ok:false`-shaped contract, naming the exact
  variable a future operator would need to flip. Working as designed. Not a defect.

Both are "I couldn't get past this to see the AI actually run" from this journey's own narrow point of view
— but one reveals a bug and the other reveals correct engineering discipline being exercised on schedule.
Collapsing them into a single "both AI doors are blocked" sentence in the eventual review packet would be a
real loss of signal; recorded here precisely so that distinction survives into synthesis.

## What the code says about the mandated question (evidence ceiling: code-level, not live-verified)

**Does the product distinguish inference from exact translation, and avoid implying source-code recovery?**
Two independent, mutually-reinforcing pieces of evidence, one of them live:

1. **Live UI copy** (step 1 above, observed directly, not inferred from code): the tab's own static text
   states plainly that a picture "does not tell us the formula," frames every result as a "best guess," and
   instructs the member to verify the read-back before trusting it. This is the honest framing the addendum
   asks for, present in the actual shipped product text a member would read, independent of whether the
   underlying model call ever runs.
2. **Code-level**: `indicator_from_image.py` reuses `definition_concierge.sentence_for` for its own
   read-back (confirmed by direct grep: `"sentence": concierge.sentence_for(tree)`, with a comment reading
   *"THE READ-BACK IS THE TREE'S. `sentence_for` can refuse a tree it..."*) — meaning a vision-derived
   candidate is subject to the exact same "the explanation is derived from the compiled tree, never from
   the model's own prose" guarantee Journey #4 documented for the plain-language door. Same architecture,
   same authority relationship between the model and the compiler, reused rather than re-implemented for
   this door.

Both are consistent with a product that treats a screenshot-derived formula as a *candidate requiring
confirmation*, never as *recovered source*. Nothing observed live contradicts this; nothing observed live
exercises the harder case (a genuinely ambiguous or low-quality image, where the "best guess" framing would
matter most) either, since no candidate was ever actually generated.

## Classification

- **Live vision round-trip (upload → candidates → inspect → pick → save → reload → screener)**:
  **ENVIRONMENT-BLOCKED.** `INDICATOR_VISION_ENABLED` is unset in this isolated sandbox. Unlike Journey
  #4's missing-credential block, this is a deliberate, named, in-words-explained product gate, not an
  absent secret — and even if the flag were flipped, Journey #4 already established this sandbox has no
  `ANTHROPIC_API_KEY` either, so a second, independent blocker would remain regardless. **What would
  resolve this**: the same scoped Phase-Zero-only API key noted in Journey #4, plus deliberately setting
  `INDICATOR_VISION_ENABLED=1` in that same scoped environment (never in a shared or production one).
- **Static UI honesty about inference vs. exact translation**: **VERIFIED, live.** Confirmed directly from
  the shipped tab copy, not inferred.
- **Refusal-channel correctness (200/`ok:false`, not a raw 4xx)**: **VERIFIED, live**, and worth noting as a
  positive contrast to Journey #4's RISK-016.
- **"Same engine" / same read-back-authority guarantee as the plain-language door**: **PARTIALLY VERIFIED
  at the code level only** — architecturally sound and specifically confirmed to reuse the same mechanism,
  but never observed running end-to-end with a real image.

## What this journey did NOT cover (explicitly, so it isn't assumed later)

- Any real vision-model candidate's actual content or accuracy — none was ever generated.
- Whether the "best guess" framing holds up against a deliberately ambiguous or low-quality image (the
  addendum's harder, more interesting case) — untested, since no candidate generation ran at all.
- The "Anything you know about it (optional)" hint field's effect on results — present in the UI, unused.
- Whether the bars-cap bug found in Journey #4 (RISK-016) also reproduces on this door's own `_bars_from`
  parser — confirmed at the **code level** to share the identical cap and validation shape
  (`api/routers/indicator_vision.py` imports `MAX_PROPOSE_BARS` directly and re-implements the same
  `len(parsed) > MAX_PROPOSE_BARS` check), which is why RISK-016 was written to name both doors — but this
  specific request never reached that code path live, since the vision-disabled refusal fires first, before
  any bars parsing.

## Housekeeping

This closes the P1 wave of Core Golden Journeys (5 of 5: Pine, thinkScript, TC2000/PCF, plain language,
screenshot). Sandbox/backend/frontend processes and the `vite.config.js` proxy override will be stopped and
reverted now that browser verification for this wave is complete (see next steps in `PROGRESS.md`).
