# Future work — internal UCT capture expansion (G-040)

**Status: NOT SCHEDULED. Do not implement from this document.**
Created 2026-09-08 by owner ruling, descoping these surfaces from Wave L.

## Why this exists

G-040 read as *"Save-to-Notebook is not reachable from Screener, Options Flow,
COT Data, Model Book"* — which sounds like four missing buttons. Wave L went to
wire them and found it is not that.

An internal capture stores `widgetId` + `params` and re-renders through
`WIDGET_REGISTRY`. A surface can therefore only be a capture door if it **has a
registry entry**. Measured 2026-09-08:

| Surface | Registry entry | Real blocker |
|---|---|---|
| Screener | **none** | needs a new widget definition |
| COT Data | **none** | needs a new widget definition |
| Model Book | **none** | needs a new widget definition |
| Options Flow | exists | `reconstructable: false`, `menus.journal: false` — a deliberate decline |

⭐ **This is why no wave "just wired" them.** The work is product/data semantics,
not UI.

## What a new definition actually costs

Per surface: params schema · provenance · rights policy · freeze-vs-reconstruct
policy · plain-text/search representation · embed renderer · tenant + lifecycle
behaviour · menu/placement policy · certification.

## The unanswered question per surface

**Screener** — what IS captured? One result row, the whole result set, the scan
*definition*, or the point-in-time values? Frozen, or recomputed on open? A scan
re-run in April against a March capture is a different scan; a frozen row is a
different object from a saved screen.

**COT Data** — what is authoritative? The report week, or the publication
vintage? CFTC data is revised, so a re-fetch can silently disagree with what the
member saw. This one interacts directly with the frozen-at-insert temporal
contract and with G-063's gate.

**Model Book** — what does capture mean for a curated historical example that
already exists as a canonical artifact? Duplicate it, reference it, freeze a
presentation state, or preserve only the member's annotation against it?

**Options Flow** — the existing decline stands. Its own comment says *"flow at a
past instant is not replayable"*, which is a material product-semantic reason,
not an oversight. A future workstream must first decide what a truthful frozen
flow capture would even be. Reversing it also needs partner acknowledgement,
since `OptionsFlow.jsx` is partner-owned.

## The standard this work is held to

⛔ **Coverage is not automatically a virtue.** The evaluation may legitimately
conclude that some of these surfaces SHOULD NOT support Journal capture. A saved
artifact that misrepresents what it froze — an "as of" that quietly re-fetches,
a row that no longer means what the member saw — is worse than no door at all,
and this program has already paid for that lesson once in G-063.

## Not to be confused with

Wave L's **external web capture** (`capture.js` → `/api/j2/capture`) and
**member-authored thoughts** (canonical Notebook write path). Those are different
semantic kinds with their own write paths; see the Wave L entry checkpoint. This
document is only about the INTERNAL UCT artifact kind.
