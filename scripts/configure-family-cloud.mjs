// Run on the owner's machine. Prefer passing a fine-grained repo-scoped token via HUB_CLOUD_TOKEN_INPUT.
// Never print the credential or copy it to browser state.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
function sanitizeEnvValue(value) {
  if (/[\r\n#]/.test(value)) throw new Error("Unsafe env value");
  return value.replaceAll("$", "$$");
}
try {
  execFileSync("git", ["check-ignore", ".env"], { stdio: "pipe" });
  const remote = execFileSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  const repository = remote.match(
    /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
  )?.[1];
  if (!repository || repository.includes("..")) throw Error();
  let env = await readFile(".env", "utf8");
  let token = process.env.HUB_CLOUD_TOKEN_INPUT?.trim();
  if (!token) {
    console.warn(
      "Cảnh báo: Đang đọc token từ git credential helper. Khuyến nghị truyền HUB_CLOUD_TOKEN_INPUT chứa fine-grained token chỉ cấp quyền cho riêng repository này.",
    );
    const credentials = execFileSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    });
    token = credentials
      .split(/\r?\n/)
      .find((l) => l.startsWith("password="))
      ?.slice(9);
  }
  if (!token) throw Error();
  const check = await fetch(
    `https://api.github.com/repos/${repository}/actions/secrets/public-key`,
    {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!check.ok) throw Error();
  for (const [name, value] of [
    ["HUB_CLOUD_REPOSITORY", sanitizeEnvValue(repository)],
    ["HUB_CLOUD_ADMIN_TOKEN", sanitizeEnvValue(token)],
  ]) {
    env = env.replace(new RegExp("^" + name + "=.*(?:\\r?\\n|$)", "gm"), "");
    env = env.trimEnd() + "\n" + name + "=" + value + "\n";
  }
  await writeFile(".env", env, { mode: 0o600 });
  if (process.platform === "win32" && process.env.USERNAME) {
    try {
      execFileSync(
        "icacls",
        [".env", "/inheritance:r", "/grant:r", `${process.env.USERNAME}:(R,W)`],
        { stdio: "pipe" },
      );
    } catch {
      // Non-fatal if icacls is restricted in the current shell.
    }
  }
  console.log(
    "Configured local family cloud administration in ignored .env. Restart the API to apply.",
  );
} catch {
  console.error(
    "Family cloud setup failed. Verify GitHub sign-in, repository secret permissions and ignored .env; credentials were not printed.",
  );
  process.exitCode = 1;
}
