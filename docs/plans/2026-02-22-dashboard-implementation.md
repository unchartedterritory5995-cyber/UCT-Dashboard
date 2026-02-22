# Dashboard Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the static Morning Wire HTML with a live React + FastAPI bento-box dashboard where Morning Wire is one tab among several.

**Architecture:** FastAPI backend (Python) serves both the React SPA and all data endpoints. React frontend (Vite) uses React Router for tab navigation and SWR for live polling. Existing engine code stays intact — FastAPI wraps it.

**Tech Stack:** React 18, React Router v6, Vite 5, SWR, Vitest, React Testing Library, FastAPI, uvicorn, pytest, httpx

**Design doc:** `docs/plans/2026-02-22-dashboard-redesign.md`

---

## Phase 1: Project Bootstrap

### Task 1: Install Python and Node dependencies

**Step 1: Install FastAPI and test deps**

```bash
pip install fastapi==0.115.6 pytest==8.3.4 pytest-asyncio==0.24.0
```

Expected: installs cleanly. (uvicorn 0.41.0, httpx 0.28.1, python-dotenv 1.2.1 already installed.)

**Step 2: Scaffold the `api/` directory**

```bash
mkdir -p api/routers api/services
touch api/__init__.py api/routers/__init__.py api/services/__init__.py
```

**Step 3: Commit**

```bash
git add api/
git commit -m "chore: scaffold api/ directory"
```

---

### Task 2: FastAPI entry point with health check

**Files:**
- Create: `api/main.py`
- Create: `tests/api/test_health.py`

**Step 1: Write the failing test**

Create `tests/__init__.py`, `tests/api/__init__.py`, then:

```python
# tests/api/test_health.py
import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app

@pytest.mark.asyncio
async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
```

**Step 2: Run to confirm it fails**

```bash
pytest tests/api/test_health.py -v
```
Expected: `ModuleNotFoundError: No module named 'api.main'`

**Step 3: Write minimal implementation**

```python
# api/main.py
from fastapi import FastAPI

app = FastAPI(title="UCT Dashboard")

@app.get("/api/health")
def health():
    return {"status": "ok"}
```

**Step 4: Add pytest config**

```ini
# pytest.ini
[pytest]
asyncio_mode = auto
```

**Step 5: Run test to verify pass**

```bash
pytest tests/api/test_health.py -v
```
Expected: `PASSED`

**Step 6: Commit**

```bash
git add api/main.py tests/ pytest.ini
git commit -m "feat: FastAPI entry point with health endpoint"
```

---

### Task 3: Scaffold React + Vite frontend

**Step 1: Create the app**

```bash
npm create vite@latest app -- --template react
cd app && npm install
npm install react-router-dom swr
npm install -D vitest @vitest/ui @testing-library/react @testing-library/jest-dom jsdom
```

**Step 2: Configure Vitest in `app/vite.config.js`**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000'
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.js'
  }
})
```

**Step 3: Create test setup**

```js
// app/src/test-setup.js
import '@testing-library/jest-dom'
```

**Step 4: Write a smoke test**

```jsx
// app/src/App.test.jsx
import { render, screen } from '@testing-library/react'
import App from './App'

test('renders without crashing', () => {
  render(<App />)
  expect(document.body).toBeTruthy()
})
```

**Step 5: Run frontend tests**

```bash
cd app && npx vitest run
```
Expected: `PASS`

**Step 6: Update `.gitignore`** — add `app/node_modules/` and `app/dist/`

**Step 7: Commit**

```bash
git add app/ .gitignore
git commit -m "feat: scaffold React + Vite frontend with Vitest"
```

---

### Task 4: Wire FastAPI to serve the React build

**Files:**
- Modify: `api/main.py`

**Step 1: Add static file serving to `api/main.py`**

```python
# api/main.py
import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI(title="UCT Dashboard")

@app.get("/api/health")
def health():
    return {"status": "ok"}

# Serve React build — must come after all /api routes
DIST = os.path.join(os.path.dirname(__file__), "..", "app", "dist")
if os.path.exists(DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        return FileResponse(os.path.join(DIST, "index.html"))
```

**Step 2: Verify health test still passes**

```bash
pytest tests/api/test_health.py -v
```
Expected: `PASSED`

**Step 3: Commit**

```bash
git add api/main.py
git commit -m "feat: FastAPI serves React SPA build"
```

---

## Phase 2: App Shell

### Task 5: UCT CSS variables and base styles

**Files:**
- Create: `app/src/styles/tokens.css`
- Modify: `app/src/index.css`

**Step 1: Extract UCT design tokens** — copy all `:root` CSS variables from `ut_morning_wire_template.html` lines 10–21 into `tokens.css`. Also copy font imports (Instrument Sans, IBM Plex Mono, Cinzel, Bebas Neue) and `*` reset.

```css
/* app/src/styles/tokens.css */
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&family=Cinzel:wght@700;800;900&family=Bebas+Neue&display=swap');

:root {
  --ut-green:#2d8c4e;--ut-green-bright:#3cb868;--ut-green-dim:#2d8c4e18;--ut-green-glow:#2d8c4e40;
  --ut-red:#c0392b;--ut-red-bright:#e74c3c;--ut-red-dim:#c0392b18;
  --ut-gold:#c9a84c;--ut-gold-dim:#c9a84c15;--ut-gold-glow:#c9a84c35;
  --ut-cream:#d4c9a8;
  --bg:#0e0f0d;--bg-surface:#1a1c17;--bg-elevated:#22251e;--bg-hover:#2a2d24;
  --border:#2e3127;--border-accent:#3a3d32;
  --text:#a8a290;--text-muted:#706b5e;--text-bright:#e0dac8;--text-heading:#f0ead8;
  --gain:#3cb868;--gain-bg:#3cb86815;--gain-border:#3cb86835;
  --loss:#e74c3c;--loss-bg:#e74c3c15;--loss-border:#e74c3c35;
  --warn:#c9a84c;--warn-bg:#c9a84c15;--warn-border:#c9a84c35;
  --info:#6ba3be;--info-bg:#6ba3be12;--info-border:#6ba3be30;
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Instrument Sans', -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
```

**Step 2: Import in `app/src/index.css`**

```css
@import './styles/tokens.css';
```

**Step 3: Commit**

```bash
git add app/src/styles/ app/src/index.css
git commit -m "feat: UCT design tokens and base styles"
```

---

### Task 6: App layout shell with React Router

**Files:**
- Create: `app/src/components/Layout.jsx`
- Create: `app/src/components/Layout.module.css`
- Modify: `app/src/App.jsx`
- Create: `app/src/components/Layout.test.jsx`

**Step 1: Write the failing test**

```jsx
// app/src/components/Layout.test.jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Layout from './Layout'

test('renders nav and main content area', () => {
  render(
    <MemoryRouter>
      <Layout><div data-testid="content">hello</div></Layout>
    </MemoryRouter>
  )
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByTestId('content')).toBeInTheDocument()
})
```

**Step 2: Run to confirm fail**

```bash
cd app && npx vitest run src/components/Layout.test.jsx
```

**Step 3: Implement Layout**

```jsx
// app/src/components/Layout.jsx
import { Outlet } from 'react-router-dom'
import NavBar from './NavBar'
import styles from './Layout.module.css'

export default function Layout({ children }) {
  return (
    <div className={styles.shell}>
      <NavBar />
      <main className={styles.main}>
        {children ?? <Outlet />}
      </main>
    </div>
  )
}
```

```css
/* app/src/components/Layout.module.css */
.shell {
  display: flex;
  min-height: 100vh;
}
.main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
```

**Step 4: Wire App.jsx with routes**

```jsx
// app/src/App.jsx
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
```

**Step 5: Create stub page files** (each is just a placeholder `<div>` for now):

```bash
mkdir -p app/src/pages
# Create Dashboard.jsx, MorningWire.jsx, Traders.jsx, Screener.jsx,
# OptionsFlow.jsx, PostMarket.jsx, ModelBook.jsx
# Each exports: export default function PageName() { return <div>PageName</div> }
```

**Step 6: Run tests**

```bash
cd app && npx vitest run
```

**Step 7: Commit**

```bash
git add app/src/
git commit -m "feat: app shell with React Router and stub pages"
```

---

### Task 7: NavBar component

**Files:**
- Create: `app/src/components/NavBar.jsx`
- Create: `app/src/components/NavBar.module.css`
- Create: `app/src/components/NavBar.test.jsx`

**Step 1: Write failing test**

```jsx
// app/src/components/NavBar.test.jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NavBar from './NavBar'

test('renders all nav links', () => {
  render(<MemoryRouter><NavBar /></MemoryRouter>)
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /morning wire/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /traders/i })).toBeInTheDocument()
})
```

**Step 2: Run to confirm fail**

```bash
cd app && npx vitest run src/components/NavBar.test.jsx
```

**Step 3: Implement NavBar**

```jsx
// app/src/components/NavBar.jsx
import { NavLink } from 'react-router-dom'
import styles from './NavBar.module.css'

const NAV_ITEMS = [
  { to: '/dashboard',    label: 'Dashboard',    icon: '⊞' },
  { to: '/morning-wire', label: 'Morning Wire',  icon: '📰' },
  { to: '/traders',      label: 'Traders',       icon: '👥' },
  { to: '/screener',     label: 'Screener',      icon: '⚡' },
  { to: '/options-flow', label: 'Options Flow',  icon: '📊' },
  { to: '/post-market',  label: 'Post Market',   icon: '🌙' },
  { to: '/model-book',   label: 'Model Book',    icon: '📖' },
]

export default function NavBar() {
  return (
    <nav data-testid="nav-sidebar" className={styles.nav}>
      <div className={styles.brand}>UCT</div>
      {NAV_ITEMS.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `${styles.item} ${isActive ? styles.active : ''}`
          }
          title={item.label}
        >
          <span className={styles.icon}>{item.icon}</span>
          <span className={styles.label}>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
```

```css
/* app/src/components/NavBar.module.css */
.nav {
  width: 60px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
  transition: width 0.2s;
}
.nav:hover {
  width: 200px;
  align-items: flex-start;
}
.brand {
  font-family: 'Cinzel', serif;
  font-size: 13px;
  font-weight: 700;
  color: var(--ut-green-bright);
  letter-spacing: 3px;
  margin-bottom: 24px;
  padding: 0 18px;
  white-space: nowrap;
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 18px;
  color: var(--text-muted);
  text-decoration: none;
  font-size: 12px;
  font-weight: 500;
  transition: color 0.15s, background 0.15s;
  white-space: nowrap;
}
.item:hover { color: var(--text-bright); background: var(--bg-hover); }
.active { color: var(--ut-green-bright) !important; }
.icon { font-size: 16px; flex-shrink: 0; width: 24px; text-align: center; }
.label { opacity: 0; transition: opacity 0.15s; }
.nav:hover .label { opacity: 1; }
```

**Step 4: Run tests**

```bash
cd app && npx vitest run src/components/NavBar.test.jsx
```

**Step 5: Commit**

```bash
git add app/src/components/NavBar.jsx app/src/components/NavBar.module.css app/src/components/NavBar.test.jsx
git commit -m "feat: NavBar with icon-only collapse and hover expand"
```

---

### Task 8: MoversSidebar component

**Files:**
- Create: `app/src/components/MoversSidebar.jsx`
- Create: `app/src/components/MoversSidebar.module.css`
- Create: `app/src/components/MoversSidebar.test.jsx`

**Step 1: Write failing test**

```jsx
// app/src/components/MoversSidebar.test.jsx
import { render, screen } from '@testing-library/react'
import MoversSidebar from './MoversSidebar'

const mockData = {
  ripping: [{ sym: 'RNG', pct: '+34.40%' }],
  drilling: [{ sym: 'GRND', pct: '-50.55%' }]
}

test('renders ripping and drilling sections', () => {
  render(<MoversSidebar data={mockData} />)
  expect(screen.getByText('RIPPING')).toBeInTheDocument()
  expect(screen.getByText('DRILLING')).toBeInTheDocument()
  expect(screen.getByText('RNG')).toBeInTheDocument()
  expect(screen.getByText('GRND')).toBeInTheDocument()
})

test('renders loading state when no data', () => {
  render(<MoversSidebar data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})
```

**Step 2: Run to confirm fail**

```bash
cd app && npx vitest run src/components/MoversSidebar.test.jsx
```

**Step 3: Implement**

```jsx
// app/src/components/MoversSidebar.jsx
import useSWR from 'swr'
import styles from './MoversSidebar.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function MoversSidebar({ data: propData }) {
  const { data: fetched } = useSWR(
    propData ? null : '/api/movers',
    fetcher,
    { refreshInterval: 30000 }
  )
  const data = propData ?? fetched

  if (!data) return <aside className={styles.sidebar}><p className={styles.loading}>Loading…</p></aside>

  return (
    <aside className={styles.sidebar}>
      <div className={styles.title}>MOVERS AT THE OPEN</div>
      <Section label="▲ RIPPING" items={data.ripping} positive />
      <Section label="▼ DRILLING" items={data.drilling} positive={false} />
    </aside>
  )
}

function Section({ label, items, positive }) {
  return (
    <div>
      <div className={`${styles.sectionLabel} ${positive ? styles.green : styles.red}`}>
        {label}
      </div>
      {items.map(item => (
        <div key={item.sym} className={styles.row}>
          <span className={styles.sym}>{item.sym}</span>
          <span className={`${styles.pct} ${positive ? styles.green : styles.red}`}>
            {item.pct}
          </span>
        </div>
      ))}
    </div>
  )
}
```

```css
/* app/src/components/MoversSidebar.module.css */
.sidebar {
  width: 250px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  padding: 14px 12px;
  overflow-y: auto;
  height: 100vh;
  position: sticky;
  top: 0;
}
.title {
  font-family: 'Cinzel', serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 3px;
  color: var(--text-muted);
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.sectionLabel {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 2px;
  margin: 12px 0 6px;
}
.row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.sym { font-family: 'IBM Plex Mono', monospace; color: var(--ut-cream); font-weight: 600; }
.pct { font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 11px; }
.green { color: var(--gain); }
.red { color: var(--loss); }
.loading { color: var(--text-muted); font-size: 12px; }
```

**Step 4: Add MoversSidebar to Dashboard layout** — edit `app/src/pages/Dashboard.jsx`:

```jsx
import MoversSidebar from '../components/MoversSidebar'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  return (
    <div className={styles.page}>
      <div className={styles.grid}>
        {/* tiles go here */}
        <p style={{color:'var(--text-muted)',padding:'20px'}}>Dashboard tiles coming soon…</p>
      </div>
      <MoversSidebar />
    </div>
  )
}
```

```css
/* app/src/pages/Dashboard.module.css */
.page { display: flex; }
.grid { flex: 1; padding: 20px; min-width: 0; }
```

**Step 5: Run all tests**

```bash
cd app && npx vitest run
```

**Step 6: Commit**

```bash
git add app/src/
git commit -m "feat: MoversSidebar with SWR polling and Dashboard page scaffold"
```

---

## Phase 3: FastAPI Data Endpoints

### Task 9: Cache service

**Files:**
- Create: `api/services/cache.py`
- Create: `tests/api/test_cache.py`

**Step 1: Write failing test**

```python
# tests/api/test_cache.py
import time
from api.services.cache import TTLCache

def test_set_and_get():
    c = TTLCache()
    c.set("key", {"v": 1}, ttl=10)
    assert c.get("key") == {"v": 1}

def test_expired_returns_none():
    c = TTLCache()
    c.set("key", {"v": 1}, ttl=0.01)
    time.sleep(0.02)
    assert c.get("key") is None
```

**Step 2: Run to confirm fail**

```bash
pytest tests/api/test_cache.py -v
```

**Step 3: Implement**

```python
# api/services/cache.py
import time
from typing import Any

class TTLCache:
    def __init__(self):
        self._store: dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Any:
        if key not in self._store:
            return None
        value, expires_at = self._store[key]
        if time.time() > expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any, ttl: float) -> None:
        self._store[key] = (value, time.time() + ttl)

cache = TTLCache()
```

**Step 4: Run tests**

```bash
pytest tests/api/test_cache.py -v
```

**Step 5: Commit**

```bash
git add api/services/cache.py tests/api/test_cache.py
git commit -m "feat: TTL cache service"
```

---

### Task 10: /api/snapshot endpoint (live prices via Massive)

**Files:**
- Create: `api/services/massive.py`
- Create: `api/routers/snapshot.py`
- Modify: `api/main.py`
- Create: `tests/api/test_snapshot.py`

**Step 1: Write failing test**

```python
# tests/api/test_snapshot.py
import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app

MOCK_SNAPSHOT = {
    "futures": {"NQ": {"price": 25000.0, "chg": "+0.5%"},
                "ES": {"price": 6900.0, "chg": "+0.4%"},
                "RTY": {"price": 2600.0, "chg": "+0.2%"}},
    "etfs":    {"QQQ": {"price": 490.0, "chg": "+0.5%"},
                "SPY": {"price": 580.0, "chg": "+0.4%"},
                "BTC": {"price": 95000.0, "chg": "+1.2%"}}
}

@pytest.mark.asyncio
async def test_snapshot_returns_data():
    with patch("api.routers.snapshot.get_snapshot", return_value=MOCK_SNAPSHOT):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/snapshot")
    assert r.status_code == 200
    data = r.json()
    assert "futures" in data
    assert "etfs" in data
```

**Step 2: Run to confirm fail**

```bash
pytest tests/api/test_snapshot.py -v
```

**Step 3: Create massive service wrapper**

```python
# api/services/massive.py
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from massive_data import MassiveClient
from api.services.cache import cache

_client = None

def _get_client():
    global _client
    if _client is None:
        _client = MassiveClient()
    return _client

def get_snapshot() -> dict:
    cached = cache.get("snapshot")
    if cached:
        return cached
    client = _get_client()
    # MassiveClient returns snapshot with futures + ETF prices
    data = client.get_live_snapshot()
    cache.set("snapshot", data, ttl=10)
    return data

def get_movers() -> dict:
    cached = cache.get("movers")
    if cached:
        return cached
    client = _get_client()
    data = client.get_top_movers()
    cache.set("movers", data, ttl=30)
    return data
```

**Step 4: Create snapshot router**

```python
# api/routers/snapshot.py
from fastapi import APIRouter, HTTPException
from api.services.massive import get_snapshot

router = APIRouter()

@router.get("/api/snapshot")
def snapshot():
    try:
        return get_snapshot()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
```

**Step 5: Register router in `api/main.py`**

```python
from api.routers import snapshot
app.include_router(snapshot.router)
```

**Step 6: Run tests**

```bash
pytest tests/api/test_snapshot.py tests/api/test_health.py -v
```

**Step 7: Commit**

```bash
git add api/routers/snapshot.py api/services/massive.py api/main.py tests/api/test_snapshot.py
git commit -m "feat: /api/snapshot endpoint with Massive live prices"
```

---

### Task 11: /api/movers endpoint

**Files:**
- Create: `api/routers/movers.py`
- Create: `tests/api/test_movers.py`

**Step 1: Write failing test**

```python
# tests/api/test_movers.py
import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app

MOCK_MOVERS = {
    "ripping": [{"sym": "RNG", "pct": "+34.40%"}, {"sym": "TNDM", "pct": "+32.67%"}],
    "drilling": [{"sym": "GRND", "pct": "-50.55%"}, {"sym": "CCOI", "pct": "-29.36%"}]
}

@pytest.mark.asyncio
async def test_movers_structure():
    with patch("api.routers.movers.get_movers", return_value=MOCK_MOVERS):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/movers")
    assert r.status_code == 200
    data = r.json()
    assert "ripping" in data
    assert "drilling" in data
    assert data["ripping"][0]["sym"] == "RNG"
```

**Step 2: Implement router**

```python
# api/routers/movers.py
from fastapi import APIRouter, HTTPException
from api.services.massive import get_movers

router = APIRouter()

@router.get("/api/movers")
def movers():
    try:
        return get_movers()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
```

**Step 3: Register in `api/main.py`** — add `from api.routers import movers` and `app.include_router(movers.router)`

**Step 4: Run tests**

```bash
pytest tests/api/test_movers.py -v
```

**Step 5: Commit**

```bash
git add api/routers/movers.py tests/api/test_movers.py api/main.py
git commit -m "feat: /api/movers endpoint"
```

---

### Task 12: Engine data endpoints (breadth, themes, leadership, rundown)

**Files:**
- Create: `api/services/engine.py`
- Create: `api/routers/engine_data.py`
- Create: `tests/api/test_engine_data.py`

**Context:** `morning_wire_engine.py` has top-level functions: `fetch_breadth()`, `fetch_theme_tracker()`, `fetch_leadership()`, `fetch_market_regime(state)`, `load_state()`. These are called once at 7:35 AM and their results written to `morning_wire_state.json`. For the API, we wrap them with a 1-hour TTL cache.

**Step 1: Write failing tests**

```python
# tests/api/test_engine_data.py
import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app

@pytest.mark.asyncio
async def test_breadth_endpoint():
    mock = {"pct_above_50ma": 62.4, "pct_above_200ma": 55.1, "advancing": 227, "declining": 148}
    with patch("api.routers.engine_data.get_breadth", return_value=mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/breadth")
    assert r.status_code == 200
    assert "pct_above_50ma" in r.json()

@pytest.mark.asyncio
async def test_themes_endpoint():
    mock = {"leaders": [{"name": "Silver Miners", "pct": "+11.47%"}], "laggards": []}
    with patch("api.routers.engine_data.get_themes", return_value=mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/themes")
    assert r.status_code == 200
    assert "leaders" in r.json()
```

**Step 2: Create engine service**

```python
# api/services/engine.py
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

import morning_wire_engine as eng
from api.services.cache import cache

def get_breadth() -> dict:
    cached = cache.get("breadth")
    if cached: return cached
    data = eng.fetch_breadth()
    cache.set("breadth", data, ttl=3600)
    return data

def get_themes() -> dict:
    cached = cache.get("themes")
    if cached: return cached
    data = eng.fetch_theme_tracker()
    cache.set("themes", data, ttl=3600)
    return data

def get_leadership() -> list:
    cached = cache.get("leadership")
    if cached: return cached
    state = eng.load_state()
    # leadership returns HTML — we need structured data
    # For now return from state.json if available, else empty list
    data = state.get("leadership_data", [])
    cache.set("leadership", data, ttl=3600)
    return data

def get_rundown() -> dict:
    cached = cache.get("rundown")
    if cached: return cached
    state = eng.load_state()
    data = state.get("rundown_data", {"html": "", "date": ""})
    cache.set("rundown", data, ttl=3600)
    return data
```

**Step 3: Create router**

```python
# api/routers/engine_data.py
from fastapi import APIRouter, HTTPException
from api.services.engine import get_breadth, get_themes, get_leadership, get_rundown

router = APIRouter()

@router.get("/api/breadth")
def breadth():
    try: return get_breadth()
    except Exception as e: raise HTTPException(503, str(e))

@router.get("/api/themes")
def themes():
    try: return get_themes()
    except Exception as e: raise HTTPException(503, str(e))

@router.get("/api/leadership")
def leadership():
    try: return get_leadership()
    except Exception as e: raise HTTPException(503, str(e))

@router.get("/api/rundown")
def rundown():
    try: return get_rundown()
    except Exception as e: raise HTTPException(503, str(e))
```

**Step 4: Register router, run tests, commit**

```bash
pytest tests/api/test_engine_data.py -v
git add api/services/engine.py api/routers/engine_data.py tests/api/test_engine_data.py api/main.py
git commit -m "feat: breadth, themes, leadership, rundown endpoints"
```

---

### Task 13: /api/earnings, /api/news, /api/screener endpoints

**Files:**
- Create: `api/routers/earnings.py`
- Create: `api/routers/news.py`
- Create: `api/routers/screener.py`
- Create: `tests/api/test_misc_endpoints.py`

**Step 1: Write failing tests**

```python
# tests/api/test_misc_endpoints.py
import pytest
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from api.main import app

@pytest.mark.asyncio
async def test_news_returns_list():
    mock = [{"headline": "Test headline", "source": "Finnhub", "url": "http://x.com"}]
    with patch("api.routers.news.get_news", return_value=mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/news")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

@pytest.mark.asyncio
async def test_earnings_returns_dict():
    mock = {"bmo": [], "amc": []}
    with patch("api.routers.earnings.get_earnings", return_value=mock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.get("/api/earnings")
    assert r.status_code == 200
    assert "bmo" in r.json()
```

**Step 2: Implement each router** — each follows the same pattern as Task 11. The service functions wrap existing engine calls:
- `get_news()` → calls `eng.fetch_finviz_news()`, TTL 300s
- `get_earnings()` → reads from state.json `earnings_data` key, TTL 3600s
- `get_screener()` → imports `screener.py` and calls its main scoring function, TTL 900s

**Step 3: Run tests, register routers, commit**

```bash
pytest tests/api/test_misc_endpoints.py -v
git add api/routers/ tests/api/test_misc_endpoints.py api/main.py
git commit -m "feat: earnings, news, screener endpoints"
```

---

### Task 14: /api/traders and /api/trades endpoints

**Files:**
- Create: `api/routers/traders.py`
- Create: `api/routers/trades.py`
- Create: `tests/api/test_trades.py`

**Step 1: Write failing test**

```python
# tests/api/test_trades.py
import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app

@pytest.mark.asyncio
async def test_trades_get_returns_list():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/trades")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
```

**Step 2: Implement trades router** — reads/writes `morning_wire_state.json` trades key (or a separate `trades.json`):

```python
# api/routers/trades.py
import json, os
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()
TRADES_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "data", "trades.json")

def _load():
    if not os.path.exists(TRADES_FILE): return []
    with open(TRADES_FILE) as f: return json.load(f)

def _save(trades):
    os.makedirs(os.path.dirname(TRADES_FILE), exist_ok=True)
    with open(TRADES_FILE, "w") as f: json.dump(trades, f, indent=2)

class Trade(BaseModel):
    sym: str
    entry: float
    stop: float
    target: float
    size_pct: float
    notes: Optional[str] = ""

@router.get("/api/trades")
def get_trades():
    return _load()

@router.post("/api/trades")
def add_trade(trade: Trade):
    trades = _load()
    trades.append({**trade.model_dump(), "id": len(trades)+1, "status": "open"})
    _save(trades)
    return trades[-1]
```

**Step 3: Traders router** — serves watchlist data per trader (TSDR, Bracco, Qullamaggie, Manrav). For now reads from a `data/traders.json` config file:

```python
# api/routers/traders.py — returns list of trader objects with name, color, tickers
```

**Step 4: Run tests, commit**

```bash
pytest tests/api/test_trades.py -v
git add api/routers/traders.py api/routers/trades.py tests/api/test_trades.py api/main.py
git commit -m "feat: traders and trades CRUD endpoints"
```

---

## Phase 4: Dashboard Tiles

### Task 15: TileCard shared component

**Files:**
- Create: `app/src/components/TileCard.jsx`
- Create: `app/src/components/TileCard.module.css`
- Create: `app/src/components/TileCard.test.jsx`

**Step 1: Write failing test**

```jsx
// app/src/components/TileCard.test.jsx
import { render, screen } from '@testing-library/react'
import TileCard from './TileCard'

test('renders title and children', () => {
  render(<TileCard title="Market Breadth"><span>content</span></TileCard>)
  expect(screen.getByText('Market Breadth')).toBeInTheDocument()
  expect(screen.getByText('content')).toBeInTheDocument()
})
```

**Step 2: Implement**

```jsx
// app/src/components/TileCard.jsx
import styles from './TileCard.module.css'

export default function TileCard({ title, badge, children, className = '' }) {
  return (
    <div className={`${styles.tile} ${className}`}>
      {title && (
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          {badge && <span className={styles.badge}>{badge}</span>}
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  )
}
```

```css
/* app/src/components/TileCard.module.css */
.tile {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  position: relative;
}
.tile::before {
  content: '';
  position: absolute;
  top: 10px; bottom: 10px; left: 0;
  width: 2px;
  background: linear-gradient(180deg, var(--ut-green), var(--ut-gold), var(--ut-green));
  opacity: 0.3;
  border-radius: 2px;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 12px 18px;
  border-bottom: 1px solid var(--border);
}
.title {
  font-family: 'Cinzel', serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: var(--text-bright);
}
.badge {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 8px;
  font-weight: 600;
  padding: 2px 8px;
  letter-spacing: 1px;
  border-radius: 8px;
  background: var(--gain-bg);
  color: var(--gain);
  border: 1px solid var(--gain-border);
}
.body { padding: 14px 16px 14px 18px; }
```

**Step 3: Run tests, commit**

```bash
cd app && npx vitest run src/components/TileCard.test.jsx
git add app/src/components/TileCard.jsx app/src/components/TileCard.module.css app/src/components/TileCard.test.jsx
git commit -m "feat: TileCard shared component"
```

---

### Task 16: FuturesStrip tile

**Files:**
- Create: `app/src/components/tiles/FuturesStrip.jsx`
- Create: `app/src/components/tiles/FuturesStrip.module.css`
- Create: `app/src/components/tiles/FuturesStrip.test.jsx`

**Step 1: Write failing test**

```jsx
// app/src/components/tiles/FuturesStrip.test.jsx
import { render, screen } from '@testing-library/react'
import FuturesStrip from './FuturesStrip'

const mockData = {
  futures: {
    NQ: { price: '25,039.75', chg: '+0.54%', css: 'pos' },
    ES: { price: '6,909.50', chg: '+0.22%', css: 'pos' },
  },
  etfs: {
    QQQ: { price: '495.79', chg: '+0.50%', css: 'pos' },
    VIX: { price: '19.62', chg: '-3.30%', css: 'neg' },
  }
}

test('renders futures tickers', () => {
  render(<FuturesStrip data={mockData} />)
  expect(screen.getByText('NQ')).toBeInTheDocument()
  expect(screen.getByText('25,039.75')).toBeInTheDocument()
  expect(screen.getByText('QQQ')).toBeInTheDocument()
})
```

**Step 2: Implement**

```jsx
// app/src/components/tiles/FuturesStrip.jsx
import useSWR from 'swr'
import styles from './FuturesStrip.module.css'

const fetcher = url => fetch(url).then(r => r.json())
const FUTURES_ORDER = ['NQ', 'ES', 'RTY', 'BTC']
const ETF_ORDER = ['QQQ', 'SPY', 'IWM', 'DIA', 'VIX']

export default function FuturesStrip({ data: propData }) {
  const { data: fetched } = useSWR(propData ? null : '/api/snapshot', fetcher, { refreshInterval: 10000 })
  const data = propData ?? fetched
  if (!data) return <div className={styles.strip}><span className={styles.loading}>Loading prices…</span></div>

  return (
    <div className={styles.strip}>
      <div className={styles.row}>
        {FUTURES_ORDER.map(sym => {
          const d = data.futures?.[sym]
          if (!d) return null
          return <Cell key={sym} sym={sym} price={d.price} chg={d.chg} css={d.css} large />
        })}
      </div>
      <div className={`${styles.row} ${styles.etfRow}`}>
        {ETF_ORDER.map(sym => {
          const d = data.etfs?.[sym]
          if (!d) return null
          return <Cell key={sym} sym={sym} price={d.price} chg={d.chg} css={d.css} />
        })}
      </div>
    </div>
  )
}

function Cell({ sym, price, chg, css, large }) {
  return (
    <div className={`${styles.cell} ${large ? styles.large : styles.small}`}>
      <div className={styles.sym}>{sym}</div>
      <div className={styles.price}>{price}</div>
      <div className={`${styles.chg} ${css === 'pos' ? styles.pos : styles.neg}`}>{chg}</div>
    </div>
  )
}
```

**Step 3: Run tests, commit**

```bash
cd app && npx vitest run src/components/tiles/FuturesStrip.test.jsx
git add app/src/components/tiles/
git commit -m "feat: FuturesStrip tile with live SWR polling"
```

---

### Task 17: MarketBreadth tile

**Files:**
- Create: `app/src/components/tiles/MarketBreadth.jsx`
- Create: `app/src/components/tiles/MarketBreadth.module.css`
- Create: `app/src/components/tiles/MarketBreadth.test.jsx`

**Context:** Shows a gauge (semicircle) for overall breadth score, distribution day count, advancing/declining bar, % above 50/200 MA.

**Step 1: Write failing test**

```jsx
// app/src/components/tiles/MarketBreadth.test.jsx
import { render, screen } from '@testing-library/react'
import MarketBreadth from './MarketBreadth'

const mockData = {
  pct_above_50ma: 62.4,
  pct_above_200ma: 55.1,
  advancing: 227,
  declining: 148,
  distribution_days: 7,
  market_phase: 'Confirmed Uptrend'
}

test('renders breadth data', () => {
  render(<MarketBreadth data={mockData} />)
  expect(screen.getByText(/distribution days/i)).toBeInTheDocument()
  expect(screen.getByText('7')).toBeInTheDocument()
  expect(screen.getByText('227')).toBeInTheDocument()
})
```

**Step 2: Implement** — SVG semicircle gauge using CSS `conic-gradient` or SVG arc. No external chart library needed.

```jsx
// app/src/components/tiles/MarketBreadth.jsx
import useSWR from 'swr'
import TileCard from '../TileCard'
import styles from './MarketBreadth.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function Gauge({ value }) {
  // 0-100 score from pct_above_50ma
  const angle = (value / 100) * 180
  return (
    <div className={styles.gaugeWrap}>
      <svg viewBox="0 0 120 70" className={styles.gauge}>
        <path d="M10,65 A50,50 0 0,1 110,65" fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round"/>
        <path
          d="M10,65 A50,50 0 0,1 110,65"
          fill="none"
          stroke={value > 60 ? 'var(--gain)' : value > 40 ? 'var(--warn)' : 'var(--loss)'}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(value/100)*157} 157`}
        />
        <text x="60" y="62" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--text-heading)">{Math.round(value)}</text>
      </svg>
    </div>
  )
}

export default function MarketBreadth({ data: propData }) {
  const { data: fetched } = useSWR(propData ? null : '/api/breadth', fetcher)
  const data = propData ?? fetched
  if (!data) return <TileCard title="Market Breadth"><p className={styles.loading}>Loading…</p></TileCard>

  const score = (data.pct_above_50ma + data.pct_above_200ma) / 2

  return (
    <TileCard title="Market Breadth">
      <Gauge value={score} />
      <div className={styles.distRow}>
        <span className={styles.label}>Distribution Days:</span>
        <span className={styles.distVal} style={{color: data.distribution_days >= 5 ? 'var(--loss)' : 'var(--warn)'}}>
          {data.distribution_days}
        </span>
      </div>
      <div className={styles.adRow}>
        <span className={styles.advancing}>Advancing: <strong>{data.advancing}</strong></span>
        <span className={styles.declining}>Declining: <strong>{data.declining}</strong></span>
      </div>
      <div className={styles.maRow}>
        <span>50MA: <strong style={{color:'var(--gain)'}}>{data.pct_above_50ma?.toFixed(1)}%</strong></span>
        <span>200MA: <strong style={{color:'var(--info)'}}>{data.pct_above_200ma?.toFixed(1)}%</strong></span>
      </div>
    </TileCard>
  )
}
```

**Step 3: Run tests, commit**

```bash
cd app && npx vitest run src/components/tiles/MarketBreadth.test.jsx
git add app/src/components/tiles/MarketBreadth.jsx app/src/components/tiles/MarketBreadth.module.css app/src/components/tiles/MarketBreadth.test.jsx
git commit -m "feat: MarketBreadth tile with SVG gauge"
```

---

### Task 18: ThemeTracker tile

**Files:**
- Create: `app/src/components/tiles/ThemeTracker.jsx`
- Create: `app/src/components/tiles/ThemeTracker.module.css`
- Create: `app/src/components/tiles/ThemeTracker.test.jsx`

**Step 1: Write failing test**

```jsx
// app/src/components/tiles/ThemeTracker.test.jsx
import { render, screen } from '@testing-library/react'
import ThemeTracker from './ThemeTracker'

const mockData = {
  leaders: [
    { name: 'Silver Miners', pct: '+11.47%', bar: 85 },
    { name: 'Junior Gold Miners', pct: '+9.82%', bar: 73 },
  ],
  laggards: [
    { name: 'Bitcoin Miners', pct: '-3.13%', bar: 25 },
  ]
}

test('renders leaders and laggards', () => {
  render(<ThemeTracker data={mockData} />)
  expect(screen.getByText('Silver Miners')).toBeInTheDocument()
  expect(screen.getByText('Bitcoin Miners')).toBeInTheDocument()
})

test('renders period tabs', () => {
  render(<ThemeTracker data={mockData} />)
  expect(screen.getByRole('button', { name: '1W' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '1M' })).toBeInTheDocument()
})
```

**Step 2: Implement** — horizontal bar chart rows with period tab switcher (1W/1M/3M). Fetches `/api/themes?period=1W`.

**Step 3: Run tests, commit**

```bash
git add app/src/components/tiles/ThemeTracker.*
git commit -m "feat: ThemeTracker tile with period tabs and horizontal bars"
```

---

### Task 19: CatalystFlow, EpisodicPivots, KeyLevels, NewsFeed tiles

Same pattern as above tasks. Each tile:
1. Write failing test for structure + data rendering
2. Implement component with SWR fetch from its endpoint
3. Run tests
4. Commit individually

**CatalystFlow** — table from `/api/earnings`: columns Ticker, Expected EPS, Reported, Surprise %, mini sparkline chart.

**EpisodicPivots** — grid of mini stock cards from `/api/leadership` top 4: symbol, price, % change, small Finviz chart on click.

**KeyLevels** — single Finviz chart embed (user-selectable ticker via click from EpisodicPivots or search input).

**NewsFeed** — scrollable list from `/api/news` (every 5 min): headline, source, time ago. Max 8 items.

Each commit:
```bash
git commit -m "feat: [TileName] tile"
```

---

### Task 20: Dashboard grid layout

**Files:**
- Modify: `app/src/pages/Dashboard.jsx`
- Modify: `app/src/pages/Dashboard.module.css`

**Step 1: Assemble all tiles into the grid**

```jsx
// app/src/pages/Dashboard.jsx
import FuturesStrip from '../components/tiles/FuturesStrip'
import MarketBreadth from '../components/tiles/MarketBreadth'
import ThemeTracker from '../components/tiles/ThemeTracker'
import CatalystFlow from '../components/tiles/CatalystFlow'
import EpisodicPivots from '../components/tiles/EpisodicPivots'
import KeyLevels from '../components/tiles/KeyLevels'
import NewsFeed from '../components/tiles/NewsFeed'
import MoversSidebar from '../components/MoversSidebar'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <div className={styles.futuresRow}><FuturesStrip /></div>
        <div className={styles.row2}>
          <div className={styles.breadthCol}><MarketBreadth /></div>
          <div className={styles.themeCol}><ThemeTracker /></div>
        </div>
        <div className={styles.row3}>
          <CatalystFlow />
          <EpisodicPivots />
          <KeyLevels />
          <NewsFeed />
        </div>
      </div>
      <MoversSidebar />
    </div>
  )
}
```

```css
/* app/src/pages/Dashboard.module.css */
.page { display: flex; height: 100vh; overflow: hidden; }
.content { flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.futuresRow { width: 100%; }
.row2 { display: grid; grid-template-columns: 30fr 70fr; gap: 12px; }
.breadthCol, .themeCol {}
.row3 { display: grid; grid-template-columns: 30fr 25fr 25fr 20fr; gap: 12px; }

@media (max-width: 1200px) {
  .row2 { grid-template-columns: 1fr; }
  .row3 { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 700px) {
  .row3 { grid-template-columns: 1fr; }
}
```

**Step 2: Smoke test — run the dev server to verify visually**

```bash
# Terminal 1: start FastAPI
uvicorn api.main:app --reload --port 8000

# Terminal 2: start React dev server
cd app && npm run dev
```

Visit `http://localhost:5173` — confirm bento grid renders.

**Step 3: Commit**

```bash
git add app/src/pages/Dashboard.jsx app/src/pages/Dashboard.module.css
git commit -m "feat: Dashboard bento grid layout with all tiles assembled"
```

---

## Phase 5: Other Pages

### Task 21: Morning Wire page

**Files:**
- Modify: `app/src/pages/MorningWire.jsx`

**Step 1:** This page fetches `/api/rundown` and renders the HTML content returned by the engine. It mirrors the current accordion structure but inside the new app shell.

```jsx
// app/src/pages/MorningWire.jsx
import useSWR from 'swr'
import TileCard from '../components/TileCard'

const fetcher = url => fetch(url).then(r => r.json())

export default function MorningWire() {
  const { data } = useSWR('/api/rundown', fetcher)

  return (
    <div style={{ padding: '20px', maxWidth: '960px' }}>
      <TileCard title="The Rundown">
        {data?.html
          ? <div dangerouslySetInnerHTML={{ __html: data.html }} />
          : <p style={{ color: 'var(--text-muted)' }}>Loading rundown…</p>
        }
      </TileCard>
      {/* Additional sections: Positioning, Wire, Leadership 20, Watchlist */}
      {/* Each section fetches its own endpoint and renders into a TileCard */}
    </div>
  )
}
```

**Step 2: Write test**

```jsx
test('renders rundown section', async () => {
  // mock /api/rundown → { html: '<p>test</p>' }
  // assert 'test' appears in document
})
```

**Step 3: Commit**

```bash
git commit -m "feat: Morning Wire page with accordion sections"
```

---

### Task 22: Traders, Screener, Post Market, Model Book, Options Flow pages

Same pattern — each page fetches its endpoint and renders the data:

- **Traders** — grid of trader cards, each with watchlist tickers + live prices from `/api/traders` + `/api/snapshot`
- **Screener** — sortable table from `/api/screener` with RS/Vol/Mom columns
- **Post Market** — same structure as Morning Wire but for `/api/rundown?type=post_market`
- **Model Book** — table from `/api/trades` with Add Trade form using `POST /api/trades`
- **Options Flow** — `<TileCard title="Options Flow"><p>Coming soon</p></TileCard>`

Each committed individually:

```bash
git commit -m "feat: Traders page"
git commit -m "feat: Screener page"
git commit -m "feat: Post Market page"
git commit -m "feat: Model Book page with trade log"
git commit -m "feat: Options Flow placeholder"
```

---

## Phase 6: Engine Integration & Deployment

### Task 23: Update morning_wire_engine.py to write structured data files

**Context:** The engine currently generates HTML. The API needs structured JSON. We need the engine to write structured data alongside HTML so FastAPI can serve it.

**Files:**
- Modify: `morning_wire_engine.py` (minimal change — add JSON save at end of run)
- Create: `data/wire_data.json` (written by engine, read by API)

**Step 1:** At the end of `run()` in `morning_wire_engine.py`, add:

```python
# After building all data, save structured JSON for the API
import json, os
wire_data = {
    "date": today_iso(),
    "rundown_html": rundown_html,
    "leadership": leadership_data,   # already a list of dicts
    "themes": theme_data,
    "earnings": {"bmo": bmo_rows, "amc": amc_rows},
}
os.makedirs("data", exist_ok=True)
with open("data/wire_data.json", "w") as f:
    json.dump(wire_data, f, indent=2)
```

**Step 2:** Update `api/services/engine.py` to read from `data/wire_data.json` instead of calling engine functions live (faster, no blocking calls on API requests).

**Step 3: Run existing engine tests, verify no regression**

```bash
python morning_wire_engine.py --dry-run  # if dry-run flag exists
pytest tests/ -v
```

**Step 4: Commit**

```bash
git commit -m "feat: engine writes wire_data.json for API consumption"
```

---

### Task 24: Railway deployment

**Files:**
- Create: `railway.json`
- Create: `Procfile`
- Modify: `app/vite.config.js` (set base URL for production)

**Step 1: Create Railway config**

```json
// railway.json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pip install -r requirements.txt && cd app && npm install && npm run build"
  },
  "deploy": {
    "startCommand": "uvicorn api.main:app --host 0.0.0.0 --port $PORT",
    "healthcheckPath": "/api/health"
  }
}
```

**Step 2: Create requirements.txt** (if not already present) — pin all Python deps:

```
fastapi==0.115.6
uvicorn==0.41.0
httpx==0.28.1
python-dotenv==1.2.1
requests
yfinance
pandas
anthropic
boto3
```

**Step 3: Set environment variables in Railway dashboard** — copy all keys from `.env`

**Step 4: Update Discord posting** — in `morning_wire_engine.py`, change `VERCEL_SITE_URL` references to the Railway URL (`https://your-app.railway.app`). Or better: add a `DASHBOARD_URL` env var and use that.

**Step 5: Deploy**

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
railway link   # link to existing Railway project
railway up     # deploy
```

**Step 6: Verify**

```bash
curl https://your-app.railway.app/api/health
# Expected: {"status":"ok"}
```

**Step 7: Commit**

```bash
git add railway.json Procfile requirements.txt
git commit -m "chore: Railway deployment config"
```

---

### Task 25: Finviz hover popup and chart modal (port from existing template)

**Files:**
- Create: `app/src/components/TickerPopup.jsx`

**Context:** The existing template has a sophisticated Finviz hover popup and click modal for charts. Port this JS logic into a React component.

**Step 1:** Create `TickerPopup` component — renders a floating `<img>` from `finviz.com/chart.ashx?t={sym}` on hover, full modal on click.

**Step 2:** Wrap any `<span>` with ticker data in `<TickerPopup sym="NVDA">NVDA</TickerPopup>`.

**Step 3: Commit**

```bash
git commit -m "feat: Finviz ticker hover popup and chart modal"
```

---

## Testing Checklist Before Declaring Done

```bash
# All Python tests pass
pytest tests/ -v

# All React tests pass
cd app && npx vitest run

# Dev server runs cleanly
uvicorn api.main:app --port 8000 &
cd app && npm run dev

# Production build works
cd app && npm run build
uvicorn api.main:app --port 8000  # serves built React app

# Health check
curl http://localhost:8000/api/health

# All API endpoints respond
curl http://localhost:8000/api/snapshot
curl http://localhost:8000/api/movers
curl http://localhost:8000/api/breadth
curl http://localhost:8000/api/themes
curl http://localhost:8000/api/news
curl http://localhost:8000/api/leadership
curl http://localhost:8000/api/trades
```

---

## What Is NOT In This Plan

- **Options Flow** data source — placeholder only, wire in when feed is acquired
- **Post Market Recap** AI generation — same pattern as Morning Wire, add when needed
- **Mobile-specific breakpoints** — responsive grid handles basics, fine-tune after desktop is solid
- **Authentication** — single-user local/Railway deploy, no auth needed now
