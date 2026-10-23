import { expect, test, type Page } from "@playwright/test";
import { addTask, reloadWhenSaved, signUp, taskRow } from "./helpers";

const offlineBanner = (page: Page) => page.getByText("You're offline.");
const syncingBanner = (page: Page) => page.getByText(/waiting to sync|Syncing/);

/** Resolves once the page's live-update channel has been accepted by the server. */
function realtimeJoined(page: Page): Promise<void> {
  return new Promise((resolve) => {
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        const text = String(payload);
        if (text.includes("phx_reply") && text.includes("postgres_changes")) resolve();
      });
    });
  });
}

/** The query cache the app keeps in IndexedDB so it can open without a connection. */
function storedCache(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open("keyval-store");
        open.onerror = () => resolve("");
        open.onsuccess = () => {
          const read = open.result.transaction("keyval").objectStore("keyval").get("todo-query-cache");
          read.onerror = () => resolve("");
          read.onsuccess = () => resolve(String(read.result ?? ""));
        };
      }),
  );
}

test("edits made offline are kept and saved when the connection returns", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Already saved");
  await expect(taskRow(page, "Already saved")).toBeVisible();

  await page.context().setOffline(true);
  await expect(offlineBanner(page)).toBeVisible();
  await addTask(page, "Written offline");
  await page.getByRole("checkbox", { name: "Complete: Already saved" }).click();
  await expect(taskRow(page, "Written offline")).toBeVisible();
  await expect(taskRow(page, "Already saved")).toHaveCount(0);
  await expect(page.getByText(/2 changes are waiting to sync/)).toBeVisible();

  await page.context().setOffline(false);
  await expect(offlineBanner(page)).toHaveCount(0);
  await expect(syncingBanner(page)).toHaveCount(0);

  // What the server has now, not just what this page remembers.
  await reloadWhenSaved(page);
  await expect(taskRow(page, "Written offline")).toBeVisible();
  await expect(taskRow(page, "Already saved")).toHaveCount(0);
});

test("a change made on another device appears without a reload", async ({ page, browser }) => {
  await signUp(page);
  const other = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(),
  });
  const second = await other.newPage();
  const joined = realtimeJoined(second);
  await second.goto("/inbox");
  await expect(second.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await joined;

  await addTask(page, "From the first device");
  await expect(taskRow(second, "From the first device")).toBeVisible();
  await other.close();
});

test("an offline edit tells you when the same item changed elsewhere meanwhile", async ({ page, browser }) => {
  await signUp(page);
  await addTask(page, "Edited twice");
  await expect(taskRow(page, "Edited twice")).toBeVisible();
  await reloadWhenSaved(page);

  const other = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(),
  });
  const second = await other.newPage();
  await second.goto("/inbox");
  await expect(taskRow(second, "Edited twice")).toBeVisible();

  await page.context().setOffline(true);
  await page.getByRole("checkbox", { name: "Complete: Edited twice" }).click();
  await expect(page.getByText(/1 change is waiting to sync/)).toBeVisible();

  // Meanwhile the other device changes the same task (a later time than the offline edit).
  await second.waitForTimeout(1100);
  await second.getByRole("checkbox", { name: "Complete: Edited twice" }).click();
  await expect(taskRow(second, "Edited twice")).toHaveCount(0);

  await page.context().setOffline(false);
  await expect(page.getByText(/was also edited on another device/)).toBeVisible();
  await other.close();
});

test.describe("installed app", () => {
  test.skip(
    process.env.E2E_SERVER !== "start",
    "needs the service worker, which only runs in a production build",
  );

  test("opens and works after a reload with no connection", async ({ page }) => {
    await signUp(page);
    await addTask(page, "Cached task");
    await expect(taskRow(page, "Cached task")).toBeVisible();

    // Wait until the pages are saved by the service worker and the lists by the app.
    await expect
      .poll(() => page.evaluate(async () => Boolean(await caches.match("/inbox"))), { message: "page not cached" })
      .toBe(true);
    await expect.poll(() => storedCache(page), { message: "lists not stored" }).toContain("Cached task");

    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
    await expect(taskRow(page, "Cached task")).toBeVisible();
    await expect(offlineBanner(page)).toBeVisible();

    await addTask(page, "Added in the dark");
    await page.context().setOffline(false);
    await expect(syncingBanner(page)).toHaveCount(0);

    await reloadWhenSaved(page);
    await expect(taskRow(page, "Added in the dark")).toBeVisible();
    await expect(taskRow(page, "Cached task")).toBeVisible();
  });

  test("can be installed", async ({ request, page }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    const body = (await manifest.json()) as { display: string; icons: { src: string; sizes: string }[] };
    expect(body.display).toBe("standalone");
    for (const icon of body.icons) {
      const response = await request.get(icon.src);
      expect(response.ok(), icon.src).toBe(true);
      expect(response.headers()["content-type"]).toContain("image/png");
    }
    expect((await request.get("/sw.js")).ok()).toBe(true);
    await page.goto("/login");
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  });
});
