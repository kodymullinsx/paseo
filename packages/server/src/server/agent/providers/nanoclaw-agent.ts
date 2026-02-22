import { relative, resolve } from 'node:path'

import type { Logger } from 'pino'

import type {
  AgentClient,
  AgentModelDefinition,
  AgentMode,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentSlashCommand,
  AgentStreamEvent,
  AgentTimelineItem,
  ListModelsOptions,
} from '../agent-sdk-types.js'
import type { ProviderRuntimeSettings } from '../provider-launch-config.js'
import { ClaudeAgentClient } from './claude-agent.js'

const NANOCLAW_PROVIDER_ID = 'nanoclaw' as const
const DEFAULT_MODE_ID = process.env.NANOCLAW_DEFAULT_MODE?.trim() || 'default'
const DEFAULT_MODEL_ID = process.env.NANOCLAW_DEFAULT_MODEL?.trim() || ''
const SYSTEM_PROMPT_APPEND = process.env.NANOCLAW_SYSTEM_PROMPT_APPEND?.trim() || ''

function parseAllowedRoots(raw: string | undefined): string[] {
  if (!raw) {
    return []
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => resolve(entry))
}

const NANOCLAW_ALLOWED_ROOTS = parseAllowedRoots(process.env.NANOCLAW_ALLOWED_ROOTS)

function isPathInsideRoot(pathValue: string, root: string): boolean {
  const rel = relative(root, pathValue)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('../') && rel !== '..')
}

function enforceNanoclawWorkspace(cwd: string): string {
  const normalized = resolve(cwd)

  if (NANOCLAW_ALLOWED_ROOTS.length === 0) {
    return normalized
  }

  for (const root of NANOCLAW_ALLOWED_ROOTS) {
    if (isPathInsideRoot(normalized, root)) {
      return normalized
    }
  }

  throw new Error(
    `Nanoclaw provider rejected cwd '${normalized}'. Set NANOCLAW_ALLOWED_ROOTS to include this path.`
  )
}

function mergeSystemPrompt(basePrompt: string | undefined): string | undefined {
  if (!SYSTEM_PROMPT_APPEND) {
    return basePrompt
  }
  if (!basePrompt || basePrompt.trim().length === 0) {
    return SYSTEM_PROMPT_APPEND
  }
  return `${basePrompt}\n\n${SYSTEM_PROMPT_APPEND}`
}

function mapConfigToClaude(config: AgentSessionConfig): AgentSessionConfig {
  const normalizedCwd = enforceNanoclawWorkspace(config.cwd)
  const requestedMode = config.modeId?.trim() || ''
  const modeId = requestedMode || DEFAULT_MODE_ID
  const requestedModel = config.model?.trim() || ''
  const model = requestedModel || DEFAULT_MODEL_ID || undefined

  return {
    ...config,
    provider: 'claude',
    cwd: normalizedCwd,
    modeId,
    ...(model ? { model } : {}),
    systemPrompt: mergeSystemPrompt(config.systemPrompt),
  }
}

function mapOverridesToClaude(overrides: Partial<AgentSessionConfig>): Partial<AgentSessionConfig> {
  const next: Partial<AgentSessionConfig> = {
    ...overrides,
    provider: 'claude',
    systemPrompt: mergeSystemPrompt(overrides.systemPrompt),
  }

  if (typeof overrides.cwd === 'string' && overrides.cwd.trim().length > 0) {
    next.cwd = enforceNanoclawWorkspace(overrides.cwd)
  }

  if (!next.modeId || next.modeId.trim().length === 0) {
    next.modeId = DEFAULT_MODE_ID
  }

  if (!next.model || next.model.trim().length === 0) {
    if (DEFAULT_MODEL_ID) {
      next.model = DEFAULT_MODEL_ID
    } else {
      delete next.model
    }
  }

  return next
}

function mapPersistenceToClaude(handle: AgentPersistenceHandle): AgentPersistenceHandle {
  return {
    ...handle,
    provider: 'claude',
  }
}

function mapPersistenceToNanoclaw(
  handle: AgentPersistenceHandle | null
): AgentPersistenceHandle | null {
  if (!handle) {
    return null
  }
  return {
    ...handle,
    provider: NANOCLAW_PROVIDER_ID,
  }
}

function mapTimelineToNanoclaw(item: AgentTimelineItem): AgentTimelineItem {
  return item
}

function mapEventToNanoclaw(event: AgentStreamEvent): AgentStreamEvent {
  return {
    ...event,
    provider: NANOCLAW_PROVIDER_ID,
    ...(event.type === 'timeline'
      ? {
          item: mapTimelineToNanoclaw(event.item),
        }
      : {}),
  } as AgentStreamEvent
}

class NanoclawSession implements AgentSession {
  readonly provider = NANOCLAW_PROVIDER_ID

  constructor(private readonly delegate: AgentSession) {}

  get id(): string | null {
    return this.delegate.id
  }

  get capabilities() {
    return this.delegate.capabilities
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    const result = await this.delegate.run(prompt, options)
    return {
      ...result,
      timeline: result.timeline.map(mapTimelineToNanoclaw),
    }
  }

  async *stream(
    prompt: AgentPromptInput,
    options?: AgentRunOptions
  ): AsyncGenerator<AgentStreamEvent> {
    for await (const event of this.delegate.stream(prompt, options)) {
      yield mapEventToNanoclaw(event)
    }
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for await (const event of this.delegate.streamHistory()) {
      yield mapEventToNanoclaw(event)
    }
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    const info = await this.delegate.getRuntimeInfo()
    return {
      ...info,
      provider: NANOCLAW_PROVIDER_ID,
    }
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return this.delegate.getPendingPermissions()
  }

  respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void> {
    return this.delegate.respondToPermission(requestId, response)
  }

  describePersistence(): AgentPersistenceHandle | null {
    return mapPersistenceToNanoclaw(this.delegate.describePersistence())
  }

  getAvailableModes(): Promise<AgentMode[]> {
    return this.delegate.getAvailableModes()
  }

  getCurrentMode(): Promise<string | null> {
    return this.delegate.getCurrentMode()
  }

  setMode(modeId: string): Promise<void> {
    return this.delegate.setMode(modeId)
  }

  interrupt(): Promise<void> {
    return this.delegate.interrupt()
  }

  close(): Promise<void> {
    return this.delegate.close()
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    if (!this.delegate.listCommands) {
      return []
    }
    return this.delegate.listCommands()
  }

  setModel(modelId: string | null): Promise<void> {
    return this.delegate.setModel?.(modelId) ?? Promise.resolve()
  }

  setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    return this.delegate.setThinkingOption?.(thinkingOptionId) ?? Promise.resolve()
  }
}

export class NanoclawAgentClient implements AgentClient {
  readonly provider = NANOCLAW_PROVIDER_ID
  private readonly delegate: ClaudeAgentClient

  constructor(options: { logger: Logger; runtimeSettings?: ProviderRuntimeSettings }) {
    const logger = options.logger.child({ module: 'agent', provider: NANOCLAW_PROVIDER_ID })
    this.delegate = new ClaudeAgentClient({
      logger,
      runtimeSettings: options.runtimeSettings,
    })
  }

  get capabilities() {
    return this.delegate.capabilities
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const delegateSession = await this.delegate.createSession(mapConfigToClaude(config))
    return new NanoclawSession(delegateSession)
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>
  ): Promise<AgentSession> {
    const mappedOverrides = overrides ? mapOverridesToClaude(overrides) : undefined
    const delegateSession = await this.delegate.resumeSession(
      mapPersistenceToClaude(handle),
      mappedOverrides
    )
    return new NanoclawSession(delegateSession)
  }

  async listModels(options?: ListModelsOptions): Promise<AgentModelDefinition[]> {
    const models = await this.delegate.listModels(options)
    return models.map((model) => ({
      ...model,
      provider: NANOCLAW_PROVIDER_ID,
      // Keep the native Claude label so users don't mistake it for a literal model id.
      label: model.label,
      metadata: {
        ...(model.metadata ?? {}),
        sourceProvider: model.provider,
      },
    }))
  }

  async isAvailable(): Promise<boolean> {
    // NanoClaw is always available — it runs as a separate daemon (port 6900)
    return true
  }
}
