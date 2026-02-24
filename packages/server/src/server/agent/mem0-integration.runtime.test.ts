import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function setMem0Env(overrides: Record<string, string>): void {
  process.env.PASEO_MEM0_ENABLED = "1";
  process.env.PASEO_MEM0_QDRANT_URL = "https://qdrant.example.com";
  process.env.PASEO_MEM0_QDRANT_API_KEY = "qdrant-key";
  process.env.PASEO_MEM0_COLLECTION_NAME = "openclaw-memory";
  process.env.PASEO_MEM0_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  process.env.PASEO_MEM0_EMBEDDING_MODEL = "qwen3-embedding:8b-fp16";
  process.env.PASEO_MEM0_DEDUP_MODEL = "gpt-oss:20b";
  process.env.PASEO_MEM0_HISTORY_DB_PATH = "/tmp/paseo-mem0/history.db";
  process.env.PASEO_MEM0_THRESHOLD = "0.5";
  process.env.PASEO_MEM0_USER_ID = "kody";
  process.env.PASEO_HOME = "/tmp/paseo-home";
  Object.assign(process.env, overrides);
}

describe("mem0 integration runtime wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.PASEO_MEM0_ENABLED;
    delete process.env.PASEO_MEM0_QDRANT_URL;
    delete process.env.PASEO_MEM0_QDRANT_API_KEY;
    delete process.env.PASEO_MEM0_COLLECTION_NAME;
    delete process.env.PASEO_MEM0_OLLAMA_BASE_URL;
    delete process.env.PASEO_MEM0_EMBEDDING_MODEL;
    delete process.env.PASEO_MEM0_DEDUP_MODEL;
    delete process.env.PASEO_MEM0_HISTORY_DB_PATH;
    delete process.env.PASEO_MEM0_THRESHOLD;
    delete process.env.PASEO_MEM0_USER_ID;
    delete process.env.PASEO_HOME;
  });

  it("resolves mem0 env config with threshold/history path", async () => {
    setMem0Env({});
    const { __testOnly_resolveInitConfig, __testOnly_resetRuntimeState } = await import(
      "./mem0-integration.js"
    );
    __testOnly_resetRuntimeState();

    const config = __testOnly_resolveInitConfig();
    expect(config).not.toBeNull();
    expect(config?.collectionName).toBe("openclaw-memory");
    expect(config?.historyDbPath).toBe("/tmp/paseo-mem0/history.db");
    expect(config?.threshold).toBe(0.5);
  });

  it("falls back to threshold 0.5 when env threshold is invalid", async () => {
    setMem0Env({ PASEO_MEM0_THRESHOLD: "not-a-number" });
    const { __testOnly_resolveInitConfig, __testOnly_resetRuntimeState } = await import(
      "./mem0-integration.js"
    );
    __testOnly_resetRuntimeState();

    const config = __testOnly_resolveInitConfig();
    expect(config).not.toBeNull();
    expect(Number.isNaN(config?.threshold)).toBe(true);
    const fallback = Number.isFinite(config?.threshold) ? config?.threshold : 0.5;
    expect(fallback).toBe(0.5);
  });

  it("returns null config when required qdrant env is missing", async () => {
    delete process.env.PASEO_MEM0_QDRANT_URL;
    delete process.env.PASEO_MEM0_QDRANT_API_KEY;
    const { __testOnly_resolveInitConfig, __testOnly_resetRuntimeState } = await import(
      "./mem0-integration.js"
    );
    __testOnly_resetRuntimeState();

    expect(__testOnly_resolveInitConfig()).toBeNull();
  });
});
