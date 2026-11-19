/**
 * SSO simulé pour le développement : une session = un cookie signé (HMAC) contenant l'e-mail.
 * Refusé en production (NODE_ENV=production) : là, l'identité vient uniquement de Cloudflare Access.
 */
const enc = new TextEncoder()

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const SESSION_COOKIE = 'pm_session'

export async function signSession(email: string, secret: string): Promise<string> {
  return `${encodeURIComponent(email)}.${await hmac(secret, email)}`
}

export async function readSession(value: string | undefined, secret: string): Promise<string | null> {
  if (!value) return null
  const i = value.lastIndexOf('.')
  if (i < 1) return null
  const email = decodeURIComponent(value.slice(0, i))
  const expected = await hmac(secret, email)
  const given = value.slice(i + 1)
  if (given.length !== expected.length) return null
  let diff = 0
  for (let k = 0; k < given.length; k++) diff |= given.charCodeAt(k) ^ expected.charCodeAt(k)
  return diff === 0 ? email : null
}
