# Earnings Call — transcript reachability, segmentation fidelity, real search, grounded depth

**Date:** 2026-08-08
**Branch:** `feat/call-transcript-depth` (worktree `C:\Users\Patrick\uct-worktrees\call-transcript`)
**Surfaces:** research modal Call tab (`components/research/sections/CallSection.jsx`),
`components/calendar/CallRecapSection.jsx` (shared by the modal, `pages/calendar/MyStocksHub.jsx`,
`pages/research/tabs/CallsTab.jsx`)

## Origin

Owner report, with a DIS screenshot showing the Call tab: *"missing a bit of detail for the
earnings call recap and transcript… especially the quotes and forward looking commentary. Also
the full transcript text search does not work properly as it should."*

Owner asked that Quartr's product be used as the reference for transcript/live-call/search
behaviour. Owner picked: transcript-grounded Opus recap (over two-pass or richer-Perplexity),
and match-navigation + optional filter (over filter-only or jump-only).

## The core defect

`CallSection.jsx` renders the transcript **only inside the AI recap branch**:

```jsx
if (!recap) { return <EmptyState title="No call recap yet"
                       hint="No transcript yet — typically posts within 2h of the call." /> }
return <CallRecapSection recap={recap} audio={audio} ticker={sym} />   // owns the transcript panel
```

The verbatim transcript is an **independent** source (FMP Ultimate: uncapped, cached 30d,
no LLM). Binding its visibility to an LLM artifact means any recap failure hides a working
free data source. `CallSection.test.jsx` pins this: `expect(screen.queryByTestId('call-recap')).toBeNull()`.

The empty state also **asserts a fact it never checked**. Measured against the owner's exact
screenshot on 2026-08-08:

```
DIS earning-call-transcript-dates → 81 quarters
newest: {'quarter': 3, 'fiscalYear': 2026, 'date': '2026-08-05'}
transcript content: 51,075 chars / 8,471 words
```

Three days of published transcript, rendered as "No transcript yet".

## Measured segmentation defects (`api/services/fmp_transcripts.py::_SPEAKER_RE`)

Run against seven live transcripts on 2026-08-08.

**D1 — comma in a speaker name drops the turn.** `_SPEAKER_RE` allows only spaces between
name words, so `Benjamin Daniel Swinburne, C.F.A.:` never matches:

```
DIS 2026Q3: 46 real turns (46 of 46 non-empty lines) — current regex finds 24
MISSING: 'Benjamin Daniel Swinburne, C.F.A.' × 22 turns (the entire Q&A moderation)
```

Those 22 turns merge into the preceding executive's segment ⇒ **~half the call is attributed
to the wrong speaker.** A verbatim quote carrying the wrong name is worse than a paraphrase.

**D2 — the sentence-boundary branch glues text onto names.** `(?<=[.?!])\s+` lets a match
start mid-line, capturing the prior turn's trailing word as part of the name:

```
AAPL ONLY-current: ['Thanks.\n\nTim Cook', 'Thanks.\n\nSuhasini Chandramouli']
JPM  ONLY-current: ['Thanks.\n\nJamie Dimon', 'Thanks.\n\nJeremy Barnum']
```

Speaker headers render as "Thanks. Tim Cook", and one human becomes two identities — which
silently breaks any speaker filter or role map built on top.

**D3 — `title` and `sentiment` are structurally dead on the primary path.** `_segment()` hardcodes
`title: ""` and `sentiment: None`, so the transcript UI's title and sentiment chips never render
on FMP (only the AV fallback ever supplied them).

Line-anchoring the boundary and allowing comma/credential groups was **equal-or-better on all
seven tickers, never worse** (AAPL/NVDA/MSFT/JPM/WMT/COST unchanged turn counts with fragmentation
removed; DIS 24 → 46).

## Other confirmed defects

| # | Defect | Evidence |
|---|---|---|
| D4 | Search crashes when a recap has quotes | `CallRecapSection.jsx:168` — `(q.text \|\| q).toLowerCase()`; the prompt (`call_recap.py:132`) emits `{topic, quote}` so `q.text` is undefined ⇒ `q.toLowerCase is not a function` |
| D5 | Quotes render empty without search | same shape mismatch; `q.text` undefined ⇒ `""` with no speaker |
| D6 | Sentiment badge is dead | backend emits `positive\|negative\|mixed\|neutral`; component tests `'bullish'`/`'bearish'` ⇒ always neutral-styled. `CallSection.test.jsx` fixture uses `'bullish'` — a value production never emits |
| D7 | `guidance` renders twice | chip at `CallRecapSection.jsx:~232` + a `GUIDANCE` prose block at `~256` whose whole body is the bare enum word |
| D8 | One transient failure blanks the recap for 24h | `call_recap.py:177` caches `"__null__"` at `_RECAP_TTL` (24h) on the exception path |
| D9 | Two AI systems answer one question | `get_call_recap` and `get_sentiment` each fire their own `_pplx_earnings_highlights` — double spend, and the gauge can disagree with the recap beneath it |
| D10 | Transcript search never filters, counts or scrolls | only highlights; a 100+ turn transcript looks inert |
| D11 | Q&A boundary phrase absent on 3 of 7 | DIS, MSFT, JPM contain no `question-and-answer` marker |
| D12 | `quarter` param is unreachable | `useTranscript` accepts it; no caller passes one. DIS has 81 quarters |

## Design

### Phase 0 — reachability + fidelity (no LLM, ships alone)

1. **Unbind the transcript from the recap.** `CallSection` renders the transcript panel whenever
   a transcript resolves, recap or not. Recap absence degrades to "no recap", never to "no transcript".
2. **Empty state stops claiming what it didn't check** — the "no transcript" copy renders only
   after a transcript fetch actually resolved empty.
3. **Segmenter rebuild** (`fmp_transcripts.py`):
   - Line-anchored boundary (`\A|\n+`) — kills D2.
   - Allow comma/credential groups in names — kills D1.
   - **Letters only**, not `\w`: `\w` admits digits, so `Q3:` would become a speaker.
   - Keep a candidate speaker only if it occurs **≥2 times**, OR is a role word
     (Operator/Moderator), OR opens the transcript — drops one-off false hits like `Revenue:`.
   - **Ladder, never lose text:** line-anchored → current regex → single whole-transcript segment.
4. **Failure TTL 24h → 10 min** (D8).

### Phase 1 — search that works

5. Search moves **into** the transcript panel: live match count (`3 / 47`), `↑`/`↓` + Enter to
   jump and scroll-into-view, active match styled distinctly from other hits, **"Only matching
   turns"** toggle, and speaker names are searched alongside content.
6. **Debounced** (~150ms) + memoized — highlighting 50k chars on every keystroke is real jank.
7. `highlight()` rewritten to index parity (drops the `g`-flag `.test()` statefulness — latent
   fragility, not the cause of the reported failure).
8. **Quarter selector** in the transcript header, fed by `earning-call-transcript-dates` (D12).
9. Fix D4/D5/D6/D7 via a single canonical shape (below).

### Phase 2 — grounded depth

10. `get_call_recap` becomes transcript-first; Perplexity remains the fallback for names with no
    transcript. New fields: `forward_looking[]`, `guidance_detail`, structured `qa_highlights[]`,
    `speakers{name: role}` (fills D3's dead chip).
11. **The model never emits a segment index.** It returns verbatim text; the *server* locates that
    text in the transcript and computes the index. Unlocatable ⇒ **dropped, not rendered**. Derive,
    never restate.
12. **Sentiment folds into the same call** (D9), one authority, one spend.
13. **Source links (Quartr):** every quote / forward-looking item / Q&A row gets `↳ in transcript`
    → expands the panel, scrolls that turn into view, flashes it.
14. **Own cost budget.** `get_call_recap` currently spends from the *catalyst* daily cap; 600 →
    ~25k input tokens is ~40×, so a morning of stepping through reporters could silently disable
    catalyst synthesis. Separate budget line.
15. **No auto-fire on step-through.** Transcript renders instantly; recap serves cached instantly
    and generates only after a dwell threshold. (Precedent: `useEarningsBrief` auto-fired the LLM
    on the next ticker stepped to — real money, broken promise.)

### One canonical shape

`components/research/callRecap.js::normalizeCallRecap` becomes the **single** authority, coercing
old and new payloads into one form (`quotes → {speaker, role, topic, text, segment}`,
`bullets → {text, segment}`), and **all three** call sites route through it — `CallSection` does
today; `MyStocksHub.jsx:244` and `CallsTab.jsx:16` currently pass the wrong wrapper.

This is the repo's most repeated defect class (a second authority over one value). Fixing the
shape in the component would leave the other two surfaces broken.

## Out of scope — and why

- **Audio ↔ transcript time-sync / click-to-play-from-here.** FMP transcripts carry no timestamps
  and `earnings_audio.py`'s Quartr + EarningsCall adapters are stubs. Needs a provider contract.
- **Live real-time transcription during a call.** Same blocker.
- **Cross-company keyword alerts** ("notify me when anyone says 'tariff'"). Valuable, and the
  watchlist alert infrastructure could carry it — but it is its own project.
- **Pre-warming recaps for the day's reporters.** Would turn 40s into 0s; deferred until Phase 2
  measures real latency.

## Verification

The defect class here is a **contract between components** — six comparable bugs on the last
branch survived ~4,000 green frontend and ~7,500 green backend tests. Component tests are
structurally blind to it.

- **Wire test:** cutting the recap→transcript link must go RED while both components stay
  individually correct. This is the Phase 0 gate.
- **Shape test:** fails on the `{topic, quote}` / `{speaker, text}` divergence.
- **Segmenter fixtures:** real DIS/AAPL/JPM transcript excerpts committed; assert 46 turns and
  no glued names. Not synthetic strings — the synthetic case is what passed before.
- **Both directions per numeric/absent field:** absent must not render 0; a genuine 0 must not
  render "—". This class has recurred 8× on the sibling branch.
- Mutation checks require an unmutated control + proof the mutation applied + verdict from the
  process exit code. Quoted assertion text is not evidence.
