import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");

function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".git"
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

describe("Documentation npm run commands (M-07)", () => {
  it("verifies every npm run <script> referenced in .md files exists in package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    const mdFiles = collectMarkdownFiles(REPO_ROOT);
    expect(mdFiles.length).toBeGreaterThan(0);

    const missing: Array<{ file: string; script: string }> = [];
    const pattern = /\bnpm run ([a-zA-Z0-9:_-]+)/g;

    for (const file of mdFiles) {
      const content = fs.readFileSync(file, "utf8");
      for (const match of content.matchAll(pattern)) {
        const script = match[1]!;
        if (!Object.hasOwn(pkg.scripts, script)) {
          missing.push({
            file: path.relative(REPO_ROOT, file),
            script,
          });
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
