import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import AppShell from './components/AppShell.jsx'
import Toaster from './components/Toaster.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Prices from './pages/Prices.jsx'
import Promos from './pages/Promos.jsx'
import Calendar from './pages/Calendar.jsx'
import Seeding from './pages/Seeding.jsx'
import Board from './pages/Board.jsx'
import Settings from './pages/Settings.jsx'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="screen-center">
        <div className="spinner" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const { user } = useAuth()
  return (
    <>
    <Toaster />
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/prices" element={<Prices />} />
        <Route path="/promos" element={<Promos />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/seeding" element={<Seeding />} />
        <Route path="/board" element={<Board />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
