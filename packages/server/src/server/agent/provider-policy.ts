import type { AgentProvider } from "./agent-sdk-types.js";
import {
  AGENT_PROVIDER_DEFINITIONS,
  AGENT_PROVIDER_IDS,
} from "./provider-manifest.js";

const ENABLED_PROVIDER_ENV_KEYS = [
  "PASEO_ENABLED_AGENT_PROVIDERS",
  "PASEO_AGENT_PROVIDERS",
] as const;

const VALID_PROVIDER_IDS = new Set<string>(AGENT_PROVIDER_IDS);

function getDefaultEnabledProviders(): Set<AgentProvider> {
  const defaults = AGENT_PROVIDER_DEFINITIONS.filter(
    (provider) => provider.enabledByDefault === true
  ).map((provider) => provider.id as AgentProvider);
  return new Set(defaults);
}

function parseEnabledProvidersFromEnv(
  env: NodeJS.ProcessEnv
): Set<AgentProvider> | null {
  const raw = ENABLED_PROVIDER_ENV_KEYS.map((key) => env[key]?.trim())
    .find((value) => typeof value === "string" && value.length > 0);
  if (!raw) {
    return null;
  }

  const tokens = raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  if (tokens.includes("all")) {
    return new Set(AGENT_PROVIDER_IDS as AgentProvider[]);
  }
  if (tokens.includes("default")) {
    return getDefaultEnabledProviders();
  }

  const providers = new Set<AgentProvider>();
  for (const token of tokens) {
    if (token === "none") {
      continue;
    }
    if (VALID_PROVIDER_IDS.has(token)) {
      providers.add(token as AgentProvider);
    }
  }

  if (tokens.includes("none")) {
    return providers;
  }
  if (providers.size > 0) {
    return providers;
  }

  // Invalid env values should not accidentally disable all providers.
  return getDefaultEnabledProviders();
}

export function resolveEnabledAgentProviders(options?: {
  explicit?: readonly AgentProvider[] | null;
  env?: NodeJS.ProcessEnv;
}): Set<AgentProvider> {
  const explicit = options?.explicit ?? null;
  if (Array.isArray(explicit)) {
    const providers = new Set<AgentProvider>();
    for (const provider of explicit) {
      if (VALID_PROVIDER_IDS.has(provider)) {
        providers.add(provider);
      }
    }
    return providers;
  }

  const fromEnv = parseEnabledProvidersFromEnv(options?.env ?? process.env);
  if (fromEnv) {
    return fromEnv;
  }

  return getDefaultEnabledProviders();
}

