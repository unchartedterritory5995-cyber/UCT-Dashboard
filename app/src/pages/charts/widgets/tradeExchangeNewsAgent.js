/**
 * UCT News <-> UCT Agent: the ONE seam (see TradeExchangeNewsAsk.jsx).
 *
 * `NewsAgentContext` carries `{ useAsk, openAgent }` -- UCT Agent's public News exports
 * (app/src/agent/newsAsk.js). The Ask box still renders only behind News's own admin +
 * Agent-switch gate; the server refuses everyone else whatever the browser shows.
 */
import { createContext } from 'react'
import { openAgent, useAgentAsk } from '../../../agent/newsAsk'

export const NewsAgentContext = createContext({ useAsk: useAgentAsk, openAgent })
