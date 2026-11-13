import { parseCloudSettings, runCloudDigest, type CloudOptions } from "./digest.js";
import { GithubStateStore } from "./state.js";
import { runCloudFamily } from "./family.js";
import { safeHttp } from "../connectors/http.js";
const onSourceResults = (results: { source: string; status: string; errorCodes: string[] }[]) =>
  console.log("Source diagnostics:", JSON.stringify(results));

// Intentionally does NOT import env.ts, database code or the local scheduler.
try {
  const config = process.env.HUB_SETTINGS_JSON;
  const family = process.env.HUB_FAMILY_JSON;
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if ((!config && !family) || !token || !repository)
    throw new Error("Missing cloud configuration.");
  if (family) {
    const results = await runCloudFamily(JSON.parse(family), {
      state: new GithubStateStore(repository, token),
      http: safeHttp,
      githubToken: token,
      ntfyToken: process.env.NTFY_TOKEN,
      dryRun: process.env.HUB_DRY_RUN === "true",
      forceSend: process.env.HUB_FORCE_SEND === "true",
      profileId: process.env.HUB_PROFILE_ID || undefined,
      reportBaseUrl: process.env.HUB_REPORT_BASE_URL || undefined,
      onSourceResults,
    });
    console.log(
      "Family digest:",
      JSON.stringify({
        processed: results.length,
        sent: results.filter((r) => r.status === "sent").length,
        skipped: results.filter((r) => r.status === "already_attempted").length,
      }),
    );
  } else {
    const rawSettings = JSON.parse(config ?? "{}");
    const settings = parseCloudSettings(
      JSON.stringify({
        ...rawSettings,
        fuel: rawSettings.fuel ?? {
          enabled: process.env.HUB_FUEL_ENABLED === "true",
        },
        airQuality: rawSettings.airQuality ?? {
          enabled: process.env.HUB_AIR_QUALITY_ENABLED === "true",
        },
      }),
    );
    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: settings.newsletter.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
    if (
      localTime < settings.newsletter.sendTime &&
      process.env.HUB_FORCE_SEND !== "true"
    )
      console.log("Cloud digest: not_due");
    else {
      const options: CloudOptions = {
        signalNamespace: "0000000000000001",
        settings,
        state: new GithubStateStore(repository, token),
        githubToken: token,
        ntfyToken: process.env.NTFY_TOKEN,
        dryRun: process.env.HUB_DRY_RUN === "true",
        forceSend: process.env.HUB_FORCE_SEND === "true",
        onSourceResults,
        onSummaries: (counts) =>
          console.log(
            "Vietnamese repository summaries:",
            JSON.stringify(counts),
          ),
        onFuel: (result) => console.log("Fuel prices:", JSON.stringify(result)),
        onAirQuality: (result) =>
          console.log("Hanoi air quality:", JSON.stringify(result)),
      };
      let result = await runCloudDigest(options);
      if (result.status === "already_attempted" && (settings.gold?.enabled || settings.usd?.enabled))
        result = await runCloudDigest({ ...options, alertsOnly: true });
      console.log(
        "Cloud digest:",
        result.status,
        "sourceStatus" in result ? result.sourceStatus : "",
      );
    }
  }
} catch {
  // Never print exceptions: upstream config/network errors could contain secrets.
  console.error(
    "Cloud digest failed. Check configuration, API availability and cloud-state delivery status. No automatic resend after reservation.",
  );
  process.exitCode = 1;
}
