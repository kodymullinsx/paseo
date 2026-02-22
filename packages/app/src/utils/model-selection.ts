import type { AgentModelDefinition } from "@server/server/agent/agent-sdk-types";

const LEGACY_PROVIDER_PREFIXES = ["nanoclaw", "circe", "claude", "codex", "opencode", "deepinfra"];
const CLAUDE_ALIAS_MODEL_IDS = new Set(["default", "sonnet", "opus", "haiku"]);

function normalizeModelToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "default") {
    return null;
  }
  return normalized;
}

function canonicalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripLegacyProviderPrefix(value: string): string {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  for (const prefix of LEGACY_PROVIDER_PREFIXES) {
    if (lower.startsWith(`${prefix} `)) {
      return normalized.slice(prefix.length + 1).trim();
    }
    if (lower.startsWith(`${prefix}:`)) {
      return normalized.slice(prefix.length + 1).trim();
    }
  }
  return normalized;
}

function parseParenthesizedModelId(value: string): string | null {
  const match = value.match(/\(([^()]+)\)\s*$/);
  if (!match) {
    return null;
  }
  return normalizeModelToken(match[1]);
}

export function normalizeSelectedModelId(
  modelId: string | null | undefined
): string {
  return normalizeModelToken(modelId) ?? "";
}

export function formatModelDisplayLabel(model: AgentModelDefinition): string {
  const normalizedLabel = stripLegacyProviderPrefix(model.label);
  const label = normalizedLabel.length > 0 ? normalizedLabel : model.label;
  if (!label) {
    return model.id;
  }

  const canonicalId = canonicalizeLabel(model.id);
  const canonicalLabel = canonicalizeLabel(label);
  if (canonicalLabel === canonicalId) {
    return model.id;
  }

  const sourceProviderRaw =
    typeof model.metadata?.sourceProvider === "string"
      ? model.metadata.sourceProvider
      : model.provider;
  const sourceProvider = sourceProviderRaw.toLowerCase();
  const isClaudeFamilySource =
    sourceProvider === "claude" || sourceProvider === "nanoclaw";
  if (isClaudeFamilySource && CLAUDE_ALIAS_MODEL_IDS.has(model.id.toLowerCase())) {
    return label;
  }

  return `${label} (${model.id})`;
}

export function resolveCatalogModelId(
  models: AgentModelDefinition[] | null | undefined,
  candidateValue: string | null | undefined
): string | null {
  const candidate = normalizeModelToken(candidateValue);
  if (!candidate || !models || models.length === 0) {
    return candidate;
  }

  const byExactId = models.find((model) => model.id === candidate);
  if (byExactId) {
    return byExactId.id;
  }

  const lowerCandidate = candidate.toLowerCase();
  const byCaseInsensitiveId = models.find(
    (model) => model.id.toLowerCase() === lowerCandidate
  );
  if (byCaseInsensitiveId) {
    return byCaseInsensitiveId.id;
  }

  const parenthesizedId = parseParenthesizedModelId(candidate);
  if (parenthesizedId) {
    const byParenthesizedId = models.find((model) => model.id === parenthesizedId);
    if (byParenthesizedId) {
      return byParenthesizedId.id;
    }
  }

  const strippedCandidate = stripLegacyProviderPrefix(candidate);
  const normalizedCandidates = new Set<string>([
    canonicalizeLabel(candidate),
    canonicalizeLabel(strippedCandidate),
  ]);

  const labelMatches = models.filter((model) =>
    normalizedCandidates.has(canonicalizeLabel(model.label))
  );
  if (labelMatches.length === 1) {
    return labelMatches[0]!.id;
  }

  const legacyDisplayMatches = models.filter((model) => {
    const legacyLabelFirst = canonicalizeLabel(`${model.label} (${model.id})`);
    const idFirst = canonicalizeLabel(`${model.id} (${model.label})`);
    return normalizedCandidates.has(legacyLabelFirst) || normalizedCandidates.has(idFirst);
  });
  if (legacyDisplayMatches.length === 1) {
    return legacyDisplayMatches[0]!.id;
  }

  return candidate;
}
