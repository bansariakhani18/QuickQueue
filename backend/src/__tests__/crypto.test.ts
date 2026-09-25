import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decryptToken,
  encryptToken,
  TOKEN_ENCRYPTION_KEY_ENV,
  TokenEncryptionError,
  type EncryptedToken,
} from '../crypto.js'

const TEST_KEY = 'QuickQueue-phase-15-step-1-test-encryption-key-0001'
const TEST_TOKEN = 'EAAXdummy-meta-test-access-token-value'

function flipFirstChar(segment: string): string {
  const first = segment.charAt(0)
  const replacement = first === 'A' ? 'B' : 'A'
  return replacement + segment.slice(1)
}

function rebuildSerialized(parts: [string, string, string, string]): string {
  return parts.join(':')
}

describe('Token encryption foundation (NFR-004, Phase 15 step 1)', () => {
  beforeEach(() => {
    process.env[TOKEN_ENCRYPTION_KEY_ENV] = TEST_KEY
  })

  afterEach(() => {
    delete process.env[TOKEN_ENCRYPTION_KEY_ENV]
  })

  it('encrypt then decrypt returns the original token', () => {
    const encrypted = encryptToken(TEST_TOKEN)
    expect(decryptToken(encrypted)).toBe(TEST_TOKEN)
  })

  it('round-trips arbitrary token values', () => {
    const raw = `tok_${Date.now()}_!@#$%^&*()_+-=[]{}`
    expect(decryptToken(encryptToken(raw))).toBe(raw)
  })

  it('uses a fresh IV and distinct ciphertext for every encryption', () => {
    const first = encryptToken(TEST_TOKEN)
    const second = encryptToken(TEST_TOKEN)
    expect(first).not.toBe(second)
    const firstParts = first.split(':')
    const secondParts = second.split(':')
    expect(firstParts[1]).not.toBe(secondParts[1])
    expect(firstParts[3]).not.toBe(secondParts[3])
  })

  it('fails to decrypt tampered ciphertext', () => {
    const parts = encryptToken(TEST_TOKEN).split(':') as [string, string, string, string]
    const tampered = [...parts] as [string, string, string, string]
    tampered[3] = flipFirstChar(parts[3])
    expect(() => decryptToken(rebuildSerialized(tampered) as EncryptedToken)).toThrow(
      TokenEncryptionError,
    )
  })

  it('fails to decrypt a tampered auth tag', () => {
    const parts = encryptToken(TEST_TOKEN).split(':') as [string, string, string, string]
    const tampered = [...parts] as [string, string, string, string]
    tampered[2] = flipFirstChar(parts[2])
    expect(() => decryptToken(rebuildSerialized(tampered) as EncryptedToken)).toThrow(
      TokenEncryptionError,
    )
  })

  it('fails to decrypt with a different key (wrong-key auth failure)', () => {
    const encrypted = encryptToken(TEST_TOKEN)
    process.env[TOKEN_ENCRYPTION_KEY_ENV] = 'another-different-key-for-rotation-check'
    expect(() => decryptToken(encrypted)).toThrow(TokenEncryptionError)
  })

  it('fails closed on encrypt when the key is missing', () => {
    delete process.env[TOKEN_ENCRYPTION_KEY_ENV]
    expect(() => encryptToken(TEST_TOKEN)).toThrow(TokenEncryptionError)
  })

  it('fails closed on decrypt when the key is missing', () => {
    const encrypted = encryptToken(TEST_TOKEN)
    delete process.env[TOKEN_ENCRYPTION_KEY_ENV]
    expect(() => decryptToken(encrypted)).toThrow(TokenEncryptionError)
  })

  it('fails closed when the key is configured as empty or whitespace', () => {
    process.env[TOKEN_ENCRYPTION_KEY_ENV] = ''
    expect(() => encryptToken(TEST_TOKEN)).toThrow(TokenEncryptionError)
    process.env[TOKEN_ENCRYPTION_KEY_ENV] = '   '
    expect(() => encryptToken(TEST_TOKEN)).toThrow(TokenEncryptionError)
  })

  it('fails safely on a malformed encrypted representation', () => {
    expect(() => decryptToken('not-an-encrypted-token' as EncryptedToken)).toThrow(
      TokenEncryptionError,
    )
    expect(() => decryptToken('v1:onlytwo' as EncryptedToken)).toThrow(TokenEncryptionError)
  })

  it('fails safely on an unsupported version prefix', () => {
    expect(() => decryptToken('v9:aaaa:bbbb:cccc' as EncryptedToken)).toThrow(
      TokenEncryptionError,
    )
  })

  it('fails safely on invalid base64url segments', () => {
    const parts = encryptToken(TEST_TOKEN).split(':') as [string, string, string, string]
    const corrupted = [...parts] as [string, string, string, string]
    corrupted[1] = '!!iv-not-base64url!!'
    expect(() => decryptToken(rebuildSerialized(corrupted) as EncryptedToken)).toThrow(
      TokenEncryptionError,
    )
  })

  it('fails safely when the IV segment has the wrong length', () => {
    const parts = encryptToken(TEST_TOKEN).split(':') as [string, string, string, string]
    const corrupted = [...parts] as [string, string, string, string]
    corrupted[1] = Buffer.alloc(16, 1).toString('base64url')
    expect(() => decryptToken(rebuildSerialized(corrupted) as EncryptedToken)).toThrow(
      TokenEncryptionError,
    )
  })

  it('fails safely when the auth tag segment has the wrong length', () => {
    const parts = encryptToken(TEST_TOKEN).split(':') as [string, string, string, string]
    const corrupted = [...parts] as [string, string, string, string]
    corrupted[2] = Buffer.alloc(8, 1).toString('base64url')
    expect(() => decryptToken(rebuildSerialized(corrupted) as EncryptedToken)).toThrow(
      TokenEncryptionError,
    )
  })

  it('fails safely when the ciphertext segment is empty', () => {
    const parts = encryptToken(TEST_TOKEN).split(':') as [string, string, string, string]
    const corrupted = [...parts] as [string, string, string, string]
    corrupted[3] = ''
    expect(() => decryptToken(rebuildSerialized(corrupted) as EncryptedToken)).toThrow(
      TokenEncryptionError,
    )
  })
})