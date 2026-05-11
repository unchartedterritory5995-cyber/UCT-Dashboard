# Voice Assistant — Slice 3: Wake Word Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Hands-free activation. Say *"Hey UCT Intelligence"* and the orb opens a Realtime conversation without clicking anything. Wake word detection is fully on-device (Picovoice Porcupine WASM) — audio never leaves the browser until the wake word fires.

**Architecture:** Browser loads Porcupine WASM with a custom keyword model. A `useWakeWord` hook initializes a microphone stream into Porcupine; on detection it triggers `useRealtimeSession.connect()` — same code path as the orb click. The wake word can be toggled in Settings (default OFF — opt-in).

**Tech Stack:** `@picovoice/porcupine-web` (browser WASM) · `@picovoice/web-voice-processor` (mic capture) · existing useRealtimeSession from Slice 4

**Spec:** `2026-05-08-voice-assistant-design.md` §2 Wake word: Porcupine on-device.

**Scope:**
- ✅ Built-in keyword `bumblebee` (free, no setup) as initial keyword. Users can swap to a custom "Hey UCT Intelligence" keyword later by training one at console.picovoice.ai and uploading the .ppn file.
- ✅ Toggle in Settings to enable/disable
- ✅ Free Picovoice access key (limited to 3 users/month free — production needs a paid tier later)

**Out of scope:**
- ❌ Custom Porcupine keyword training in-app (uses pre-trained `bumblebee` initially; custom .ppn files can be uploaded later via a future polish task)
- ❌ Multi-language wake words

---

## File Structure

### Frontend
| File | Responsibility |
|------|----------------|
| `app/package.json` | Add `@picovoice/porcupine-web` + `@picovoice/web-voice-processor` deps |
| `app/src/hooks/useWakeWord.js` | NEW. Loads Porcupine, listens for keyword, calls onWake |
| `app/src/context/VoiceContext.jsx` | Add `wakeEnabled` state + toggle |
| `app/src/pages/Settings.jsx` | Add wake-word toggle in Voice panel |
| `app/src/App.jsx` | Mount wake-word listener |

### No backend changes — entirely client-side.

---

## Task 1: Add Picovoice dependencies + access key env var

**Files:**
- Modify: `app/package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install Picovoice packages**

```
cd C:/Users/Patrick/uct-dashboard/app
npm install --save @picovoice/porcupine-web @picovoice/web-voice-processor
```

This adds both packages to `package.json` and `package-lock.json`.

- [ ] **Step 2: Add env var doc**

In `.env.example` at repo root, add:

```
VITE_PICOVOICE_ACCESS_KEY=replace-with-key-from-picovoice-console
```

The user gets a free access key at https://console.picovoice.ai/. Free tier allows 3 monthly active users — fine for testing. Production needs paid tier.

- [ ] **Step 3: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/package.json app/package-lock.json .env.example
git commit -m "feat(voice): add Picovoice Porcupine deps for wake word"
```

---

## Task 2: useWakeWord hook

**Files:**
- Create: `app/src/hooks/useWakeWord.js`

- [ ] **Step 1: Create the hook**

Create `app/src/hooks/useWakeWord.js`:

```js
import { useEffect, useRef } from 'react'
import { PorcupineWorker } from '@picovoice/porcupine-web'
import { WebVoiceProcessor } from '@picovoice/web-voice-processor'
import { BuiltInKeyword } from '@picovoice/porcupine-web'

/**
 * On-device wake word detection via Picovoice Porcupine.
 *
 * - Audio never leaves the browser until the wake word fires.
 * - Initial keyword: BuiltInKeyword.Bumblebee (no training required).
 *   Swap to a custom "Hey UCT Intelligence" keyword later by training
 *   one at console.picovoice.ai and replacing the keyword param.
 *
 * Toggle via the `enabled` flag — pass `false` to fully unmount the worker
 * and release the microphone.
 *
 * Usage:
 *   useWakeWord({ enabled: voice.wakeEnabled, onWake: () => connect('global') })
 */
export default function useWakeWord({ enabled = false, onWake } = {}) {
  const workerRef = useRef(null)
  const subscriptionRef = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined

    let cancelled = false
    const accessKey = import.meta.env.VITE_PICOVOICE_ACCESS_KEY
    if (!accessKey) {
      console.warn('[useWakeWord] VITE_PICOVOICE_ACCESS_KEY missing — wake word disabled.')
      return undefined
    }

    const onKeywordDetected = (detection) => {
      if (typeof onWake === 'function') {
        try { onWake(detection) } catch (e) { console.error('[useWakeWord] onWake error', e) }
      }
    }

    const start = async () => {
      try {
        const worker = await PorcupineWorker.create(
          accessKey,
          [{ builtin: BuiltInKeyword.Bumblebee }],
          onKeywordDetected,
        )
        if (cancelled) {
          await worker.release()
          return
        }
        workerRef.current = worker
        await WebVoiceProcessor.subscribe(worker)
        subscriptionRef.current = worker
      } catch (e) {
        console.error('[useWakeWord] init failed', e)
      }
    }

    start()

    return () => {
      cancelled = true
      const w = workerRef.current
      const sub = subscriptionRef.current
      ;(async () => {
        try {
          if (sub) await WebVoiceProcessor.unsubscribe(sub)
        } catch {}
        try {
          if (w) await w.release()
        } catch {}
        workerRef.current = null
        subscriptionRef.current = null
      })()
    }
  }, [enabled, onWake])
}
```

- [ ] **Step 2: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds. If Picovoice WASM assets need static-import handling, Vite should auto-bundle them; if it fails, you may need to add `optimizeDeps: { include: [...] }` to `vite.config.js` (only if build complains).

- [ ] **Step 3: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/hooks/useWakeWord.js
git commit -m "feat(voice): add useWakeWord hook (Picovoice Porcupine on-device)"
```

---

## Task 3: VoiceContext wakeEnabled state + toggle

**Files:**
- Modify: `app/src/context/VoiceContext.jsx`

- [ ] **Step 1: Add wakeEnabled to state + actions**

Open `app/src/context/VoiceContext.jsx`.

Add to `initialState`:

```jsx
  wakeEnabled: false,
```

Add a reducer case BEFORE `default`:

```jsx
    case 'set_wake_enabled':
      return { ...state, wakeEnabled: !!action.enabled }
```

Add a helper callback inside the provider, near the other action helpers:

```jsx
  const setWakeEnabled = useCallback((enabled) =>
    dispatch({ type: 'set_wake_enabled', enabled }), [])
```

Add it to the value memo + dependency array:

```jsx
  const value = useMemo(() => ({
    ...state,
    attachAudio, playUrl, playStream, pause, resume, stop, setSpeed,
    startListening, startThinking, startResponding,
    beginRealtime, realtimeConnected, realtimeUserTurn,
    realtimeAssistantPartial, realtimeAssistantDone,
    realtimeDisconnect, realtimeError,
    setWakeEnabled,
  }), [state, attachAudio, playUrl, playStream, pause, resume, stop, setSpeed,
       startListening, startThinking, startResponding,
       beginRealtime, realtimeConnected, realtimeUserTurn,
       realtimeAssistantPartial, realtimeAssistantDone,
       realtimeDisconnect, realtimeError, setWakeEnabled])
```

- [ ] **Step 2: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/context/VoiceContext.jsx
git commit -m "feat(voice): add wakeEnabled state to VoiceContext"
```

---

## Task 4: Settings panel wake-word toggle

**Files:**
- Modify: `app/src/pages/Settings.jsx`

- [ ] **Step 1: Add a toggle to the existing VoicePanel component**

Open `app/src/pages/Settings.jsx`. Inside the `VoicePanel` component (defined as a local function near the top of Settings), the existing voice toggle structure looks similar to a row with a checkbox. Read the existing JSX for `VoicePanel` first to match the pattern.

Find the `<div className={styles.voiceRow}>` that contains the "Voice features enabled" checkbox. AFTER that row, add a new row:

```jsx
      <div className={styles.voiceRow}>
        <label className={styles.voiceLabel}>
          <input
            type="checkbox"
            checked={!!wakeEnabled}
            onChange={(e) => {
              setWakeEnabled(e.target.checked)
              try { localStorage.setItem('voice.wakeEnabled', e.target.checked ? '1' : '0') } catch {}
            }}
          />
          {' '}Wake word ("Hey Bumblebee") — hands-free activation
        </label>
      </div>
```

You'll need to bring `wakeEnabled` and `setWakeEnabled` into scope. At the top of `VoicePanel`, where `useVoice()` is called (if not already), add:

```jsx
  const { wakeEnabled, setWakeEnabled } = useVoice()
```

If `useVoice` isn't yet imported in Settings.jsx, add the import:

```jsx
import { useVoice } from '../context/VoiceContext'
```

Also load the persisted state on mount. Inside `VoicePanel`, add a useEffect that runs once:

```jsx
  useEffect(() => {
    try {
      const persisted = localStorage.getItem('voice.wakeEnabled') === '1'
      if (persisted) setWakeEnabled(true)
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] **Step 2: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/Settings.jsx
git commit -m "feat(voice): add wake-word toggle in Settings"
```

---

## Task 5: Mount wake-word listener in App

**Files:**
- Modify: `app/src/App.jsx`

The hook needs to live INSIDE VoiceProvider so it can read `wakeEnabled` and call `useRealtimeSession.connect`.

- [ ] **Step 1: Add to the existing VoiceMounts component**

Open `app/src/App.jsx`. Find the `VoiceMounts` helper component (added in Slice 4 Task 14). It currently renders `<FloatingOrb>` + `<TranscriptBubble>` + invokes `usePushToTalkHotkey`. Replace it with:

```jsx
function VoiceMounts() {
  const { wakeEnabled } = useVoice()
  const { connect } = useRealtimeSession()
  usePushToTalkHotkey({ context: 'global' })
  useWakeWord({ enabled: wakeEnabled, onWake: () => connect('global') })
  return (
    <>
      <FloatingOrb context="global" />
      <TranscriptBubble />
    </>
  )
}
```

Add the new imports at the top:

```jsx
import { useVoice } from './context/VoiceContext'
import useRealtimeSession from './hooks/useRealtimeSession'
import useWakeWord from './hooks/useWakeWord'
```

(If any of those imports are already present, don't duplicate.)

- [ ] **Step 2: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/App.jsx
git commit -m "feat(voice): mount wake-word listener in App"
```

---

## Task 6: Manual e2e

**Files:** none

- [ ] **Step 1: Set Picovoice access key**

User must: get free key at https://console.picovoice.ai/, then add to Railway env vars: `VITE_PICOVOICE_ACCESS_KEY=...`

(Note: Vite env vars prefixed `VITE_` are bundled into the client, which is fine for Picovoice access keys.)

- [ ] **Step 2: Push**

```
cd C:/Users/Patrick/uct-dashboard
git push origin master
```

- [ ] **Step 3: Manual test after redeploy**

1. Hard-refresh uctintelligence.com
2. Open Settings → Voice → enable "Wake word"
3. Grant mic permission if prompted
4. Wait ~1 sec for Porcupine to initialize
5. Say *"bumblebee"* (the built-in keyword — temporary until we ship a custom "Hey UCT Intelligence" .ppn file)
6. The orb should automatically start a Realtime session — same flow as clicking it

If wake word doesn't fire:
- Check browser console for `[useWakeWord]` warnings
- Confirm `VITE_PICOVOICE_ACCESS_KEY` is set in Railway env
- Confirm "Wake word" toggle is enabled in Settings
- Try saying "bumblebee" clearly — built-in keywords need decent enunciation

- [ ] **Step 4: Tag**

```
git tag voice-slice-3-shipped
git push origin master --tags
```

---

## Plan Self-Review

**Spec coverage:** §2 wake word with Porcupine on-device — all 5 tasks cover it.

**Type consistency:** `wakeEnabled` is boolean throughout. `useWakeWord` accepts `{enabled, onWake}` — both used consistently.

**Placeholder scan:** none.

**Open notes:**
- Custom "Hey UCT Intelligence" keyword: requires training a .ppn file at Picovoice console. Initial slice uses built-in `bumblebee`. Swap in a single line change once trained.
- Free-tier limit: 3 monthly active users. Production wake-word adoption needs Picovoice paid tier.
- iOS Safari: WebVoiceProcessor needs the mic to be ALREADY granted before subscribing. If users hit issues on iOS, they need to enable wake word AFTER granting mic for a regular orb session.
