/**
 * Wave 10 (lane TY5 -- "typing busy time < 16 ms/char up to 2,000 paragraphs,
 * read on `typing_busy_per_char`", ruling D24).
 *
 * `perf-budgets.md`/TY5's own CPU profile named the next cost after lane
 * TY2's `memoDocJSON`: `captureLocalState` already returns a tree where every
 * UNCHANGED paragraph's JSON object is the exact same object reference as the
 * keystroke before (`memoDocJSON.js`) -- but `saveDraftLocally` still calls
 * plain `JSON.stringify()` on that tree before writing it to localStorage,
 * and `JSON.stringify` does not know or care that most of the tree is
 * unchanged: it walks and re-emits EVERY character of EVERY node's string
 * form on EVERY call, regardless of object identity. Profiled (lane TY5,
 * `docs/notebook/perf-runs/ty5/`): `saveDraftLocally`'s own self time grows
 * from ~0 to ~1.5 ms/key between a 1-paragraph and a 2,000-paragraph note --
 * the single largest size-scaling cost found, ahead of ProseMirror's own
 * transaction-apply machinery.
 *
 * This is a memoized drop-in for `JSON.stringify(bodyJson)`, caching the
 * STRING form of each node keyed on the node's JSON OBJECT (the object
 * `memoDocJSON`'s `toJSON()` already produces and already reuses by
 * reference for an untouched subtree) -- a second cache layer over the
 * first, same mechanism one level up: object identity in, string reuse out.
 * It changes ONLY when the string is computed, never what the string
 * contains -- `memoStringifyBody.test.js` proves byte-identical output
 * against plain `JSON.stringify()` on the same tree `memoDocJSON.test.js`
 * exercises, including the saveDraftLocally WRAPPER object (title/
 * subtitle/bodyJson/savedAt/sessionId/baseUpdatedAt/writtenSchema) this
 * module's second export reconstructs by hand.
 *
 * ⛔⛔ THE NODE SERIALIZER (`stringifyNode`) MUST STAY IN LOCKSTEP WITH
 * `memoDocJSON.js`'s `toJSON()` -- same key order (`type`, `attrs`,
 * `content`, `marks`, `text`, each present only when `toJSON()` would add
 * it), because this function trusts that order rather than re-deriving it.
 * `attrs`/`marks` are handed to the NATIVE `JSON.stringify` unchanged (they
 * are small, per-node, and do not scale with document length -- there is no
 * memoization win there worth the reimplementation risk, the same call
 * `memoDocJSON.js` itself makes about marks).
 *
 * ⛔⛔ `stringifyDraftPayload` MUST STAY IN LOCKSTEP WITH `saveDraftLocally`'s
 * object literal in NoteEditorPage.jsx (the exact field list and order). It
 * reconstructs that object's JSON form field by field so `bodyJson` can be
 * the pre-computed, memoized string rather than a plain value every call
 * re-stringifies from scratch. Every field it touches is guaranteed never
 * `undefined` at that call site (title/subtitle are refs seeded `''`,
 * `savedAt`/`sessionId` are always-present scalars, `usableBaseline()`
 * always returns `string | null`, `writtenSchema` is always an integer) --
 * `JSON.stringify(undefined)` would silently OMIT a key, the one failure
 * mode hand-rolled field-by-field construction does not catch for you, and
 * `memoStringifyBody.test.js` asserts byte-equality against the native path
 * on the exact field set in use today specifically so a future field added
 * to one side and not the other is caught immediately rather than drifting.
 *
 * Wave 10 (lane TY8 -- the TAIL: `docs/notebook/perf-runs/ty8/README.md`).
 * The cache above makes every CHILD's string form free to look up again, but
 * the top-level `obj.content.map(stringifyNode).join(',')` for the DOC's OWN
 * content array still ran in full on EVERY keystroke, because the doc-level
 * node object is a FRESH object every keystroke (ProseMirror's structural
 * sharing reuses unchanged CHILDREN, never the parent array that lists them
 * -- `Fragment.replaceChild` always `this.content.slice()`s a new array), so
 * `stringifyNode(doc)` was always a cache MISS at the root. At 2,000
 * paragraphs that is an unconditional ~2,000-element array allocation plus a
 * full byte-copy join of the whole note's JSON text (roughly 150-300 KB),
 * every ~25ms of continuous typing, regardless of how small the edit was.
 * Measured (`docs/notebook/perf-runs/ty8/ty8-slow-vs-median-*.json`): V8
 * Minor/Major GC phases (`V8.GC_MC_INCREMENTAL` and its siblings -- a
 * generational collector's pause scales with how much garbage and live data
 * it must walk, which scales with note size) show up on the SLOW keystrokes
 * (set by whichever keystroke happens to cross an allocation threshold) and
 * almost never on the median ones -- a periodic, size-scaling cost sitting
 * on a MINORITY of keys, which is exactly the tail shape TY4/TY5/TY7 left
 * named but did not explain.
 *
 * `createIncrementalJoin()` below cuts that per-keystroke allocation for the
 * common case: a content array the SAME LENGTH as last time, differing in a
 * contiguous run of elements -- true for every ordinary keystroke that edits
 * text inside an existing paragraph (one element changes: the edited
 * paragraph). It keeps the LAST joined string plus a table of where each
 * element's text starts within it, and reuses the unchanged PREFIX and
 * SUFFIX via `String.prototype.slice()` (in V8, slicing a string above a
 * small length threshold produces a SlicedString VIEW, not a byte copy)
 * instead of rebuilding them from an array of 2,000 already-cached pieces.
 * Only the elements between the first and last differing index are
 * re-stringified and rejoined -- one element wide for the common case this
 * budget measures. Enter/Backspace-at-a-paragraph-boundary/paste change the
 * paragraph COUNT, which this falls back on exactly as before (a correct,
 * unoptimized full recompute, the same cost `stringifyNode` always paid).
 *
 * It changes ONLY how the joined string is COMPUTED, never what it contains
 * or how often the snapshot is taken or written -- `memoStringifyBody.test.js`
 * proves every output byte-identical to the plain
 * `arr.map(stringify).join(',')` it replaces, across the length-unchanged
 * fast path, the length-changed fallback, and a run of mixed edits. It is
 * wired ONLY into the doc's own top-level content array (`stringifyBody`,
 * the function `createMemoStringify()` now returns): every NESTED content
 * array (a paragraph's own text-node list, a table's rows) still goes
 * through the plain recursive `stringifyNode` below, unchanged -- those
 * arrays are small in the common case and the extra bookkeeping would not
 * pay for itself there.
 */

/**
 * A join cache for exactly ONE array slot across calls, reused across many
 * (array, compute) calls over time -- built for the doc's own content array,
 * the only one in this app's typing path large enough for the difference to
 * matter. `compute(item)` must be pure (same item -> same string) and is
 * called ONLY for elements that are not reused verbatim from the last call.
 */
export function createIncrementalJoin() {
  let lastArr = null
  // lastOffsets[i] = the character index in `lastJoined` where element i's
  // own text begins (no leading separator); lastOffsets[n] = lastJoined.length.
  let lastOffsets = null
  let lastJoined = ''

  function fullRecompute(arr, compute) {
    const n = arr.length
    const parts = new Array(n)
    const offsets = new Array(n + 1)
    let pos = 0
    for (let i = 0; i < n; i += 1) {
      parts[i] = compute(arr[i])
      offsets[i] = pos
      pos += parts[i].length + (i < n - 1 ? 1 : 0)
    }
    offsets[n] = pos
    lastArr = arr
    lastOffsets = offsets
    lastJoined = parts.join(',')
    return lastJoined
  }

  return function incrementalJoin(arr, compute) {
    if (arr === lastArr) return lastJoined
    if (!lastArr || arr.length !== lastArr.length) return fullRecompute(arr, compute)
    const n = arr.length
    let lo = 0
    while (lo < n && arr[lo] === lastArr[lo]) lo += 1
    if (lo === n) { lastArr = arr; return lastJoined }   // every element identical by reference
    let hi = n
    while (hi > lo && arr[hi - 1] === lastArr[hi - 1]) hi -= 1

    const prefix = lo === 0 ? '' : lastJoined.slice(0, lastOffsets[lo])
    const suffix = hi === n ? '' : lastJoined.slice(lastOffsets[hi])

    const offsets = new Array(n + 1)
    for (let i = 0; i <= lo; i += 1) offsets[i] = lastOffsets[i]
    const midParts = new Array(hi - lo)
    let pos = lastOffsets[lo]
    for (let i = lo; i < hi; i += 1) {
      const s = compute(arr[i])
      midParts[i - lo] = s
      offsets[i] = pos
      pos += s.length + 1
    }
    const middleStr = midParts.join(',')
    // Authoritative, not derived from the loop's own running `pos` (which
    // assumes a trailing separator the final middle element may not have):
    // the exact position where the unchanged suffix now starts.
    const hiOffset = prefix.length + middleStr.length + (hi < n ? 1 : 0)
    offsets[hi] = hiOffset
    // The suffix is a VERBATIM slice of old, unchanged text -- every
    // element's position within it shifts by the same fixed amount relative
    // to where that slice now starts.
    for (let i = hi + 1; i <= n; i += 1) offsets[i] = hiOffset + (lastOffsets[i] - lastOffsets[hi])

    const joined = prefix + middleStr + (hi < n ? ',' : '') + suffix
    lastArr = arr
    lastOffsets = offsets
    lastJoined = joined
    return joined
  }
}

/** A memoized `JSON.stringify()` for a `memoDocJSON`-shaped node tree. One
 *  instance per editor lifetime, same convention as `createMemoDocJSON()`. */
export function createMemoStringify() {
  const cache = new WeakMap()

  // Shared field-order logic (MUST stay in lockstep with memoDocJSON.js's
  // `toJSON()` -- see the header above) parameterized only on how to turn a
  // `content` array into the text that goes between its `[` and `]`, so the
  // top-level and recursive paths cannot drift on the fields that actually
  // matter for correctness.
  function stringifyWith(obj, joinContent) {
    if (obj === null) return 'null'
    const hit = cache.get(obj)
    if (hit !== undefined) return hit
    let s = `{"type":${JSON.stringify(obj.type)}`
    if ('attrs' in obj) s += `,"attrs":${JSON.stringify(obj.attrs)}`
    if ('content' in obj) {
      s += ',"content":'
      s += obj.content === null ? 'null' : `[${joinContent(obj.content)}]`
    }
    if ('marks' in obj) s += `,"marks":${JSON.stringify(obj.marks)}`
    if ('text' in obj) s += `,"text":${JSON.stringify(obj.text)}`
    s += '}'
    cache.set(obj, s)
    return s
  }

  function stringifyNode(obj) {
    return stringifyWith(obj, (content) => content.map(stringifyNode).join(','))
  }

  // One incremental-join slot, dedicated to the DOC's own (usually large)
  // content array -- see the header for why only this one level needs it.
  const joinTopLevelContent = createIncrementalJoin()
  function stringifyBody(obj) {
    return stringifyWith(obj, (content) => joinTopLevelContent(content, stringifyNode))
  }

  return stringifyBody
}

/**
 * Byte-identical to:
 *   JSON.stringify({ title, subtitle, bodyJson, savedAt, sessionId, baseUpdatedAt, writtenSchema })
 * with `bodyJsonStr` already the memoized stringify of `bodyJson` (this
 * module's `createMemoStringify()`, or any producer of the same bytes
 * `JSON.stringify(bodyJson)` would produce).
 */
export function stringifyDraftPayload({ title, subtitle, bodyJsonStr, savedAt, sessionId, baseUpdatedAt, writtenSchema }) {
  return `{"title":${JSON.stringify(title)}` +
    `,"subtitle":${JSON.stringify(subtitle)}` +
    `,"bodyJson":${bodyJsonStr}` +
    `,"savedAt":${JSON.stringify(savedAt)}` +
    `,"sessionId":${JSON.stringify(sessionId)}` +
    `,"baseUpdatedAt":${JSON.stringify(baseUpdatedAt)}` +
    `,"writtenSchema":${JSON.stringify(writtenSchema)}}`
}
