---
id: D1-G1-TIMEOUT-REVIEW
title: D1 gap G1 — per-call-site timeout review
role: the owner's ruling input for G1. G1 is NOT authorized; this is the table requested before a ruling.
status: awaiting owner ruling
date: 2026-09-11
measured_against: origin/master @ a10c7c94a
---

# G1 — per-call-site timeout review

**The gap.** `api/services/fmp_client.py`'s typed functions (`get_quote`, `get_key_metrics_ttm`,
`get_analyst_grades`, …) **do not expose a per-call `timeout` to their callers.** The plumbing
exists — `_fetch(…, timeout=None)` forwards to `_get_raw`, which applies
`timeout or _DEFAULT_TIMEOUT` — but the typed signatures don't take the parameter, so a caller
cannot ask for one.

⚠️ **Correction to the sweep's own wording:** its G1 note said `_fetch`'s `timeout=` "is never
forwarded." It **is** forwarded (`fmp_client.py:189`), and `get_news_stock` already passes
`timeout=12`. The gap is narrower and more precise than stated: **callers can't reach it.**

**The two defaults that matter:**

| | value | where |
|---|---|---|
| adapter default | **25 s** | `fmp_client.py:42` `_DEFAULT_TIMEOUT` |
| legacy `_fmp_get` default | **10 s** | `earnings_estimates.py:345` |

**So migrating a call site that passes nothing silently moves it 10 s → 25 s**, and one that passes
a tighter value loses it entirely unless the typed function grows the parameter first. **That is a
behaviour change, which is why G1 is not a mechanical migration.**

## The table

Every `_fmp_get` call site carrying an explicit timeout, measured on `a10c7c94a`:

| site | current | would inherit | Δ | risk |
|---|---|---|---|---|
| `screener/analyst_pass.py:261` grades-consensus | **4 s** | 25 s | **+21 s** | ⛔ **HIGHEST.** Four legs in a **nightly per-ticker sweep** over the screener universe. A 4 s bound is a throughput decision, not a politeness one — at 25 s a slow FMP night could stretch the sweep past its window |
| `screener/analyst_pass.py:274` price-target-consensus | **4 s** | 25 s | **+21 s** | ⛔ same sweep, same reasoning |
| `screener/analyst_pass.py:289` grades | **4 s** | 25 s | **+21 s** | ⛔ same |
| `screener/analyst_pass.py:336` (annual, limit 20) | **4 s** | 25 s | **+21 s** | ⛔ same |
| `routers/research.py:171` quote | **10 s** | 25 s | +15 s | 🔴 **REQUEST PATH.** A member waits. 25 s is past most patience and past typical proxy read timeouts |
| `services/fundamentals.py:264` quote | **10 s** | 25 s | +15 s | 🔴 request path, same |
| `services/company_about.py:46` profile | **8 s** | 25 s | +17 s | 🟡 request-adjacent |
| `services/industry_map.py:179` profile | **8 s** | 25 s | +17 s | 🟡 background, but the module already has a 90 s httpx call — mixed budgets |
| `services/ir_webcast.py:84` profile | **10 s** | 25 s | +15 s | 🟡 background |
| `api/darkpool_eod.py:400` profile | **8 s** | 25 s | +17 s | 🟡 EOD job |

**Call sites with no explicit timeout** (inherit `_fmp_get`'s 10 s today, would inherit 25 s):
~20 modules, led by `analyst_intel.py` (3), `earnings_table.py` (3), `fmp_transcripts.py` (2),
`earnings_growth_fmp.py` (2), `earnings_history_fmp.py` (2), `annual_financials.py` (2),
`bars_sanitize.py` (2). ⛔ `bars_sanitize.py` is **bars-api territory and owner-reserved** — excluded
from any G1 work regardless of the ruling.

## What I recommend, for the owner to rule on

**Add `timeout: int | None = None` to every typed function and forward it.** Purely additive — no
existing caller changes, no default moves — and it turns G1 from a blocker into a per-site decision.
That much I'd do without further discussion if authorized.

⛔ **Then migrate in two tranches, not one:**

1. **The eight sites that already name a timeout** — pass the same number through. **Zero behaviour
   change by construction**, and it retires the four highest-risk `analyst_pass` legs first precisely
   because they are explicit about what they need.
2. **The ~20 that pass nothing** — these are the real decision. Each is currently on 10 s by
   accident of `_fmp_get`'s default, not by choice. ⭐ **Migrating them silently to 25 s is the one
   move that could degrade the product without any test going red**, because a timeout change fails
   as *slowness*, never as an error. Either pin each to 10 s explicitly at migration (preserving
   today's behaviour, making the number a decision someone made), or rule that 25 s is acceptable
   for background work and migrate only the background ones.

**My recommendation: do (1), pin (2) to 10 s explicitly, and leave `_DEFAULT_TIMEOUT` at 25 s for
genuinely new call sites.** That preserves every observable behaviour while removing the blocker.

⚠️ **One thing this table cannot tell you**, stated rather than glossed: I measured the timeouts, not
the latency distributions. Whether 4 s is generous or tight for `/stable/grades-consensus` at 3 a.m.
is a question for the sweep's own logs, which I have not read.
