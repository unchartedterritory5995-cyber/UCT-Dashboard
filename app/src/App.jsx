import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import MorningWire from './pages/MorningWire'
import UCT20 from './pages/UCT20'
import Breadth from './pages/Breadth'
import Traders from './pages/Traders'
import Screener from './pages/Screener'
import OptionsFlow from './pages/OptionsFlow'
import DarkPool from './pages/DarkPool'
import PostMarket from './pages/PostMarket'
import ModelBook from './pages/ModelBook'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/morning-wire" element={<MorningWire />} />
          <Route path="/uct-20" element={<UCT20 />} />
          <Route path="/breadth" element={<Breadth />} />
          <Route path="/traders" element={<Traders />} />
          <Route path="/screener" element={<Screener />} />
          <Route path="/options-flow" element={<OptionsFlow />} />
          <Route path="/dark-pool" element={<DarkPool />} />
          <Route path="/post-market" element={<PostMarket />} />
          <Route path="/model-book" element={<ModelBook />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
