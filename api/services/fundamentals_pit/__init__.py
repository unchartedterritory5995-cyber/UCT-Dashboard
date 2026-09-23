"""Point-in-time (PIT) historical fundamentals from SEC EDGAR XBRL.

THE RULE: for any instant T, answer "what fundamental value could a member
legitimately have known at T?" and be able to say WHY (which filings, which
facts). Never paint a later value -- a restatement, a newer period, today's
snapshot -- onto an earlier time.

Layers (each a pure function of the one below):

  filings.py    submissions JSON  -> Filing(accn, form, accepted_at, public_at)
  facts.py      companyfacts JSON -> Fact(concept, unit, start, end, val, accn)
  knowledge.py  facts + filings   -> "as known at T": per period, the value from
                                     the latest filing PUBLIC at or before T
  quarters.py   known flow facts  -> standalone quarters (direct, YTD difference,
                                     Q4 = FY - 9M) under strict context rules
  concepts.py   metric primitive  -> ordered XBRL tag candidates (normalisation)
  splits.py     split ledger      -> share-basis conversion for per-share facts
  metrics.py    quarters/instants -> TTM, YoY, margins, returns, ratios
  series.py     knowledge events  -> sparse PIT observations {t_eff, v, why}
  asof.py       sparse points     -> value at any chart bar (as-of, never exact-t)
  beta.py       daily closes      -> rolling beta with a declared methodology

Nothing here performs I/O except `sec_client.py`, and nothing here writes a
database. See docs/fundamentals-pit/ for the audit and design record.
"""
