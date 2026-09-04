import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { fetchTasks, createTask, updateTask, deleteTask, subscribeTasks } from '../lib/board.js'
import { toast } from '../lib/toast.js'
import Modal from '../components/Modal.jsx'
import Button from '../components/Button.jsx'
import TextField from '../components/TextField.jsx'

const CATS = [
  { id: 'mkt', label: '마케팅' },
  { id: 'order', label: '주문관리' },
  { id: 'ship', label: '배송' },
  { id: 'cs', label: 'CS' },
  { id: 'stock', label: '재고관리' },
  { id: 'promo', label: '기획전' },
  { id: 'etc', label: '기타' },
]
const COLS = [
  { id: 'todo', label: '할 일' },
  { id: 'doing', label: '진행 중' },
  { id: 'review', label: '검토' },
  { id: 'done', label: '완료' },
]
const catLabel = Object.fromEntries(CATS.map((c) => [c.id, c.label]))
const colIds = COLS.map((c) => c.id)
const FKEY = 'board-filters-v1'

function firstChar(s) {
  const a = Array.from(String(s || ''))
  return a.length ? a[0] : '?'
}
function dueMeta(iso, status) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = Math.round((due - now) / 86400000)
  const wd = ['일', '월', '화', '수', '목', '금', '토'][due.getDay()]
  let level = 'none'
  if (status !== 'done') {
    if (diff < 0) level = 'over'
    else if (diff <= 2) level = 'soon'
  }
  return { label: `${m}/${d} (${wd})`, level }
}
function orderBetween(before, after) {
  if (before == null && after == null) return Date.now()
  if (before == null) return after - 1
  if (after == null) return before + 1
  return (before + after) / 2
}

export default function Board() {
  const { user } = useAuth()
  const me = user?.user_metadata?.name || user?.email?.split('@')[0] || ''

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drawer, setDrawer] = useState(null)
  const [filters, setFilters] = useState(() => {
    try {
      return { cats: [], assignee: '', mineOnly: false, ...(JSON.parse(localStorage.getItem(FKEY)) || {}) }
    } catch {
      return { cats: [], assignee: '', mineOnly: false }
    }
  })
  const dragId = useRef(null)

  const load = useCallback(async () => {
    try {
      setTasks(await fetchTasks())
      setError('')
    } catch (e) {
      setError(readErr(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const unsub = subscribeTasks(() => load())
    return unsub
  }, [load])

  function saveFilters(next) {
    setFilters(next)
    try {
      localStorage.setItem(FKEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  const assignees = useMemo(
    () => [...new Set(tasks.map((t) => t.assignee).filter(Boolean))].sort(),
    [tasks],
  )

  function visible(t) {
    if (filters.cats.length && !filters.cats.includes(t.category)) return false
    if (filters.assignee && t.assignee !== filters.assignee) return false
    if (filters.mineOnly && me && t.assignee !== me) return false
    return true
  }
  const colTasks = (colId) =>
    tasks
      .filter((t) => t.status === colId && visible(t))
      .sort((a, b) => a.sort_order - b.sort_order)

  function applyLocal(row) {
    setTasks((ts) => {
      const i = ts.findIndex((t) => t.id === row.id)
      if (i === -1) return [...ts, row]
      const copy = ts.slice()
      copy[i] = row
      return copy
    })
  }

  async function moveTask(id, colId, beforeId) {
    const t = tasks.find((x) => x.id === id)
    if (!t) return
    const sibs = tasks
      .filter((x) => x.status === colId && x.id !== id)
      .sort((a, b) => a.sort_order - b.sort_order)
    const idx = beforeId ? sibs.findIndex((s) => s.id === beforeId) : sibs.length
    const pos = idx < 0 ? sibs.length : idx
    const order = orderBetween(sibs[pos - 1]?.sort_order, sibs[pos]?.sort_order)
    const patch = { status: colId, sort_order: order }
    if (colId === 'done' && t.status !== 'done') patch.done_at = new Date().toISOString()
    applyLocal({ ...t, ...patch })
    try {
      applyLocal(await updateTask(id, patch))
    } catch (e) {
      toast(readErr(e), 'warn')
      load()
    }
  }

  async function saveTask(values) {
    if (drawer.mode === 'edit') {
      const patch = { ...values }
      if (values.status === 'done' && drawer.task.status !== 'done') {
        patch.done_at = new Date().toISOString()
      }
      applyLocal(await updateTask(drawer.task.id, patch))
      toast('저장했어요', 'ok')
    } else {
      const maxOrder = Math.max(0, ...tasks.filter((t) => t.status === values.status).map((t) => t.sort_order))
      const row = await createTask({ ...values, sort_order: maxOrder + 1, created_by: me })
      applyLocal(row)
      toast('추가했어요', 'ok')
    }
    setDrawer(null)
  }

  async function removeTask() {
    const id = drawer.task.id
    setTasks((ts) => ts.filter((t) => t.id !== id))
    setDrawer(null)
    try {
      await deleteTask(id)
      toast('삭제했어요', 'ok')
    } catch (e) {
      toast(readErr(e), 'warn')
      load()
    }
  }

  function toggleCat(id) {
    const cats = filters.cats.includes(id)
      ? filters.cats.filter((c) => c !== id)
      : [...filters.cats, id]
    saveFilters({ ...filters, cats })
  }

  const hasFilter = filters.cats.length || filters.assignee || filters.mineOnly

  return (
    <div className="page board-page">
      <div className="page-head-row">
        <div>
          <h1 className="page-title">업무 보드</h1>
          <p className="page-desc">{tasks.length}개 업무 · 실시간 공유</p>
        </div>
        <div className="head-actions">
          <Button size="sm" onClick={() => setDrawer({ mode: 'new', status: 'todo' })}>
            ＋ 새 업무
          </Button>
        </div>
      </div>

      <div className="board-filters">
        <div className="chips">
          {CATS.map((c) => (
            <button
              key={c.id}
              className={'fchip' + (filters.cats.includes(c.id) ? ' on' : '')}
              onClick={() => toggleCat(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <select
          className="fsel"
          value={filters.assignee}
          onChange={(e) => saveFilters({ ...filters, assignee: e.target.value })}
        >
          <option value="">담당자 전체</option>
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button
          className={'fchip' + (filters.mineOnly ? ' on' : '')}
          onClick={() => {
            if (!me) return toast('로그인 정보에 이름이 없어요')
            saveFilters({ ...filters, mineOnly: !filters.mineOnly })
          }}
        >
          내 담당만
        </button>
        {hasFilter && (
          <button
            className="fchip clear"
            onClick={() => saveFilters({ cats: [], assignee: '', mineOnly: false })}
          >
            필터 해제
          </button>
        )}
      </div>

      {error && <div className="banner-error">{error}</div>}

      {loading ? (
        <div className="loading-row">
          <div className="spinner" />
        </div>
      ) : (
        <div className="kanban">
          {COLS.map((col) => {
            const items = colTasks(col.id)
            return (
              <section
                key={col.id}
                className="kcol"
                onDragOver={(e) => {
                  if (dragId.current) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const card = e.target.closest?.('.kcard')
                  const beforeId = card && card.dataset.id !== dragId.current ? card.dataset.id : null
                  if (dragId.current) moveTask(dragId.current, col.id, beforeId)
                  dragId.current = null
                }}
              >
                <header className="kcol-head">
                  <span className="kcol-name">{col.label}</span>
                  <span className="kcol-count">{items.length}</span>
                  <button
                    className="kcol-add"
                    aria-label={`${col.label}에 추가`}
                    onClick={() => setDrawer({ mode: 'new', status: col.id })}
                  >
                    ＋
                  </button>
                </header>
                <div className="kcol-body">
                  {items.map((t) => {
                    const dm = dueMeta(t.due_date, t.status)
                    return (
                      <article
                        key={t.id}
                        className="kcard"
                        data-id={t.id}
                        draggable
                        onDragStart={() => {
                          dragId.current = t.id
                        }}
                        onDragEnd={() => {
                          dragId.current = null
                        }}
                        onClick={() => setDrawer({ mode: 'edit', task: t })}
                      >
                        <div className="kcard-top">
                          <span className={'kcat kcat-' + t.category}>
                            <i />
                            {catLabel[t.category] || '기타'}
                          </span>
                          {t.priority === 'high' && <span className="kprio">높음</span>}
                        </div>
                        <p className="kcard-title">{t.title}</p>
                        <div className="kcard-foot">
                          {t.assignee ? (
                            <span className="kwho" title={t.assignee}>
                              {firstChar(t.assignee)}
                            </span>
                          ) : (
                            <span className="kwho none">·</span>
                          )}
                          {dm && <span className={'kdue ' + dm.level}>{dm.label}</span>}
                        </div>
                      </article>
                    )
                  })}
                  {items.length === 0 && <div className="kcol-empty">비어 있음</div>}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {drawer && (
        <TaskDrawer
          key={drawer.task?.id || 'new'}
          drawer={drawer}
          assignees={assignees}
          me={me}
          onSave={saveTask}
          onDelete={removeTask}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}

function TaskDrawer({ drawer, assignees, me, onSave, onDelete, onClose }) {
  const isNew = drawer.mode === 'new'
  const t = drawer.task
  const [title, setTitle] = useState(t?.title || '')
  const [notes, setNotes] = useState(t?.notes || '')
  const [category, setCategory] = useState(t?.category || 'mkt')
  const [assignee, setAssignee] = useState(t?.assignee ?? (isNew ? me : '') ?? '')
  const [priority, setPriority] = useState(t?.priority || 'normal')
  const [due, setDue] = useState(t?.due_date || '')
  const [status, setStatus] = useState(t?.status || drawer.status || 'todo')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!title.trim()) {
      setErr('제목을 입력하세요.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await onSave({
        title: title.trim(),
        notes: notes.trim() || null,
        category,
        assignee: assignee.trim() || null,
        priority,
        due_date: due || null,
        status,
      })
    } catch (e2) {
      setErr(readErr(e2))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isNew ? '새 업무' : '업무 편집'}
      onClose={onClose}
      footer={
        <>
          {!isNew &&
            (confirmDel ? (
              <Button variant="danger" onClick={onDelete} loading={busy}>
                정말 삭제
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDel(true)}>
                삭제
              </Button>
            ))}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="tform" loading={busy}>
            {isNew ? '추가' : '저장'}
          </Button>
        </>
      }
    >
      <form id="tform" onSubmit={submit} className="form-col">
        <div className="fld">
          <label className="field-label">제목</label>
          <textarea
            className="field-input ta"
            rows={2}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="무엇을 해야 하나요?"
            autoFocus
          />
        </div>
        <div className="fld">
          <label className="field-label">메모</label>
          <textarea
            className="field-input ta"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="세부 내용, 링크 등"
          />
        </div>
        <div className="fld-row">
          <div className="fld">
            <label className="field-label">구분</label>
            <select
              className="field-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="fld">
            <label className="field-label">담당자</label>
            <input
              className="field-input"
              list="assignee-list"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="이름"
            />
            <datalist id="assignee-list">
              {assignees.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="fld-row">
          <div className="fld">
            <label className="field-label">마감일</label>
            <input
              type="date"
              className="field-input"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
          <div className="fld">
            <label className="field-label">우선순위</label>
            <select
              className="field-input"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="normal">보통</option>
              <option value="high">높음</option>
            </select>
          </div>
        </div>
        <div className="fld">
          <label className="field-label">상태</label>
          <div className="segset">
            {COLS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={'seg' + (status === c.id ? ' on' : '')}
                onClick={() => setStatus(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        {err && <p className="field-error">{err}</p>}
      </form>
    </Modal>
  )
}

function readErr(e) {
  const m = e?.message || String(e)
  if (/does not exist/i.test(m) || /Could not find the table/i.test(m) || /schema cache/i.test(m)) {
    return 'DB 테이블이 없습니다. supabase/migrations/0006_board.sql 을 SQL Editor에서 실행하세요.'
  }
  if (/JWT|not authenticated/i.test(m)) return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
  return m
}
