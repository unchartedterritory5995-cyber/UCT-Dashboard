// useKeyboardVisible — infers a soft keyboard from a >150px visualViewport height drop.
//
// ⛔ BEFORE YOU DELETE THIS AS "REDUNDANT WITH useTextInputFocus": read this block. Increment 3
// added `hub/useTextInputFocus.js`, which reads focus directly, and `HubRoot.jsx:272` ORs the two
// (`keyboardVisible || textInputFocused || viewportHidden`). The stated reason for keeping BOTH
// was a sentence in `hub/useTextInputFocus.js:15-17` — "a soft keyboard can also cover the pad
// when focus is somewhere this hook cannot see (a cross-origin iframe)" — and that sentence had
// never been measured. It has now been, twice over, and the answer is not what the sentence says.
//
// MEASURED 2026-09-10 (Increment 4 Stream E; Playwright, 390x844, two local origins, the SHIPPED
// `isTextEntry` extracted from its own file and evaluated in the page — see the recorded table in
// `hub/iframeFocusBlindSpot.test.jsx`):
//
//   * chromium AND webkit: with a text field inside a CROSS-ORIGIN iframe genuinely holding focus
//     (confirmed from inside the frame), the parent's `document.activeElement` is the IFRAME
//     element and `isTextEntry` returns FALSE. The focus hook is blind. Claim SUPPORTED.
//   * ⭐ and it is blind to a SAME-ORIGIN iframe too, identically. The origin is not what blinds
//     it — any nested browsing context does. Cross-origin merely removes the workaround: the
//     parent can read a same-origin frame's `contentDocument.activeElement` and gets `null` for a
//     cross-origin one. So the justification is wider than it was written, not narrower.
//
// ⛔ WHAT IS STILL UNMEASURED: whether a soft keyboard actually RISES in that case and takes more
// than the 150px threshold below. That needs a real touch device with a real keyboard — jsdom has
// no viewport, a headless engine has no keyboard (visualViewport read 844 of 844 throughout), and
// the device path is shut while BrowserStack AUTOMATE quota is expired. Filed OPEN, not resolved
// by argument. "The focus hook is blind there" is not the same claim as "a keyboard rises there".
//
// REACHABILITY TODAY: app/src renders exactly two iframes. `NoteVideoHero.jsx:66` is a YouTube
// embed on notebook notes (a shipped hub mode since B10) whose default player has no text field;
// `OptionsFlow_admin.jsx:22` is a TradingView `widgetembed` with `symboledit=1` — a real text
// entry in a cross-origin frame — in a file with zero importers. So the mechanism is real and the
// product does not exercise it yet. That argues for leaving the OR alone: the next embed that
// ships with a search box switches the case on with no change here.
//
// ⚠️ AND THIS HOOK IS NOT HUB-LOCAL. `components/MobileNav.jsx:49` consumes it too, so removing
// it was never a joystick-hub decision to make alone.
//
// ⚠️ TWO DEFECTS OBSERVED WHILE MEASURING AND DELIBERATELY NOT FIXED HERE (Stream E owned this
// file for a measurement, not a rewrite; both are reported rather than silently changed):
//   1. `fullHeight` is captured ONCE at mount, so a rotation or any lasting viewport change makes
//      every later comparison relative to a stale baseline.
//   2. there is no initial sync — mount with the keyboard already up and this reports false until
//      the next `resize` event, which may never come.
import { useState, useEffect } from 'react'

export default function useKeyboardVisible() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Use visualViewport API (best support on iOS/Android)
    const vv = window.visualViewport
    if (!vv) return

    const threshold = 150 // keyboard is at least 150px
    const fullHeight = window.innerHeight

    const handleResize = () => {
      const keyboardOpen = (fullHeight - vv.height) > threshold
      setVisible(keyboardOpen)
    }

    vv.addEventListener('resize', handleResize)
    return () => vv.removeEventListener('resize', handleResize)
  }, [])

  return visible
}
