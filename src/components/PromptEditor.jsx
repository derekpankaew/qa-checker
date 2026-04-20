import { useEffect, useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import defaultPrompt from '../defaultPrompt.md?raw'
import { getPrompt, savePrompt } from '../lib/promptApi.js'

export default function PromptEditor({ onClose }) {
  const [loaded, setLoaded] = useState(false)
  const [content, setContent] = useState('')
  const [etag, setEtag] = useState(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)

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

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const res = await savePrompt({ content, ifMatch: etag })
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
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {onClose && (
          <button type="button" onClick={onClose}>
            Close
          </button>
        )}
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
      <div data-color-mode="light" className="prompt-editor__body">
        <MDEditor value={content} onChange={(v) => setContent(v ?? '')} height={500} />
      </div>
    </div>
  )
}
