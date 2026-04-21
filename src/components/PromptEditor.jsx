import { useEffect, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/nord.css'
import defaultPrompt from '../defaultPrompt.md?raw'
import { getPrompt, savePrompt } from '../lib/promptApi.js'

export default function PromptEditor({ onClose }) {
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState('visual')
  const [content, setContent] = useState('')
  const [etag, setEtag] = useState(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)

  const visualRootRef = useRef(null)
  const crepeRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    getPrompt()
      .then((res) => {
        if (cancelled) return
        setContent(res.content || '')
        setEtag(res.etag || null)
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setContent(defaultPrompt)
        setEtag('default')
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!loaded || mode !== 'visual') return
    const root = visualRootRef.current
    if (!root) return
    const crepe = new Crepe({ root, defaultValue: content })
    crepeRef.current = crepe
    const creating = crepe.create()
    return () => {
      crepeRef.current = null
      Promise.resolve(creating).finally(() => {
        try {
          crepe.destroy()
        } catch {
          /* already gone */
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, mode])

  const currentMarkdown = () => {
    if (mode === 'visual' && crepeRef.current) {
      try {
        return crepeRef.current.getMarkdown()
      } catch {
        return content
      }
    }
    return content
  }

  const toggleMode = () => {
    const latest = currentMarkdown()
    setContent(latest)
    setMode((m) => (m === 'visual' ? 'source' : 'visual'))
  }

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    const payload = currentMarkdown()
    setContent(payload)
    try {
      const res = await savePrompt({ content: payload, ifMatch: etag })
      setEtag(res.etag)
      setStatus({ kind: 'saved' })
    } catch (err) {
      if (err.code === 'conflict') {
        setStatus({
          kind: 'conflict',
          message:
            'Conflict: prompt was modified elsewhere. Your draft is preserved.',
        })
      } else {
        setStatus({ kind: 'error', message: err.message || 'Save failed' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="prompt-editor">
      <div className="prompt-editor__toolbar">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !loaded}
          className="prompt-editor__btn prompt-editor__btn--primary"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={toggleMode}
          disabled={!loaded}
          className="prompt-editor__btn"
        >
          {mode === 'visual' ? 'Edit source' : 'Edit visual'}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="prompt-editor__btn"
          >
            Close
          </button>
        )}
        <div className="prompt-editor__status-wrap">
          {status?.kind === 'saved' && (
            <span className="prompt-editor__status">Saved ✓</span>
          )}
          {status?.kind === 'conflict' && (
            <span className="prompt-editor__status prompt-editor__status--warn">
              {status.message}
            </span>
          )}
          {status?.kind === 'error' && (
            <span className="prompt-editor__status prompt-editor__status--error">
              {status.message}
            </span>
          )}
        </div>
      </div>

      <div className="prompt-editor__body">
        {mode === 'visual' ? (
          <div ref={visualRootRef} className="prompt-editor__visual" />
        ) : (
          <textarea
            data-testid="source-editor"
            className="prompt-editor__source"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  )
}
