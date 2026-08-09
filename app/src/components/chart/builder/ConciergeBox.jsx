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

import { useCallback, useId, useState } from 'react'
import { sentenceFor } from '../engine/ast/sentence.js'

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

const S = {
  box: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 12, color: 'var(--text-muted)', letterSpacing: 0.4 },
  input: {
    width: '100%', minHeight: 64, padding: '8px 10px', resize: 'vertical',
    background: 'var(--bg-surface)', color: 'var(--text-bright)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
    fontSize: 13, lineHeight: 1.45,
  },
  row: { display: 'flex', gap: 8, alignItems: 'center' },
  button: {
    minHeight: 'var(--tap-min)', padding: '0 14px',
    background: 'var(--bg-elevated)', color: 'var(--text-bright)',
    border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-md)',
    fontSize: 13, cursor: 'pointer',
  },
  primary: {
    minHeight: 'var(--tap-min)', padding: '0 14px',
    background: 'var(--ut-gold-dim)', color: 'var(--text-heading)',
    border: '1px solid var(--ut-gold)', borderRadius: 'var(--radius-md)',
    fontSize: 13, cursor: 'pointer',
  },
  panel: {
    padding: 10, borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)', background: 'var(--bg-surface)',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  sentence: { fontSize: 14, color: 'var(--text-heading)', lineHeight: 1.5 },
  source: { fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono, monospace)' },
  meta: { fontSize: 11, color: 'var(--text-muted)' },
  refusal: {
    padding: 10, borderRadius: 'var(--radius-md)',
    border: '1px solid var(--loss-border)', background: 'var(--loss-bg)',
    color: 'var(--text-bright)', fontSize: 13, lineHeight: 1.5,
  },
}

// ⭐ WHAT IS BEING ASKED FOR, AND IT TRAVELS. A screen is `<tree> != 0`, so a
// tree that produces a NUMBER is a perfectly good indicator and a wrong answer to
// "find me stocks where…" — the server refuses that at `scan:not-a-condition`,
// but ONLY if it was told which question it is answering. A box that always asked
// for an indicator would be a box whose scan stage can never fire, which is the
// built-tested-green-and-unreachable shape this phase keeps finding.
const KIND_COPY = {
  scan: {
    label: 'Describe the screen in plain English',
    placeholder: 'e.g. trending stocks pulling back to the 20 day average',
  },
  indicator: {
    label: 'Describe the indicator in plain English',
    placeholder: 'e.g. the twenty bar average of the close',
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
                                       disabled = false }) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const fieldId = useId()

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
        body: JSON.stringify({ prompt: text, kind, bars: bars || [] }),
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
            : 'The assistant could not be reached just now.',
        })
        return
      }
      const body = await res.json()
      if (!body || body.ok !== true) {
        setRefusal({ gate: (body && body.gate) || 'unknown',
                     reason: (body && body.reason) || 'That could not be turned into a formula.' })
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
                    sentence: read.text })
    } catch (err) {
      setRefusal({ gate: 'network', reason: 'The assistant could not be reached just now.' })
    } finally {
      setBusy(false)
    }
  }, [prompt, busy, bars, kind, fetchImpl])

  const copy = KIND_COPY[kind] || KIND_COPY.indicator

  return (
    <div style={S.box} data-testid="concierge-box" data-kind={kind}>
      <label style={S.label} htmlFor={fieldId}>{copy.label}</label>
      <textarea
        id={fieldId}
        style={S.input}
        value={prompt}
        disabled={disabled || busy}
        placeholder={copy.placeholder}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div style={S.row}>
        <button
          type="button"
          style={S.button}
          disabled={disabled || busy || !prompt.trim()}
          onClick={submit}
        >
          {busy ? 'Drafting…' : 'Draft a formula'}
        </button>
        {busy ? <span style={S.meta} role="status">working</span> : null}
      </div>

      {refusal ? (
        <div style={S.refusal} role="alert" data-testid="concierge-refusal">
          <div>{refusal.reason}</div>
          <div style={S.meta} data-testid="concierge-gate">{refusal.gate}</div>
        </div>
      ) : null}

      {proposal ? (
        <div style={S.panel} data-testid="concierge-proposal">
          <div style={S.sentence} data-testid="concierge-sentence">{proposal.sentence}</div>
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
