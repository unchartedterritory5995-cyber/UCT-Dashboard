# Q1-F5 — the seven-family x six-ordering table, ON PRODUCTION

Generated 2026-09-13T13-55-30Z · rig profile `canary-chrome-profile-persistent` · `https://uctintelligence.com`

⛔ **Each cell is one full member interleaving**: type online, go offline, type the sentinel sentence, arrange the ordering in the durable store, come back online, fire the family's door **from its own control**, let the drain run. GREEN means the member's offline sentence is in the server's body afterwards — and for an append family, that the node the door appended is still there too.

⛔ **INCONCLUSIVE is never a pass and never a finding.** A door this rig could not open names what was missing. There is no raw-`fetch` fallback: that is a second-writer simulation whose fork is correct.

| family | settle-first | drain-first | marker LIVE | marker EXPIRED | slow PUT | reload mid-flight |
|---|---|---|---|---|---|---|
| `folder` | · not run | · not run | · not run | · not run | · not run | · not run |
| `ticker` | · not run | · not run | · not run | · not run | · not run | · not run |
| `tags` | · not run | · not run | · not run | · not run | · not run | · not run |
| `hero` | · not run | · not run | · not run | · not run | · not run | · not run |
| `append_widget_embed` | — n/a | · not run | · not run | · not run | · not run | · not run |
| `append_financial_fact` | — n/a | · not run | · not run | · not run | · not run | · not run |
| `append_document_excerpt` | — n/a | · not run | · not run | · not run | · not run | · not run |

## Tally

| verdict | cells |
|---|---|
| N/A | 3 |
| not run | 39 |

## Every cell, with its reason

| family | ordering | verdict | what was measured |
|---|---|---|---|
| `folder` | settle-first | · not run | — |
| `folder` | drain-first (the editor could NOT report local state) | · not run | — |
| `folder` | marker LIVE | · not run | — |
| `folder` | marker EXPIRED | · not run | — |
| `folder` | slow PUT (landed, ring populated) | · not run | — |
| `folder` | reload mid-flight (marker from a dead tab) | · not run | — |
| `ticker` | settle-first | · not run | — |
| `ticker` | drain-first (the editor could NOT report local state) | · not run | — |
| `ticker` | marker LIVE | · not run | — |
| `ticker` | marker EXPIRED | · not run | — |
| `ticker` | slow PUT (landed, ring populated) | · not run | — |
| `ticker` | reload mid-flight (marker from a dead tab) | · not run | — |
| `tags` | settle-first | · not run | — |
| `tags` | drain-first (the editor could NOT report local state) | · not run | — |
| `tags` | marker LIVE | · not run | — |
| `tags` | marker EXPIRED | · not run | — |
| `tags` | slow PUT (landed, ring populated) | · not run | — |
| `tags` | reload mid-flight (marker from a dead tab) | · not run | — |
| `hero` | settle-first | · not run | — |
| `hero` | drain-first (the editor could NOT report local state) | · not run | — |
| `hero` | marker LIVE | · not run | — |
| `hero` | marker EXPIRED | · not run | — |
| `hero` | slow PUT (landed, ring populated) | · not run | — |
| `hero` | reload mid-flight (marker from a dead tab) | · not run | — |
| `append_widget_embed` | settle-first | **N/A** | the product cannot reach this state — an append door records a landed revision and never settles with local state (f5Freeze.test.js asserts it from the source) |
| `append_widget_embed` | drain-first (the editor could NOT report local state) | · not run | — |
| `append_widget_embed` | marker LIVE | · not run | — |
| `append_widget_embed` | marker EXPIRED | · not run | — |
| `append_widget_embed` | slow PUT (landed, ring populated) | · not run | — |
| `append_widget_embed` | reload mid-flight (marker from a dead tab) | · not run | — |
| `append_financial_fact` | settle-first | **N/A** | the product cannot reach this state — an append door records a landed revision and never settles with local state (f5Freeze.test.js asserts it from the source) |
| `append_financial_fact` | drain-first (the editor could NOT report local state) | · not run | — |
| `append_financial_fact` | marker LIVE | · not run | — |
| `append_financial_fact` | marker EXPIRED | · not run | — |
| `append_financial_fact` | slow PUT (landed, ring populated) | · not run | — |
| `append_financial_fact` | reload mid-flight (marker from a dead tab) | · not run | — |
| `append_document_excerpt` | settle-first | **N/A** | the product cannot reach this state — an append door records a landed revision and never settles with local state (f5Freeze.test.js asserts it from the source) |
| `append_document_excerpt` | drain-first (the editor could NOT report local state) | · not run | — |
| `append_document_excerpt` | marker LIVE | · not run | — |
| `append_document_excerpt` | marker EXPIRED | · not run | — |
| `append_document_excerpt` | slow PUT (landed, ring populated) | · not run | — |
| `append_document_excerpt` | reload mid-flight (marker from a dead tab) | · not run | — |
