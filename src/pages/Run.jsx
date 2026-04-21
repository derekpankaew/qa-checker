import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

function isMinor(finding) {
  return /minor/i.test(finding?.severity || '')
}

export default function Run() {
  const { jobId } = useParams()
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/results/${jobId}`)
        if (res.status === 404) {
          if (!cancelled) setState({ status: 'not_found' })
          return
        }
        if (!res.ok) {
          if (!cancelled) setState({ status: 'error' })
          return
        }
        const data = await res.json()
        if (!cancelled) setState({ status: 'ready', data })
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [jobId])

  if (state.status === 'loading') return <div className="run-page">Loading run…</div>
  if (state.status === 'not_found')
    return <div className="run-page">Run not found — no results for "{jobId}".</div>
  if (state.status === 'error')
    return <div className="run-page">Error loading run.</div>

  const snapshot = state.data
  return <RunPageContent snapshot={snapshot} />
}

function RunPageContent({ snapshot }) {
  const [showMinor, setShowMinor] = useState(false)
  const filter = (findings) =>
    showMinor ? findings : (findings || []).filter((f) => !isMinor(f))

  const perImage = useMemo(
    () =>
      snapshot.perImageResults.map((r) => ({
        ...r,
        findings: filter(r.findings),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot.perImageResults, showMinor],
  )
  const batch = filter(snapshot.batchFindings)
  const hiddenCount =
    snapshot.perImageResults.reduce(
      (n, r) => n + (r.findings || []).filter(isMinor).length,
      0,
    ) + (snapshot.batchFindings || []).filter(isMinor).length

  return (
    <div className="run-page">
      <header className="run-page__header">
        <h1>QA Run {snapshot.jobId}</h1>
        <p className="run-page__meta">
          {snapshot.statusCheck.imagesReceived} images ·{' '}
          {snapshot.statusCheck.csvRowCount} CSV rows · created{' '}
          {new Date(snapshot.createdAt).toLocaleString()}
        </p>
        <label className="severity-toggle">
          <input
            type="checkbox"
            checked={showMinor}
            onChange={(e) => setShowMinor(e.target.checked)}
          />
          Show minor issues
          {!showMinor && hiddenCount > 0 && (
            <span className="severity-toggle__count">
              {' '}
              ({hiddenCount} hidden)
            </span>
          )}
        </label>
      </header>

      <section className="run-page__section">
        <h2>Per-image findings</h2>
        <ul className="run-page__list">
          {perImage.map((r, i) => (
            <li key={i} className="run-page__item">
              <div className="run-page__image">
                <img src={r.imageUrl} alt="" />
              </div>
              <div className="run-page__body">
                {r.extractedLabel?.customerName && (
                  <div className="run-page__customer">
                    {r.extractedLabel.customerName}
                  </div>
                )}
                {r.error ? (
                  <div className="run-page__error">Error: {r.error}</div>
                ) : r.findings.length === 0 ? (
                  <div className="run-page__ok">No issues found ✓</div>
                ) : (
                  <ul>
                    {r.findings.map((f, j) => (
                      <li key={j}>
                        <span className={`severity severity--${f.severity}`}>
                          {f.severity}
                        </span>{' '}
                        {f.issue}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="run-page__section">
        <h2>Batch-level findings</h2>
        {batch.length === 0 ? (
          <p>No batch-level issues.</p>
        ) : (
          <ul>
            {batch.map((f, i) => (
              <li key={i}>
                <span className={`severity severity--${f.severity}`}>
                  {f.severity}
                </span>{' '}
                {f.issue}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="run-page__section">
        <h2>Missing designs</h2>
        {snapshot.missingDesigns.length === 0 ? (
          <p>All CSV rows matched to a design.</p>
        ) : (
          <ul>
            {snapshot.missingDesigns.map((m, i) => (
              <li key={i}>
                <strong>{m.customerName}</strong> (row {m.rowIndex}) —{' '}
                {m.issue}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="run-page__section">
        <h2>Prompt snapshot</h2>
        <pre className="run-page__prompt">{snapshot.prompt}</pre>
      </section>
    </div>
  )
}
