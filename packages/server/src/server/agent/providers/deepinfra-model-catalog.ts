import type { AgentModelDefinition } from '../agent-sdk-types.js'

const DEFAULT_DEEPINFRA_BASE_URL = 'https://api.deepinfra.com'
const DEFAULT_TIMEOUT_MS = 8_000

function normalizeOptional(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function ensureUrl(base: string, suffix: string): string {
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base
  return `${normalizedBase}${suffix}`
}

function buildCandidateUrls(modelListUrl: string | null, baseUrl: string): string[] {
  if (modelListUrl) {
    return [modelListUrl]
  }
  return [
    ensureUrl(baseUrl, '/v1/openai/models'),
    ensureUrl(baseUrl, '/v1/models'),
    ensureUrl(baseUrl, '/models/list'),
  ]
}

function collectModelIds(payload: unknown): string[] {
  const out = new Set<string>()

  const ingest = (value: unknown) => {
    if (typeof value === 'string') {
      const id = value.trim()
      if (id.length > 0) {
        out.add(id)
      }
      return
    }
    if (typeof value !== 'object' || value === null) {
      return
    }
    const record = value as Record<string, unknown>
    const candidate =
      typeof record.id === 'string'
        ? record.id
        : typeof record.model === 'string'
          ? record.model
          : null
    if (candidate) {
      const id = candidate.trim()
      if (id.length > 0) {
        out.add(id)
      }
    }
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      ingest(item)
    }
    return Array.from(out)
  }

  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) {
      for (const item of record.data) {
        ingest(item)
      }
    }
    if (Array.isArray(record.models)) {
      for (const item of record.models) {
        ingest(item)
      }
    }
    if (Array.isArray(record.results)) {
      for (const item of record.results) {
        ingest(item)
      }
    }
  }

  return Array.from(out)
}

function toFriendlyDeepInfraLabel(modelId: string): string {
  const trimmed = modelId.trim()
  if (!trimmed) {
    return modelId
  }

  const lastSegment = trimmed.split('/').filter(Boolean).at(-1) ?? trimmed
  const spaced = lastSegment.replace(/[-_]+/g, ' ').trim()
  if (!spaced) {
    return modelId
  }

  return spaced
    .split(/\s+/)
    .map((token) => {
      if (token.length <= 2 || /[A-Z]/.test(token) || /\d/.test(token)) {
        return token
      }
      return `${token[0]!.toUpperCase()}${token.slice(1)}`
    })
    .join(' ')
}

async function fetchJsonWithTimeout(
  url: string,
  apiKey: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

export async function listDeepInfraModels(options?: {
  apiKey?: string | null
  modelListUrl?: string | null
  baseUrl?: string | null
  timeoutMs?: number
  fetchImpl?: typeof fetch
  providerId?: string
  modelIdPrefix?: string
}): Promise<AgentModelDefinition[]> {
  const apiKey = normalizeOptional(options?.apiKey ?? process.env.DEEPINFRA_API_KEY)
  if (!apiKey) {
    return []
  }

  const modelListUrl = normalizeOptional(options?.modelListUrl ?? process.env.DEEPINFRA_MODELS_URL)
  const baseUrl =
    normalizeOptional(options?.baseUrl ?? process.env.DEEPINFRA_API_BASE_URL) ??
    DEFAULT_DEEPINFRA_BASE_URL
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options?.fetchImpl ?? fetch
  const providerId = normalizeOptional(options?.providerId) ?? 'opencode'
  const modelIdPrefix = options?.modelIdPrefix ?? 'deepinfra/'
  const urls = buildCandidateUrls(modelListUrl, baseUrl)

  let lastError: Error | null = null
  for (const url of urls) {
    try {
      const payload = await fetchJsonWithTimeout(url, apiKey, timeoutMs, fetchImpl)
      const modelIds = collectModelIds(payload)
      if (modelIds.length === 0) {
        continue
      }
      return modelIds
        .map((modelId) => ({
          provider: providerId,
          id: `${modelIdPrefix}${modelId}`,
          label: toFriendlyDeepInfraLabel(modelId),
          description: 'DeepInfra',
          metadata: {
            providerId: 'deepinfra',
            providerName: 'DeepInfra',
            modelId,
            source: 'deepinfra-api',
            sourceProvider: 'deepinfra',
          },
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  if (lastError) {
    throw new Error(`Failed to fetch DeepInfra model catalog: ${lastError.message}`)
  }
  return []
}
