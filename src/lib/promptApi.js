import defaultPrompt from '../defaultPrompt.md?raw'

export async function getPrompt() {
  try {
    const res = await fetch('/api/prompt')
    if (!res.ok) throw new Error('fetch failed')
    return await res.json()
  } catch {
    return {
      content: defaultPrompt,
      etag: 'default',
      updatedAt: new Date(0).toISOString(),
    }
  }
}

export async function savePrompt({ content, ifMatch }) {
  const res = await fetch('/api/prompt', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, ifMatch }),
  })
  if (res.status === 409) {
    const err = new Error('prompt was modified by someone else')
    err.code = 'conflict'
    throw err
  }
  if (!res.ok) {
    throw new Error(`savePrompt failed with status ${res.status}`)
  }
  return await res.json()
}
