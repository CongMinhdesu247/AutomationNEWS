const base = "http://127.0.0.1:8098";
const created = await fetch(base + "/api/digests", {
  method: "POST",
  headers: { "Idempotency-Key": crypto.randomUUID() },
});
if (created.status !== 202) throw new Error("create failed");
const { runId } = await created.json();
const controller = new AbortController();
const response = await fetch(
  base +
    "/api/runs/" +
    runId +
    "/events?cursor=" +
    encodeURIComponent(runId + ":0"),
  { signal: controller.signal },
);
if (!response.headers.get("content-type")?.includes("text/event-stream"))
  throw new Error("Not SSE");
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let receivedId = "";
let liveSync = false;
for (let i = 0; i < 20 && !liveSync; i++) {
  const part = await reader.read();
  buffer += decoder.decode(part.value);
  const matches = [...buffer.matchAll(/^id: (.+)$/gm)];
  receivedId = matches.at(-1)?.[1] ?? receivedId;
  if (buffer.includes("event: sync") && buffer.includes('"terminal":false'))
    liveSync = true;
}
if (!liveSync || !receivedId) throw new Error("Nginx buffered until terminal");
controller.abort();
await reader.cancel().catch(() => {});
const replay = await fetch(
  base +
    "/api/runs/" +
    runId +
    "/events?cursor=" +
    encodeURIComponent(runId + ":0"),
  {
    headers: { "Last-Event-ID": receivedId },
    signal: AbortSignal.timeout(15000),
  },
);
const text = await replay.text();
const eventIds = [...text.matchAll(/^id: (.+)$/gm)].map((match) => match[1]);
if (
  eventIds.some(
    (id) => BigInt(id.split(":")[1]) <= BigInt(receivedId.split(":")[1]),
  )
)
  throw new Error("Reconnect ignored Last-Event-ID");
if (!text.includes('"terminal":true')) throw new Error("Missing terminal sync");
console.log(
  "PASS: real Nginx delivers live events before terminal, Last-Event-ID replays strictly after cursor, terminal sync received.",
);
