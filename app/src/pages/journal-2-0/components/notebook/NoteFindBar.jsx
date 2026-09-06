/**
 * Wave B find-in-note bar. Scoped strictly to the current note's editor
 * (`editor` prop) — never a global/page-wide find. See noteFindExtension.js
 * for the decoration layer this drives; this component is pure UI plumbing.
 */
import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NoteFindBar.module.css'

export default function NoteFindBar({ editor, onClose }) {
  const [term, setTerm] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const scrollToActive = () => {
    // rAF: wait for the decoration DOM to actually update before scrolling.
    // `isDestroyed` guards a note-switch/unmount racing this callback --
    // `editor.view` THROWS once destroyed (not merely undefined), so a bare
    // `editor?.view` optional-chain does not protect against it.
    requestAnimationFrame(() => {
      if (!editor || editor.isDestroyed) return
      const el = editor.view.dom.querySelector('.uct-find-match-active')
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  const syncFromStorage = () => {
    if (!editor) return
    setMatchCount(editor.storage.noteFind.matches.length)
    setActiveIndex(editor.storage.noteFind.activeIndex)
  }

  const onChange = (e) => {
    const value = e.target.value
    setTerm(value)
    if (!editor) return
    editor.commands.noteFindSet(value)
    syncFromStorage()
    scrollToActive()
  }

  const goNext = () => {
    if (!editor) return
    editor.commands.noteFindNext()
    syncFromStorage()
    scrollToActive()
  }

  const goPrev = () => {
    if (!editor) return
    editor.commands.noteFindPrev()
    syncFromStorage()
    scrollToActive()
  }

  const handleClose = () => {
    editor?.commands.noteFindClear()
    onClose?.()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handleClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) goPrev()
      else goNext()
    }
  }

  return (
    <div className={styles.bar} role="search" aria-label="Find in note">
      <UIcon name="search" size={14} gold={false} />
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        role="searchbox"
        value={term}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Find in note"
        aria-label="Find in note"
        autoComplete="off"
        spellCheck={false}
      />
      <span className={styles.count} aria-live="polite">
        {term ? `${matchCount > 0 ? activeIndex + 1 : 0}/${matchCount}` : ''}
      </span>
      <button
        type="button"
        className={styles.navBtn}
        onClick={goPrev}
        disabled={matchCount === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        <UIcon name="chevronUp" size={13} gold={false} />
      </button>
      <button
        type="button"
        className={styles.navBtn}
        onClick={goNext}
        disabled={matchCount === 0}
        aria-label="Next match"
        title="Next match (Enter)"
      >
        <UIcon name="chevronDown" size={13} gold={false} />
      </button>
      <button
        type="button"
        className={styles.closeBtn}
        onClick={handleClose}
        aria-label="Close find"
        title="Close (Esc)"
      >
        <UIcon name="x" size={13} gold={false} />
      </button>
    </div>
  )
}
