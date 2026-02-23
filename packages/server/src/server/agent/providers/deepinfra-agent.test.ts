import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { DeepInfraAgentClient } from "./deepinfra-agent.js";

const ORIGINAL_FETCH = globalThis.fetch;

describe("DeepInfraAgentClient", () => {
  beforeEach(() => {
    process.env.DEEPINFRA_API_KEY = "test-key";
    process.env.DEEPINFRA_API_BASE_URL = "https://api.deepinfra.com";
  });

  afterEach(() => {
    delete process.env.DEEPINFRA_API_KEY;
    delete process.env.DEEPINFRA_API_BASE_URL;
    vi.restoreAllMocks();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("lists provider-local slash commands", async () => {
    const client = new DeepInfraAgentClient(createTestLogger());
    const session = await client.createSession({
      provider: "deepinfra",
      cwd: "/tmp",
    });

    const commands = await session.listCommands?.();

    expect(commands?.map((command) => command.name)).toEqual(
      expect.arrayContaining(["model", "status"])
    );
  });

  it("/status reports active provider and model", async () => {
    const client = new DeepInfraAgentClient(createTestLogger());
    const session = await client.createSession({
      provider: "deepinfra",
      cwd: "/tmp",
      model: "meta-llama/Meta-Llama-3.1-8B-Instruct",
    });

    const events = [] as Array<{ type: string; text?: string }>;
    for await (const event of session.stream("/status")) {
      if (event.type === "timeline" && event.item.type === "assistant_message") {
        events.push({ type: event.type, text: event.item.text });
      } else {
        events.push({ type: event.type });
      }
    }

    expect(events.some((event) => event.type === "turn_started")).toBe(true);
    expect(events.some((event) => event.type === "turn_completed")).toBe(true);
    expect(events.some((event) => event.text?.includes("Provider: deepinfra"))).toBe(true);
    expect(
      events.some((event) =>
        event.text?.includes("Model: meta-llama/Meta-Llama-3.1-8B-Instruct")
      )
    ).toBe(true);
  });

  it("/model lists and switches DeepInfra models in-session", async () => {
    const fetchMock = vi
      .fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
            { id: "Qwen/Qwen3-235B-A22B-Thinking-2507" },
          ],
        }),
      }))
      .mockName("fetch");

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new DeepInfraAgentClient(createTestLogger());
    const session = await client.createSession({
      provider: "deepinfra",
      cwd: "/tmp",
    });

    const listOutput: string[] = [];
    for await (const event of session.stream("/model")) {
      if (event.type === "timeline" && event.item.type === "assistant_message") {
        listOutput.push(event.item.text);
      }
    }

    expect(listOutput.join("\n")).toContain("Available DeepInfra models");
    expect(listOutput.join("\n")).toContain("meta-llama/Meta-Llama-3.1-8B-Instruct");

    const switchOutput: string[] = [];
    for await (const event of session.stream("/model Qwen/Qwen3-235B-A22B-Thinking-2507")) {
      if (event.type === "timeline" && event.item.type === "assistant_message") {
        switchOutput.push(event.item.text);
      }
    }

    expect(switchOutput.join("\n")).toContain(
      "DeepInfra model switched to: Qwen/Qwen3-235B-A22B-Thinking-2507"
    );

    const runtime = await session.getRuntimeInfo();
    expect(runtime.provider).toBe("deepinfra");
    expect(runtime.model).toBe("Qwen/Qwen3-235B-A22B-Thinking-2507");
  });

  it("lists models when API base URL already includes /v1/openai", async () => {
    process.env.DEEPINFRA_API_BASE_URL = "https://api.deepinfra.com/v1/openai";
    const fetchMock = vi
      .fn(async (url: string | URL) => {
        if (String(url) === "https://api.deepinfra.com/v1/openai/models") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: "deepseek-ai/DeepSeek-V3.2" },
                { id: "Qwen/Qwen3-235B-A22B-Instruct-2507" },
              ],
            }),
          };
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        };
      })
      .mockName("fetch");

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new DeepInfraAgentClient(createTestLogger());
    const models = await client.listModels();
    const requestedUrls = fetchMock.mock.calls.map(([url]) => String(url));

    expect(models.map((model) => model.id)).toEqual([
      "deepseek-ai/DeepSeek-V3.2",
      "Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
    expect(requestedUrls).toContain("https://api.deepinfra.com/v1/openai/models");
    expect(requestedUrls).not.toContain("https://api.deepinfra.com/v1/openai/v1/openai/models");
  });

  it("reports unavailable when API key is missing", async () => {
    delete process.env.DEEPINFRA_API_KEY;
    const client = new DeepInfraAgentClient(createTestLogger());
    await expect(client.isAvailable()).resolves.toBe(false);
  });
});
