import {
  ApiErrorEnvelopeSchema,
  ChannelResponseSchema,
  ChannelHealthCheckQueuedSchema,
  ChannelHealthHistorySchema,
  ChannelsPageSchema,
  CSRF_HEADER_NAME,
  type AuthErrorCode,
  type ChannelsPage,
  type ChannelHealthHistory,
  type PublicUser,
  UserResponseSchema,
  type UsersPage,
  UsersPageSchema,
  type VideoSnapshotsPage,
  VideoSnapshotsPageSchema,
  type PublicVideo,
  VideosPageSchema,
} from "@yt-monitor/shared/browser-auth";

type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface ResponseSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

interface RequestOptions<T> {
  method: ApiMethod;
  schema?: ResponseSchema<T>;
  body?: unknown;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: AuthErrorCode | null,
  ) {
    super("API request failed");
    this.name = "ApiError";
  }
}

export function isUnauthenticatedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401 && error.code === "AUTH_UNAUTHENTICATED";
}

export type ApiMessageContext = "login" | "change-password" | "users" | "channels" | "generic";

export function getVietnameseApiMessage(
  error: unknown,
  context: ApiMessageContext = "generic",
): string {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
    return "Dịch vụ đang tạm thời không khả dụng. Vui lòng thử lại.";
  }

  switch (error.code) {
    case "VALIDATION_ERROR":
      return "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.";
    case "AUTH_UNAUTHENTICATED":
      return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    case "AUTH_INVALID_CREDENTIALS":
      return context === "change-password"
        ? "Mật khẩu hiện tại không đúng."
        : "Email hoặc mật khẩu không đúng.";
    case "AUTH_FORBIDDEN":
      return "Bạn không có quyền thực hiện thao tác này.";
    case "AUTH_CSRF_INVALID":
      return "Yêu cầu bảo mật không hợp lệ. Hãy tải lại trang.";
    case "AUTH_RATE_LIMITED":
      return "Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại.";
    case "USER_NOT_FOUND":
      return "Không tìm thấy người dùng.";
    case "USER_ALREADY_EXISTS":
      return "Email này đã được sử dụng.";
    case "CHANNEL_INPUT_INVALID":
      return context === "channels"
        ? "Địa chỉ kênh YouTube không hợp lệ."
        : "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.";
    case "CHANNEL_NOT_FOUND":
      return "Không tìm thấy kênh YouTube.";
    case "CHANNEL_ALREADY_EXISTS":
      return "Kênh này đã có trong danh sách theo dõi.";
    case "CHANNEL_RESOLVE_FAILED":
      return "Không thể xác minh kênh công khai lúc này. Vui lòng thử lại sau.";
    case null:
      return "Dịch vụ đang tạm thời không khả dụng. Vui lòng thử lại.";
  }
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type");
  return contentType !== null && /^application\/json(?:\s*;|$)/iu.test(contentType);
}

async function requestApi<T>(path: string, options: RequestOptions<T>): Promise<T> {
  if (!/^\/api\/v1(?:\/|$)/u.test(path)) {
    throw new ApiError(0, null);
  }

  const init: RequestInit = {
    method: options.method,
    credentials: "same-origin",
    cache: "no-store",
  };
  if (options.signal) init.signal = options.signal;

  if (options.method !== "GET") {
    init.headers = {
      "Content-Type": "application/json",
      [CSRF_HEADER_NAME]: "1",
    };
    init.body = JSON.stringify(options.body ?? {});
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, null);
  }

  if (response.status === 204) {
    if (options.schema) throw new ApiError(response.status, null);
    return undefined as T;
  }
  if (!isJsonResponse(response)) throw new ApiError(response.status, null);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, null);
  }

  if (!response.ok) {
    const parsed = ApiErrorEnvelopeSchema.safeParse(payload);
    throw new ApiError(response.status, parsed.success ? parsed.data.error.code : null);
  }

  const parsed = options.schema?.safeParse(payload);
  if (!parsed?.success) throw new ApiError(response.status, null);
  return parsed.data;
}

export async function getCurrentUser(signal?: AbortSignal): Promise<PublicUser> {
  const response = await requestApi("/api/v1/auth/me", {
    method: "GET",
    schema: UserResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return response.user;
}

export async function login(email: string, password: string): Promise<PublicUser> {
  const response = await requestApi("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
    schema: UserResponseSchema,
  });
  return response.user;
}

export async function logout(): Promise<void> {
  await requestApi<void>("/api/v1/auth/logout", { method: "POST", body: {} });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await requestApi<void>("/api/v1/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

export async function listViewers(input: {
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}): Promise<UsersPage> {
  const query = new URLSearchParams({
    page: String(input.page),
    pageSize: String(input.pageSize),
  });
  return requestApi(`/api/v1/users?${query.toString()}`, {
    method: "GET",
    schema: UsersPageSchema,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

export async function createViewer(input: {
  email: string;
  password: string;
}): Promise<PublicUser> {
  const response = await requestApi("/api/v1/users", {
    method: "POST",
    body: input,
    schema: UserResponseSchema,
  });
  return response.user;
}

export async function updateViewerEmail(id: string, email: string): Promise<PublicUser> {
  const response = await requestApi(`/api/v1/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { email },
    schema: UserResponseSchema,
  });
  return response.user;
}

export async function resetViewerPassword(id: string, password: string): Promise<void> {
  await requestApi<void>(`/api/v1/users/${encodeURIComponent(id)}/reset-password`, {
    method: "POST",
    body: { password },
  });
}

export async function revokeViewerSessions(id: string): Promise<void> {
  await requestApi<void>(`/api/v1/users/${encodeURIComponent(id)}/revoke-sessions`, {
    method: "POST",
    body: {},
  });
}

export async function disableViewer(id: string): Promise<void> {
  await requestApi<void>(`/api/v1/users/${encodeURIComponent(id)}/disable`, {
    method: "POST",
    body: {},
  });
}

export async function enableViewer(id: string): Promise<void> {
  await requestApi<void>(`/api/v1/users/${encodeURIComponent(id)}/enable`, {
    method: "POST",
    body: {},
  });
}

export async function deleteViewer(id: string): Promise<void> {
  await requestApi<void>(`/api/v1/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: {},
  });
}

export async function listChannels(input: {
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}): Promise<ChannelsPage> {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  return requestApi(`/api/v1/channels?${query.toString()}`, {
    method: "GET",
    schema: ChannelsPageSchema,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

export async function createChannel(channelUrl: string) {
  const response = await requestApi("/api/v1/channels", {
    method: "POST",
    body: { channelUrl },
    schema: ChannelResponseSchema,
  });
  return response.channel;
}

export async function archiveChannel(id: string): Promise<void> {
  await requestApi<void>(`/api/v1/channels/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: {},
  });
}

export async function requestChannelHealthCheck(
  id: string,
): Promise<{ syncRunId: string; status: "QUEUED" }> {
  return requestApi(`/api/v1/channels/${encodeURIComponent(id)}/health-check`, {
    method: "POST",
    body: {},
    schema: ChannelHealthCheckQueuedSchema,
  });
}

export async function getChannelHealthHistory(input: {
  id: string;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}): Promise<ChannelHealthHistory> {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  return requestApi(
    `/api/v1/channels/${encodeURIComponent(input.id)}/health-history?${query.toString()}`,
    {
      method: "GET",
      schema: ChannelHealthHistorySchema,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
}

export async function listChannelVideos(input: {
  channelId: string;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}): Promise<{ items: PublicVideo[]; page: number; pageSize: number; total: number }> {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  return requestApi(
    `/api/v1/channels/${encodeURIComponent(input.channelId)}/videos?${query.toString()}`,
    {
      method: "GET",
      schema: VideosPageSchema,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
}

export async function getVideoSnapshots(input: {
  channelId: string;
  videoId: string;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}): Promise<VideoSnapshotsPage> {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  return requestApi(
    `/api/v1/channels/${encodeURIComponent(input.channelId)}/videos/${encodeURIComponent(input.videoId)}/snapshots?${query.toString()}`,
    {
      method: "GET",
      schema: VideoSnapshotsPageSchema,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
}
