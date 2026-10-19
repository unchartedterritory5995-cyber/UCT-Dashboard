// P3b Task 5: "Preview your example" -- EXACTLY what other members would see of one of the author's notes, shown
// as an example of one of their shared styles, before anything is sent (plan R-P3b-4).
//   * Top: what was replaced, as one sentence of counts by kind (countsSentence).
//   * Middle: the server's REDUCED body, rendered by the library's own read-only renderer (TemplatePreview's
//     DocBody, V8), with every replaced span marked in place: `data-replaced="<kind>"`, a dotted underline, and
//     the kind in words as its accessible description.
//   * Images: one row per image the author may switch on, with their OWN image (their own address: this is their
//     own view), its OCR line, and "Share this image", OFF until they switch it on. An image with OCR warnings,
//     or one nobody could read yet, asks a second question first (R-P3b-5). Each switch re-runs the preview, so
//     the body shows the image in place. The server's image limits are said here, before Submit (P3b-T4-R2).
//   * Bottom: the title (the note's, as the server scrubbed it) and Submit for review / Cancel. P3b-F-R5: a title
//     the author types is previewed too, a moment after they stop typing, and the server's answer -- the title
//     members will see -- is shown under the field. Submit waits for that answer, as it waits for an image switch.
//     P3b-F2-R2: that title preview is TITLE-ONLY (previewExampleTitle): the server scrubs the title and reduces
//     nothing, and it is not charged to the hourly preview limit. A full preview (an image switch) that answers
//     429 says so, puts the switches back as the preview on screen was made, and leaves Submit on for that preview.
// ⛔ Lazy-only: AddExampleNoteDoor.jsx imports this, and that door is loaded on demand from the lazy styles chunk
//    and the lazy gallery.
// ⛔ The body is NEVER sent: publishExample's body is exactly {noteId, styleItemId, imagesOn, title}; the server
//    reads and reduces the note itself. `before` (the author's own words) is in the preview answer and is never
//    put on screen: the marked span shows what members will read, and its description says what kind it was.
// ⛔ DocBody is the eager TemplatePicker's renderer and is NOT edited here (the first-open byte budget, +0 B): the
//    spans are marked on the DOM it rendered, inside a container this file owns and remounts per answer
//    (markReplaced). DocBody is memoised and its input never changes for one mount, so React never touches the
//    text nodes again after they are split.
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import Switch from '../../../../../components/ui/Switch'
import { DocBody } from '../TemplatePreview'
import {
  EXAMPLE_IMAGE_COUNT_SENTENCE, EXAMPLE_IMAGE_EXTENSIONS, EXAMPLE_IMAGE_SIZE_SENTENCE, EXAMPLE_IMAGE_TYPE_SENTENCE,
  EXAMPLE_MAX_IMAGES, previewExample, previewExampleTitle, publishExample,
} from '../../../lib/styleLibrary'
import { libraryError } from './styleErrors'
import styles from './ExampleNote.module.css'

export const PREVIEW_TITLE = 'Preview your example'
export const SHARE_IMAGE_LABEL = 'Share this image'
export const EXAMPLE_SENT_SENTENCE = 'Sent for review. It will show on your style once approved.'
export const OCR_UNREAD_SENTENCE = "We couldn't read this image yet. Check it yourself before switching it on."
export const CONFIRM_SENTENCE = 'This image may show an account detail. Share it anyway?'
// M-8: the sheet offers no "pick another" control, so the sentence names none.
export const NOT_AN_EXAMPLE_SENTENCE = "This note can't be shared as an example."
const PREVIEW_FAILED = "Couldn't show what this example would look like. Nothing was sent."
const SEND_FAILED = "Couldn't send that example. Nothing was sent."
const SEE_SENTENCE = 'Here is exactly what other members will see.'
const MAX_TITLE = 80                     // template_gallery.MAX_TITLE_CHARS (the server shortens a longer one)
/** How long after the last keystroke a typed title is previewed (P3b-F-R5). */
export const TITLE_PREVIEW_DELAY_MS = 400
/** The line under the title field: the SERVER's title for what the author typed, never one this file computes. */
export const shownTitleSentence = (title) => `Members will see the title “${title}”.`

/** Every change kind the reducer reports, in example_sanitize.KINDS's order (ExamplePreviewSheet.test.jsx reads
 *  that tuple and holds this equal): `[one, many, the kind in words]`. `image_off` and `dropped` are what was
 *  LEFT OUT; every other kind was replaced. */
export const CHANGE_KINDS = Object.freeze({
  money: ['amount', 'amounts', 'an amount'],
  pnl_figure: ['profit or loss figure', 'profit or loss figures', 'a profit or loss figure'],
  account: ['account number', 'account numbers', 'an account number'],
  broker: ['broker name', 'broker names', 'a broker name'],
  link: ['link', 'links', 'a link'],
  email: ['email address', 'email addresses', 'an email address'],
  trade_link: ['trade link', 'trade links', 'a trade link'],
  block_reset: ['block', 'blocks', 'a block'],
  fact: ['fact', 'facts', 'a fact'],
  market_data: ['market data line', 'market data lines', 'a market data line'],
  image_off: ['image', 'images', 'an image'],
  dropped: ['item', 'items', 'an item'],
})
const LEFT_OUT = new Set(['image_off', 'dropped'])
const UNKNOWN_KIND = ['change', 'changes', 'a change']
const wordsFor = (kind) => CHANGE_KINDS[kind] || UNKNOWN_KIND

const joinWords = (parts) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)

/** "3 amounts, 1 broker name and 2 blocks were replaced. Here is exactly what other members will see." */
export function countsSentence(counts) {
  const entries = Object.entries(counts || {}).filter(([, n]) => Number(n) > 0)
  const order = Object.keys(CHANGE_KINDS)
  entries.sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))
  const phrase = ([kind, n]) => `${Number(n)} ${Number(n) === 1 ? wordsFor(kind)[0] : wordsFor(kind)[1]}`
  const clause = (list, done) => {
    const verb = list.length === 1 && Number(list[0][1]) === 1 ? 'was' : 'were'
    return `${joinWords(list.map(phrase))} ${verb} ${done}`
  }
  const replaced = entries.filter(([k]) => !LEFT_OUT.has(k))
  const left = entries.filter(([k]) => LEFT_OUT.has(k))
  if (!replaced.length && !left.length) return `Nothing was replaced. ${SEE_SENTENCE}`
  const said = [replaced.length ? clause(replaced, 'replaced') : '', left.length ? clause(left, 'left out') : '']
    .filter(Boolean).join(', and ')
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}. ${SEE_SENTENCE}`
}

/** The OCR line under an image (R-P3b-5). */
export function ocrLine(image) {
  const warnings = Array.isArray(image?.warnings) ? image.warnings : []
  if (image?.ocr === 'ready' && warnings.length) {
    return `We read this image. It may show an account detail: ${joinWords(warnings.map((w) => String(w?.match || '')).filter(Boolean))}.`
  }
  if (image?.ocr === 'ready') return 'We read this image and found nothing to warn you about.'
  if (image?.ocr === 'no_text') return 'We found no text in this image.'
  return OCR_UNREAD_SENTENCE
}

/** True when switching this image on must ask again first. ⛔ An ALLOW-LIST (review M-2): only an image read and
 *  found clean (`ready` with no warnings) or read and found to hold no text (`no_text`) skips the question. Every
 *  other state -- warnings, `processing`, `unavailable`, none, or a state the server adds later -- asks. */
export function needsSecondConfirm(image) {
  const warnings = Array.isArray(image?.warnings) ? image.warnings : []
  if (image?.ocr === 'no_text' && !warnings.length) return false
  if (image?.ocr === 'ready' && !warnings.length) return false
  return true
}

/** The image's stored extension is one an example may show (the server refuses the rest at publish). */
export function shareableType(image) {
  const name = String(image?.name || String(image?.src || '').split('/').pop() || '').toLowerCase()
  return EXAMPLE_IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))
}

// ── marking the replaced spans in place ────────────────────────────────────────────────────────────────

/** Every text node of the reduced body, in document order, with its path of child indices from the root. */
function textNodesOf(doc) {
  const out = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text') { out.push({ path, text: typeof node.text === 'string' ? node.text : '' }); return }
    ;(Array.isArray(node.content) ? node.content : []).forEach((c, i) => walk(c, [...path, i]))
  }
  walk(doc, [])
  return out
}
const startsWith = (path, prefix) => prefix.every((v, i) => path[i] === v)

/** Where each change sits: for every text node of the body, the [start, end, kind] ranges of the replacement
 *  text the server put there. A change's `path` addresses the REDUCED body (ruling P3b-T2-R5): the text node
 *  itself, or a node the replacement text sits inside (a fact made into a paragraph). The span is the first
 *  occurrence of its `after` text under that path not already taken. A change with no text (a dropped node, a
 *  block reset to its empty params) marks nothing; the counts sentence still says it. */
export function replacedRanges(doc, changes) {
  const texts = textNodesOf(doc)
  const ranges = texts.map(() => [])
  for (const change of Array.isArray(changes) ? changes : []) {
    const after = typeof change?.after === 'string' ? change.after : ''
    const path = Array.isArray(change?.path) ? change.path : null
    if (!after || !path) continue
    let placed = false
    for (let t = 0; t < texts.length && !placed; t += 1) {
      if (!startsWith(texts[t].path, path)) continue
      let from = 0
      while (!placed) {
        const at = texts[t].text.indexOf(after, from)
        if (at < 0) break
        const end = at + after.length
        if (!ranges[t].some(([s, e]) => at < e && end > s)) {
          ranges[t].push([at, end, String(change.kind || '')])
          placed = true
        }
        from = at + 1
      }
    }
  }
  return texts.map((t, i) => ({ text: t.text, ranges: ranges[i].sort((a, b) => a[0] - b[0]) }))
}

/** Wrap each replaced range of the DOM `root` holds (DocBody's output) in a marked span. The body's text nodes
 *  are matched to the DOM's in document order by their text, so a node the renderer does not draw is skipped. */
function markReplaced(root, doc, changes, describedBy, className, hiddenClass, spoken) {
  if (!root || root.dataset.marked === '1') return
  root.dataset.marked = '1'
  const plan = replacedRanges(doc, changes)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const dom = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) dom.push(n)
  let cursor = 0
  for (const { text, ranges } of plan) {
    if (!text) continue
    let hit = -1
    for (let d = cursor; d < dom.length; d += 1) {
      if (dom[d].nodeValue === text) { hit = d; break }
    }
    if (hit < 0) continue
    cursor = hit + 1
    const node = dom[hit]
    for (let r = ranges.length - 1; r >= 0; r -= 1) {          // from the end, so earlier offsets stay true
      const [start, end, kind] = ranges[r]
      const middle = node.splitText(start)
      middle.splitText(end - start)
      const span = document.createElement('span')
      span.setAttribute('data-replaced', kind)
      span.className = className
      const desc = describedBy(kind)
      if (desc) span.setAttribute('aria-describedby', desc)
      middle.parentNode.replaceChild(span, middle)
      span.appendChild(middle)
      // review M-4: a description on a plain span is seldom read in browse mode, so the kind is also SAID, as
      // visually hidden text inside the span.
      const note = document.createElement('span')
      note.className = hiddenClass
      note.setAttribute('data-replaced-note', '')
      note.textContent = ` (replaced: ${spoken(kind)})`
      span.appendChild(note)
    }
  }
}

const StaticDocBody = memo(DocBody)

function ReplacedBody({ body, changes, describedBy }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    markReplaced(ref.current, body, changes, describedBy, styles.replaced, styles.srOnly, (k) => wordsFor(k)[2])
  }, [body, changes, describedBy])
  return <div ref={ref} className={styles.body}><StaticDocBody body={body} /></div>
}

/** A refusal the server explains (and, for a publish, its 500 sentence: "Couldn't copy an image..."), the 404
 *  of a note that may not be an example, or our own sentence. */
function exampleError(err, fallback) {
  if (err?.status === 404) return NOT_AN_EXAMPLE_SENTENCE
  const message = String(err?.message || '').trim()
  if (err?.status === 500 && message && !/^request failed \(\d+\)$/.test(message)) return message
  return libraryError(err, fallback)
}

/**
 * @param note        `{id, title}`: the author's note (from the picker)
 * @param styleItemId the author's shared style item the example belongs to
 * @param onSent      `(sentence) => void` after the server took it
 * @param onClose     Cancel, Escape, or the Sheet's own close
 */
export default function ExamplePreviewSheet({ note, styleItemId, onSent, onClose }) {
  const uid = useId()
  const [preview, setPreview] = useState(null)        // the last answer applied
  const [revision, setRevision] = useState(0)         // a fresh render (and marking) per answer
  const [loadError, setLoadError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [imagesOn, setImagesOn] = useState([])        // the ORIGINAL addresses of the images switched on
  const [appliedOn, setAppliedOn] = useState(null)     // the imagesOn the preview ON SCREEN was made from
  const [asking, setAsking] = useState(null)          // the src a second question is open for
  const [title, setTitle] = useState(null)            // null until the first answer prefills it
  const [appliedTitle, setAppliedTitle] = useState(null)   // the title text the preview ON SCREEN was made from
  const [shownTitle, setShownTitle] = useState(null)       // the server's title for it: what members will see
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)
  const [rateError, setRateError] = useState(null)     // a full re-run the hourly limit refused (P3b-F2-R2)
  const [titleError, setTitleError] = useState(null)   // a title-only preview that failed
  const seq = useRef(0)
  const titleSeq = useRef(0)
  const titleNow = useRef(title)
  titleNow.current = title
  const appliedOnNow = useRef(appliedOn)
  appliedOnNow.current = appliedOn
  const hasPreview = useRef(false)

  // The FULL preview: the reduced body, counts and images. `typed`: the title text to preview with it, or undefined
  // for the note's own (the first run, before the field holds one).
  const run = useCallback(async (on, typed) => {
    const mine = ++seq.current
    setLoading(true)
    setRateError(null)
    try {
      const out = await previewExample({ noteId: note?.id, imagesOn: on, title: typed })
      if (mine !== seq.current) return
      const prefill = String(out?.title || note?.title || '').slice(0, MAX_TITLE)
      hasPreview.current = true
      setPreview(out)
      setAppliedOn(on)
      setRevision((r) => r + 1)
      setLoadError(null)
      setTitle((t) => (t == null ? prefill : t))
      // the title on screen moves only when this answer is for the title the field still holds
      if (typeof typed !== 'string' || typed === titleNow.current) {
        setAppliedTitle(typeof typed === 'string' ? typed : prefill)
        setShownTitle(String(out?.title || ''))
      }
    } catch (err) {
      if (mine !== seq.current) return
      if (err?.status === 429 && hasPreview.current) {
        // P3b-F2-R2: the preview on screen still stands, so the switches go back to what it was made from and
        // Submit sends that preview; the limit's own sentence says why the switch did not take.
        setRateError(exampleError(err, PREVIEW_FAILED))
        if (Array.isArray(appliedOnNow.current)) setImagesOn(appliedOnNow.current)
      } else {
        setLoadError(exampleError(err, PREVIEW_FAILED))
      }
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [note?.id, note?.title])

  // P3b-F2-R2: a typed title alone. Nothing of the note is reduced and the hourly limit is not spent.
  const runTitle = useCallback(async (typed) => {
    const mine = ++titleSeq.current
    try {
      const out = await previewExampleTitle({ noteId: note?.id, title: typed })
      if (mine !== titleSeq.current) return
      setTitleError(null)
      setAppliedTitle(typed)
      setShownTitle(String(out?.title || ''))
    } catch (err) {
      if (mine !== titleSeq.current) return
      setTitleError(exampleError(err, PREVIEW_FAILED))
    }
  }, [note?.id])

  useEffect(() => { run([]) }, [run])

  // P3b-F-R5: a typed title is previewed once the author pauses.
  useEffect(() => {
    if (title == null || appliedTitle == null || title === appliedTitle) return undefined
    const timer = setTimeout(() => runTitle(title), TITLE_PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [title, appliedTitle, runTitle])

  const describedBy = useCallback((kind) => `${uid}-kind-${CHANGE_KINDS[kind] ? kind : 'other'}`, [uid])

  const turn = (src, on) => {
    const next = on ? [...imagesOn.filter((s) => s !== src), src] : imagesOn.filter((s) => s !== src)
    setImagesOn(next)
    setAsking(null)
    run(next, title == null ? undefined : title)
  }
  const flip = (image) => {
    const on = imagesOn.includes(image.src)
    if (on) { turn(image.src, false); return }
    if (needsSecondConfirm(image)) { setAsking(image.src); return }
    turn(image.src, true)
  }

  // ⛔ P3b-T5-R9 (review I-3): what is sent is what is ON SCREEN. Submit waits while a re-run is in flight, stays
  // off after one failed, and posts the `imagesOn` the applied preview was made from -- never a switch state the
  // body and the counts sentence were not built from.
  const current = Boolean(preview) && !loading && !loadError && Array.isArray(appliedOn)
    && appliedOn.length === imagesOn.length && appliedOn.every((s) => imagesOn.includes(s))
    && appliedTitle === title                         // P3b-F-R5: and the title on screen is the one typed
  const submit = async () => {
    const t = String(title || '').trim()
    if (sending || !current || !t) return
    setSending(true)
    setSendError(null)
    try {
      await publishExample({ noteId: note?.id, styleItemId, imagesOn: appliedOn, title: t })
      onSent?.(EXAMPLE_SENT_SENTENCE)
    } catch (err) {
      setSendError(exampleError(err, SEND_FAILED))
      setSending(false)
    }
  }

  const images = Array.isArray(preview?.images) ? preview.images : []
  const onCount = imagesOn.length
  const kindsShown = [...new Set((preview?.changes || []).map((c) => (CHANGE_KINDS[c?.kind] ? c.kind : 'other')))]

  return (
    <Sheet open onClose={onClose} title={PREVIEW_TITLE} labelledByTitle variant="auto" maxWidth={640}
      footer={(
        <div className={styles.footer}>
          <div className={styles.field}>
            <label htmlFor={`${uid}-title`}>Title in the library</label>
            <input id={`${uid}-title`} type="text" className={styles.titleInput} value={title ?? ''} maxLength={MAX_TITLE}
              required onChange={(e) => setTitle(e.target.value)}
              aria-describedby={shownTitle ? `${uid}-shown-title` : undefined} />
            {shownTitle && (
              <p className={styles.hint} id={`${uid}-shown-title`} data-example-shown-title="">
                {shownTitleSentence(shownTitle)}
              </p>
            )}
          </div>
          {titleError && <p className={styles.error} role="alert" data-example-title-error="">{titleError}</p>}
          {rateError && <p className={styles.error} role="alert" data-example-rate-error="">{rateError}</p>}
          {sendError && <p className={styles.error} role="alert">{sendError}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={submit}
              disabled={sending || !current || !String(title || '').trim()}>
              {sending ? 'Sending…' : 'Submit for review'}
            </button>
          </div>
        </div>
      )}>
      <div className={styles.sheet}>
        {kindsShown.map((k) => (
          <span key={k} id={`${uid}-kind-${k}`} hidden>{k === 'other' ? UNKNOWN_KIND[2] : CHANGE_KINDS[k][2]}</span>
        ))}
        {loadError && <p className={styles.error} role="alert">{loadError}</p>}
        {!preview && !loadError && <p className={styles.hint} role="status">Making your preview…</p>}
        {preview && (
          <>
            <p className={styles.summary} role="status">{countsSentence(preview.counts)}</p>
            <section className={styles.bodyFrame} aria-label="What other members will see">
              <ReplacedBody key={revision} body={preview.bodyJson} changes={preview.changes} describedBy={describedBy} />
            </section>
            {images.length > 0 && (
              <section className={styles.images} aria-labelledby={`${uid}-images`}>
                <h4 className={styles.subhead} id={`${uid}-images`}>Images</h4>
                <div className={styles.limits} data-example-limits="">
                  <p className={styles.hint}>{EXAMPLE_IMAGE_COUNT_SENTENCE}</p>
                  <p className={styles.hint}>{EXAMPLE_IMAGE_TYPE_SENTENCE}</p>
                  <p className={styles.hint}>{EXAMPLE_IMAGE_SIZE_SENTENCE}</p>
                </div>
                <ul className={styles.imageList}>
                  {images.map((image, i) => {
                    const on = imagesOn.includes(image.src)
                    const typeOk = shareableType(image)
                    const full = !on && onCount >= EXAMPLE_MAX_IMAGES
                    const reason = !typeOk ? EXAMPLE_IMAGE_TYPE_SENTENCE : full ? EXAMPLE_IMAGE_COUNT_SENTENCE : null
                    const rid = `${uid}-img-${i}`
                    return (
                      <li key={image.src} className={styles.imageRow} data-example-image={image.src}>
                        <img className={styles.thumb} src={image.src} alt={`Your image ${image.name || ''}`.trim()} />
                        <div className={styles.imageText}>
                          <span className={styles.imageName} id={`${rid}-name`}>{image.name}</span>
                          <span className={styles.hint} id={`${rid}-ocr`}>{ocrLine(image)}</span>
                          {reason && <span className={styles.hint} id={`${rid}-why`}>{reason}</span>}
                        </div>
                        {/* P3b-T9-G1: the shared Switch (formControls census). It renders only its knob, so the name
                            is its aria-label and the visible words sit beside it in the label, which also passes a
                            click on the words to the switch. */}
                        <label className={styles.switch}>
                          <Switch checked={on} aria-label={SHARE_IMAGE_LABEL} className={styles.track} knobClassName={styles.knob}
                            aria-describedby={[`${rid}-name`, `${rid}-ocr`, reason ? `${rid}-why` : null].filter(Boolean).join(' ')}
                            disabled={!on && Boolean(reason)} onClick={() => flip(image)} />
                          <span aria-hidden="true">{SHARE_IMAGE_LABEL}</span>
                        </label>
                        {asking === image.src && (
                          <div className={styles.confirm} role="group" aria-labelledby={`${rid}-ask`}>
                            <p className={styles.ask} id={`${rid}-ask`}>{CONFIRM_SENTENCE}</p>
                            <div className={styles.actions}>
                              <button type="button" className={styles.btn} onClick={() => setAsking(null)}>Cancel</button>
                              <button type="button" className={`${styles.btn} ${styles.primary}`}
                                onClick={() => turn(image.src, true)}>Share it</button>
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </>
        )}
        {/* review M-9: always mounted, so the re-run is announced when it starts */}
        <p className={styles.hint} role="status">{preview && loading ? 'Updating the preview…' : ''}</p>
      </div>
    </Sheet>
  )
}
