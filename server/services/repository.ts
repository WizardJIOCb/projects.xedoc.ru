import fs from "node:fs/promises";
import path from "node:path";
import type { RepositoryTreeItem } from "../../shared/types.js";
import { assertWithin, projectRepoPath } from "../lib/paths.js";

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  ".turbo",
  "vendor",
  "target"
]);

const ignoredFiles = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

export function languageFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TSX",
    ".js": "JavaScript",
    ".jsx": "JSX",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".php": "PHP",
    ".java": "Java",
    ".cs": "CSharp",
    ".json": "JSON",
    ".md": "Markdown",
    ".css": "CSS",
    ".scss": "SCSS",
    ".html": "HTML",
    ".vue": "Vue",
    ".svelte": "Svelte",
    ".sql": "SQL",
    ".yml": "YAML",
    ".yaml": "YAML"
  };

  return map[ext] || "Text";
}

export async function readRepositoryTree(projectId: string, maxItems = 1600): Promise<RepositoryTreeItem[]> {
  const repoPath = projectRepoPath(projectId);
  let count = 0;

  const repoStat = await fs.stat(repoPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!repoStat?.isDirectory()) {
    return [];
  }

  async function walk(relativePath: string): Promise<RepositoryTreeItem[]> {
    if (count > maxItems) {
      return [];
    }

    const currentPath = assertWithin(repoPath, path.join(repoPath, relativePath));
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const items: RepositoryTreeItem[] = [];

    for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      if (count > maxItems) {
        break;
      }
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
        continue;
      }
      if (entry.isFile() && ignoredFiles.has(entry.name)) {
        continue;
      }

      const childRelative = relativePath ? path.posix.join(relativePath.split(path.sep).join(path.posix.sep), entry.name) : entry.name;
      const childPath = assertWithin(repoPath, path.join(repoPath, childRelative));
      count += 1;

      if (entry.isDirectory()) {
        items.push({
          path: childRelative,
          name: entry.name,
          kind: "directory",
          children: await walk(childRelative)
        });
      } else if (entry.isFile()) {
        const stat = await fs.stat(childPath);
        items.push({
          path: childRelative,
          name: entry.name,
          kind: "file",
          language: languageFromPath(entry.name),
          size: stat.size
        });
      }
    }

    return items;
  }

  return walk("");
}

export async function readRepositoryFile(projectId: string, requestedPath: string) {
  const repoPath = projectRepoPath(projectId);
  const filePath = assertWithin(repoPath, path.join(repoPath, requestedPath));
  const stat = await fs.stat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error("Repository is not cloned yet, or the file no longer exists");
    }
    throw error;
  });
  if (!stat.isFile()) {
    throw new Error("Requested path is not a file");
  }
  if (stat.size > 1_000_000) {
    throw new Error("File is too large to preview");
  }

  return fs.readFile(filePath, "utf8");
}

export { ignoredDirectories, ignoredFiles };
