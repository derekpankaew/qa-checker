export function normalizeName(name) {
  if (!name) return ''
  return String(name)
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCsvRow(line) {
  // Minimal CSV split: does not handle quoted commas. Sufficient for Name extraction.
  return line.split(',').map((c) => c.trim())
}

export function parseCsvNames(csvText) {
  if (!csvText) return []
  const lines = csvText.split(/\r?\n/)
  if (lines.length < 2) return []
  const header = parseCsvRow(lines[0])
  const nameIdx = header.findIndex((c) => /^name$/i.test(c))
  if (nameIdx === -1) return []

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    const cells = parseCsvRow(raw)
    const name = cells[nameIdx]
    if (!name) continue
    rows.push({ customerName: name, rowIndex: i + 1 })
  }
  return rows
}

export function reconcileMissing(csvRows, extractedLabels) {
  // Build a multiset of available extracted names.
  const available = new Map()
  for (const { customerName } of extractedLabels || []) {
    const key = normalizeName(customerName)
    if (!key) continue
    available.set(key, (available.get(key) || 0) + 1)
  }

  const missing = []
  for (const row of csvRows) {
    const key = normalizeName(row.customerName)
    const count = available.get(key) || 0
    if (count > 0) {
      available.set(key, count - 1)
      continue
    }
    missing.push({
      kind: 'missing',
      customerName: row.customerName,
      rowIndex: row.rowIndex,
      issue: 'Order in spreadsheet but no matching design found',
      severity: 'Critical',
    })
  }
  return missing
}
