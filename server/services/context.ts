import path from "node:path";
import type { Chat, DatabaseShape, GraphEdge, GraphNode, Message, Project } from "../../shared/types.js";
import { readRepositoryFile } from "./repository.js";

export interface ChatContextPack {
  systemPrompt: string;
  userPrompt: string;
  project: Project;
  chat: Chat;
  userMessage: string;
  contextNodes: string[];
  contextEdges: string[];
  relevantNodes: GraphNode[];
  relevantEdges: GraphEdge[];
  previousMessages: Message[];
  fileSnippets: Array<{ path: string; language?: string; content: string }>;
}

function wordsFor(text: string) {
  return text.toLowerCase().split(/[^\p{L}\p{N}_./-]+/u).filter((word) => word.length > 1);
}

function isGenericProjectQuestion(text: string) {
  const normalized = text.toLowerCase();
  return /что\s+(это|здесь|за)|what\s+is|what'?s\s+here|about\s+this\s+project|overview|обзор|проект/u.test(normalized);
}

function scoreNode(node: GraphNode, words: string[], genericQuestion: boolean) {
  const pathValue = typeof node.metadata.path === "string" ? node.metadata.path : "";
  const symbolValue = typeof node.metadata.symbolName === "string" ? node.metadata.symbolName : "";
  const haystack = `${node.type} ${node.title} ${node.description} ${pathValue} ${symbolValue}`.toLowerCase();
  let score = 0;

  for (const word of words) {
    if (word.length > 2 && haystack.includes(word)) {
      score += Math.min(10, word.length);
    }
  }

  if (genericQuestion) {
    if (node.type === "Project") score += 40;
    if (node.type === "Repo") score += 28;
    if (node.type === "File" && /(^|\/)(readme\.md|package\.json|.*prd.*|.*sdd.*)$/i.test(pathValue || node.title)) score += 35;
    if (node.type === "Directory" && node.title === ".") score += 12;
  }

  if (["File", "Function", "Class", "Symbol", "Dependency", "Chat", "Message", "ModelRun"].includes(node.type)) {
    score += 2;
  }

  return score * Math.max(0.25, node.confidence);
}

function selectContextGraph(db: DatabaseShape, projectId: string, userMessage: string) {
  const words = wordsFor(userMessage);
  const genericQuestion = isGenericProjectQuestion(userMessage);
  const nodes = db.graphNodes.filter((node) => node.projectId === projectId && !node.deletedAt);
  const edges = db.graphEdges.filter((edge) => edge.projectId === projectId && !edge.deletedAt);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ranked = nodes
    .map((node) => ({ node, score: scoreNode(node, words, genericQuestion) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 18)
    .map((item) => item.node);

  const selectedIds = new Set(ranked.map((node) => node.id));
  const firstHopEdges = edges
    .filter((edge) => selectedIds.has(edge.fromNodeId) || selectedIds.has(edge.toNodeId))
    .sort((a, b) => b.confidence * b.weight - a.confidence * a.weight)
    .slice(0, 42);

  for (const edge of firstHopEdges) {
    selectedIds.add(edge.fromNodeId);
    selectedIds.add(edge.toNodeId);
    if (selectedIds.size >= 34) break;
  }

  const relevantNodes = [...selectedIds]
    .map((id) => nodeById.get(id))
    .filter(Boolean) as GraphNode[];
  const relevantEdges = edges
    .filter((edge) => selectedIds.has(edge.fromNodeId) && selectedIds.has(edge.toNodeId))
    .slice(0, 56);

  return { relevantNodes, relevantEdges };
}

function isTextSnippetPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return new Set([".md", ".txt", ".json", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".yml", ".yaml"]).has(ext);
}

async function readFileSnippets(projectId: string, nodes: GraphNode[]) {
  const preferred = nodes
    .filter((node) => node.type === "File")
    .map((node) => String(node.metadata.path || node.title))
    .filter(Boolean)
    .sort((a, b) => {
      const weight = (value: string) => /(^|\/)readme\.md$/i.test(value) ? 0
        : /(^|\/)package\.json$/i.test(value) ? 1
          : /prd|sdd/i.test(value) ? 2
            : value.split("/").length;
      return weight(a) - weight(b) || a.localeCompare(b);
    });

  const snippets: Array<{ path: string; language?: string; content: string }> = [];
  let budget = 22_000;

  for (const filePath of [...new Set(preferred)].slice(0, 8)) {
    if (!isTextSnippetPath(filePath) || budget <= 0) {
      continue;
    }

    try {
      const content = await readRepositoryFile(projectId, filePath);
      const clipped = content.slice(0, Math.min(content.length, budget, 6000));
      snippets.push({ path: filePath, content: clipped });
      budget -= clipped.length;
    } catch {
      // The graph may point to stale files; skip them without breaking chat.
    }
  }

  return snippets;
}

function nodeSummary(node: GraphNode) {
  const pathValue = typeof node.metadata.path === "string" ? ` path=${node.metadata.path}` : "";
  const signature = typeof node.metadata.signature === "string" ? ` signature=${node.metadata.signature}` : "";
  return `- ${node.id}: ${node.type} "${node.title}"${pathValue}${signature} source=${node.source} confidence=${Math.round(node.confidence * 100)}%`;
}

function edgeSummary(edge: GraphEdge, nodeById: Map<string, GraphNode>) {
  const from = nodeById.get(edge.fromNodeId)?.title || edge.fromNodeId;
  const to = nodeById.get(edge.toNodeId)?.title || edge.toNodeId;
  return `- ${edge.type}: "${from}" -> "${to}" confidence=${Math.round(edge.confidence * 100)}% source=${edge.source}`;
}

export async function buildChatContext(db: DatabaseShape, projectId: string, chatId: string, userMessage: string): Promise<ChatContextPack> {
  const project = db.projects.find((item) => item.id === projectId && !item.deletedAt);
  const chat = db.chats.find((item) => item.id === chatId && item.projectId === projectId);
  if (!project || !chat) {
    throw new Error("Project or chat not found");
  }

  const previousMessages = db.messages
    .filter((message) => message.projectId === projectId && message.chatId === chatId)
    .slice(-10);
  const { relevantNodes, relevantEdges } = selectContextGraph(db, projectId, userMessage);
  const fileSnippets = await readFileSnippets(projectId, relevantNodes);
  const nodeById = new Map(relevantNodes.map((node) => [node.id, node]));

  const systemPrompt = [
    "You are an AI agent inside Xedoc Projects.",
    "You work with a project graph, repository files, chat history, and provenance.",
    "Answer in the user's language. If the user writes in Russian, answer in Russian.",
    "Be practical, concrete, and honest about missing context.",
    "Use graph links and file snippets as evidence. Do not invent graph edges that are not present.",
    "When useful, mention which files/nodes support the answer.",
    "If the user asks what the project is, give a crisp product overview and current implementation status."
  ].join("\n");

  const userPrompt = [
    `User message:\n${userMessage}`,
    "",
    "Project:",
    JSON.stringify({
      id: project.id,
      name: project.name,
      description: project.description,
      gitUrl: project.gitUrl,
      branch: project.branch,
      repo: project.repo,
      graph: project.graph
    }, null, 2),
    "",
    "Recent chat history:",
    previousMessages.map((message) => `${message.role}: ${message.content.slice(0, 1600)}`).join("\n\n") || "No previous messages.",
    "",
    "Relevant graph nodes:",
    relevantNodes.slice(0, 28).map(nodeSummary).join("\n") || "No relevant nodes.",
    "",
    "Relevant graph edges:",
    relevantEdges.slice(0, 38).map((edge) => edgeSummary(edge, nodeById)).join("\n") || "No relevant edges.",
    "",
    "File snippets:",
    fileSnippets.length
      ? fileSnippets.map((file) => `--- ${file.path} ---\n${file.content}`).join("\n\n")
      : "No text file snippets were available.",
    "",
    "Answer now."
  ].join("\n");

  return {
    systemPrompt,
    userPrompt,
    project,
    chat,
    userMessage,
    contextNodes: relevantNodes.map((node) => node.id).slice(0, 32),
    contextEdges: relevantEdges.map((edge) => edge.id).slice(0, 48),
    relevantNodes,
    relevantEdges,
    previousMessages,
    fileSnippets
  };
}

