import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

/* Mock Milkdown Crepe — keep tests focused on state + API, not the
   editor's DOM. The fake Crepe mounts a <textarea data-testid="milkdown-editor">
   into the given root so tests can interact with it the same way they
   would a normal input. */
vi.mock('@milkdown/crepe', () => ({
  Crepe: class {
    constructor({ root, defaultValue }) {
      this.root = root
      this._md = defaultValue || ''
    }
    create() {
      const ta = document.createElement('textarea')
      ta.setAttribute('data-testid', 'milkdown-editor')
      ta.value = this._md
      const handler = (e) => {
        this._md = e.target.value
      }
      ta.addEventListener('input', handler)
      ta.addEventListener('change', handler)
      this.root.appendChild(ta)
      return Promise.resolve()
    }
    getMarkdown() {
      return this._md
    }
    destroy() {
      this.root.innerHTML = ''
    }
  },
}))

/* CSS imports from Milkdown — vitest handles these by default, but mock
   defensively so the module graph stays pure in tests. */
vi.mock('@milkdown/crepe/theme/common/style.css', () => ({}))
vi.mock('@milkdown/crepe/theme/nord.css', () => ({}))

const getPromptMock = vi.fn()
const savePromptMock = vi.fn()
vi.mock('../lib/promptApi.js', () => ({
  getPrompt: (...args) => getPromptMock(...args),
  savePrompt: (...args) => savePromptMock(...args),
}))

let PromptEditor
beforeEach(async () => {
  getPromptMock.mockReset()
  savePromptMock.mockReset()
  vi.resetModules()
  PromptEditor = (await import('./PromptEditor.jsx')).default
})

describe('PromptEditor', () => {
  it('mounts the visual editor by default with loaded content', async () => {
    getPromptMock.mockResolvedValue({
      content: '# loaded prompt',
      etag: 'abc',
      updatedAt: 't',
    })
    render(<PromptEditor />)
    await waitFor(() => {
      expect(screen.getByTestId('milkdown-editor')).toBeInTheDocument()
    })
    expect(screen.getByTestId('milkdown-editor')).toHaveValue('# loaded prompt')
    // No raw source editor visible by default.
    expect(screen.queryByTestId('source-editor')).not.toBeInTheDocument()
  })

  it('falls back to the bundled default when getPrompt rejects', async () => {
    getPromptMock.mockRejectedValue(new Error('network'))
    render(<PromptEditor />)
    await waitFor(() => {
      const v = screen.getByTestId('milkdown-editor').value
      expect(v.length).toBeGreaterThan(0)
    })
  })

  it('Save calls savePrompt with the visual editor content + etag', async () => {
    getPromptMock.mockResolvedValue({
      content: '# v1',
      etag: 'etag-v1',
      updatedAt: 't',
    })
    savePromptMock.mockResolvedValue({ etag: 'etag-v2', updatedAt: 't2' })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))

    fireEvent.change(screen.getByTestId('milkdown-editor'), {
      target: { value: '# v2' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(savePromptMock).toHaveBeenCalledOnce())
    expect(savePromptMock).toHaveBeenCalledWith({
      content: '# v2',
      ifMatch: 'etag-v1',
    })
  })

  it('shows a saved indicator after a successful save', async () => {
    getPromptMock.mockResolvedValue({ content: 'x', etag: 'e1', updatedAt: 't' })
    savePromptMock.mockResolvedValue({ etag: 'e2', updatedAt: 't2' })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => {
      expect(screen.getByText(/saved/i)).toBeInTheDocument()
    })
  })

  it('shows a conflict warning on 409 and does not overwrite the draft', async () => {
    getPromptMock.mockResolvedValue({ content: 'x', etag: 'e1', updatedAt: 't' })
    savePromptMock.mockRejectedValue(
      Object.assign(new Error('conflict'), { code: 'conflict' }),
    )
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))
    fireEvent.change(screen.getByTestId('milkdown-editor'), {
      target: { value: '# my draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(screen.getByText(/conflict|modified/i)).toBeInTheDocument(),
    )
    expect(screen.getByTestId('milkdown-editor')).toHaveValue('# my draft')
  })

  it('disables Save while saving to prevent double-submit', async () => {
    getPromptMock.mockResolvedValue({ content: 'x', etag: 'e1', updatedAt: 't' })
    let resolveSave
    savePromptMock.mockReturnValue(
      new Promise((r) => {
        resolveSave = r
      }),
    )
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))
    const btn = screen.getByRole('button', { name: /^save$/i })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    resolveSave({ etag: 'e2', updatedAt: 't2' })
    await waitFor(() => expect(btn).not.toBeDisabled())
  })

  it('toggles to source view when "Edit source" is clicked', async () => {
    getPromptMock.mockResolvedValue({
      content: '# hello',
      etag: 'e1',
      updatedAt: 't',
    })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))

    fireEvent.click(screen.getByRole('button', { name: /edit source/i }))

    // Source textarea appears with the current content.
    const src = await screen.findByTestId('source-editor')
    expect(src).toHaveValue('# hello')
    // Visual editor is gone.
    expect(screen.queryByTestId('milkdown-editor')).not.toBeInTheDocument()
  })

  it('preserves visual edits when toggling to source view', async () => {
    getPromptMock.mockResolvedValue({ content: 'v1', etag: 'e', updatedAt: 't' })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))

    fireEvent.change(screen.getByTestId('milkdown-editor'), {
      target: { value: '# edited visually' },
    })
    fireEvent.click(screen.getByRole('button', { name: /edit source/i }))

    const src = await screen.findByTestId('source-editor')
    expect(src).toHaveValue('# edited visually')
  })

  it('toggle button switches label back when already in source view', async () => {
    getPromptMock.mockResolvedValue({ content: 'x', etag: 'e', updatedAt: 't' })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))

    fireEvent.click(screen.getByRole('button', { name: /edit source/i }))
    await screen.findByTestId('source-editor')
    // Button now says "Edit visual" (or similar)
    expect(
      screen.getByRole('button', { name: /edit visual|visual editor/i }),
    ).toBeInTheDocument()
  })

  it('source edits are preserved when toggling back to visual view', async () => {
    getPromptMock.mockResolvedValue({ content: 'x', etag: 'e', updatedAt: 't' })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))

    fireEvent.click(screen.getByRole('button', { name: /edit source/i }))
    const src = await screen.findByTestId('source-editor')
    fireEvent.change(src, { target: { value: '# edited in source' } })
    fireEvent.click(screen.getByRole('button', { name: /edit visual|visual editor/i }))

    const visual = await screen.findByTestId('milkdown-editor')
    expect(visual).toHaveValue('# edited in source')
  })

  it('on conflict, shows an "Overwrite anyway" button', async () => {
    getPromptMock.mockResolvedValue({ content: 'x', etag: 'e1', updatedAt: 't' })
    savePromptMock.mockRejectedValueOnce(
      Object.assign(new Error('conflict'), { code: 'conflict' }),
    )
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /overwrite anyway/i }),
      ).toBeInTheDocument(),
    )
  })

  it('"Overwrite anyway" re-fetches the current etag and re-saves', async () => {
    getPromptMock
      .mockResolvedValueOnce({ content: 'x', etag: 'e1', updatedAt: 't' })
      .mockResolvedValueOnce({ content: 'something else', etag: 'e-fresh', updatedAt: 't2' })
    savePromptMock
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'conflict' }))
      .mockResolvedValueOnce({ etag: 'e-after', updatedAt: 't3' })

    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))
    fireEvent.change(screen.getByTestId('milkdown-editor'), {
      target: { value: '# my draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    const forceBtn = await screen.findByRole('button', {
      name: /overwrite anyway/i,
    })
    fireEvent.click(forceBtn)

    await waitFor(() => expect(savePromptMock).toHaveBeenCalledTimes(2))
    // Second call used the fresh etag + user's draft content.
    expect(savePromptMock).toHaveBeenLastCalledWith({
      content: '# my draft',
      ifMatch: 'e-fresh',
    })
    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument())
  })

  it('on window focus, re-fetches getPrompt silently (etag refresh)', async () => {
    getPromptMock.mockResolvedValue({ content: 'x', etag: 'e1', updatedAt: 't' })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))
    expect(getPromptMock).toHaveBeenCalledTimes(1)

    // Server now has same content but a new etag (our curl-drift case).
    getPromptMock.mockResolvedValueOnce({
      content: 'x',
      etag: 'e2',
      updatedAt: 't-later',
    })
    window.dispatchEvent(new Event('focus'))

    await waitFor(() => expect(getPromptMock).toHaveBeenCalledTimes(2))
    // No user-facing status change on a silent refresh.
    expect(screen.queryByText(/server has/i)).not.toBeInTheDocument()
  })

  it('on focus, if server content differs and user has a draft, shows an info banner', async () => {
    getPromptMock.mockResolvedValueOnce({
      content: 'original',
      etag: 'e1',
      updatedAt: 't',
    })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))

    // User edits their local draft.
    fireEvent.change(screen.getByTestId('milkdown-editor'), {
      target: { value: 'my draft' },
    })

    // Server content changes.
    getPromptMock.mockResolvedValueOnce({
      content: 'other person edited',
      etag: 'e-new',
      updatedAt: 't-later',
    })
    window.dispatchEvent(new Event('focus'))

    await waitFor(() =>
      expect(screen.getByText(/server has a newer version/i)).toBeInTheDocument(),
    )
    // Draft is preserved.
    expect(screen.getByTestId('milkdown-editor')).toHaveValue('my draft')
  })

  it('Save from source view persists the raw text', async () => {
    getPromptMock.mockResolvedValue({ content: 'x', etag: 'e', updatedAt: 't' })
    savePromptMock.mockResolvedValue({ etag: 'e2', updatedAt: 't2' })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('milkdown-editor'))

    fireEvent.click(screen.getByRole('button', { name: /edit source/i }))
    const src = await screen.findByTestId('source-editor')
    fireEvent.change(src, { target: { value: '# from source' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(savePromptMock).toHaveBeenCalledOnce())
    expect(savePromptMock).toHaveBeenCalledWith({
      content: '# from source',
      ifMatch: 'e',
    })
  })
})
