# Chart parity gate

**What it is:** a deterministic, per-indicator screenshot diff. Phase B migrates
fifteen indicators onto an engine; each one ships under **Flip A**, which means it
renders into the same legacy bands and must be **pixel-identical** to the version
it replaces. This is the thing that measures that, and it fails loudly when the
picture changes.

| | |
|---|---|
| driver | `tools/chart_parity.py` (Playwright sync + Pillow — no new deps) |
| cases | `tools/chart_parity_cases.json` |
| page | `/r/chart` → `app/src/pages/ChartRender.jsx` |
| bar fixture | `app/src/pages/parityBars/ramp200.json` (200 committed daily bars) |
| output | `tools/chart_parity_out/` (gitignored) |

---

## Run it

The gate needs a frontend and **nothing else** — in fixed-bars mode the page is
hermetic, so a bare Vite dev server with no backend running is a valid target.

```bash
cd app && npm run dev          # http://localhost:5173
```

### 1. Determinism self-check — must be 0

Omit `--base-b` and both captures come from the same build. Two independent
browser contexts, two independent renders, compared. **Anything but 0 means the
harness itself is unreliable and no parity result from it can be trusted** — stop
and fix that first.

```bash
python tools/chart_parity.py --base-a http://localhost:5173
```

### 2. Prove it can still fail

Perturb one indicator's colour by one hex digit on the B side only. This is a
self-test of the gate, not a parity result — the report labels it as such.

```bash
python tools/chart_parity.py --base-a http://localhost:5173 \
    --cases rsi_only \
    --perturb-b '{"indicators": {"rsi": {"color": "#7b68ef"}}}'
```

Expected: a non-zero changed-pixel count and **exit code 1**. Run this whenever
you touch `chart_parity.py`, and after any Playwright/Chromium/Pillow upgrade.
A gate nobody has seen fail is not a gate.

### 3. The real gate — legacy build vs engine build

Serve both builds and point the harness at each:

```bash
# terminal 1 — the branch WITHOUT the migration
cd app && npm run dev -- --port 5173
# terminal 2 — the branch WITH it
cd ../<engine-worktree>/app && npm run dev -- --port 5174

python tools/chart_parity.py --base-a http://localhost:5173 \
                             --base-b http://localhost:5174 \
                             --cases bb_only
```

Per-indicator, one line, in the B3 checklist:

```bash
python tools/chart_parity.py --base-a $LEGACY --base-b $ENGINE --cases <name>_only
```

Useful flags: `--cases a b c` · `--include-placeholders` · `--out DIR` ·
`--token` (when the build sets `VITE_CHART_RENDER_TOKEN`) · `--headed` ·
`--ready-timeout MS`.

---

## What `window.__chartReady` waits on

`ChartRender.jsx` sets it **false** on every `sym`/`tf` change and flips it true
only after **all** of:

1. the chart settings have settled (in fixed-bars mode: immediately, because a
   parity case pins its own settings and must never inherit the owner's live
   theme — otherwise every stored baseline silently expires the next time he
   changes a colour in Settings);
2. the bar fixture has landed (otherwise the capture is of a spinner, and a
   baseline of a spinner passes forever);
3. a 3.5s paint settle (StockChart has no `onReady` hook).

The harness then also awaits `document.fonts.ready` — a cold vs warm webfont
cache is real, reproducible diff noise that has nothing to do with the indicator.

---

## Reading a diff

```
[bb_only         ] FAIL changed=    2038 (0.273925%) tol=0
```

* `changed` — pixels where **any** RGB byte differs. Not luma: see the note in
  `diff()` about why greyscale reduction is banned here.
* `tools/chart_parity_out/diff/<case>.png` — the baseline dimmed, changed pixels
  painted red. Open it; it tells you *where*, which is usually enough to name the
  cause (a whole series shifted = alignment; the head of one line = a padding or
  masking change; one pane taller = pane-height regression).
* **SIZE MISMATCH** is a failure, never something to resize past — it means the
  two builds framed the chart differently.

### 0 changed pixels is the bar

For a Flip A migration the answer is 0. `--tolerance N` exists, and it **requires
`--tolerance-reason`**; the reason is reprinted in `report.md` next to the number
it excuses. Per-case, put it in `chart_parity_cases.json` as `tolerance` +
`toleranceReason`.

> "It's only a few pixels" is not a reason.
> "LWC 5.2's line rasteriser antialiases the final segment differently; verified
> by rendering the same series through the legacy path at lineWidth 2, where the
> diff is 0" is a reason.

A tolerance is a promise that someone looked at the red pixels and understood
them. If you cannot write that sentence, the answer is that the migration is not
pixel-identical yet.

---

## Sensitivity, measured

On the `rsi_only` case (a 1px anti-aliased line, ~1,500 candidate pixels), with
`--force-color-profile=srgb` pinned:

| change | changed pixels |
|---|---:|
| identical settings, two runs | **0** |
| `#7b68ee` → `#7b68ef` (blue +1) | 1,004 |
| `#7b68ee` → `#7b68de` (one hex digit, blue −16) | 1,455 |
| `background` `#0e0f0d` → `#0e0f0e` (blue +1, full canvas) | 673,703 |

So the gate resolves a single least-significant bit on a single channel. That was
not true of the first version: it reduced the RGB difference to greyscale before
counting, greyscale is luma-weighted (blue counts 0.114), and a whole-canvas
blue+1 change came out as `0.114 → 0`. It reported **perfect parity on an image
that differed on 642,000 pixels.** The bug surfaced only because the
prove-it-can-fail step refused to fail. Keep that step.

---

## Adding a case

Cases are declarative — no Python change needed.

```jsonc
{
  "name": "atr_only",
  "why": "one sentence: what regression class this case can see that others cannot",
  "settings": { "indicators": { "atr": { "enabled": true, "period": 14, "color": "#FFA726" } } }
}
```

`defaults` supplies `sym`/`tf`/`fixedbars`/`w`/`h`/`bars`/`preset`; `presets.classic_flat`
supplies the palette (Classic Dark with the MA overlays and watermark removed so
the indicator under test is the dominant ink and a diff is attributable to it).
The harness deep-merges preset → case settings, base64url-encodes the result into
`?indicators=`, and the page merges that over its own settings with
`mergeSettingsOverride` — the same function the multi-chart grid uses.

The twelve un-migrated natives are already listed as `status: "placeholder"` with
empty settings. B3 fills each one in as it migrates it; the list states the whole
obligation up front rather than quietly shrinking to whatever was easy.

**Do not change `defaults.fixedbars`, `w`, `h` or the preset** without recapturing
every stored baseline — they are part of what a baseline PNG *means*. Likewise
never regenerate `ramp200.json`: new bars invalidate every baseline at once.

---

## Things that will break this gate

* **A new always-on dynamic element inside `#chart-export`.** A clock, a "last
  updated", a rotating tip. The footer's wall-clock stamp is already frozen under
  `?fixedbars=` for exactly this reason; freeze any new one the same way.
* **Losing hermetic mode.** If `/api/` calls start reaching a live server again,
  the ticker name, the owner's saved theme and his preferences all become inputs
  to the picture, and baselines expire whenever any of them changes.
* **Screenshotting the page instead of `#chart-export`.** The page has a viewport
  and scrollbars; the element has neither.
* **Reducing the diff to one channel.** See above — it already happened once.
