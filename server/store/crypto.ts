// Symmetric encryption for shop credentials at rest (AES-256-GCM).
// Platform secrets (app_secret / partner_key / access_token) are stored ENCRYPTED
// in SQLite so a leaked costs.db does not leak credentials. The key is derived from
// APP_SECRET_KEY (env). If unset, a fixed DEV key is used with a loud warning — fine
// for the sample demo, NOT safe for production.

import crypto from 'node:crypto'

const ALGO = 'aes-256-gcm'
// Static salt: the master key comes from APP_SECRET_KEY entropy, not the salt. A
// fixed salt keeps derivation deterministic across restarts (so old rows decrypt).
const SALT = 'nonelab-dashboard-cred-v1'

let warned = false
function masterKey(): Buffer {
  const secret = process.env.APP_SECRET_KEY
  if (!secret) {
    if (!warned) {
      console.warn(
        '[crypto] APP_SECRET_KEY is not set — using an INSECURE dev key. ' +
          'Set APP_SECRET_KEY in .env before storing real credentials.',
      )
      warned = true
    }
    return crypto.scryptSync('insecure-dev-key-do-not-use-in-prod', SALT, 32)
  }
  return crypto.scryptSync(secret, SALT, 32)
}

/** Encrypt an object → "ivHex:tagHex:cipherHex". Empty/undefined → ''. */
export function encryptJson(obj: unknown): string {
  if (obj == null) return ''
  const plain = JSON.stringify(obj)
  if (plain === '{}' || plain === '') return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

/** Decrypt "ivHex:tagHex:cipherHex" → object. Empty/malformed/tampered → {}. */
export function decryptJson<T = Record<string, unknown>>(blob: string | null | undefined): T {
  if (!blob) return {} as T
  const parts = blob.split(':')
  if (parts.length !== 3) return {} as T
  try {
    const [ivHex, tagHex, cipherHex] = parts
    const decipher = crypto.createDecipheriv(ALGO, masterKey(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    const dec = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ])
    return JSON.parse(dec.toString('utf8')) as T
  } catch {
    return {} as T
  }
}
