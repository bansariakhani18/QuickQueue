import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const TOKEN_ENCRYPTION_KEY_ENV = 'WHATSAPP_TOKEN_ENCRYPTION_KEY'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTE_LENGTH = 32
const IV_BYTE_LENGTH = 12
const AUTH_TAG_BYTE_LENGTH = 16
const SERIALIZED_PREFIX = 'v1'
const SERIALIZED_SEPARATOR = ':'
const SERIALIZED_SEGMENT_COUNT = 4

export class TokenEncryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TokenEncryptionError'
  }
}

export type EncryptedToken = string & { readonly __encryptedTokenBrand: unique symbol }

function getConfiguredKey(): Buffer {
  const configured = process.env[TOKEN_ENCRYPTION_KEY_ENV]
  const trimmed = configured?.trim() ?? ''
  if (trimmed === '') {
    throw new TokenEncryptionError(
      `Missing required env var ${TOKEN_ENCRYPTION_KEY_ENV}: token encryption is disabled (fail closed)`,
    )
  }
  const key = createHash('sha256').update(trimmed, 'utf8').digest()
  if (key.length !== KEY_BYTE_LENGTH) {
    throw new TokenEncryptionError('Derived encryption key has an unexpected length')
  }
  return key
}

function encodeSegment(value: Buffer): string {
  return value.toString('base64url')
}

function decodeFixedSegment(raw: string, label: string, expectedByteLength: number): Buffer {
  if (raw === '') {
    throw new TokenEncryptionError(`Malformed encrypted token: empty ${label}`)
  }
  const decoded = Buffer.from(raw, 'base64url')
  if (decoded.toString('base64url') !== raw) {
    throw new TokenEncryptionError(`Malformed encrypted token: invalid base64url in ${label}`)
  }
  if (decoded.length !== expectedByteLength) {
    throw new TokenEncryptionError(`Malformed encrypted token: ${label} has invalid length`)
  }
  return decoded
}

function decodeCiphertextSegment(raw: string): Buffer {
  if (raw === '') {
    throw new TokenEncryptionError('Malformed encrypted token: empty ciphertext')
  }
  const decoded = Buffer.from(raw, 'base64url')
  if (decoded.toString('base64url') !== raw) {
    throw new TokenEncryptionError('Malformed encrypted token: invalid base64url in ciphertext')
  }
  return decoded
}

function serializeToken(iv: Buffer, authTag: Buffer, ciphertext: Buffer): string {
  return [
    SERIALIZED_PREFIX,
    encodeSegment(iv),
    encodeSegment(authTag),
    encodeSegment(ciphertext),
  ].join(SERIALIZED_SEPARATOR)
}

function parseToken(serialized: string): { iv: Buffer; authTag: Buffer; ciphertext: Buffer } {
  const segments = serialized.split(SERIALIZED_SEPARATOR)
  if (segments.length !== SERIALIZED_SEGMENT_COUNT) {
    throw new TokenEncryptionError(
      `Malformed encrypted token: expected "${SERIALIZED_PREFIX}:<iv>:<authTag>:<ciphertext>"`,
    )
  }
  const prefix = segments[0]
  const ivSegment = segments[1]
  const tagSegment = segments[2]
  const ciphertextSegment = segments[3]
  if (prefix === undefined || ivSegment === undefined || tagSegment === undefined || ciphertextSegment === undefined) {
    throw new TokenEncryptionError(
      `Malformed encrypted token: expected "${SERIALIZED_PREFIX}:<iv>:<authTag>:<ciphertext>"`,
    )
  }
  if (prefix !== SERIALIZED_PREFIX) {
    throw new TokenEncryptionError(`Malformed encrypted token: unsupported version "${prefix}"`)
  }
  const iv = decodeFixedSegment(ivSegment, 'iv', IV_BYTE_LENGTH)
  const authTag = decodeFixedSegment(tagSegment, 'auth tag', AUTH_TAG_BYTE_LENGTH)
  const ciphertext = decodeCiphertextSegment(ciphertextSegment)
  return { iv, authTag, ciphertext }
}

export function encryptToken(plaintext: string): EncryptedToken {
  const key = getConfiguredKey()
  const iv = randomBytes(IV_BYTE_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return serializeToken(iv, authTag, ciphertext) as EncryptedToken
}

export function decryptToken(encrypted: EncryptedToken): string {
  const key = getConfiguredKey()
  const { iv, authTag, ciphertext } = parseToken(encrypted)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  let plaintext: Buffer
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch (cause) {
    throw new TokenEncryptionError(
      'Failed to decrypt token: authentication failed (tampered data or wrong key)',
      { cause },
    )
  }
  return plaintext.toString('utf8')
}