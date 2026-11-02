/**
 * UCT News <-> UCT Agent: the ONE seam (see TradeExchangeNewsAsk.jsx).
 *
 * `NewsAgentContext` carries `{ useAsk, openAgent }` -- agent-lead's public exports
 * (`useAgentAsk`, `openAgent` from app/src/agent) once they exist. Null until then, so
 * News renders no Ask box and imports nothing from the Agent but its feature switch.
 */
import { createContext } from 'react'

export const NewsAgentContext = createContext(null)
