/**
 * Resize images client-side before upload so they fit Anthropic's 2000px
 * max-dimension rule for many-image requests.
 *
 * Canvas-based, no third-party deps. Doesn't handle HEIC decode (browsers
 * generally can't); for HEIC we fall back to passing the file through.
 */

export const MAX_DIMENSION = 2000

export function computeResizedDimensions(width, height, max = MAX_DIMENSION) {
  if (width <= max && height <= max) {
    return { width, height, scaled: false }
  }
  const scale = Math.min(max / width, max / height)
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scaled: true,
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (err) => {
      URL.revokeObjectURL(url)
      reject(err instanceof Error ? err : new Error('image decode failed'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('canvas.toBlob returned null'))
      },
      type,
      quality,
    )
  })
}

export async function resizeImageIfNeeded(file) {
  if (!file?.type || !file.type.startsWith('image/')) return file
  if (file.type === 'image/svg+xml') return file

  let img
  try {
    img = await loadImage(file)
  } catch {
    // Decode failed (HEIC in non-Safari, corrupt file, etc.) — let it pass
    // through so the upload layer can still try. Anthropic's error, if any,
    // will surface with better context than ours would.
    return file
  }

  const dims = computeResizedDimensions(img.width, img.height)
  if (!dims.scaled) return file

  const canvas = document.createElement('canvas')
  canvas.width = dims.width
  canvas.height = dims.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, dims.width, dims.height)

  // Keep PNG as PNG (lossless text stays crisp); everything else becomes
  // JPEG at 0.92 quality to keep file sizes reasonable.
  const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  let blob
  try {
    blob = await canvasToBlob(canvas, outputType, 0.92)
  } catch {
    return file
  }

  const resized = new File([blob], file.name, {
    type: blob.type || outputType,
    lastModified: file.lastModified,
  })
  if (file.relativePath) {
    Object.defineProperty(resized, 'relativePath', {
      value: file.relativePath,
      enumerable: true,
    })
  }
  if (file.webkitRelativePath) {
    Object.defineProperty(resized, 'webkitRelativePath', {
      value: file.webkitRelativePath,
      enumerable: true,
    })
  }
  return resized
}
