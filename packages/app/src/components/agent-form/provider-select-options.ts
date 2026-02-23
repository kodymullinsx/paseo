import type { AgentProviderDefinition } from "@server/server/agent/provider-manifest";

export type ProviderSelectOption = {
  id: string;
  label: string;
};

export function buildProviderSelectOptions(
  providerDefinitions: AgentProviderDefinition[]
): ProviderSelectOption[] {
  return providerDefinitions.map((def) => ({
    id: def.id,
    label: def.label,
  }));
}
