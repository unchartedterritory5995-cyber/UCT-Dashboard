import { useState, useRef } from 'react'
import { IconClose, IconTop, IconImage } from './icons'
import ChartCard from './ChartCard'
import ChartAttach from './ChartAttach'
import { buildDoc, uploadImage } from './hooks/useFloor'

const FLAIRS = ['Question', 'Discussion', 'Trade Idea', 'Lesson', 'Deep Dive']

function extractTickers(text) {
  const set = new Set()
  for (const m of String(text).matchAll(/\$([A-Z]{1,5})\b/g)) set.add(m[1])
  return [...set]
}

export default function Composer({ onClose, onSubmit }) {
  const [flair, setFlair] = useState('Question')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [chart, setChart] = useState(null)
  const [attaching, setAttaching] = useState(false)
  const [images, setImages] = useState([])       // [{url(preview), file}]
  const [tickerTags, setTickerTags] = useState([])
  const [tickerInput, setTickerInput] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')

  const imageInput = useRef(null)

  const addImageFiles = (fileList) => {
    const next = []
    for (const f of fileList) {
      if (f.type.startsWith('image/')) next.push({ url: URL.createObjectURL(f), file: f })
    }
    if (next.length) setImages((prev) => [...prev, ...next])
  }
  // Ctrl+V an image from the clipboard, straight into the post.
  const onPaste = (e) => {
    const items = e.clipboardData?.items || []
    const imgs = []
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) imgs.push({ url: URL.createObjectURL(f), file: f })
      }
    }
    if (imgs.length) { e.preventDefault(); setImages((prev) => [...prev, ...imgs]) }
  }

  const commitTicker = () => {
    const parts = tickerInput.toUpperCase().split(/[\s,]+/).map((s) => s.replace(/[^A-Z]/g, '')).filter(Boolean)
    if (!parts.length) return
    setTickerTags((prev) => [...new Set([...prev, ...parts])].slice(0, 15))
    setTickerInput('')
  }

  const canPost = title.trim().length >= 6 && !posting
  const submit = async () => {
    if (!canPost) return
    setPosting(true); setError('')
    try {
      const urls = []
      for (const img of images) {
        const r = await uploadImage(img.file)
        if (r?.url) urls.push(r.url)
      }
      const docBody = buildDoc(body, urls)
      const tickers = [...new Set([...tickerTags, ...extractTickers(`${title} ${body}`)])]
      await onSubmit({ flair, title: title.trim(), body: docBody, tickers, chart })
    } catch (e) {
      setError(e.message || 'Failed to post')
      setPosting(false)
    }
  }

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !posting) onClose() }}>
      <div className="modal">
        <div className="modal-head">
          <h3>Start a conversation</h3>
          <button className="x" onClick={onClose}><IconClose size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="flair-pick">
            {FLAIRS.map((f) => (
              <button key={f} className={`flair-opt ${flair === f ? 'sel' : ''}`} onClick={() => setFlair(f)}>{f}</button>
            ))}
          </div>
          <input className="field" placeholder="An interesting, specific title — a real question or topic"
            value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="field" placeholder="Add detail, context, your levels, or your thinking. Use $TICKER to tag symbols, or paste an image with Ctrl+V. Leave a blank line between paragraphs."
            value={body} onChange={(e) => setBody(e.target.value)} onPaste={onPaste} />

          {/* image attachment previews */}
          {images.length > 0 && (
            <div className="attach-grid">
              {images.map((img, i) => (
                <div className="att-img" key={`i${i}`}>
                  <img src={img.url} alt="attachment" />
                  <button className="att-x" onClick={() => setImages((p) => p.filter((_, j) => j !== i))}><IconClose size={12} /></button>
                </div>
              ))}
            </div>
          )}

          {chart && (
            <div className="attach-preview">
              <ChartCard {...chart} caption={null} height={170} />
              <button className="attach-remove" onClick={() => setChart(null)}><IconClose size={13} /> Remove chart</button>
            </div>
          )}
          {attaching && !chart && (
            <ChartAttach onDone={(c) => { setChart(c); setAttaching(false) }} onCancel={() => setAttaching(false)} />
          )}

          {/* attach buttons */}
          <div className="composer-tools">
            <button className="tool-btn" onClick={() => imageInput.current?.click()}><IconImage size={16} /> Image</button>
            {!chart && !attaching && (
              <button className="tool-btn" onClick={() => setAttaching(true)}><IconTop size={16} /> Chart</button>
            )}
            <input ref={imageInput} type="file" accept="image/*" multiple hidden
              onChange={(e) => { addImageFiles(e.target.files); e.target.value = '' }} />
          </div>

          {/* dedicated tickers box */}
          <label className="field-label">Tickers / tags</label>
          <div className="ticker-input-box">
            {tickerTags.map((t) => (
              <span className="tchip" key={t}>${t}<button onClick={() => setTickerTags((p) => p.filter((x) => x !== t))}><IconClose size={11} /></button></span>
            ))}
            <input placeholder={tickerTags.length ? '' : 'e.g. NVDA, AMD, SPY — press Enter'}
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { e.preventDefault(); commitTicker() }
                if (e.key === 'Backspace' && !tickerInput && tickerTags.length) setTickerTags((p) => p.slice(0, -1))
              }}
              onBlur={commitTicker} />
          </div>
          {error && <div className="composer-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <span className="hint">Posts are permanent &amp; searchable — write it so someone finds it useful in 6 months.</span>
          <button className="btn-primary" disabled={!canPost} onClick={submit}>{posting ? 'Posting…' : 'Post'}</button>
        </div>
      </div>
    </div>
  )
}
