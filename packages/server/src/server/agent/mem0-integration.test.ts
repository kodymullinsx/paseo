import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMem0ScopedUserId,
  searchMemories,
  storeMemory,
} from "./mem0-integration.js";

describe("mem0 integration helpers", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  } as any;

  beforeEach(() => {
    delete process.env.PASEO_MEM0_USER_ID;
    delete process.env.MEM0_USER_ID;
    delete process.env.PASEO_MEM0_QDRANT_URL;
    delete process.env.QDRANT_URL;
    delete process.env.PASEO_MEM0_QDRANT_API_KEY;
    delete process.env.QDRANT_API_KEY;
    process.env.PASEO_MEM0_ENABLED = "1";
    vi.clearAllMocks();
  });

  it("defaults to a shared user id across cwd values", () => {
    process.env.PASEO_MEM0_USER_ID = "circe";
    const first = buildMem0ScopedUserId("/Users/kodymullins/project-a");
    const second = buildMem0ScopedUserId("/Users/kodymullins/project-a");
    const third = buildMem0ScopedUserId("/Users/kodymullins/project-b");

    expect(first).toBe(second);
    expect(first).toBe("circe");
    expect(third).toBe(first);
  });

  it("can scope user id by cwd when enabled", () => {
    process.env.PASEO_MEM0_USER_ID = "circe";
    process.env.PASEO_MEM0_SCOPE_BY_CWD = "1";
    const first = buildMem0ScopedUserId("/Users/kodymullins/project-a");
    const second = buildMem0ScopedUserId("/Users/kodymullins/project-a");
    const third = buildMem0ScopedUserId("/Users/kodymullins/project-b");

    expect(first).toBe(second);
    expect(first).toMatch(/^circe:/);
    expect(third).not.toBe(first);
  });

  it("returns empty search results when mem0 config is absent", async () => {
    const results = await searchMemories(logger, "test prompt", {
      userId: "user",
      timeoutMs: 50,
    });
    expect(results).toEqual([]);
  });

  it("no-ops on store when mem0 config is absent", async () => {
    await expect(
      storeMemory(logger, "User: hi\nAssistant: hello", {
        userId: "user",
        timeoutMs: 50,
      })
    ).resolves.toBeUndefined();
  });
});
