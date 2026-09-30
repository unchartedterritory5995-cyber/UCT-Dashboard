# Follow-up: tools/bars_warmth_audit.py --n 40 --tf D,5, run ~4 min after the gate (same stratified sample -- _stratified is deterministic)

```
[warmth] universe=3640 sample=40 tfs=['D', '5'] base=https://uctintelligence.com

=== tf=D (bars=300) ===
  WARM 0/40 = 0%   STALE-SERVED 40/40   layers={'stale-swr': 40}
  no-wait latency p50=125 p95=1256 (n=40, of which stale-served=40; client wall-clock ms (incl. TLS/CDN/network; not Server-Timing dur))

=== tf=5 (bars=240) ===
  WARM 34/40 = 85%   STALE-SERVED 0/40   layers={'sqlite': 34, 'miss': 6}
  no-wait latency p50=73 p95=93 (n=34, of which stale-served=0; client wall-clock ms (incl. TLS/CDN/network; not Server-Timing dur))
  COLD latency p50=199 p95=251 (n=6, max=251; client wall-clock ms (incl. TLS/CDN/network; not Server-Timing dur))
  cold symbols: AMN(miss,172ms,240b,200), ASA(miss,199ms,240b,200), BSVN(miss,235ms,240b,200), CPK(miss,173ms,240b,200), GASS(miss,251ms,240b,200), MGRC(miss,169ms,240b,200)
```

## Correction, ~15:15 CT the same day — the 1,256 ms was the NETWORK, not the product

Same 40-symbol deterministic sample, tf=D bars=300, reading the response's own
`Server-Timing` `dur` beside the client wall-clock:

| run | connection | wall p50 | wall p95 | wall max | server p50 | server p95 | server max |
|---|---|---|---|---|---|---|---|
| A | TLS paid inside the first sample | 126 | 254 | 1,120 | 49 | 102 | 136 |
| B | pre-warmed (one `/api/health` first) | 93 | 127 | 315 | 13 | 22 | 23 |
| C | pre-warmed | 76 | 113 | 220 | 1 | 1 | 1 |

- Every row was `stale-swr`. The server served every daily read in ≤ 136 ms, and in ≤ 23 ms once warm.
- The worst wall sample in run A (OPK, 1,120 ms) spent **73.5 ms** on the server.
- This client's link was unstable all day: 4 connection errors in the morning's quiet-window sample (TLS EOF, WinError 10053) and a WinError 10054 reset at ~10:08 CT. The follow-up's D p95 of 1,256 ms is therefore NOT evidence the product is over the bar.

What is still NOT established: a gate reading that clause 2 can accept. The gate's own run was n = 2 / n = 1 no-wait. A valid reading needs a minimum no-wait n, and either a pre-warmed connection or the server `dur` reported beside the wall — the quantity OBS-1 has to name.
