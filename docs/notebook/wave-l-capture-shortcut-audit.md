# Wave L — capture shortcut collision audit

**Done BEFORE the shortcut was chosen** (Slice 2b §11), because the instruction
is explicit that picking first and justifying afterwards is not an audit.
Method: read the codebase's own key handlers, then check each candidate against
what browsers and operating systems already claim.

## What UCT already claims

Measured, not recalled — `grep` over `app/src` for modifier key handlers:

| Combination | Owner | Scope |
|---|---|---|
| `Cmd/Ctrl+K` | `CommandPalette.jsx:98` | global |
| `Cmd/Ctrl+Shift+V` | `usePushToTalkHotkey.js:15` | global (push-to-talk) |
| `Cmd/Ctrl+Shift+T` | `usePushToTalkHotkey.js:18` | global (read aloud) |
| bare letters `f · j · t · c · x · v · r · h · d` | chart surfaces, editor | scoped |

⚠️ Noted in passing, **not this wave's to fix**: `Cmd/Ctrl+Shift+T` is the
browser's "reopen closed tab" on Chrome, Edge and Firefox. UCT already took it
for read-aloud before Wave L existed. Recorded so the next person auditing
shortcuts does not think Wave L introduced it.

## Candidates considered

| Candidate | Why it lost |
|---|---|
| `Cmd/Ctrl+Shift+C` | Devtools element inspector in every Chromium browser and Firefox. Taking it from a finance-tooling audience is hostile. |
| `Cmd/Ctrl+Shift+M` | Devtools device toolbar (Chrome) / responsive design mode (Firefox). |
| `Cmd/Ctrl+Shift+K` | Firefox web console. Free on Chrome, but half our plausible audience loses a console. |
| `Cmd/Ctrl+Shift+B` | Toggle bookmarks bar. |
| `Cmd/Ctrl+Shift+O` | Bookmark manager (Chrome) / Library (Firefox). |
| `Cmd/Ctrl+Shift+N` | New incognito/private window. |
| `Cmd/Ctrl+Shift+S` | Firefox screenshot tool; also a common "save as" variant. |
| `Cmd/Ctrl+Shift+E` | Firefox network monitor. |
| `Cmd/Ctrl+I` / `Cmd/Ctrl+B` | Italic / bold inside the note editor — capture must work **while writing**, so an editor collision is disqualifying. |
| A bare letter | Fires while typing. Disqualified immediately. |
| **`Cmd/Ctrl+Shift+Y`** | **Chosen.** |

## Why `Cmd/Ctrl+Shift+Y` wins, and its honest cost

It is the least-contested remaining combination: unclaimed by UCT, unclaimed by
Chrome, Edge and Safari, and not a devtools or editor binding anywhere.

⛔ **It is not perfect.** On **Firefox/Linux** `Ctrl+Shift+Y` opens the Downloads
library. There is no collision-free modifier+letter left, and pretending
otherwise would be the kind of claim this program keeps having to retract.

**What makes an imperfect key acceptable here:** the shortcut is an
*accelerator*, never the only door. Capture is discoverable through the command
palette (`Cmd/Ctrl+K` → "Quick Capture"), through the in-app surface doors, and
on mobile where no keyboard exists at all. A member who loses the shortcut to
their browser loses speed, not the feature — which is exactly the property that
would NOT hold if the shortcut were the primary entry point.

**Deliberate behaviour:** the shortcut fires even while the caret is in the note
editor. "Capture the thought I just had" is a real workflow, and a shortcut that
only worked when nothing was focused would miss the case it exists for.

## Pinned

`CaptureHost.test.jsx` asserts that `Cmd/Ctrl+K`, `Cmd/Ctrl+Shift+V`,
`Cmd/Ctrl+Shift+T`, `Cmd/Ctrl+Shift+C` and a bare `Y` do **not** open capture.
If someone later rebinds capture onto an established command, that test fails
rather than the theft shipping quietly.
