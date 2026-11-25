# UCT Relative Strength — the open decisions, decided (2026-11-07)

The owner delegated every open question on 2026-11-07: "You decide all of those remaining for the best and
most effective and user friendly answer. Then plan and complete them all." Each ruling below names the
question, the decision and the reason. The rule applied throughout: the member's read comes first, gold is
rationed to one look-here mark, a number is never shown without its basis, and one fact has one authority.

## The chart (visual spec group C, Phase 1 look questions)

| # | Question | Decision | Why |
|---|---|---|---|
| L1 | Gold before-price dot, 15 px or 13 px at daily zoom | **13 px** (glyph size 1.6) | 15 px read as chunky on phones and crowded the line. 13 px stays the largest mark on the pane, so it is still the one look-here mark. |
| L2 | RS pane share, 0.18 or 0.20 of the candle frame | **0.20** | At 0.18 (87 px on a 900 px chart) the legend half-hid the newest dot. |
| L3 | Indicator library: the added row's green check | **`--text-bright`** | Brand: green means money going up, never "selected"; gold is rationed. |
| L4 | Average line on OLED | **Keep** large-dashed at width 1 | The Phase 1 fix already made it legible on the recapture. |
| L5 | New-low dots: neutral or bear hue | **Keep neutral** (and off by default) | The pane's budget is two hues and one neutral; a red dot reads as a sell signal the indicator does not make. |
| C1 | What gold means across presets | **The preset's one highlight** (as built) | One gold mark per chart, and the menu header names the preset. |
| C2 | Trend shading | **Dropped** | Adds green and red to a pane that already reads from one line and the zero line. |
| C3 | Axis in Mansfield view | **Hidden** (as built) | The signed value is in the pane label; one axis rule for the indicator. |
| C4 | Phone pane identity for other indicators | **Text chip for every own-pane indicator**; no resting pane label yet | A dot cannot name a pane it does not touch. A resting label would sit under the bottom controls today. |
| C5 | Phone chip tap | **Tap opens the menu sheet for a chip that declares a readout**; other chips keep tap-to-edit | The readout is the at-a-glance read; Edit is one row away. |
| C6 | Group every starter | **Yes**, in API order (as built in A7) | |
| C7 | Mansfield whipsaw | **No change** until the evidence job measures it | A hysteresis rule is a methodology change without data. |
| C9 / B12 | Chip popover theme in light mode | **Follows the page** (as built) | A popover that matches the page it opened from reads as part of it. |

## Platform chrome the frames exposed (visual spec group B)

| # | Decision |
|---|---|
| B1 | Every engine series sets `minMove = 10^-precision` beside `precision`, so a tag never rounds a 4-dp value to 2 dp. Parity diffs on other indicators are accepted as corrections. |
| B2 | In the light theme the chart **canvas keeps its own theme** (traders choose dark canvases on purpose), while the **chrome around it follows the page**: the chart toolbar and Chart Settings. |
| B3 | On the phone chart shell the floating buttons hide while the chart is being touched, and the shell reserves a bottom inset so the last pane's value is never under the pill and buttons. Add and coach toasts never cover a pane that was just added. |
| B4 | No violet or sky blue outside data: the mode word in pills uses `--ut-gold`, the pill body `--text-bright` on `--bg-elevated`. |
| B5 | Switches on both platforms use the muted gold track (`--ut-gold-dim` fill, `--ut-gold` knob edge): never green for "on", never a full-gold track. |
| B6 | Screener filter info rings in `--text-muted`, gold only on hover or focus. |
| B7 | Generic enum chips select with `--text-bright` text, a 1 px border and `--bg-hover` fill; only the preset chip keeps gold. |
| B8 | The phone legend panel is one row and its height follows its content. |
| B9 | Right-click inside an indicator pane leads with that indicator's rows (settings, Preset when declared, Hide, Add alert, About), using the chip menu's handlers. |
| B10 | The phone screener toolbar scrolls horizontally with a right-edge fade and keeps clear of the pill. |
| B11 | Inspector section and group labels are 11 px app-wide (the plan's floor). |

## Numbers

| # | Question | Decision | Why |
|---|---|---|---|
| N1 | "Up on down days" starter 3 of 20, or 6 of 20 | **Keep 3+ for the starter, 6 for the chart check**, each labelled with its number | A starter is a search and should return candidates; the check is a pass bar. The label says which. |
| N2 | The four checks' pass rules | **Keep** (pivot speed 5 of 10, green on red 6 of 20) | Stated as UCT's own thresholds, unmeasured, on the card. |
| N3 | Rating denominator | **Cap universe minus ETFs** (as built) | Matches the existing RS rank and IBD's stock-only ranking. |
| N4 | Split guard on the rating job (±60% let a 2:1 split through) | **Use the repo's split detector** (`bars_sanitize.unadjusted_splits`) instead of a threshold; a name with an unadjusted split in its window is left unrated that session | A threshold either passes a 2:1 split or drops a real 50% biotech move. One authority already exists. |
| N5 | Evidence job split guard | **The same detector**; a signal whose forward window holds an unadjusted split is not counted | Same reason. |
| N6 | Evidence forward-return base | **The next session's open** to the horizon's close | A member sees the signal after the close and can act at the next open at the earliest. The signal-close base overstated what was tradeable. |
| N7 | The nightly RS screener step's cost | **Accept**; the receipt now records it | The rolling-high scan is linear since the review fixes, and the cost is measured on every build once armed. |

## Data, alerts and rollout

| # | Question | Decision |
|---|---|---|
| D1 | Arm order | **RS_V2_ENABLED → RS_HISTORY_ENABLED → RS_EVIDENCE_ENABLED → RS_DISCORD_POST_ENABLED**, each verified on the pod before the next. |
| D2 | Rating history backfill | **Backfill one year point-in-time from bars.db** by a one-shot command run when RS_HISTORY_ENABLED is armed, so the rating is on the chart from day one. The readout's "survivorship not yet corrected" line covers the universe-as-held caveat. |
| D3 | Intraday RS alerts | **Refused** for the event addresses (as built; matches the chart). |
| D4 | Soak matrix | **Arm the twelve RS conditions on the daily timeframe**, not the 5-minute one where they are refused each cycle. |
| D5 | Where rating history runs | **The web pod**, beside the screener build (as built). |
| D6 | Learn video start seconds | Start at the chapter that covers relative strength where the video has chapters; otherwise at 1 s. |
| D7 | The dot-rendering screenshot (map §5 q8) | **Reviewed** in the Phase 2a visual round; the glyph scale and the suppressed point markers stand. |
| D8 | The `DISCORD_BREADTH_WEBHOOK_URL` registry row | **Folded in** (done in 2a-01). |

## The Discord post

| # | Question | Decision |
|---|---|---|
| P1 | Every session or red days only | **Every session.** On a session that was not a red day, the red-day line says so with SPY's change ("SPY was not a red day (+0.4%)") instead of "none". |
| P2 | Post time | **04:45 ET** with the 05:15 retry (after the 04:15 rating job, before the premarket read). |
| P3 | List caps | **8 / 8 / 10**, then "and N more". |
| P4 | Sectors | On the rating list only. |
| P5 | Mansfield state | Not printed. |
| P6 | Identity | **UCT Intelligence**. |
| P7 | Channel | **#uncharted-scanners**, through a webhook. The owner creates the webhook there (the bot is 403 in that channel) and sets `DISCORD_RS_WEBHOOK_URL`; a test webhook for the admin door is `DISCORD_RS_TEST_WEBHOOK_URL`. |
| P8 | Floor | **Three distinct names.** |
| P9 | Sign-off | **"Not a recommendation."** The username already says who is posting. |
| P10 | Honesty sentence | **Approved** as written. |

## What still needs the owner's hands

- Creating the Discord webhook in #uncharted-scanners (P7). Nothing posts until it exists and the flag is on.
- Merging PRs #889 and #903 (and the decisions PR) to master, which deploys, and arming the four flags in the order above. Both are production changes and wait for the owner's go.
