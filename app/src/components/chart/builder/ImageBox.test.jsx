import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

import ImageBox from './ImageBox.jsx'
import { sentenceFor } from '../engine/ast/sentence.js'
import { TABLE } from '../engine/ast/parse.js'

// ─── THE CLAIMS THIS FILE EXISTS TO PROVE ───────────────────────────────────
//
// ⭐⭐ 1. THE READ-BACK A MEMBER CONFIRMS IS `sentenceFor(candidate.ast)`,
// computed in the browser from the tree. The server's answer carries a
// `sentence` per candidate and this box must not show it. That is untestable by
// comparing against a correct answer — a box echoing a correct server sentence
// would look identical — so every case plants a DIFFERENT, plausible server
// sentence and asserts the tree's is what renders.
//
// ⭐⭐ 2. A REFUSED CANDIDATE NEVER RENDERS A FORMULA. The server strips them
// already; the rail below sends a refused row WITH a tree and a source string
// attached anyway and requires that neither reaches the screen. A gate that only
// holds while the other side behaves is not a gate.
//
// ⭐ 3. THE HONESTY COPY IS ON SCREEN BEFORE ANY ANSWER IS, not revealed
// afterwards when the first formula has already been read as the answer.

// Derived, never hand-listed — the same discipline as `ConciergeBox.test.jsx`.
const SERIES = Object.keys(TABLE.series).sort()[0]
const WINDOWED = Object.keys(TABLE.functions).sort()
  .filter((f) => JSON.stringify(TABLE.functions[f].args) === JSON.stringify(['series', 'int']))

const tree = (fn, win) => ({
  type: 'call',
  name: fn,
  args: [{ type: 'series', name: SERIES }, { type: 'num', value: win }],
})

const TREE_A = tree(WINDOWED[0], 20)
const TREE_B = tree(WINDOWED[1], 50)

/** A per-candidate `sentence` that is plausible, fluent, and about a different
 *  formula. If the box ever renders one of these, the rail has rotted. */
const LIE_A = 'a smoothed momentum oscillator of the last nine bars'
const LIE_B = 'the average true range over two hundred sessions'

function jsonResponse(body, { status = 200, ok = true } = {}) {
  return { ok, status, json: async () => body }
}

function candidate(t, { rank = 1, label = 'RSI(14)', confidence = 88,
                        saw = 'bounded 0-100 with guides at 30 and 70',
                        sentence = LIE_A } = {}) {
  return {
    rank,
    label,
    confidence,
    saw,
    ast: t,
    source: `${t.name}(${SERIES}, ${t.args[1].value})`,
    sentence,                                   // ⛔ the lie; never rendered
    repaint: 'non-repainting',
  }
}

function okBody(overrides = {}) {
  return {
    ok: true,
    saw: 'a separate pane under the price, scale 0 to 100',
    candidates: [candidate(TREE_A)],
    refused: [],
    ...overrides,
  }
}

const PICTURE = () => new File([new Uint8Array([1, 2, 3])], 'chart.png',
                               { type: 'image/png' })

async function read(fetchImpl, props = {}) {
  render(<ImageBox fetchImpl={fetchImpl} {...props} />)
  fireEvent.change(screen.getByTestId('image-file'),
                   { target: { files: [PICTURE()] } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /read the picture/i }))
  })
}

afterEach(() => cleanup())

describe('the fixtures are real', () => {
  it('the manifest still declares two windowed functions to build trees from', () => {
    // ⛔ Without this, a manifest change would make every case below assert on
    // `undefined` and pass by describing nothing.
    expect(WINDOWED.length).toBeGreaterThanOrEqual(2)
    expect(sentenceFor(TREE_A)).toBeTruthy()
    expect(sentenceFor(TREE_B)).toBeTruthy()
    expect(sentenceFor(TREE_A)).not.toBe(sentenceFor(TREE_B))
  })
})

describe('ImageBox', () => {
  it('⭐ renders the READ-BACK FROM THE TREE and never the server\'s sentence', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()))
    await read(fetchImpl)

    const shown = await screen.findByTestId('image-readback')
    expect(shown).toHaveTextContent(sentenceFor(TREE_A))
    expect(shown.textContent).not.toBe(LIE_A)
    expect(screen.queryByText(LIE_A)).toBeNull()
  })

  it('says these are GUESSES before it has shown anything', () => {
    render(<ImageBox fetchImpl={vi.fn()} />)
    const copy = screen.getByTestId('image-disclaimer')
    expect(copy.textContent).toMatch(/guess/i)
    expect(screen.queryByTestId('image-answer')).toBeNull()
  })

  it('shows what the model SAW, per candidate and overall', async () => {
    await read(vi.fn(async () => jsonResponse(okBody())))
    expect(await screen.findByTestId('image-saw'))
      .toHaveTextContent('a separate pane under the price')
    expect(screen.getByTestId('image-candidate-saw'))
      .toHaveTextContent('bounded 0-100 with guides at 30 and 70')
    expect(screen.getByTestId('image-confidence')).toHaveTextContent('88')
  })

  it('renders EVERY candidate, in the order the server ranked them', async () => {
    const body = okBody({
      candidates: [
        candidate(TREE_A, { rank: 1, label: 'first', confidence: 88, sentence: LIE_A }),
        candidate(TREE_B, { rank: 2, label: 'second', confidence: 40, sentence: LIE_B }),
      ],
    })
    await read(vi.fn(async () => jsonResponse(body)))

    const rows = await screen.findAllByTestId('image-candidate')
    expect(rows).toHaveLength(2)
    const backs = screen.getAllByTestId('image-readback').map((n) => n.textContent)
    expect(backs).toEqual([sentenceFor(TREE_A), sentenceFor(TREE_B)])
    expect(screen.queryByText(LIE_B)).toBeNull()
  })

  it('⛔ a REFUSED candidate shows its gate and NO FORMULA — even if the server sends one', async () => {
    const smuggled = 'zzLuxAlgoSecretSauce(close, 14)'
    const body = okBody({
      refused: [{
        label: 'LuxAlgo Trend', saw: 'a gold band', gate: 'schema:name',
        reason: 'the assistant used a name that is not in the formula vocabulary',
        // ⛔ THE RAIL: a future server that leaked these must not render them.
        source: smuggled,
        ast: { type: 'call', name: 'zzLuxAlgoSecretSauce', args: [] },
      }],
    })
    await read(vi.fn(async () => jsonResponse(body)))

    const item = await screen.findByTestId('image-rejected-item')
    expect(item).toHaveTextContent('LuxAlgo Trend')
    expect(screen.getByTestId('image-rejected-gate')).toHaveTextContent('schema:name')
    expect(screen.queryByText(smuggled)).toBeNull()
    expect(document.body.textContent).not.toContain(smuggled)
  })

  it('a server refusal renders the reason, the gate and what it saw — and no candidates', async () => {
    const body = {
      ok: false, gate: 'vision:no-candidate',
      reason: 'nothing in that picture could be turned into a formula this engine can draw',
      saw: 'a shaded band with no axis and no legend',
      refused: [],
    }
    await read(vi.fn(async () => jsonResponse(body)))

    expect(await screen.findByTestId('image-refusal'))
      .toHaveTextContent('nothing in that picture could be turned into a formula')
    expect(screen.getByTestId('image-gate')).toHaveTextContent('vision:no-candidate')
    expect(screen.getByTestId('image-refusal-saw')).toHaveTextContent('a shaded band')
    expect(screen.queryByTestId('image-candidate')).toBeNull()
  })

  it('the FLAG being off reads as a sentence, not as a broken button', async () => {
    // The route is mounted with the flag off on purpose; the handler answers a
    // 200 refusal so the surface can say what happened.
    const body = { ok: false, gate: 'vision:disabled',
                   reason: 'reading an indicator from a picture is not switched on '
                           + '-- ask an admin to set INDICATOR_VISION_ENABLED=1' }
    await read(vi.fn(async () => jsonResponse(body)))
    expect(await screen.findByTestId('image-refusal'))
      .toHaveTextContent('not switched on')
    expect(screen.getByTestId('image-gate')).toHaveTextContent('vision:disabled')
  })

  it('a 402 says PAY, not "no answer"', async () => {
    await read(vi.fn(async () => jsonResponse({}, { ok: false, status: 402 })))
    expect(await screen.findByTestId('image-refusal')).toHaveTextContent(/paid plan/i)
    expect(screen.getByTestId('image-gate')).toHaveTextContent('http:402')
  })

  it('a 429 says slow down', async () => {
    await read(vi.fn(async () => jsonResponse({}, { ok: false, status: 429 })))
    expect(await screen.findByTestId('image-refusal')).toHaveTextContent(/lot of pictures/i)
  })

  it('a thrown fetch is a refusal, not a dead surface', async () => {
    await read(vi.fn(async () => { throw new Error('offline') }))
    expect(await screen.findByTestId('image-gate')).toHaveTextContent('network')
  })

  it('a tree the read-back cannot describe is REFUSED rather than shown bare', async () => {
    // `sentenceFor` throws for a tree it has no English for. That disqualifies
    // the candidate — a formula with no read-back is a formula the member cannot
    // check, which is the whole hazard this feature carries.
    const body = okBody({ candidates: [{
      rank: 1, label: 'mystery', confidence: 51, saw: 'a line',
      ast: { type: 'zzNotANode' }, source: 'zzNotANode', sentence: LIE_A,
      repaint: 'non-repainting',
    }] })
    await read(vi.fn(async () => jsonResponse(body)))
    expect(await screen.findByTestId('image-refusal')).toBeTruthy()
    expect(screen.queryByTestId('image-candidate')).toBeNull()
    expect(screen.getByTestId('image-rejected-gate')).toHaveTextContent('sentence')
  })

  it('accepting hands the BUILDER the tree and THIS box\'s read-back', async () => {
    const onAccept = vi.fn()
    await read(vi.fn(async () => jsonResponse(okBody())), { onAccept })
    fireEvent.click(await screen.findByTestId('image-accept'))
    expect(onAccept).toHaveBeenCalledTimes(1)
    const handed = onAccept.mock.calls[0][0]
    expect(handed.ast).toEqual(TREE_A)
    expect(handed.sentence).toBe(sentenceFor(TREE_A))
    expect(handed.sentence).not.toBe(LIE_A)
  })

  it('the button is off until there is a picture, and it LOOKS off', () => {
    render(<ImageBox fetchImpl={vi.fn()} />)
    const button = screen.getByRole('button', { name: /read the picture/i })
    expect(button).toBeDisabled()
    expect(button.className).toMatch(/dimmed/)
    expect(screen.getByText(/choose a picture first/i)).toBeTruthy()
  })

  it('does not fire without a picture, and sends the picture, the note and the bars when it does', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()))
    render(<ImageBox fetchImpl={fetchImpl} bars={[{ t: 1, c: 2 }]} />)
    fireEvent.click(screen.getByRole('button', { name: /read the picture/i }))
    expect(fetchImpl).not.toHaveBeenCalled()

    fireEvent.change(screen.getByTestId('image-file'),
                     { target: { files: [PICTURE()] } })
    fireEvent.change(screen.getByTestId('image-note'),
                     { target: { value: 'it sits under the price' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /read the picture/i }))
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/indicator-vision/candidates')
    expect(init.method).toBe('POST')
    const form = init.body
    expect(form.get('note')).toBe('it sits under the price')
    expect(JSON.parse(form.get('bars'))).toEqual([{ t: 1, c: 2 }])
    expect(form.get('file')).toBeTruthy()
    // ⛔ NO `Content-Type` HEADER. The browser sets the multipart boundary; a
    // hand-set header makes the body unparseable on the server.
    expect(init.headers).toBeUndefined()
  })
})
