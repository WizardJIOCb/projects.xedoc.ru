export type NodeType =
  | "Project"
  | "Repo"
  | "Branch"
  | "Directory"
  | "File"
  | "Symbol"
  | "Function"
  | "Class"
  | "Import"
  | "Dependency"
  | "Task"
  | "Bug"
  | "Issue"
  | "Chat"
  | "Message"
  | "Memory"
  | "ToolCall"
  | "ModelRun"
  | "Patch"
  | "Diff"
  | "Document"
  | "Chunk"
  | "Embedding"
  | "User"
  | "Agent"
  | "Provider"
  | "Model"
  | "Secret"
  | "Environment"
  | "Deployment";

export type EdgeType =
  | "PROJECT_HAS_CHAT"
  | "PROJECT_HAS_REPO"
  | "REPO_HAS_BRANCH"
  | "BRANCH_HAS_COMMIT"
  | "COMMIT_CHANGED_FILE"
  | "DIRECTORY_CONTAINS_FILE"
  | "DIRECTORY_CONTAINS_DIRECTORY"
  | "REPO_HAS_DIRECTORY"
  | "FILE_IMPORTS_FILE"
  | "FILE_DEFINES_SYMBOL"
  | "SYMBOL_CALLS_SYMBOL"
  | "SYMBOL_USES_DEPENDENCY"
  | "TASK_MENTIONS_FILE"
  | "TASK_RELATED_TO_BUG"
  | "BUG_AFFECTS_SYMBOL"
  | "BUG_FIXED_BY_COMMIT"
  | "CHAT_HAS_MESSAGE"
  | "MESSAGE_MENTIONS_FILE"
  | "MESSAGE_MENTIONS_SYMBOL"
  | "MESSAGE_CREATED_TASK"
  | "MESSAGE_CREATED_MEMORY"
  | "TOOLCALL_READ_FILE"
  | "TOOLCALL_WROTE_FILE"
  | "TOOLCALL_CREATED_PATCH"
  | "MODELRUN_USED_CONTEXT"
  | "MODELRUN_PRODUCED_MESSAGE"
  | "MEMORY_RELATED_TO_PROJECT"
  | "DOCUMENT_HAS_CHUNK"
  | "CHUNK_EMBEDDED_AS"
  | "AGENT_USED_MODEL"
  | "PROJECT_DEPLOYED_TO"
  | "DEPLOYMENT_USES_ENV";

export type SourceType =
  | "user_manual"
  | "git_indexer"
  | "code_parser"
  | "chat_message"
  | "codex"
  | "grok"
  | "gemini"
  | "ollama"
  | "tool_call"
  | "import"
  | "external_doc"
  | "system";

export interface Project {
  id: string;
  name: string;
  description: string;
  gitUrl: string;
  branch: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  repo: {
    status: "not_cloned" | "cloning" | "ready" | "error";
    path?: string;
    lastSyncAt?: string;
    error?: string;
    files: number;
    directories: number;
    languages: Record<string, number>;
  };
  graph: {
    totalNodes: number;
    totalEdges: number;
    health: number;
    orphanNodes: number;
    lowConfidenceEdges: number;
    staleNodes: number;
  };
}

export interface GraphNode {
  id: string;
  type: NodeType;
  projectId: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  source: SourceType;
  sourceId?: string;
  confidence: number;
  metadata: Record<string, unknown>;
  deletedAt?: string;
}

export interface GraphEdge {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  weight: number;
  confidence: number;
  source: SourceType;
  sourceEventId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  deletedAt?: string;
}

export interface Chat {
  id: string;
  projectId: string;
  title: string;
  model: string;
  provider: string;
  retrievalMode: "graph" | "vector_start" | "manual";
  providerState?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  projectId: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  provider?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  createdAt: string;
}

export interface ModelRun {
  id: string;
  projectId: string;
  chatId: string;
  provider: string;
  model: string;
  temperature: number;
  contextNodes: string[];
  contextEdges: string[];
  latencyMs: number;
  status: "queued" | "running" | "succeeded" | "failed";
  error?: string;
  input: string;
  output?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface GraphDiff {
  id: string;
  projectId: string;
  reason: string;
  addedNodes: number;
  removedNodes: number;
  addedEdges: number;
  changedEdges: number;
  loweredConfidence: number;
  createdAt: string;
}

export interface WorkerInfo {
  id: string;
  name: string;
  tokenHash: string;
  status: "online" | "offline";
  lastHeartbeatAt?: string;
  capabilities: {
    models: string[];
    cpu?: string;
    gpu?: string;
    ramGb?: number;
    tools: string[];
    maxContext?: number;
  };
  load: {
    runningJobs: number;
    queuedJobs: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface WorkerJob {
  id: string;
  projectId: string;
  workerId?: string;
  type: "model_completion" | "embedding_generation" | "code_indexing" | "graph_extraction" | "repo_analysis";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  logs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryTreeItem {
  path: string;
  name: string;
  kind: "file" | "directory";
  language?: string;
  size?: number;
  children?: RepositoryTreeItem[];
}

export interface Neighborhood {
  nodes: GraphNode[];
  edges: GraphEdge[];
  startNodeId?: string;
  depth: number;
}

export interface ModelProviderOption {
  provider: string;
  model: string;
  label: string;
  status: "ready" | "missing_key" | "worker" | "simulator";
  configured: boolean;
  kind?: string;
  note?: string;
  worker?: string;
}

export interface DatabaseShape {
  projects: Project[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  chats: Chat[];
  messages: Message[];
  modelRuns: ModelRun[];
  graphDiffs: GraphDiff[];
  workers: WorkerInfo[];
  workerJobs: WorkerJob[];
}
