import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentModelDefinition,
  AgentProvider,
  AgentSession,
  AgentSessionConfig,
  AgentPersistenceHandle,
  ListModelsOptions,
} from './agent-sdk-types.js'
import type { AgentProviderRuntimeSettingsMap } from './provider-launch-config.js'
import type { Logger } from 'pino'

import { ClaudeAgentClient } from './providers/claude-agent.js'
import { CodexAppServerAgentClient } from './providers/codex-app-server-agent.js'
import { DeepInfraAgentClient } from './providers/deepinfra-agent.js'
import { NanoclawAgentClient } from './providers/nanoclaw-agent.js'
import { OpenCodeAgentClient, OpenCodeServerManager } from './providers/opencode-agent.js'

import {
  AGENT_PROVIDER_DEFINITIONS,
  AGENT_PROVIDER_IDS,
  getAgentProviderDefinition,
  type AgentProviderDefinition,
} from './provider-manifest.js'
import { resolveEnabledAgentProviders } from './provider-policy.js'

export type { AgentProviderDefinition }

export { AGENT_PROVIDER_DEFINITIONS, getAgentProviderDefinition }

export interface ProviderDefinition extends AgentProviderDefinition {
  createClient: (logger: Logger) => AgentClient
  fetchModels: (options?: ListModelsOptions) => Promise<AgentModelDefinition[]>
}

type BuildProviderRegistryOptions = {
  runtimeSettings?: AgentProviderRuntimeSettingsMap
  enabledProviders?: readonly AgentProvider[] | null
}

const DISABLED_PROVIDER_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
}

class DisabledAgentClient implements AgentClient {
  readonly capabilities = DISABLED_PROVIDER_CAPABILITIES

  constructor(
    readonly provider: AgentProvider,
    private readonly reason: string
  ) {}

  async createSession(_config: AgentSessionConfig): Promise<AgentSession> {
    throw new Error(this.reason)
  }

  async resumeSession(
    _handle: AgentPersistenceHandle,
    _overrides?: Partial<AgentSessionConfig>
  ): Promise<AgentSession> {
    throw new Error(this.reason)
  }

  async listModels(_options?: ListModelsOptions): Promise<AgentModelDefinition[]> {
    throw new Error(this.reason)
  }

  async isAvailable(): Promise<boolean> {
    return false
  }
}

function buildDisabledReason(
  provider: AgentProvider,
  enabledProviders: ReadonlySet<AgentProvider>
): string {
  const enabled = Array.from(enabledProviders).sort()
  const enabledText = enabled.length > 0 ? enabled.join(', ') : 'none'
  return [
    `Provider '${provider}' is disabled by policy.`,
    `Enabled providers: ${enabledText}.`,
    `Set PASEO_ENABLED_AGENT_PROVIDERS to override (for example: 'nanoclaw,deepinfra').`,
  ].join(' ')
}

export function buildProviderRegistry(
  logger: Logger,
  options?: BuildProviderRegistryOptions
): Record<AgentProvider, ProviderDefinition> {
  const runtimeSettings = options?.runtimeSettings
  const enabledProviders = resolveEnabledAgentProviders({
    explicit: options?.enabledProviders,
  })
  const isEnabled = (provider: AgentProvider) => enabledProviders.has(provider)
  const buildClient = (provider: AgentProvider, factory: () => AgentClient): AgentClient => {
    if (isEnabled(provider)) {
      return factory()
    }
    return new DisabledAgentClient(provider, buildDisabledReason(provider, enabledProviders))
  }

  const claudeClient = buildClient(
    'claude',
    () =>
      new ClaudeAgentClient({
        logger,
        runtimeSettings: runtimeSettings?.claude,
      })
  )
  const codexClient = buildClient(
    'codex',
    () => new CodexAppServerAgentClient(logger, runtimeSettings?.codex)
  )
  const opencodeClient = buildClient(
    'opencode',
    () => new OpenCodeAgentClient(logger, runtimeSettings?.opencode)
  )
  const deepinfraClient = buildClient(
    'deepinfra',
    () => new DeepInfraAgentClient(logger)
  )
  const nanoclawClient = buildClient(
    'nanoclaw',
    () =>
      new NanoclawAgentClient({
        logger,
        runtimeSettings: runtimeSettings?.nanoclaw,
      })
  )

  return {
    claude: {
      ...getAgentProviderDefinition('claude'),
      createClient: (logger: Logger) =>
        buildClient(
          'claude',
          () =>
            new ClaudeAgentClient({
              logger,
              runtimeSettings: runtimeSettings?.claude,
            })
        ),
      fetchModels: (options) => claudeClient.listModels(options),
    },
    codex: {
      ...getAgentProviderDefinition('codex'),
      createClient: (logger: Logger) =>
        buildClient(
          'codex',
          () => new CodexAppServerAgentClient(logger, runtimeSettings?.codex)
        ),
      fetchModels: (options) => codexClient.listModels(options),
    },
    opencode: {
      ...getAgentProviderDefinition('opencode'),
      createClient: (logger: Logger) =>
        buildClient(
          'opencode',
          () => new OpenCodeAgentClient(logger, runtimeSettings?.opencode)
        ),
      fetchModels: (options) => opencodeClient.listModels(options),
    },
    deepinfra: {
      ...getAgentProviderDefinition('deepinfra'),
      createClient: (logger: Logger) =>
        buildClient(
          'deepinfra',
          () => new DeepInfraAgentClient(logger)
        ),
      fetchModels: (options) => deepinfraClient.listModels(options),
    },
    nanoclaw: {
      ...getAgentProviderDefinition('nanoclaw'),
      createClient: (logger: Logger) =>
        buildClient(
          'nanoclaw',
          () =>
            new NanoclawAgentClient({
              logger,
              runtimeSettings: runtimeSettings?.nanoclaw,
            })
        ),
      fetchModels: (options) => nanoclawClient.listModels(options),
    },
  }
}

// Deprecated: Use buildProviderRegistry instead
export const PROVIDER_REGISTRY: Record<AgentProvider, ProviderDefinition> = null as any

export function createAllClients(
  logger: Logger,
  options?: BuildProviderRegistryOptions
): Record<AgentProvider, AgentClient> {
  const registry = buildProviderRegistry(logger, options)
  return AGENT_PROVIDER_IDS.reduce(
    (acc, provider) => {
      acc[provider] = registry[provider].createClient(logger)
      return acc
    },
    {} as Record<AgentProvider, AgentClient>
  )
}

function isOpencodeEnabled(options?: BuildProviderRegistryOptions): boolean {
  const enabledProviders = resolveEnabledAgentProviders({
    explicit: options?.enabledProviders,
  })
  return enabledProviders.has('opencode')
}

export async function shutdownProviders(
  logger: Logger,
  options?: BuildProviderRegistryOptions
): Promise<void> {
  if (!isOpencodeEnabled(options)) {
    return
  }
  await OpenCodeServerManager.getInstance(logger, options?.runtimeSettings?.opencode).shutdown()
}
