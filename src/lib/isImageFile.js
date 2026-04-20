const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|bmp|webp|tiff?|heic|heif|svg)$/i

export function isImageFile(file) {
  if (!file) return false
  if (file.type && file.type.startsWith('image/')) return true
  return IMAGE_EXTENSIONS.test(file.name || '')
}
