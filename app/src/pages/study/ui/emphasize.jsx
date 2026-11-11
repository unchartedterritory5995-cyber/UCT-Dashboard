// EASIER TO READ (kit v2, 2026-11-08; the owner, batch 24, on the lesson: "easier to read while getting a really good
// message across"; rule 9 of docs/study/OWNER_PRINCIPLES.md). The words of a lesson are never rewritten; the numbers in
// them are what a trader scans for, so every price, percentage, multiple and count of sessions or days is set in bold
// gold, and the eye can run down a lesson by its numbers.
import k from './emphasize.module.css'

const NUM = /([+−-]?\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|R|x\b))?(?:\s(?:sessions?|days?|bars?|weeks?))?)/g

export default function Emph({ children }) {
  const text = String(children ?? '')
  if (!text) return null
  const out = []
  let last = 0
  for (const m of text.matchAll(NUM)) {
    const s = m.index
    // a bare small integer inside a word run ("the 21 or 50-day") still reads as a number; a digit glued to letters does not
    if (s > 0 && /[A-Za-z]/.test(text[s - 1])) continue
    if (s > last) out.push(text.slice(last, s))
    out.push(<b key={s} className={k.num}>{m[0]}</b>)
    last = s + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}
