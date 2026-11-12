import "../env.js";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseCloudSettings } from "./digest.js";

try {
  const response = await fetch("http://127.0.0.1:8088/api/settings", {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Local dashboard unavailable.");
  const settings = parseCloudSettings(await response.text());
  const directory = new URL("../../../../output/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const file = new URL("cloud-config.secrets.json", directory);
  await writeFile(
    file,
    JSON.stringify({
      HUB_SETTINGS_JSON: JSON.stringify(settings),
      NTFY_TOKEN: process.env.NTFY_TOKEN ?? "",
    }),
    { mode: 0o600 },
  );
  console.log(
    "Cloud secret configuration exported locally:",
    fileURLToPath(file),
  );
  console.log(
    "Do not commit or share this file. Upload values as GitHub Actions repository secrets.",
  );
} catch {
  console.error(
    "Cloud export failed. Enable sources and ntfy in the local dashboard, then retry.",
  );
  process.exitCode = 1;
}
