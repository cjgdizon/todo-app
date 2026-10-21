import { expect, type Page, type Request } from "@playwright/test";
import { randomBytes } from "node:crypto";

/** Creates a fresh user through the real sign-up form and lands on the Inbox. */
export async function signUp(page: Page): Promise<void> {
  trackWrites(page);
  const email = `e2e-${Date.now()}-${randomBytes(3).toString("hex")}@example.test`;
  const password = randomBytes(12).toString("hex");

  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create your account" }).click();

  await expect(page).toHaveURL(/\/inbox/);
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
}

// Pages visited earlier stay mounted but hidden, so every locator below only matches what is on screen.

/** The quick-add box on the current page. */
export function quickAdd(page: Page) {
  return page.getByRole("textbox", { name: "Add a task" });
}

/** Types a task into the quick-add box and submits it. */
export async function addTask(page: Page, text: string): Promise<void> {
  await quickAdd(page).fill(text);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(quickAdd(page)).toHaveValue("");
}

// Writes that are still on their way to the server, per page. (`waitForLoadState("networkidle")`
// cannot be used for this: it resolves at once if the page already went idle after loading.)
const pendingWrites = new WeakMap<Page, Set<Request>>();

function trackWrites(page: Page): void {
  if (pendingWrites.has(page)) return;
  const pending = new Set<Request>();
  pendingWrites.set(page, pending);
  page.on("request", (request) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) pending.add(request);
  });
  const done = (request: Request) => pending.delete(request);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
}

/** Reloads once every write has reached the server; a reload mid-request would cancel it. */
export async function reloadWhenSaved(page: Page): Promise<void> {
  await expect.poll(() => pendingWrites.get(page)?.size ?? 0, { message: "saves are still pending" }).toBe(0);
  await page.reload();
}

/** Creates a project from the sidebar and lands on its page. */
export async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Project name").press("Enter");
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

/** Every visible task row, in display order. */
export function taskRows(page: Page) {
  return page.locator("[data-task-id]:visible");
}

/** The visible row for a task, found by its title. */
export function taskRow(page: Page, title: string) {
  return taskRows(page).filter({ hasText: title });
}

/** Opens a task's detail drawer by clicking its title (not its reorder or delete button). */
export async function openTask(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
}
