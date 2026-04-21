import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PromptEditor from './components/PromptEditor.jsx'
import { getPrompt } from './lib/promptApi.js'
import { isImageFile } from './lib/isImageFile.js'
import { readEntry } from './lib/folderTraversal.js'
import { uploadFiles } from './lib/upload.js'
import { runQa } from './lib/runQa.js'
import './App.css'

function FileDropArea({
  label,
  accept,
  multiple = true,
  files,
  onFiles,
  allowFolder = false,
}) {
  const inputRef = useRef(null)
  const folderInputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (allowFolder && folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '')
      folderInputRef.current.setAttribute('directory', '')
    }
  }, [allowFolder])

  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault()
      setDragging(false)

      if (allowFolder && e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        const entries = []
        for (const item of e.dataTransfer.items) {
          const entry = item.webkitGetAsEntry?.()
          if (entry) entries.push(entry)
        }
        if (entries.length > 0) {
          const collected = []
          for (const entry of entries) {
            const files = await readEntry(entry)
            collected.push(...files)
          }
          const filtered = collected.filter(isImageFile)
          onFiles(filtered)
          return
        }
      }

      const dropped = Array.from(e.dataTransfer.files)
      const filtered = allowFolder ? dropped.filter(isImageFile) : dropped
      onFiles(filtered)
    },
    [onFiles, allowFolder],
  )

  const handleFolderPick = (e) => {
    const picked = Array.from(e.target.files)
    const filtered = picked.filter(isImageFile)
    onFiles(filtered)
    e.target.value = ''
  }

  return (
    <div
      className={`drop-area ${dragging ? 'drop-area--active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          onFiles(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
      {allowFolder && (
        <input
          ref={folderInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFolderPick}
        />
      )}
      <p className="drop-area__label">{label}</p>
      <p className="drop-area__hint">
        Click to browse or drag &amp; drop
        {allowFolder ? ' — folders are scanned recursively' : ''}
      </p>
      {allowFolder && (
        <button
          type="button"
          className="folder-button"
          onClick={(e) => {
            e.stopPropagation()
            folderInputRef.current?.click()
          }}
        >
          Select Folder
        </button>
      )}
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {f.relativePath || f.webkitRelativePath || f.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function makeJobId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function App() {
  const [editing, setEditing] = useState(false)
  const [csvFiles, setCsvFiles] = useState([])
  const [imageFiles, setImageFiles] = useState([])
  const [run, setRun] = useState(null)
  const [suggestion, setSuggestion] = useState('')
  const [suggestionHistory, setSuggestionHistory] = useState([])

  const resetRun = () => setRun(null)

  const addFiles = (setter) => (incoming) => {
    setter((prev) => [...prev, ...incoming])
  }

  const submitSuggestion = () => {
    const text = suggestion.trim()
    if (!text) return
    setSuggestionHistory((prev) => [
      ...prev,
      { role: 'user', text, at: new Date().toLocaleTimeString() },
      {
        role: 'ai',
        text: 'Got it — I\'ll update the prompt based on your suggestion. (AI integration not yet connected.)',
        at: new Date().toLocaleTimeString(),
      },
    ])
    setSuggestion('')
  }

  const beginQa = async () => {
    if (imageFiles.length === 0) return
    const jobId = makeJobId()
    setRun({
      jobId,
      phase: 'uploading',
      statusCheck: null,
      perImage: [],
      batchFindings: [],
      missing: [],
      shareUrl: null,
      error: null,
    })
    try {
      const [{ content: prompt }, imageUploads, csvUploads] = await Promise.all([
        getPrompt(),
        uploadFiles({ jobId, kind: 'images', files: imageFiles }),
        uploadFiles({ jobId, kind: 'csvs', files: csvFiles }),
      ])

      const imageUrls = imageUploads.filter((u) => u.url).map((u) => u.url)
      const csvUrls = csvUploads.filter((u) => u.url).map((u) => u.url)

      setRun((r) => ({ ...r, phase: 'running' }))

      await runQa({
        jobId,
        prompt,
        imageUrls,
        csvUrls,
        onEvent: (evt) => {
          setRun((r) => {
            if (!r) return r
            switch (evt.kind) {
              case 'status':
                return { ...r, statusCheck: evt }
              case 'image':
                return { ...r, perImage: [...r.perImage, evt] }
              case 'batch':
                return { ...r, batchFindings: evt.findings || [] }
              case 'missing':
                return { ...r, missing: [...r.missing, evt] }
              case 'persisted':
                return { ...r, shareUrl: `/run/${evt.jobId}` }
              case 'persist_error':
                return { ...r, error: `Persistence failed: ${evt.error}` }
              case 'done':
                return { ...r, phase: 'done' }
              default:
                return r
            }
          })
        },
      })
    } catch (err) {
      setRun((r) => ({ ...r, phase: 'error', error: err.message || String(err) }))
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <button className="prompt-button" onClick={() => setEditing(true)}>
          Edit QA Prompt
        </button>
        <div className="sidebar__section">
          <h3>Ask AI to change prompt</h3>
          {suggestionHistory.length > 0 && (
            <div className="chat-log">
              {suggestionHistory.map((m, i) => (
                <div key={i} className={`chat-msg chat-msg--${m.role}`}>
                  <span className="chat-msg__text">{m.text}</span>
                  <span className="chat-msg__time">{m.at}</span>
                </div>
              ))}
            </div>
          )}
          <textarea
            className="chat-input"
            placeholder="Example: Check headline text for typos"
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submitSuggestion()
              }
            }}
            rows={3}
          />
          <button
            className="chat-submit"
            onClick={submitSuggestion}
            disabled={!suggestion.trim()}
          >
            Submit
          </button>
        </div>
        <div className="sidebar__section">
          <h3>Upload CSV(s)</h3>
          <FileDropArea
            label="CSV files"
            accept=".csv,text/csv"
            files={csvFiles}
            onFiles={addFiles(setCsvFiles)}
          />
        </div>
      </aside>

      <main className="main">
        {run ? (
          <RunView run={run} onBack={resetRun} />
        ) : (
          <section className="main__section">
            <h2>Upload Images</h2>
            <FileDropArea
              label="Image files"
              accept="image/*"
              files={imageFiles}
              onFiles={addFiles(setImageFiles)}
              allowFolder
            />
            {imageFiles.length > 0 && (
              <button className="begin-qa" onClick={beginQa}>
                Begin QA ({imageFiles.length} image
                {imageFiles.length === 1 ? '' : 's'})
              </button>
            )}
          </section>
        )}
      </main>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div
            className="modal modal--tall"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__body">
              <PromptEditor onClose={() => setEditing(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function isMinor(finding) {
  return /minor/i.test(finding?.severity || '')
}

function RunView({ run, onBack }) {
  const [showMinor, setShowMinor] = useState(false)

  const filterFindings = (findings) =>
    showMinor ? findings : (findings || []).filter((f) => !isMinor(f))

  const visiblePerImage = useMemo(
    () =>
      run.perImage.map((r) => ({
        ...r,
        findings: filterFindings(r.findings),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.perImage, showMinor],
  )
  const visibleBatch = filterFindings(run.batchFindings)

  const hiddenCount =
    run.perImage.reduce(
      (n, r) => n + (r.findings || []).filter(isMinor).length,
      0,
    ) + (run.batchFindings || []).filter(isMinor).length

  return (
    <section className="main__section">
      <div className="results__header">
        <h2>QA Run</h2>
        <button onClick={onBack}>Back to Upload</button>
      </div>
      <p className="run-phase">
        {run.phase === 'uploading' && 'Uploading files…'}
        {run.phase === 'running' && 'Running QA checks…'}
        {run.phase === 'done' && 'Done.'}
        {run.phase === 'error' && `Error: ${run.error}`}
      </p>
      {run.shareUrl && (
        <p className="share-link">
          Share: <a href={run.shareUrl}>{run.shareUrl}</a>
        </p>
      )}
      {run.statusCheck && (
        <p>
          {run.statusCheck.imagesReceived} images · {run.statusCheck.csvRowCount}{' '}
          CSV rows
        </p>
      )}

      <label className="severity-toggle">
        <input
          type="checkbox"
          checked={showMinor}
          onChange={(e) => setShowMinor(e.target.checked)}
        />
        Show minor issues
        {!showMinor && hiddenCount > 0 && (
          <span className="severity-toggle__count"> ({hiddenCount} hidden)</span>
        )}
      </label>

      <h3>Per-image findings</h3>
      {visiblePerImage.length === 0 ? (
        <p>Waiting for results…</p>
      ) : (
        <ul className="results">
          {visiblePerImage.map((r, i) => (
            <li key={i} className="results__item">
              <div className="results__image">
                <img src={r.imageUrl} alt="" />
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
        <p>{run.phase === 'done' ? 'None.' : 'Waiting…'}</p>
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
      {run.missing.length === 0 ? (
        <p>{run.phase === 'done' ? 'All rows matched.' : 'Waiting…'}</p>
      ) : (
        <ul>
          {run.missing.map((m, i) => (
            <li key={i}>
              <strong>{m.customerName}</strong> (row {m.rowIndex}) — {m.issue}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
