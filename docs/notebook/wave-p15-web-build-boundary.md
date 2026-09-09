# Wave P1.5 — the web build boundary

```
MECHANISM        repo-owned railway.web.json -> Dockerfile.web
SELECTED BY      web's config-as-code path (one service setting)
OTHER SERVICES   unchanged: worker/flow-worker read railway.json (NIXPACKS),
                 bars-api RAILPACK, chart-renderer its own Dockerfile
OCR              installed in the web image, NOT enabled anywhere
ABANDONED        NIXPACKS_CONFIG_FILE — removed from the repo and from all
                 four services
```

## A · Why the first mechanism failed — now measured, not guessed

The previous canary left two candidate explanations. Railway answers it directly:
every deployment publishes a `serviceManifest`, and web's reads

```
builder            NIXPACKS
nixpacksConfigPath /nixpacks.toml        <- a SERVICE FIELD, already pinned
buildCommand       pip install -r requirements.txt && cd app && npm …
configFile         /railway.json
propertyFileMapping  build.builder, build.buildCommand, deploy.*
```

⭐ **The build config path is a first-class field of the service manifest.** It
was already set to `/nixpacks.toml`, so a `NIXPACKS_CONFIG_FILE` *service
variable* never had standing to change it — it was only ever a runtime variable.
Explanation **A**. No second production build was spent to learn this; it is a
read.

⛔ **The permanent lesson stands and generalises:** a runtime variable being
present does not prove it selected the build graph. Runtime service scoping and
build-config selection are different systems that happen to share a UI.

⭐ And the same manifest shows `propertyFileMapping` — which settings came from
the config FILE rather than the dashboard. `build.builder` is one of them, so
railway.json's `"builder": "NIXPACKS"` **overrides** any dashboard builder
choice. That kills the "just set web's builder to DOCKERFILE in the dashboard"
route outright: the file would keep winning. The config file itself has to
change, and it is shared by three other services.

## B · The mechanism that follows from that

`configFile` is **per service** — and this project already proves it, three ways:

| service | builder | build definition |
|---|---|---|
| web · worker · flow-worker | NIXPACKS | `/railway.json` + `/nixpacks.toml` |
| bars-api | RAILPACK | (no config file) |
| chart-renderer | DOCKERFILE | its own `Dockerfile`, uploaded from its own directory |

So web gets its own config file:

```
railway.web.json   build:  DOCKERFILE + dockerfilePath Dockerfile.web
                   deploy: THE SAME BLOCK, copied from railway.json
Dockerfile.web     the image
```

and **one** service setting points web at it. That satisfies the ruling's
preference exactly: the dependency and build definition live in git —
reviewable, versioned, mutation-tested — and the only out-of-repo state is
*which file web reads*, which is a single reversible field.

⛔ **The file is `Dockerfile.web`, not `Dockerfile`.** A root `Dockerfile` is
auto-detected, so it would become a landmine for any service that ever loses its
explicit builder setting. Opt-in by name; a rail asserts no root `Dockerfile`
exists.

## C · ⚰️ The real risk is parity, not size

`chart_renderer` is the precedent for *a service owning its build*, and nothing
more: it is a 13-line image for a standalone app. Web is built from the
repository root and must keep everything it has today. Measured on the live
nixpacks image (2026-09-08) before writing anything:

```
python 3.12.7   venv at /opt/venv, first on PATH      node v20.18.0
ffmpeg 7.1      git   curl   tar/xz/gzip              tesseract ABSENT
```

Two of those are **runtime** dependencies that would fail silently, days later,
far from any request:

- **node** — `cot_prewarm` shells out to `app/dist/cot-facts.cjs` for the COT
  weekly read (Fridays 17:05 ET); `flow_aggregate` does the same for the flow
  bundle. Both resolve `node` off PATH.
- **ffmpeg** — `desk_background_audio` extracts the 96k AAC from each Desk
  session recording.

A Python-only runtime image would have built green, deployed green, passed the
health check, and quietly stopped generating the COT read. `git` is the eval
runners' commit stamp. All four are reproduced, and
`tests/test_ocr_build_isolation.py` fails if any of them leaves the file.

⭐ **The runtime `node` is copied out of the stage that built the frontend**, so
there is exactly one node version in the image rather than two tags that drift.

Two further parity decisions:

- **Node is pinned to `20.18.0`, the exact version production runs today**, so
  this slice changes packaging and nothing else. That tag is from 2024-11 and
  carries no later patches — raising it is worth doing, deliberately, in its own
  change.
- **ffmpeg comes from Debian bookworm (5.1.x) where the nix image had 7.1.**
  Recorded, not hidden: AAC extraction from an MP4 is well inside 5.1, and
  chasing 7.1 would mean a custom build for one subprocess call.

## D · The image

Three stages. The frontend is built by node 20.18.0 with the *same* command
nixpacks runs. Python wheels are installed in a stage that has a compiler, so
the first package that stops shipping a wheel fails the build instead of failing
at 3am — and the toolchain never reaches the runtime image. The runtime is
`python:3.12-slim-bookworm` (§11 — production stays on 3.12), plus apt:

```
tesseract-ocr  tesseract-ocr-eng     <- the OCR system dependency, English only
ca-certificates curl ffmpeg git libstdc++6   <- parity with today
```

⛔ **English is a package, not a download** — nothing about a boot depends on a
third-party fetch. No training toolchain, no other language, no `-dev` headers.

⛔ **The build context is the git tree.** `node_modules/`, `.venv/` and
`app/dist/` are gitignored and never reach it, so `COPY . /app` copies exactly
what Railway ships today and cannot silently omit an API module, a migration, a
script or an asset. That is why there is no `.dockerignore`: adding one would
also change what the *nixpacks* builds see.

⛔ **The start command is not forked** (§6). `railway.web.json`'s `deploy` block
is copied from `railway.json`, and a rail asserts the two are equal — not
similar. Two hand-maintained copies of a start command is the
second-authority-over-one-value defect that has caused outages in this repo
before.

## E · OCR is installed, not enabled

The image carries the binary. Nothing sets `J2_OCR_ENABLED` — not the
Dockerfile, not any of the four services (read live, never inferred from a code
default). And the canary deploys **master**, which does not carry Wave P's OCR
code at all: the adapter, the storage contract and the usability gate remain on
the unmerged branch. Presence of an engine and activation of a feature are two
different facts, and only the first one is in this slice.

## F · What is proven before the build, and what only the build can answer

`tools/wave_p15_build_boundary_proof.py` reads the live Railway manifests and
the repository together, and prints A–F. Before the canary it correctly reports
**A FAIL** (web still builds NIXPACKS from `/railway.json`) with B–F passing —
an instrument that cannot report the negative is not an instrument.

⚠️ **There is no Docker toolchain on this machine**, so the image could not be
built locally; free disk was 73 GB and none of it was spent. The static proof is
therefore: the Dockerfile parsed into stages and instructions, both config files
parsed as JSON, and the live manifests. 19 structural rails, five of them
mutation-proven (byte-identical restores):

| mutation | goes red |
|---|---|
| tesseract into the SHARED nixpacks list | shared-build-stays-clean |
| drop `ffmpeg` from the web image | runtime-parity |
| point the config at a Dockerfile that does not exist | boundary-selection |
| change one field of the web deploy block | start-command-has-one-authority |
| drop the node COPY | node-reaches-the-runtime-image |

⛔ One defect was found in the instrument itself and fixed: a failed
`railway variables` read returned "not set", which scored as **OCR is dark**. A
swallowed error becoming a confident finding, on the one check that says whether
OCR is live for members. Unknown is now `FAIL`, with one retry first.

## G · THE CANARY RAN — the build is proven, the deploy is not

```
BUILD BOUNDARY   ✅ SELECTED  — Railway built Dockerfile.web
BUILD            ✅ SUCCESS   — image exported and pushed
DEPLOY           ⛔ FAILED    — the container died ~2s after the volume mounted
PRODUCTION       ✅ HEALTHY   — automatic rollback to the nixpacks image
MEMBER IMPACT    none · no member document processed · OCR never enabled
```

Deployment `a9df2c4c`, commit `476111bf7`, created `03:04:27Z`, failed
`03:07:49Z`.

### The mechanism works — this is the half the last canary could not reach

Railway's own manifest for that deployment:

```
builder         DOCKERFILE
dockerfilePath  Dockerfile.web
configFile      /railway.web.json
```

⭐ **The build boundary was EXPLICITLY SELECTED AND PROVEN**, which is precisely
the property the previous mechanism failed. And the build log proves the
isolation is real rather than nominal:

| package | version | .deb |
|---|---|---|
| `tesseract-ocr` | **5.3.0-2** | 402 kB |
| `libtesseract5` | 5.3.0-2 | 1279 kB |
| `liblept5` | 1.82.0-3+b3 | 1050 kB |
| `tesseract-ocr-eng` (English traineddata) | 1:4.1.0-2 | 1594 kB |
| `tesseract-ocr-osd` (pulled as a hard dependency) | 1:4.1.0-2 | 2992 kB |

⭐ **≈7.3 MB of compressed Debian packages** — against the ~169 MB of Python
wheels the rejected engine wanted. That is the packaging cost the whole
detour existed to measure, and it is now a number.

⛔ **Two honest deltas from the engine that was selected:**

- **Tesseract is 5.3.0 here, not the 5.4.0 the benchmark measured.** Same major
  line, and the storage contract, job state and usability gate are
  engine-version-independent by construction — but FTS search recall was
  measured on 5.4.0. Re-running the gate corpus against 5.3.0 belongs to P2,
  before any member activation. Do not carry the 5.4.0 recall number over
  silently.
- `tesseract-ocr-osd` arrives whether or not it is asked for: it is a hard
  dependency of `tesseract-ocr` and survives `--no-install-recommends`. English
  is still the only language *requested*, and OSD is orientation data, not a
  second language.

Also measured, and both dead as failure hypotheses: `ffmpeg` resolved to Debian
**5.1.9** (the nix image has 7.1 — recorded, and AAC extraction is well inside
5.1), and `libgomp1` did land in the runtime image as an ffmpeg dependency.

### ⛔ What is NOT known: why the container died

```
03:07:47  Mounting volume on: /var/lib/containers/...
03:07:49  FAILED
```

That is the **entire** captured runtime log — one line, and it is Railway's own,
not the application's. `deployment.diagnosis` is `null`. No traceback, no
"command not found", no healthcheck message. The healthcheck cannot be the
cause: its timeout is 600s and this died in seconds.

⚠️ **Three hypotheses were checked against the build log and are DEAD:**

- *no `/bin/bash` in the slim image* — bash is Essential in Debian; it is there.
- *missing `libgomp1`* — installed in the runtime stage via ffmpeg.
- *the build did not finish* — it did: all three stages ran, `cot-facts.cjs` and
  `flow-facts.cjs` were written, and the image was exported and pushed
  (`sha256:a2a6c60d…`).

⛔ **So the cause is undetermined, and per the ruling no second build was spent
guessing at it.** What is left is the one surface this project has never
exercised: a Railway **service start command** on a **Dockerfile-built** image.
`chart-renderer`, the only other Dockerfile service here, sets no start command
at all — it runs its image's `CMD`. Our image already carries the identical web
command as its `CMD`, so the next attempt has a concrete, non-speculative shape
rather than a guess.

### The §17 answers, including the ones that cannot be given

| # | question | answer |
|---|---|---|
| 1 | Dockerfile selected? | **yes** — manifest, not inference |
| 2 | build succeeded? | **yes**, ~1m51s to image export (nixpacks builds the same commit in ~3m50s end-to-end) |
| 3 | Tesseract version | **5.3.0-2** (from the build log; the binary never ran) |
| 4 | English traineddata | **yes** — `tesseract-ocr-eng 1:4.1.0-2` |
| 5 | Python still 3.12? | by construction (`python:3.12-slim-bookworm`); **unverified at runtime** |
| 6 | web starts? | **no** |
| 7 | health checks green? | production is green **on the rolled-back nixpacks image** |
| 8 | fresh-process RSS | **not obtainable** — the process never served |
| 9 | build duration | ~1m51s to image, 3m22s to the failure |
| 10 | image/package impact | **≈7.3 MB of OCR .debs**; total image size **NOT EXPOSED by Railway** |
| 11 | unrelated service rebuilt? | **no** — worker, flow-worker and bars-api all recorded **SKIPPED**; chart-renderer untouched since 2026-09-01 |
| 12 | non-web Tesseract absence | **proven at package level** — binary absent AND `dpkg -l` matches **0** on all three |
| 13 | OCR dark? | `J2_OCR_ENABLED=UNSET` in the serving container and unset on all four services; master carries no OCR code |
| 14 | member documents processed | **zero** |

### State restored

Web's config-as-code path is pointed back at `railway.json` — the same file it
read before the canary, proven by the pre-canary manifest. Leaving it on
`railway.web.json` would have made the **next ordinary master push from any
workstream** build the Dockerfile and fail to ship, silently, while web went on
serving a stale image. That is a landmine, not a held position.

⚠️ One difference from the exact prior state, recorded rather than smoothed
over: the pointer is now **explicit** (`railway.json`) where it was previously
implicit (auto-discovery, which resolved to the same file). The API ignores a
null for this field, so it cannot be returned to "unset".

Production after: `status ok`, RSS 2639.8 MB (baseline 2727.3), serving Ubuntu +
nix with no Tesseract. `J2_SHARE_LINKS_ENABLED=0` unchanged, NOTE_SYNC state
unchanged, broker_sync floor 10 on master, local disk 72.6 GB.

⛔ **P1.5 CANNOT CLOSE.** Stopping here with the evidence, as instructed.

---

## H · The second canary — one variable, and it had TWO sources

The authorized change is exactly one thing: **stop supplying a Railway start
command and let the image's `CMD` be authoritative.** Nothing else moves — same
packages, same base, same Python, same Node, same healthcheck, same OCR gate,
same builder selection, same Dockerfile path, same volume.

⚰️ **But "the start command" turned out to live in two places, and only one of
them was visible from the first canary.** Reading web's service instance
directly:

```
serviceInstance(web).startCommand = "uvicorn api.main:app --host 0.0.0.0 --port $PORT"
```

A **stale service-level start command** — no `--proxy-headers`, no
`--forwarded-allow-ips`, no `--timeout-graceful-shutdown`, no service branching.
It has been silently overridden by `railway.json`'s `deploy.startCommand` for as
long as that file has existed, so it has never run and nobody has had a reason
to look at it.

⛔ **Removing only the file's copy would have contaminated the experiment.**
With `railway.web.json` no longer supplying one, that service-level value would
have applied instead, the image `CMD` would still not have been authoritative,
and a green result would have proved the wrong thing — the classic
`lesson_a_second_authority_over_one_value`, discovered one step before it could
lie to us.

Both are now gone:

| source | before | after |
|---|---|---|
| `railway.web.json` `deploy.startCommand` | the branching `if…fi` string | **absent** |
| web service-level `startCommand` | `uvicorn api.main:app --host 0.0.0.0 --port $PORT` | **cleared** |

⭐ **And the clearing idiom is now known.** The API **ignores `null`** for these
string fields — null means "leave unchanged" — while an **empty string clears
them**. That is why the config pointer could not be returned to unset earlier.
Use `""`, never `null`, and always read back.

### The start command still has exactly one authority

Moving a command is not the same as forking it. `Dockerfile.web`'s `CMD` must be
the *same* command every other service runs out of `railway.json`, so the rail
now derives it:

```
railway.json  startCommand -> take the `else` branch -> normalise ${PORT:-8080} to $PORT
                                          ==
Dockerfile.web  CMD
```

It matched character for character on the first run. Two mutations prove it can
fail: drop `--proxy-headers` from the image CMD, or put a `startCommand` back
into `railway.web.json` — each turns a named rail red, with byte-identical
restores. 21 isolation rails green.

⛔ **One consequence, stated rather than discovered later:** with the branching
start command gone, the web image can only ever start the web service. That is
correct — it is the web image, and the other three build from `nixpacks.toml`
and keep the branching command — but it means this image must never be reused
for worker/flow-worker/bars-api.

### What the deployment manifest must show for the result to count

`serviceManifest.deploy.startCommand` on the new deployment decides whether this
was a clean experiment:

- **absent/null** → no start command was applied → the image `CMD` was
  authoritative → the result means what it says.
- **`""`** → Railway kept an empty command → the run is contaminated and we know
  exactly why, rather than guessing again.

⛔ **A green health check is NOT proof the CMD was used.** The process's own
command line is (`/proc/1/cmdline` in the running container).
