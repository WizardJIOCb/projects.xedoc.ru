import {
  Activity,
  Bot,
  Boxes,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  Cpu,
  Database,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  KeyRound,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Network,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings2,
  Shield,
  Split,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, BrowserRouter as Router, Routes, useNavigate, useParams } from "react-router-dom";
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node, type NodeMouseHandler } from "@xyflow/react";
import type { Chat, GraphEdge, GraphNode, Message, Project, RepositoryTreeItem } from "../shared/types";
import {
  ApiError,
  api,
  type ChatPayload,
  type ChatsPayload,
  type GraphDiffPayload,
  type GraphPayload,
  type MessageCreatePayload,
  type ModelsPayload,
  type NeighborhoodPayload,
  type ProjectPayload,
  type ProjectsPayload,
  type RepoFilePayload,
  type RepoTreePayload,
  type SessionPayload,
  type WorkersPayload,
  getToken,
  setToken
} from "./lib/api";

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatDate(value?: string) {
  if (!value) {
    return "never";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loader());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className={classNames("metric", tone && `metric-${tone}`)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === "ready" || status === "online" ? "good" : status === "error" || status === "offline" ? "bad" : "warn";
  return <span className={classNames("status-pill", `status-${tone}`)}>{status}</span>;
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof CircleDot; title: string; text: string }) {
  return (
    <div className="empty-state">
      <Icon size={28} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionPayload | undefined>();
  const [tokenInput, setTokenInput] = useState(getToken());
  const [error, setError] = useState("");

  const checkSession = useCallback(async () => {
    const payload = await api<SessionPayload>("/api/session").catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        return { authRequired: true, authenticated: false };
      }
      throw err;
    });
    setSession(payload);
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  if (!session) {
    return <div className="boot-screen"><Loader2 className="spin" /> Connecting to Xedoc Projects</div>;
  }

  if (session.authRequired && !session.authenticated) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <div className="brand-lock">
            <Shield size={24} />
            <div>
              <strong>Xedoc Projects</strong>
              <span>Protected workspace</span>
            </div>
          </div>
          <label>
            Access token
            <input
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              type="password"
              placeholder="Paste deployment token"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button
            className="primary-button"
            onClick={async () => {
              setToken(tokenInput.trim());
              setError("");
              try {
                await checkSession();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <KeyRound size={16} /> Unlock
          </button>
        </section>
      </main>
    );
  }

  return children;
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Network size={22} />
          </div>
          <div>
            <strong>Xedoc Projects</strong>
            <span>Graph memory for code</span>
          </div>
        </div>
        <nav>
          <NavLink to="/projects" className={({ isActive }) => classNames("nav-item", isActive && "active")}>
            <LayoutDashboard size={18} /> Projects
          </NavLink>
          <NavLink to="/workers" className={({ isActive }) => classNames("nav-item", isActive && "active")}>
            <Server size={18} /> Workers
          </NavLink>
        </nav>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => api<ProjectsPayload>("/api/projects"), []);
  const [form, setForm] = useState({ name: "", description: "", gitUrl: "", branch: "main" });
  const [submitting, setSubmitting] = useState(false);
  const projects = data?.projects || [];
  const totals = projects.reduce(
    (acc, project) => ({
      files: acc.files + project.repo.files,
      nodes: acc.nodes + project.graph.totalNodes,
      edges: acc.edges + project.graph.totalEdges,
      active: acc.active + Number(project.repo.status === "cloning")
    }),
    { files: 0, nodes: 0, edges: 0, active: 0 }
  );

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <p className="eyebrow">Project graph control plane</p>
          <h1>Projects</h1>
        </div>
        <button className="ghost-button" onClick={reload}>
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      <section className="metrics-row">
        <Metric label="Projects" value={projects.length} />
        <Metric label="Files indexed" value={totals.files} />
        <Metric label="Graph nodes" value={totals.nodes} tone="good" />
        <Metric label="Graph edges" value={totals.edges} />
      </section>

      <section className="split-layout">
        <form
          className="create-panel"
          onSubmit={async (event) => {
            event.preventDefault();
            setSubmitting(true);
            try {
              const result = await api<ProjectPayload>("/api/projects", {
                method: "POST",
                body: JSON.stringify(form)
              });
              navigate(`/projects/${result.project.id}`);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="section-heading">
            <Plus size={18} />
            <h2>Create project</h2>
          </div>
          <label>
            Name
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="Auth service refactor" />
          </label>
          <label>
            Description
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What the graph should remember about this workspace" />
          </label>
          <label>
            Git URL
            <input value={form.gitUrl} onChange={(event) => setForm({ ...form, gitUrl: event.target.value })} placeholder="https://github.com/org/repo.git" />
          </label>
          <label>
            Branch
            <input value={form.branch} onChange={(event) => setForm({ ...form, branch: event.target.value })} placeholder="main" />
          </label>
          <button className="primary-button" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : <Plus size={16} />} Create
          </button>
        </form>

        <section className="list-panel">
          <div className="section-heading">
            <Boxes size={18} />
            <h2>Workspaces</h2>
          </div>
          {loading && <div className="inline-loading"><Loader2 className="spin" /> Loading projects</div>}
          {error && <p className="form-error">{error}</p>}
          {!loading && projects.length === 0 && <EmptyState icon={FolderGit2} title="No projects yet" text="Create the first workspace to start building a graph." />}
          <div className="project-list">
            {projects.map((project) => (
              <button key={project.id} className="project-row" onClick={() => navigate(`/projects/${project.id}`)}>
                <div className="project-row-main">
                  <FolderGit2 size={20} />
                  <div>
                    <strong>{project.name}</strong>
                    <span>{project.gitUrl || "Repository not connected"}</span>
                  </div>
                </div>
                <div className="project-row-stats">
                  <StatusPill status={project.repo.status} />
                  <span>{project.graph.totalNodes} nodes</span>
                  <ChevronRight size={18} />
                </div>
              </button>
            ))}
          </div>
        </section>
      </section>
    </AppShell>
  );
}

function ProjectPage() {
  const { projectId } = useParams();
  const { data, error, loading, reload, setData } = useAsync(() => api<ProjectPayload>(`/api/projects/${projectId}`), [projectId]);
  const project = data?.project;

  if (loading) {
    return <AppShell><div className="boot-screen"><Loader2 className="spin" /> Loading project</div></AppShell>;
  }
  if (error || !project) {
    return <AppShell><EmptyState icon={CircleDot} title="Project unavailable" text={error || "The project could not be loaded."} /></AppShell>;
  }

  return (
    <AppShell>
      <header className="page-header project-header">
        <div>
          <p className="eyebrow">{project.type} / {project.branch}</p>
          <h1>{project.name}</h1>
          <span className="subtle">{project.description || project.gitUrl || project.id}</span>
        </div>
        <div className="header-actions">
          <StatusPill status={project.repo.status} />
          <button className="ghost-button" onClick={reload}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </header>
      <nav className="tabs">
        <NavLink end to={`/projects/${project.id}`} className={({ isActive }) => classNames("tab", isActive && "active")}><Activity size={16} /> Overview</NavLink>
        <NavLink to={`/projects/${project.id}/repo`} className={({ isActive }) => classNames("tab", isActive && "active")}><Code2 size={16} /> Repo</NavLink>
        <NavLink to={`/projects/${project.id}/chats`} className={({ isActive }) => classNames("tab", isActive && "active")}><MessageSquare size={16} /> Chats</NavLink>
        <NavLink to={`/projects/${project.id}/graph`} className={({ isActive }) => classNames("tab", isActive && "active")}><Network size={16} /> Graph</NavLink>
        <NavLink to={`/projects/${project.id}/models`} className={({ isActive }) => classNames("tab", isActive && "active")}><Bot size={16} /> Models</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<ProjectOverview project={project} />} />
        <Route path="/repo" element={<RepoPanel project={project} onProjectChange={(updated) => setData({ project: updated })} />} />
        <Route path="/chats" element={<ChatsPanel project={project} />} />
        <Route path="/graph" element={<GraphPanel project={project} />} />
        <Route path="/models" element={<ModelsPanel />} />
      </Routes>
    </AppShell>
  );
}

function ProjectOverview({ project }: { project: Project }) {
  const topLanguages = Object.entries(project.repo.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <section className="overview-grid">
      <div className="overview-main">
        <section className="metrics-row">
          <Metric label="Graph health" value={`${project.graph.health}/100`} tone={project.graph.health > 75 ? "good" : "warn"} />
          <Metric label="Files" value={project.repo.files} />
          <Metric label="Directories" value={project.repo.directories} />
          <Metric label="Last sync" value={formatDate(project.repo.lastSyncAt)} />
        </section>
        <section className="data-panel">
          <div className="section-heading">
            <Database size={18} />
            <h2>Graph health</h2>
          </div>
          <div className="health-layout">
            <div className="health-score" style={{ ["--score" as string]: `${project.graph.health}%` }}>
              <strong>{project.graph.health}</strong>
              <span>score</span>
            </div>
            <div className="health-table">
              <span>Orphan nodes</span><strong>{project.graph.orphanNodes}</strong>
              <span>Low confidence edges</span><strong>{project.graph.lowConfidenceEdges}</strong>
              <span>Stale nodes</span><strong>{project.graph.staleNodes}</strong>
              <span>Total edges</span><strong>{project.graph.totalEdges}</strong>
            </div>
          </div>
        </section>
      </div>
      <aside className="data-panel">
        <div className="section-heading">
          <GitBranch size={18} />
          <h2>Repository</h2>
        </div>
        <div className="kv-list">
          <span>Status</span><StatusPill status={project.repo.status} />
          <span>Branch</span><strong>{project.branch}</strong>
          <span>URL</span><strong className="truncate">{project.gitUrl || "not set"}</strong>
          <span>Error</span><strong className="truncate">{project.repo.error || "none"}</strong>
        </div>
        <div className="language-bars">
          {topLanguages.map(([language, count]) => (
            <div key={language}>
              <span>{language}</span>
              <div><i style={{ width: `${Math.max(8, (count / Math.max(1, project.repo.files)) * 100)}%` }} /></div>
              <strong>{count}</strong>
            </div>
          ))}
          {topLanguages.length === 0 && <span className="subtle">Clone a repository to detect languages.</span>}
        </div>
      </aside>
    </section>
  );
}

function flattenTree(items: RepositoryTreeItem[], depth = 0): Array<RepositoryTreeItem & { depth: number }> {
  return items.flatMap((item) => [
    { ...item, depth },
    ...(item.children ? flattenTree(item.children, depth + 1) : [])
  ]);
}

function RepoPanel({ project, onProjectChange }: { project: Project; onProjectChange: (project: Project) => void }) {
  const [gitUrl, setGitUrl] = useState(project.gitUrl);
  const [branch, setBranch] = useState(project.branch);
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [file, setFile] = useState<RepoFilePayload | undefined>();
  const treeState = useAsync(() => api<RepoTreePayload>(`/api/projects/${project.id}/repo/tree`), [project.id, project.repo.lastSyncAt]);
  const flatTree = useMemo(() => flattenTree(treeState.data?.tree || []), [treeState.data]);

  async function syncRepo() {
    setBusy(true);
    setSyncError("");
    try {
      const result = await api<{ project: Project }>(`/api/projects/${project.id}/repo/clone`, {
        method: "POST",
        body: JSON.stringify({ gitUrl, branch })
      });
      onProjectChange(result.project);
      await treeState.reload();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function openFile(item: RepositoryTreeItem) {
    if (item.kind !== "file") {
      return;
    }
    setSelectedPath(item.path);
    setFile(await api<RepoFilePayload>(`/api/projects/${project.id}/repo/file?path=${encodeURIComponent(item.path)}`));
  }

  return (
    <section className="repo-layout">
      <aside className="data-panel repo-control">
        <div className="section-heading">
          <FolderGit2 size={18} />
          <h2>Git workspace</h2>
        </div>
        <label>
          Git URL
          <input value={gitUrl} onChange={(event) => setGitUrl(event.target.value)} placeholder="https://github.com/org/repo.git" />
        </label>
        <label>
          Branch
          <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="main" />
        </label>
        <button className="primary-button" onClick={syncRepo} disabled={busy || !gitUrl}>
          {busy ? <Loader2 className="spin" size={16} /> : <GitPullRequest size={16} />} Clone / Pull
        </button>
        {syncError && <p className="form-error">{syncError}</p>}
        <div className="kv-list">
          <span>Status</span><StatusPill status={project.repo.status} />
          <span>Files</span><strong>{project.repo.files}</strong>
          <span>Directories</span><strong>{project.repo.directories}</strong>
        </div>
      </aside>

      <section className="data-panel file-tree-panel">
        <div className="section-heading">
          <Split size={18} />
          <h2>File tree</h2>
        </div>
        {treeState.loading && <div className="inline-loading"><Loader2 className="spin" /> Reading tree</div>}
        {treeState.error && <p className="form-error">{treeState.error}</p>}
        <div className="file-tree">
          {flatTree.map((item) => (
            <button
              key={item.path}
              className={classNames("tree-row", selectedPath === item.path && "active")}
              style={{ paddingLeft: 12 + item.depth * 16 }}
              onClick={() => void openFile(item)}
            >
              {item.kind === "directory" ? <FolderGit2 size={15} /> : <FileCode2 size={15} />}
              <span>{item.name}</span>
              {item.language && <em>{item.language}</em>}
            </button>
          ))}
          {!treeState.loading && flatTree.length === 0 && <EmptyState icon={FolderGit2} title="No tree yet" text="Clone a repository to index files." />}
        </div>
      </section>

      <section className="data-panel code-panel">
        <div className="section-heading">
          <FileCode2 size={18} />
          <h2>{file?.path || "File preview"}</h2>
        </div>
        <pre>{file?.content || "Select a file from the indexed repository."}</pre>
      </section>
    </section>
  );
}

function ChatsPanel({ project }: { project: Project }) {
  const chatsState = useAsync(() => api<ChatsPayload>(`/api/projects/${project.id}/chats`), [project.id]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [newChatTitle, setNewChatTitle] = useState("");
  const [content, setContent] = useState("");

  const chats = chatsState.data?.chats || [];
  const selectedChat = selectedChatId || chats[0]?.id || "";
  const chatState = useAsync(
    () => selectedChat ? api<ChatPayload>(`/api/projects/${project.id}/chats/${selectedChat}`) : Promise.resolve({ chat: undefined as unknown as Chat, messages: [], runs: [] }),
    [project.id, selectedChat]
  );

  useEffect(() => {
    if (!selectedChatId && chats[0]) {
      setSelectedChatId(chats[0].id);
    }
  }, [chats, selectedChatId]);

  async function createChat() {
    if (!newChatTitle.trim()) {
      return;
    }
    const result = await api<{ chat: Chat }>(`/api/projects/${project.id}/chats`, {
      method: "POST",
      body: JSON.stringify({ title: newChatTitle })
    });
    setNewChatTitle("");
    setSelectedChatId(result.chat.id);
    await chatsState.reload();
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim() || !selectedChat) {
      return;
    }
    const text = content;
    setContent("");
    await api<MessageCreatePayload>(`/api/projects/${project.id}/chats/${selectedChat}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: text })
    });
    await chatState.reload();
  }

  return (
    <section className="chat-layout">
      <aside className="data-panel chat-sidebar">
        <div className="section-heading">
          <MessageSquare size={18} />
          <h2>Chats</h2>
        </div>
        <div className="inline-form">
          <input value={newChatTitle} onChange={(event) => setNewChatTitle(event.target.value)} placeholder="New chat" />
          <button className="icon-button" onClick={createChat} title="Create chat"><Plus size={16} /></button>
        </div>
        <div className="chat-list">
          {chats.map((chat) => (
            <button key={chat.id} className={classNames("chat-row", selectedChat === chat.id && "active")} onClick={() => setSelectedChatId(chat.id)}>
              <MessageSquare size={16} />
              <span>{chat.title}</span>
              <em>{chat.model}</em>
            </button>
          ))}
        </div>
      </aside>

      <section className="data-panel chat-panel">
        <div className="section-heading">
          <BrainCircuit size={18} />
          <h2>{chatState.data?.chat?.title || "Project chat"}</h2>
        </div>
        <div className="messages">
          {chatState.loading && <div className="inline-loading"><Loader2 className="spin" /> Loading chat</div>}
          {chatState.data?.messages.map((message: Message) => (
            <article key={message.id} className={classNames("message", message.role)}>
              <header>
                <strong>{message.role}</strong>
                <span>{message.provider || "local"} {formatDate(message.createdAt)}</span>
              </header>
              <p>{message.content}</p>
            </article>
          ))}
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Ask with graph context..." />
          <button className="primary-button">
            <Send size={16} /> Send
          </button>
        </form>
      </section>
    </section>
  );
}

const nodeColors: Record<string, string> = {
  Project: "#0f766e",
  Repo: "#7c3aed",
  Directory: "#b45309",
  File: "#2563eb",
  Function: "#be123c",
  Class: "#be123c",
  Symbol: "#db2777",
  Dependency: "#4d7c0f",
  Chat: "#0d9488",
  Message: "#525252",
  ModelRun: "#ea580c"
};

function toFlow(graph: GraphPayload): { nodes: Node[]; edges: Edge[] } {
  const typeCounts = new Map<string, number>();
  const nodes = graph.nodes.map((node, index) => {
    const count = typeCounts.get(node.type) || 0;
    typeCounts.set(node.type, count + 1);
    const angle = (index / Math.max(1, graph.nodes.length)) * Math.PI * 2;
    const radius = 160 + (count % 4) * 52;
    return {
      id: node.id,
      position: { x: Math.cos(angle) * radius + 420, y: Math.sin(angle) * radius + 260 },
      data: { label: `${node.type}: ${node.title}` },
      style: {
        borderColor: nodeColors[node.type] || "#737373",
        background: "#fff",
        color: "#202421",
        borderWidth: 2,
        borderRadius: 8,
        width: 190,
        fontSize: 12
      }
    };
  });

  const edges = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.fromNodeId,
    target: edge.toNodeId,
    label: edge.type,
    style: { stroke: "#71717a", strokeWidth: Math.max(1, edge.weight * 1.5) },
    labelStyle: { fontSize: 10, fill: "#3f3f46" }
  }));

  return { nodes, edges };
}

function GraphPanel({ project }: { project: Project }) {
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState(2);
  const [selectedNode, setSelectedNode] = useState<GraphNode | undefined>();
  const [graph, setGraph] = useState<GraphPayload>({ nodes: [], edges: [] });
  const graphState = useAsync(() => api<GraphPayload>(`/api/projects/${project.id}/graph`), [project.id]);
  const diffState = useAsync(() => api<GraphDiffPayload>(`/api/projects/${project.id}/graph/diff`), [project.id]);
  const flow = useMemo(() => toFlow(graph), [graph]);
  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    void expandNode(node.id);
  };

  useEffect(() => {
    if (graphState.data) {
      setGraph(graphState.data);
    }
  }, [graphState.data]);

  async function searchGraph() {
    if (!query.trim()) {
      setGraph(graphState.data || { nodes: [], edges: [] });
      return;
    }
    const result = await api<{ nodes: GraphNode[] }>(`/api/projects/${project.id}/graph/search?q=${encodeURIComponent(query)}`);
    setGraph({ nodes: result.nodes, edges: [] });
  }

  async function expandNode(nodeId: string) {
    const result = await api<NeighborhoodPayload>(`/api/projects/${project.id}/graph/neighborhood?nodeId=${encodeURIComponent(nodeId)}&depth=${depth}`);
    setGraph({ nodes: result.nodes, edges: result.edges });
    setSelectedNode(result.nodes.find((node) => node.id === nodeId));
  }

  return (
    <section className="graph-layout">
      <section className="data-panel graph-toolbar">
        <div className="section-heading">
          <Network size={18} />
          <h2>Graph Explorer</h2>
        </div>
        <div className="toolbar-row">
          <div className="search-box">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes by path, symbol, title" />
          </div>
          <button className="ghost-button" onClick={searchGraph}><Search size={16} /> Search</button>
          <label className="compact-label">
            Depth
            <input type="number" min={1} max={3} value={depth} onChange={(event) => setDepth(Number(event.target.value))} />
          </label>
        </div>
      </section>

      <section className="graph-stage">
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          fitView
          onNodeClick={handleNodeClick}
        >
          <Background />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </section>

      <aside className="data-panel graph-details">
        <div className="section-heading">
          <CircleDot size={18} />
          <h2>Selection</h2>
        </div>
        {selectedNode ? (
          <div className="node-details">
            <StatusPill status={selectedNode.type} />
            <h3>{selectedNode.title}</h3>
            <p>{selectedNode.description || "No description"}</p>
            <div className="kv-list">
              <span>Source</span><strong>{selectedNode.source}</strong>
              <span>Confidence</span><strong>{Math.round(selectedNode.confidence * 100)}%</strong>
              <span>Updated</span><strong>{formatDate(selectedNode.updatedAt)}</strong>
            </div>
            <pre>{JSON.stringify(selectedNode.metadata, null, 2)}</pre>
          </div>
        ) : (
          <EmptyState icon={Network} title="No node selected" text="Click a node to expand its neighborhood." />
        )}
      </aside>

      <section className="data-panel graph-diff-panel">
        <div className="section-heading">
          <Activity size={18} />
          <h2>Graph diff</h2>
        </div>
        <div className="diff-list">
          {diffState.data?.diffs.map((diff) => (
            <div key={diff.id} className="diff-row">
              <strong>{diff.reason}</strong>
              <span>+{diff.addedNodes} nodes</span>
              <span>+{diff.addedEdges} edges</span>
              <em>{formatDate(diff.createdAt)}</em>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function ModelsPanel() {
  const models = useAsync(() => api<ModelsPayload>("/api/models"), []);

  return (
    <section className="data-panel">
      <div className="section-heading">
        <Bot size={18} />
        <h2>Models</h2>
      </div>
      <div className="table-like">
        <span>Provider</span><span>Model</span><span>Status</span><span>Worker</span>
        {models.data?.providers.map((provider) => (
          <div className="table-row" key={`${provider.provider}-${provider.model}-${provider.worker || "local"}`}>
            <strong>{provider.provider}</strong>
            <span>{provider.model}</span>
            <StatusPill status={provider.status} />
            <span>{provider.worker || "server"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkersPage() {
  const workers = useAsync(() => api<WorkersPayload>("/api/workers"), []);

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <p className="eyebrow">Remote compute</p>
          <h1>Workers</h1>
        </div>
        <button className="ghost-button" onClick={workers.reload}><RefreshCw size={16} /> Refresh</button>
      </header>
      <section className="metrics-row">
        <Metric label="Workers" value={workers.data?.workers.length || 0} />
        <Metric label="Online" value={workers.data?.workers.filter((worker) => worker.status === "online").length || 0} tone="good" />
        <Metric label="Running jobs" value={workers.data?.workers.reduce((sum, worker) => sum + worker.load.runningJobs, 0) || 0} />
        <Metric label="Queued jobs" value={workers.data?.workers.reduce((sum, worker) => sum + worker.load.queuedJobs, 0) || 0} />
      </section>
      <section className="data-panel">
        <div className="section-heading">
          <Cpu size={18} />
          <h2>Connected workers</h2>
        </div>
        <div className="worker-grid">
          {workers.data?.workers.map((worker) => (
            <article key={worker.id} className="worker-card">
              <header>
                <Cpu size={18} />
                <strong>{worker.name}</strong>
                <StatusPill status={worker.status} />
              </header>
              <div className="kv-list">
                <span>Heartbeat</span><strong>{formatDate(worker.lastHeartbeatAt)}</strong>
                <span>CPU</span><strong>{worker.capabilities.cpu || "unknown"}</strong>
                <span>GPU</span><strong>{worker.capabilities.gpu || "none"}</strong>
                <span>RAM</span><strong>{worker.capabilities.ramGb ? `${worker.capabilities.ramGb} GB` : "unknown"}</strong>
              </div>
              <div className="tag-row">
                {worker.capabilities.models.map((model) => <span key={model}>{model}</span>)}
              </div>
            </article>
          ))}
          {!workers.loading && workers.data?.workers.length === 0 && <EmptyState icon={Server} title="No workers online" text="Register a home worker to expose Ollama models." />}
        </div>
      </section>
    </AppShell>
  );
}

function App() {
  return (
    <Router>
      <AuthGate>
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<Dashboard />} />
          <Route path="/projects/:projectId/*" element={<ProjectPage />} />
          <Route path="/workers" element={<WorkersPage />} />
        </Routes>
      </AuthGate>
    </Router>
  );
}

export default App;
