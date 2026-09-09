# Wave P1.5 — engine comparison and recommendation

**Recommendation: TESSERACT.** It wins on every metric measured, on both the
tuned corpus and an independent holdout, and it is the only candidate that
requires no Python dependency at all.

⛔ One packaging number remains unmeasured and is not guessed — see §F.

---

## A · The decision table

| | rapidocr 1.4.4 default | rapidocr 1.4.4 corrected | rapidocr 1.2.3 (reference) | **Tesseract 5.4.0** |
|---|---|---|---|---|
| **FTS search recall — tuned corpus** | 0.456 | 0.660 | 0.841 | **1.000** |
| **FTS search recall — HOLDOUT** | — | **0.696** (min 0.102) | — | **1.000** (min 1.000) |
| financial recall — holdout | — | 0.887 (min 0.600) | — | **1.000** (min 1.000) |
| CER — holdout dense page | — | 0.160 | — | **0.023** |
| seconds/page (p50) | 3.14 | 3.62 | 2.92 | **0.34 – 0.46** |
| in-process RSS | +67 MB | +67 MB | +67 MB | **zero — it is a subprocess** |
| Python dependency | onnxruntime + opencv (~169 MB) | same | same | **none** |
| Python-version gate | `<3.13`; **1.2.3 cannot install on 3.12** | `<3.13` | ⛔ unusable | **not applicable** |
| OCR temp files | none | none | none | **none** (stdin → stdout) |

⛔ **1.2.3 is a historical reference only.** It cannot be installed on
production's Python 3.12; it ran here solely because this box is on 3.14 and pip
fell back to a release with no upper bound.

## B · The holdout, and why it was needed

The original seven pages had by then **influenced configuration decisions** — a
`max_side_len` correction was found on them and a character-gap threshold was
swept against them. A corpus that has shaped the thing it measures cannot also
be the evidence for choosing between engines.

So a second corpus was generated and run **once**: a different company (AMD, not
NVDA), different figures, serif where the first used sans, different type sizes,
a different table shape, a narrower gutter, and different degradation parameters
(−1.4° skew instead of +2.1°, a heavier downsample, lighter grain).

| holdout page | rapidocr 1.4.4 corrected | Tesseract |
|---|---|---|
| clean serif quarterly | 0.89 | **1.00** |
| low-resolution | 0.69 | **1.00** |
| skew −1.4° | 1.00 | **1.00** |
| **dense notes** | **0.10** | **1.00** |
| balance-sheet table | 1.00 | **1.00** |
| two columns, narrow gutter | 0.61 | **1.00** |
| image-only slide | 0.57 | **1.00** |

On the dense notes page the incumbent finds **10%** of the words a member would
search for. That is the failure class Wave P exists to avoid, reproduced on a
corpus that never touched a tuning decision.

## C · The recall is not bought with over-generation (§12)

⛔ A perfect recall number is worthless without the negative half. Tesseract's
output was queried for **112 absent-term queries** across both corpora —
`kimberlite`, `zebra`, `molybdenum`, `144.7`, `88.88` and others that appear on
no page:

**0 false hits.** 901 words emitted across 14 pages.

## D · Source fidelity (§13)

Tesseract applies a dictionary, so the question is whether it "corrects" what it
sees. Measured on every page containing them:

`NVDA` and `EBITDA` came back **unchanged, on every page**, including the
low-resolution and skewed variants. No ticker was expanded, no acronym rewritten,
no figure altered. **Source fidelity and searchability were measured separately
and both hold.**

## E · Reading order is still imperfect, and that is reported separately (§14)

Tesseract scores CER 0.650 on the tuned corpus's table page — the same
reading-order divergence the incumbent shows — while scoring **1.00 financial
recall and 1.00 search recall** on it. Searchability and sequence are different
properties and are not collapsed into one score. Ask may care more about
sequence than Search does; that is a P3 question, and this is the number it
starts from.

## F · Cost, and the one thing not measured

| axis | measured |
|---|---|
| latency | 0.34–0.46 s per page sequential |
| concurrency | **0.24 s/page wall-clock at 2 concurrent** — near-linear, so it uses cores rather than blocking on one |
| memory | **zero in-process growth.** The engine is a separate process; the web service loads no model and carries no ONNX runtime |
| temp disk | **none** — the page image goes in on stdin, text comes back on stdout |
| language data | `eng` 3.9 MB + `osd` 10.1 MB, shipped as files |
| Python | **no wrapper needed.** Subprocess only, so §20/§21's production-Python gate does not apply to the engine at all |

⛔ **NOT MEASURED: the Linux/nixpkgs closure size.** The Windows install is
237.9 MB, of which a runtime-only subset (tesseract.exe 1.5 MB + 51 DLLs
158.2 MB + eng data 3.9 MB) is 163.6 MB. **That number does not transfer** —
the Windows build statically bundles image-format libraries that a Linux image
links from system packages, and it ships 17 training/dev executables
(`ambiguous_words`, `classifier_tester`, `cntraining`, …) a server would not
carry. There is no nix toolchain on this machine, so the real
`nixPkgs = [... "tesseract"]` closure is **unknown** and is not estimated here.
My earlier "15–40 MB" guess in the P1.5 blocker document was exactly that — a
guess — and it should not be relied on.

## G · Installation, recorded (§7/§8)

| | |
|---|---|
| source | `https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-5.4.0.20240606.exe` |
| sha256 | `c885fff6998e0608ba4bb8ab51436e1c6775c2bafc2559a19b423e18678b60c9` |
| version | `tesseract v5.4.0.20240606` · `leptonica-1.84.1` |
| language data | `eng.traineddata` 3.9 MB, `osd.traineddata` 10.1 MB |

⚠️ **It installed to `C:\Program Files\Tesseract-OCR`, not the scoped directory
I intended.** The NSIS `/D=` argument did not survive the shell hop, and the
first attempt used the installer's default location. That is preference **2** in
§7 ("a standard package-manager installation whose ownership and removal are
explicit and whose effect is limited to providing the Tesseract binary") rather
than preference 1, and it is recorded rather than papered over. Verified
afterwards: the **user PATH was not modified**, nothing outside that directory
changed, and removal is a normal uninstall. Disk 71 GB → 69 GB.

## H · A finding for the adapter, not against the engine

On the deliberately-unreadable control page Tesseract emitted **258 characters
of noise** (CER 1.000, zero financial tokens). P1's `ocr_document` treats any
non-empty result as success, so that page would be stored as text and counted
toward `text_complete` — weakening §41's partial-failure contract.

This is an **adapter** concern, not an engine defect: the fix is a
"does this look like text" gate before `replace_page_text`, and it needs its own
rail. Recorded here so it is not discovered later as a surprise.

## I · Recommendation, and what it does not settle

**Adopt Tesseract**, subject to one open item.

It wins quality on both corpora, is ~8–10× faster, adds **no Python
dependency**, loads **no model into the web process**, creates **no temp
files**, and sidesteps the Python-version gate entirely. Against the incumbent's
~169 MB of wheels plus 67 MB of resident model, it is a materially better fit
for a service that must stay responsive.

⛔ **It does not settle the packaging blast radius.** Tesseract is a
`nixpacks.toml` `nixPkgs` entry, and that file is shared by web, worker,
flow-worker and bars-api. The currency changed — a nix package instead of
Python wheels — but the question did not. And the closure size is unmeasured, so
"how much does it actually cost the other three services" cannot be answered yet.

**Suggested next step:** measure the nixpkgs closure (a Railway build is the
only reliable way, or a Linux box with nix), then design the isolation with a
real number in hand. Per §28 the isolation work follows the engine decision, and
the engine decision is now made.
