import path from "node:path";

export const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
export const workspaceDir = path.resolve(process.env.WORKSPACE_DIR || path.join(dataDir, "projects"));

export function assertWithin(parent: string, child: string) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const relative = path.relative(resolvedParent, resolvedChild);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes allowed directory: ${resolvedChild}`);
  }

  return resolvedChild;
}

export function projectWorkspace(projectId: string) {
  if (!/^[a-z0-9_-]+$/i.test(projectId)) {
    throw new Error("Invalid project id");
  }

  return assertWithin(workspaceDir, path.join(workspaceDir, projectId));
}

export function projectRepoPath(projectId: string) {
  return assertWithin(projectWorkspace(projectId), path.join(projectWorkspace(projectId), "repo"));
}
