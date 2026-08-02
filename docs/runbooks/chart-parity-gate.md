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
python tools/chart_parity.py --base-a http://localhost:5173 --same-build
```

`--same-build` is **required** here, and it is not ceremony. Omitting `--base-b`
used to default it to `--base-a` silently, so an A-vs-A run — which cannot fail on
a build difference — produced a report indistinguishable from a real
legacy-vs-engine result. Declaring it puts `same_build: true` in `report.json` and
a ⚠️ line at the top of `report.md`, where the next reader will see it.

### 2. Prove it can still fail

Perturb one indicator's colour by one hex digit on the B side only. This is a
self-test of the gate, not a parity result — the report labels it as such.

```bash
python tools/chart_parity.py --base-a http://localhost:5173 --same-build \
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

### 4. ONE build, two render paths — the engine rehearsal

Two builds is the wrong instrument for a migration that is already in the tree:
every unrelated commit between them shows up in the diff. A case carrying
`instancesB` sends those instances to side B as `?instances=`, which also arms
`engineEnabled` — so side A draws the LEGACY indicator, side B draws the
ENGINE's, from the same `dist`, one URL parameter apart.

```bash
cd app && npm run build && cd ..
python tools/spa_server.py app/dist 5185          # SPA fallback for BrowserRouter
B=http://127.0.0.1:5185

python tools/chart_parity.py --base-a $B --base-b $B --cases engine_rsi_vs_legacy
```

`tools/spa_server.py` is committed precisely so this section is reproducible.
Phase B2's numbers were all produced through an uncommitted scratch copy while
this document pointed at `<scratch>/`; a harness the reader cannot obtain makes
every number in the report unverifiable.

A plain `python -m http.server` is NOT a substitute: `/r/chart` has no
`index.html` on disk (BrowserRouter resolves it in the browser), so it 404s and
the harness screenshots an error page. Address the server as
`http://127.0.0.1:<port>`, never `localhost` — an unrelated dev server holding
`[::1]:5173` once won the name resolution and the harness measured it instead.

**Do the two determinism runs FIRST.** A 0 is only meaningful once each render
path is known to agree with itself:

```bash
--instances-side none    # legacy vs legacy — must be 0
--instances-side both    # engine  vs engine — must be 0
```

`indicators.<key>.enabled` stays **TRUE on both sides**, deliberately.
`computePaneMargins` reads it, and it is what reserves the band the engine
renders into; turn it off for side B and the whole chart re-lays-out. What stops
the legacy block drawing a second copy is `engineOwnedDefIds`
(`engine/instances.js`) — an instance of definition `X` means the engine draws
X, and X's legacy block in `StockChart.jsx` guards on `!engineOwned.has('X')`.
B3 adds that guard to one more block per indicator it migrates.

### Proving an ENGINE case can fail

`--perturb-b` patches chart SETTINGS, and an engine-drawn line reads its colour
from the **instance**, not from settings — so on an engine case `--perturb-b`
changes nothing and the fail-proof step passes **vacuously**. Use:

```bash
python tools/chart_parity.py --base-a $B --base-b $B --cases engine_rsi_vs_legacy \
    --perturb-b-instances '{"color": "#7b68ef"}'      # → 1,004 px, exit 1
```

That number is also the proof the engine is what drew side B: it moved because
the INSTANCE moved. Running the settings perturb on the same case reports 0,
which is the same fact seen from the other side.

`--perturb-b-instances` together with `--instances-side none` is **rejected at
argparse**. That combination sends the instances to neither side, so there is
nothing to perturb: the run would report 0 changed pixels and read exactly like a
pass. A self-test that can report 0 is the failure mode this whole document is
about, so it is refused rather than footnoted.

`--perturb-b-instances` on a case that carries no `instancesB` is refused for the
same reason and was the SECOND half of that class, left open when the first was
closed: `case_instances` returns before the perturbation on `if not raw`, which is
**four of the five default cases**. `--cases rsi_only --perturb-b-instances …`
rendered, reported `| rsi_only | 0 | 0.0% | 0 | 🟢 pass |` and exited 0 while the
banner above it said the instances had been deliberately perturbed. An unnamed
default run still went red overall, because `engine_rsi_vs_legacy` is in the set —
so the reachable misuse was naming a case, which is exactly what you do when you
sanity-check the harness before migrating an indicator.

---

## Which build am I measuring? — the four refusals

Every number this tool prints is a claim about a specific build, and until
2026-08-02 nothing in it checked that claim. **The re-review of Phase B2 opened
with a clean 🟢 green against a dev server that was serving the
`phase-b1-foundations` worktree** — a branch with no engine in it at all. Every
case reported 0 changed pixels and exit 0, because two captures of the same wrong
build are identical. It was caught by a human reading the server process's
command line, which is not something a gate may depend on.

So before a single pixel is captured, the harness **asks each base what it is
serving** (`read_build_identity`) and **records both answers** in `report.json`
and at the top of `report.md`:

```
- A (baseline): `http://localhost:5317` · build **aada0c2b2d75** (dev) — no hashed assets (dev server) · engine source: present
- B (candidate): `http://localhost:5317` · build **aada0c2b2d75** (dev) — no hashed assets (dev server) · engine source: present
```

* a **`dist` build** advertises hashed assets in `index.html`
  (`/assets/index-<hash>.js`) — the hash *is* the identity.
* a **`vite dev` server** advertises `/src/main.jsx` and `/@vite/client`, which
  are byte-identical in every worktree — precisely why the b1 server passed for a
  b2 one. Dev servers are identified by CONTENT instead: a handful of modules on
  the chart's render path are fetched and hashed. Measured, the two worktrees
  come out `aada0c2b2d75` vs `32303a40d616`.

**Four things now refuse to run.** All four were reproduced against live servers;
none of them is theoretical.

| refusal | the vacuous green it replaces |
|---|---|
| `--perturb-b-instances` on a case with no `instancesB` | 4 of the 5 default cases have none, so the perturbation is never applied: `0 px · 🟢 pass · exit 0` under a banner reading "B's engine INSTANCES were deliberately perturbed". |
| `--base-b` omitted without `--same-build` | A-vs-A masquerading as A-vs-B forever after, in a report nobody can re-date. |
| A and B report the SAME build id, with nothing else telling the sides apart | every case reports 0 no matter what the code does. |
| an `instancesB` case pointed at a base with no `engine/` source | **the original trap.** `?instances=` arms nothing, both sides draw the legacy indicator, 0 px, 🟢. |

The last one is checked on **both** sides even though only side B receives the
instances: an `instancesB` case means *one build rendering two ways*, so a side
that cannot render the engine makes the comparison something other than what the
case claims to measure. It is only enforced when the source tree is observable
(a dev server); a bundled build reports `engine source: unknown (bundled build)`
and is taken at its word.

**A run that is legitimately A-vs-A does not need any of this argued.** The
engine rehearsal (a case with `instancesB`) and `--instances-side none|both` are
self-declaring; everything else says `--same-build`.

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
| RSI's 50 guide as `Dashed` instead of `LargeDashed` (one row, 6-on/6-off → 2-on/2-off) | **379** |

That last row is the Task 8 rehearsal's first result and is worth keeping in
mind for scale: a whole guide line rendering with the wrong dash pattern is
0.05% of the canvas. Nothing about a small number here means a small mistake.

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

A case that renders through the ENGINE on side B adds `instancesB` — see
`engine_rsi_vs_legacy`, and section 4 above for how to run it.

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
