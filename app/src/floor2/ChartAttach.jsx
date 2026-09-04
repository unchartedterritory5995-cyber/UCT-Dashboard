import { useState, useRef, useEffect } from 'react'

const TFS = ['5m', '30m', '1h', '1D', '1W']

// Small form to attach a chart: ticker + timeframe → onDone({ticker, tf}).
export default function ChartAttach({ onDone, onCancel }) {
  const [ticker, setTicker] = useState('')
  const [tf, setTf] = useState('1D')
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])

  const add = () => {
    const t = ticker.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5)
    if (!t) return
    onDone({ ticker: t, tf })
  }
  return (
    <div className="chart-attach">
      <span className="ca-label"><span style={{ color: 'var(--ut-gold)' }}>$</span></span>
      <input ref={ref} className="ca-ticker" placeholder="TICKER" value={ticker} maxLength={5}
        onChange={(e) => setTicker(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
      <select className="ca-tf" value={tf} onChange={(e) => setTf(e.target.value)}>
        {TFS.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <button className="btn-primary" style={{ height: 32, padding: '0 14px', fontSize: 13 }} disabled={!ticker.trim()} onClick={add}>Add chart</button>
      <button className="btn-ghost" style={{ height: 32, padding: '0 12px', fontSize: 13 }} onClick={onCancel}>Cancel</button>
    </div>
  )
}
