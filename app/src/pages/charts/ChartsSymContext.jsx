import { createContext, useContext } from 'react'

export const ChartsSymContext = createContext(null)

const FALLBACK = { sym: null, setSym: () => {} }

export function useChartsSym() {
  return useContext(ChartsSymContext) || FALLBACK
}
