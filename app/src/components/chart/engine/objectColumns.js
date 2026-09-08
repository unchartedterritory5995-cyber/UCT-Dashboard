// app/src/components/chart/engine/objectColumns.js
//
// ─── ⭐⭐ C3B — FEEDING THE OBJECT PROGRAM FROM THE SHARED GRAPH ─────────────
//
// The object program stores integers. This is where an integer becomes a column
// of numbers, once, and is read by every operation that names it.
//
// ⭐⭐ ONLY THE NODES THE PROGRAM ACTUALLY READS ARE COMPUTED. A saved V2 graph
// on a real script holds hundreds of nodes; an object program typically reads a
// dozen. Materialising the whole table would make a dashboard cost what a whole
// indicator costs, for nothing — so the reference set is derived from the
// program itself (`graphNodesReferenced`), and everything else stays an integer.
//
// ⛔ AND EACH NODE IS COMPUTED ONCE. Two lines whose y-coordinate is the same
// expression share a node by construction (C2C's content digest did that), so
// they must also share the column — otherwise the graph's whole compaction win
// is paid back in evaluation time.
//
// ⚠️ THIS IS ALSO THE ONE PLACE A DANGLING REFERENCE CAN STILL SURFACE. The
// document validator refuses out-of-range nodes at save time, but a document
// written by an older client, or hand-edited, reaches here — so a node that
// cannot be expanded yields a column of NaN and is REPORTED, never silently
// zero. An object at coordinate zero is a drawing; an object that did not draw
// is a fact.
import { nodeTree } from './ast/graph'
import { graphNodesReferenced } from './ast/objectProgram'
import { interpret } from './ast/interpret'

/**
 * @param {object} graph    a V2 graph
 * @param {object} program  a BOUND object program
 * @param {Array}  bars     the series to evaluate over
 * @param {object} [opts]   `{ interpretOpts }`
 * @returns {{ readNode: (node:number, bar:number)=>number, columns: Map, failed: number[] }}
 */
export function computeObjectColumns(graph, program, bars, opts = {}) {
  const columns = new Map()
  const failed = []
  const wanted = graphNodesReferenced(program)
  for (const node of wanted) {
    try {
      const tree = nodeTree(graph, node)
      const col = interpret(tree, bars, opts.interpretOpts || {})
      columns.set(node, col)
    } catch {
      failed.push(node)
    }
  }
  const readNode = (node, bar) => {
    const col = columns.get(node)
    if (!col) return NaN
    const v = col[bar]
    return v === undefined ? NaN : v
  }
  return { readNode, columns, failed, wanted }
}
