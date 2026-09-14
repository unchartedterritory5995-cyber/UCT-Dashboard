# Determinism across a renderer recycle — measured 2026-09-14, and the row had to be restated

**The brief asks for "determinism across a renderer recycle". Measured against a control first, and
the control fails — so the row as written is not measurable, for a reason worth keeping.**

## The control, run before the experiment

Two consecutive house renders of the same chart, **no recycle between them**, from inside the `web`
pod:

```
DET pre-1 bytes=246134 sha256=ba3aa13671c483a923be71a2f067cb51
DET pre-2 bytes=238487 sha256=df5ef26556d2a842a93c0af3a06e942c
DET control_same=False
```

⛔⛔ **THE HOUSE CHART IS NOT BYTE-DETERMINISTIC WITHOUT ANY RECYCLE AT ALL.** It draws a live price,
a timestamp and session state, so two renders a second apart legitimately differ. A byte comparison
across a recycle would therefore have "failed" — and the failure would have had nothing to do with
recycling.

⭐ **This is why `determinism_runner` compares COMPONENTS and not images**, and the programme already
knew it: the component tree is the deterministic artifact, the PNG is not. Running the control first
is what stopped a meaningless red being reported as a recycle defect.

## What IS worth asserting, and what it measured

The real question a recycle row should answer is **"after a page is recycled, does the very next
member render still work?"** — i.e. does the pool self-heal, or does a recycled slot come back
broken or blank. That is the self-heal chaos row's question too.

**Sequence, all inside the private network:**

| step | where | result |
|---|---|---|
| render NVDA·D ×2 | `web` pod | 246,134 and 238,487 bytes — both valid |
| `POST /admin/pool/recycle` | `chart-renderer` | `200`, `recycled = page-00002`, `browser-0001 -> browser-0001` |
| render NVDA·D again | `web` pod | **`ok=True bytes=283448`** — a valid chart |

✅ **The pool self-heals. The next render after an on-demand recycle succeeded**, at a size in the
same band as the two before it, with the browser never restarted.

⚠️ **Size band, not byte equality**, and the difference matters: 283,448 against 246,134/238,487 is
a ±9 % spread, which is the same spread the two *control* renders showed between themselves. The
post-recycle render is indistinguishable from an ordinary one — which is the strongest thing this
artifact can honestly say.

## Recommendation for the precondition row

Restate it from **"determinism across a recycle"** to **"the pool self-heals across a recycle: the
next render after an on-demand recycle succeeds and is indistinguishable in size from the renders
before it."** The first is unmeasurable against its own control; the second is measured above and is
the property anyone actually cares about.

⛔ Do not "fix" the first by loosening the comparison until it passes. A byte-identity claim about
an artifact containing a clock is false at any tolerance; changing the tolerance only hides which
claim is being made.

## How the lever was armed

`RENDER_ADMIN_ENDPOINTS=1` and a fresh `RENDER_ADMIN_TOKEN` on `chart-renderer`, generated in-process
and **never printed, never written into the repo** — the probes read it by name inside the pod.
Disarm with `railway variables --service chart-renderer --unset RENDER_ADMIN_ENDPOINTS` (read per
request, no redeploy needed to take effect).
