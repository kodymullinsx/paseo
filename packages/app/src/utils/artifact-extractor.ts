import type { ToolCallDetail } from "@server/server/agent/agent-sdk-types";
import type {
  AssistantMessageItem,
  StreamItem,
  ToolCallItem,
} from "../types/stream";
import type { ArtifactItem, ArtifactType } from "../types/artifacts";

const WRITE_TOOLS = new Set(["write", "write_file", "notebookedit", "notebook_edit"]);
const EDIT_TOOLS = new Set(["edit", "edit_file", "multiedit", "multi_edit"]);

const RENDERABLE_LANGS: Record<string, ArtifactType> = {
  jsx: "react",
  tsx: "react",
  html: "html",
  mermaid: "mermaid",
  svg: "svg",
};

function normalizeToolName(name: string): string {
  return name
    .trim()
    .replace(/[.\s-]+/g, "_")
    .toLowerCase();
}

function basename(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseUnknownInput(input: unknown): Record<string, unknown> {
  const asObj = asRecord(input);
  if (asObj) {
    return asObj;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      return asRecord(parsed) ?? {};
    } catch {
      return {};
    }
  }

  return {};
}

function safeInput(detail: ToolCallDetail): Record<string, unknown> {
  if (detail.type !== "unknown") {
    return {};
  }

  return parseUnknownInput(detail.input);
}

function getString(input: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return null;
}

function extractWriteArtifact(item: ToolCallItem): ArtifactItem[] {
  if (item.payload.source !== "agent") {
    return [];
  }

  const { callId, detail, name } = item.payload.data;

  if (detail.type === "write") {
    if (!detail.filePath || typeof detail.content !== "string") {
      return [];
    }

    return [
      {
        id: `artifact_write_${callId}`,
        type: "code",
        title: basename(detail.filePath),
        content: detail.content,
        language: detail.filePath.split(".").pop(),
        timestamp: item.timestamp,
        sourceItemId: item.id,
      },
    ];
  }

  const normalizedName = normalizeToolName(name);
  if (!WRITE_TOOLS.has(normalizedName)) {
    return [];
  }

  const input = safeInput(detail);
  const filePath = getString(input, "file_path", "path", "filePath");
  const content = getString(input, "content", "new_source", "newString", "new_string");

  if (!filePath || content === null) {
    return [];
  }

  return [
    {
      id: `artifact_write_${callId}`,
      type: "code",
      title: basename(filePath),
      content,
      language: filePath.split(".").pop(),
      timestamp: item.timestamp,
      sourceItemId: item.id,
    },
  ];
}

function extractEditArtifact(item: ToolCallItem): ArtifactItem[] {
  if (item.payload.source !== "agent") {
    return [];
  }

  const { callId, detail, name } = item.payload.data;

  if (detail.type === "edit") {
    if (!detail.filePath) {
      return [];
    }

    const oldStr = detail.oldString ?? "";
    const newStr = detail.newString ?? "";

    return [
      {
        id: `artifact_edit_${callId}`,
        type: "diff",
        title: basename(detail.filePath),
        content: `${oldStr}\x00|||EDIT|||\x00${newStr}`,
        timestamp: item.timestamp,
        sourceItemId: item.id,
      },
    ];
  }

  const normalizedName = normalizeToolName(name);
  if (!EDIT_TOOLS.has(normalizedName)) {
    return [];
  }

  const input = safeInput(detail);
  const filePath = getString(input, "file_path", "path", "filePath");
  if (!filePath) {
    return [];
  }

  const oldStr = getString(input, "old_string", "oldString") ?? "";
  const newStr = getString(input, "new_string", "newString") ?? "";

  return [
    {
      id: `artifact_edit_${callId}`,
      type: "diff",
      title: basename(filePath),
      content: `${oldStr}\x00|||EDIT|||\x00${newStr}`,
      timestamp: item.timestamp,
      sourceItemId: item.id,
    },
  ];
}

function extractFromToolCall(item: ToolCallItem): ArtifactItem[] {
  return [...extractWriteArtifact(item), ...extractEditArtifact(item)];
}

function extractFromAssistantMessage(item: AssistantMessageItem): ArtifactItem[] {
  const artifacts: ArtifactItem[] = [];
  const fenceRe = /```([a-zA-Z0-9_-]+)[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = fenceRe.exec(item.text)) !== null) {
    const lang = match[1]?.toLowerCase();
    const body = match[2] ?? "";
    if (!lang) {
      continue;
    }

    const artifactType = RENDERABLE_LANGS[lang];
    if (!artifactType) {
      continue;
    }

    artifacts.push({
      id: `artifact_block_${item.id}_${idx}`,
      type: artifactType,
      title: `${lang} snippet ${idx + 1}`,
      content: body,
      language: lang,
      timestamp: item.timestamp,
      sourceItemId: item.id,
    });
    idx += 1;
  }

  return artifacts;
}

export function extractArtifactsFromItem(item: StreamItem): ArtifactItem[] {
  if (item.kind === "tool_call") {
    return extractFromToolCall(item);
  }
  if (item.kind === "assistant_message") {
    return extractFromAssistantMessage(item);
  }
  return [];
}
