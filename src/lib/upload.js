import { upload } from '@vercel/blob/client'
import pLimit from 'p-limit'

function sanitizeName(name) {
  return name
    .replace(/\.\./g, '')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10)
}

export async function uploadFiles({ jobId, kind, files, concurrency = 6 }) {
  const limit = pLimit(concurrency)
  const tasks = files.map((file) =>
    limit(async () => {
      const pathname = `jobs/${jobId}/${kind}/${randomId()}-${sanitizeName(file.name)}`
      try {
        const blob = await upload(pathname, file, {
          access: 'public',
          handleUploadUrl: '/api/upload-token',
          contentType: file.type || undefined,
        })
        return { name: file.name, url: blob.url, pathname: blob.pathname, size: file.size }
      } catch (error) {
        return { name: file.name, error }
      }
    }),
  )
  return Promise.all(tasks)
}
