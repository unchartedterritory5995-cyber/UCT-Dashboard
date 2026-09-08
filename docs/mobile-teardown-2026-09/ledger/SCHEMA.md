# Master Interaction Ledger — Schema v1

Canonical store: `ledger/interactions.jsonl` (one JSON object per line, machine-sortable).
Derived views (`.csv`, `.md`) are generated, never hand-edited.

## Interaction ID grammar

`TV-IOS-<AREA>-<NNNN>`  — TradingView interaction
`UCT-<AREA>-<NNNN>`     — UCT interaction discovered independently (no TV counterpart)

AREA ∈ NAV | CHART | SYMBOL | TF | TYPE | IND | DRAW | SET | ALERT | WATCH |
       LAYOUT | UNDO | REPLAY | TRADE | NEWS | SCREEN | SHARE | WIDGET | A11Y | PERF

## Fields (per §32)

| field | type | notes |
|---|---|---|
| id | string | stable, never reused |
| area | enum | product area (above) |
| screen | string | screen the interaction lives on |
| parent_surface | string | how the user got there |
| target | string | the control / region touched |
| gesture | enum | tap, double_tap, long_press, drag, swipe_h, swipe_v, pinch, spread, pan, scale_drag, handle_drag, pull_refresh, tap_outside, sheet_drag, rotate, key, deep_link, system |
| preconditions | string | state required |
| action | string | exact user action |
| immediate_response | string | what the UI does at once |
| secondary_surface | string | menu/sheet/dialog opened |
| result | string | functional outcome |
| exit | string | how the user gets out |
| persistence | string | what survives |
| portrait | string | behavior in portrait |
| landscape | string | behavior in landscape |
| premium_gate | yes/no/unknown | |
| evidence_ids | array | refs into evidence/ |
| evidence_confidence | enum | see below |
| uct_equivalent | string | exact counterpart or "" |
| uct_status | enum | see PARITY below |
| uct_steps | int\|null | taps to complete in UCT |
| tv_steps | int\|null | taps to complete in TV |
| ux_delta | string | why one is stronger |
| severity | P0..P4 | |
| user_value | H/M/L | |
| frequency | H/M/L | |
| complexity | XS/S/M/L/XL | |
| recommendation | enum | keep, improve, build, rethink, ignore |
| notes | string | |

## evidence_confidence (§5) — claim EXACTLY what is supported

| tier | means |
|---|---|
| NATIVE_VERIFIED | observed in the real TradingView **iOS app** on a real device |
| OFFICIAL_DOC_VERIFIED | stated in current first-party TradingView docs/release notes |
| VIDEO_VERIFIED | observed in a dated first-party or reliable third-party recording |
| MOBILE_WEB_VERIFIED | observed by us in TradingView **web** at a phone viewport w/ touch emulation |
| INFERRED_NOT_VERIFIED | reasoned, not observed — must never be reported as behavior |
| ACCESS_BLOCKED | native-only; unreachable from this environment |

⛔ MOBILE_WEB_VERIFIED is **not** iOS-native evidence. Desktop-web or
narrow-responsive-web behavior may never be recorded under a native tier.

## uct_status (§33)

UCT_AHEAD · PARITY · PARITY_BUT_WORSE_UX · PARTIAL · MISSING · BROKEN ·
NOT_DISCOVERABLE · DESKTOP_ONLY · MOBILE_UNUSABLE · NOT_APPLICABLE · TV_UNVERIFIED

## Root-cause code (§37) — required on every non-parity row

1 missing_capability · 2 hidden_capability · 3 bad_responsive_layout ·
4 poor_touch_interaction · 5 excessive_navigation · 6 missing_mobile_shell ·
7 desktop_modal_on_phone · 8 chart_library_config · 9 missing_state_persistence ·
10 backend_gap · 11 performance · 12 discoverability · 13 inconsistent_interaction ·
14 exists_but_broken
