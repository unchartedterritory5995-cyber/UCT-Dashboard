---
title: Session 27 Step G — a paragraph for the committed-use conversation
status: DRAFT. Facts only. Not sent by this session — this is the owner's phone step.
---

⚠️ **One number below this session cannot fill in**: current total API spend on this Anthropic
account. That lives in the Anthropic Console billing page, which this session has no access to.
Everything else is a real, measured, or directly-quoted figure from this repository.

---

Draft paragraph:

> We're an existing Anthropic API customer running a production Claude-Opus-5-based extraction
> pipeline (structured JSON extraction over long-form transcript segments, Batch API, ~$[FILL IN:
> current monthly/total spend from your Console] to date). We're planning a one-time back-catalogue
> extraction job of roughly 26,000–27,000 text segments, each processed up to 3 times for
> stability voting, projected at $2,300–4,900 depending on configuration, plus an ongoing nightly
> extraction load of roughly $5–15/night indefinitely afterward. Given our existing usage and this
> upcoming volume, is there a committed-use pricing tier or credit program we'd qualify for?

Facts behind the numbers, so they can be checked or updated before sending:
- Corpus size: 26,675 segments measured in production (`wisdom_sources`/`wisdom_segments` counts,
  2026-09-18), up from an earlier 9,733-segment planning estimate.
- Per-segment real rate, Opus, batch API, high effort: $0.0574 (gate-run-3, 83 segments, pass 3,
  measured).
- N=3 full-corpus estimate range: $3,175 (p50) – $4,872 (p90), from `docs/wisdom/PATH-PRICING-
  2026-09-18.md`.
- With the two real levers this session measured (lexical pre-screen ~8.9% segment reduction,
  targeted-N ~20.9% reduction on repass spend), stacked: ~$2,300–3,500 — see
  `docs/wisdom/COST-REDUCED-PRICING-2026-09-18.md`.
- Nightly ongoing rate (new sessions only, no back catalogue): ~$5–15/night, essentially unchanged
  by any lever above.
