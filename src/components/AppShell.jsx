import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import NotifBar from './NotifBar.jsx'
import Avatar from './Avatar.jsx'

const NAV = [
  { to: '/calendar', label: '일정' },
  { to: '/prices', label: '가격 비교' },
  { to: '/promos', label: '기획전' },
  { to: '/seeding', label: '시딩' },
]

export default function AppShell() {
  const { user, profile, signOut, isMock } = useAuth()
  const navigate = useNavigate()
  const name = profile?.name || user?.user_metadata?.name || user?.email || ''

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="shell">
      <header className="topnav">
        {isMock && <div className="devbar">데모 모드 · Supabase 연결 전이라 로그인·데이터가 임시로 동작합니다</div>}
        <div className="topnav-inner">
          <nav className="nav">
            <NavLink
              to="/"
              end
              className={({ isActive }) => (isActive ? 'nav-home active' : 'nav-home')}
              aria-label="대시보드"
              title="대시보드"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
                <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </NavLink>
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="topnav-right">
            {!isMock && (
              <Avatar name={name} email={user?.email} url={profile?.avatar_url} size={24} />
            )}
            <span className="user-name">{name}</span>
            <NavLink
              to="/settings"
              className={({ isActive }) => (isActive ? 'icon-link active' : 'icon-link')}
              aria-label="설정"
              title="설정"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </NavLink>
            <button className="icon-link" onClick={handleSignOut} aria-label="로그아웃" title="로그아웃">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <NotifBar />
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
