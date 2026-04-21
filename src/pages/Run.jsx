import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import ImageLightbox, { MagnifierButton } from '../components/ImageLightbox.jsx'

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

  if (state.status === 'loading')
    return <div className="main"><section className="main__section">Loading run…</section></div>
  if (state.status === 'not_found')
    return (
      <div className="main">
        <section className="main__section">
          Run not found — no results for "{jobId}".
        </section>
      </div>
    )
  if (state.status === 'error')
    return <div className="main"><section className="main__section">Error loading run.</section></div>

  return <RunPageContent snapshot={state.data} />
}

function RunPageContent({ snapshot }) {
  const [showMinor, setShowMinor] = useState(false)
  const [showClean, setShowClean] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState(null)

  const filterFindings = (findings) =>
    showMinor ? findings : (findings || []).filter((f) => !isMinor(f))

  const allFiltered = useMemo(
    () =>
      snapshot.perImageResults.map((r) => ({
        ...r,
        findings: filterFindings(r.findings),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot.perImageResults, showMinor],
  )
  const visiblePerImage = showClean
    ? allFiltered
    : allFiltered.filter((r) => r.error || (r.findings && r.findings.length > 0))
  const visibleBatch = filterFindings(snapshot.batchFindings)
  const hiddenMinorCount =
    snapshot.perImageResults.reduce(
      (n, r) => n + (r.findings || []).filter(isMinor).length,
      0,
    ) + (snapshot.batchFindings || []).filter(isMinor).length
  const hiddenCleanCount = allFiltered.filter(
    (r) => !r.error && (!r.findings || r.findings.length === 0),
  ).length

  return (
    <div className="main">
      <section className="main__section">
        <div className="results__header">
          <h2>QA Run {snapshot.jobId}</h2>
        </div>
        <p className="run-phase">
          {snapshot.statusCheck.imagesReceived} images ·{' '}
          {snapshot.statusCheck.csvRowCount} CSV rows · created{' '}
          {new Date(snapshot.createdAt).toLocaleString()}
        </p>
        {snapshot.runError && (
          <div className="run-error">
            <strong>Run error ({snapshot.runError.kind}):</strong>{' '}
            {snapshot.runError.message}
            {snapshot.runError.raw && (
              <details>
                <summary>Raw model output (first 4 KB)</summary>
                <pre>{snapshot.runError.raw}</pre>
              </details>
            )}
          </div>
        )}

        <div className="filter-toggles">
          <label className="severity-toggle">
            <input
              type="checkbox"
              checked={showMinor}
              onChange={(e) => setShowMinor(e.target.checked)}
            />
            Show minor issues
            {!showMinor && hiddenMinorCount > 0 && (
              <span className="severity-toggle__count">
                {' '}
                ({hiddenMinorCount} hidden)
              </span>
            )}
          </label>
          <label className="severity-toggle">
            <input
              type="checkbox"
              checked={showClean}
              onChange={(e) => setShowClean(e.target.checked)}
            />
            Show clean images
            {!showClean && hiddenCleanCount > 0 && (
              <span className="severity-toggle__count">
                {' '}
                ({hiddenCleanCount} hidden)
              </span>
            )}
          </label>
        </div>

        <h3>Per-image findings</h3>
        {visiblePerImage.length === 0 ? (
          <p>No per-image findings.</p>
        ) : (
          <ul className="results">
            {visiblePerImage.map((r, i) => (
              <li key={i} className="results__item">
                <div className="results__image">
                  <img src={r.imageUrl} alt="" />
                  <MagnifierButton onClick={() => setLightboxSrc(r.imageUrl)} />
                </div>
                <div className="results__body">
                  {r.extractedLabel?.customerName && (
                    <span className="results__file">
                      {r.extractedLabel.customerName}
                    </span>
                  )}
                  {r.error ? (
                    <span className="results__issue">Error: {r.error}</span>
                  ) : r.findings?.length === 0 ? (
                    <span className="results__ok">No issues found ✓</span>
                  ) : (
                    <ul>
                      {r.findings.map((f, j) => (
                        <li key={j}>
                          <strong>{f.severity}</strong> {f.issue}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <h3>Batch-level findings</h3>
        {visibleBatch.length === 0 ? (
          <p>No batch-level issues.</p>
        ) : (
          <ul>
            {visibleBatch.map((f, i) => (
              <li key={i}>
                <strong>{f.severity}</strong> {f.issue}
              </li>
            ))}
          </ul>
        )}

        <h3>Missing designs</h3>
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

        <h3>Prompt snapshot</h3>
        <pre className="prompt-snapshot">{snapshot.prompt}</pre>

        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      </section>
    </div>
  )
}
