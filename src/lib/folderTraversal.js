export async function readEntry(entry, prefix = '') {
  const results = []
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) =>
      entry.file(resolve, reject),
    )
    if (prefix) {
      try {
        Object.defineProperty(file, 'relativePath', {
          value: prefix + file.name,
          enumerable: true,
        })
      } catch {
        // read-only assignment failures are non-fatal
      }
    }
    results.push(file)
    return results
  }
  if (entry.isDirectory) {
    const reader = entry.createReader()
    const readBatch = () =>
      new Promise((resolve, reject) => reader.readEntries(resolve, reject))
    let batch
    do {
      batch = await readBatch()
      for (const child of batch) {
        const nested = await readEntry(child, `${prefix}${entry.name}/`)
        results.push(...nested)
      }
    } while (batch.length > 0)
  }
  return results
}
