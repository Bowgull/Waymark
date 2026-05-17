import assert from 'node:assert/strict'
import { resolveApiBaseUrl } from './apiBase'

assert.equal(
  resolveApiBaseUrl('http://localhost:8787', true),
  'https://waymark.bocas-joshua.workers.dev',
  'native builds must not point at localhost',
)

assert.equal(
  resolveApiBaseUrl('http://127.0.0.1:8787', true),
  'https://waymark.bocas-joshua.workers.dev',
  'native builds must not point at loopback',
)

assert.equal(
  resolveApiBaseUrl('http://localhost:8787', false),
  'http://localhost:8787',
  'web dev keeps the local Worker',
)

assert.equal(
  resolveApiBaseUrl('https://waymark.bocas-joshua.workers.dev/', true),
  'https://waymark.bocas-joshua.workers.dev',
  'configured production origin is trimmed',
)

console.log('apiBase tests passed')
