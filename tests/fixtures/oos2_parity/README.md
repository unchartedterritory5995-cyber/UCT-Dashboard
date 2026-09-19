# `oos2_parity/` — the FIXED ten-member visual parity set, materialised

This directory holds a **copy** of ten named members of
`tests/fixtures/pine_oos`, staged in one place so the live journey harness can
be pointed at a directory rather than a list:

```
python tools/c0_visual_journey.py --base http://127.0.0.1:<port> \
       --fixtures tests/fixtures/oos2_parity --out tools/c3b_close_parity
```

## ⛔ The `.pine` files are NOT committed, and that is deliberate

`tests/fixtures/pine_oos/.gitignore` withholds the text of every corpus script
whose recorded licence does not contemplate redistribution — the manifest keeps
each one's source URL and SHA-256 instead. **Six of these ten are on that list,
and a copy is still a redistribution**, so `.gitignore` here withholds all ten
rather than six: a per-file list in a second place is a second authority that
would drift the first time the parity set changed.

## The ten, and where the roster actually lives

⭐ **The authority is `docs/superpowers/specs/universal-indicator-ecosystem/OOS_2_PARITY_SET.json`.**
Read the set from there; the list below is a convenience and, like every
hand-typed list beside the artifact that owns it, is the thing that goes stale.

```
high_engagement__10-rsi-divergence-faytterro
high_engagement__13-ultimate-opening-range-breakout-luxalgo
high_engagement__16-klinger-volume-oscillator-everget
high_engagement__24-coppock-curve-multi-filter-markittick
long_tail__05-master-line-plus
long_tail__16-spy-position-helper
mid_engagement__01-zeiierman-trend-pressure
mid_engagement__05-supertrend-fibonacci-ote
mid_engagement__09-relative-volume-breakout-context
mid_engagement__22-rsi-levels-regime-map
```

## To re-materialise

Copy each member's `.pine` from `tests/fixtures/pine_oos/` (re-fetching any
withheld one from its manifest URL and verifying `sha256_source` first) into this
directory under the same name. Nothing here is edited — a modified copy would
make every parity number a measurement of a script the corpus does not contain.

## What was measured against it

`docs/superpowers/specs/universal-indicator-ecosystem/C3B_CLOSE_LIVE_VENDOR_AND_PARITY.md`
§5, with the run's own report at `C3B_CLOSE_PARITY_JOURNEY.json` beside it.
**CHART_DRAW_AND_REOPEN and VISUAL_FIDELITY are reported as separate columns and
are never added** — 8/10 reached the chart and reopened identically, 5/10 painted
an object, and every one of those five painted a TABLE.
