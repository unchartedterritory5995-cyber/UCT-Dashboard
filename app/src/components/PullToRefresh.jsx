import { useRef, useState, useCallback } from 'react'
import styles from './PullToRefresh.module.css'

const THRESHOLD = 60
const MAX_PULL = 100

const isMobile = typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0)

export default function PullToRefresh({ onRefresh, children }) {
  const [pulling, setPulling] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(0)
  const containerRef = useRef(null)

  const handleTouchStart = useCallback((e) => {
    if (!isMobile) return
    const scrollTop = containerRef.current?.scrollTop ?? 0
    if (scrollTop > 5) return // Only pull when at top
    startY.current = e.touches[0].clientY
    setPulling(true)
  }, [])

  const handleTouchMove = useCallback((e) => {
    if (!pulling || refreshing) return
    const diff = e.touches[0].clientY - startY.current
    if (diff < 0) { setPullDistance(0); return }
    const distance = Math.min(diff * 0.5, MAX_PULL) // Dampened
    setPullDistance(distance)
  }, [pulling, refreshing])

  const handleTouchEnd = useCallback(async () => {
    if (!pulling) return
    if (pullDistance >= THRESHOLD && onRefresh) {
      setRefreshing(true)
      try { await onRefresh() } catch (e) { /* swallow */ }
      setRefreshing(false)
    }
    setPulling(false)
    setPullDistance(0)
  }, [pulling, pullDistance, onRefresh])

  if (!isMobile) return children

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className={styles.indicator}
        style={{
          height: pullDistance,
          opacity: Math.min(pullDistance / THRESHOLD, 1),
        }}
      >
        <span className={refreshing ? styles.spinning : ''}>
          {refreshing ? '↻' : pullDistance >= THRESHOLD ? '↓ Release' : '↓ Pull'}
        </span>
      </div>
      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: pulling ? 'none' : 'transform 0.3s ease',
        }}
      >
        {children}
      </div>
    </div>
  )
}
