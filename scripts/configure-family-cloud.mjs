// Run on the owner's machine. Never print the credential or copy it to browser state.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
try {
  execFileSync("git", ["check-ignore", ".env"], { stdio: "pipe" });
  const remote = execFileSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  const repository = remote.match(
    /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
  )?.[1];
  if (!repository) throw Error();
  let env = await readFile(".env", "utf8");
  const credentials = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  });
  const token = credentials
    .split(/\r?\n/)
    .find((l) => l.startsWith("password="))
    ?.slice(9);
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
    ["HUB_CLOUD_REPOSITORY", repository],
    ["HUB_CLOUD_ADMIN_TOKEN", token],
  ]) {
    env = env.replace(new RegExp("^" + name + "=.*(?:\\r?\\n|$)", "gm"), "");
    env = env.trimEnd() + "\n" + name + "=" + value + "\n";
  }
  await writeFile(".env", env, { mode: 0o600 });
  console.log(
    "Configured local family cloud administration in ignored .env. Restart the API to apply.",
  );
} catch {
  console.error(
    "Family cloud setup failed. Verify GitHub sign-in, repository secret permissions and ignored .env; credentials were not printed.",
  );
  process.exitCode = 1;
}
