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

## G · What the single authorized canary must answer

1. did Railway select `Dockerfile.web` (read from the manifest, not from what we set)
2. did the build succeed, and how long did it take
3. exact `tesseract --version` and English traineddata present
4. python still 3.12 · node present · ffmpeg present
5. web starts, `/api/health` green, fresh-process RSS
6. no unrelated service rebuilt
7. the other services carry no Tesseract **package** (not merely "never invoked it")
8. OCR still dark, zero member documents processed
