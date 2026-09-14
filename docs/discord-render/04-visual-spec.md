# 04 — Visual spec: what a member SEES when the path is not at house quality

Inputs: `03-architecture.md` (the mechanism), `01-failure-forensics.md` (what actually broke).
This file owns the **member-facing surface** of degradation — the badge, the footer, the stand-in —
and nothing else. Where a number appears here it is a pointer to the constant that owns it.

⛔⛔ **THE RULE THE WHOLE FILE EXISTS FOR: A DEGRADED ARTIFACT ALWAYS CARRIES ITS LABEL (S8).**
C-06 measured **3 unlabelled stand-ins**, 2 of which never healed — a member was handed a
lower-quality chart and told nothing, so they read it as the product. An unlabelled stand-in is
worse than a failure message: a failure is honest and a silent substitution is not.

⛔⛔ **AND THE BADGE MUST BE RARE, OR IT IS FURNITURE.** The opposite failure is just as real: the
first freshness design used a fixed age budget, which would have drawn a STALE badge on every chart
all weekend (§3.8b). A badge that shows when nothing is wrong teaches everyone to ignore it, and
then it is not there on the day it matters. **Every rule below has to answer "how often does this
appear when the system is healthy?" and the answer has to be "almost never".**

**The one owner of every sentence in this file is `api/services/discord_render/badge.py`**
(`contracts.BadgeRenderer`). Rail: `tests/test_discord_render_badge.py` — which asserts the
**rendered text**, never that a function was called.

---

## 1. The three things that can be off, and they are independent

| | What it means | Where it comes from | Member sees |
|---|---|---|---|
| **Vintage** | the DATA is behind the session it should be at | `freshness.Envelope.stale` (§3.8b) | the STALE badge + `as_of` in the footer |
| **Quality** | the picture is not the house render | the renderer adapter failed; a stand-in was drawn | the stand-in label |
| **Provenance** | the answer did not come from the usual source | `Result.provider` / `degraded_reasons` (`cached`, `in_process`) | a footer clause |

⛔ **They do not collapse into one "degraded" flag.** A fresh stand-in and a stale house chart are
different products with different remedies, and a member acting on one is not making the same
mistake as a member acting on the other. The old path had a single "something went wrong" and it is
why C-08 and C-06 both took two weeks to name.

## 2. The STALE badge

`badge.render_badge(result) -> str | None`.

- **Drawn when** `Result.stale is True` — never on `None`. ⛔ **Unknown vintage draws NOTHING.** An
  absent badge means "we have nothing to tell you"; a badge saying "fresh" that nobody measured is
  the failure this rule exists to prevent, and `stale=None` is deliberately not `False` (§3.8b).
  The guard is `is True`, not truthiness: `if result.stale:` reads `None` as falsey and is *right by
  accident*, which lasts until somebody makes the unknown case explicit and inverts the test.
- **Text:** `Envelope.badge` — `⚠ data as of {as_of_et} ET (stale)`. One owner; the message content,
  the house page (`?stale=`) and the stand-in all read that, never a second copy of the sentence.
  `render_badge` **selects** it and does not compose it.
- **A stale verdict with no readable `as_of_et` draws nothing.** A warning with no timestamp in it
  tells a member something is wrong and nothing about what.
- **Never on a closed market unless the session is genuinely missed.** The session rule, not an age.
- It is duck-typed on `.stale` / `.badge`, so a bare `Envelope` (what a cached artifact carries)
  reads through the same accessor. A second accessor for the cache path would be a second place the
  rule lives.

## 3. The stand-in

`badge.standin_label(cls) -> str` → **`⚠ simplified chart — {contract.plain(cls)}`**.

- Drawn only when the renderer adapter returns a failure — in practice `renderer_unavailable` or
  `deadline` (`badge.STANDIN_CLASSES`, a *subset* of the table, never a second one).
- **Always labelled**, in the message content, not only in the image — an image label is invisible
  to a screen reader and to anyone who has images off, which is the same member C-06 failed.
- The label names the *class*, not the exception: **`contract.FAILURE_CLASSES` is the one table and
  it is deliberately NOT copied here.** A copy is a second authority over the one string a member
  reads, and it would drift the first time a class is added. What a member reads for each class is
  therefore pinned by derivation, not by transcription:
  `test_every_failure_class_has_a_stand_in_sentence_from_the_one_table` parametrises over
  `contract.FAILURE_CLASSES` itself, so a class added tomorrow is covered the day it lands.
- Worked examples, in full, so a copy change has to be argued for here:

      renderer_unavailable  →  ⚠ simplified chart — the chart renderer is unavailable
      deadline              →  ⚠ simplified chart — the chart service took too long

- ⛔ **An unrecognised class normalises to `internal`** (`⚠ simplified chart — something went wrong
  on our side`) rather than being interpolated raw. There is then nothing for an exception string, a
  traceback or a URL to leak through — the rule `contract.py` already states for failure messages,
  holding on this surface too.

## 4. The footer

`badge.render_footer(results, corr_id) -> str`. One line, and it only appears when it has something
to say. Order: **vintage · provenance · id**.

    {Envelope.badge} · {provenance clause, only when not the usual source} · id {corr_id}

- ⚰️ **The vintage clause IS the badge sentence, not a bare `{as_of_et} ET`.** This file sketched
  the bare form while §2 assigned the sentence one owner — two shapes for one clause, in one
  document. There is one sentence and `Envelope.badge` owns it.
- **Vintage, never the wall clock** (§3.10) — the same closed-market input must render the same
  pixels, which it cannot do if the footer carries "now".
- **`id {corr_id}` is always present on a degraded or failed delivery** and is what a member quotes;
  it is the join to the durable jobs row. ⛔ It is printed whenever we have one and is **never
  filtered through a format check** — dropping the id because it failed a regex loses the one thing
  this line exists to carry, on exactly the delivery that needed it.
- **Provenance copy: `served from a slower backup source`.** ⭐ Named, not "degraded": "degraded" is
  a word that means nothing to a member and everything to us. It fires on `Result.provider` in
  `badge.BACKUP_PROVIDERS` (`in_process`, `cache`) **or** the `cached` reason — both signals are
  read, because a cache hit is labelled by the layer that CHOSE the cache, which is not always the
  layer that reports itself as the provider.
- **A failed result is not a provenance clause.** A failure is not a delivery from somewhere else;
  it is the failure message's business (§3.5).
- ⛔ **When two upstreams are stale, the OLDEST vintage is the one printed**, with the upstream's
  name as the tiebreak. "Whichever was recorded first" makes the sentence depend on adapter call
  order, which is not part of the input — and §3.10 says the same input renders the same pixels.
  The delivery is as old as its oldest stale part, which is also the honest thing to tell a member.
- **Nothing at all when nothing is wrong.** No `as_of` on a healthy chart, no "checked", no
  reassurance, and no bare id — an id on every delivery is furniture with an id in it.

### 4b. Putting it on the message — `badge.stamp(content, footer)`

- ⛔⛔ **WHEN IT DOES NOT FIT `contracts.CONTENT_MAX`, THE CONTENT IS TRIMMED AND THE STAMP IS
  KEPT.** The other way round is the S8 violation with extra steps: a full-length reply whose last
  clause fell off is exactly the unlabelled stand-in C-06 describes, and it happens only on the
  longest replies — which are usually the most degraded, so the failure concentrates precisely where
  the label matters most.
- ⛔ **Idempotent, and more than idempotent.** `produce_chart` edits the same message more than once
  (a stand-in, then the real chart). Appending on each pass warns the member twice, **and a test
  that calls it once cannot see that** — so the rail stamps twice and three times. A stamp written
  on an earlier edit is *replaced*, not repeated, so a second pass whose vintage or provenance has
  changed leaves one line rather than a transcript of everything that happened on the way. Our own
  line is recognised by its trailing `· id <x>`; the failure contract's copy ends in `retry?`, so
  the two cannot be confused.
- ⚠️ **Stated limitation:** with no id in hand (a healthy second edit, footer `""`) nothing is
  stripped, because there is then nothing distinguishing our line from a member-facing sentence and
  guessing would eat somebody's content. Railed as a decision, not left as a surprise.

## 5. `/flow`'s degraded card

The card is the same delivery as a chart and carries the **same footer** — there is no `/flow`
dialect. Two `/flow`-specific rules, both already load-bearing upstream and restated here only
because they decide what a member reads:

- ⭐ **An empty tape is an ANSWER, not a failure** (§3.8c). A quiet session with no significant
  options flow is true and useful; the router already owns that sentence and its window phrase. It
  comes back `ok` with `contract_count == 0`, so it draws **no** footer — a quiet day is not a
  degraded delivery and labelling it as one would teach members to distrust the quiet days.
- **A served in-process fallback is a delivery, and it says so** — `served from a slower backup
  source`, plus the id. It is not counted as a failure (S8: a labelled stand-in is a delivery), which
  is why `/renderhealth` reports house-quality rate *beside* success rate.

## 6. The goldens

`docs/discord-render/instruments/golden_capture.py` captures the **pre-V2** reply payloads on
closed-market data with deterministic stubs; `tests/test_discord_render_goldens.py` diffs a fresh
capture against the stored goldens at **zero drift**. What they are for, and what they are not:

- ⛔ **They prove the pre-V2 path is byte-for-byte unchanged**, which is the P2 ground rule: with
  `DISCORD_RENDER_V2_ENABLED` unset, member-visible behaviour is identical. They do **not** pin the
  V2 copy above — that is `tests/test_discord_render_badge.py`'s job, and a golden of copy nobody
  has shipped yet pins a guess.
- ⛔ **Capture determinism is asserted FIRST.** The harness runs the capture twice back to back and
  refuses to compare against a stored golden unless the two agree. A golden harness whose own output
  varies proves nothing — it fails on wall clocks and passes on real regressions.
- ⛔ **No network, and the stub is part of the golden.** PNG bodies are hashed, not stored: a
  committed binary that nobody can read is a fixture that cannot distinguish a render change from a
  library upgrade.

## 7. Status

✅ **The copy has one home (2.7, 2026-09-13).** `api/services/discord_render/badge.py` owns the
badge, the provenance clause, the footer order, the stand-in label and the stamp;
`tests/test_discord_render_badge.py` asserts the rendered text of each.
⛔ Do not add a fourth place that decides what a member reads — if a new surface needs a sentence, it
comes from `contract.FAILURE_CLASSES` or `Envelope.badge`, through `badge.py`.

⏳ **Open, and named so it is not mistaken for done:** `adapters/bindings.py` still holds its own
`stamp_suffix` / `stamp` — the same rules, a second implementation. **Lane A swaps it over to
`badge.py`**; until that lands there are two copies of this copy, which is the defect this file
exists to prevent. The output of `badge.render_footer` is byte-identical to `stamp_suffix` for every
case the existing rails cover, so the swap is a deletion and not a behaviour change.
