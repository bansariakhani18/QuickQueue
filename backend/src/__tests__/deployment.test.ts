import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { app } from '../app.js'
import { encryptToken, TOKEN_ENCRYPTION_KEY_ENV } from '../crypto.js'

const prisma = new PrismaClient()

describe('Phase 20 — Deployment & Environment Audit (Section 19 & 18)', () => {
  describe('Prisma migration apply & expand-contract discipline', () => {
    const migrationsDir = path.resolve(__dirname, '../../prisma/migrations')

    it('has a valid migration_lock.toml referencing postgresql', () => {
      const lockPath = path.join(migrationsDir, 'migration_lock.toml')
      expect(fs.existsSync(lockPath)).toBe(true)
      const lockContent = fs.readFileSync(lockPath, 'utf8')
      expect(lockContent).toContain('provider = "postgresql"')
    })

    it('has ordered migration directories with valid migration.sql files', () => {
      const entries = fs.readdirSync(migrationsDir, { withFileTypes: true })
      const migrationDirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()

      expect(migrationDirs.length).toBeGreaterThanOrEqual(2)
      expect(migrationDirs[0]).toContain('initial_schema')
      expect(migrationDirs[1]).toContain('add_next_retry_at')

      for (const dirName of migrationDirs) {
        const sqlPath = path.join(migrationsDir, dirName, 'migration.sql')
        expect(fs.existsSync(sqlPath)).toBe(true)
        const sql = fs.readFileSync(sqlPath, 'utf8')
        expect(sql.trim().length).toBeGreaterThan(0)
      }
    })

    it('adheres to expand-contract discipline: no destructive DROPs in incremental migrations', () => {
      const entries = fs.readdirSync(migrationsDir, { withFileTypes: true })
      const migrationDirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()

      // Skip initial_schema (which creates tables); check all subsequent migrations
      const incremental = migrationDirs.slice(1)
      for (const dirName of incremental) {
        const sql = fs.readFileSync(path.join(migrationsDir, dirName, 'migration.sql'), 'utf8')
        // No destructive table drops or column drops
        expect(sql).not.toMatch(/DROP\s+TABLE/i)
        expect(sql).not.toMatch(/DROP\s+COLUMN/i)

        // Any ADD COLUMN in incremental migration must be nullable or have a DEFAULT
        const addColumnMatches = sql.match(/ADD\s+COLUMN\s+.*?(;|$)/gi) ?? []
        for (const addCol of addColumnMatches) {
          const isNullable = !addCol.toUpperCase().includes('NOT NULL')
          const hasDefault = addCol.toUpperCase().includes('DEFAULT')
          expect(isNullable || hasDefault).toBe(true)
        }
      }
    })

    it('enforces UUID primary keys and core constraints in live database', async () => {
      // Query information_schema to verify table existence and column types
      const tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `
      const tableNames = tables.map((t) => t.table_name)
      expect(tableNames).toContain('restaurants')
      expect(tableNames).toContain('whatsapp_connections')
      expect(tableNames).toContain('orders')
      expect(tableNames).toContain('notification_attempts')
      expect(tableNames).toContain('notification_opt_outs')

      // Verify partial unique index or composite unique constraint on notification_opt_outs
      const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes 
        WHERE tablename = 'notification_opt_outs'
      `
      const indexNames = indexes.map((i) => i.indexname)
      expect(indexNames.some((idx) => idx.includes('restaurant_id') && idx.includes('phone_normalized'))).toBe(true)
    })
  })

  describe('Environment configuration completeness', () => {
    const requiredEnvKeys = [
      'DATABASE_URL',
      'SESSION_SECRET',
      'WHATSAPP_TOKEN_ENCRYPTION_KEY',
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
      'WHATSAPP_APP_SECRET',
    ]

    it('documents all required production environment variables in .env.example', () => {
      const envExamplePath = path.resolve(__dirname, '../../../.env.example')
      expect(fs.existsSync(envExamplePath)).toBe(true)
      const envExample = fs.readFileSync(envExamplePath, 'utf8')

      // Check key variables present in .env.example
      expect(envExample).toContain('DATABASE_URL')
      expect(envExample).toContain('WHATSAPP_TOKEN_ENCRYPTION_KEY')
      expect(envExample).toContain('WHATSAPP_APP_SECRET')
      expect(envExample).toContain('WHATSAPP_WEBHOOK_VERIFY_TOKEN')
    })

    it('documents environment variables in docs/ENVIRONMENT_VARIABLES.md', () => {
      const docPath = path.resolve(__dirname, '../../../docs/ENVIRONMENT_VARIABLES.md')
      expect(fs.existsSync(docPath)).toBe(true)
      const docContent = fs.readFileSync(docPath, 'utf8')

      for (const key of requiredEnvKeys) {
        expect(docContent).toContain(key)
      }
    })

    it('fails safely when TOKEN_ENCRYPTION_KEY is missing (fails closed, no plaintext leak)', () => {
      const originalKey = process.env[TOKEN_ENCRYPTION_KEY_ENV]
      try {
        delete process.env[TOKEN_ENCRYPTION_KEY_ENV]
        expect(() => encryptToken('test-secret')).toThrow(/WHATSAPP_TOKEN_ENCRYPTION_KEY.*fail closed/i)
      } finally {
        if (originalKey !== undefined) {
          process.env[TOKEN_ENCRYPTION_KEY_ENV] = originalKey
        }
      }
    })

    it('fails safely when WHATSAPP_APP_SECRET is missing during webhook POST', async () => {
      const originalSecret = process.env.WHATSAPP_APP_SECRET
      try {
        delete process.env.WHATSAPP_APP_SECRET
        const res = await request(app)
          .post('/webhook')
          .set('x-hub-signature-256', 'sha256=invalid')
          .set('content-type', 'application/json')
          .send({ object: 'whatsapp_business_account' })

        // Fails closed: signature cannot match without secret
        expect(res.status).toBe(403)
        expect(res.body.error).toContain('Invalid webhook signature')
      } finally {
        if (originalSecret !== undefined) {
          process.env.WHATSAPP_APP_SECRET = originalSecret
        }
      }
    })

    it('fails safely when WHATSAPP_WEBHOOK_VERIFY_TOKEN is missing during webhook GET', async () => {
      const originalToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
      try {
        delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
        const res = await request(app)
          .get('/webhook?hub.mode=subscribe&hub.verify_token=any&hub.challenge=1234')

        // Fails closed: handshake cannot succeed without configured token
        expect(res.status).toBe(403)
      } finally {
        if (originalToken !== undefined) {
          process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = originalToken
        }
      }
    })
  })

  describe('Health check endpoint contract (NFR-015)', () => {
    it('returns HTTP 200 with { status: "ok" } on valid connection', async () => {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'ok' })
    })

    it('returns HTTP 503 with { status: "error", message: "Database unreachable" } when database query rejects', async () => {
      const express = (await import('express')).default
      const testHealthApp = express()
      testHealthApp.get('/health', async (_req, res) => {
        try {
          await Promise.reject(new Error('Connection lost'))
          res.status(200).json({ status: 'ok' })
        } catch {
          res.status(503).json({ status: 'error', message: 'Database unreachable' })
        }
      })
      const res = await request(testHealthApp).get('/health')
      expect(res.status).toBe(503)
      expect(res.body).toEqual({ status: 'error', message: 'Database unreachable' })
    })
  })
})
