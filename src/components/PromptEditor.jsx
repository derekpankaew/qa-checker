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
  const [lastLoadedContent, setLastLoadedContent] = useState('')

  const visualRootRef = useRef(null)
  const crepeRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    getPrompt()
      .then((res) => {
        if (cancelled) return
        const c = res.content || ''
        setContent(c)
        setLastLoadedContent(c)
        setEtag(res.etag || null)
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setContent(defaultPrompt)
        setLastLoadedContent(defaultPrompt)
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

  // Option B — on window focus, silently refresh the etag so the next save
  // doesn't 409 just because the server-side etag drifted. If the server's
  // content has genuinely changed AND the user has an unsaved draft, surface
  // an info banner instead of silently overwriting anything.
  useEffect(() => {
    if (!loaded) return
    const onFocus = async () => {
      if (saving) return
      try {
        const res = await getPrompt()
        const draft = currentMarkdown()
        const hasDraft = draft !== lastLoadedContent
        if (res.content === lastLoadedContent) {
          // Server content unchanged; just refresh the etag.
          setEtag(res.etag)
        } else if (!hasDraft) {
          // User hasn't edited locally; safe to swap to server version.
          setContent(res.content)
          setLastLoadedContent(res.content)
          setEtag(res.etag)
        } else {
          // User has a draft AND server changed. Warn, but preserve draft.
          setStatus({
            kind: 'info',
            message:
              'Server has a newer version. Save to overwrite, or close and reopen to load it.',
          })
          setEtag(res.etag)
        }
      } catch {
        /* network blip — ignore */
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, saving, lastLoadedContent, mode])

  const toggleMode = () => {
    const latest = currentMarkdown()
    setContent(latest)
    setMode((m) => (m === 'visual' ? 'source' : 'visual'))
  }

  const performSave = async (ifMatchOverride) => {
    setSaving(true)
    setStatus(null)
    const payload = currentMarkdown()
    setContent(payload)
    try {
      const res = await savePrompt({
        content: payload,
        ifMatch: ifMatchOverride ?? etag,
      })
      setEtag(res.etag)
      setLastLoadedContent(payload)
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

  const handleSave = () => performSave()

  // Option A — on conflict, fetch the latest etag from the server and retry
  // the save with the user's draft content. The overwritten version is still
  // archived in prompts/history/, so nothing is permanently lost.
  const handleOverwrite = async () => {
    try {
      const fresh = await getPrompt()
      await performSave(fresh.etag)
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err.message || 'Failed to refresh etag',
      })
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
            <>
              <span className="prompt-editor__status prompt-editor__status--warn">
                {status.message}
              </span>
              <button
                type="button"
                onClick={handleOverwrite}
                disabled={saving}
                className="prompt-editor__btn"
              >
                Overwrite anyway
              </button>
            </>
          )}
          {status?.kind === 'info' && (
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
