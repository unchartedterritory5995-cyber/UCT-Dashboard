<!-- GENERATED FILE - do not edit by hand.
     Written by tools/breadth_sampler_report.py on every run.
     NOT A SOURCE: no rail may treat this as an authority for any number in it.
     The authority is logs/breadth-samples.jsonl and the git history it points at.
     NO MEMBER DATA: the pool holds request TIMINGS, flag states and a commit SHA
     only - no user ids, no emails, no request bodies, no response content. It is
     safe to publish, and that is a property of what the sampler records, not a
     promise about redaction.
-->

# Breadth sampler - pool summary

```
==================================================================
BREADTH SAMPLER  ·  breadth-samples.jsonl
  rows 4   deep OK 2   warm OK 0   failures 0   refusals 2
  refusals by reason: uptime_unknown×2

  hot path: 8 files (measured by execution)   pools: 1   pool flags: ('rf_pagecache',)

------------------------------------------------------------------
POOL 1   n=2   flags {'rf_pagecache': 1.0}
  SHAs pooled (1, hot path byte-identical): 4a0995a52
              total_ms  n=2   min=   351.4 p50=  1975.5 mean=  1975.5 p95= not est max=   3599.7 sd=  2296.9
             reader_ms  n=2   min=   204.3 p50=  1731.6 mean=  1731.6 p95= not est max=   3258.9 sd=  2159.9
   reconstructed_fetch  n=2   min=    80.2 p50=  1414.5 mean=  1414.5 p95= not est max=   2748.8 sd=  1887.0
        rf_materialise  n=2   min=    57.4 p50=    66.8 mean=    66.8 p95= not est max=     76.3 sd=    13.4
        post_reader_ms  n=2   min=   147.1 p50=   243.9 mean=   243.9 p95= not est max=    340.8 sd=   137.0
         encode_render  n=2   min=    49.4 p50=    55.9 mean=    55.9 p95= not est max=     62.4 sd=     9.2

  P(true p95 lies ABOVE the worst read seen) = 0.95^2 = 0.902
  ⛔ p95 NOT estimable: n=2, need 59 (57 more on this pool)
  samples ≤ 1000 ms: 1/2   worst: 3599.7 ms
==================================================================
```
