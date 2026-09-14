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

### 2b. How it reaches the house page — `?stale=` carries the SENTENCE (C-07, closed 2026-09-14)

`badge.vintage_param(options) -> str | None` is the one function that turns a freshness verdict into
the value on the render URL, and `discord_chart_house.build_render_url` appends it as `?stale=`.
`ChartRender.jsx` draws what it is handed and composes nothing.

- ⛔⛔ **THE SENTENCE TRAVELS, NOT THE DATE**, and this is the clause to argue with before changing
  it. 03 §3.8 sketches the parameter as `?stale=<as_of>`; §2 above assigns the sentence exactly one
  owner, and those two cannot both be satisfied by sending a date — the page would have to phrase
  the warning itself, which is a second author over the one value a member reads. That is precisely
  the failure C-07 is made of: on 2026-08-31 a chart reached the public channel with the footer's
  wall clock saying Monday beside a stats strip describing Friday. **The wording is
  `Envelope.badge`'s, wherever it is drawn.** (04 owns the copy; where the two documents differ on
  the shape of this parameter, this section is the newer decision and 03 §3.8 the older sketch.)
- ⛔ **ABSENT IS THE DEFAULT, AND ABSENT COVERS THREE DIFFERENT FACTS.** No parameter is emitted for
  a fresh verdict, for an unknown one (`stale is None`), or for a stale verdict with no readable
  `as_of` — the same three cases §2 already refuses a badge for. So "we measured and it is fine" and
  "we did not measure" look identical on the URL, which is correct: in both there is nothing to tell
  a member, and it is what keeps the badge rare.
- ⛔ **THE VERDICT IS THE TRI-STATE, NOT A TRUTHY VALUE.** `options["stale"]` must be literally
  `True`; a truthy string or `1` is a caller who has not measured, and is refused.
- ⛔ **IT IS APPENDED LAST, AND THAT IS BEHAVIOUR.** `urlencode` writes a dict in insertion order, so
  trailing the parameter is what keeps every URL that carries no vintage byte-for-byte what it was
  before this existed. That claim is proved, not asserted:
  `tests/test_discord_render_vintage_url.py` executes `discord_chart_house.py` as it stood at
  `4eec5e0aa` out of git and compares `build_render_url` across eleven option shapes.
- ⏳ **IT IS A CAPABILITY UNTIL SOMETHING PRODUCES IT, AND NOTHING DOES YET.** `build_render_url`
  emits the vintage when `options` carries it, and no production call site puts it there — the one
  seam is `house_opts` in `api/services/discord_interactions.py::produce_chart`, beside the
  `exttag` block, where the newest bar is already in hand as `daily[-1]["t"]`:
  `house_opts["stale"], house_opts["as_of"] = env.stale, env.as_of_et`. That file is not this lane's
  and the wire is two lines. ⛔ Recorded here rather than left to be discovered, because
  *built, tested, green and unwired* is this programme's most-repeated shape — `breakers.py` and
  `freshness.py` were both exactly this for a step and a half.
- ⚠️ **Stated residual:** the page keeps an older, stats-derived clause (`· data as of Aug 28`,
  from `?stats=`'s own `as_of`) for a caller that sends no verdict. When `?stale=` is present it
  **wins and that clause is suppressed**, so there is only ever one vintage sentence under a chart.
  Two would be the disagreement this whole class of bug is made of.
- ⚠️ `/r/chart` is public, so this value is attacker-controlled in exactly the way `?bname=` and
  `?company=` already are. React escapes it; the page additionally collapses whitespace, strips
  control characters and bounds it to 96 characters, so it can only ever be one short line of text
  in our own footer.
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

`badge.render_footer(results, corr_id, *, quality=None) -> str`. One line, and it only appears when
it has something to say. Order: **quality · vintage · provenance · id**.

    {standin_label} · {Envelope.badge} · {provenance clause, only when not the usual source} · id {corr_id}

- ⛔⛔ **THE QUALITY CLAUSE SHARES THIS LINE; IT DOES NOT GET ONE OF ITS OWN.** `produce_chart`
  edits the same message twice — a stand-in, then the real chart — and `stamp`'s de-duplicator
  recognises our previous stamp by its trailing `· id <x>` and cuts exactly ONE line. A stand-in
  label on a second line would therefore survive the edit that healed it, leaving "⚠ simplified
  chart" under a chart that is no longer simplified: C-06 inverted, and worse than C-06, because a
  member who has learnt to trust the label is then being lied to by it. Composing the clause at the
  call site instead would mean re-typing the separator and the id form — a second authority over the
  one string a member reads, which is the defect §3 exists to prevent. So it arrives as a parameter,
  and the one place that composes this line composes all of it.
- ⚠️ `quality=None` is the whole of the behaviour that existed before the parameter: every call site
  that does not pass it produces the byte-identical line it produced before, and
  `test_omitting_quality_leaves_every_existing_line_byte_identical` is the control on that.

- ⚰️ **The vintage clause IS the badge sentence, not a bare `{as_of_et} ET`.** This file sketched
  the bare form while §2 assigned the sentence one owner — two shapes for one clause, in one
  document. There is one sentence and `Envelope.badge` owns it. ⭐ The same question came back a
  second time one layer down, as *what does `?stale=` carry* — §2b, and it is answered the same way.
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

### 6b. The render-URL golden — `goldens/render_urls.json`

A **second** golden, from the same instrument (`capture_render_urls()`), over the URL the renderer
is pointed at.

- ⛔⛔ **IT IS SEPARATE BECAUSE THE REPLY GOLDEN CANNOT SEE THIS AT ALL.** That capture runs with
  `house_fn` absent — deliberately, so nothing reaches the network — which means the house render
  URL is never built on that path. A stale-render case added there would be green whatever
  `build_render_url` did: coverage that is none
  (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). Keeping the files apart also keeps
  each one's claim readable — `prev2_replies.json` says *the pre-V2 reply has not moved*, and this
  one says *this is what a member's picture is drawn from*.
- **It captures both halves of the promise in one artifact:** nine URLs that carry no vintage and
  must never move, two that carry the badge sentence, and three verdicts — fresh, unknown, and
  stale-with-no-readable-timestamp — recorded for the **silence** they produce, so the absent badge
  is pinned as deliberately as the present one.
- The vintage in it is a fixed string, never computed from a clock (§3.10). A golden that re-derived
  "yesterday" would go red every morning until somebody deleted it.

## 7. Status

✅ **The copy has one home (2.7, 2026-09-13).** `api/services/discord_render/badge.py` owns the
badge, the provenance clause, the footer order, the stand-in label and the stamp;
`tests/test_discord_render_badge.py` asserts the rendered text of each.
⛔ Do not add a fourth place that decides what a member reads — if a new surface needs a sentence, it
comes from `contract.FAILURE_CLASSES` or `Envelope.badge`, through `badge.py`.

✅ **C-07 is closed end to end (Lane D, 2026-09-14).** `badge.vintage_param` → `?stale=` →
`ChartRender.jsx` → `goldens/render_urls.json` (§2b, §6b). The standing strict-xfail
`test_c07_the_house_render_url_carries_the_data_vintage_so_the_image_can_say_it_is_stale` in
`tests/test_discord_render_forensics.py` now XPASSes and is the integrator's to remove.
`mutation_harness_badge.py`: **38/38 RED**, green control before and after, every restore
sha-verified — Q1–Q3 on the quality clause and V1–V6 on the vintage, V1 being "send a bare date and
let the page phrase the warning", which is the decision §2b exists to hold.
⚠️ **Stated honestly: the PAGE half is covered by `app/src/pages/ChartRender.stale.test.jsx`, which
has not been RUN** — the lane's worktree had no `app/node_modules` and this box has been OOM-swept
by an `npm ci` before. Everything from `build_render_url` down to the golden is executed and green;
the page's rendered text is written and unexecuted until somebody runs that one file.

⏳ **Open, and named so it is not mistaken for done:** `adapters/bindings.py` still holds its own
`stamp_suffix` / `stamp` — the same rules, a second implementation. **Lane A swaps it over to
`badge.py`**; until that lands there are two copies of this copy, which is the defect this file
exists to prevent. The output of `badge.render_footer` is byte-identical to `stamp_suffix` for every
case the existing rails cover, so the swap is a deletion and not a behaviour change.
