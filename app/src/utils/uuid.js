const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuidV4(value) {
  return typeof value === 'string' && UUID_V4_REGEX.test(value)
}

export function uuidv4() {
  // Prefer the native implementation when available.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Fallback: RFC4122 v4 using getRandomValues.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    // Per RFC4122 section 4.4
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  // Last resort (should be rare in modern browsers). Produces a UUID-ish string.
  const s = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1)
  return `${s()}${s()}-${s()}-4${s().slice(1)}-${((8 + Math.random() * 4) | 0).toString(16)}${s().slice(1)}-${s()}${s()}${s()}`
}


