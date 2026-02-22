import { describe, expect, test, vi } from "vitest";

import {
  applyClaudePermissionSafeguards,
  sanitizeClaudeExtraOptions,
} from "./claude-agent.js";

describe("sanitizeClaudeExtraOptions", () => {
  test("keeps supported tool fields and drops invalid entries", () => {
    const hook = vi.fn(async () => ({ continue: true }));
    const issues: string[] = [];

    const options = sanitizeClaudeExtraOptions(
      {
        allowedTools: [" Bash ", "Read", 123, "Read"],
        disallowedTools: ["Write", ""],
        plugins: [
          { type: "local", path: " ./plugins/test " },
          { type: "remote", path: "./ignored" },
        ],
        hooks: {
          PreToolUse: [{ hooks: [hook], matcher: " Bash", timeout: 10 }],
          NotAHook: [{ hooks: [hook] }],
        },
        canUseTool: true,
      },
      issues
    );

    expect(options?.allowedTools).toEqual(["Bash", "Read"]);
    expect(options?.disallowedTools).toEqual(["Write"]);
    expect(options?.plugins).toEqual([{ type: "local", path: "./plugins/test" }]);
    expect(options?.hooks?.PreToolUse).toHaveLength(1);
    expect(options?.hooks?.PreToolUse?.[0]?.hooks[0]).toBe(hook);
    expect(options?.hooks).not.toHaveProperty("NotAHook");
    expect(options).not.toHaveProperty("canUseTool");
    expect(issues.some((issue) => issue.includes("not supported"))).toBe(true);
  });

  test("sanitizes sandbox and numeric SDK options", () => {
    const issues: string[] = [];
    const options = sanitizeClaudeExtraOptions(
      {
        sandbox: {
          enabled: true,
          network: {
            allowedDomains: [" example.com "],
            allowLocalBinding: true,
            httpProxyPort: 8080,
          },
          ripgrep: { command: " rg ", args: [" --hidden "] },
        },
        tools: { type: "preset", preset: "claude_code" },
        maxThinkingTokens: 2048.7,
        maxTurns: 5.2,
        maxBudgetUsd: 2.5,
        permissionPromptToolName: " request_permission ",
        strictMcpConfig: true,
        fallbackModel: " claude-opus-4-20250514 ",
        betas: [" context-1m-2025-08-07 "],
      },
      issues
    );

    expect(options?.sandbox?.enabled).toBe(true);
    expect(options?.sandbox?.network?.allowedDomains).toEqual(["example.com"]);
    expect(options?.sandbox?.network?.httpProxyPort).toBe(8080);
    expect(options?.sandbox?.ripgrep).toEqual({
      command: "rg",
      args: ["--hidden"],
    });
    expect(options?.tools).toEqual({ type: "preset", preset: "claude_code" });
    expect(options?.maxThinkingTokens).toBe(2048);
    expect(options?.maxTurns).toBe(5);
    expect(options?.maxBudgetUsd).toBe(2.5);
    expect(options?.permissionPromptToolName).toBe("request_permission");
    expect(options?.strictMcpConfig).toBe(true);
    expect(options?.fallbackModel).toBe("claude-opus-4-20250514");
    expect(options?.betas).toEqual(["context-1m-2025-08-07"]);
    expect(issues).toEqual([]);
  });
});

describe("applyClaudePermissionSafeguards", () => {
  test("forces bypass safety flag when bypass mode is active", () => {
    const guarded = applyClaudePermissionSafeguards(
      { allowedTools: ["Bash"] },
      "bypassPermissions"
    );

    expect(guarded?.allowDangerouslySkipPermissions).toBe(true);
    expect(guarded?.allowedTools).toEqual(["Bash"]);
  });

  test("does not mutate options outside bypass mode", () => {
    const options = { allowedTools: ["Read"] };
    const normalized = applyClaudePermissionSafeguards(options, "default");

    expect(normalized).toEqual(options);
    expect(normalized?.allowDangerouslySkipPermissions).toBeUndefined();
  });
});
