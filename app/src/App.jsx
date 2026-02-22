import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import MorningWire from './pages/MorningWire'
import Traders from './pages/Traders'
import Screener from './pages/Screener'
import OptionsFlow from './pages/OptionsFlow'
import PostMarket from './pages/PostMarket'
import ModelBook from './pages/ModelBook'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/morning-wire" element={<MorningWire />} />
          <Route path="/traders" element={<Traders />} />
          <Route path="/screener" element={<Screener />} />
          <Route path="/options-flow" element={<OptionsFlow />} />
          <Route path="/post-market" element={<PostMarket />} />
          <Route path="/model-book" element={<ModelBook />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
