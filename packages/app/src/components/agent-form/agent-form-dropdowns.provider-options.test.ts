import { describe, expect, it } from "vitest";
import { AGENT_PROVIDER_DEFINITIONS } from "@server/server/agent/provider-manifest";
import { buildProviderSelectOptions } from "./provider-select-options";

describe("buildProviderSelectOptions", () => {
  it("maps provider definitions to stable id/label options in manifest order", () => {
    const options = buildProviderSelectOptions(AGENT_PROVIDER_DEFINITIONS);

    expect(options).toEqual(
      AGENT_PROVIDER_DEFINITIONS.map((definition) => ({
        id: definition.id,
        label: definition.label,
      }))
    );
  });

  it("includes nanoclaw and deepinfra for cross-provider fallback UX", () => {
    const options = buildProviderSelectOptions(AGENT_PROVIDER_DEFINITIONS);
    const ids = options.map((option) => option.id);

    expect(ids).toContain("nanoclaw");
    expect(ids).toContain("deepinfra");
  });
});
