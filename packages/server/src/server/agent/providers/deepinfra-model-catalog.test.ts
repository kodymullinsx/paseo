import { describe, expect, test, vi } from 'vitest'
import { listDeepInfraModels } from './deepinfra-model-catalog.js'

function createJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response
}

function createErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as Response
}

describe('listDeepInfraModels', () => {
  test('returns empty list when API key is missing', async () => {
    const models = await listDeepInfraModels({
      apiKey: '',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })
    expect(models).toEqual([])
  })

  test('parses OpenAI-style model list payload', async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        object: 'list',
        data: [
          { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
          { id: 'Qwen/Qwen3-235B-A22B-Thinking-2507' },
        ],
      })
    ) as unknown as typeof fetch

    const models = await listDeepInfraModels({
      apiKey: 'test-key',
      fetchImpl,
      modelListUrl: 'https://api.deepinfra.com/v1/openai/models',
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(models.map((model) => model.id)).toEqual([
      'meta-llama/Meta-Llama-3.1-8B-Instruct',
      'Qwen/Qwen3-235B-A22B-Thinking-2507',
    ])
    expect(models.every((model) => model.provider === 'deepinfra')).toBe(true)
  })

  test('falls back across candidate endpoints', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createErrorResponse(404))
      .mockResolvedValueOnce(
        createJsonResponse({
          models: [{ id: 'mistralai/Mistral-Small-24B-Instruct-2501' }],
        })
      ) as unknown as typeof fetch

    const models = await listDeepInfraModels({
      apiKey: 'test-key',
      fetchImpl,
      baseUrl: 'https://api.deepinfra.com',
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(models).toHaveLength(1)
    expect(models[0]?.id).toBe('mistralai/Mistral-Small-24B-Instruct-2501')
  })

  test('supports first-class deepinfra provider ids without prefix', async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        data: [{ id: 'meta-llama/Meta-Llama-3.1-8B-Instruct' }],
      })
    ) as unknown as typeof fetch

    const models = await listDeepInfraModels({
      apiKey: 'test-key',
      fetchImpl,
      providerId: 'deepinfra',
      modelIdPrefix: '',
      modelListUrl: 'https://api.deepinfra.com/v1/openai/models',
    })

    expect(models).toHaveLength(1)
    expect(models[0]?.provider).toBe('deepinfra')
    expect(models[0]?.id).toBe('meta-llama/Meta-Llama-3.1-8B-Instruct')
  })
})
