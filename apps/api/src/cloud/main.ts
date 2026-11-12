import { parseCloudSettings, runCloudDigest } from "./digest.js";
import { GithubStateStore } from "./state.js";

// Intentionally does NOT import env.ts, database code or the local scheduler.
try {
  const config = process.env.HUB_SETTINGS_JSON;
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!config || !token || !repository)
    throw new Error("Missing cloud configuration.");
  const result = await runCloudDigest({
    settings: parseCloudSettings(config),
    state: new GithubStateStore(repository, token),
    githubToken: token,
    ntfyToken: process.env.NTFY_TOKEN,
    dryRun: process.env.HUB_DRY_RUN === "true",
    forceSend: process.env.HUB_FORCE_SEND === "true",
  });
  console.log(
    "Cloud digest:",
    result.status,
    "sourceStatus" in result ? result.sourceStatus : "",
  );
} catch {
  // Never print exceptions: upstream config/network errors could contain secrets.
  console.error(
    "Cloud digest failed. Check configuration, API availability and cloud-state delivery status. No automatic resend after reservation.",
  );
  process.exitCode = 1;
}
