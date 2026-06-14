import { describe, it, expect, vi, afterEach } from 'vitest'
import { runSynthesis } from '../skillSynthesisContext'
import type { SynthesisRequest } from '../../types'

const req = {} as SynthesisRequest

function mockFetch(impl: () => Partial<Response> | Promise<Partial<Response>>) {
  vi.stubGlobal('fetch', vi.fn(async () => impl() as unknown as Response))
}

afterEach(() => vi.unstubAllGlobals())

describe('runSynthesis', () => {
  it('maps a successful response to a success job', async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ success: true, synthesizedMarkdown: '# Skill' }) }))
    expect(await runSynthesis(req)).toEqual({ status: 'success', markdown: '# Skill' })
  })

  it('maps a non-ok HTTP response to an error job with the status', async () => {
    mockFetch(() => ({ ok: false, status: 503, text: async () => 'unavailable' }))
    const job = await runSynthesis(req)
    expect(job.status).toBe('error')
    expect(job.error).toContain('503')
  })

  it('maps a success:false body to its error message', async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ success: false, error: 'bad prompt' }) }))
    expect(await runSynthesis(req)).toEqual({ status: 'error', error: 'bad prompt' })
  })

  it('reports an empty-result error when success has no markdown', async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ success: true }) }))
    expect(await runSynthesis(req)).toEqual({ status: 'error', error: 'Empty synthesis result' })
  })

  it('reports a friendly message for any connection TypeError (browser-independent)', async () => {
    // Safari throws "Load failed" (no "fetch" substring) — must still be caught.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed') }))
    const job = await runSynthesis(req)
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/skill server is not running/i)
  })
})
