# Transcript corpus — RG-15 and BRK-09 refuted by measurement, 2026-09-27 01:05Z

**This directory is the single owner of the measurement.** RG-15
(`00-program-control/RESEARCH_GAPS.md`) and BRK-09
(`05-product-strategy/capability-matrix/capability-matrix.md`) point here. ⛔ The ~12
other documents that repeat the refuted claim were **deliberately not edited** — correcting
them would create twelve authorities over one fact, which is the defect this programme
documents repeatedly, and the capability matrix's own convention forbids it (*"This table
is the single owner of these claims… correct this table, not the pointer"*). They are
corrected by reading their owning row, not by editing each copy.

Read live against production on **2026-09-27 ~01:05 UTC** (2026-09-26 21:05 ET),
independently by two lanes, agreeing. All code citations below were read at
`cf4809658` (`origin/master` at the time of writing); every cited file is byte-identical
to that commit.

---

## 1 · The raw readings, verbatim

`GET /api/admin/transcript-index-status`:

```
{"transcripts":2207,"symbols":2188,"oldest":"2026-07-23","newest":"2026-09-24",
 "words":15502995,"db_mb":128.7,"db":"/data/transcript_index.db"}
```

`GET /api/admin/provider-coverage`, the two fields RG-15 bundles:

```
transcript:                    {observed: null, sample: 0, floor: 0.7}
calendar_forward_multisource:  {observed: 1.0,  sample: 4, floor: 1.0}
cycles_completed: 2
last_alert_at: 2026-09-26T23:16:21.146083+00:00
```

Both endpoints are no-auth, read-only, and compute their answer on every request
(`api/routers/earnings_intel.py:479-491`; `api/routers/provider_coverage.py:17-29`).

---

## 2 · What this refutes, and in which direction

### (1) The corpus is POPULATED. "Measured empty" and "unmeasured" are both false.

2,207 transcripts over 2,188 symbols, 15,502,995 words, 128.7 MB. Three arithmetic
cross-checks that the rows hold **full bodies**, not stubs:

| derived | value | cross-check |
|---|---|---|
| words per transcript | **7,024.5** | the length of a real earnings call, not a snippet |
| KB per transcript | **58.3** | `transcript_index.py:40-42` predicts *"~50KB of text"* per transcript — measured value lands on its own estimate |
| span | **63 days** (2026-07-23 → 2026-09-24) | one earnings season |

⭐ It was measurable all along, by an endpoint that computes exactly this
(`api/routers/earnings_intel.py:479-491` → `transcript_index.stats()`,
`api/services/transcript_index.py:250-260`). That endpoint's own docstring states the
reason it exists, and it is the reason RG-15 went 25 days unanswered:

> *"A search that returns nothing looks identical whether the corpus is empty or the term
> is genuinely absent, so the corpus has to be observable."*

### (2) ⛔⛔ The `transcript` coverage field CANNOT REPORT ANYTHING ELSE — verified at source. This is the deeper finding.

n=0 is not a failed reading. It is **the expected reading of a healthy system**, and the
module says so itself, on purpose. See §3.

### (3) `calendar_forward_multisource` has RESOLVED GREEN — `observed 1.0`, n=4, at its floor of 1.0.

RG-15's two bundled fields have **diverged in opposite directions**. The row cannot be
re-run as one question; it must be split. One half is refuted on mechanism, the other is
satisfied on measurement.

---

## 3 · The mechanism — why the `transcript` field is structurally unable to report anything but n=0

⚠️ **The defect is entirely in the downstream READING of this field. It is not a code
defect, and must not be written up as one.** The module documents this behaviour as a
deliberate cost decision, in its own docstring
(`api/services/provider_coverage_monitor.py:46-50`):

> *"`transcript` coverage is measured WARM-ONLY (a bare `cache.get` peek, zero network/LLM
> cost) — forcing a cold transcript generation purely to monitor it would spend real
> Claude-summarization budget on every cycle for no user benefit. A cold cycle with nothing
> yet viewed reports `sample=0` (honest "not measured"), not a fabricated rate."*

Four independent source facts, each of which alone keeps the field at n=0 and off the
alert path:

1. **The denominator is this OS process's memory, not the corpus and not the provider.**
   `_transcript_rate` (`api/services/provider_coverage_monitor.py:473-490`) peeks
   `cache.get(f"transcript_summary_{s}")` per sampled symbol and `continue`s when the key
   is absent — *"never generated this session — excluded, not a miss"* (`:482-483`). `n`
   increments only for symbols whose **AI summary already sits warm in this process**.
   A fresh pod, or any pod where no member has opened a transcript since boot, measures
   nothing. `cycles_completed: 2` means this pod had run two cycles.

2. **It can never be classified as a defect.** `_evaluate_field` returns `None` immediately
   on `observed is None or sample <= 0` (`:326-327`) — correctly, since *"(None, 0) means
   'not measured' — NEVER treated as a 0% reading (`Number(null) === 0` class)"*
   (`:319-320`). The 0.70 floor at `:201` is therefore unreachable while n=0.

3. **It can never acquire a baseline, so the drop detector can never arm.**
   `_recent_baseline` selects `WHERE observed IS NOT NULL` (`:252`). A field that only ever
   writes NULL never populates its own history, so `baseline` stays `None` and the `drop`
   branch at `:335-338` is dead for this field.

4. **Its self-heal never runs.** `transcript` does carry a heal
   (`_heal_transcript`, `:182-185`, spec at `:201`), but the heal is gated `if heal and
   missing` **inside `if defect:`** (`:802-806`). At n=0 there is no defect and `missing`
   is empty, so the heal is unreachable by two independent conditions.

⚠️ **The exact strength of this claim, stated rather than rounded up — because "cannot" is a
strong word and only three of the four points earn it.** Points 2, 3 and 4 are theorems: at
n=0 the field **cannot be classified, cannot acquire a baseline, and cannot reach its heal**,
so it is **structurally unable to fail**, without qualification. Point 1 is a
near-certainty, not a theorem, and the difference matters. The field *could* report n>0 — if
a sampled symbol also happened to carry a warm `transcript_summary_` entry in the same
process. But the sample is 25 symbols per hourly cycle (`:99-100`) drawn from priority
liquid names plus tickers warm under a **different cache family** (`earnings_intel_`,
`_sample_tickers` at `:397-411`), against a 2,188-symbol corpus — so the required
intersection is near-empty by construction, not by luck.

⭐ **And this does not weaken the refutation, because even at n>0 the field would not measure
the corpus.** A warm-cache hit rate over 25 sampled symbols is not a corpus size, and never
was. BRK-09's evidence chain fails on mechanism whichever value this field reports.

⭐ **Derived negative, worth recording:** `_alert` fires only on **newly** breached fields
(`:812-814`, `:826-827`), and `transcript` cannot enter `defects` at all. Therefore the
`last_alert_at: 2026-09-26T23:16:21.146083+00:00` alert was **definitively not** the
`transcript` field. Which field it was is a separate open question — see §8.

**Consequence for the evidence chain.** BRK-09's cited evidence for *"a corpus measured
EMPTY"* was this field's reading. A field that cannot report anything else cannot evidence
emptiness. The row is refuted **on mechanism**, independently of the 2,207 count — which is
why §7's corpus caveat does not disturb the verdict.

---

## 4 · The three n=0 observations are ONE artifact, not three failures

| date | where | provenance |
|---|---|---|
| 2026-08-06 | local | ⚠️ **REPORTED, NOT VERIFIED.** Reported by the delegating lane. A grep of this tree finds no dated record of it; the nearest artifacts are the 2026-08-05/06 data-dependability migration probes, which measure other fields. Recorded as reported so the count is honest, **not** as measured. |
| 2026-09-02 | production | ✅ Verified in-tree: `02-data-providers/railway-flag-state.md:49` — *"transcript: null (n=0)"*, one cycle, sample 25. |
| 2026-09-27 | production | ✅ This read, §1. |

Given §3, three n=0 readings across seven weeks and at least two hosts are **one artifact
of the instrument repeated three times**, carrying no information about the corpus. ⛔ The
tree currently reads them as escalating evidence of a silent failure; they are the same
null, three times.

---

## 5 · The measurement was available all along — and had already shipped on an admin panel

⚠️ **This corrects a framing carried into this task, so it is recorded rather than
quietly dropped.** The brief held that `transcript-index-status` is an endpoint *"the
research tree never names anywhere."* **It is named in three places**, and the strongest
of them is not a mention but a build:

| where | what it says |
|---|---|
| `00-program-control/RESEARCH_GAPS.md:43` | RG-36 lists `transcript-index-status` among fourteen built, correct, **zero-frontend-caller** admin monitors |
| `12-decisions/gates/packet-y-admin-ops-health-visibility-gate.md:68` | row 11 cites it at `api/routers/earnings_intel.py:479-490`, no `Depends`, **0** callers |
| `12-decisions/gates/packet-y-admin-ops-health-visibility-gate.md:213` | CP2 specifies a "Transcript Index" row rendering `newest`, `transcripts` and `symbols` |

⭐ **And CP2 shipped.** RG-36 records packet Y BUILT + MERGED 2026-09-23, `085253963`.
`app/src/components/admin/DataPipelineHealthPanel.jsx` is mounted at
`app/src/pages/Admin.jsx:2040`, and reads **both** endpoints, ten lines apart:

```
:207   const { data: providerCoverage } = useSWR('/api/admin/provider-coverage', …)
:213   const { data: transcriptIndex }  = useSWR('/api/admin/transcript-index-status', …)
```

and renders them as adjacent rows (`:232` "Provider Coverage", `:238` "Transcript Index").

⛔ **So for four days the refutation and the refuted claim sat side by side on one shipped
admin surface, and RG-15 stayed `planned`.** The gap was never instrumentation. It was that
nobody read the row next to the one they were worried about. ⚠️ Note the honest limit of
this paragraph: the panel is **mounted in code**; that a human opened it is not measured,
and no member- or owner-side view event was checked.

---

## 6 · ⭐ What survives — BRK-09 does not vanish, it recuts

Two things survive, both real, both already itemised in the owning file at
`capability-matrix.md:612-614`.

### (a) The operator LANGUAGE is genuinely absent — *"we have FTS5, not an operator language"*

| id | what AlphaSense ships | state |
|---|---|---|
| `FT-058` | boolean document search with proximity operators — `AND/OR/NOT`, `NEAR(n)`, `PHRASE(n)`, `TITLE()`, exact-phrase quoting that suppresses stemming | GAP |
| `FT-059` | Smart Synonyms — concept query expanded to its vocabulary | GAP |
| `FT-060` | section-scoped filing search | GAP |

Unaffected by this measurement: a populated corpus makes the missing query language
**more** consequential, not less. There is now something to query.

### (b) DEPTH — the corpus is BROAD but SHALLOW, with the arithmetic shown

```
2,207 transcripts / 2,188 symbols = 1.0087 calls per symbol
```

**≈ 1.01 calls per symbol — roughly one quarter per company**, not the multi-year history
BRK-09's AlphaSense/Quartr comparison implies. The span confirms it independently:
2026-07-23 → 2026-09-24 is **63 days**, one earnings season.

⚠️ **Two precision points, because the obvious causal story is wrong.**

* The index **is** capped by design at `TRANSCRIPT_INDEX_RETENTION_DAYS=90`
  (`api/services/transcript_index.py:41-44`, enforced by `prune()` at `:263-276`), and the
  comment states the intent: *"bounded deliberately rather than growing without limit on a
  shared volume."*
* ⛔ **But that cap is NOT currently the binding constraint, and must not be cited as the
  cause of the shallowness.** `oldest` is 2026-07-23, which is 65 days before this read —
  **inside** the 90-day window. Nothing has been pruned to the boundary. The shallowness is
  the ingest history, not the ceiling. The ceiling would become binding in a fuller season;
  today it has not bitten. The 1.01 figure stands on its own either way.

### Therefore, the recut row

BRK-09 moves from *"MEMBER-SERVING machinery over a corpus measured EMPTY"* to:

> **A broad but SHALLOW corpus with a keyword index instead of a query language.** 2,207
> full transcripts across 2,188 symbols ship and are searchable; what is missing is depth
> (≈ 1.01 calls per symbol, one season) and an operator language (`FT-058` / `FT-059` /
> `FT-060` — FTS5, not `NEAR(n)`).

That is a narrower and more buildable row than the one it replaces, and it is evidenced
rather than inferred.

---

## 7 · ⚠️ THE CAVEAT, carried rather than buried — there are TWO corpora

The 2,207 figure is the **cross-company SEARCH corpus** (`/data/transcript_index.db`). It
is not established to be the store the member-facing transcript panel renders.

Stated in the brief's own words, which stand: **"The corpus is populated" is PROVEN for the
search corpus and strong-but-INDIRECT for the exact bytes that panel renders.**

⭐ **This read then traced the panel's body path, which the brief recorded as untraced, and
the result sharpens the caveat rather than closing it.** The brief held that
`app/src/components/calendar/TranscriptPanel.jsx` *"receives `transcript` as a PROP and
contains no `/api/` call of its own."* Measured, that is not how it gets its body:

```
TranscriptPanel.jsx:87     const { data: transcript, isLoading } = useTranscript(sym, {…})
useTranscript.js:28        GET /api/earnings/transcript/{ticker}?quarter=
earnings_intel.py:239-279  FMP first (get_fmp_transcript), AlphaVantage fallback
```

So the panel's body path **is** traceable, and it resolves to a **different source
entirely**: a live FMP call (AV fallback), not `transcript_index.db`
(`api/routers/earnings_intel.py:260-279`). The two corpora are separately sourced.

⛔ **What this does and does not change.**

* It does **not** disturb the BRK-09 verdict. BRK-09's cited evidence was the coverage
  monitor, refuted on mechanism (§3) whichever corpus the panel reads.
* It does **narrow** §6(b)'s depth claim to the surface it was measured on. ≈ 1.01 calls
  per symbol is a fact about the **search** corpus — which is precisely the corpus
  `FT-058`/`FT-059`/`FT-060` would run over, so the depth finding lands where it matters.
* ⚠️ The panel's own per-ticker depth is **NOT MEASURED**. The endpoint docstring claims
  FMP Ultimate carries *"83+ quarters of history"* (`earnings_intel.py:247-249`); that is a
  **docstring claim, not a measurement**, and no live per-ticker quarter count was taken.
  If it is true, the panel is not depth-capped at all and `TRANSCRIPT_INDEX_RETENTION_DAYS`
  bounds only search. Settling it needs one read of
  `/api/earnings/transcript-quarters/{ticker}` on a real symbol.

---

## 8 · Open, NOT resolved

| # | open question | why it is not closed here |
|---|---|---|
| 1 | **Corpus FRESHNESS.** `newest` is 2026-09-24; this read is 2026-09-26 21:05 ET, so the newest indexed call is **2 ET calendar days old**. | Plausible in a thin late-September earnings window, **not proven fine**. Distinguishing "no calls to index" from "ingest stalled 2 days ago" needs the expected reporter count for 09-25/09-26, which was not read. |
| 2 | **WHICH field fired the 23:16:21Z alert.** | **Not recoverable from this endpoint.** `_state` keeps only the bare timestamp (`provider_coverage_monitor.py:754-755`); the field names go into the `chart_health_alerts` payload and the Discord ops webhook message (`:732-752`), neither of which was read. ⭐ It was **not** `transcript` (§3, derived). |
| 3 | The panel's per-ticker quarter depth (§7). | Not measured; one endpoint read would settle it. |
| 4 | Whether a human has actually opened the shipped admin panel (§5). | Not measured; no view telemetry checked. |

---

## 9 · Reproduce it

```
curl -s https://<prod-host>/api/admin/transcript-index-status
curl -s https://<prod-host>/api/admin/provider-coverage
```

Both are no-auth and read-only by documented convention
(`api/routers/provider_coverage.py:1-9`). Neither triggers a build, a network fetch to a
provider, or an LLM call. ⚠️ Cloudflare 1010-blocks some curl user agents on this estate;
the shipped admin panel at `/admin` renders the same two payloads
(`DataPipelineHealthPanel.jsx:207`, `:213`).
