import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { Spinner } from './components/ui/ui'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ExplorerPage = lazy(() => import('./pages/ExplorerPage'))
const TerrainPage = lazy(() => import('./pages/TerrainPage'))
const SpacecraftPage = lazy(() => import('./pages/SpacecraftPage'))
const SimulationPage = lazy(() => import('./pages/SimulationPage'))
const OrbitalPage = lazy(() => import('./pages/OrbitalPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const DataSourcesPage = lazy(() => import('./pages/DataSourcesPage'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-6"><Spinner label="Loading…" /></div>}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<DashboardPage />} />
            <Route path="explorer" element={<ExplorerPage />} />
            <Route path="terrain" element={<TerrainPage />} />
            <Route path="spacecraft" element={<SpacecraftPage />} />
            <Route path="simulation" element={<SimulationPage />} />
            <Route path="orbital" element={<OrbitalPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="data" element={<DataSourcesPage />} />
            <Route path="*" element={<div className="p-6 text-sm text-muted">Page not found.</div>} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
