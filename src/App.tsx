import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './Layout'
import { AbilitiesPage } from './pages/AbilitiesPage'
import { CardsPage } from './pages/CardsPage'
import { DashboardPage } from './pages/DashboardPage'
import { DocumentPage } from './pages/DocumentPage'
import { RacesPage } from './pages/RacesPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="cards" element={<CardsPage />} />
          <Route path="abilities" element={<AbilitiesPage />} />
          <Route path="races" element={<RacesPage />} />
          <Route
            path="design-bible"
            element={<DocumentPage slug="design_bible" heading="Design Bible" />}
          />
          <Route path="rules" element={<DocumentPage slug="rulebook" heading="Rules" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
