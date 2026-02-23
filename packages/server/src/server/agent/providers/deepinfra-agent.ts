import { randomUUID } from "node:crypto";

import OpenAI from "openai";
import type { Logger } from "pino";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentMode,
  AgentModelDefinition,
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
  AgentUsage,
  ListModelsOptions,
  ListPersistedAgentsOptions,
  PersistedAgentDescriptor,
} from "../agent-sdk-types.js";
import { listDeepInfraModels } from "./deepinfra-model-catalog.js";

const DEEPINFRA_PROVIDER = "deepinfra" as const;
const DEFAULT_DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai";
const DEFAULT_MODE: AgentMode = {
  id: "default",
  label: "Default",
  description: "API-based DeepInfra session",
};

const DEEPINFRA_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

type DeepInfraAgentConfig = AgentSessionConfig & { provider: typeof DEEPINFRA_PROVIDER };

type DeepInfraMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function normalizeOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveDeepInfraApiKey(value?: string | null): string {
  const apiKey = normalizeOptional(value ?? process.env.DEEPINFRA_API_KEY);
  if (!apiKey) {
    throw new Error(
      "DeepInfra API key is missing. Set DEEPINFRA_API_KEY to enable this provider."
    );
  }
  return apiKey;
}

function resolveDeepInfraBaseUrl(value?: string | null): string {
  const configured = normalizeOptional(value ?? process.env.DEEPINFRA_API_BASE_URL);
  if (!configured) {
    return DEFAULT_DEEPINFRA_BASE_URL;
  }
  const trimmed = configured.endsWith("/") ? configured.slice(0, -1) : configured;
  return trimmed;
}

function resolveDeepInfraCatalogBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return trimmed.replace(/\/v1\/openai$/i, "");
}

function normalizeDeepInfraModel(modelId: string | null | undefined): string | null {
  const normalized = normalizeOptional(modelId);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("deepinfra/")) {
    return normalized.slice("deepinfra/".length);
  }
  return normalized;
}

function promptToText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt;
  }
  const text = prompt
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  return text;
}

function parseSlashCommand(input: string): { command: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/") || trimmed.length <= 1) {
    return null;
  }
  const withoutPrefix = trimmed.slice(1).trim();
  if (!withoutPrefix) {
    return null;
  }
  const firstWhitespace = withoutPrefix.search(/\s/);
  if (firstWhitespace === -1) {
    return { command: withoutPrefix.toLowerCase(), args: "" };
  }
  return {
    command: withoutPrefix.slice(0, firstWhitespace).toLowerCase(),
    args: withoutPrefix.slice(firstWhitespace + 1).trim(),
  };
}

function extractCandidateModelId(value: string): string {
  const trimmed = value.trim();
  const parenthesized = trimmed.match(/\(([^()]+)\)\s*$/);
  if (parenthesized?.[1]) {
    return parenthesized[1].trim();
  }
  return trimmed;
}

function toUsage(raw: unknown): AgentUsage | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const usage = raw as Record<string, unknown>;
  const inputTokens =
    typeof usage.prompt_tokens === "number"
      ? usage.prompt_tokens
      : typeof usage.input_tokens === "number"
        ? usage.input_tokens
        : undefined;
  const outputTokens =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : undefined;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;

  if (
    typeof inputTokens !== "number" &&
    typeof outputTokens !== "number" &&
    typeof totalTokens !== "number"
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
  };
}

function mapDeepInfraError(error: unknown): Error {
  const fallbackMessage = error instanceof Error ? error.message : String(error);
  const status =
    typeof (error as { status?: unknown })?.status === "number"
      ? ((error as { status: number }).status as number)
      : null;

  if (status === 401 || status === 403) {
    return new Error(
      "DeepInfra authentication failed (401/403). Verify DEEPINFRA_API_KEY and account access."
    );
  }
  if (status === 429) {
    return new Error(
      "DeepInfra rate limit reached (429). Retry shortly or switch model/provider."
    );
  }
  if (typeof status === "number" && status >= 500) {
    return new Error(
      `DeepInfra is currently unavailable (${status}). Retry shortly or switch provider.`
    );
  }

  return new Error(`DeepInfra request failed: ${fallbackMessage}`);
}

async function resolveDefaultDeepInfraModel(options: {
  apiKey: string;
  baseUrl: string;
}): Promise<string> {
  const envDefault = normalizeDeepInfraModel(process.env.DEEPINFRA_DEFAULT_MODEL);
  if (envDefault) {
    return envDefault;
  }

  const models = await listDeepInfraModels({
    apiKey: options.apiKey,
    baseUrl: resolveDeepInfraCatalogBaseUrl(options.baseUrl),
    providerId: DEEPINFRA_PROVIDER,
    modelIdPrefix: "",
  });

  const preferred =
    models.find((model) => model.isDefault) ??
    models[0] ??
    null;
  const modelId = normalizeDeepInfraModel(preferred?.id);
  if (!modelId) {
    throw new Error(
      "No DeepInfra models were returned. Check API key permissions and available model catalog."
    );
  }
  return modelId;
}

function serializeMessages(messages: DeepInfraMessage[]): DeepInfraMessage[] {
  return messages.map((message) => ({ ...message }));
}

function parsePersistedMessages(metadata: unknown): DeepInfraMessage[] {
  const record = metadata as Record<string, unknown> | null | undefined;
  const rawMessages = Array.isArray(record?.messages) ? record.messages : [];
  const out: DeepInfraMessage[] = [];

  for (const entry of rawMessages) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if (
      (role === "system" || role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.trim().length > 0
    ) {
      out.push({ role, content });
    }
  }

  return out;
}

class DeepInfraAgentSession implements AgentSession {
  readonly provider = DEEPINFRA_PROVIDER;
  readonly capabilities = DEEPINFRA_CAPABILITIES;

  private readonly sessionId: string;
  private readonly config: DeepInfraAgentConfig;
  private readonly client: OpenAI;
  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly messages: DeepInfraMessage[];
  private readonly availableModes: AgentMode[] = [DEFAULT_MODE];

  constructor(options: {
    config: DeepInfraAgentConfig;
    client: OpenAI;
    logger: Logger;
    baseUrl: string;
    sessionId?: string;
    initialMessages?: DeepInfraMessage[];
  }) {
    this.config = options.config;
    this.client = options.client;
    this.logger = options.logger;
    this.baseUrl = options.baseUrl;
    this.sessionId = options.sessionId ?? randomUUID();
    this.messages = Array.isArray(options.initialMessages)
      ? serializeMessages(options.initialMessages)
      : [];

    const systemPrompt = normalizeOptional(this.config.systemPrompt);
    if (systemPrompt && !this.messages.some((message) => message.role === "system")) {
      this.messages.unshift({ role: "system", content: systemPrompt });
    }
  }

  get id(): string {
    return this.sessionId;
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    const timeline: AgentTimelineItem[] = [];
    let finalText = "";
    let usage: AgentUsage | undefined;

    for await (const event of this.stream(prompt, options)) {
      if (event.type === "timeline") {
        timeline.push(event.item);
        if (event.item.type === "assistant_message") {
          finalText = event.item.text;
        }
      }
      if (event.type === "turn_completed") {
        usage = event.usage;
      }
      if (event.type === "turn_failed") {
        throw new Error(event.error);
      }
    }

    return {
      sessionId: this.sessionId,
      finalText,
      usage,
      timeline,
    };
  }

  async *stream(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions
  ): AsyncGenerator<AgentStreamEvent> {
    const promptText = promptToText(prompt).trim();
    if (!promptText) {
      const message = "DeepInfra prompt is empty";
      yield { type: "turn_failed", provider: DEEPINFRA_PROVIDER, error: message };
      return;
    }

    const slash = parseSlashCommand(promptText);
    if (slash?.command === "status") {
      yield* this.streamStatusCommand();
      return;
    }
    if (slash?.command === "model") {
      yield* this.streamModelCommand(slash.args);
      return;
    }

    const model = await this.ensureModel();
    const userMessage: DeepInfraMessage = { role: "user", content: promptText };
    this.messages.push(userMessage);

    yield { type: "turn_started", provider: DEEPINFRA_PROVIDER };
    yield {
      type: "timeline",
      provider: DEEPINFRA_PROVIDER,
      item: { type: "user_message", text: promptText },
    };

    try {
      let assistantText = "";
      let usage: AgentUsage | undefined;

      const stream = await this.client.chat.completions.create({
        model,
        messages: this.messages as any,
        stream: true,
        stream_options: {
          include_usage: true,
        },
      });

      for await (const chunk of stream as AsyncIterable<unknown>) {
        const typedChunk = chunk as Record<string, unknown>;
        const chunkUsage = toUsage((typedChunk as { usage?: unknown }).usage);
        if (chunkUsage) {
          usage = chunkUsage;
        }

        const choices = Array.isArray((typedChunk as { choices?: unknown }).choices)
          ? ((typedChunk as { choices?: unknown[] }).choices ?? [])
          : [];
        const delta = (choices[0] as { delta?: { content?: unknown } } | undefined)?.delta;
        const content = typeof delta?.content === "string" ? delta.content : null;
        if (!content) {
          continue;
        }

        assistantText += content;
        yield {
          type: "timeline",
          provider: DEEPINFRA_PROVIDER,
          item: { type: "assistant_message", text: assistantText },
        };
      }

      const finalizedText = assistantText.trim();
      const finalAssistant = finalizedText.length > 0 ? finalizedText : "(No response)";
      this.messages.push({ role: "assistant", content: finalAssistant });

      if (!assistantText) {
        yield {
          type: "timeline",
          provider: DEEPINFRA_PROVIDER,
          item: { type: "assistant_message", text: finalAssistant },
        };
      }

      yield {
        type: "turn_completed",
        provider: DEEPINFRA_PROVIDER,
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      const mapped = mapDeepInfraError(error);
      this.logger.warn({ err: error }, "DeepInfra stream failed");
      yield {
        type: "timeline",
        provider: DEEPINFRA_PROVIDER,
        item: { type: "error", message: mapped.message },
      };
      yield { type: "turn_failed", provider: DEEPINFRA_PROVIDER, error: mapped.message };
    }
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    return;
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: DEEPINFRA_PROVIDER,
      sessionId: this.sessionId,
      model: normalizeDeepInfraModel(this.config.model),
      modeId: DEFAULT_MODE.id,
      extra: {
        baseUrl: this.baseUrl,
      },
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return this.availableModes;
  }

  async getCurrentMode(): Promise<string> {
    return DEFAULT_MODE.id;
  }

  async setMode(_modeId: string): Promise<void> {
    return;
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [];
  }

  async respondToPermission(
    _requestId: string,
    _response: AgentPermissionResponse
  ): Promise<void> {
    throw new Error("DeepInfra provider does not support interactive permission prompts");
  }

  describePersistence(): AgentPersistenceHandle {
    return {
      provider: DEEPINFRA_PROVIDER,
      sessionId: this.sessionId,
      nativeHandle: this.sessionId,
      metadata: {
        cwd: this.config.cwd,
        model: normalizeDeepInfraModel(this.config.model),
        modeId: DEFAULT_MODE.id,
        baseUrl: this.baseUrl,
        messages: serializeMessages(this.messages).slice(-120),
      },
    };
  }

  async interrupt(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    return;
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    return [
      {
        name: "status",
        description: "Show active provider/model and current DeepInfra session settings",
        argumentHint: "",
      },
      {
        name: "model",
        description: "List available DeepInfra models or switch models for this session",
        argumentHint: "[model-id]",
      },
    ];
  }

  async setModel(modelId: string | null): Promise<void> {
    this.config.model = normalizeDeepInfraModel(modelId) ?? undefined;
  }

  async setThinkingOption(_thinkingOptionId: string | null): Promise<void> {
    return;
  }

  private async ensureModel(): Promise<string> {
    const existing = normalizeDeepInfraModel(this.config.model);
    if (existing) {
      return existing;
    }

    const model = await resolveDefaultDeepInfraModel({
      apiKey: resolveDeepInfraApiKey(undefined),
      baseUrl: this.baseUrl,
    });
    this.config.model = model;
    return model;
  }

  private async *streamStatusCommand(): AsyncGenerator<AgentStreamEvent> {
    yield { type: "turn_started", provider: DEEPINFRA_PROVIDER };

    const model = normalizeDeepInfraModel(this.config.model) ?? "auto";
    const statusText = [
      "DeepInfra session status:",
      `- Provider: deepinfra`,
      `- Model: ${model}`,
      `- Base URL: ${this.baseUrl}`,
      "- Slash commands: /model, /status",
    ].join("\n");

    yield {
      type: "timeline",
      provider: DEEPINFRA_PROVIDER,
      item: { type: "assistant_message", text: statusText },
    };

    yield { type: "turn_completed", provider: DEEPINFRA_PROVIDER };
  }

  private async *streamModelCommand(args: string): AsyncGenerator<AgentStreamEvent> {
    yield { type: "turn_started", provider: DEEPINFRA_PROVIDER };

    try {
      const models = await listDeepInfraModels({
        apiKey: resolveDeepInfraApiKey(undefined),
        baseUrl: resolveDeepInfraCatalogBaseUrl(this.baseUrl),
        providerId: DEEPINFRA_PROVIDER,
        modelIdPrefix: "",
      });

      if (args.trim().length === 0) {
        const activeModel = normalizeDeepInfraModel(this.config.model) ?? "auto";
        const lines = models.slice(0, 25).map((model) => `- ${model.id}`);
        const body = [
          `Active model: ${activeModel}`,
          "Available DeepInfra models:",
          ...lines,
          ...(models.length > 25
            ? [`- ...and ${models.length - 25} more`, "Use /model <model-id> to switch."]
            : ["Use /model <model-id> to switch."]),
        ].join("\n");

        yield {
          type: "timeline",
          provider: DEEPINFRA_PROVIDER,
          item: { type: "assistant_message", text: body },
        };
        yield { type: "turn_completed", provider: DEEPINFRA_PROVIDER };
        return;
      }

      const requestedRaw = extractCandidateModelId(args);
      const requested = normalizeDeepInfraModel(requestedRaw);
      if (!requested) {
        throw new Error("Usage: /model <model-id>");
      }

      const match =
        models.find((model) => model.id === requested) ??
        models.find((model) => model.id.toLowerCase() === requested.toLowerCase());

      if (!match) {
        const hint = models.slice(0, 10).map((model) => model.id).join(", ");
        throw new Error(`Unknown DeepInfra model '${requested}'. Available examples: ${hint}`);
      }

      this.config.model = match.id;
      const confirmation = `DeepInfra model switched to: ${match.id}`;
      yield {
        type: "timeline",
        provider: DEEPINFRA_PROVIDER,
        item: { type: "assistant_message", text: confirmation },
      };
      yield { type: "turn_completed", provider: DEEPINFRA_PROVIDER };
    } catch (error) {
      const mapped = mapDeepInfraError(error);
      yield {
        type: "timeline",
        provider: DEEPINFRA_PROVIDER,
        item: { type: "error", message: mapped.message },
      };
      yield { type: "turn_failed", provider: DEEPINFRA_PROVIDER, error: mapped.message };
    }
  }
}

export class DeepInfraAgentClient implements AgentClient {
  readonly provider = DEEPINFRA_PROVIDER;
  readonly capabilities = DEEPINFRA_CAPABILITIES;

  private readonly logger: Logger;
  private readonly baseUrl: string;

  constructor(logger: Logger) {
    this.logger = logger.child({ module: "agent", provider: DEEPINFRA_PROVIDER });
    this.baseUrl = resolveDeepInfraBaseUrl(undefined);
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const normalized = this.assertConfig(config);
    const apiKey = resolveDeepInfraApiKey(undefined);
    const model = normalizeDeepInfraModel(normalized.model);

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    });

    return new DeepInfraAgentSession({
      config: {
        ...normalized,
        ...(model ? { model } : {}),
      },
      client,
      logger: this.logger,
      baseUrl: this.baseUrl,
    });
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>
  ): Promise<AgentSession> {
    const metadata = (handle.metadata ?? {}) as Record<string, unknown>;
    const cwd =
      normalizeOptional(overrides?.cwd) ??
      (typeof metadata.cwd === "string" ? metadata.cwd : null) ??
      process.cwd();

    const restoredModel =
      normalizeDeepInfraModel(overrides?.model) ??
      (typeof metadata.model === "string" ? normalizeDeepInfraModel(metadata.model) : null);

    const config: AgentSessionConfig = {
      provider: DEEPINFRA_PROVIDER,
      cwd,
      ...(restoredModel ? { model: restoredModel } : {}),
      ...(overrides?.systemPrompt ? { systemPrompt: overrides.systemPrompt } : {}),
    };
    const initialMessages = parsePersistedMessages(metadata);
    return new DeepInfraAgentSession({
      config: {
        ...(config as DeepInfraAgentConfig),
      },
      client: new OpenAI({
        apiKey: resolveDeepInfraApiKey(undefined),
        baseURL: this.baseUrl,
      }),
      logger: this.logger,
      baseUrl: this.baseUrl,
      sessionId: handle.sessionId,
      initialMessages: initialMessages.length > 0 ? initialMessages : undefined,
    });
  }

  async listModels(_options?: ListModelsOptions): Promise<AgentModelDefinition[]> {
    const apiKey = resolveDeepInfraApiKey(undefined);
    const models = await listDeepInfraModels({
      apiKey,
      baseUrl: resolveDeepInfraCatalogBaseUrl(this.baseUrl),
      providerId: DEEPINFRA_PROVIDER,
      modelIdPrefix: "",
    });

    const envDefault = normalizeDeepInfraModel(process.env.DEEPINFRA_DEFAULT_MODEL);
    const firstModel = models[0]?.id;
    const defaultModel = envDefault ?? firstModel ?? null;

    return models.map((model) => ({
      ...model,
      provider: DEEPINFRA_PROVIDER,
      isDefault: defaultModel ? model.id === defaultModel : model.isDefault,
    }));
  }

  async listPersistedAgents(_options?: ListPersistedAgentsOptions): Promise<PersistedAgentDescriptor[]> {
    return [];
  }

  async isAvailable(): Promise<boolean> {
    try {
      resolveDeepInfraApiKey(undefined);
      return true;
    } catch {
      return false;
    }
  }

  private assertConfig(config: AgentSessionConfig): DeepInfraAgentConfig {
    if (config.provider !== DEEPINFRA_PROVIDER) {
      throw new Error(
        `DeepInfraAgentClient received config for provider '${config.provider}'`
      );
    }
    return { ...config, provider: DEEPINFRA_PROVIDER };
  }
}
