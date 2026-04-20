import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

/* Mock the MD editor — keep tests focused on state & API, not on the
   third-party editor's DOM. Replace with a plain textarea that exposes
   value + onChange. */
vi.mock('@uiw/react-md-editor', () => ({
  default: ({ value, onChange }) => (
    <textarea
      data-testid="md-editor"
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

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
  it('calls getPrompt on mount and populates the editor', async () => {
    getPromptMock.mockResolvedValue({
      content: '# loaded prompt',
      etag: 'abc',
      updatedAt: '2026-04-20T00:00:00Z',
    })
    render(<PromptEditor />)
    await waitFor(() => {
      expect(screen.getByTestId('md-editor')).toHaveValue('# loaded prompt')
    })
    expect(getPromptMock).toHaveBeenCalledOnce()
  })

  it('falls back to bundled default when getPrompt rejects', async () => {
    getPromptMock.mockRejectedValue(new Error('network'))
    render(<PromptEditor />)
    await waitFor(() => {
      const v = screen.getByTestId('md-editor').value
      expect(v.length).toBeGreaterThan(0)
    })
  })

  it('calls savePrompt with current content and etag when Save clicked', async () => {
    getPromptMock.mockResolvedValue({
      content: '# v1',
      etag: 'etag-v1',
      updatedAt: 't',
    })
    savePromptMock.mockResolvedValue({ etag: 'etag-v2', updatedAt: 't2' })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('md-editor'))

    const editor = screen.getByTestId('md-editor')
    fireEvent.change(editor, { target: { value: '# v2' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(savePromptMock).toHaveBeenCalledOnce())
    expect(savePromptMock).toHaveBeenCalledWith({
      content: '# v2',
      ifMatch: 'etag-v1',
    })
  })

  it('shows a saved indicator after successful save', async () => {
    getPromptMock.mockResolvedValue({ content: 'x', etag: 'e1', updatedAt: 't' })
    savePromptMock.mockResolvedValue({ etag: 'e2', updatedAt: 't2' })
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('md-editor'))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(screen.getByText(/saved/i)).toBeInTheDocument()
    })
  })

  it('shows a conflict warning on 409 and does not overwrite local draft', async () => {
    getPromptMock.mockResolvedValue({ content: 'x', etag: 'e1', updatedAt: 't' })
    const conflictErr = Object.assign(new Error('conflict'), { code: 'conflict' })
    savePromptMock.mockRejectedValue(conflictErr)
    render(<PromptEditor />)
    await waitFor(() => screen.getByTestId('md-editor'))
    const editor = screen.getByTestId('md-editor')
    fireEvent.change(editor, { target: { value: '# my draft' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/conflict|modified/i)).toBeInTheDocument(),
    )
    expect(editor).toHaveValue('# my draft')
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
    await waitFor(() => screen.getByTestId('md-editor'))
    const btn = screen.getByRole('button', { name: /save/i })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toBeDisabled())
    resolveSave({ etag: 'e2', updatedAt: 't2' })
    await waitFor(() => expect(btn).not.toBeDisabled())
  })
})
