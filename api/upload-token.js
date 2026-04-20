import { handleUpload } from '@vercel/blob/client'

const MAX_SIZE = 25 * 1024 * 1024 // 25 MB
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
  'text/csv',
  'application/vnd.ms-excel',
]

function validatePathname(pathname) {
  if (!pathname.startsWith('jobs/')) {
    throw new Error('pathname must start with jobs/')
  }
  if (pathname.includes('..')) {
    throw new Error('pathname may not contain ..')
  }
}

export default async function handler(request) {
  try {
    const body = await request.json()
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        validatePathname(pathname)
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_SIZE,
          addRandomSuffix: false,
        }
      },
      onUploadCompleted: async () => {
        // No-op. Blobs are keyed by pathname; no registry needed.
      },
    })
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
}
