import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "../../shared/types.js";
import { assertWithin, projectRepoPath, projectWorkspace, workspaceDir } from "../lib/paths.js";
import { runProcess } from "../lib/process.js";

export function validateGitUrl(gitUrl: string) {
  const value = gitUrl.trim();
  const isHttps = /^https:\/\/[\w.-]+\/[\w./-]+(?:\.git)?$/i.test(value);
  const isSsh = /^git@[\w.-]+:[\w./-]+(?:\.git)?$/i.test(value);
  const isSshUrl = /^ssh:\/\/git@[\w.-]+\/[\w./-]+(?:\.git)?$/i.test(value);

  if (!isHttps && !isSsh && !isSshUrl) {
    throw new Error("Only https and git SSH repository URLs are supported");
  }

  return value;
}

export async function cloneOrPull(project: Project) {
  const gitUrl = validateGitUrl(project.gitUrl);
  const workspace = projectWorkspace(project.id);
  const repoPath = projectRepoPath(project.id);
  await fs.mkdir(workspace, { recursive: true });
  assertWithin(workspaceDir, workspace);

  const gitDir = path.join(repoPath, ".git");
  const branch = project.branch || "main";

  const existingRepo = await fs.access(gitDir).then(() => true).catch(() => false);
  if (existingRepo) {
    const checkout = await runProcess("git", ["checkout", branch], repoPath);
    if (checkout.code !== 0) {
      throw new Error(checkout.stderr || checkout.stdout);
    }

    const pull = await runProcess("git", ["pull", "--ff-only"], repoPath, 180_000);
    if (pull.code !== 0) {
      throw new Error(pull.stderr || pull.stdout);
    }

    return repoPath;
  }

  await fs.rm(assertWithin(workspace, repoPath), { recursive: true, force: true });

  const args = ["clone", "--depth", "1"];
  if (branch) {
    args.push("--branch", branch);
  }
  args.push(gitUrl, repoPath);

  const clone = await runProcess("git", args, workspace, 240_000);
  if (clone.code !== 0) {
    if (branch && /Remote branch .* not found|not found in upstream/i.test(clone.stderr)) {
      const fallback = await runProcess("git", ["clone", "--depth", "1", gitUrl, repoPath], workspace, 240_000);
      if (fallback.code === 0) {
        return repoPath;
      }
      throw new Error(fallback.stderr || fallback.stdout);
    }

    throw new Error(clone.stderr || clone.stdout);
  }

  return repoPath;
}

export async function gitStatus(repoPath: string) {
  const result = await runProcess("git", ["status", "--short", "--branch"], repoPath);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout);
  }

  return result.stdout.trim();
}
