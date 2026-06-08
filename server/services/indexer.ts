import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseShape, EdgeType, GraphDiff, GraphEdge, GraphNode, Project } from "../../shared/types.js";
import { nowIso, stableId } from "../lib/ids.js";
import { assertWithin, projectRepoPath } from "../lib/paths.js";
import { ignoredDirectories, ignoredFiles, languageFromPath } from "./repository.js";
import { store } from "./store.js";

interface IndexedFile {
  path: string;
  size: number;
  language: string;
  hash: string;
  imports: string[];
  symbols: Array<{ type: "Function" | "Class" | "Symbol"; name: string; signature?: string }>;
}

function normalizeRepoPath(value: string) {
  return value.split(path.sep).join(path.posix.sep);
}

function isReadableText(filePath: string, size: number) {
  if (size > 500_000) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  return [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".php",
    ".java",
    ".cs",
    ".json",
    ".md",
    ".css",
    ".scss",
    ".html",
    ".vue",
    ".svelte",
    ".sql",
    ".yml",
    ".yaml"
  ].includes(ext);
}

function extractImports(content: string, language: string) {
  const imports = new Set<string>();

  if (["TypeScript", "TSX", "JavaScript", "JSX", "Vue", "Svelte"].includes(language)) {
    for (const match of content.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      imports.add(match[1]);
    }
    for (const match of content.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      imports.add(match[1]);
    }
    for (const match of content.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      imports.add(match[1]);
    }
  }

  if (language === "Python") {
    for (const match of content.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      imports.add(match[1] || match[2]);
    }
  }

  if (language === "Go") {
    for (const match of content.matchAll(/import\s+(?:\(\s*)?["`]([^"`]+)["`]/g)) {
      imports.add(match[1]);
    }
  }

  return [...imports].slice(0, 80);
}

function extractSymbols(content: string, language: string) {
  const symbols = new Map<string, IndexedFile["symbols"][number]>();

  const add = (type: "Function" | "Class" | "Symbol", name: string, signature?: string) => {
    if (!name || symbols.has(`${type}:${name}`)) {
      return;
    }
    symbols.set(`${type}:${name}`, { type, name, signature });
  };

  if (["TypeScript", "TSX", "JavaScript", "JSX", "Vue", "Svelte"].includes(language)) {
    for (const match of content.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
      add("Function", match[1], `function ${match[1]}(${match[2].slice(0, 120)})`);
    }
    for (const match of content.matchAll(/\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g)) {
      add("Class", match[1], `class ${match[1]}`);
    }
    for (const match of content.matchAll(/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g)) {
      add("Function", match[1], `const ${match[1]} = (...) =>`);
    }
    for (const match of content.matchAll(/\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
      add("Symbol", match[1]);
    }
  }

  if (language === "Python") {
    for (const match of content.matchAll(/^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm)) {
      add("Function", match[1], `def ${match[1]}(${match[2].slice(0, 120)})`);
    }
    for (const match of content.matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) {
      add("Class", match[1], `class ${match[1]}`);
    }
  }

  return [...symbols.values()].slice(0, 140);
}

async function walkFiles(repoPath: string, maxFiles = 1800) {
  const files: IndexedFile[] = [];
  const directories = new Set<string>(["."]);

  async function walk(relativeDir: string) {
    if (files.length >= maxFiles) {
      return;
    }

    const absoluteDir = assertWithin(repoPath, path.join(repoPath, relativeDir));
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break;
      }
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
        continue;
      }
      if (entry.isFile() && ignoredFiles.has(entry.name)) {
        continue;
      }

      const relativePath = normalizeRepoPath(relativeDir ? path.join(relativeDir, entry.name) : entry.name);
      const absolutePath = assertWithin(repoPath, path.join(repoPath, relativePath));

      if (entry.isDirectory()) {
        directories.add(relativePath);
        await walk(relativePath);
      } else if (entry.isFile()) {
        const stat = await fs.stat(absolutePath);
        const language = languageFromPath(relativePath);
        let content = "";
        if (isReadableText(relativePath, stat.size)) {
          try {
            content = await fs.readFile(absolutePath, "utf8");
          } catch {
            content = "";
          }
        }

        const hash = createHash("sha1").update(content || `${relativePath}:${stat.size}:${stat.mtimeMs}`).digest("hex");
        files.push({
          path: relativePath,
          size: stat.size,
          language,
          hash,
          imports: content ? extractImports(content, language) : [],
          symbols: content ? extractSymbols(content, language) : []
        });
      }
    }
  }

  await walk("");

  for (const file of files) {
    const parent = path.posix.dirname(file.path);
    directories.add(parent === "." ? "." : parent);
  }

  return { files, directories: [...directories].sort() };
}

function addNode(nodes: GraphNode[], node: GraphNode) {
  if (!nodes.some((item) => item.id === node.id)) {
    nodes.push(node);
  }
}

function addEdge(edges: GraphEdge[], edge: GraphEdge) {
  if (!edges.some((item) => item.id === edge.id)) {
    edges.push(edge);
  }
}

function makeNode(projectId: string, type: GraphNode["type"], key: string, title: string, metadata: Record<string, unknown>, source: GraphNode["source"]): GraphNode {
  const createdAt = nowIso();
  return {
    id: stableId("node", [projectId, type, key]),
    type,
    projectId,
    title,
    description: typeof metadata.path === "string" ? metadata.path : "",
    createdAt,
    updatedAt: createdAt,
    source,
    confidence: 0.92,
    metadata
  };
}

function makeEdge(projectId: string, fromNodeId: string, type: EdgeType, toNodeId: string, source: GraphEdge["source"], confidence = 0.9, metadata: Record<string, unknown> = {}): GraphEdge {
  const createdAt = nowIso();
  return {
    id: stableId("edge", [projectId, fromNodeId, type, toNodeId]),
    projectId,
    fromNodeId,
    toNodeId,
    type,
    weight: 1,
    confidence,
    source,
    createdAt,
    updatedAt: createdAt,
    metadata
  };
}

function resolveLocalImport(importPath: string, fromFile: string, allFiles: Set<string>) {
  if (!importPath.startsWith(".")) {
    return undefined;
  }

  const fromDir = path.posix.dirname(fromFile);
  const base = path.posix.normalize(path.posix.join(fromDir, importPath));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.py`,
    path.posix.join(base, "index.ts"),
    path.posix.join(base, "index.tsx"),
    path.posix.join(base, "index.js"),
    path.posix.join(base, "index.jsx")
  ];

  return candidates.find((candidate) => allFiles.has(candidate));
}

function recalculateGraphStats(project: Project, db: DatabaseShape) {
  const nodes = db.graphNodes.filter((node) => node.projectId === project.id && !node.deletedAt);
  const edges = db.graphEdges.filter((edge) => edge.projectId === project.id && !edge.deletedAt);
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.fromNodeId);
    connected.add(edge.toNodeId);
  }

  const orphanNodes = nodes.filter((node) => !connected.has(node.id)).length;
  const lowConfidenceEdges = edges.filter((edge) => edge.confidence < 0.55).length;

  project.graph = {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    health: Math.max(35, Math.min(98, 100 - orphanNodes * 2 - lowConfidenceEdges * 4)),
    orphanNodes,
    lowConfidenceEdges,
    staleNodes: nodes.filter((node) => node.metadata.stale === true).length
  };
}

export async function indexProjectRepository(project: Project) {
  const repoPath = projectRepoPath(project.id);
  const indexed = await walkFiles(repoPath);
  const now = nowIso();

  return store.update((db) => {
    const beforeNodeIds = new Set(db.graphNodes.filter((node) => node.projectId === project.id).map((node) => node.id));
    const beforeEdgeIds = new Set(db.graphEdges.filter((edge) => edge.projectId === project.id).map((edge) => edge.id));
    const keptNodeSources = new Set(["system", "user_manual", "chat_message", "codex", "grok", "gemini", "ollama", "tool_call", "external_doc"]);

    db.graphNodes = db.graphNodes.filter((node) => node.projectId !== project.id || keptNodeSources.has(node.source));
    db.graphEdges = db.graphEdges.filter((edge) => edge.projectId !== project.id || keptNodeSources.has(edge.source));

    const nodes = db.graphNodes;
    const edges = db.graphEdges;
    const projectNode = makeNode(project.id, "Project", project.id, project.name, { projectId: project.id }, "system");
    const repoNode = makeNode(project.id, "Repo", project.gitUrl || project.id, project.gitUrl || "Repository", { url: project.gitUrl, branch: project.branch }, "git_indexer");
    addNode(nodes, projectNode);
    addNode(nodes, repoNode);
    addEdge(edges, makeEdge(project.id, projectNode.id, "PROJECT_HAS_REPO", repoNode.id, "git_indexer", 1));

    for (const directory of indexed.directories) {
      const title = directory === "." ? "." : path.posix.basename(directory);
      const dirNode = makeNode(project.id, "Directory", directory, title, { path: directory }, "git_indexer");
      addNode(nodes, dirNode);

      if (directory === ".") {
        addEdge(edges, makeEdge(project.id, repoNode.id, "REPO_HAS_DIRECTORY", dirNode.id, "git_indexer"));
      } else {
        const parent = path.posix.dirname(directory);
        const parentKey = parent === "." ? "." : parent;
        const parentNodeId = stableId("node", [project.id, "Directory", parentKey]);
        addEdge(edges, makeEdge(project.id, parentNodeId, "DIRECTORY_CONTAINS_DIRECTORY", dirNode.id, "git_indexer"));
      }
    }

    const allFiles = new Set(indexed.files.map((file) => file.path));
    const languages: Record<string, number> = {};

    for (const file of indexed.files) {
      languages[file.language] = (languages[file.language] || 0) + 1;
      const fileNode = makeNode(project.id, "File", file.path, file.path, {
        path: file.path,
        language: file.language,
        hash: file.hash,
        size: file.size
      }, "git_indexer");
      addNode(nodes, fileNode);

      const parent = path.posix.dirname(file.path);
      const parentNodeId = stableId("node", [project.id, "Directory", parent === "." ? "." : parent]);
      addEdge(edges, makeEdge(project.id, parentNodeId, "DIRECTORY_CONTAINS_FILE", fileNode.id, "git_indexer"));

      for (const symbol of file.symbols) {
        const symbolNode = makeNode(project.id, symbol.type, `${file.path}:${symbol.type}:${symbol.name}`, symbol.name, {
          path: file.path,
          symbolName: symbol.name,
          signature: symbol.signature,
          language: file.language
        }, "code_parser");
        addNode(nodes, symbolNode);
        addEdge(edges, makeEdge(project.id, fileNode.id, "FILE_DEFINES_SYMBOL", symbolNode.id, "code_parser", 0.82));
      }

      for (const importPath of file.imports) {
        const resolved = resolveLocalImport(importPath, file.path, allFiles);
        if (resolved) {
          const targetFileId = stableId("node", [project.id, "File", resolved]);
          addEdge(edges, makeEdge(project.id, fileNode.id, "FILE_IMPORTS_FILE", targetFileId, "code_parser", 0.75, { importPath }));
        } else if (!importPath.startsWith(".")) {
          const depName = importPath.split("/")[0].startsWith("@")
            ? importPath.split("/").slice(0, 2).join("/")
            : importPath.split("/")[0];
          const depNode = makeNode(project.id, "Dependency", depName, depName, { package: depName }, "code_parser");
          addNode(nodes, depNode);
          addEdge(edges, makeEdge(project.id, fileNode.id, "SYMBOL_USES_DEPENDENCY", depNode.id, "code_parser", 0.65, { importPath }));
        }
      }
    }

    const dbProject = db.projects.find((item) => item.id === project.id);
    if (!dbProject) {
      throw new Error("Project disappeared during indexing");
    }

    dbProject.repo = {
      status: "ready",
      path: repoPath,
      lastSyncAt: now,
      files: indexed.files.length,
      directories: indexed.directories.length,
      languages
    };
    dbProject.updatedAt = now;
    recalculateGraphStats(dbProject, db);

    const afterNodeIds = new Set(db.graphNodes.filter((node) => node.projectId === project.id).map((node) => node.id));
    const afterEdgeIds = new Set(db.graphEdges.filter((edge) => edge.projectId === project.id).map((edge) => edge.id));

    const diff: GraphDiff = {
      id: stableId("diff", [project.id, "index", now]),
      projectId: project.id,
      reason: "repo_index",
      addedNodes: [...afterNodeIds].filter((id) => !beforeNodeIds.has(id)).length,
      removedNodes: [...beforeNodeIds].filter((id) => !afterNodeIds.has(id)).length,
      addedEdges: [...afterEdgeIds].filter((id) => !beforeEdgeIds.has(id)).length,
      changedEdges: 0,
      loweredConfidence: 0,
      createdAt: now
    };
    db.graphDiffs.unshift(diff);

    return { project: dbProject, diff };
  });
}
