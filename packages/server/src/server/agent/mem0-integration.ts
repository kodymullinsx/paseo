import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { Logger } from "pino";

type Mem0SearchOptions = {
  userId?: string;
  limit?: number;
  timeoutMs?: number;
};

type Mem0StoreOptions = {
  userId?: string;
  timeoutMs?: number;
};

type Mem0InitConfig = {
  qdrantUrl: string;
  qdrantApiKey: string;
  collectionName: string;
  ollamaBaseUrl: string;
  embeddingModel: string;
  dedupModel: string;
  historyDbPath: string;
};

type Mem0Runtime = {
  search: (query: string, options: { userId: string; limit: number }) => Promise<string[]>;
  store: (content: string, options: { userId: string }) => Promise<void>;
};

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_SEARCH_TIMEOUT_MS = 2_500;
const DEFAULT_STORE_TIMEOUT_MS = 1_500;
const MAX_QUERY_CHARS = 2_000;
const MAX_STORE_CHARS = 8_000;

let runtimePromise: Promise<Mem0Runtime | null> | null = null;
let initLogState: "none" | "enabled" | "disabled" = "none";

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isFeatureEnabled(): boolean {
  const raw = readTrimmedEnv("PASEO_MEM0_ENABLED");
  if (!raw) {
    return true;
  }
  const normalized = raw.toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off";
}

function resolveInitConfig(): Mem0InitConfig | null {
  if (!isFeatureEnabled()) {
    return null;
  }

  const qdrantUrl = readTrimmedEnv("PASEO_MEM0_QDRANT_URL") ?? readTrimmedEnv("QDRANT_URL");
  const qdrantApiKey =
    readTrimmedEnv("PASEO_MEM0_QDRANT_API_KEY") ?? readTrimmedEnv("QDRANT_API_KEY");

  if (!qdrantUrl || !qdrantApiKey) {
    return null;
  }

  const paseoHome =
    readTrimmedEnv("PASEO_HOME") ?? path.join(os.homedir(), ".paseo");

  return {
    qdrantUrl,
    qdrantApiKey,
    collectionName: readTrimmedEnv("PASEO_MEM0_COLLECTION_NAME") ?? "openclaw-memory",
    ollamaBaseUrl:
      readTrimmedEnv("PASEO_MEM0_OLLAMA_BASE_URL") ??
      readTrimmedEnv("OLLAMA_BASE_URL") ??
      "http://127.0.0.1:11434",
    embeddingModel:
      readTrimmedEnv("PASEO_MEM0_EMBEDDING_MODEL") ?? "qwen3-embedding:8b-fp16",
    dedupModel: readTrimmedEnv("PASEO_MEM0_DEDUP_MODEL") ?? "gpt-oss:20b",
    historyDbPath: path.join(paseoHome, "mem0.db"),
  };
}

async function dynamicImport(specifier: string): Promise<any> {
  const fn = new Function("s", "return import(s);") as (s: string) => Promise<any>;
  return fn(specifier);
}

function coerceMemoryStrings(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const results = Array.isArray((value as { results?: unknown[] }).results)
    ? ((value as { results: unknown[] }).results ?? [])
    : [];
  const memories: string[] = [];
  for (const entry of results) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const memory = (entry as { memory?: unknown }).memory;
    if (typeof memory !== "string") {
      continue;
    }
    const trimmed = memory.trim();
    if (trimmed.length > 0) {
      memories.push(trimmed);
    }
  }
  return memories;
}

async function initializeRuntime(logger: Logger): Promise<Mem0Runtime | null> {
  const config = resolveInitConfig();
  if (!config) {
    if (initLogState !== "disabled") {
      initLogState = "disabled";
      logger.info(
        "Mem0 disabled (set PASEO_MEM0_QDRANT_URL and PASEO_MEM0_QDRANT_API_KEY to enable)"
      );
    }
    return null;
  }

  try {
    const [{ Memory }, qdrantModule] = await Promise.all([
      dynamicImport("mem0ai/oss"),
      dynamicImport("@qdrant/js-client-rest"),
    ]);
    const QdrantClient =
      qdrantModule.QdrantClient ??
      qdrantModule.default?.QdrantClient ??
      qdrantModule.default;
    if (typeof Memory !== "function" || typeof QdrantClient !== "function") {
      throw new Error("Mem0 dependencies loaded but exports are missing");
    }

    const qdrantClient = new QdrantClient({
      url: config.qdrantUrl,
      apiKey: config.qdrantApiKey,
      checkCompatibility: false,
    });

    const memory = new Memory({
      vectorStore: {
        provider: "qdrant",
        config: {
          client: qdrantClient,
          collectionName: config.collectionName,
        },
      },
      llm: {
        provider: "ollama",
        config: {
          model: config.dedupModel,
          baseURL: config.ollamaBaseUrl,
        },
      },
      embedder: {
        provider: "ollama",
        config: {
          model: config.embeddingModel,
          url: config.ollamaBaseUrl,
        },
      },
      historyStore: {
        provider: "sqlite",
        config: {
          historyDbPath: config.historyDbPath,
        },
      },
    });

    if (initLogState !== "enabled") {
      initLogState = "enabled";
      logger.info(
        {
          collection: config.collectionName,
          embeddingModel: config.embeddingModel,
          dedupModel: config.dedupModel,
        },
        "Mem0 initialized"
      );
    }

    return {
      search: async (query, options) => {
        const result = await memory.search(query, {
          userId: options.userId,
          limit: options.limit,
        });
        return coerceMemoryStrings(result);
      },
      store: async (content, options) => {
        await memory.add(content, { userId: options.userId });
      },
    };
  } catch (error) {
    if (initLogState !== "disabled") {
      initLogState = "disabled";
      logger.warn(
        { err: error },
        "Mem0 unavailable (install mem0ai and @qdrant/js-client-rest to enable)"
      );
    }
    return null;
  }
}

async function getRuntime(logger: Logger): Promise<Mem0Runtime | null> {
  if (!runtimePromise) {
    runtimePromise = initializeRuntime(logger).catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  try {
    return await runtimePromise;
  } catch (error) {
    logger.warn({ err: error }, "Mem0 runtime initialization failed");
    return null;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}

function sanitizeUserId(rawUserId: string): string {
  const trimmed = rawUserId.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return "user";
}

export function buildMem0ScopedUserId(cwd: string): string {
  const base = readTrimmedEnv("PASEO_MEM0_USER_ID") ?? readTrimmedEnv("MEM0_USER_ID") ?? "user";
  const scopeByCwdRaw = readTrimmedEnv("PASEO_MEM0_SCOPE_BY_CWD");
  const scopeByCwd =
    typeof scopeByCwdRaw === "string"
      ? !["0", "false", "off"].includes(scopeByCwdRaw.toLowerCase())
      : false;
  if (!scopeByCwd) {
    return sanitizeUserId(base);
  }
  const digest = createHash("sha1").update(cwd).digest("hex").slice(0, 16);
  return sanitizeUserId(`${base}:${digest}`);
}

export async function searchMemories(
  logger: Logger,
  query: string,
  options?: Mem0SearchOptions
): Promise<string[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }
  const runtime = await getRuntime(logger);
  if (!runtime) {
    return [];
  }
  const userId = sanitizeUserId(
    options?.userId ??
      readTrimmedEnv("PASEO_MEM0_USER_ID") ??
      readTrimmedEnv("MEM0_USER_ID") ??
      "user"
  );
  const limit = Number.isFinite(options?.limit)
    ? Math.max(1, Math.floor(options?.limit ?? DEFAULT_SEARCH_LIMIT))
    : DEFAULT_SEARCH_LIMIT;
  const timeoutMs = Number.isFinite(options?.timeoutMs)
    ? Math.max(200, Math.floor(options?.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS))
    : DEFAULT_SEARCH_TIMEOUT_MS;
  try {
    return await withTimeout(
      runtime.search(truncate(normalizedQuery, MAX_QUERY_CHARS), { userId, limit }),
      timeoutMs,
      []
    );
  } catch (error) {
    logger.warn({ err: error }, "Mem0 search failed");
    return [];
  }
}

export async function storeMemory(
  logger: Logger,
  content: string,
  options?: Mem0StoreOptions
): Promise<void> {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return;
  }
  const runtime = await getRuntime(logger);
  if (!runtime) {
    return;
  }
  const userId = sanitizeUserId(
    options?.userId ??
      readTrimmedEnv("PASEO_MEM0_USER_ID") ??
      readTrimmedEnv("MEM0_USER_ID") ??
      "user"
  );
  const timeoutMs = Number.isFinite(options?.timeoutMs)
    ? Math.max(200, Math.floor(options?.timeoutMs ?? DEFAULT_STORE_TIMEOUT_MS))
    : DEFAULT_STORE_TIMEOUT_MS;
  try {
    await withTimeout(
      runtime.store(truncate(normalizedContent, MAX_STORE_CHARS), { userId }),
      timeoutMs,
      undefined
    );
  } catch (error) {
    logger.warn({ err: error }, "Mem0 store failed");
  }
}
