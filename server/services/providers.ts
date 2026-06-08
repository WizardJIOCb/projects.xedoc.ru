import type { Chat, ModelProviderOption, WorkerInfo } from "../../shared/types.js";
import type { ChatContextPack } from "./context.js";

export interface CompletionResult {
  provider: string;
  model: string;
  content: string;
  providerState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: string;
}

const CODEX_MODEL_OPTIONS = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" }
];

const XEDOC_GROK_MODEL_OPTIONS = [
  { value: "default", label: "Gateway Default" }
];

const XEDOC_GEMINI_MODEL_OPTIONS = [
  { value: "default", label: "Gateway Default" }
];

const GROK_MODEL_OPTIONS = [
  { value: "grok-build", label: "Grok Build" },
  { value: "grok-build-latest", label: "Grok Build Latest" },
  { value: "grok-4", label: "Grok 4 API" }
];

const GEMINI_MODEL_OPTIONS = [
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  { value: "gemini-3.1-pro-preview-customtools", label: "Gemini 3.1 Pro Custom Tools" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }
];

function configured(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  return (value || fallback).replace(/\/+$/, "");
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export function getProviderOptions(workers: WorkerInfo[] = []): ModelProviderOption[] {
  const xedocConfigured = configured(process.env.XEDOC_MODEL_API_BASE) && configured(process.env.XEDOC_MODEL_API_TOKEN);
  const openAiConfigured = configured(process.env.OPENAI_API_KEY);
  const xaiConfigured = configured(process.env.XAI_API_KEY || process.env.GROK_API_KEY);
  const geminiConfigured = configured(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  const options: ModelProviderOption[] = [
    ...CODEX_MODEL_OPTIONS.map((model) => ({
      provider: "xedoc-agent",
      model: `codex:${model.value}`,
      label: `Codex Agent / ${model.label}`,
      status: xedocConfigured ? "ready" as const : "missing_key" as const,
      configured: xedocConfigured,
      kind: "codex",
      note: "Existing xedoc.ru agent gateway"
    })),
    ...XEDOC_GROK_MODEL_OPTIONS.map((model) => ({
      provider: "xedoc-agent",
      model: `grok:${model.value}`,
      label: `Grok Agent / ${model.label}`,
      status: xedocConfigured ? "ready" as const : "missing_key" as const,
      configured: xedocConfigured,
      kind: "grok",
      note: "Existing xedoc.ru agent gateway default"
    })),
    ...XEDOC_GEMINI_MODEL_OPTIONS.map((model) => ({
      provider: "xedoc-agent",
      model: `gemini-cli:${model.value}`,
      label: `Gemini Agent / ${model.label}`,
      status: xedocConfigured ? "ready" as const : "missing_key" as const,
      configured: xedocConfigured,
      kind: "gemini-cli",
      note: "Existing xedoc.ru agent gateway default"
    })),
    ...CODEX_MODEL_OPTIONS.map((model) => ({
      provider: "codex",
      model: model.value,
      label: `OpenAI-compatible / ${model.label}`,
      status: openAiConfigured ? "ready" as const : "missing_key" as const,
      configured: openAiConfigured,
      kind: "openai-compatible",
      note: "Uses OPENAI_API_KEY"
    })),
    { provider: "grok", model: "grok-4", label: "xAI API / Grok 4", status: xaiConfigured ? "ready" : "missing_key", configured: xaiConfigured, kind: "openai-compatible", note: "Uses XAI_API_KEY or GROK_API_KEY" },
    ...GEMINI_MODEL_OPTIONS.map((model) => ({
      provider: "gemini",
      model: model.value,
      label: `Gemini API / ${model.label}`,
      status: geminiConfigured ? "ready" as const : "missing_key" as const,
      configured: geminiConfigured,
      kind: "gemini",
      note: "Uses GEMINI_API_KEY, GOOGLE_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY"
    })),
    { provider: "xedoc-simulator", model: "graph-mvp", label: "Local graph fallback", status: "simulator", configured: true, kind: "local", note: "No external key required" }
  ];

  const workerOptions = workers
    .filter((worker) => worker.status === "online")
    .flatMap((worker) => worker.capabilities.models.map((model) => ({
      provider: "ollama-worker",
      model,
      label: `Ollama / ${model}`,
      status: "worker" as const,
      configured: true,
      kind: "ollama",
      worker: worker.name,
      note: "Remote worker model"
    })));

  return [...options, ...workerOptions];
}

export function defaultChatSelection() {
  const option = getProviderOptions().find((item) => item.configured && item.provider !== "xedoc-simulator")
    || getProviderOptions().find((item) => item.provider === "xedoc-simulator");
  return {
    provider: option?.provider || "xedoc-simulator",
    model: option?.model || "graph-mvp"
  };
}

function parseXedocAgentModel(model: string) {
  const [kind, ...rest] = model.split(":");
  const rawModel = rest.join(":") || model;
  const resolvedKind = kind === "gemini"
    ? "gemini-cli"
    : ["codex", "grok", "gemini-cli"].includes(kind) ? kind : "codex";
  const shouldUseGatewayDefault = rawModel === "default"
    || (resolvedKind === "grok" && rawModel.startsWith("grok-"))
    || (resolvedKind === "gemini-cli" && rawModel.startsWith("gemini-"));
  return {
    kind: resolvedKind,
    model: shouldUseGatewayDefault ? "" : rawModel
  };
}

function limitText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 80))}\n\n[context truncated to fit provider gateway limit]`;
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs = 120_000): Promise<T> {
  const timeout = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: timeout.signal });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = typeof payload?.error === "string" ? payload.error : text || response.statusText;
      throw new Error(message);
    }
    return payload as T;
  } finally {
    timeout.clear();
  }
}

async function completeWithXedocAgent(chat: Chat, model: string, context: ChatContextPack): Promise<CompletionResult> {
  const base = normalizeBaseUrl(process.env.XEDOC_MODEL_API_BASE, "");
  const token = process.env.XEDOC_MODEL_API_TOKEN?.trim();
  if (!base || !token) {
    throw new Error("XEDOC_MODEL_API_BASE/TOKEN are not configured for xedoc-agent");
  }

  let xedocChatId = typeof chat.providerState?.xedocChatId === "string" ? chat.providerState.xedocChatId : "";
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  if (!xedocChatId) {
    const created = await fetchJson<{ chatId: string }>(`${base}/api/external/model/chats`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: `${context.project.name}: ${chat.title}`.slice(0, 150),
        source: "projects-xedoc",
        agentId: process.env.XEDOC_MODEL_API_AGENT_ID,
        repoId: process.env.XEDOC_MODEL_API_REPO_ID
      })
    }, 30_000);
    xedocChatId = created.chatId;
  }

  const parsedModel = parseXedocAgentModel(model);
  const externalPrompt = limitText(
    [context.systemPrompt, "", context.userPrompt].join("\n\n"),
    Number(process.env.XEDOC_MODEL_API_PROMPT_LIMIT || 6_000)
  );
  const requestBody: Record<string, unknown> = {
    prompt: externalPrompt,
    displayPrompt: limitText(context.userMessage, 12_000),
    kind: parsedModel.kind,
    reasoningEffort: process.env.XEDOC_MODEL_API_REASONING_EFFORT || "low",
    speed: "standard",
    waitMs: Number(process.env.XEDOC_MODEL_API_WAIT_MS || 0),
    agentId: process.env.XEDOC_MODEL_API_AGENT_ID,
    repoId: process.env.XEDOC_MODEL_API_REPO_ID
  };
  if (parsedModel.model) {
    requestBody.model = parsedModel.model;
  }

  const result = await fetchJson<{
    finalMessage?: string;
    assistantMessage?: { content?: string };
    job?: { status?: string };
    jobId?: string;
  }>(`${base}/api/external/model/chats/${encodeURIComponent(xedocChatId)}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  }, Number(process.env.XEDOC_MODEL_API_WAIT_MS || 120000) + 10_000);

  const content = result.finalMessage
    || result.assistantMessage?.content
    || [
      `Запустил xedoc-agent job ${result.jobId || ""}.`,
      `Статус: ${result.job?.status || "queued"}.`,
      "Это внешний Codex/Grok/Gemini run через существующий xedoc.ru gateway; результат можно будет подтянуть следующим шагом через polling/streaming."
    ].join("\n");
  return {
    provider: "xedoc-agent",
    model,
    content,
    providerState: { ...chat.providerState, xedocChatId, xedocJobId: result.jobId },
    metadata: {
      xedocChatId,
      xedocJobId: result.jobId,
      xedocJobStatus: result.finalMessage || result.assistantMessage?.content ? "completed" : result.job?.status || "queued"
    }
  };
}

export async function refreshXedocAgentJob(jobId: string) {
  const base = normalizeBaseUrl(process.env.XEDOC_MODEL_API_BASE, "");
  const token = process.env.XEDOC_MODEL_API_TOKEN?.trim();
  if (!base || !token) {
    throw new Error("XEDOC_MODEL_API_BASE/TOKEN are not configured for xedoc-agent");
  }

  return fetchJson<{
    jobId: string;
    finalMessage?: string;
    assistantMessage?: { content?: string };
    job?: { status?: string; exitCode?: number | null; error?: string | null };
  }>(`${base}/api/external/model/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  }, 30_000);
}

async function completeOpenAICompatible(provider: string, model: string, context: ChatContextPack): Promise<CompletionResult> {
  const isGrok = provider === "grok";
  const apiKey = isGrok ? process.env.XAI_API_KEY || process.env.GROK_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(isGrok ? "XAI_API_KEY is not configured" : "OPENAI_API_KEY is not configured");
  }

  const baseUrl = normalizeBaseUrl(
    isGrok ? process.env.XAI_BASE_URL : process.env.OPENAI_BASE_URL,
    isGrok ? "https://api.x.ai/v1" : "https://api.openai.com/v1"
  );
  const payload = await fetchJson<{
    choices?: Array<{ message?: { content?: string } }>;
  }>(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: context.systemPrompt },
        { role: "user", content: context.userPrompt }
      ]
    })
  }, 120_000);

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`${provider} returned an empty response`);
  }
  return { provider, model, content };
}

async function completeGemini(model: string, context: ChatContextPack): Promise<CompletionResult> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY, GOOGLE_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY is not configured");
  }

  const payload: Record<string, unknown> = {
    systemInstruction: {
      parts: [{ text: context.systemPrompt }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: context.userPrompt }]
      }
    ]
  };
  if (model.startsWith("gemini-3")) {
    payload.generationConfig = {
      thinkingConfig: {
        thinkingLevel: "high"
      }
    };
  }

  const result = await fetchJson<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }, 120_000);

  const content = result.candidates?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
  if (!content) {
    throw new Error("Gemini returned an empty response");
  }

  return { provider: "gemini", model, content };
}

function localGraphAnswer(context: ChatContextPack): CompletionResult {
  const fileList = context.fileSnippets.map((file) => file.path).slice(0, 6);
  const project = context.project;
  const generic = /что\s+(это|здесь|за)|проект|what|overview/i.test(context.userMessage);

  const content = generic
    ? [
      `Это ${project.name}: сервис для AI-проектов, где репозиторий, файлы, чаты, model runs и память проекта собираются в единый граф связей.`,
      "",
      `Сейчас в проекте проиндексировано ${project.repo.files} файлов, ${project.repo.directories} директорий, ${project.graph.totalNodes} graph nodes и ${project.graph.totalEdges} edges.`,
      fileList.length ? `Ключевые источники контекста: ${fileList.join(", ")}.` : "Файловые snippets пока недоступны.",
      "",
      "Что уже есть: dashboard проектов, git clone/pull, file tree, Graph Explorer, graph diff, чаты, worker registry и сохранение Message/ModelRun в граф.",
      "Что логично делать дальше: подключать живые модели, улучшать retrieval/context pack, добавлять Ollama worker и визуальное ручное управление графом."
    ].join("\n")
    : [
      `Я собрал контекст из графа проекта ${project.name}.`,
      `Нашёл ${context.relevantNodes.length} релевантных nodes и ${context.relevantEdges.length} edges.`,
      fileList.length ? `Файлы в контексте: ${fileList.join(", ")}.` : "Файлы в контекст не попали.",
      "",
      "Живая модель не ответила или не выбрана, поэтому это локальный graph fallback. Можно выбрать `xedoc-agent`, `Gemini API`, `Grok API` или `OpenAI-compatible` в селекторе модели."
    ].join("\n");

  return {
    provider: "xedoc-simulator",
    model: "graph-mvp",
    content
  };
}

export async function completeChat(chat: Chat, context: ChatContextPack): Promise<CompletionResult> {
  try {
    if (chat.provider === "xedoc-agent") {
      return await completeWithXedocAgent(chat, chat.model, context);
    }
    if (chat.provider === "codex" || chat.provider === "grok") {
      return await completeOpenAICompatible(chat.provider, chat.model, context);
    }
    if (chat.provider === "gemini") {
      return await completeGemini(chat.model, context);
    }
    return localGraphAnswer(context);
  } catch (error) {
    const fallback = localGraphAnswer(context);
    return {
      ...fallback,
      content: [
        fallback.content,
        "",
        `Provider ${chat.provider}/${chat.model} не ответил: ${error instanceof Error ? error.message : String(error)}`
      ].join("\n"),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
