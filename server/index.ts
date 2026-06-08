import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import morgan from "morgan";
import { z } from "zod";
import type { DatabaseShape, EdgeType, GraphEdge, GraphNode, Message, ModelRun, NodeType, WorkerInfo } from "../shared/types.js";
import { createId, hashValue, nowIso, slugify, stableId } from "./lib/ids.js";
import { cloneOrPull, gitStatus } from "./services/git.js";
import { indexProjectRepository } from "./services/indexer.js";
import { readRepositoryFile, readRepositoryTree } from "./services/repository.js";
import { store } from "./services/store.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const accessToken = process.env.XEDOC_ACCESS_TOKEN?.trim();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("tiny"));

function readBearer(req: express.Request) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return "";
}

app.get("/api/session", (req, res) => {
  const token = readBearer(req);
  res.json({
    authRequired: Boolean(accessToken),
    authenticated: !accessToken || token === accessToken
  });
});

app.use("/api", (req, res, next) => {
  if (!accessToken) {
    next();
    return;
  }

  if (readBearer(req) === accessToken) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
});

function requireProject(db: DatabaseShape, projectId: string) {
  const project = db.projects.find((item) => item.id === projectId && !item.deletedAt);
  if (!project) {
    const error = new Error("Project not found");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }
  return project;
}

function refreshProjectGraphStats(db: DatabaseShape, projectId: string) {
  const project = requireProject(db, projectId);
  const nodes = db.graphNodes.filter((node) => node.projectId === projectId && !node.deletedAt);
  const edges = db.graphEdges.filter((edge) => edge.projectId === projectId && !edge.deletedAt);
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.fromNodeId);
    connected.add(edge.toNodeId);
  }
  const orphanNodes = nodes.filter((node) => !connected.has(node.id)).length;
  const lowConfidenceEdges = edges.filter((edge) => edge.confidence < 0.55).length;
  const staleNodes = nodes.filter((node) => node.metadata.stale === true).length;

  project.graph = {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    health: Math.max(30, Math.min(99, 100 - orphanNodes * 2 - lowConfidenceEdges * 4 - staleNodes)),
    orphanNodes,
    lowConfidenceEdges,
    staleNodes
  };
  project.updatedAt = nowIso();
}

function parseList<T extends string>(value: unknown): T[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean) as T[];
}

function compactGraph(db: DatabaseShape, projectId: string, limit = 180) {
  const nodes = db.graphNodes.filter((node) => node.projectId === projectId && !node.deletedAt);
  const importantTypes = new Set<NodeType>(["Project", "Repo", "Directory", "File", "Chat", "ModelRun", "Function", "Class", "Dependency"]);
  const selected = nodes
    .sort((a, b) => Number(importantTypes.has(b.type)) - Number(importantTypes.has(a.type)) || b.confidence - a.confidence)
    .slice(0, limit);
  const ids = new Set(selected.map((node) => node.id));
  const edges = db.graphEdges
    .filter((edge) => edge.projectId === projectId && ids.has(edge.fromNodeId) && ids.has(edge.toNodeId) && !edge.deletedAt)
    .slice(0, 260);

  return { nodes: selected, edges };
}

function graphSearch(db: DatabaseShape, projectId: string, query: string, nodeTypes: NodeType[]) {
  const q = query.trim().toLowerCase();
  const typeSet = new Set(nodeTypes);
  const nodes = db.graphNodes.filter((node) => {
    if (node.projectId !== projectId || node.deletedAt) {
      return false;
    }
    if (typeSet.size > 0 && !typeSet.has(node.type)) {
      return false;
    }
    if (!q) {
      return true;
    }

    const pathValue = typeof node.metadata.path === "string" ? node.metadata.path : "";
    return `${node.title} ${node.description} ${pathValue}`.toLowerCase().includes(q);
  });

  return nodes.slice(0, 100);
}

function neighborhood(db: DatabaseShape, projectId: string, startNodeId: string | undefined, depth: number, nodeTypes: NodeType[], edgeTypes: EdgeType[]) {
  const allNodes = db.graphNodes.filter((node) => node.projectId === projectId && !node.deletedAt);
  const allEdges = db.graphEdges.filter((edge) => edge.projectId === projectId && !edge.deletedAt);
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  const typeSet = new Set(nodeTypes);
  const edgeTypeSet = new Set(edgeTypes);
  const projectNode = allNodes.find((node) => node.type === "Project");
  const startId = startNodeId && nodeById.has(startNodeId) ? startNodeId : projectNode?.id || allNodes[0]?.id;

  if (!startId) {
    return { nodes: [], edges: [], depth };
  }

  const selectedNodeIds = new Set<string>([startId]);
  const selectedEdgeIds = new Set<string>();
  let frontier = new Set<string>([startId]);
  const maxDepth = Math.max(1, Math.min(depth || 1, 3));

  for (let hop = 0; hop < maxDepth; hop += 1) {
    const next = new Set<string>();
    const fanout = new Map<string, number>();
    for (const edge of allEdges) {
      if (edgeTypeSet.size > 0 && !edgeTypeSet.has(edge.type)) {
        continue;
      }
      const touchesFrom = frontier.has(edge.fromNodeId);
      const touchesTo = frontier.has(edge.toNodeId);
      if (!touchesFrom && !touchesTo) {
        continue;
      }

      const source = touchesFrom ? edge.fromNodeId : edge.toNodeId;
      const currentFanout = fanout.get(source) || 0;
      if (currentFanout >= 36 || selectedEdgeIds.size >= 360 || selectedNodeIds.size >= 240) {
        continue;
      }

      const candidateIds = [edge.fromNodeId, edge.toNodeId];
      const candidateNodes = candidateIds.map((id) => nodeById.get(id)).filter(Boolean) as GraphNode[];
      if (typeSet.size > 0 && candidateNodes.some((node) => !typeSet.has(node.type))) {
        continue;
      }

      selectedEdgeIds.add(edge.id);
      fanout.set(source, currentFanout + 1);
      for (const id of candidateIds) {
        if (!selectedNodeIds.has(id)) {
          selectedNodeIds.add(id);
          next.add(id);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) {
      break;
    }
  }

  return {
    nodes: [...selectedNodeIds].map((id) => nodeById.get(id)).filter(Boolean) as GraphNode[],
    edges: allEdges.filter((edge) => selectedEdgeIds.has(edge.id)),
    startNodeId: startId,
    depth: maxDepth
  };
}

function scoreNodeForMessage(node: GraphNode, words: string[]) {
  const haystack = `${node.title} ${node.description} ${String(node.metadata.path || "")} ${String(node.metadata.symbolName || "")}`.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (word.length > 2 && haystack.includes(word)) {
      score += word.length;
    }
  }
  if (["File", "Function", "Class", "Symbol", "Task", "Bug", "Chat"].includes(node.type)) {
    score += 2;
  }
  return score * node.confidence;
}

function createGraphAnswer(db: DatabaseShape, projectId: string, chatId: string, content: string) {
  const words = content.toLowerCase().split(/[^a-z0-9_./-]+/).filter(Boolean);
  const nodes = db.graphNodes.filter((node) => node.projectId === projectId && !node.deletedAt);
  const ranked = nodes
    .map((node) => ({ node, score: scoreNodeForMessage(node, words) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.node);

  const fallback = ranked.length ? ranked : nodes.filter((node) => ["Project", "Repo", "File", "Chat"].includes(node.type)).slice(0, 6);
  const start = fallback[0]?.id;
  const subgraph = neighborhood(db, projectId, start, 2, [], []);
  const contextNodes = [...new Set([...fallback.map((node) => node.id), ...subgraph.nodes.map((node) => node.id)])].slice(0, 16);
  const contextEdges = subgraph.edges.map((edge) => edge.id).slice(0, 24);
  const contextNodeObjects = contextNodes.map((id) => db.graphNodes.find((node) => node.id === id)).filter(Boolean) as GraphNode[];
  const files = contextNodeObjects.filter((node) => node.type === "File").slice(0, 5);
  const symbols = contextNodeObjects.filter((node) => ["Function", "Class", "Symbol"].includes(node.type)).slice(0, 5);

  const lines = [
    "I used the project graph as the first context layer.",
    "",
    `Context nodes: ${contextNodes.length}. Context edges: ${contextEdges.length}.`,
    files.length ? `Relevant files: ${files.map((node) => node.title).join(", ")}.` : "Relevant files: none found yet.",
    symbols.length ? `Relevant symbols: ${symbols.map((node) => node.title).join(", ")}.` : "Relevant symbols: none found yet.",
    "",
    "Current MVP answer:",
    "The graph layer found the closest project entities and preserved this run as graph history. Connect a live provider or Ollama worker next to replace this simulator text with a model completion.",
    "",
    "Suggested graph updates:",
    "- Save this request as a Message node.",
    "- Link the ModelRun to the context nodes used above.",
    "- Add missing Task/Bug nodes if this question describes planned work or a defect."
  ];

  const run: ModelRun = {
    id: createId("run"),
    projectId,
    chatId,
    provider: "xedoc-simulator",
    model: "graph-mvp",
    temperature: 0.2,
    contextNodes,
    contextEdges,
    latencyMs: 0,
    status: "succeeded",
    input: content,
    output: lines.join("\n"),
    createdAt: nowIso()
  };

  return { answer: lines.join("\n"), run, contextNodes, contextEdges };
}

function addChatGraphArtifacts(db: DatabaseShape, message: Message, run?: ModelRun, contextNodes: string[] = []) {
  const createdAt = nowIso();
  const chatNodeId = stableId("node", [message.projectId, "Chat", message.chatId]);
  const messageNodeId = stableId("node", [message.projectId, "Message", message.id]);
  const chat = db.chats.find((item) => item.id === message.chatId);

  const chatNode: GraphNode = {
    id: chatNodeId,
    type: "Chat",
    projectId: message.projectId,
    title: chat?.title || "Chat",
    description: "",
    createdAt,
    updatedAt: createdAt,
    source: "chat_message",
    confidence: 1,
    metadata: { chatId: message.chatId }
  };

  const messageNode: GraphNode = {
    id: messageNodeId,
    type: "Message",
    projectId: message.projectId,
    title: `${message.role}: ${message.content.slice(0, 80)}`,
    description: message.content.slice(0, 240),
    createdAt,
    updatedAt: createdAt,
    source: "chat_message",
    sourceId: message.id,
    confidence: 1,
    metadata: { chatId: message.chatId, role: message.role }
  };

  if (!db.graphNodes.some((node) => node.id === chatNodeId)) {
    db.graphNodes.push(chatNode);
  }
  db.graphNodes.push(messageNode);
  db.graphEdges.push({
    id: stableId("edge", [message.projectId, chatNodeId, "CHAT_HAS_MESSAGE", messageNodeId]),
    projectId: message.projectId,
    fromNodeId: chatNodeId,
    toNodeId: messageNodeId,
    type: "CHAT_HAS_MESSAGE",
    weight: 1,
    confidence: 1,
    source: "chat_message",
    createdAt,
    updatedAt: createdAt,
    metadata: {}
  });

  if (run) {
    const runNodeId = stableId("node", [message.projectId, "ModelRun", run.id]);
    db.graphNodes.push({
      id: runNodeId,
      type: "ModelRun",
      projectId: message.projectId,
      title: `${run.provider}/${run.model}`,
      description: run.input.slice(0, 240),
      createdAt,
      updatedAt: createdAt,
      source: "system",
      sourceId: run.id,
      confidence: 0.95,
      metadata: { provider: run.provider, model: run.model, latencyMs: run.latencyMs, status: run.status }
    });
    db.graphEdges.push({
      id: stableId("edge", [message.projectId, runNodeId, "MODELRUN_PRODUCED_MESSAGE", messageNodeId]),
      projectId: message.projectId,
      fromNodeId: runNodeId,
      toNodeId: messageNodeId,
      type: "MODELRUN_PRODUCED_MESSAGE",
      weight: 1,
      confidence: 0.95,
      source: "system",
      createdAt,
      updatedAt: createdAt,
      metadata: {}
    });

    for (const nodeId of contextNodes.slice(0, 20)) {
      db.graphEdges.push({
        id: stableId("edge", [message.projectId, runNodeId, "MODELRUN_USED_CONTEXT", nodeId]),
        projectId: message.projectId,
        fromNodeId: runNodeId,
        toNodeId: nodeId,
        type: "MODELRUN_USED_CONTEXT",
        weight: 0.8,
        confidence: 0.8,
        source: "system",
        createdAt,
        updatedAt: createdAt,
        metadata: {}
      });
    }
  }
}

const projectSchema = z.object({
  name: z.string().min(2).max(90),
  description: z.string().max(500).default(""),
  gitUrl: z.string().max(500).default(""),
  branch: z.string().max(80).default("main"),
  type: z.string().max(80).default("software")
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Xedoc Projects", time: nowIso() });
});

app.get("/api/projects", (_req, res) => {
  const db = store.snapshot();
  res.json({ projects: db.projects.filter((project) => !project.deletedAt) });
});

app.post("/api/projects", async (req, res, next) => {
  try {
    const payload = projectSchema.parse(req.body);
    const now = nowIso();
    const id = `${slugify(payload.name)}_${createId("p").slice(2)}`;
    const projectNodeId = stableId("node", [id, "Project", id]);
    const chatId = createId("chat");
    const chatNodeId = stableId("node", [id, "Chat", chatId]);

    const project = await store.update((db) => {
      const item = {
        id,
        name: payload.name,
        description: payload.description,
        gitUrl: payload.gitUrl,
        branch: payload.branch || "main",
        type: payload.type || "software",
        createdAt: now,
        updatedAt: now,
        repo: {
          status: "not_cloned" as const,
          files: 0,
          directories: 0,
          languages: {}
        },
        graph: {
          totalNodes: 2,
          totalEdges: 1,
          health: 96,
          orphanNodes: 0,
          lowConfidenceEdges: 0,
          staleNodes: 0
        }
      };

      db.projects.unshift(item);
      db.chats.push({
        id: chatId,
        projectId: id,
        title: "Architecture",
        provider: "xedoc-simulator",
        model: "graph-mvp",
        retrievalMode: "graph",
        createdAt: now,
        updatedAt: now
      });
      db.graphNodes.push({
        id: projectNodeId,
        type: "Project",
        projectId: id,
        title: payload.name,
        description: payload.description,
        createdAt: now,
        updatedAt: now,
        source: "user_manual",
        confidence: 1,
        metadata: { projectId: id }
      });
      db.graphNodes.push({
        id: chatNodeId,
        type: "Chat",
        projectId: id,
        title: "Architecture",
        description: "Default project chat.",
        createdAt: now,
        updatedAt: now,
        source: "system",
        confidence: 1,
        metadata: { chatId }
      });
      db.graphEdges.push({
        id: stableId("edge", [id, projectNodeId, "CHAT_HAS_MESSAGE", chatNodeId]),
        projectId: id,
        fromNodeId: projectNodeId,
        toNodeId: chatNodeId,
        type: "PROJECT_HAS_CHAT",
        weight: 1,
        confidence: 0.9,
        source: "system",
        createdAt: now,
        updatedAt: now,
        metadata: {}
      });
      return item;
    });

    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId", (req, res, next) => {
  try {
    const db = store.snapshot();
    const project = requireProject(db, req.params.projectId);
    res.json({ project });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:projectId", async (req, res, next) => {
  try {
    await store.update((db) => {
      const project = requireProject(db, req.params.projectId);
      project.deletedAt = nowIso();
      project.updatedAt = nowIso();
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/repo/clone", async (req, res, next) => {
  try {
    const project = await store.update((db) => {
      const item = requireProject(db, req.params.projectId);
      const body = z.object({ gitUrl: z.string().max(500).optional(), branch: z.string().max(80).optional() }).parse(req.body || {});
      if (body.gitUrl !== undefined) {
        item.gitUrl = body.gitUrl;
      }
      if (body.branch !== undefined) {
        item.branch = body.branch || "main";
      }
      item.repo.status = "cloning";
      item.repo.error = undefined;
      item.updatedAt = nowIso();
      return structuredClone(item);
    });

    const repoPath = await cloneOrPull(project);
    await store.update((db) => {
      const item = requireProject(db, project.id);
      item.repo.path = repoPath;
      item.repo.lastSyncAt = nowIso();
      item.repo.status = "ready";
      item.updatedAt = nowIso();
    });
    const result = await indexProjectRepository(project);
    res.json(result);
  } catch (error) {
    await store.update((db) => {
      const project = db.projects.find((item) => item.id === req.params.projectId);
      if (project) {
        project.repo.status = "error";
        project.repo.error = error instanceof Error ? error.message : String(error);
        project.updatedAt = nowIso();
      }
    });
    next(error);
  }
});

app.post("/api/projects/:projectId/repo/pull", async (req, res, next) => {
  try {
    const project = await store.update((db) => {
      const item = requireProject(db, req.params.projectId);
      item.repo.status = "cloning";
      item.repo.error = undefined;
      item.updatedAt = nowIso();
      return structuredClone(item);
    });

    const repoPath = await cloneOrPull(project);
    await store.update((db) => {
      const item = requireProject(db, project.id);
      item.repo.path = repoPath;
      item.repo.lastSyncAt = nowIso();
      item.repo.status = "ready";
      item.updatedAt = nowIso();
    });
    const result = await indexProjectRepository(project);
    res.json(result);
  } catch (error) {
    await store.update((db) => {
      const project = db.projects.find((item) => item.id === req.params.projectId);
      if (project) {
        project.repo.status = "error";
        project.repo.error = error instanceof Error ? error.message : String(error);
        project.updatedAt = nowIso();
      }
    });
    next(error);
  }
});

app.get("/api/projects/:projectId/repo/status", async (req, res, next) => {
  try {
    const db = store.snapshot();
    const project = requireProject(db, req.params.projectId);
    if (!project.repo.path) {
      res.json({ status: "Repository is not cloned yet." });
      return;
    }
    res.json({ status: await gitStatus(project.repo.path) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/repo/tree", async (req, res, next) => {
  try {
    requireProject(store.snapshot(), req.params.projectId);
    res.json({ tree: await readRepositoryTree(req.params.projectId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/repo/file", async (req, res, next) => {
  try {
    requireProject(store.snapshot(), req.params.projectId);
    const requestedPath = z.string().min(1).parse(req.query.path);
    res.json({ path: requestedPath, content: await readRepositoryFile(req.params.projectId, requestedPath) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/graph", (req, res, next) => {
  try {
    const db = store.snapshot();
    requireProject(db, req.params.projectId);
    res.json(compactGraph(db, req.params.projectId, Number(req.query.limit || 180)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/graph/search", (req, res, next) => {
  try {
    const db = store.snapshot();
    requireProject(db, req.params.projectId);
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const nodeTypes = parseList<NodeType>(req.query.nodeTypes);
    res.json({ nodes: graphSearch(db, req.params.projectId, query, nodeTypes) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/graph/neighborhood", (req, res, next) => {
  try {
    const db = store.snapshot();
    requireProject(db, req.params.projectId);
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : undefined;
    const depth = Number(req.query.depth || 1);
    const nodeTypes = parseList<NodeType>(req.query.nodeTypes);
    const edgeTypes = parseList<EdgeType>(req.query.edgeTypes);
    res.json(neighborhood(db, req.params.projectId, nodeId, depth, nodeTypes, edgeTypes));
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/graph/node/:nodeId", (req, res, next) => {
  try {
    const db = store.snapshot();
    requireProject(db, req.params.projectId);
    const node = db.graphNodes.find((item) => item.projectId === req.params.projectId && item.id === req.params.nodeId && !item.deletedAt);
    if (!node) {
      res.status(404).json({ error: "Node not found" });
      return;
    }
    res.json({ node });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/graph/diff", (req, res, next) => {
  try {
    const db = store.snapshot();
    requireProject(db, req.params.projectId);
    res.json({ diffs: db.graphDiffs.filter((diff) => diff.projectId === req.params.projectId).slice(0, 30) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/chats", (req, res, next) => {
  try {
    const db = store.snapshot();
    requireProject(db, req.params.projectId);
    const chats = db.chats.filter((chat) => chat.projectId === req.params.projectId);
    res.json({ chats });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/chats", async (req, res, next) => {
  try {
    const body = z.object({
      title: z.string().min(1).max(90),
      provider: z.string().max(80).default("xedoc-simulator"),
      model: z.string().max(120).default("graph-mvp")
    }).parse(req.body);
    const chat = await store.update((db) => {
      requireProject(db, req.params.projectId);
      const now = nowIso();
      const item = {
        id: createId("chat"),
        projectId: req.params.projectId,
        title: body.title,
        provider: body.provider,
        model: body.model,
        retrievalMode: "graph" as const,
        createdAt: now,
        updatedAt: now
      };
      db.chats.push(item);
      return item;
    });
    res.status(201).json({ chat });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId/chats/:chatId", (req, res, next) => {
  try {
    const db = store.snapshot();
    requireProject(db, req.params.projectId);
    const chat = db.chats.find((item) => item.id === req.params.chatId && item.projectId === req.params.projectId);
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }
    const messages = db.messages.filter((message) => message.chatId === chat.id).slice(-200);
    const runs = db.modelRuns.filter((run) => run.chatId === chat.id).slice(-50);
    res.json({ chat, messages, runs });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/chats/:chatId/messages", async (req, res, next) => {
  try {
    const body = z.object({ content: z.string().min(1).max(8000) }).parse(req.body);
    const result = await store.update((db) => {
      requireProject(db, req.params.projectId);
      const chat = db.chats.find((item) => item.id === req.params.chatId && item.projectId === req.params.projectId);
      if (!chat) {
        throw new Error("Chat not found");
      }

      const now = nowIso();
      const userMessage: Message = {
        id: createId("msg"),
        projectId: req.params.projectId,
        chatId: req.params.chatId,
        role: "user",
        content: body.content,
        createdAt: now
      };
      db.messages.push(userMessage);
      addChatGraphArtifacts(db, userMessage);

      const started = Date.now();
      const answer = createGraphAnswer(db, req.params.projectId, req.params.chatId, body.content);
      answer.run.latencyMs = Date.now() - started;
      const assistantMessage: Message = {
        id: createId("msg"),
        projectId: req.params.projectId,
        chatId: req.params.chatId,
        role: "assistant",
        content: answer.answer,
        provider: answer.run.provider,
        model: answer.run.model,
        tokensIn: Math.ceil(body.content.length / 4),
        tokensOut: Math.ceil(answer.answer.length / 4),
        createdAt: nowIso()
      };

      db.modelRuns.push(answer.run);
      db.messages.push(assistantMessage);
      addChatGraphArtifacts(db, assistantMessage, answer.run, answer.contextNodes);
      chat.updatedAt = nowIso();
      refreshProjectGraphStats(db, req.params.projectId);

      return { userMessage, assistantMessage, run: answer.run };
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/models", (_req, res) => {
  const db = store.snapshot();
  const workerModels = db.workers
    .filter((worker) => worker.status === "online")
    .flatMap((worker) => worker.capabilities.models.map((model) => ({ provider: "ollama-worker", model, worker: worker.name })));

  res.json({
    providers: [
      { provider: "xedoc-simulator", model: "graph-mvp", status: "ready" },
      ...workerModels.map((item) => ({ ...item, status: "worker" }))
    ]
  });
});

app.get("/api/workers", (_req, res) => {
  const db = store.snapshot();
  const cutoff = Date.now() - 45_000;
  const workers = db.workers.map((worker) => {
    const last = worker.lastHeartbeatAt ? Date.parse(worker.lastHeartbeatAt) : 0;
    return { ...worker, status: last > cutoff ? "online" : "offline" };
  });
  res.json({ workers });
});

app.post("/api/workers/register", async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1).max(120),
      token: z.string().min(8).max(300),
      capabilities: z.object({
        models: z.array(z.string()).default([]),
        cpu: z.string().optional(),
        gpu: z.string().optional(),
        ramGb: z.number().optional(),
        tools: z.array(z.string()).default([]),
        maxContext: z.number().optional()
      })
    }).parse(req.body);
    const tokenHash = hashValue(body.token);
    const worker = await store.update((db) => {
      const now = nowIso();
      let item: WorkerInfo | undefined = db.workers.find((candidate) => candidate.tokenHash === tokenHash);
      if (!item) {
        item = {
          id: createId("worker"),
          name: body.name,
          tokenHash,
          status: "online",
          lastHeartbeatAt: now,
          capabilities: body.capabilities,
          load: { runningJobs: 0, queuedJobs: 0 },
          createdAt: now,
          updatedAt: now
        };
        db.workers.push(item);
      } else {
        item.name = body.name;
        item.status = "online";
        item.lastHeartbeatAt = now;
        item.capabilities = body.capabilities;
        item.updatedAt = now;
      }
      return item;
    });
    res.status(201).json({ worker });
  } catch (error) {
    next(error);
  }
});

app.post("/api/workers/heartbeat", async (req, res, next) => {
  try {
    const body = z.object({
      workerId: z.string(),
      token: z.string().min(8),
      load: z.object({ runningJobs: z.number(), queuedJobs: z.number() }).optional()
    }).parse(req.body);
    const tokenHash = hashValue(body.token);
    const worker = await store.update((db) => {
      const item = db.workers.find((candidate) => candidate.id === body.workerId && candidate.tokenHash === tokenHash);
      if (!item) {
        throw new Error("Worker not found");
      }
      item.status = "online";
      item.lastHeartbeatAt = nowIso();
      item.load = body.load || item.load;
      item.updatedAt = nowIso();
      return item;
    });
    res.json({ worker });
  } catch (error) {
    next(error);
  }
});

app.get("/api/workers/jobs/next", async (req, res, next) => {
  try {
    const workerId = z.string().parse(req.query.workerId);
    const token = z.string().min(8).parse(req.query.token);
    const tokenHash = hashValue(token);
    const job = await store.update((db) => {
      const worker = db.workers.find((candidate) => candidate.id === workerId && candidate.tokenHash === tokenHash);
      if (!worker) {
        throw new Error("Worker not found");
      }
      const item = db.workerJobs.find((candidate) => candidate.status === "queued" && (!candidate.workerId || candidate.workerId === workerId));
      if (!item) {
        return null;
      }
      item.workerId = workerId;
      item.status = "running";
      item.updatedAt = nowIso();
      return item;
    });
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

app.post("/api/workers/jobs/:jobId/logs", async (req, res, next) => {
  try {
    const body = z.object({ line: z.string().max(2000) }).parse(req.body);
    await store.update((db) => {
      const job = db.workerJobs.find((item) => item.id === req.params.jobId);
      if (!job) {
        throw new Error("Job not found");
      }
      job.logs.push(body.line);
      job.updatedAt = nowIso();
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/workers/jobs/:jobId/result", async (req, res, next) => {
  try {
    await store.update((db) => {
      const job = db.workerJobs.find((item) => item.id === req.params.jobId);
      if (!job) {
        throw new Error("Job not found");
      }
      job.status = "succeeded";
      job.output = req.body || {};
      job.updatedAt = nowIso();
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/workers/jobs/:jobId/error", async (req, res, next) => {
  try {
    const body = z.object({ error: z.string().max(4000) }).parse(req.body);
    await store.update((db) => {
      const job = db.workerJobs.find((item) => item.id === req.params.jobId);
      if (!job) {
        throw new Error("Job not found");
      }
      job.status = "failed";
      job.logs.push(body.error);
      job.updatedAt = nowIso();
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

const staticDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir, { maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: number }).status) : 400;
  const message = error instanceof z.ZodError
    ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
    : error instanceof Error
      ? error.message
      : String(error);
  res.status(status || 400).json({ error: message });
});

await store.init();
app.listen(port, "0.0.0.0", () => {
  console.log(`Xedoc Projects listening on ${port}`);
});
