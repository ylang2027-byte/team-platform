import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import TextField from '../components/TextField.jsx'
import Button from '../components/Button.jsx'

export default function Login() {
  const { signIn, isMock } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      navigate('/')
    } catch (err) {
      setError(err.message || '로그인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <h1 className="auth-title">로그인</h1>
        <p className="auth-sub">팀 계정으로 로그인하세요</p>

        <form className="auth-form" onSubmit={onSubmit}>
          <TextField
            label="이메일"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <TextField
            label="비밀번호"
            type="password"
            autoComplete="current-password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="auth-error">{error}</p>}
          <Button type="submit" loading={loading}>
            로그인
          </Button>
        </form>

        {isMock && (
          <p className="auth-hint">
            지금은 데모 모드입니다.
            <br />
            아무 이메일과 4자 이상 비밀번호로 들어갈 수 있어요.
          </p>
        )}
      </div>
      <p className="auth-foot">로그인에 문제가 있으면 관리자에게 문의하세요</p>
    </div>
  )
}
