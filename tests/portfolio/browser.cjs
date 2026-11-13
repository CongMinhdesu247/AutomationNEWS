async (page) => {
  const base = await page.evaluate(() => location.origin);
  await page.setViewportSize({ width: 1280, height: 720 });
  const call = async (path, body) => {
    const response = await page.request.post(base + path, { data: body });
    if (!response.ok()) throw new Error(path + ": " + response.status());
    return response.json();
  };
  const create = async () => {
    await page.goto(base + "/#/digests");
    await page
      .getByRole("button", { name: "Tạo bản tin ngay", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Tiến độ tạo bản tin", exact: true })
      .waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: /^Trực tiếp$/ })
      .waitFor();
    return page.url().split("#/runs/")[1];
  };
  const complete = async () => {
    await page
      .getByRole("status")
      .filter({ hasText: "Đã đồng bộ sự kiện mới nhất" })
      .waitFor({ timeout: 20000 });
    await page
      .getByRole("link", { name: "Mở bản tin đã lưu", exact: true })
      .waitFor();
  };
  await call("/api/demo/mode", { mode: "success" });
  await page.goto(base + "/#weather");
  await page.getByRole("note").filter({ hasText: "DEMO FIXTURE" }).waitFor();
  await page
    .getByLabel("Tên địa điểm", { exact: true })
    .fill("[DEMO FIXTURE] Hà Nội — E2E");
  await page.getByRole("button", { name: "Lưu cấu hình", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Đã lưu cấu hình vào PostgreSQL." })
    .waitFor();
  await page.reload();
  await page.getByLabel("Tên địa điểm", { exact: true }).waitFor();
  if (
    (await page.getByLabel("Tên địa điểm", { exact: true }).inputValue()) !==
    "[DEMO FIXTURE] Hà Nội — E2E"
  )
    throw new Error("Settings not persisted");
  const eventLatencies = [];
  for (let i = 0; i < 3; i++) {
    await create();
    await page.evaluate(() => {
      const seen = new Set(
        [...document.querySelectorAll("[data-event-id]")].map((row) =>
          row.getAttribute("data-event-id"),
        ),
      );
      window.__eventSamples = [];
      window.__observer = new MutationObserver(() => {
        for (const row of document.querySelectorAll("[data-event-id]")) {
          const id = row.getAttribute("data-event-id");
          if (seen.has(id)) continue;
          seen.add(id);
          window.__eventSamples.push({
            id,
            latencyMs:
              Date.now() - Date.parse(row.getAttribute("data-event-at")),
          });
        }
      });
      window.__observer.observe(document, { subtree: true, childList: true });
    });
    await complete();
    eventLatencies.push(
      ...(await page.evaluate(() => {
        window.__observer.disconnect();
        return window.__eventSamples;
      })),
    );
  }
  await page.screenshot({
    path: "docs/images/demo-workflow.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Mở bản tin đã lưu", exact: true })
    .click();
  await page
    .getByText("[DEMO FIXTURE] Bản tin tự động", { exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: /^\[DEMO FIXTURE\] Hà Nội — E2E/ })
    .waitFor();
  await page.reload();
  await page
    .getByText("[DEMO FIXTURE] Bản tin tự động", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "docs/images/demo-digest.png",
    fullPage: true,
  });
  // Offline while retry happens, then replay through the actual Nginx proxy.
  await call("/api/demo/mode", { mode: "retry" });
  const retryRun = await create();
  await page.context().setOffline(true);
  await page
    .getByRole("status")
    .filter({ hasText: "Đang kết nối lại" })
    .waitFor();
  await page.waitForTimeout(4000);
  await page.context().setOffline(false);
  await complete();
  await page
    .getByText("Đã lên lịch thử lại node · Lấy thời tiết", { exact: true })
    .waitFor();
  const ids = await page
    .locator("[data-event-id]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-event-id")),
    );
  if (ids.length !== new Set(ids).size)
    throw new Error("Duplicate replay events");
  await page.reload();
  await complete();
  if (page.url().split("#/runs/")[1] !== retryRun)
    throw new Error("Reload lost retry run");
  await call("/api/demo/mode", { mode: "dlq" });
  const failedSourceRun = await create();
  await complete();
  const digestResponse = await page.request.get(
    base + "/api/runs/" + failedSourceRun,
  );
  const failedRun = await digestResponse.json();
  const digest = await (
    await page.request.get(base + "/api/digests/" + failedRun.digestId)
  ).json();
  if (digest.status !== "partial")
    throw new Error("Source failure did not preserve partial digest");
  await page.goto(base + "/#/automation");
  await page
    .getByRole("button", { name: "Tạo run chạy lại", exact: true })
    .first()
    .waitFor();
  await page.screenshot({ path: "docs/images/demo-dlq.png", fullPage: true });
  await call("/api/demo/mode", { mode: "success" });
  await page
    .getByRole("button", { name: "Tạo run chạy lại", exact: true })
    .first()
    .click();
  await complete();
  await call("/api/demo/pause");
  const recoveryRun = await create();
  await call("/api/demo/abandon-lease");
  await page.waitForTimeout(2000);
  await call("/api/demo/resume");
  await complete();
  await page
    .getByText("Job được thu hồi sau khi mất lease · Bắt đầu", { exact: true })
    .waitFor();
  // A due schedule is moved only in the dedicated fixture DB. Transport is fake.
  const settings = await (
    await page.request.get(base + "/api/settings")
  ).json();
  settings.newsletter.enabled = true;
  settings.newsletter.sendTime = "07:00";
  settings.newsletter.timezone = "Asia/Ho_Chi_Minh";
  settings.notifications.enabled = true;
  const saved = await page.request.put(base + "/api/settings", {
    data: settings,
  });
  if (!saved.ok()) throw new Error("Fixture schedule settings failed");
  const scheduled = await call("/api/demo/schedule-due");
  if (!scheduled.runId) throw new Error("No scheduled run");
  await page.goto(base + "/#/runs/" + scheduled.runId);
  await complete();
  const delivery = await call("/api/demo/deliver");
  const expectedPosts = scheduled.created ? 1 : 0;
  if (delivery.ntfyPosts !== expectedPosts)
    throw new Error("No fake scheduled notification");
  await call("/api/demo/deliver");
  if (
    (await (await page.request.get(base + "/api/demo/status")).json())
      .ntfyPosts !== expectedPosts
  )
    throw new Error("Duplicate auto notification");
  settings.newsletter.enabled = false;
  settings.notifications.enabled = false;
  await page.request.put(base + "/api/settings", { data: settings });
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile overflow");
  await page.screenshot({
    path: "docs/images/demo-mobile.png",
    fullPage: true,
  });
  const values = eventLatencies
    .map((row) => row.latencyMs)
    .sort((a, b) => a - b);
  if (values.some((value) => value < 0))
    throw new Error("Clock skew prevents latency measurement");
  const percentile = (p) => values[Math.ceil(values.length * p) - 1];
  const report = JSON.stringify(
    {
      label:
        "DEMO FIXTURE; timestamp generated before transaction commit to observed DOM insertion; same-machine wall clocks; not time-to-paint",
      measuredAt: new Date().toISOString(),
      runs: 3,
      samples: values.length,
      medianMs: percentile(0.5),
      p95Ms: percentile(0.95),
      ssePollMs: 500,
      raw: eventLatencies,
    },
    null,
    2,
  );
  const downloading = page.waitForEvent("download");
  await page.evaluate((report) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([report], { type: "application/json" }),
    );
    a.download = "ui-latency.json";
    a.click();
  }, report);
  await (await downloading).saveAs("output/step6/ui-latency.json");
}
