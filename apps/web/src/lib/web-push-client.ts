import type { WebPushDevice } from "@hub/contracts";
import { apiRequest } from "./api-client";

export type WebPushStatusResponse = {
  vapidPublicKey: string;
  devices: WebPushDevice[];
};

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isWebPushSupported()) return "unsupported";
  return Notification.permission;
}

export function urlBase64ToUint8Array(
  base64String: string,
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function describeBrowserLabel(): string {
  const ua = navigator.userAgent || "";
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Thiết bị";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /CocCoc|coc_coc_browser/i.test(ua)
      ? "Cốc Cốc"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "Trình duyệt";
  return `${browser} trên ${os}`;
}

async function ensureServiceWorkerReady(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!existing) {
    await navigator.serviceWorker.register("/sw.js");
  }
  return navigator.serviceWorker.ready;
}

export async function getCurrentBrowserEndpoint(): Promise<string | null> {
  if (!isWebPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    const sub = await reg.pushManager.getSubscription();
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}

export async function fetchWebPushStatus(): Promise<WebPushStatusResponse> {
  return apiRequest<WebPushStatusResponse>("/api/account/web-push", {
    timeoutMs: 12000,
  });
}

export async function subscribeThisBrowser(): Promise<{
  device: WebPushDevice;
  endpoint: string;
}> {
  if (!isWebPushSupported()) {
    throw new Error(
      "Trình duyệt hiện tại không hỗ trợ Web Push. Trên iPhone/iPad, hãy chọn Chia sẻ -> Thêm vào Màn hình chính trước.",
    );
  }
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    throw new Error(
      "Quyền thông báo đang bị tắt. Hãy bấm biểu tượng ổ khóa cạnh thanh địa chỉ trình duyệt và cho phép Thông báo (Notifications).",
    );
  }

  const { vapidPublicKey } = await fetchWebPushStatus();
  const reg = await ensureServiceWorkerReady();
  const appServerKey = urlBase64ToUint8Array(vapidPublicKey);

  let subscription = await reg.pushManager.getSubscription();
  if (subscription) {
    const existingKey = subscription.options?.applicationServerKey;
    if (existingKey) {
      const existingBytes = new Uint8Array(existingKey);
      const mismatch =
        existingBytes.length !== appServerKey.length ||
        existingBytes.some((byte, idx) => byte !== appServerKey[idx]);
      if (mismatch) {
        await subscription.unsubscribe().catch(() => {});
        subscription = null;
      }
    }
  }

  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });
  }

  const serialized = subscription.toJSON();
  const p256dh = serialized.keys?.p256dh ?? "";
  const auth = serialized.keys?.auth ?? "";
  if (!serialized.endpoint || !p256dh || !auth) {
    throw new Error("Trình duyệt không trả đủ khóa mã hóa Web Push.");
  }

  const res = await apiRequest<{ subscribed: boolean; device: WebPushDevice }>(
    "/api/account/web-push/subscribe",
    {
      method: "POST",
      body: {
        endpoint: serialized.endpoint,
        keys: { p256dh, auth },
        userAgent: describeBrowserLabel(),
      },
      timeoutMs: 15000,
    },
  );
  return { device: res.device, endpoint: serialized.endpoint };
}

export async function unsubscribeThisBrowser(): Promise<void> {
  if (!isWebPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await apiRequest("/api/account/web-push/unsubscribe", {
      method: "POST",
      body: { endpoint },
      timeoutMs: 10000,
    }).catch(() => {});
  }
}

export async function removeWebPushDevice(id: string): Promise<void> {
  await apiRequest(`/api/account/web-push/devices/${encodeURIComponent(id)}`, {
    method: "DELETE",
    timeoutMs: 10000,
  });
}

export async function sendTestWebPush(): Promise<{
  sent: number;
  failed: number;
  total: number;
}> {
  return apiRequest<{ sent: number; failed: number; total: number }>(
    "/api/account/web-push/test",
    {
      method: "POST",
      body: {},
      timeoutMs: 15000,
    },
  );
}
