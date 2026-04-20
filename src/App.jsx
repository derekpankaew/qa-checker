import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import defaultPrompt from './defaultPrompt.md?raw'
import { isImageFile } from './lib/isImageFile.js'
import { readEntry } from './lib/folderTraversal.js'
import './App.css'

const DEFAULT_PROMPT = defaultPrompt

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

export default function App() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(DEFAULT_PROMPT)
  const [csvFiles, setCsvFiles] = useState([])
  const [imageFiles, setImageFiles] = useState([])
  const [showResults, setShowResults] = useState(false)
  const [suggestion, setSuggestion] = useState('')
  const [suggestionHistory, setSuggestionHistory] = useState([])

  const dummyIssues = [
    'Typo detected on cuff links. The text exceeds the length of the Illustrator file.',
    'The arrow is overlapping with the subhead text.',
  ]

  const dummyResults = useMemo(() => {
    if (!showResults) return []
    return imageFiles.slice(0, dummyIssues.length).map((file, i) => ({
      name: file.relativePath || file.webkitRelativePath || file.name,
      issue: dummyIssues[i],
      url: URL.createObjectURL(file),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResults, imageFiles])

  useEffect(() => {
    return () => {
      dummyResults.forEach((r) => URL.revokeObjectURL(r.url))
    }
  }, [dummyResults])

  const openEditor = () => {
    setDraft(prompt)
    setEditing(true)
  }

  const savePrompt = () => {
    setPrompt(draft)
    setEditing(false)
  }

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

  return (
    <div className="app">
      <aside className="sidebar">
        <button className="prompt-button" onClick={openEditor}>
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
        {showResults ? (
          <section className="main__section">
            <div className="results__header">
              <h2>QA Results</h2>
              <button onClick={() => setShowResults(false)}>Back to Upload</button>
            </div>
            <ul className="results">
              {dummyResults.map((r, i) => (
                <li key={i} className="results__item">
                  <div className="results__image">
                    <img src={r.url} alt={r.name} />
                  </div>
                  <div className="results__body">
                    <span className="results__file">{r.name}</span>
                    <span className="results__issue">{r.issue}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
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
              <button
                className="begin-qa"
                onClick={() => setShowResults(true)}
              >
                Begin QA ({imageFiles.length} image
                {imageFiles.length === 1 ? '' : 's'})
              </button>
            )}
          </section>
        )}
      </main>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>Edit QA Prompt</h2>
              <div className="modal__actions">
                <button onClick={() => setEditing(false)}>Cancel</button>
                <button className="primary" onClick={savePrompt}>
                  Save
                </button>
              </div>
            </div>
            <div data-color-mode="light" className="modal__body">
              <MDEditor value={draft} onChange={(v) => setDraft(v ?? '')} height={500} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
