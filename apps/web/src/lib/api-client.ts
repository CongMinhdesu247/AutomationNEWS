import type { ApiError, Settings } from "@hub/contracts";
import { createRequestSignal } from "../request-signal";

export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
};

export type Account = {
  user: User;
  settings: Settings;
  days: number[];
  theme: "light" | "dark";
  revision: number;
  nextRunAt: string | null;
  lastCheckedAt: string | null;
};

export type AuthConfig = {
  enabled: boolean;
  registrationOpen: boolean;
};

export class HttpClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpClientError";
  }
}

export async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!text) return null;
  if (
    !contentType.includes("application/json") &&
    text.trimStart().startsWith("<")
  ) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
    notifyUnauthorized?: boolean;
  } = {},
): Promise<T> {
  const {
    body,
    method = body === undefined ? "GET" : "POST",
    headers = {},
    timeoutMs = 30000,
    signal,
    notifyUnauthorized = true,
  } = options;

  const { signal: combinedSignal, cleanup } = createRequestSignal(
    timeoutMs,
    signal,
  );
  let response: Response;
  let payload: (T & Partial<ApiError>) | null;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      signal: combinedSignal,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    payload = await parseJsonSafe<T & Partial<ApiError>>(response);
  } finally {
    cleanup();
  }

  if (!response.ok) {
    if (
      typeof window !== "undefined" &&
      response.status === 401 &&
      notifyUnauthorized &&
      !path.startsWith("/api/auth/") &&
      path !== "/api/member"
    ) {
      window.dispatchEvent(new CustomEvent("hub:unauthorized"));
    }
    const fallbackMessage =
      response.status === 502 ||
        response.status === 503 ||
        response.status === 504
        ? "Máy chủ đang bận hoặc tạm gián đoạn kết nối. Vui lòng thử lại sau ít giây."
        : response.status === 413
          ? "Dữ liệu gửi lên vượt quá giới hạn cho phép."
          : response.status === 429
            ? "Quá nhiều yêu cầu liên tiếp. Vui lòng đợi một lát rồi thử lại."
            : "Không thể xử lý yêu cầu lúc này.";
    throw new HttpClientError(
      response.status,
      payload?.error?.code ?? `HTTP_${response.status}`,
      payload?.error?.message ?? fallbackMessage,
    );
  }

  if (payload === null) {
    throw new HttpClientError(
      502,
      "INVALID_RESPONSE",
      "Máy chủ trả về phản hồi không đúng định dạng JSON.",
    );
  }

  return payload;
}

export function clearAccountSessionStorage() {
  try {
    sessionStorage.removeItem("hub-member-portal-token");
    for (const key of Object.keys(sessionStorage)) {
      if (
        key.startsWith("hub-create-key-") ||
        key.startsWith("hub-notification-key-")
      ) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage access errors in restricted modes.
  }
}

const THEME_STORAGE_KEY = "hub-preferred-theme";

export function readStoredTheme(): "light" | "dark" | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(theme: "light" | "dark"): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage access errors in restricted modes.
  }
}
