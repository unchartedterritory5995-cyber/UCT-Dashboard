# Local-only licence-held rails the train's number step runs

These rails read licence-held captures from `C:/Users/Patrick/AppData/Local/uct-vendor-batch/runs/` (never
committed). CI cannot run them and skips them, so a green pine-heavy proves nothing about them. The landing
train's number step runs each one on the dev PC under the heavy lock, on the train's merged tree, and records the
totals line in the train PR. A skip means the run directory is not on that machine: the step has not been done.

| rail | filter | needs (local run) | why it is here |
|---|---|---|---|
| `app/src/components/chart/engine/runtime/__tests__/l4dArmShapes.test.js` | `-t rs-arm-label-last-bar-spy` (the whole file is fine) | `runs/s10-2026-11-15/xmap` | DRAW-1 GC (2026-11-17): the engine-66 count-at-cap carve-out withheld the X01 boxes on SPY 1D (ours 0, TradingView 503) and only this local rail saw it |

Command (from `app/`, under the lock):

```sh
python C:/Users/Patrick/uct-clips/tools/heavy_lock.py --label train-local-only run -- \
  node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/components/chart/engine/runtime/__tests__/l4dArmShapes.test.js
```
