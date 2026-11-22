// ─── THE AI DOOR, AND THE SENTENCE IS STILL THE TREE'S ──────────────────────
//
// ⭐⭐ THE ONE RULE: the read-back this box shows is `sentenceFor(proposal.ast)`,
// computed HERE, from the tree, by the module that owns the read-back. The
// server's answer carries a `sentence` field and THIS COMPONENT DELIBERATELY
// IGNORES IT. A model-written summary of a model-written formula is two guesses
// agreeing; a server-written summary of a model-written formula is two hops from
// the tree, and the user still has no way to tell a correct pair from a wrong one.
// `ConciergeBox.test.jsx` plants a DIFFERENT `sentence` in the response and
// asserts this box shows the tree's — which is the only way to test the claim,
// because a box that echoed a correct `sentence` would look identical.
//
// ⛔ A REFUSAL SHOWS NO FORMULA. `{ok: false, reason, gate}` renders the reason
// and nothing else: no tree, no source, no "here's what it tried". A formula
// beside a refusal is a formula somebody uses.
//
// ⛔ AND THE BOX NEVER SAVES. Accepting a proposal calls `onAccept` and the
// BUILDER does the writing, through the same store door a typed formula goes
// through. A concierge that wrote definitions would be a second write path with a
// second set of guards to keep in step.
//
// ⚠️ ERROR ISOLATION, not a blank screen. `sentenceFor` THROWS for a tree it has
// no English for (`SentenceRefusal`), and spec §6's instance-state inventory has
// ten states, none of which is "the page died". A throw here becomes the same
// refusal line every other failure uses.
//
// ⚠️ INLINE STYLES, and that is a scope decision rather than a preference. This
// task ships two files into `builder/`; the sheet that hosts this box is another
// task's file and owns the surface's CSS. The tokens are read from `tokens.css`
// through `var(--...)` so the box follows the theme it is dropped into.
//
// ⭐⭐ AND PARTIAL UNDERSTANDING IS SHOWN, NOT SWALLOWED. The server now answers a
// request it could only half read: the clauses it dropped come back in
// `not_understood`, and columns the table deliberately does not carry come back
// in `unavailable`. ⛔ BOTH ARE RENDERED BESIDE THE PROPOSAL, ABOVE THE READ-BACK,
// because the hazard is precise: a member who typed "cheap stocks with pe_ttm
// under 15" and is shown a correct read-back of a P/E screen will read it as the
// whole of what they asked for. The read-back describes the maths honestly; only
// this panel can say what is MISSING from it.
//
// ⛔ AND THEY ARE TWO PANELS, NOT ONE. "I could not read these words" and "this
// table cannot screen on that at all" have different remedies — reword, versus
// use the classic screener — and collapsing them would tell a member to keep
// rewording a sentence that can never work.
//
// ⚠️ THE TEXT IN BOTH IS DATA, NOT MODEL PROSE. A refusal reason is
// `conceptVocabulary.json`'s reviewed sentence and an unavailable reason is
// `closedTable.json`'s own note. Neither is the read-back and neither is written
// by the model, so the rule at the top of this file is untouched.

import { withoutGuardIds } from '../engine/ast/guardIdText'
import { useCallback, useEffect, useId, useState } from 'react'
import { sentenceFor } from '../engine/ast/sentence.js'
import { truncateBarsForPropose } from './proposeBars.js'

const ENDPOINT = '/api/user-definitions/propose'

/** The read-back, DERIVED. Returns `{text}` or `{error}` — never a throw, and
 *  never a plausible placeholder: a read-back that quietly degrades is a
 *  read-back the user cannot rely on. */
export function readBackFor(ast, inputs) {
  try {
    return { text: sentenceFor(ast, inputs) }
  } catch (err) {
    return { error: String((err && err.message) || err) }
  }
}

// ⭐ UCT Signature (Direction A, owner 2026-11-16): a sentence-case label over an input
// well, soft buttons (the primary one step brighter, never gold); gold only on the ✦.
const S = {
  box: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11.5, fontWeight: 600, color: '#c9c6be' },
  well: {
    display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 12px 10px',
    background: '#0f1012', border: '1px solid #26282c', borderRadius: 9,
  },
  input: {
    width: '100%', minHeight: 44, padding: 0, resize: 'none',
    background: 'transparent', color: '#ededed', border: 0, outline: 'none',
    font: '500 13.5px/1.45 var(--font-sans, inherit)',
  },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  wellRow: { display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  hint: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#93939a' },
  spark: { color: 'var(--ut-gold, #dcbb5e)' },
  button: {
    minHeight: 28, padding: '0 12px',
    background: 'rgba(248,247,243,.06)', color: '#ededed',
    border: 0, borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  },
  primary: {
    minHeight: 28, padding: '0 12px',
    background: 'rgba(248,247,243,.08)', color: '#f8f7f3',
    border: 0, borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  },
  panel: {
    padding: 12, borderRadius: 9, background: '#1a1b1f',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  sentence: { fontSize: 13, color: '#f8f7f3', lineHeight: 1.5 },
  source: { fontSize: 12, color: '#c9c6be', fontFamily: 'var(--font-mono, monospace)' },
  meta: { fontSize: 11.5, color: '#93939a' },
  refusal: {
    padding: 10, borderRadius: 9,
    border: '1px solid var(--loss-border)', background: 'var(--loss-bg)',
    color: '#ededed', fontSize: 12.5, lineHeight: 1.5,
  },
  gap: {
    padding: 10, borderRadius: 9, background: '#1a1b1f',
    color: '#ededed', fontSize: 12.5, lineHeight: 1.5,
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  gapHead: { fontSize: 11.5, fontWeight: 600, color: '#c9c6be' },
  quote: { color: '#f8f7f3' },
}

/** ⭐⭐ A DISABLED BUTTON HAS TO LOOK DISABLED — AND AN INLINE STYLE CANNOT SAY SO.
 *
 *  ⚰️ MEASURED IN PRODUCTION 2026-08-11. "Draft a formula" is correctly disabled
 *  while the description box is empty (`!prompt.trim()`), but every button on this
 *  surface is styled with an inline `style={…}` object — and an inline style has
 *  no `:disabled` selector, so it rendered at full strength WITH `cursor: pointer`,
 *  actively inviting the click. I clicked it on an empty box and nothing at all
 *  happened: no draft, no error, no hint, no visible reason. A control that looks
 *  live and does nothing is indistinguishable from a broken one, and this is the
 *  first button a member meets in the builder.
 *
 *  ⛔ HAND IT THE SAME EXPRESSION THAT DISABLES THE BUTTON, never a second copy of
 *  the rule — one value drives both props, so the look cannot drift from the gate.
 */
const dimmed = (base, isDisabled) => (isDisabled
  ? { ...base, opacity: 0.45, cursor: 'not-allowed' }
  : base)

/** The clauses the server dropped, and the columns it cannot screen on. Rendered
 *  as its own block so it can sit above a proposal AND above a refusal — a member
 *  needs it in both places, and it is the only thing on the surface that can say
 *  what is MISSING from an otherwise correct read-back. */
function Gaps({ notUnderstood, unavailable }) {
  const dropped = notUnderstood || []
  const absent = unavailable || []
  if (!dropped.length && !absent.length) return null
  return (
    <>
      {dropped.length ? (
        <div style={S.gap} data-testid="concierge-not-understood">
          <div style={S.gapHead}>
            {dropped.length === 1 ? 'One part of that was left out'
                                  : `${dropped.length} parts of that were left out`}
          </div>
          {dropped.map((item, i) => (
            <div key={`nu-${i}`} data-testid="concierge-not-understood-item">
              <span style={S.quote}>“{item.clause || item.phrase}”</span>
              {' — '}{withoutGuardIds(item.reason)}
            </div>
          ))}
        </div>
      ) : null}
      {absent.length ? (
        <div style={S.gap} data-testid="concierge-unavailable">
          <div style={S.gapHead}>This screen cannot read that</div>
          {absent.map((item, i) => (
            <div key={`un-${i}`} data-testid="concierge-unavailable-item">
              <span style={S.quote}>“{item.phrase}”</span>
              {' — '}{withoutGuardIds(item.reason)}
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

// ⭐ WHAT IS BEING ASKED FOR, AND IT TRAVELS. A screen is `<tree> != 0`, so a
// tree that produces a NUMBER is a perfectly good indicator and a wrong answer to
// "find me stocks where…" — the server refuses that at `scan:not-a-condition`,
// but ONLY if it was told which question it is answering. A box that always asked
// for an indicator would be a box whose scan stage can never fire, which is the
// built-tested-green-and-unreachable shape this phase keeps finding.
// ⭐ ONE LABEL, BOTH KINDS (Direction A): the member is describing their indicator either
// way; only the example differs, and the KIND still travels on the request.
const KIND_COPY = {
  scan: {
    label: 'Describe it',
    placeholder: 'e.g. trending stocks pulling back to the 20 day average',
  },
  indicator: {
    label: 'Describe it',
    placeholder: 'e.g. RSI under 30 while price is above its 200-day average',
  },
}

/**
 * @param {object}   props
 * @param {Array}    [props.bars]      the bars the chart is holding; the compute
 *                                     stage runs on the window the user sees
 * @param {string}   [props.kind]      'indicator' (a column) or 'scan' (a
 *                                     condition). Sent on the request; the server
 *                                     owns what it means.
 * @param {Function} [props.onAccept]  called with `{ast, source, repaint, sentence}`
 *                                     — `sentence` is THIS box's, from the tree
 * @param {Function} [props.fetchImpl] injection point for tests ONLY; production
 *                                     uses the global `fetch`
 */
export default function ConciergeBox({ bars, kind = 'indicator', onAccept, fetchImpl,
                                       disabled = false, replacedAt = 0, clearKey = null, prefill = null }) {
  const [prompt, setPrompt] = useState(() => (prefill && typeof prefill.text === 'string' ? prefill.text : ''))
  // ⭐ UCT SIGNATURE R2 — `prefill` ({text}, a fresh object per opening) is PUT in the box, never sent.
  useEffect(() => { if (prefill && typeof prefill.text === 'string') setPrompt(prefill.text) }, [prefill])
  // The `replacedAt` value the description was last written against. When the host
  // bumps `replacedAt` (another lane wrote the formula box) this no longer matches,
  // and the description is stale until the member touches it again.
  const [seenReplacedAt, setSeenReplacedAt] = useState(replacedAt)
  const staleFor = replacedAt !== seenReplacedAt
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const fieldId = useId()
  // ⭐ A failed call does not follow the member around: when the host's view changes
  // (`clearKey`), the last refusal goes; a new attempt clears it too (`submit`).
  useEffect(() => { setRefusal(null) }, [clearKey])

  const submit = useCallback(async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setProposal(null)
    setRefusal(null)
    const doFetch = fetchImpl || ((...args) => fetch(...args))
    try {
      const res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, kind, bars: truncateBarsForPropose(bars) }),
      })
      // ⚠️ `res.ok` IS CHECKED BEFORE `res.json()`. A 402 on this paid route
      // answers JSON too, and treating every 2xx-or-not the same is how a
      // paywalled surface renders "no answer" instead of "you need a plan".
      if (!res || !res.ok) {
        const status = res ? res.status : 0
        setRefusal({
          gate: `http:${status}`,
          reason: status === 402
            ? 'Custom indicators require a paid plan.'
            : "The UCT Agent couldn't be reached just now.",
        })
        return
      }
      const body = await res.json()
      if (!body || body.ok !== true) {
        // ⭐ A REFUSAL CARRIES THE GAPS TOO. "find me strong cheap stocks" is
        // refused as a whole, and naming only the first word it choked on sends
        // the member back for a second attempt to discover the second one.
        setRefusal({ gate: (body && body.gate) || 'unknown',
                     reason: (body && body.reason) || 'That could not be turned into a formula.',
                     notUnderstood: (body && body.not_understood) || [],
                     unavailable: (body && body.unavailable) || [] })
        return
      }
      // ⛔ THE READ-BACK IS COMPUTED HERE, FROM `body.ast`. `body.sentence` is
      // never read — see the header.
      const read = readBackFor(body.ast, body.inputs)
      if (read.error) {
        setRefusal({ gate: 'sentence', reason: read.error })
        return
      }
      setProposal({ ast: body.ast, source: body.source, repaint: body.repaint,
                    sentence: read.text,
                    notUnderstood: body.not_understood || [],
                    unavailable: body.unavailable || [] })
    } catch (err) {
      setRefusal({ gate: 'network', reason: "The UCT Agent couldn't be reached just now." })
    } finally {
      setBusy(false)
    }
  }, [prompt, busy, bars, kind, fetchImpl])

  const copy = KIND_COPY[kind] || KIND_COPY.indicator

  return (
    <div style={S.box} data-testid="concierge-box" data-kind={kind}>
      <label style={S.label} htmlFor={fieldId}>{copy.label}</label>
      <div style={S.well}>
      <textarea
        id={fieldId}
        style={S.input}
        rows={2}
        value={prompt}
        disabled={disabled || busy}
        placeholder={copy.placeholder}
        onChange={(e) => { setPrompt(e.target.value); setSeenReplacedAt(replacedAt) }}
      />
      <div style={S.wellRow}>
        <span style={S.hint}><span style={S.spark} aria-hidden="true">✦</span>The UCT Agent writes it — you check the plain-English read-back</span>
        <span style={S.row}>
        {/* ⛔ ONE EXPRESSION, BOTH PROPS. `draftBlocked` decides whether the button
            works AND how it looks, so the two can never disagree — the shape that
            let a fully-live-looking button do nothing at all. */}
        {(() => {
          const draftBlocked = disabled || busy || !prompt.trim()
          return (
            <button
              type="button"
              style={dimmed(S.primary, draftBlocked)}
              disabled={draftBlocked}
              onClick={submit}
            >
              {busy ? 'Writing…' : 'Write it'}
            </button>
          )
        })()}
        {busy ? <span style={S.meta} role="status">working</span> : null}
        {/* Say what it is waiting for. A dimmed button explains that it is off; it
            does not explain WHY, and the box it wants filled is directly above. */}
        {!busy && !disabled && !prompt.trim() ? (
          <span style={S.meta}>Describe it first</span>
        ) : null}
        {/* ⭐⭐ THE DESCRIPTION IS STALE, AND SAYING SO BEATS DELETING IT.
            ⚰️ Measured 2026-08-11: I typed a description, browsed the starter
            library, opened **Classic Flag/Pullback**, and my old sentence was still
            sitting here — now describing something the member is no longer
            building, above a button that would overwrite the starter they had just
            loaded.
            ⛔ NOT CLEARED. Silently binning typed text is the same class of loss as
            the Escape bug, and the member may still want it. Drafting is an
            explicit click; all this has to do is stop the box from lying. */}
        {!busy && staleFor && prompt.trim() ? (
          <span style={S.meta} data-testid="concierge-stale">
            describes an earlier formula
          </span>
        ) : null}
        </span>
      </div>
      </div>

      {refusal ? (
        <>
          <div style={S.refusal} role="alert" data-testid="concierge-refusal">
            <div>{withoutGuardIds(refusal.reason)}</div>
            <div style={S.meta} data-testid="concierge-gate">{refusal.gate}</div>
          </div>
          <Gaps notUnderstood={refusal.notUnderstood}
                unavailable={refusal.unavailable} />
        </>
      ) : null}

      {proposal ? (
        <div style={S.panel} data-testid="concierge-proposal">
          {/* ⛔ ABOVE THE READ-BACK, ON PURPOSE. A member reading a correct
              sentence about a P/E screen will take it for the whole of what they
              asked for unless the missing half is in front of them first. */}
          <Gaps notUnderstood={proposal.notUnderstood}
                unavailable={proposal.unavailable} />
          <div style={S.sentence} data-testid="concierge-sentence">{withoutGuardIds(proposal.sentence)}</div>
          <div style={S.source} data-testid="concierge-source">{proposal.source}</div>
          <div style={S.meta} data-testid="concierge-repaint">{proposal.repaint}</div>
          <div style={S.row}>
            <button
              type="button"
              style={S.primary}
              onClick={() => { if (onAccept) onAccept(proposal) }}
            >
              Use this formula
            </button>
            <button type="button" style={S.button} onClick={() => setProposal(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
