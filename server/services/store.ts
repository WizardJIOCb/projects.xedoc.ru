import fs from "node:fs/promises";
import path from "node:path";
import type { Chat, DatabaseShape, GraphEdge, GraphNode, Project } from "../../shared/types.js";
import { createId, nowIso, stableId } from "../lib/ids.js";
import { dataDir } from "../lib/paths.js";

const storePath = path.join(dataDir, "store.json");

function createSeedData(): DatabaseShape {
  const createdAt = nowIso();
  const projectId = "demo_xedoc";
  const repoId = stableId("node", [projectId, "Repo", "demo"]);
  const graphId = stableId("node", [projectId, "Directory", "."]);
  const fileId = stableId("node", [projectId, "File", "server/index.ts"]);
  const chatId = stableId("node", [projectId, "Chat", "Architecture"]);
  const runId = stableId("node", [projectId, "ModelRun", "seed"]);
  const projectNodeId = stableId("node", [projectId, "Project", projectId]);

  const project: Project = {
    id: projectId,
    name: "Xedoc Projects MVP",
    description: "Seed workspace for graph-aware project management.",
    gitUrl: "",
    branch: "main",
    type: "software",
    createdAt,
    updatedAt: createdAt,
    repo: {
      status: "not_cloned",
      files: 0,
      directories: 0,
      languages: {}
    },
    graph: {
      totalNodes: 5,
      totalEdges: 4,
      health: 86,
      orphanNodes: 1,
      lowConfidenceEdges: 0,
      staleNodes: 0
    }
  };

  const nodes: GraphNode[] = [
    {
      id: projectNodeId,
      type: "Project",
      projectId,
      title: "Xedoc Projects MVP",
      description: "Project memory root.",
      createdAt,
      updatedAt: createdAt,
      source: "system",
      confidence: 1,
      metadata: { projectId }
    },
    {
      id: repoId,
      type: "Repo",
      projectId,
      title: "Repository",
      description: "Git repository will appear here after clone.",
      createdAt,
      updatedAt: createdAt,
      source: "system",
      confidence: 0.95,
      metadata: {}
    },
    {
      id: graphId,
      type: "Directory",
      projectId,
      title: ".",
      description: "Workspace root.",
      createdAt,
      updatedAt: createdAt,
      source: "system",
      confidence: 0.9,
      metadata: { path: "." }
    },
    {
      id: fileId,
      type: "File",
      projectId,
      title: "server/index.ts",
      description: "API entry point placeholder.",
      createdAt,
      updatedAt: createdAt,
      source: "system",
      confidence: 0.85,
      metadata: { path: "server/index.ts", language: "TypeScript" }
    },
    {
      id: chatId,
      type: "Chat",
      projectId,
      title: "Architecture",
      description: "Default project chat.",
      createdAt,
      updatedAt: createdAt,
      source: "system",
      confidence: 1,
      metadata: { title: "Architecture" }
    },
    {
      id: runId,
      type: "ModelRun",
      projectId,
      title: "Seed graph retrieval run",
      description: "Example model run node.",
      createdAt,
      updatedAt: createdAt,
      source: "system",
      confidence: 0.8,
      metadata: { provider: "xedoc-simulator", model: "graph-mvp" }
    }
  ];

  const edge = (fromNodeId: string, toNodeId: string, type: GraphEdge["type"]): GraphEdge => ({
    id: stableId("edge", [projectId, fromNodeId, type, toNodeId]),
    projectId,
    fromNodeId,
    toNodeId,
    type,
    weight: 1,
    confidence: 0.9,
    source: "system",
    createdAt,
    updatedAt: createdAt,
    metadata: {}
  });

  const chat: Chat = {
    id: "chat_architecture",
    projectId,
    title: "Architecture",
    model: "graph-mvp",
    provider: "xedoc-simulator",
    retrievalMode: "graph",
    createdAt,
    updatedAt: createdAt
  };

  return {
    projects: [project],
    graphNodes: nodes,
    graphEdges: [
      edge(projectNodeId, repoId, "PROJECT_HAS_REPO"),
      edge(repoId, graphId, "REPO_HAS_DIRECTORY"),
      edge(graphId, fileId, "DIRECTORY_CONTAINS_FILE"),
      edge(chatId, runId, "MODELRUN_USED_CONTEXT")
    ],
    chats: [chat],
    messages: [
      {
        id: createId("msg"),
        projectId,
        chatId: chat.id,
        role: "assistant",
        content: "Xedoc graph memory is ready. Clone a repository to replace the seed graph with real code nodes.",
        provider: "xedoc-simulator",
        model: "graph-mvp",
        createdAt
      }
    ],
    modelRuns: [],
    graphDiffs: [
      {
        id: createId("diff"),
        projectId,
        reason: "seed",
        addedNodes: nodes.length,
        removedNodes: 0,
        addedEdges: 4,
        changedEdges: 0,
        loweredConfidence: 0,
        createdAt
      }
    ],
    workers: [],
    workerJobs: []
  };
}

export class Store {
  private db: DatabaseShape | undefined;
  private writeQueue = Promise.resolve();

  async init() {
    await fs.mkdir(dataDir, { recursive: true });
    try {
      const content = await fs.readFile(storePath, "utf8");
      this.db = JSON.parse(content) as DatabaseShape;
    } catch (error) {
      const maybeNodeError = error as NodeJS.ErrnoException;
      if (maybeNodeError.code !== "ENOENT") {
        throw error;
      }

      this.db = createSeedData();
      await this.persist();
    }
  }

  snapshot(): DatabaseShape {
    if (!this.db) {
      throw new Error("Store is not initialized");
    }

    return structuredClone(this.db);
  }

  async update<T>(mutator: (db: DatabaseShape) => T | Promise<T>) {
    if (!this.db) {
      throw new Error("Store is not initialized");
    }

    const result = await mutator(this.db);
    await this.persist();
    return result;
  }

  private async persist() {
    if (!this.db) {
      throw new Error("Store is not initialized");
    }

    this.writeQueue = this.writeQueue.then(async () => {
      const tmpPath = `${storePath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(this.db, null, 2));
      await fs.rename(tmpPath, storePath);
    });

    await this.writeQueue;
  }
}

export const store = new Store();
