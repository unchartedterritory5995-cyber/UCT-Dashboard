// app/src/components/chart/useChartDrawings.js — localStorage persistence for chart drawings
import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'uct-chart-drawings'

function loadAll() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  catch { return {} }
}

function saveAll(all) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)) }
  catch { /* quota exceeded */ }
}

export default function useChartDrawings(sym) {
  const [drawings, setDrawings] = useState([])

  useEffect(() => {
    if (!sym) { setDrawings([]); return }
    setDrawings(loadAll()[sym] || [])
  }, [sym])

  const persist = useCallback((updated) => {
    if (!sym) return
    setDrawings(updated)
    const all = loadAll()
    if (updated.length) all[sym] = updated
    else delete all[sym]
    saveAll(all)
  }, [sym])

  const addDrawing = useCallback((d) => {
    const id = crypto.randomUUID()
    const next = [...drawings, { ...d, id }]
    persist(next)
    return id
  }, [drawings, persist])

  const removeDrawing = useCallback((id) => {
    persist(drawings.filter(d => d.id !== id))
  }, [drawings, persist])

  const updateDrawing = useCallback((id, updates) => {
    persist(drawings.map(d => d.id === id ? { ...d, ...updates } : d))
  }, [drawings, persist])

  const clearAll = useCallback(() => persist([]), [persist])

  return { drawings, addDrawing, removeDrawing, updateDrawing, clearAll }
}
