# Core Golden Journey #4 — Plain Language (AI Concierge) Door

Fourth Core Golden Journey (addendum item 4). This journey's mandated focus, per this wave's instructions:
verify the AI's interpretation is visible/inspectable, and that deterministic compilation — not the model's
own free text — remains the final authority over what actually executes. **This journey did not complete a
live model round-trip** — a real, environment-specific limitation, explained below — but it surfaced a real,
environment-independent product defect on the way, and code-level evidence answers the two mandated
questions directly, with the limits of that evidence stated plainly rather than glossed over.

## What happened, in order

1. Opened "New formula" → typed `close above the 50 day moving average` into "Describe the indicator in
   plain English" → clicked "Draft a formula". Result: **"The assistant could not be reached just now.
   http:400."**
2. Captured the real network request (`read_network_requests`, then a `fetch` monkey-patch to get the exact
   payload the frontend sent): `POST /api/user-definitions/propose`, **400**.
3. Reproduced the same call directly via `javascript_tool` with a minimal, clean body
   (`{prompt, kind: null, bars: []}`) — **200**, body `{"ok":false,"gate":"model:transport","reason":"the
   formula assistant could not be reached"}`. This matches the router's own documented contract exactly
   (`api/routers/user_definitions.py`'s `propose_definition` docstring: *"A REFUSAL IS A 200 WITH ok: False,
   NOT A 4xx"*) — so the clean-body case behaves correctly. The real UI's 400 was therefore not that
   contract firing; something upstream of it was different.
4. Diffed the two: the real UI's captured request body carried **`bars` with 8,000 entries**, spanning
   `1994-11-21` to `2026-09-04` — SPY's entire loaded daily history, not the visibly-zoomed range. Server
   caps this at `MAX_PROPOSE_BARS = 5000` (`api/routers/user_definitions.py:82`) and rejects anything over
   that with a raw `HTTPException(400, ...)` **before `definition_concierge.propose()` is ever called** —
   bypassing the very "refusal is 200, not 4xx" contract the same file documents two dozen lines away.
5. Tried switching the chart's visible range to "1Y" (from whatever loaded "Origin" state it was in) and
   retried — **still 8,000 bars, still 400**. The chart's internal cached bar buffer is not reduced by the
   visible zoom/range-button state; a symbol with decades of daily history keeps that whole buffer loaded
   regardless of what the user is looking at. This is not a sandbox artifact — any real member with SPY (or
   any similarly long-listed symbol) on a daily chart would hit the identical 400, unconditionally.
6. Checked whether the underlying model call itself could succeed at all in this environment, independent
   of the bars bug: `api/services/engine.py`'s `_get_anthropic_client()` raises `RuntimeError` if
   `ANTHROPIC_API_KEY` is unset, and this session's own shell environment (which the isolated backend
   inherits — `conftest.py`'s redirect is scoped to data-path variables only, confirmed by reading
   `SHARED_ROOT_ENV_REDIRECTS`, not credentials) has no such key set (`echo $ANTHROPIC_API_KEY` → empty).
   This is a genuine, separate, environment-specific limitation, not a product defect: a local isolated dev
   sandbox has no reason to carry a live LLM credential, and none was provided for this program.

## Finding: a real, reproducible bug, independent of the environment limitation

**The plain-language door 400s on any symbol whose cached bar history exceeds `MAX_PROPOSE_BARS` (5,000),
instead of the graceful refusal the code elsewhere promises.** This is confirmed two ways: (a) the clean
direct request with `bars: []` got the correctly-designed 200/`ok:false` response, proving the pipeline
itself handles "no context" gracefully; (b) the real UI's 8,000-bar request got a raw 400 with no `sentence`,
no `gate`, no inspectable reason — just a generic transport-sounding message that actively **misrepresents**
the actual cause to the user (a client-side payload-size problem, not "the assistant could not be reached").
This is worth flagging clearly: for the exact requirement this journey was asked to verify — is the AI's
reasoning visible and inspectable — the honest answer for this specific, common failure mode is **no**: the
member sees a message that sounds like a network hiccup and invites retrying, when retrying will fail
identically every time on this symbol until the chart's cached range shrinks below 5,000 bars by chance.
Logged as **RISK-016** in the risk register, not fixed here (Phase Zero authorization).

## What the code says about the two mandated questions (evidence ceiling: code-level, not live-verified)

**Is the AI's interpretation visible/inspectable?** Yes, by construction, per `definition_concierge.py`'s
`sentence_for` (line 1329): *"An AST -> one English sentence, deterministically. THE ONLY PRODUCER... NO
CLOCK, NO LOCALE, NO NETWORK, NO MODEL RESPONSE. This is a pure function of the tree and the manifest, and
the only reason `propose` can promise the user that the read-back describes the maths that will run."* The
read-back sentence a member sees is generated FROM the compiled AST after the model call, not carried over
verbatim from the model's own prose — so there is no path for the model to say one thing in its explanation
and the compiled tree to do another; the explanation is derived from what will actually run, not from what
the model claims will run.

**Does deterministic compilation remain final authority?** Yes, per two independent pieces of code evidence:
(a) `propose_definition`'s own docstring: *"IT STORES NOTHING. A proposal is a suggestion the user has not
confirmed... The client shows the read-back, the user accepts, and the ordinary `POST ""` / `PUT /{def_id}`
doors do the writing — through the same validation everything else goes through."* A model-authored proposal
is never itself the source of truth; it must pass through the exact same save/validate path as a
hand-written formula from the Formula tab before anything persists. (b) `sentence_for`'s determinism (above)
means even the explanation shown alongside the proposal is compiler-derived, not model-derived.

**These are code-level findings, not this journey's own live observation** — flagged explicitly at 1 (Unit),
not 4 (End-to-End), on the Validation Coverage Map, same as before this journey. This journey adds a
*negative* live data point (the 400 bug) and *narrows* what remains genuinely unverified (the model call
itself, and whether an ACCEPTED proposal's `sentence` and `ast` in practice describe the same computation a
real member would recognize as "what I asked for") rather than closing either question.

## Classification

- **Live model round-trip (paste a description → get a real AI-drafted formula → inspect → save → reload →
  screener)**: **ENVIRONMENT-BLOCKED.** No `ANTHROPIC_API_KEY` is configured in this isolated sandbox. This
  is not worked around by pointing the sandbox at a live/production key — doing so would risk real spend and
  real model calls against firm infrastructure from a throwaway verification environment, which is outside
  this wave's safety posture. **What would resolve this:** a scoped, low-limit API key provisioned
  specifically for Phase Zero browser verification, or running this specific journey against a
  non-production environment that already has one configured.
- **The bars-cap 400 bug**: **VERIFIED, live, reproducible, environment-independent.** Not blocked by
  anything — confirmed by direct request comparison, not inferred.
- **"Interpretation visible" / "compilation is final authority"**: **PARTIALLY VERIFIED at the code level
  only** (Unit, not End-to-End) — the design is sound and specific on paper; nothing observed live
  contradicts it, but nothing live confirms it running correctly with a real model response either.

## What this journey did NOT cover (explicitly, so it isn't assumed later)

- Any real AI-drafted proposal's actual content, accuracy, or the model's choice of e.g. SMA vs EMA for an
  underspecified phrase like "moving average" (this journey's chosen test phrase was picked specifically to
  probe that ambiguity, but never got far enough to observe the answer).
- An ungroundable-word refusal (`conceptVocabulary.json`'s documented "an unfamiliar word is refused by
  name, never approximated" behavior) — seen only in code, never triggered live.
- The kind:unknown / kind="scan" path.
- Whether a *shorter*-history symbol (avoiding the bars cap) would still hit the same `model:transport`
  block for the same missing-credential reason — not tested, since the credential gap makes the answer
  knowable in advance (yes, it would) without spending a browser step on it.

## Housekeeping

Sandbox/backend/frontend still carried forward into Golden Journey #5 (screenshot door), which — per code
inspection performed in this same pass (`api/routers/indicator_vision.py` imports the same
`MAX_PROPOSE_BARS` and the same `_get_anthropic_client`) — is expected to encounter the same two limitations
(a possible bars-cap interaction and the same missing-credential block). Confirmed or refuted directly in
that journey's own document rather than assumed here.
