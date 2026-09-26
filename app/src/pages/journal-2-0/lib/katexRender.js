/**
 * Wave 5 — the ONLY module that imports KaTeX, and it is only ever reached
 * through `import()` (mathNodes.js::loadKatex). KaTeX's JavaScript, its
 * stylesheet and its fonts therefore ship in their own chunk and load the
 * first time a note that holds math renders one — never for the member who
 * opens a note without any.
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'

// ⛔ `trust: false` (the default, stated): \href, \url, \includegraphics and
// \htmlClass stay inert, so a shared note's math cannot carry a link or a
// class into a public page. `throwOnError: false` renders a bad expression in
// place as KaTeX's own error text rather than throwing out of a node view.
// The two ceilings bound a pathological expression (a macro that expands
// forever, a \rule the size of a building) typed or pasted by accident.
const OPTIONS = Object.freeze({
  throwOnError: false,
  trust: false,
  strict: 'ignore',
  maxExpand: 500,
  maxSize: 50,
  output: 'htmlAndMathml', // the MathML half is what a screen reader reads
})

export function renderLatex(element, latex, displayMode) {
  katex.render(String(latex ?? ''), element, { ...OPTIONS, displayMode: Boolean(displayMode) })
}
