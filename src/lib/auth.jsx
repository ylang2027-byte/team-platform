import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase.js'

const AuthContext = createContext(null)
const MOCK_KEY = 'tp_mock_user'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(u) {
    if (!u || !isSupabaseConfigured) {
      setProfile(null)
      return
    }
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', u.id).maybeSingle()
      setProfile(data || null)
    } catch {
      setProfile(null)
    }
  }

  useEffect(() => {
    if (isSupabaseConfigured) {
      supabase.auth.getSession().then(({ data }) => {
        const u = data.session?.user ?? null
        setUser(u)
        loadProfile(u)
        setLoading(false)
      })
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        const u = session?.user ?? null
        setUser(u)
        loadProfile(u)
      })
      return () => sub.subscription.unsubscribe()
    }

    // 데모 모드
    try {
      const raw = localStorage.getItem(MOCK_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {
      // ignore
    }
    setLoading(false)
  }, [])

  async function signIn(email, password) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(mapAuthError(error.message))
      return
    }

    // 데모 모드: 아무 이메일 + 4자 이상 비밀번호
    await new Promise((r) => setTimeout(r, 400))
    if (!email || !password) throw new Error('이메일과 비밀번호를 입력해 주세요.')
    if (password.length < 4) throw new Error('비밀번호는 4자 이상이어야 합니다.')
    const mockUser = {
      id: 'mock-' + email,
      email,
      user_metadata: { name: email.split('@')[0] },
      mock: true,
    }
    localStorage.setItem(MOCK_KEY, JSON.stringify(mockUser))
    setUser(mockUser)
  }

  async function signOut() {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut()
      return
    }
    localStorage.removeItem(MOCK_KEY)
    setUser(null)
  }

  const value = {
    user,
    profile,
    isAdmin: profile?.role === 'admin',
    loading,
    signIn,
    signOut,
    reloadProfile: () => loadProfile(user),
    isMock: !isSupabaseConfigured,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

function mapAuthError(message) {
  if (/Invalid login credentials/i.test(message)) return '이메일 또는 비밀번호가 올바르지 않습니다.'
  if (/Email not confirmed/i.test(message)) return '이메일 인증이 완료되지 않았습니다.'
  if (/network/i.test(message)) return '네트워크 연결을 확인해 주세요.'
  return message
}
