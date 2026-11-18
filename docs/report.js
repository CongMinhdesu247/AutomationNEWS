/* Standalone, dependency-free reader: no analytics, HTML injection or settings access. */
"use strict";
(async () => {
  const status = document.getElementById("status");
  try {
    let rawToken = location.hash.slice(1);
    const cachedKey = sessionStorage.getItem("hub-cloud-report-token");
    if (!rawToken && cachedKey) rawToken = cachedKey;
    const match = rawToken.match(/^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/);
    if (!match) {
      status.textContent =
        "Mở liên kết Xem chi tiết trong nội dung thông báo mới trên ntfy.";
      return;
    }
    if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    const isLocalDev =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const params = new URLSearchParams(location.search);
    const repoParam = isLocalDev ? params.get("repo") : null;
    let owner = "",
      repo = "";
    if (
      repoParam &&
      /^[\w-]+\/[\w.-]+$/.test(repoParam) &&
      !repoParam.includes("..")
    ) {
      [owner, repo] = repoParam.split("/");
    } else {
      owner = location.hostname.split(".")[0] || "";
      repo =
        location.pathname
          .split("/")
          .filter((part) => part && !part.endsWith(".html"))[0] || "";
    }
    if (
      !/^[\w-]+$/.test(owner) ||
      !repo ||
      !/^[\w.-]+$/.test(repo) ||
      repo === "." ||
      repo === ".."
    )
      throw Error();
    const response = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/hub-cloud-state/state.json?at=${Date.now()}`,
      { referrerPolicy: "no-referrer", signal: AbortSignal.timeout(20000) },
    );
    if (!response.ok) throw Error();
    const state = await response.json(),
      report = state.reports?.[match[1]];
    const reportAt = report ? Date.parse(report.at) : NaN;
    if (
      !report ||
      !Number.isFinite(reportAt) ||
      Date.now() - reportAt > 14 * 86400000
    )
      throw Error();
    const decode = (value) => {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    };
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
    // Remove secret decryption key from origin-shared sessionStorage immediately after decryption.
    sessionStorage.removeItem("hub-cloud-report-token");
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof data.text !== "string" ||
      data.text.length > 40000 ||
      !Number.isFinite(Date.parse(data.createdAt))
    )
      throw Error();
    const content = document.getElementById("content");
    let cursor = 0;
    for (const link of data.text.matchAll(
      /https:\/\/[^\s<>)"'\].,;!?]+(?:[.,;!?]+[^\s<>)"'\].,;!?]+)*/g,
    )) {
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
      new Date(d).toLocaleDateString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      });
    if (date(data.createdAt) !== date(Date.now())) {
      const warning = document.getElementById("warning");
      warning.hidden = false;
      warning.textContent =
        "Bạn đang xem bản tin của ngày trước. Giá và dự báo trong bản này không phải dữ liệu mới hôm nay.";
    }
  } catch {
    sessionStorage.removeItem("hub-cloud-report-token");
    status.textContent =
      "Chưa mở được bản tin. Có thể liên kết đã hết hạn, không đúng hoặc cloud chưa tải xong. Thử lại sau; nội dung ngắn vẫn còn trong ntfy.";
  }
})();
