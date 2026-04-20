export async function runQa({
  jobId,
  prompt,
  imageUrls,
  csvUrls,
  onEvent,
  onError,
  signal,
}) {
  const res = await fetch('/api/run-qa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId, prompt, imageUrls, csvUrls }),
    signal,
  })
  if (!res.ok) {
    throw new Error(`runQa failed: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const emit = (line) => {
    if (!line) return
    try {
      onEvent(JSON.parse(line))
    } catch (err) {
      if (onError) onError(err)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) emit(trimmed)
    }
  }
  const trailing = buffer.trim()
  if (trailing) emit(trailing)
}
