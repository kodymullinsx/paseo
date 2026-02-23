import { describe, expect, it } from "vitest";

import { AGENT_PROVIDER_IDS } from "./provider-manifest.js";
import { resolveEnabledAgentProviders } from "./provider-policy.js";

describe("resolveEnabledAgentProviders", () => {
  it("defaults to nanoclaw + deepinfra policy", () => {
    const enabled = resolveEnabledAgentProviders({ env: {} });
    expect(Array.from(enabled).sort()).toEqual(["deepinfra", "nanoclaw"]);
  });

  it("supports enabling all providers through env", () => {
    const enabled = resolveEnabledAgentProviders({
      env: { PASEO_ENABLED_AGENT_PROVIDERS: "all" },
    });
    expect(Array.from(enabled).sort()).toEqual([...AGENT_PROVIDER_IDS].sort());
  });

  it("supports explicit provider allowlist through env", () => {
    const enabled = resolveEnabledAgentProviders({
      env: { PASEO_ENABLED_AGENT_PROVIDERS: "nanoclaw,codex" },
    });
    expect(Array.from(enabled).sort()).toEqual(["codex", "nanoclaw"]);
  });

  it("supports none through env", () => {
    const enabled = resolveEnabledAgentProviders({
      env: { PASEO_ENABLED_AGENT_PROVIDERS: "none" },
    });
    expect(Array.from(enabled)).toEqual([]);
  });

  it("falls back to defaults when env has only invalid provider ids", () => {
    const enabled = resolveEnabledAgentProviders({
      env: { PASEO_ENABLED_AGENT_PROVIDERS: "fake-provider,another-one" },
    });
    expect(Array.from(enabled).sort()).toEqual(["deepinfra", "nanoclaw"]);
  });

  it("uses explicit provider list over env when provided", () => {
    const enabled = resolveEnabledAgentProviders({
      explicit: ["opencode", "nanoclaw"],
      env: { PASEO_ENABLED_AGENT_PROVIDERS: "none" },
    });
    expect(Array.from(enabled).sort()).toEqual(["nanoclaw", "opencode"]);
  });
});
