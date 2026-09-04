import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import {
  fetchProfiles,
  updateProfile,
  inviteUser,
  fetchAllChannels,
  createChannel,
  updateChannel,
  deleteChannel,
} from '../lib/settings.js'
import { fetchCalConfig, saveCalConfig } from '../lib/calendar.js'
import { fileToAvatarDataUrl } from '../lib/image.js'
import { toast } from '../lib/toast.js'
import Button from '../components/Button.jsx'
import Modal from '../components/Modal.jsx'
import Avatar from '../components/Avatar.jsx'

function readErr(e) {
  const m = e?.message || String(e)
  if (/avatar_url/i.test(m) && /(column|schema cache|does not exist|Could not find)/i.test(m)) {
    return "'avatar_url' 칸이 없습니다. supabase/migrations/0017_profile_avatar.sql 을 실행한 뒤 새로고침하세요."
  }
  if (/does not exist|Could not find the table|schema cache/i.test(m)) {
    return 'DB 테이블이 없습니다. supabase/migrations/0010_profiles.sql 을 SQL Editor에서 실행하세요.'
  }
  return m
}

function AvatarPicker({ profile, editable, size = 34, onSaved }) {
  const [busy, setBusy] = useState(false)
  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      const row = await updateProfile(profile.id, { avatar_url: dataUrl })
      onSaved(row)
      toast('사진을 저장했어요', 'ok')
    } catch (err) {
      toast(readErr(err), 'warn')
    } finally {
      setBusy(false)
    }
  }
  async function clearPhoto(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const row = await updateProfile(profile.id, { avatar_url: null })
      onSaved(row)
    } catch (err) {
      toast(readErr(err), 'warn')
    } finally {
      setBusy(false)
    }
  }
  const av = (
    <Avatar name={profile.name} email={profile.email} url={profile.avatar_url} size={size} />
  )
  if (!editable) return av
  return (
    <span className={'avatar-pick' + (busy ? ' busy' : '')}>
      <label className="avatar-pick-label" title="사진 변경">
        {av}
        <span className="avatar-cam" aria-hidden>
          ＋
        </span>
        <input type="file" accept="image/*" hidden onChange={pick} disabled={busy} />
      </label>
      {profile.avatar_url && (
        <button type="button" className="avatar-clear" onClick={clearPhoto} title="사진 삭제">
          ✕
        </button>
      )}
    </span>
  )
}

export default function Settings() {
  const { user, profile, isAdmin, reloadProfile } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [channels, setChannels] = useState([])
  const [calUrl, setCalUrl] = useState('')
  const [calSaved, setCalSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [myName, setMyName] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [ps, chs, cfg] = await Promise.all([
          fetchProfiles(),
          fetchAllChannels().catch(() => []),
          fetchCalConfig().catch(() => null),
        ])
        setProfiles(ps)
        setChannels(chs)
        setCalUrl(cfg || '')
        setCalSaved(cfg || '')
      } catch (e) {
        setErr(readErr(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    setMyName(profile?.name || user?.user_metadata?.name || '')
  }, [profile, user])

  function onAvatarSaved(row) {
    setProfiles((ps) => ps.map((p) => (p.id === row.id ? row : p)))
    if (row.id === profile?.id) reloadProfile()
  }

  async function saveMyName() {
    if (!profile) return
    const row = await updateProfile(profile.id, { name: myName.trim() || null })
    setProfiles((ps) => ps.map((p) => (p.id === row.id ? row : p)))
    reloadProfile()
    toast('저장했어요', 'ok')
  }
  async function setRole(p, role) {
    const row = await updateProfile(p.id, { role })
    setProfiles((ps) => ps.map((x) => (x.id === row.id ? row : x)))
    toast('역할을 변경했어요', 'ok')
  }
  async function renameProfile(p, name) {
    if (name.trim() === (p.name || '')) return
    const row = await updateProfile(p.id, { name: name.trim() || null })
    setProfiles((ps) => ps.map((x) => (x.id === row.id ? row : x)))
  }

  async function addCh(name) {
    const row = await createChannel(name.trim(), channels.length + 1)
    setChannels((c) => [...c, row])
    toast('채널을 추가했어요', 'ok')
  }
  async function renameCh(c, name) {
    if (!name.trim() || name === c.name) return
    const row = await updateChannel(c.id, { name: name.trim() })
    setChannels((cs) => cs.map((x) => (x.id === row.id ? row : x)))
  }
  async function removeCh(c) {
    await deleteChannel(c.id)
    setChannels((cs) => cs.filter((x) => x.id !== c.id))
    toast('채널을 삭제했어요', 'ok')
  }

  async function saveCal() {
    await saveCalConfig(calUrl.trim() || null)
    setCalSaved(calUrl.trim())
    toast('캘린더 주소를 저장했어요', 'ok')
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-row">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <h1 className="page-title">설정</h1>
      <p className="page-desc">
        {isAdmin ? '팀원 · 채널 · 연동을 관리합니다.' : '내 정보를 확인하고 수정합니다.'}
      </p>
      {err && <div className="banner-error">{err}</div>}

      <div className="settings-stack">
        <section className="set-card">
          <h2>내 정보</h2>
          <div className="me-box">
            {profile ? (
              <AvatarPicker profile={profile} editable size={46} onSaved={onAvatarSaved} />
            ) : (
              <Avatar name={myName} email={user?.email} size={46} />
            )}
            <div className="me-main">
              <div className="me-name-row">
                <input
                  className="mini-input flex1"
                  value={myName}
                  placeholder="이름"
                  onChange={(e) => setMyName(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="btn-outline"
                  onClick={saveMyName}
                  disabled={(myName.trim() || '') === (profile?.name || '')}
                >
                  저장
                </Button>
              </div>
              <p className="me-sub">
                {user?.email}
                <span className={'role-badge' + (profile?.role === 'admin' ? ' adm' : '')}>
                  {profile?.role === 'admin' ? '관리자' : '팀원'}
                </span>
              </p>
            </div>
          </div>
        </section>

        <section className="set-card">
          <div className="set-card-head">
            <h2>
              팀원 <span className="cnt">{profiles.length}</span>
            </h2>
            {isAdmin && (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                ＋ 팀원 추가
              </Button>
            )}
          </div>
          <div className="member-list">
            {profiles.map((p) => {
              const self = p.id === profile?.id
              return (
                <div className="member-row" key={p.id}>
                  <AvatarPicker
                    profile={p}
                    editable={isAdmin || self}
                    size={36}
                    onSaved={onAvatarSaved}
                  />
                  <div className="m-main">
                    {isAdmin && !self ? (
                      <input
                        className="mini-input m-name-input"
                        defaultValue={p.name || ''}
                        placeholder="이름"
                        onBlur={(e) => renameProfile(p, e.target.value)}
                      />
                    ) : (
                      <span className="m-name">
                        {p.name || '(이름 없음)'}
                        {self && <span className="m-you">나</span>}
                      </span>
                    )}
                    <span className="m-email">{p.email}</span>
                  </div>
                  {isAdmin && !self ? (
                    <select
                      className="mini-input role-sel"
                      value={p.role}
                      onChange={(e) => setRole(p, e.target.value)}
                    >
                      <option value="member">팀원</option>
                      <option value="admin">관리자</option>
                    </select>
                  ) : (
                    <span className={'role-badge' + (p.role === 'admin' ? ' adm' : '')}>
                      {p.role === 'admin' ? '관리자' : '팀원'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {!isAdmin && (
            <p className="hint-sm" style={{ marginTop: 10 }}>
              팀원 추가·역할 변경은 관리자만 할 수 있어요.
            </p>
          )}
        </section>

        {isAdmin && (
          <section className="set-card">
            <div className="set-card-head">
              <h2>
                가격 비교 채널 <span className="cnt">{channels.length}</span>
              </h2>
            </div>
            <div className="ch-list">
              {channels.map((c) => (
                <div className="ch-row" key={c.id}>
                  <input
                    className="ch-name"
                    defaultValue={c.name}
                    onBlur={(e) => renameCh(c, e.target.value)}
                  />
                  <ConfirmInline
                    label="삭제"
                    warn="이 채널의 제품 가격·이력이 함께 삭제됩니다."
                    onConfirm={() => removeCh(c)}
                  />
                </div>
              ))}
            </div>
            <AddInline placeholder="채널 이름 (예: 11번가)" onAdd={addCh} />
          </section>
        )}

        {isAdmin && (
          <section className="set-card">
            <h2>구글 캘린더 연동</h2>
            <div className="fld">
              <label className="field-label">iCal 주소 (.ics)</label>
              <input
                className="field-input"
                value={calUrl}
                onChange={(e) => setCalUrl(e.target.value)}
                placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              />
            </div>
            <div className="set-row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
              <Button size="sm" onClick={saveCal} disabled={calUrl.trim() === (calSaved || '').trim()}>
                저장
              </Button>
              <p className="hint-sm" style={{ flex: 1 }}>
                일정 화면이 이 캘린더를 불러옵니다. 공개 캘린더면 공개 주소, 비공개면 캘린더 설정의 "비공개 iCal 주소".
              </p>
            </div>
          </section>
        )}
      </div>

      {inviteOpen && (
        <InviteModal
          onDone={() => {
            setInviteOpen(false)
            fetchProfiles().then(setProfiles).catch(() => {})
          }}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </div>
  )
}

function ConfirmInline({ label, warn, onConfirm }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!open)
    return (
      <button className="link-danger" onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  return (
    <span className="confirm-inline">
      <span>{warn}</span>
      <button
        className="link-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onConfirm()
          } catch (e) {
            toast(e.message || '실패', 'warn')
            setBusy(false)
          }
        }}
      >
        삭제
      </button>
      <button className="link-muted" onClick={() => setOpen(false)}>
        취소
      </button>
    </span>
  )
}

function AddInline({ placeholder, onAdd }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="add-inline"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!v.trim()) return
        setBusy(true)
        try {
          await onAdd(v)
          setV('')
        } catch (e2) {
          toast(e2.message || '실패', 'warn')
        } finally {
          setBusy(false)
        }
      }}
    >
      <input className="mini-input" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
      <Button size="sm" variant="ghost" className="btn-outline" type="submit" loading={busy}>
        추가
      </Button>
    </form>
  )
}

function InviteModal({ onDone, onClose }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!email.trim() || password.length < 8) {
      setErr('이메일과 8자 이상 비밀번호를 입력하세요.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await inviteUser({ email: email.trim(), password, name: name.trim() })
      setDone({ email: email.trim(), password })
    } catch (e2) {
      setErr(e2.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="팀원 추가"
      width={440}
      onClose={onClose}
      footer={
        done ? (
          <>
            <span className="spacer" />
            <Button onClick={onDone}>완료</Button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <Button variant="ghost" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" form="inviteform" loading={busy}>
              계정 생성
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="invite-done">
          <p>계정을 만들었어요. 아래 정보를 팀원에게 전달하세요.</p>
          <div className="cred">
            <b>이메일</b>
            <span>{done.email}</span>
          </div>
          <div className="cred">
            <b>비밀번호</b>
            <span>{done.password}</span>
          </div>
          <p className="hint-sm">팀원은 이 정보로 로그인하면 됩니다. 로그인 후 설정에서 이름을 확인할 수 있어요.</p>
        </div>
      ) : (
        <form id="inviteform" onSubmit={submit} className="form-col">
          <div className="fld">
            <label className="field-label">이메일</label>
            <input
              className="field-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div className="fld">
            <label className="field-label">이름</label>
            <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="fld">
            <label className="field-label">임시 비밀번호 (8자 이상)</label>
            <input
              className="field-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="팀원에게 전달할 비밀번호"
            />
          </div>
          {err && <p className="field-error">{err}</p>}
        </form>
      )}
    </Modal>
  )
}
