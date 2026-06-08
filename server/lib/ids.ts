import { createHash } from "node:crypto";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  return `${prefix}_${nanoid()}`;
}

export function stableId(prefix: string, parts: Array<string | undefined>) {
  const input = parts.filter(Boolean).join("::");
  const hash = createHash("sha1").update(input).digest("hex").slice(0, 16);
  return `${prefix}_${hash}`;
}

export function slugify(input: string) {
  const value = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  return value || "project";
}

export function hashValue(input: string) {
  return createHash("sha256").update(input).digest("hex");
}
