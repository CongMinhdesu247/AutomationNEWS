/* Standalone, dependency-free reader: no analytics, HTML injection or settings access. */
"use strict";
(async () => {
  const status = document.getElementById("status");
  try {
    const match = location.hash
      .slice(1)
      .match(/^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/);
    if (!match) {
      status.textContent =
        "Mở trang này bằng cách chạm vào thông báo mới trong ntfy.";
      return;
    }
    const owner = location.hostname.split(".")[0],
      repo = location.pathname.split("/").filter(Boolean)[0];
    if (!/^[\w-]+$/.test(owner) || !repo || !/^[\w.-]+$/.test(repo))
      throw Error();
    const response = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/hub-cloud-state/state.json?at=${Date.now()}`,
      { referrerPolicy: "no-referrer", signal: AbortSignal.timeout(20000) },
    );
    if (!response.ok) throw Error();
    const state = await response.json(),
      report = state.reports?.[match[1]];
    if (!report || Date.now() - Date.parse(report.at) > 14 * 86400000)
      throw Error();
    const decode = (value) =>
      Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      );
    const key = await crypto.subtle.importKey(
      "raw",
      decode(match[2]),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const bytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(report.iv) },
      key,
      decode(report.ciphertext),
    );
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof data.text !== "string" ||
      data.text.length > 40000 ||
      !Number.isFinite(Date.parse(data.createdAt))
    )
      throw Error();
    const content = document.getElementById("content");
    let cursor = 0;
    for (const link of data.text.matchAll(/https:\/\/[^\s]+/g)) {
      content.append(
        document.createTextNode(data.text.slice(cursor, link.index)),
      );
      const anchor = document.createElement("a");
      anchor.href = link[0];
      anchor.textContent = link[0];
      anchor.target = "_blank";
      anchor.rel = "noreferrer noopener";
      content.append(anchor);
      cursor = link.index + link[0].length;
    }
    content.append(document.createTextNode(data.text.slice(cursor)));
    status.textContent =
      "Tạo lúc " +
      new Date(data.createdAt).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      });
    const date = (d) =>
      new Date(d).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    if (date(data.createdAt) !== date(Date.now())) {
      const warning = document.getElementById("warning");
      warning.hidden = false;
      warning.textContent =
        "Bạn đang xem bản tin của ngày trước. Giá và dự báo trong bản này không phải dữ liệu mới hôm nay.";
    }
  } catch {
    status.textContent =
      "Chưa mở được bản tin. Có thể liên kết đã hết hạn, không đúng hoặc cloud chưa tải xong. Thử lại sau; nội dung ngắn vẫn còn trong ntfy.";
  }
})();
