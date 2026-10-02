// Template picker grid — the Notebook's "what kind of note?" surface.
// Rendered inside a Sheet from the toolbar AND inline on the empty-notebook
// state. Families come from the catalog; "Blank note" is always first, and
// the last card points setup-documentation work at My Playbook (which owns
// that artifact — see the templates plan §3).
//
// Wave 10 lane D2 (design finding D-4): a BROWSABLE gallery, the way Notion's and
// Evernote's are. Every built-in card shows the template's name, its one-line
// description and a short preview of the note it makes -- its first lines, taken
// from the template's own STRUCTURE (`templatePreview`, lib/notebookTemplates.js:
// the headings and prompts it writes for everyone, never its no-data scaffold),
// never a second, hand-typed list. Grouped by family, as the catalog declares.
// A card is named by the template's name and described by its "when" line and its
// description only (fix round 1, M-3); the preview is a visual sample and is
// hidden from assistive tech, which already has the description.
// Arrow keys move between cards (Home/End to the ends); Tab still walks every one.
// Picking a card hands `onPick` the catalog's own object, exactly as before.
//
// Wave 10 lane DR-C (design finding D-4, breadth + a real gallery): three
// additions, none of which touch the card's own click/Enter/Space behaviour
// above (so every rail this header already describes stays green byte-for-
// byte on the default, unfiltered view):
//   * a search box + category chips (derived from FAMILIES -- never a typed
//     second list) that filter which family sections and cards render;
//   * a "Preview" action beside each card (own sibling control, never nested
//     inside the card's <button> -- a button in a button is one control to a
//     screen reader) that opens the template's full body READ-ONLY
//     (TemplatePreview.jsx) with a "Use this template" button which calls the
//     exact same `onPick`/`onPickMember` the card itself calls -- creation
//     still goes through ONE door (`createNoteViaApi`, wired by the caller);
//   * the catalog has grown from 9 to 25 built-ins (breadth) -- every test in
//     this file's sibling `.gallery.test.jsx` is derived from `TEMPLATES`, so
//     it covers the new ones without being told their names.
//
// Wave 12 lane 12A: while notebook_template_gallery_enabled is LATCHED on, a "Browse the
// community gallery" door below the chips swaps this dialog's content for
// TemplateGallery.jsx (members' shared templates, reviewed by UCT); its Back button
// returns here with focus on the door. "Make a note from it" there calls the same
// `onPickMember` this picker hands MemberTemplates. Gate off: no door, nothing changes.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FAMILIES, templatesByFamily, templatePreview } from '../../lib/notebookTemplates'
import MemberTemplates from './MemberTemplates'
import TemplatePreview from './TemplatePreview'
import TemplateGallery from './TemplateGallery'
import { templateGalleryEnabled } from '../../lib/templateGallery'
import UIcon from '../../../../components/ui/UIcon'
import styles from './TemplatePicker.module.css'

const CARD = '[data-template-card]'
const MOVES = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
const ALL = 'all'
const MEMBER = 'member'

/** Case-insensitive substring match over a template's searchable text. */
function templateMatches(tpl, q) {
  if (!q) return true
  const hay = [tpl.label, tpl.description, tpl.when, ...(tpl.tags || [])].join(' ').toLowerCase()
  return hay.includes(q)
}

/** Arrow / Home / End move focus between the gallery's cards (enabled ones only). */
function onGalleryKeyDown(e) {
  const from = e.target.closest?.(CARD)
  if (!from) return
  const cards = [...e.currentTarget.querySelectorAll(CARD)].filter((c) => !c.disabled)
  const at = cards.indexOf(from)
  if (at < 0) return
  let to = null
  if (e.key in MOVES) to = cards[Math.min(cards.length - 1, Math.max(0, at + MOVES[e.key]))]
  else if (e.key === 'Home') to = cards[0]
  else if (e.key === 'End') to = cards[cards.length - 1]
  if (!to) return
  e.preventDefault()
  to.focus()
}

// Wave 6: `onPickMember` adds "Your templates" (the member's own, saved from
// their notes) right after Blank — the templates a member made are the ones
// they reach for first. Absent, the picker is exactly the built-in catalog.
export default function TemplatePicker({ onPick, onPickMember, busy = false }) {
  const navigate = useNavigate()
  // A picker can be on screen twice (the empty notebook and the New-note sheet),
  // so the label ids are per instance.
  const uid = useId()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL)
  // The previewed template: { label, subtitle, body, onUse } | null. A built-in
  // preview is synchronous (the catalog already holds the body); a member
  // preview fetches the full record first (see MemberTemplates.jsx) and is
  // opened by that component through `onPreviewMember` below.
  const [preview, setPreview] = useState(null)
  const galleryOn = templateGalleryEnabled()
  const [community, setCommunity] = useState(false)
  const [backToDoor, setBackToDoor] = useState(false)
  const doorRef = useRef(null)
  useEffect(() => {
    if (backToDoor && !community) {
      doorRef.current?.focus()
      setBackToDoor(false)
    }
  }, [backToDoor, community])

  const q = query.trim().toLowerCase()
  const showFamily = (famKey) => category === ALL || category === famKey
  const visibleFamilies = useMemo(
    () => FAMILIES
      .filter((f) => showFamily(f.key))
      .map((f) => ({ ...f, items: templatesByFamily(f.key).filter((t) => templateMatches(t, q)) }))
      .filter((f) => f.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, category],
  )
  const showMemberSection = Boolean(onPickMember) && (category === ALL || category === MEMBER)
  const noBuiltInMatches = visibleFamilies.length === 0 && category !== MEMBER

  const openBuiltInPreview = (tpl) => setPreview({
    label: tpl.label,
    subtitle: tpl.when,
    body: tpl.build({}),
    onUse: () => { setPreview(null); onPick(tpl) },
  })

  const closePreview = () => setPreview(null)

  if (galleryOn && community) {
    return (
      <div className={styles.wrap}>
        <TemplateGallery
          onBack={() => { setCommunity(false); setBackToDoor(true) }}
          onUseNow={onPickMember}
          busy={busy}
        />
      </div>
    )
  }

  return (
    // The keys are handled for the card buttons inside (see onGalleryKeyDown).
    <div className={styles.wrap} onKeyDown={onGalleryKeyDown} data-template-gallery="">
      <div className={styles.toolbar}>
        <div className={styles.searchField}>
          <UIcon name="search" size={14} gold={false} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates…"
            aria-label="Search templates"
          />
          {query && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <UIcon name="x" size={12} gold={false} />
            </button>
          )}
        </div>
        <div className={styles.chipRow} role="group" aria-label="Filter templates by category">
          <button
            type="button"
            className={`${styles.chip} ${category === ALL ? styles.chipActive : ''}`}
            aria-pressed={category === ALL}
            onClick={() => setCategory(ALL)}
          >
            All
          </button>
          {FAMILIES.map((fam) => (
            <button
              key={fam.key}
              type="button"
              className={`${styles.chip} ${category === fam.key ? styles.chipActive : ''}`}
              aria-pressed={category === fam.key}
              onClick={() => setCategory(fam.key)}
            >
              {fam.label}
            </button>
          ))}
          {onPickMember && (
            <button
              type="button"
              className={`${styles.chip} ${category === MEMBER ? styles.chipActive : ''}`}
              aria-pressed={category === MEMBER}
              onClick={() => setCategory(MEMBER)}
            >
              Your templates
            </button>
          )}
        </div>
        {galleryOn && (
          <button
            type="button"
            ref={doorRef}
            className={styles.galleryDoor}
            onClick={() => setCommunity(true)}
            data-community-gallery-door=""
          >
            <UIcon name="community" size={14} gold={false} />
            <span>Browse the community gallery</span>
          </button>
        )}
      </div>

      <button
        type="button"
        className={`${styles.card} ${styles.blankCard}`}
        onClick={() => onPick(null)}
        disabled={busy}
        data-template-card=""
      >
        <span className={styles.cardLabel}>Blank note</span>
        <span className={styles.cardDesc}>An empty page — structure it your way.</span>
      </button>

      {showMemberSection && (
        <MemberTemplates
          onPick={onPickMember}
          busy={busy}
          query={q}
          onPreview={(p) => setPreview(p)}
        />
      )}

      {noBuiltInMatches && (
        <p className={styles.emptyFilter} role="status">
          {q ? `No templates match “${query.trim()}”.` : 'No templates in this category.'}
        </p>
      )}

      {visibleFamilies.map((fam) => (
        <section key={fam.key} className={styles.family}>
          {/* Wave 8 (8A): each family's cards are a group named by its label. */}
          <div className={styles.famLabel} id={`${uid}-family-${fam.key}`}>{fam.label}</div>
          <div className={styles.grid} role="group" aria-labelledby={`${uid}-family-${fam.key}`}>
            {fam.items.map((tpl) => {
              const id = `${uid}-tpl-${tpl.key}`
              const lines = templatePreview(tpl)
              return (
                <div key={tpl.key} className={styles.cardWrap}>
                  <button
                    type="button"
                    className={styles.card}
                    onClick={() => onPick(tpl)}
                    disabled={busy}
                    data-template-card=""
                    data-template-key={tpl.key}
                    aria-label={tpl.label}
                    aria-describedby={`${id}-when ${id}-desc`}
                  >
                    <span className={styles.cardWhen} id={`${id}-when`}>{tpl.when}</span>
                    <span className={styles.cardLabel}>{tpl.label}</span>
                    <span className={styles.cardDesc} id={`${id}-desc`}>{tpl.description}</span>
                    {lines.length > 0 && (
                      <span className={styles.cardPreview} aria-hidden="true" data-template-preview="">
                        {lines.map((line, i) => (
                          <span
                            // a preview's lines are fixed for a given template: the index is its identity
                            key={i}
                            className={`${styles.previewLine} ${styles[`preview_${line.kind}`] || ''}`}
                          >
                            {line.kind === 'bullet' ? `• ${line.text}` : line.text}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                  {/* A sibling control, never nested in the card's own <button>
                      (a button in a button is one control to a screen reader). */}
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.miniBtn}
                      onClick={() => openBuiltInPreview(tpl)}
                      disabled={busy}
                      aria-label={`Preview ${tpl.label}`}
                    >
                      <UIcon name="eye" size={13} gold={false} /> Preview
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <button
        type="button"
        className={`${styles.card} ${styles.pointerCard}`}
        onClick={() => navigate('/model-book?view=builder')}
        disabled={busy}
        data-template-card=""
      >
        <span className={styles.cardLabel}>Documenting a setup?</span>
        <span className={styles.cardDesc}>
          Build it in My Playbook — annotated charts, entry criteria, linked notes. →
        </span>
      </button>

      <TemplatePreview
        open={Boolean(preview)}
        onClose={closePreview}
        title={preview?.label}
        subtitle={preview?.subtitle}
        body={preview?.body}
        onUse={preview?.onUse}
        busy={busy}
        loading={Boolean(preview?.loading)}
        loadError={preview?.loadError || null}
      />
    </div>
  )
}
