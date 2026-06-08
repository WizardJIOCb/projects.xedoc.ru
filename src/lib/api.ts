import type {
  Chat,
  GraphDiff,
  GraphEdge,
  GraphNode,
  Message,
  ModelRun,
  ModelProviderOption,
  Neighborhood,
  Project,
  RepositoryTreeItem,
  WorkerInfo
} from "../../shared/types";

const tokenKey = "xedoc_projects_token";

export function getToken() {
  return localStorage.getItem(tokenKey) || "";
}

export function setToken(token: string) {
  if (token) {
    localStorage.setItem(tokenKey, token);
  } else {
    localStorage.removeItem(tokenKey);
  }
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(payload.error || response.statusText, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export interface SessionPayload {
  authRequired: boolean;
  authenticated: boolean;
}

export interface ProjectsPayload {
  projects: Project[];
}

export interface ProjectPayload {
  project: Project;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphDiffPayload {
  diffs: GraphDiff[];
}

export interface ChatsPayload {
  chats: Chat[];
}

export interface ChatPayload {
  chat: Chat;
  messages: Message[];
  runs: ModelRun[];
}

export interface RepoTreePayload {
  tree: RepositoryTreeItem[];
}

export interface RepoFilePayload {
  path: string;
  content: string;
}

export interface WorkersPayload {
  workers: WorkerInfo[];
}

export interface ModelsPayload {
  providers: ModelProviderOption[];
}

export interface MessageCreatePayload {
  userMessage: Message;
  assistantMessage: Message;
  run: ModelRun;
}

export type NeighborhoodPayload = Neighborhood;
