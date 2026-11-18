import { databaseUrl } from "../env.js";
import { createPool } from "../db.js";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCloudSettings } from "./digest.js";
import { logEvent } from "../logger.js";

const pool = createPool(databaseUrl(), { max: 2 });
try {
  const row = (
    await pool.query<{ config: unknown }>("SELECT config FROM settings WHERE id=1")
  ).rows[0];
  if (!row?.config) throw new Error("Missing settings row.");
  const settings = parseCloudSettings(JSON.stringify(row.config));
  const directory = new URL("../../../../output/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const file = new URL("cloud-config.secrets.json", directory);
  const filePath = fileURLToPath(file);
  await writeFile(
    file,
    JSON.stringify({
      HUB_SETTINGS_JSON: JSON.stringify(settings),
      NTFY_TOKEN: process.env.NTFY_TOKEN ?? "",
    }),
    { mode: 0o600 },
  );
  if (process.platform === "win32" && process.env.USERNAME) {
    try {
      execFileSync(
        "icacls",
        [filePath, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:(R,W)`],
        { stdio: "pipe" },
      );
    } catch {
      // Ignore if icacls is restricted.
    }
  }
  console.log("Cloud secret configuration exported locally:", filePath);
  console.log(
    "Do not commit or share this file. Upload values as GitHub Actions repository secrets.",
  );
} catch (error) {
  logEvent("error", "cloud.export_failed", { error });
  process.exitCode = 1;
} finally {
  await pool.end();
}
