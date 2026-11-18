// Network-first PWA + Web Push Service Worker: never caches /api/* responses or private user data,
// handles native RFC 8291/8292 Web Push notifications, and provides a CSP-compliant Vietnamese offline screen.
const CACHE_NAME = "automationnews-shell-v4";
const OFFLINE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const OFFLINE_HTML = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Đang ngoại tuyến · Bản tin mỗi sáng</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px; background: #f3f7f6; color: #1e3731; font: 16px/1.65 system-ui, -apple-system, sans-serif; }
    main { max-width: 440px; padding: 32px; background: #ffffff; border: 1px solid #d6e4dd; border-radius: 18px; text-align: center; box-shadow: 0 12px 32px rgba(20,105,84,0.08); }
    h1 { margin: 0 0 10px; font-size: 22px; }
    p { margin: 0 0 22px; color: #4b635a; font-size: 15px; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 46px; padding: 10px 22px; border-radius: 10px; background: #146954; color: #fff; text-decoration: none; font-weight: 600; }
    @media (prefers-color-scheme: dark) {
      body { background: #12211c; color: #eaf4ee; }
      main { background: #192d26; border-color: #324d41; }
      p { color: #b0c9bc; }
      a { background: #9be0bc; color: #113020; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Thiết bị đang ngoại tuyến</h1>
    <p>Kiểm tra kết nối Wi-Fi hoặc 4G/5G để đồng bộ bản tin mới nhất. Các thông báo gần đây vẫn lưu sẵn trong trung tâm thông báo của trình duyệt.</p>
    <a href="">Thử kết nối lại</a>
  </main>
</body>
</html>`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 503,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
              "Content-Security-Policy": OFFLINE_CSP,
              "X-Content-Type-Options": "nosniff",
            },
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Bản tin mỗi sáng",
    body: "Ấn bản sáng mới của bạn đã sẵn sàng để đọc.",
    url: "/#/digests",
    tag: "morning-digest",
  };
  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        payload = {
          title:
            typeof parsed.title === "string" && parsed.title.trim()
              ? parsed.title.trim().slice(0, 120)
              : payload.title,
          body:
            typeof parsed.body === "string" && parsed.body.trim()
              ? parsed.body.trim().slice(0, 320)
              : payload.body,
          url:
            typeof parsed.url === "string" && parsed.url.startsWith("/")
              ? parsed.url
              : payload.url,
          tag:
            typeof parsed.tag === "string" && parsed.tag.trim()
              ? parsed.tag.trim().slice(0, 64)
              : payload.tag,
        };
      }
    } catch {
      const text = event.data.text();
      if (text) {
        payload.body = text.slice(0, 320);
      }
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/app-icon-192.png",
      badge: "/app-icon-192.png",
      tag: payload.tag,
      renotify: true,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/#/digests";
  const targetUrl = new URL(
    rawUrl.startsWith("/") ? rawUrl : "/#/digests",
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if (
            client.url.startsWith(self.location.origin) &&
            "focus" in client
          ) {
            if ("navigate" in client) {
              await client.navigate(targetUrl).catch(() => {});
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
