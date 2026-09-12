# Gate run — 2026-09-11T23:24:18

- tree: `88b71eb2ee4487365aa23b0103528bfdbf619161` (start) -> `88b71eb2ee4487365aa23b0103528bfdbf619161` (end)
- wrapper: `scripts/gate_shards.py` blob `8f9b6f4656e6c2d025d088643ec76d1f3fb765b2`
- shards: 6

| shard | test files | tests |
|---|---|---|
| 1 | 4 failed / 215 | 5 failed / 2713 passed / 2721 |
| 2 | 0 failed / 214 | 0 failed / 2925 passed / 2930 |
| 3 | 2 failed / 214 | 2 failed / 3901 passed / 3907 |
| 4 | 0 failed / 214 | 0 failed / 2981 passed / 2981 |
| 5 | 2 failed / 214 | 2 failed / 2492 passed / 2494 |
| 6 | 0 failed / 214 | 0 failed / 3980 passed / 3980 |
| **Σ** | **8 failed / 1285** | **9 failed / 18992 passed / 19013** |

- test files on disk: **1285** — RECONCILES with the summed file total (1285).

## Failing set vs baseline (`258c5609d529a1f247ae6ff2da266f8479742823`, measured 2026-09-10 (re-measured on origin/master 62a228e5d))

- observed **9** failing tests, baseline has **7**
- **NEW failures (regressions): 2**
    - ⛔ src/hub/surfaceMatrixIsCurrent.test.js > the generated joystick artifacts are current > surface-matrix.md matches the registry as it stands
    - ⛔ src/pages/optionsFlow/flowSearchProduct.test.js > the fixture exercises what the matrix claims > CONTROL: heavy and thin tickers both exist, and differ materially

⛔ **The failing set DIFFERS from the baseline** — read the two lists above.
