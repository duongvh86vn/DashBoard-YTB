import {
  expect,
  request,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
} from "@playwright/test";

interface PublicUser {
  id: string;
  email: string;
  role: "ADMIN" | "VIEWER";
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

interface UserEnvelope {
  user: PublicUser;
}

interface UsersPage {
  items: PublicUser[];
  page: number;
  pageSize: number;
  total: number;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the isolated Phase 1 E2E runner`);
  return value;
}

const baseUrl = requiredEnvironment("E2E_BASE_URL");
const adminEmail = requiredEnvironment("E2E_ADMIN_EMAIL");
const adminPassword = requiredEnvironment("E2E_ADMIN_PASSWORD");
const matrixViewerEmail = requiredEnvironment("E2E_MATRIX_VIEWER_EMAIL");
const matrixViewerUpdatedEmail = requiredEnvironment("E2E_MATRIX_VIEWER_UPDATED_EMAIL");
const matrixViewerPassword = requiredEnvironment("E2E_MATRIX_VIEWER_PASSWORD");
const matrixViewerResetPassword = requiredEnvironment("E2E_MATRIX_VIEWER_RESET_PASSWORD");
const logoutViewerEmail = requiredEnvironment("E2E_LOGOUT_VIEWER_EMAIL");
const logoutViewerPassword = requiredEnvironment("E2E_LOGOUT_VIEWER_PASSWORD");
const changeViewerEmail = requiredEnvironment("E2E_CHANGE_VIEWER_EMAIL");
const changeViewerPassword = requiredEnvironment("E2E_CHANGE_VIEWER_PASSWORD");
const changeViewerNewPassword = requiredEnvironment("E2E_CHANGE_VIEWER_NEW_PASSWORD");
const browserViewerEmail = requiredEnvironment("E2E_BROWSER_VIEWER_EMAIL");
const browserViewerPassword = requiredEnvironment("E2E_BROWSER_VIEWER_PASSWORD");
const rawSessionTokenMarker = requiredEnvironment("E2E_RAW_SESSION_TOKEN_MARKER");

if (!/^http:\/\/web:3000$/u.test(baseUrl)) {
  throw new Error("E2E_BASE_URL must be the isolated internal Web origin");
}
if (!/^[A-Za-z0-9_-]{43}$/u.test(rawSessionTokenMarker)) {
  throw new Error("E2E_RAW_SESSION_TOKEN_MARKER must be a 32-byte base64url credential");
}

const csrfHeaders = {
  Origin: baseUrl,
  "X-CSRF-Protection": "1",
};
const missingCsrfHeaders = { Origin: baseUrl };

const unauthenticatedBody = {
  error: { code: "AUTH_UNAUTHENTICATED", message: "Authentication required" },
};
const forbiddenBody = { error: { code: "AUTH_FORBIDDEN", message: "Forbidden" } };
const csrfBody = {
  error: { code: "AUTH_CSRF_INVALID", message: "Invalid CSRF request" },
};

async function expectJson(response: APIResponse): Promise<unknown> {
  expect(response.headers()["content-type"]).toMatch(/^application\/json(?:;|$)/iu);
  return response.json() as Promise<unknown>;
}

async function expectExactError(
  response: APIResponse,
  status: number,
  body: typeof unauthenticatedBody | typeof forbiddenBody | typeof csrfBody,
): Promise<void> {
  expect(response.status()).toBe(status);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await expectJson(response)).toEqual(body);
}

async function login(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<{ response: APIResponse; user: PublicUser }> {
  const response = await api.post("/api/v1/auth/login", {
    headers: csrfHeaders,
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const payload = (await expectJson(response)) as UserEnvelope;
  return { response, user: payload.user };
}

async function createViewer(
  admin: APIRequestContext,
  email: string,
  password: string,
): Promise<PublicUser> {
  const response = await admin.post("/api/v1/users", {
    headers: csrfHeaders,
    data: { email, password },
  });
  expect(response.status()).toBe(201);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const payload = (await expectJson(response)) as UserEnvelope;
  expect(payload.user).toMatchObject({ email, role: "VIEWER", isEnabled: true });
  return payload.user;
}

async function expectNoContent(response: APIResponse): Promise<void> {
  expect(response.status()).toBe(204);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.body()).toHaveLength(0);
}

function assertLocalSessionCookie(header: string | undefined): void {
  if (!header) throw new Error("LOCAL session cookie contract was missing");
  const segments = header.split(";").map((segment) => segment.trim());
  const cookiePair = segments[0] ?? "";
  const separator = cookiePair.indexOf("=");
  const cookieName = separator >= 0 ? cookiePair.slice(0, separator) : "";
  const cookieValue = separator >= 0 ? cookiePair.slice(separator + 1) : "";
  const attributes = new Set(segments.slice(1));
  const expectedAttributes = new Set(["Max-Age=86400", "Path=/", "HttpOnly", "SameSite=Lax"]);
  const validAttributes =
    attributes.size === expectedAttributes.size &&
    [...expectedAttributes].every((attribute) => attributes.has(attribute));
  if (
    cookieName !== "yhm_session" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(cookieValue) ||
    !validAttributes ||
    [...attributes].some((attribute) => /^(?:Secure|Domain=)/iu.test(attribute))
  ) {
    throw new Error("LOCAL session cookie attributes did not match the fixed safe contract");
  }
}

async function newApi(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: baseUrl });
}

async function loginPage(context: BrowserContext, email: string, password: string) {
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(`${baseUrl}/`);
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
  return page;
}

test.describe.serial("Phase 1 Auth + Users real-stack acceptance", () => {
  test("locks the complete API authorization, lifecycle, health, and secret boundaries", async () => {
    const anonymous = await newApi();
    const admin = await newApi();
    const contexts: APIRequestContext[] = [anonymous, admin];

    try {
      const missingWebHealth = await anonymous.get("/health");
      expect(missingWebHealth.status()).toBe(404);

      const anonymousTargetId = "00000000-0000-4000-8000-000000000001";
      const anonymousProtectedRequests = [
        () => anonymous.get("/api/v1/health"),
        () => anonymous.get("/api/v1/health/db"),
        () => anonymous.get("/api/v1/health/worker"),
        () => anonymous.get("/api/v1/health/collectors"),
        () => anonymous.get("/api/v1/health/ai"),
        () => anonymous.get("/api/v1/auth/me"),
        () => anonymous.post("/api/v1/auth/logout", { headers: csrfHeaders, data: {} }),
        () =>
          anonymous.post("/api/v1/auth/change-password", {
            headers: csrfHeaders,
            data: { currentPassword: matrixViewerPassword, newPassword: matrixViewerResetPassword },
          }),
        () => anonymous.get("/api/v1/users"),
        () =>
          anonymous.post("/api/v1/users", {
            headers: csrfHeaders,
            data: { email: "anonymous-denied@example.test", password: matrixViewerPassword },
          }),
        () =>
          anonymous.patch(`/api/v1/users/${anonymousTargetId}`, {
            headers: csrfHeaders,
            data: { email: "anonymous-patch-denied@example.test" },
          }),
        () =>
          anonymous.post(`/api/v1/users/${anonymousTargetId}/reset-password`, {
            headers: csrfHeaders,
            data: { password: matrixViewerResetPassword },
          }),
        () =>
          anonymous.post(`/api/v1/users/${anonymousTargetId}/revoke-sessions`, {
            headers: csrfHeaders,
            data: {},
          }),
        () =>
          anonymous.post(`/api/v1/users/${anonymousTargetId}/disable`, {
            headers: csrfHeaders,
            data: {},
          }),
        () =>
          anonymous.post(`/api/v1/users/${anonymousTargetId}/enable`, {
            headers: csrfHeaders,
            data: {},
          }),
        () =>
          anonymous.delete(`/api/v1/users/${anonymousTargetId}`, {
            headers: csrfHeaders,
            data: {},
          }),
      ];
      for (const protectedRequest of anonymousProtectedRequests) {
        await expectExactError(await protectedRequest(), 401, unauthenticatedBody);
      }

      await expectExactError(
        await anonymous.get("/api/v1/users", {
          headers: { Cookie: `yhm_session=${rawSessionTokenMarker}` },
        }),
        401,
        unauthenticatedBody,
      );

      await expectExactError(
        await anonymous.post("/api/v1/auth/login", {
          headers: { ...csrfHeaders, Origin: "https://hostile.example.test" },
          data: { email: adminEmail, password: adminPassword },
        }),
        403,
        csrfBody,
      );

      const adminLogin = await login(admin, adminEmail, adminPassword);
      expect(adminLogin.user).toMatchObject({ email: adminEmail, role: "ADMIN", isEnabled: true });
      assertLocalSessionCookie(adminLogin.response.headers()["set-cookie"]);

      const healthContracts = [
        ["/api/v1/health", "api", ["ai", "collectors", "database", "worker"]],
        ["/api/v1/health/db", "database", ["database"]],
        ["/api/v1/health/worker", "worker", ["worker"]],
        ["/api/v1/health/collectors", "collectors", ["collectors"]],
        ["/api/v1/health/ai", "ai", ["ai"]],
      ] as const;
      for (const [path, service, checkKeys] of healthContracts) {
        const response = await admin.get(path);
        expect(response.status()).toBe(200);
        expect(response.headers()["cache-control"]).toBe("no-store");
        const payload = (await expectJson(response)) as {
          service: string;
          checks: Record<string, unknown>;
        };
        expect(payload.service).toBe(service);
        expect(Object.keys(payload.checks).sort()).toEqual([...checkKeys].sort());
      }

      const matrixViewer = await createViewer(admin, matrixViewerEmail, matrixViewerPassword);
      const listResponse = await admin.get("/api/v1/users?page=1&pageSize=100");
      expect(listResponse.status()).toBe(200);
      const initialPage = (await expectJson(listResponse)) as UsersPage;
      expect(initialPage.items).toContainEqual(expect.objectContaining({ id: matrixViewer.id }));

      const updateResponse = await admin.patch(`/api/v1/users/${matrixViewer.id}`, {
        headers: csrfHeaders,
        data: { email: matrixViewerUpdatedEmail },
      });
      expect(updateResponse.status()).toBe(200);
      expect(((await expectJson(updateResponse)) as UserEnvelope).user.email).toBe(
        matrixViewerUpdatedEmail,
      );

      const viewer = await newApi();
      contexts.push(viewer);
      await login(viewer, matrixViewerUpdatedEmail, matrixViewerPassword);

      for (const healthPath of healthContracts.map(([path]) => path)) {
        await expectExactError(await viewer.get(healthPath), 403, forbiddenBody);
      }

      const viewerDeniedRequests = [
        () => viewer.get("/api/v1/users"),
        () =>
          viewer.post("/api/v1/users", {
            headers: csrfHeaders,
            data: { email: "denied@example.test", password: matrixViewerPassword },
          }),
        () =>
          viewer.patch(`/api/v1/users/${adminLogin.user.id}`, {
            headers: csrfHeaders,
            data: { email: "denied-admin@example.test" },
          }),
        () =>
          viewer.post(`/api/v1/users/${adminLogin.user.id}/reset-password`, {
            headers: csrfHeaders,
            data: { password: matrixViewerResetPassword },
          }),
        () =>
          viewer.post(`/api/v1/users/${adminLogin.user.id}/revoke-sessions`, {
            headers: csrfHeaders,
            data: {},
          }),
        () =>
          viewer.post(`/api/v1/users/${adminLogin.user.id}/disable`, {
            headers: csrfHeaders,
            data: {},
          }),
        () =>
          viewer.post(`/api/v1/users/${adminLogin.user.id}/enable`, {
            headers: csrfHeaders,
            data: {},
          }),
        () =>
          viewer.delete(`/api/v1/users/${adminLogin.user.id}`, {
            headers: csrfHeaders,
            data: {},
          }),
      ];
      for (const deniedRequest of viewerDeniedRequests) {
        await expectExactError(await deniedRequest(), 403, forbiddenBody);
      }

      const protectedAdminTargetRequests = [
        () =>
          admin.patch(`/api/v1/users/${adminLogin.user.id}`, {
            headers: csrfHeaders,
            data: { email: adminEmail },
          }),
        () =>
          admin.post(`/api/v1/users/${adminLogin.user.id}/reset-password`, {
            headers: csrfHeaders,
            data: { password: matrixViewerResetPassword },
          }),
        () =>
          admin.post(`/api/v1/users/${adminLogin.user.id}/revoke-sessions`, {
            headers: csrfHeaders,
            data: {},
          }),
        () =>
          admin.post(`/api/v1/users/${adminLogin.user.id}/disable`, {
            headers: csrfHeaders,
            data: {},
          }),
        () =>
          admin.post(`/api/v1/users/${adminLogin.user.id}/enable`, {
            headers: csrfHeaders,
            data: {},
          }),
        () =>
          admin.delete(`/api/v1/users/${adminLogin.user.id}`, {
            headers: csrfHeaders,
            data: {},
          }),
      ];
      for (const deniedRequest of protectedAdminTargetRequests) {
        await expectExactError(await deniedRequest(), 403, forbiddenBody);
      }

      const missingCsrfRequests = [
        () => admin.post("/api/v1/auth/logout", { headers: missingCsrfHeaders, data: {} }),
        () =>
          admin.post("/api/v1/auth/change-password", {
            headers: missingCsrfHeaders,
            data: { currentPassword: adminPassword, newPassword: matrixViewerResetPassword },
          }),
        () =>
          admin.post("/api/v1/users", {
            headers: missingCsrfHeaders,
            data: { email: "csrf-create-denied@example.test", password: matrixViewerPassword },
          }),
        () =>
          admin.patch(`/api/v1/users/${adminLogin.user.id}`, {
            headers: missingCsrfHeaders,
            data: { email: adminEmail },
          }),
        () =>
          admin.post(`/api/v1/users/${adminLogin.user.id}/reset-password`, {
            headers: missingCsrfHeaders,
            data: { password: matrixViewerResetPassword },
          }),
        () =>
          admin.post(`/api/v1/users/${adminLogin.user.id}/revoke-sessions`, {
            headers: missingCsrfHeaders,
            data: {},
          }),
        () =>
          admin.post(`/api/v1/users/${adminLogin.user.id}/disable`, {
            headers: missingCsrfHeaders,
            data: {},
          }),
        () =>
          admin.post(`/api/v1/users/${adminLogin.user.id}/enable`, {
            headers: missingCsrfHeaders,
            data: {},
          }),
        () =>
          admin.delete(`/api/v1/users/${adminLogin.user.id}`, {
            headers: missingCsrfHeaders,
            data: {},
          }),
      ];
      for (const missingCsrfRequest of missingCsrfRequests) {
        await expectExactError(await missingCsrfRequest(), 403, csrfBody);
      }
      await expectExactError(
        await admin.post("/api/v1/users", {
          headers: { ...csrfHeaders, Origin: "https://hostile.example.test" },
          data: { email: "hostile-origin-denied@example.test", password: matrixViewerPassword },
        }),
        403,
        csrfBody,
      );

      expect((await admin.get(`/api/v1/users/${adminLogin.user.id}`)).status()).toBe(404);
      expect(
        (
          await anonymous.post("/api/v1/auth/signup", {
            headers: csrfHeaders,
            data: { email: "signup@example.test", password: matrixViewerPassword },
          })
        ).status(),
      ).toBe(404);

      await expectNoContent(
        await admin.post(`/api/v1/users/${matrixViewer.id}/reset-password`, {
          headers: csrfHeaders,
          data: { password: matrixViewerResetPassword },
        }),
      );
      await expectExactError(await viewer.get("/api/v1/auth/me"), 401, unauthenticatedBody);

      const viewerAfterReset = await newApi();
      contexts.push(viewerAfterReset);
      await login(viewerAfterReset, matrixViewerUpdatedEmail, matrixViewerResetPassword);
      await expectNoContent(
        await admin.post(`/api/v1/users/${matrixViewer.id}/revoke-sessions`, {
          headers: csrfHeaders,
          data: {},
        }),
      );
      await expectExactError(
        await viewerAfterReset.get("/api/v1/auth/me"),
        401,
        unauthenticatedBody,
      );

      const viewerBeforeDisable = await newApi();
      contexts.push(viewerBeforeDisable);
      await login(viewerBeforeDisable, matrixViewerUpdatedEmail, matrixViewerResetPassword);
      await expectNoContent(
        await admin.post(`/api/v1/users/${matrixViewer.id}/disable`, {
          headers: csrfHeaders,
          data: {},
        }),
      );
      await expectExactError(
        await viewerBeforeDisable.get("/api/v1/auth/me"),
        401,
        unauthenticatedBody,
      );
      await expectNoContent(
        await admin.post(`/api/v1/users/${matrixViewer.id}/enable`, {
          headers: csrfHeaders,
          data: {},
        }),
      );

      const viewerBeforeDelete = await newApi();
      contexts.push(viewerBeforeDelete);
      await login(viewerBeforeDelete, matrixViewerUpdatedEmail, matrixViewerResetPassword);
      await expectNoContent(
        await admin.delete(`/api/v1/users/${matrixViewer.id}`, {
          headers: csrfHeaders,
          data: {},
        }),
      );
      await expectExactError(
        await viewerBeforeDelete.get("/api/v1/auth/me"),
        401,
        unauthenticatedBody,
      );

      const finalList = (await expectJson(
        await admin.get("/api/v1/users?page=1&pageSize=100"),
      )) as UsersPage;
      expect(finalList.items).toContainEqual(
        expect.objectContaining({ id: matrixViewer.id, isEnabled: false }),
      );

      await createViewer(admin, logoutViewerEmail, logoutViewerPassword);
      const logoutViewer = await newApi();
      contexts.push(logoutViewer);
      await login(logoutViewer, logoutViewerEmail, logoutViewerPassword);
      await expectNoContent(
        await logoutViewer.post("/api/v1/auth/logout", { headers: csrfHeaders, data: {} }),
      );
      await expectExactError(await logoutViewer.get("/api/v1/auth/me"), 401, unauthenticatedBody);

      await createViewer(admin, changeViewerEmail, changeViewerPassword);
      const changeViewerOne = await newApi();
      const changeViewerTwo = await newApi();
      contexts.push(changeViewerOne, changeViewerTwo);
      await login(changeViewerOne, changeViewerEmail, changeViewerPassword);
      await login(changeViewerTwo, changeViewerEmail, changeViewerPassword);
      await expectNoContent(
        await changeViewerOne.post("/api/v1/auth/change-password", {
          headers: csrfHeaders,
          data: {
            currentPassword: changeViewerPassword,
            newPassword: changeViewerNewPassword,
          },
        }),
      );
      await expectExactError(
        await changeViewerOne.get("/api/v1/auth/me"),
        401,
        unauthenticatedBody,
      );
      await expectExactError(
        await changeViewerTwo.get("/api/v1/auth/me"),
        401,
        unauthenticatedBody,
      );

      const changedViewer = await newApi();
      contexts.push(changedViewer);
      await login(changedViewer, changeViewerEmail, changeViewerNewPassword);
    } finally {
      await Promise.all(contexts.map(async (context) => context.dispose()));
    }
  });

  test("proves the Vietnamese browser flow is authenticated and VIEWER-only", async ({
    browser,
  }) => {
    const adminContext = await browser.newContext({ baseURL: baseUrl });
    const viewerContext = await browser.newContext({ baseURL: baseUrl });

    try {
      const adminPage = await loginPage(adminContext, adminEmail, adminPassword);
      await adminPage.getByRole("link", { name: "Người dùng" }).click();
      await expect(adminPage.getByRole("heading", { name: "Người dùng" })).toBeVisible();
      await adminPage.getByLabel("Email VIEWER mới").fill(browserViewerEmail);
      await adminPage.getByLabel("Mật khẩu VIEWER mới").fill(browserViewerPassword);
      await adminPage.getByRole("button", { name: "Tạo VIEWER" }).click();
      await expect(adminPage.getByText("Đã tạo tài khoản VIEWER.")).toBeVisible();
      await expect(adminPage.getByText(browserViewerEmail, { exact: true })).toBeVisible();

      const viewerPage = await loginPage(viewerContext, browserViewerEmail, browserViewerPassword);
      await expect(viewerPage.getByRole("link", { name: "Người dùng" })).toHaveCount(0);
      await expect(viewerPage.getByText("Dữ liệu giám sát thực")).toBeVisible();
      await expect(viewerPage.getByText(/chưa hiển thị số liệu kênh hoặc video/iu)).toBeVisible();
      await expect(viewerPage.getByRole("link", { name: /đăng ký/iu })).toHaveCount(0);
      await expect(viewerPage.getByRole("link", { name: /health/iu })).toHaveCount(0);
      for (const fabricatedMetric of [
        "Kênh đang theo dõi",
        "Lượt xem hôm nay",
        "Top 10 tuần",
        "Video đang tăng tốc",
      ]) {
        await expect(viewerPage.getByText(fabricatedMetric, { exact: true })).toHaveCount(0);
      }

      const usersApiRequests: string[] = [];
      viewerPage.on("request", (requestEvent) => {
        if (new URL(requestEvent.url()).pathname.startsWith("/api/v1/users")) {
          usersApiRequests.push(requestEvent.url());
        }
      });
      await viewerPage.goto("/users");
      await expect(viewerPage).toHaveURL(`${baseUrl}/`);
      expect(usersApiRequests).toEqual([]);

      await adminPage.getByRole("button", { name: `Vô hiệu hóa ${browserViewerEmail}` }).click();
      await adminPage.getByRole("button", { name: "Xác nhận vô hiệu hóa" }).click();
      await expect(adminPage.getByText("Đã vô hiệu hóa tài khoản VIEWER.")).toBeVisible();

      await viewerPage.reload();
      await expect(viewerPage).toHaveURL(`${baseUrl}/login`);
      await expect(viewerPage.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();

      const signupResponse = await viewerPage.goto("/signup");
      expect(signupResponse?.status()).toBe(404);
    } finally {
      await viewerContext.close();
      await adminContext.close();
    }
  });
});
