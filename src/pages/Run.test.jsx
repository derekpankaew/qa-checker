import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Run from './Run.jsx'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function renderAt(jobId) {
  return render(
    <MemoryRouter initialEntries={[`/run/${jobId}`]}>
      <Routes>
        <Route path="/run/:jobId" element={<Run />} />
      </Routes>
    </MemoryRouter>,
  )
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const SAMPLE_SNAPSHOT = {
  jobId: 'JOBX',
  prompt: '# snapshot prompt',
  imageUrls: ['https://blob/a.jpg'],
  csvUrls: ['https://blob/a.csv'],
  createdAt: '2026-04-20T00:00:00.000Z',
  statusCheck: { imagesReceived: 1, csvRowCount: 2 },
  perImageResults: [
    {
      kind: 'image',
      imageUrl: 'https://blob/a.jpg',
      findings: [{ issue: 'typo on cuff links', severity: 'Critical' }],
      extractedLabel: { customerName: 'Alice' },
    },
  ],
  batchFindings: [
    { scope: 'populating', issue: 'Bob size column blank', severity: 'Critical' },
  ],
  missingDesigns: [
    {
      kind: 'missing',
      customerName: 'Bob',
      rowIndex: 3,
      issue: 'Order in spreadsheet but no matching design found',
    },
  ],
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('/run/:jobId share page', () => {
  it('fetches the jobs/{jobId}/results.json blob URL and renders the snapshot', async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_SNAPSHOT))
    renderAt('JOBX')

    await waitFor(() => {
      expect(screen.getByText(/typo on cuff links/i)).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url] = fetchMock.mock.calls[0]
    // Proxy through API route so we don't hardcode the Blob CDN origin.
    expect(url).toMatch(/JOBX/)
  })

  it('renders three sections: per-image findings, batch findings, missing designs', async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_SNAPSHOT))
    renderAt('JOBX')

    await waitFor(() => {
      expect(screen.getByText(/per-image/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/batch/i)).toBeInTheDocument()
    expect(screen.getByText(/missing/i)).toBeInTheDocument()
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.getByText(/Bob size column blank/)).toBeInTheDocument()
    expect(screen.getByText(/no matching design/i)).toBeInTheDocument()
  })

  it('shows a loading state before the fetch resolves', async () => {
    let resolveFetch
    fetchMock.mockReturnValue(
      new Promise((r) => {
        resolveFetch = r
      }),
    )
    renderAt('JOBX')
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    resolveFetch(jsonResponse(SAMPLE_SNAPSHOT))
    await waitFor(() =>
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument(),
    )
  })

  it('shows a not-found state when fetch returns 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'not found' }, 404))
    renderAt('MISSING')
    await waitFor(() => {
      expect(screen.getByText(/not found|no run/i)).toBeInTheDocument()
    })
  })

  it('renders "No issues found" for an image with empty findings', async () => {
    const clean = {
      ...SAMPLE_SNAPSHOT,
      perImageResults: [
        {
          kind: 'image',
          imageUrl: 'https://blob/clean.jpg',
          findings: [],
          extractedLabel: { customerName: 'Carol' },
        },
      ],
      batchFindings: [],
      missingDesigns: [],
    }
    fetchMock.mockResolvedValue(jsonResponse(clean))
    renderAt('JOBC')
    await waitFor(() => {
      expect(screen.getByText(/no issues/i)).toBeInTheDocument()
    })
  })

  it('renders the prompt snapshot alongside results', async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_SNAPSHOT))
    renderAt('JOBX')
    await waitFor(() => {
      expect(screen.getByText(/# snapshot prompt/)).toBeInTheDocument()
    })
  })
})
