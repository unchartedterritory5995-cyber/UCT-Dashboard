import { useState, useEffect } from 'react'

/**
 * Returns market session state based on US stock market hours (ET timezone).
 * Updates every 60 seconds.
 *
 * @returns {{ isOpen: boolean, isPremarket: boolean, isExtended: boolean }}
 *   isOpen:      true during 9:30 AM - 4:00 PM ET, Mon-Fri
 *   isPremarket: true during 4:00 AM - 9:30 AM ET, Mon-Fri
 *   isExtended:  true during 4:00 PM - 8:00 PM ET, Mon-Fri
 */

function getMarketState() {
  const now = new Date()
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const et = new Date(etStr)

  const day = et.getDay() // 0=Sun, 6=Sat
  const hours = et.getHours()
  const minutes = et.getMinutes()
  const timeMinutes = hours * 60 + minutes // minutes since midnight ET

  const isWeekday = day >= 1 && day <= 5

  // Market hours in minutes since midnight ET
  const PRE_START = 4 * 60        // 4:00 AM
  const OPEN      = 9 * 60 + 30   // 9:30 AM
  const CLOSE     = 16 * 60       // 4:00 PM
  const EXT_END   = 20 * 60       // 8:00 PM

  return {
    isOpen:      isWeekday && timeMinutes >= OPEN && timeMinutes < CLOSE,
    isPremarket: isWeekday && timeMinutes >= PRE_START && timeMinutes < OPEN,
    isExtended:  isWeekday && timeMinutes >= CLOSE && timeMinutes < EXT_END,
  }
}

export default function useMarketOpen() {
  const [state, setState] = useState(getMarketState)

  useEffect(() => {
    const id = setInterval(() => {
      setState(getMarketState())
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  return state
}
