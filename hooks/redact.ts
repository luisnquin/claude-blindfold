const MIN_ENCODED = 8

function bytesOf(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function base64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += chars.charAt((n >> 18) & 63) + chars.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? chars.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? chars.charAt(n & 63) : '='
  }
  return out
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function formsOf(value: string): string[] {
  const forms = new Set([value])
  if (value.length >= MIN_ENCODED) {
    const bytes = bytesOf(value)
    const b64 = base64(bytes)
    forms.add(JSON.stringify(value).slice(1, -1))
    forms.add(encodeURIComponent(value))
    forms.add(b64)
    forms.add(b64.replace(/=+$/, ''))
    forms.add(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
    forms.add(hex(bytes))
    forms.add(hex(bytes).toUpperCase())
  }
  return [...forms].filter(form => form.length > 0).sort((a, b) => b.length - a.length)
}

export function redact(text: string, secrets: Record<string, string>): string {
  let out = text
  for (const [name, value] of Object.entries(secrets)) {
    for (const form of formsOf(value)) {
      if (out.includes(form)) out = out.split(form).join(`[REDACTED:${name}]`)
    }
  }
  return out
}

export function referenced(command: string, names: readonly string[]): string[] {
  return names.filter(name => new RegExp(`\\$\\{?${name}(?![A-Za-z0-9_])`).test(command))
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export const MASK = '•'

// The field shows one MASK per real character, so each MASK in the new text
// stands for the next unconsumed real character and anything else was typed.
export function unmask(shown: string, real: string): string {
  const chars = Array.from(real)
  let next = 0
  let out = ''
  for (const char of shown) {
    if (char === MASK && next < chars.length) out += chars[next++] ?? ''
    else out += char
  }
  return out
}
