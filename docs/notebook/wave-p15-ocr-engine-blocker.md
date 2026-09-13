# Wave P1.5 — build isolation, and the engine finding that stops it

**Status: STOPPED for an engine decision (§32.14).**

```
BUILD CONTRACT RECONSTRUCTION   COMPLETE
MODEL ASSET OWNERSHIP           COMPLETE — bundled, no download, checksummed
DEPENDENCY ISOLATION            ⛔ NOT BUILT — deliberately
OCR ENGINE                      ⛔ FAILS THE PRODUCT'S OWN SEARCH METRIC
```

⛔ **The isolation work was not done, on purpose.** Isolating ~169 MB of
dependencies for an engine that finds **fewer than half** the words a member
would search for is work built on a foundation that has to be replaced. The
packaging mechanism is straightforward and unchanged by which engine wins; the
engine decision is not.

---

## A · The build contract, as it actually is (§4)

⚠️ **Correction to the P1 document: FOUR services share the image, not five.**

| service | build | dependency set |
|---|---|---|
| web | root `nixpacks.toml` + `railway.json` | `requirements.txt` |
| worker | same image | same |
| flow-worker | same image | same |
| bars-api | same image | same |
| **chart-renderer** | **`services/chart_renderer/Dockerfile`** | **its own `requirements.txt`** |

⭐ **A per-service isolation precedent already exists in this repo.**
`services/chart_renderer/` has its own Dockerfile and its own requirements, and
deploys from that subdirectory. So the question in P1 — "does per-service
dependency isolation exist here?" — has a better answer than "no": it exists,
for a service that needed a different base image (Playwright/Chromium).

The four that share differ **only at start time**, by environment variable
(`BARS_API_ENABLED` / `FLOW_WORKER_ENABLED` / `WORKER_ENABLED`, else uvicorn).
Dependency installation is driven by `nixpacks.toml`'s `[phases.install]`,
which is shared by all four.

**The intended split** (designed, not built): keep `requirements.txt` as the
common set, add a small pinned `requirements-ocr.txt`, and gate its install in
the shared install phase on a variable set only on web. Its failure direction is
**closed** — with the variable unset everywhere, no service installs OCR, which
is the right way round.

## B · Model assets — fully answered, and clean (§16/§17)

| question | answer |
|---|---|
| where do the models come from? | **bundled inside the wheel** — 3 ONNX files |
| does anything download at runtime? | **No.** Every `http(s)://` in the package source is an Apache licence header or a doc comment; there is no fetch code |
| did the benchmark only work because of a local cache? | **No** — this was §17's explicit worry and it is retired |
| identity / version | PP-OCRv3 (1.2.3) or PP-OCRv4 (1.4.x) det+rec, plus `ppocr_mobile_v2.0` cls |
| cold load | 0.46 – 0.73 s |
| checksums | `det 3439588c030faea3` · `rec 897a3ededb38fee0` · `cls e47acedf663230f8` (v3 build) |

⚠️ **And a constraint nobody had asked about:** `rapidocr-onnxruntime` declares
`Requires-Python >=3.6,<3.13`. Production builds **3.12**, so it fits — but the
engine caps the platform, and **the version P0 benchmarked (1.2.3) does not
support 3.12 at all.** It installed here only because this box runs 3.14 and pip
fell back to an old release with no upper bound.

## C · ⛔⛔ THE BLOCKER: the shippable version fails the metric that matters

P0 chose a floor of "exact financial token recall" and explicitly rejected CER
as the verdict. **Both were still the wrong primary metric.** Wave P ships a
*search* feature, and `j2_note_document_pages_fts` tokenises with
`porter unicode61` — it splits on whitespace. An engine that reads every
character correctly but emits `revenuewas$12.48billion` as one run produces:

- a page that **is** indexed,
- a job that **does** report complete,
- a member who searches `revenue` and gets **nothing**.

So P1.5 added the metric that asks the real question — index the OCR output with
the production tokenizer, then query it with the words a member would type.

| config | mean FTS search recall |
|---|---|
| **1.4.4 (PP-OCRv4) — the SHIPPABLE version, default** | **0.456** |
| 1.4.4 + `max_side_len` raised above the page height | 0.660 |
| 1.4.4 + character-gap respacing (threshold fitted) | 0.760 |
| **1.2.3 (PP-OCRv3) — 0.841, but NOT installable on Python 3.12** | **0.841** |

On the presentation slide, the shippable version finds **zero** of its
searchable words — while scoring **CER 0.075**. Nothing else caught this:

| page | CER | financial recall | **FTS search recall** |
|---|---|---|---|
| slide | 0.075 | 0.50 | **0.00** |
| two-column | 0.681 | 1.00 | **0.22** |
| clean | 0.163 | 0.79 | **0.46** |

The benchmark's own floor control fired independently:
*"the CLEAN control read only 0.79 of its financial tokens — the engine does not
clear the floor on the easiest possible page."*

### What was tried, and how far it got

⭐ **A real fix, not a tuned one:** the default `max_side_len = 2000` downscales
a 2200 px page *before* text detection, compressing word gaps. Raising it above
the page height lifts recall **0.456 → 0.660**, and it plateaus (2400/3000/4000
identical). That is "do not shrink the page before reading it", and it should be
kept whichever engine wins.

⛔ **A fix I am NOT presenting as a result:** `return_word_box=True` yields
*per-character* boxes, so spaces can be reinserted from geometry — measurement,
never a dictionary, so no text is invented. Swept, the best threshold reaches
**0.760**. But the normalised gap distribution has **no valley** — it decays
smoothly from zero — so intra-word and inter-word gaps genuinely overlap, and
the 0.60 optimum was **fitted on the same seven pages it is scored on**. That
number is a forecast, not a measurement, and I will not spend it as one.

**Even taking 0.760 at face value, it is below the older engine's untuned
0.841 — and that engine cannot be installed on production's Python.**

## D · Options

**(a) Benchmark Tesseract next — my recommendation.** It is English-first and
preserves word spacing by construction, which is precisely the failure here. Its
cost is a *system package* in `nixpacks.toml` (`tesseract` + English traineddata,
roughly 15–40 MB) rather than 169 MB of Python wheels — plausibly a **smaller**
blast radius than the current candidate, though it does touch the shared
`nixPkgs` list. ⛔ I cannot test it on this machine: there is no tesseract binary
here and installing one is a system-level change I have not made.

**(b) Accept 1.4.4 with the `max_side_len` fix and character-gap respacing.**
Then the respacing threshold must be validated on a **held-out** corpus first,
because the current number is fitted. Even then it lands near 0.76.

**(c) Reconsider topology or an external provider.** Explicitly not authorized
(§27/§39), and not recommended — the local path's privacy posture is its best
property.

## E · What is now permanent, whatever engine wins

1. **FTS search recall is the primary acceptance metric.** It is committed into
   `tools/wave_p0_ocr_benchmark.py` and prints as *"the metric Wave P is
   actually judged on"*. CER and token recall stay as supporting numbers.
2. **Do not downscale a page before detecting text on it.**
3. **Engine confidence remains rejected** (P0 §C1) — and 1.4.4 reproduced it:
   `NVDACORPORATION`, unusable for search, scored **0.99**.
4. **Models must ship in the image, never be fetched at boot.**
5. **The engine's `Requires-Python` cap is a platform constraint** and belongs in
   any future pin.

## F · Machine safety (§31)

Disk **72 GB → 71 GB** across P1.5, including a third isolated benchmark venv.
Still **no OCR temp files**: every measurement ran on page images taken from the
PDF in memory. No `data_sync_*` directory was created or touched, and nothing
belonging to another workstream was removed.
