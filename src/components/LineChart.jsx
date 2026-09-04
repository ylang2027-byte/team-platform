// 가벼운 다중 선형 차트 (SVG, 의존성 없음)
// series: [{ name, color, points: [{ x: number(ms), y: number }] }]
export default function LineChart({
  series,
  height = 190,
  compact = false,
  yFormat = (v) => v,
  xFormat = (v) => v,
}) {
  const W = 480
  const H = height
  const pad = compact ? { l: 44, r: 8, t: 8, b: 18 } : { l: 56, r: 12, t: 10, b: 22 }

  const all = series.flatMap((s) => s.points)
  if (all.length < 2) {
    return <p className="chart-empty">{compact ? '이력 부족' : '가격 이력이 아직 부족해요. 며칠 쌓이면 그래프가 그려집니다.'}</p>
  }

  const xs = all.map((p) => p.x)
  const ys = all.map((p) => p.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  let yMin = Math.min(...ys)
  let yMax = Math.max(...ys)
  const span = yMax - yMin
  const yPad = span ? span * 0.12 : yMax * 0.1 || 1000
  yMin = Math.max(0, yMin - yPad)
  yMax += yPad

  const sx = (x) => pad.l + (xMax === xMin ? 0.5 : (x - xMin) / (xMax - xMin)) * (W - pad.l - pad.r)
  const sy = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b)

  const ticks = compact ? 3 : 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + (i / ticks) * (yMax - yMin))
  const xTicks = compact ? [xMin, xMax] : [xMin, (xMin + xMax) / 2, xMax]

  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} className="chart-grid" />
            <text x={pad.l - 8} y={sy(t) + 3.5} className="chart-ylabel">
              {yFormat(Math.round(t))}
            </text>
          </g>
        ))}
        {series.map((s) =>
          s.points.length >= 2 ? (
            <polyline
              key={s.name}
              points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="1.7"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}
        {series.map((s) => {
          const last = s.points[s.points.length - 1]
          return last ? (
            <circle key={s.name + 'd'} cx={sx(last.x)} cy={sy(last.y)} r="2.8" fill={s.color} />
          ) : null
        })}
        {xTicks.map((x, i) => (
          <text
            key={i}
            x={sx(x)}
            y={H - 6}
            className="chart-xlabel"
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {xFormat(x)}
          </text>
        ))}
      </svg>
      {!compact && (
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
