import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const project = path.resolve(import.meta.dirname, "../..");
const fixtures: string[] = [];
afterEach(() =>
  fixtures
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

function runSecurity(version: string, shallow = false) {
  const dir = mkdtempSync(path.join(tmpdir(), "sprint0-security-"));
  fixtures.push(dir);
  copyFileSync(
    path.join(project, "package.json"),
    path.join(dir, "package.json"),
  );
  if (existsSync(path.join(project, "scripts"))) {
    cpSync(path.join(project, "scripts"), path.join(dir, "scripts"), {
      recursive: true,
    });
  }
  execFileSync("git", ["init", "-q", dir]);
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@local.invalid",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "fixture",
    ],
    { cwd: dir },
  );
  if (shallow) {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    });
    writeFileSync(path.join(dir, ".git/shallow"), head);
  }
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "gitleaks"),
    `#!/bin/sh\nif [ "$1" = version ]; then echo '${version}'; else echo scanner >> "$SECURITY_CALLS"; fi\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(bin, "npm"),
    '#!/bin/sh\necho audit >> "$SECURITY_CALLS"\n',
    { mode: 0o755 },
  );
  const calls = path.join(dir, "calls");
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath!, "run", "security", "--silent"],
    {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin:${path.dirname(process.execPath)}`,
        SECURITY_CALLS: calls,
      },
      encoding: "utf8",
    },
  );
  return {
    ...result,
    calls: existsSync(calls)
      ? readFileSync(calls, "utf8").trim().split("\n")
      : [],
  };
}

describe("security entry point prerequisites", () => {
  it("runs scanner and audit only with the pinned scanner and full Git history", () => {
    const result = runSecurity("8.30.1");
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toEqual(["scanner", "audit"]);
  });

  it("rejects the wrong scanner version before scanner or audit can report success", () => {
    const result = runSecurity("8.29.0");
    expect(result.status).not.toBe(0);
    expect(result.calls).toEqual([]);
  });

  it("rejects shallow Git history before scanner or audit can report success", () => {
    const result = runSecurity("8.30.1", true);
    expect(result.status).not.toBe(0);
    expect(result.calls).toEqual([]);
  });
});
