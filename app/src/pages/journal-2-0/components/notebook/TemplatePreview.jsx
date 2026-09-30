// Wave 10 lane DR-C (design finding D-4): a full, READ-ONLY render of a
// template's body -- never the raw TipTap JSON -- with a "Use this template"
// action that hands off to the SAME creation path the gallery's cards already
// use (`onUse`, which the caller wires to `onPick`/`onPickMember`). This
// component creates nothing itself; it only decides whether the member wants
// to.
//
// Sheet already gives this the mobile/desktop split (bottom-sheet on touch,
// centered modal on desktop), Escape-to-close, a focus trap and a focus
// restore to whatever opened it (the card's own "Preview" button) -- so
// closing the preview returns focus to the door it was opened from, per the
// keyboard contract.
//
// The renderer below covers every node/mark the built-in catalog uses
// (heading/paragraph/bulletList/orderedList/listItem/horizontalRule/
// blockquote/image/text + bold/italic/underline/strike/code/link) and is
// DELIBERATELY LENIENT beyond that: a member template is a copy of a real
// note and may hold a node type this file has never heard of (an embed, a
// callout). An unknown node with children renders its children (nothing is
// silently dropped); an unknown leaf renders nothing. Never raw JSON, either
// way -- there is no code path in this file that stringifies a node for
// display.
import Sheet from '../../../../components/mobile/Sheet'
import styles from './TemplatePreview.module.css'

function Marks({ marks, children }) {
  let out = children
  for (const m of marks || []) {
    switch (m?.type) {
      case 'bold': out = <strong>{out}</strong>; break
      case 'italic': out = <em>{out}</em>; break
      case 'underline': out = <u>{out}</u>; break
      case 'strike': out = <s>{out}</s>; break
      case 'code': out = <code className={styles.code}>{out}</code>; break
      case 'link': out = <a href={m.attrs?.href} target="_blank" rel="noreferrer">{out}</a>; break
      // highlight / textColor / other marks: the text still renders, just
      // without the mark -- a preview is a content check, not a style proof.
      default: break
    }
  }
  return out
}

function Inline({ nodes }) {
  return (nodes || []).map((n, i) => {
    if (!n || typeof n !== 'object') return null
    if (n.type === 'text') {
      return <Marks key={i} marks={n.marks}>{typeof n.text === 'string' ? n.text : ''}</Marks>
    }
    // eslint-disable-next-line no-use-before-define
    return <Block key={i} node={n} />
  })
}

function ListItems({ items }) {
  return (items || []).map((li, i) => (
    // eslint-disable-next-line no-use-before-define
    <li key={i}>{(li?.content || []).map((c, j) => <Block key={j} node={c} inline />)}</li>
  ))
}

/** One block-level node. `inline` = render a paragraph's content without the
 *  wrapping <p> (used for the first paragraph inside a list item). */
function Block({ node, inline = false }) {
  if (!node || typeof node !== 'object') return null
  switch (node.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 2), 4)
      const Tag = `h${level}`
      return <Tag className={styles.heading}><Inline nodes={node.content} /></Tag>
    }
    case 'paragraph': {
      const content = <Inline nodes={node.content} />
      if (inline) return content
      return (node.content && node.content.length)
        ? <p className={styles.para}>{content}</p>
        : <p className={styles.paraEmpty} aria-hidden="true">&nbsp;</p>
    }
    case 'bulletList':
      return <ul className={styles.list}><ListItems items={node.content} /></ul>
    case 'orderedList':
      return <ol className={styles.list}><ListItems items={node.content} /></ol>
    case 'taskList':
      return (
        <ul className={`${styles.list} ${styles.taskList}`}>
          {(node.content || []).map((li, i) => (
            <li key={i} className={styles.taskItem}>
              <span className={styles.taskCheck} aria-hidden="true">{li?.attrs?.checked ? '☑' : '☐'}</span>
              {(li?.content || []).map((c, j) => <Block key={j} node={c} inline />)}
            </li>
          ))}
        </ul>
      )
    case 'horizontalRule':
      return <hr className={styles.hr} />
    case 'blockquote':
      return <blockquote className={styles.quote}>{(node.content || []).map((c, i) => <Block key={i} node={c} />)}</blockquote>
    case 'codeBlock':
      return <pre className={styles.codeBlock}><code>{(node.content || []).map((c) => c.text || '').join('')}</code></pre>
    case 'image': {
      const src = node.attrs?.src
      return src ? <img className={styles.img} src={src} alt={node.attrs?.alt || ''} /> : null
    }
    default:
      // Never raw JSON. A container we don't specifically render still shows
      // its children; a leaf we don't recognize shows nothing.
      return node.content ? <>{node.content.map((c, i) => <Block key={i} node={c} />)}</> : null
  }
}

/** The preview body: every top-level block of a TipTap doc, read-only. */
function DocBody({ body }) {
  const blocks = (body && body.content) || []
  if (!blocks.length) return <p className={styles.status}>This template makes an empty page.</p>
  return <div className={styles.body} data-template-preview-body="">{blocks.map((n, i) => <Block key={i} node={n} />)}</div>
}

export default function TemplatePreview({
  open, onClose, title, subtitle, body, onUse, busy = false, loading = false, loadError = null,
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title || 'Preview'} labelledByTitle variant="auto" maxWidth={640}>
      <div className={styles.wrap}>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        {loading ? (
          <p className={styles.status}>Loading preview…</p>
        ) : loadError ? (
          <p className={styles.status} role="alert">{loadError}</p>
        ) : (
          <DocBody body={body} />
        )}
        <div className={styles.actions}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onUse}
            disabled={busy || loading || !!loadError}
          >
            Use this template
          </button>
        </div>
      </div>
    </Sheet>
  )
}
