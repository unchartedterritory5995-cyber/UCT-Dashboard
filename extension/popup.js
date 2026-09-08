/**
 * The capture surface. One screen, three actions at most: see where it is
 * going, optionally say why it matters, save — and stay on the page.
 *
 * ⛔ WHAT IT READS FROM THE PAGE, AND NOTHING MORE (§12): the current URL, the
 * page title, and the text the member had already selected. `readSelection`
 * below is the ENTIRE page-access surface of this extension — one expression,
 * injected only when the member invokes the action, under `activeTab`. No DOM
 * crawl, no hidden elements, no forms, no history, no page body. A wider read
 * would also buy nothing: the server refuses a full-page capture regardless of
 * who is asking.
 */

import { ENDPOINTS, MAX_PASSAGE_CHARS } from './lib/config.js'
import { authorizedFetch, getCredential, ReconnectRequired } from './lib/auth.js'

const $ = (id) => document.getElementById(id)

/**
 * ⛔ THE WHOLE PAGE-ACCESS SURFACE. Injected into the active tab on explicit
 * invocation and returns the member's own selection as a string. It reads
 * nothing else, and `app/src/pages/journal-2-0/lib/extensionBoundary.test.js`
 * fails by name if this function grows.
 */
function readSelection() {
  return String(window.getSelection ? window.getSelection().toString() : '')
}

// Live state. Kept here rather than re-read from the DOM so a failed save and a
// forced reconnect can both restore it without the member retyping anything.
const state = {
  url: '', title: '', domain: '', passage: '',
  annotation: '', destinations: [], destinationId: '',
}

function show(section) {
  $('connect').hidden = section !== 'connect'
  $('capture').hidden = section !== 'capture'
}

function setError(msg) {
  const el = $('error')
  el.textContent = msg || ''
  el.hidden = !msg
}

function setOk(msg) {
  const el = $('ok')
  el.textContent = msg || ''
  el.hidden = !msg
}

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab) return
  state.url = tab.url || ''
  state.title = tab.title || ''
  try {
    state.domain = new URL(state.url).hostname.replace(/^www\./, '')
  } catch { state.domain = '' }
  try {
    const [hit] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: readSelection,
    })
    state.passage = (hit?.result || '').trim()
  } catch {
    // A page the extension may not touch (chrome://, the web store). A link
    // capture still works, so this is a narrower capture, not a failure.
    state.passage = ''
  }
}

function renderSource() {
  $('sourceTitle').textContent = state.title || state.url
  $('sourceDomain').textContent = state.domain
  const isPassage = !!state.passage
  $('kind').textContent = isPassage ? 'Selected passage' : 'Link'
  $('passageWrap').hidden = !isPassage
  if (isPassage) {
    $('passage').value = state.passage
    // Said BEFORE the round trip, and it does not trim to fit: silently
    // shortening a member's quote would change what they think they saved.
    $('passageNote').textContent = state.passage.length > MAX_PASSAGE_CHARS
      ? `That selection is ${state.passage.length.toLocaleString()} characters — over the ` +
        `${MAX_PASSAGE_CHARS.toLocaleString()} limit for a quote. Save the link instead.`
      : `${state.passage.length.toLocaleString()} characters`
  }
}

async function loadDestinations() {
  const res = await authorizedFetch(`${ENDPOINTS.destinations}?limit=8`)
  const body = await res.json().catch(() => ({}))
  state.destinations = body.destinations || []
  const sel = $('destination')
  sel.replaceChildren()
  if (!state.destinations.length) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'Open a note in UCT first'
    sel.appendChild(opt)
    sel.disabled = true
    return
  }
  sel.disabled = false
  for (const d of state.destinations) {
    const opt = document.createElement('option')
    opt.value = d.id
    // textContent, never innerHTML: a note title is member text and this is a
    // privileged extension page.
    opt.textContent = d.ticker ? `${d.label} · ${d.ticker}` : d.label
    sel.appendChild(opt)
  }
  state.destinationId = state.destinations[0].id
  sel.value = state.destinationId
}

async function save({ linkOnly = false } = {}) {
  setError(''); setOk('')
  const noteId = $('destination').value
  if (!noteId) { setError('Choose a note to save into'); return }
  state.annotation = $('annotation').value
  const wantsPassage = !linkOnly && !!state.passage

  $('saveBtn').disabled = true
  try {
    const res = await authorizedFetch(ENDPOINTS.capture, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteId,
        tier: wantsPassage ? 'passage' : 'reference',
        url: state.url,
        title: state.title,
        ...(wantsPassage ? { passage: state.passage } : {}),
        ...(state.annotation.trim() ? { annotation: state.annotation.trim() } : {}),
      }),
    })
    const body = await res.json().catch(() => ({}))

    if (res.status === 422) {
      // A rights refusal. The passage, the note and the destination all stay
      // exactly as they are — the recovery is a CHOICE, never a retype.
      setError(typeof body.detail === 'string' ? body.detail : 'That cannot be saved in full.')
      $('linkOnlyBtn').hidden = false
      return
    }
    if (!res.ok) {
      setError(typeof body.detail === 'string' ? body.detail : `Could not save (${res.status})`)
      return
    }

    // Duplicate-ness is the SERVER's answer and is never computed here.
    //
    // ⛔ The KIND comes from what this request SENT, not from `captureType`.
    // captureType describes what the DOCUMENT now holds, so after a passage
    // capture it stays 'web_passage' — and reading it as "what I just did"
    // confirms a link-only save as "Saved passage". Caught by the real-browser
    // audit; the same category error is fixed in capture.js for the in-app door.
    const where = state.destinations.find((d) => d.id === noteId)?.label || 'your Notebook'
    const kind = wantsPassage ? 'passage' : 'link'
    setOk(body.deduped ? `Already saved to ${where}` : `Saved ${kind} to ${where}`)
    $('linkOnlyBtn').hidden = true
  } catch (e) {
    if (e instanceof ReconnectRequired) {
      // §17: not a 401. One action, and the passage survives it.
      $('connectMessage').textContent = 'Reconnect UCT Browser Capture to continue.'
      show('connect')
      return
    }
    setError('Could not reach UCT. Your passage is still here — try again.')
  } finally {
    $('saveBtn').disabled = false
  }
}

async function doConnect() {
  const btn = $('connectBtn')
  btn.disabled = true
  $('connectError').hidden = true
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'CONNECT' })
    if (!reply?.ok) throw new Error(reply?.error || 'Could not connect')
    await start()
  } catch (e) {
    const el = $('connectError')
    el.textContent = e?.message || 'Could not connect'
    el.hidden = false
  } finally {
    btn.disabled = false
  }
}

async function start() {
  const cred = await getCredential()
  if (!cred) { show('connect'); return }
  show('capture')
  renderSource()
  try {
    await loadDestinations()
  } catch (e) {
    if (e instanceof ReconnectRequired) { show('connect'); return }
    setError('Could not load your notes. Try again.')
  }
}

$('connectBtn').addEventListener('click', doConnect)
$('saveBtn').addEventListener('click', () => save())
$('linkOnlyBtn').addEventListener('click', () => save({ linkOnly: true }))
$('disconnect').addEventListener('click', async (e) => {
  e.preventDefault()
  await chrome.runtime.sendMessage({ type: 'DISCONNECT' })
  $('connectMessage').textContent =
    'This browser has forgotten the connection. To revoke it for good, ' +
    'disconnect it in UCT Settings.'
  show('connect')
})

readActiveTab().then(start)
