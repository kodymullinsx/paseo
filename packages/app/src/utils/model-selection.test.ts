import { describe, expect, it } from "vitest";
import type { AgentModelDefinition } from "@server/server/agent/agent-sdk-types";
import {
  formatModelDisplayLabel,
  normalizeSelectedModelId,
  resolveCatalogModelId,
} from "./model-selection";

const models: AgentModelDefinition[] = [
  {
    provider: "nanoclaw",
    id: "default",
    label: "Sonnet 4.5",
    description: "Recommended default",
  },
  {
    provider: "nanoclaw",
    id: "opus",
    label: "Opus 4.6",
    description: "Larger model",
  },
];

describe("model-selection", () => {
  it("normalizes blank/default model values to auto", () => {
    expect(normalizeSelectedModelId("")).toBe("");
    expect(normalizeSelectedModelId(" default ")).toBe("");
    expect(normalizeSelectedModelId(undefined)).toBe("");
  });

  it("maps legacy label-first display values to model ids", () => {
    expect(resolveCatalogModelId(models, "Sonnet 4.5 (default)")).toBe("default");
    expect(resolveCatalogModelId(models, "default (Sonnet 4.5)")).toBe("default");
  });

  it("maps provider-prefixed legacy labels to model ids", () => {
    expect(resolveCatalogModelId(models, "Nanoclaw Sonnet 4.5")).toBe("default");
    expect(resolveCatalogModelId(models, "nanoclaw: Opus 4.6")).toBe("opus");
  });

  it("shows friendly-only label for Claude-family alias ids", () => {
    expect(formatModelDisplayLabel(models[0]!)).toBe("Sonnet 4.5");
  });

  it("strips provider prefix from display labels", () => {
    expect(
      formatModelDisplayLabel({
        provider: "nanoclaw",
        id: "sonnet",
        label: "Nanoclaw Sonnet 4.5",
      })
    ).toBe("Sonnet 4.5");
  });

  it("uses friendly-name plus api id for non-claude providers", () => {
    expect(
      formatModelDisplayLabel({
        provider: "deepinfra",
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        label: "Llama 3.3 70B Turbo",
      })
    ).toBe("Llama 3.3 70B Turbo (meta-llama/Llama-3.3-70B-Instruct-Turbo)");
  });
});
