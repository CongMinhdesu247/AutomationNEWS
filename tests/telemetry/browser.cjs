async (page) => {
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/runs/"))
      requests.push({ url: request.url(), headers: request.headers() });
  });
  await page.goto("http://127.0.0.1:8098/");
  await page
    .getByRole("button", { name: "Tạo bản tin ngay", exact: true })
    .waitFor();
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
  const runUrl = page.url();
  await page.context().setOffline(true);
  await page.request.post("http://127.0.0.1:3002/__fixture/start");
  await page
    .getByRole("status")
    .filter({ hasText: "Đang kết nối lại" })
    .waitFor({ timeout: 15000 });
  await page.waitForTimeout(6000);
  await page.context().setOffline(false);
  await page
    .getByRole("status")
    .filter({ hasText: "Đã đồng bộ sự kiện mới nhất" })
    .waitFor({ timeout: 20000 });
  await page
    .getByRole("link", { name: "Mở bản tin đã lưu", exact: true })
    .waitFor();
  const timeline = page.locator(".timeline-scroll li");
  const ids = await timeline.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-event-id")),
  );
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate timeline event");
  await page
    .getByText("Đã lên lịch thử lại node · Lấy thời tiết", { exact: true })
    .waitFor();
  await page
    .getByText("Job được thu hồi sau khi mất lease · Bắt đầu", { exact: true })
    .waitFor();
  const snapshotRequests = requests.filter(
    (request) => !request.url.includes("/events"),
  );
  if (snapshotRequests.length !== 1)
    throw new Error(
      "Unexpected periodic REST snapshots: " + snapshotRequests.length,
    );
  const count = requests.length;
  await page.waitForTimeout(2200);
  if (requests.length !== count)
    throw new Error("Connections continued after terminal sync");
  await page.reload();
  await page
    .getByRole("status")
    .filter({ hasText: "Đã đồng bộ sự kiện mới nhất" })
    .waitFor();
  if (page.url() !== runUrl) throw new Error("Reload lost run URL");
  const reloadIds = await timeline.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-event-id")),
  );
  if (JSON.stringify(reloadIds) !== JSON.stringify(ids))
    throw new Error("Reload lost stored history");
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile overflow");
  await page.screenshot({ path: "output/step5/mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: "output/step5/desktop.png", fullPage: true });
  console.log(
    "PASS: Nginx SSE, offline/reconnect, retry/recovery/terminal timeline, no duplicate events, no REST polling, reload and responsive layout.",
  );
}
