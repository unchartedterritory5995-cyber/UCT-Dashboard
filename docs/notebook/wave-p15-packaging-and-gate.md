# Wave P1.5 — usability gate, Tesseract adapter, and a failed packaging canary

```
OCR USABILITY GATE       IMPLEMENTED · design/control validated · 0 errors
TESSERACT ADAPTER        IMPLEMENTED · real-engine E2E green
OCR ACTIVATION           DARK (J2_OCR_ENABLED unset everywhere)
BUILD ISOLATION          ⛔ MECHANISM FAILED — NIXPACKS_CONFIG_FILE is not honoured
PRODUCTION STATE         restored; no variable left set; web healthy
```

⛔ **§34 stop condition hit: "Tesseract unavailable despite successful build."**
Reported rather than retried.

---

## A · The usability gate (§17–§27)

⚰️ P1 treated any non-empty OCR result as usable text. The Tesseract benchmark
disproved it: on a page unreadable by construction the engine emitted **258
characters of noise** —

```
meee conpenanon COMDENDED CONTA DATED STATEMENTS OF ue ter ented
baptembe 8 2616 oe eres ont 1) Oe ot tee eee Oe ee ma are an 8 ...
```

Stored, that page would have counted toward `document_complete`, put garbage in
Search, and offered garbage as thesis evidence.

⛔⛔ **A naive prose test would have made it worse.** Measured: the noise page
had **more** word-like tokens (57 vs 32) and a **higher** alphanumeric ratio
(0.964 vs 0.851) than a real segment table. Counting "wordish" tokens would
reject the table and accept the noise — exactly what §19 warns about.

⭐ **What separates them is token shape.** Noise is two-character fragments
(`oe ee ot ma an`); real financial text is number-bearing tokens and four-letter
runs. A token is **meaningful** if it carries a digit (`$12,913`, `51%`, `Q3`,
`2026`) or holds a 4+ letter run (`Automotive`, `SEGMENT`).

Built on a **third** corpus, split design/control. The threshold was chosen on
the design half and then scored **once** on the unseen control half:

| split | GOOD ratios | BAD ratios |
|---|---|---|
| design (threshold chosen here) | 0.739 – 0.909 | 0.000 – 0.266 |
| **control (scored once)** | **0.690 / 0.770 / 0.786** | **0.000 × 3** |

Threshold **0.50**. **0 errors on the control split**, in both directions (§22).

⛔ **The count floor is deliberately low.** A legitimate sparse slide yields 11
meaningful tokens while the noise page yields 17 — so a *count* threshold
separates nothing and would reject real pages. The ratio is the discriminator.

⛔ **It decides, it never corrects** (§18): accepted whole or rejected whole. No
dictionary, no spell-check, no invented spaces, no rewritten numbers.
⛔ **It sits before the FTS-safe write** (§27): rejected text never reaches the
index, rather than being stored and hidden at the UI.
⛔ **Rejected text is not persisted at all** (§24) — only the reason.
⛔ A quality rejection is **terminal in one step**: the same bytes through the
same engine produce the same noise, so three identical retries are waste.

## B · The Tesseract adapter (§29/§30)

Subprocess with a fixed argument vector; the page image goes in on **stdin** and
text comes back on **stdout**, so there is no path a client could name and
**no temp files** (§32). Bounded timeout (60 s) and output (200k chars). No
member-influenced string reaches the command line. `stderr` is never logged or
re-raised — it can echo page content, and §33 forbids private document text in
logs.

Engine-specific code lives in its own module. The storage contract, job state,
recovery and readiness stay engine-independent, so the engine remains
replaceable.

**Dark by default** (§13). `J2_OCR_ENABLED` gates **execution only** — page
truth, `no_text` semantics and the FTS invariants are correct with it on or off.
Three states are distinguished, because "off" and "meant to be on and the binary
is missing" are different operational facts and only one is a defect.

## C · ⛔ The packaging canary FAILED, and exactly how

**Design.** `nixpacks.web.toml` — a faithful copy of `nixpacks.toml` plus
`aptPkgs = ["tesseract-ocr", "tesseract-ocr-eng"]`, selected by a
`NIXPACKS_CONFIG_FILE` service variable on web only. apt rather than `nixPkgs`
deliberately: the nixpkgs `tesseract` derivation ships **all** languages and
`nixPkgs` takes names with no way to pass an override.

**Sequencing.** The file was pushed to master **first**, alone and inert, with
its rail. A variable naming a file that exists only on a feature branch would be
a landmine for the next ordinary master deploy from any workstream — web would
build against a config path that is not there. **File first, variable second.**

**What happened.**

| step | result |
|---|---|
| `nixpacks.web.toml` + rail pushed to master (`526637158`) | ✅ inert, nothing selected it |
| `NIXPACKS_CONFIG_FILE=nixpacks.web.toml` set on **web only** | ✅ web has it; worker, flow-worker, bars-api verified **absent** |
| web rebuild | ✅ **SUCCESS** |
| `which tesseract` on web | ❌ **not found** |
| `dpkg -l \| grep tesseract` on web | ❌ **no package entry** |
| binary in `/usr/bin`, `/usr/local/bin`, nix profile | ❌ **absent** |
| `$NIXPACKS_CONFIG_FILE` at runtime on web | ✅ `nixpacks.web.toml` |

**So the variable reaches the container but did not select the build config.**
The build succeeded because it simply used the ordinary `nixpacks.toml` — which
is precisely the closed failure direction the design intended, and why nothing
broke.

⛔ **Two explanations remain and I did not spend more production builds
separating them** (§34: report the failure, do not guess repeatedly):

1. Railway's builder does not pass service variables to nixpacks as
   configuration-file selection, so `NIXPACKS_CONFIG_FILE` was only ever a
   runtime variable; or
2. the config *was* read and `aptPkgs` is not honoured by Railway's nixpacks
   version.

The retrievable build log starts mid-`pip install` and does not reach the setup
phase, so it cannot distinguish them from here.

**Cleanup.** The variable was **deleted from all four services** — a set-but-
ineffective variable that implies OCR isolation is active is worse than none
(`project_feature_flag_ledger`). Verified absent on web, worker, flow-worker
and bars-api. Production healthy afterwards: `status ok`, fresh process.

⛔ **No member document was processed. OCR never activated.** `J2_OCR_ENABLED`
was never set anywhere.

## D · What the canary did establish

- **Per-service variables are genuinely per-service.** The variable landed on
  web and was verifiably absent from the other three — so *whatever* mechanism
  ends up selecting the build, the targeting half works.
- **The closed failure direction holds.** A mechanism that silently does nothing
  leaves every service building exactly as before. Nothing shipped OCR anywhere.
- **The file-before-variable sequencing was right** and is worth keeping for
  whatever mechanism replaces this one.

## E · Options for the owner

1. **Railway dashboard per-service build settings.** Railway exposes per-service
   *Root Directory*, *Build Command* and config-file settings that the CLI does
   not surface. A per-service build command could install the apt packages —
   though whether a nixpacks build-phase apt install survives into the runtime
   image is itself unverified.
2. **A web-specific Dockerfile**, following the `services/chart_renderer/`
   precedent. It is the one mechanism in this repo *known* to give a service its
   own system dependencies. Cost: web leaves nixpacks, which is a larger change
   than §10 wanted.
3. **Accept the shared image for Tesseract.** The apt packages are small and
   English-only; the currency here is far cheaper than the rejected 169 MB of
   Python wheels. This is the option §1 rejected for RapidOCR — but the size
   argument is materially different, and the closure is still unmeasured.

⛔ **I have no recommendation between these without one more measurement**, and
each one costs a production build. That is the decision to make before spending
it.

## F · State after this slice

| | |
|---|---|
| branch | `notebook-primary-platform`, unmerged |
| master | `526637158` — carries only the inert build config + its rail |
| production | healthy; **no OCR anywhere**; no variable set |
| rails | 38 OCR + 10 isolation; 252 in the notebook-family regression |
| mutations | gate → `bool(text.strip())` turns **five** rails red incl. the Search negative control; tesseract into the shared nixpacks list turns the isolation rail red |
| real-engine E2E | **ran, not skipped** — scanned page → classify → OCR → gate → DELETE+INSERT → production Search finds `CONDENSED`, `margin`, `revenue`, `billion` |
| disk | 73 GB; still no OCR temp files |

⛔ Handwriting NOT ASSESSED · English only · classifier certified for the tested
scan class · nixpkgs/apt closure size **unmeasured and asserted nowhere**.
