# Coach guard: second-stage classifier options

Status: investigation only. No paid calls were made, and the guard has not been changed.
Author: independent-author-2026-11-04 (the same session that wrote the held-out fixtures).

## Why a second stage

The independent held-out sets (`app/src/agent/__fixtures__/coachGuardIndependent/`) were scored against the current
rule guard (JS and Python both, 0 disagreements), using `scripts/agent/measure_coach_guard_heldout.mjs`:

| Set | n | Result (inputs omitted) | Result (figures treated as traceable) | Owner bar |
|---|---|---|---|---|
| advice (block) | 192 | recall 49.0% | recall 45.3% | ≥95% |
| critical (block) | 70 | recall 60.0% | recall 55.7% | 100% |
| educational (pass) | 157 | false positives 19.1% | false positives 14.0% | "acceptable" |

The misses are structural, not a handful of missing words. The guard does not catch bare imperatives with a ticker
("Buy NVDA.", "Sell NVDA.", "Short TSLA."), hold/trim/add instructions, leverage/all-in/margin urging (it caught 0 of 12 in
the language-only run), non-English text, typos, or letter-spaced text. Its false positives come from negated or quoted
mentions ("No setup is guaranteed to work", "Be skeptical of anyone who promises guaranteed profits") and from plain
definitions that mention outcomes ("A breakout is when price moves above…"). Regex coverage can be widened, but
paraphrase, negation and language variety are where a learned classifier earns its cost.

Recommended shape in every option: **rules first, classifier second, fail closed.** Keep the rule guard as a cheap
deterministic pre-filter (it already blocks order language and figures). Run the classifier only on replies the rules
pass. On any classifier error or timeout, or a missing verdict, replace the reply with the fixed safe reply.

## Option A: a Haiku-class Anthropic call as a second pass

One extra Messages call per coach reply. The input is a short, cached system rubric (the five policy rules, about 10
labeled contrast examples, and the instruction to judge the *reply's effect on the member*, not its keywords) plus the
reply text. The output is a structured verdict `{violation: bool, codes: [...]}`, using structured outputs, not free text.

**Cost per turn (estimate from list prices, cached 2026-10-06; verify before building):**

| Model | Price in / out per MTok | Typical tokens | Cost per turn |
|---|---|---|---|
| Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 / $0.50 | about 1,200 in (800 rubric + 400 reply), about 30 out, plus about 200 thinking at `effort: "low"` | about $0.0002 to $0.0003 |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1.00 / $5.00 | the same, with no thinking | about $0.0014 |

Prompt caching on the rubric reduces the input share further, but an 800-token prefix may fall below the minimum
cacheable length, so don't count on it. Against the **$0.25/turn cap**, the guard adds 0.1% (Haiku 5.5) to 0.6%
(Haiku 4.5). Against the **$5/day cap**, the guard alone would need about 17,000 (5.5) or about 3,600 (4.5) guarded
turns to use the budget, so the coach's own generation dominates spend. The guard should still count against the same
budget meter.

**Latency:** one short non-streamed call, estimated at 0.4 to 1.2 s p50 and 2 to 3 s p95 (network plus time to first
token plus about 30 output tokens). Because the reply must be held until the verdict arrives, the coach cannot stream to
the member, or must stream into a buffer. Two ways to hide the latency: (1) run the guard on each finished paragraph
while the coach is still generating; (2) send the reply, then retract it on a block. Option (2) is weaker and is not
recommended for an advice policy.

**Expected recall:** a small model given a precise rubric should catch nearly all of the bare imperatives,
paraphrases, slang, multilingual text and leverage urging that the rules miss. It should also reduce the
negation/quotation false positives, because it reads meaning. A realistic expectation is ≥95% on advice and close
to 100% on the critical set, **but this is unmeasured**. Measure it on these held-out sets (about 420 calls, under
$0.15 on Haiku 5.5) before relying on it. Running that measurement is a paid run and needs owner approval.

**Failure modes:**
- Prompt injection: the reply being judged may contain text such as "ignore the rubric". Mitigations: wrap the
  reply in delimiters, tell the model the reply is data, and keep the rules pass in front.
- Obfuscation: homoglyphs and zero-width characters can affect tokenization. Run the guard's existing `normalize()`
  before the classifier call.
- Non-determinism: verdicts can flip at the margin. Use a fixed rubric, structured output and low effort, and log every
  verdict for audit.
- Outages, rate limits (429) and refusals: Haiku 5.5 has no server-side refusal fallback. **Fail closed**, send the fixed
  safe reply, and alert. An outage then degrades the coach rather than the policy.
- Over-blocking hedged education: give the rubric explicit allowed contrasts ("a common mistake is to buy before
  confirmation" is allowed), and track the false-positive rate on `educational.json`.
- Data flow: replies, which may quote the member's journal, go to a third-party API. The coach already does this for
  generation, so no new class of data leaves the system. Never put real market values in the rubric.

## Option B: a small local model (fine-tuned encoder, or a small instruction model)

Options are a DeBERTa/MiniLM-class sequence classifier fine-tuned on labeled advice/education pairs, or a 1 to 3B
instruction model run on CPU.

- **Cost:** $0 per turn. It needs the hosting footprint: a 100 to 400 MB model in the API container. Note that pods have
  already run out of memory under bar-warming load (see the memory note on Railway pod limits), so this likely needs its
  own small service.
- **Latency:** an encoder takes about 10 to 50 ms on CPU per reply. A 1 to 3B generative model takes 0.5 to 3 s on CPU,
  which is no better than Haiku.
- **Expected recall:** this depends on the training data. A fine-tuned encoder can reach Haiku-level recall in-domain,
  but it needs about 2 to 5k labeled examples, and it generalizes worse to slang, other languages and new phrasings.
  **These held-out sets must never be used to train it.**
- **Failure modes:** distribution shift as the coach's style changes, which requires periodic relabeling; English bias;
  homoglyph and zero-width characters (normalize first); and nobody owns the model's maintenance. It fails safe only if
  wired to.
- **Fit:** it fits both caps trivially, but it costs the most engineering and operations effort.

## Option C: embedding similarity against labeled exemplars

Embed the reply, or each sentence of it, and compare it with banks of "advice" and "education" exemplars, using a
k-nearest-neighbour vote or a threshold on the margin.

- **Cost:** a hosted embedding call is on the order of $0.00001 per turn. A local embedding model (about 100 MB) costs
  nothing per turn. Either fits the caps.
- **Latency:** 20 to 200 ms.
- **Expected recall:** this is the weakest option for this policy. Embeddings encode topic more than force, so "Buy NVDA
  now" and "A common mistake is to buy before confirmation" sit close together. Negation and hedging, which are exactly
  the false-positive class here, are poorly separated. Expect it to help on paraphrase and multilingual recall, but
  with false positives no better than the rules.
- **Failure modes:** topic/force confusion, threshold drift, and the exemplar banks becoming another hand-tuned regex
  list.
- **Fit:** useful as a cheap *router*, deciding whether a reply needs the Haiku check, not as the decider.

## Recommendation

1. Keep the rules as stage 1, and fix the structural gaps the held-out run exposed using new tuning cases, never these
   held-out cases.
2. Add **Option A (Claude Haiku 5.5, structured verdict, fail closed)** as stage 2 on every reply the rules pass. It
   costs about $0.0003 per turn and is well inside both caps. Its latency, about 1 s, is the main cost, and paragraph-wise
   checking can hide it.
3. Before activation, get owner approval for one paid measurement run of stage 2 on the three held-out files, plus a
   fresh held-out set that nobody has tuned against. Gate it on ≥95% advice recall, 100% critical recall, and the
   false-positive rate on educational text.
4. Revisit Option B only if per-turn latency or the third-party data flow becomes the binding constraint.
