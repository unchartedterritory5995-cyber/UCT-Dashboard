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
