import { expect, test } from "@playwright/test";
import { addTask, openTask, quickAdd, signUp, taskRow, taskRows } from "./helpers";

test("sign up, add a task, complete it and undo", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Buy milk");
  await expect(taskRow(page, "Buy milk")).toBeVisible();

  await page.getByRole("checkbox", { name: "Complete: Buy milk" }).click();
  await expect(page.getByText("Task completed.")).toBeVisible();
  // The row fades out, then leaves the list.
  await expect(taskRow(page, "Buy milk")).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(taskRow(page, "Buy milk")).toBeVisible();
});

test("tasks survive a reload", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Water the plants");
  await expect(taskRow(page, "Water the plants")).toBeVisible();

  await page.reload();
  await expect(taskRow(page, "Water the plants")).toBeVisible();
});

test("quick add reads the date, repeat, priority, project and label", async ({ page }) => {
  await signUp(page);

  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByLabel("Project name").fill("Home");
  await page.getByLabel("Project name").press("Enter");
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();

  await quickAdd(page).fill("Pay rent every 1st at 9am p2 @bills");
  // A live preview shows what was understood before anything is saved.
  const preview = page.locator("[data-quick-add-preview]:visible");
  await expect(preview).toContainText("Monthly on day 1");
  await expect(preview).toContainText("P2");
  await expect(preview).toContainText("bills");
  await page.getByRole("button", { name: "Add task", exact: true }).click();

  const row = taskRow(page, "Pay rent");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Monthly on day 1");
  await expect(row).toContainText("P2");
  await expect(row).toContainText("bills");
});

test("Today and Upcoming list tasks by date", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Call mom tomorrow");
  await addTask(page, "Stretch today");

  await page.getByRole("link", { name: "Today" }).click();
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(taskRow(page, "Stretch")).toBeVisible();
  await expect(taskRow(page, "Call mom")).toHaveCount(0);

  await page.getByRole("link", { name: "Upcoming" }).click();
  await expect(page.getByRole("heading", { name: "Tomorrow" })).toBeVisible();
  await expect(taskRow(page, "Call mom")).toBeVisible();
});

test("edits in the task drawer are saved", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Draft report");
  await openTask(page, "Draft report");

  const drawer = page.getByRole("dialog", { name: "Task details" });
  await drawer.getByLabel("Priority").selectOption("1");
  await drawer.getByLabel("Notes").fill("Include the Q3 numbers");
  await drawer.getByLabel("Title").focus(); // leaving the notes field saves them
  await expect(taskRow(page, "Draft report")).toContainText("P1");

  await page.reload();
  const reopened = page.getByRole("dialog", { name: "Task details" });
  await expect(reopened.getByLabel("Priority")).toHaveValue("1");
  await expect(reopened.getByLabel("Notes")).toHaveValue("Include the Q3 numbers");
});

test("subtasks nest under their parent", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Plan trip");
  await openTask(page, "Plan trip");

  const drawer = page.getByRole("dialog", { name: "Task details" });
  await drawer.getByLabel("Add a subtask").fill("Book flights");
  await drawer.getByRole("button", { name: "Add", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Book flights" })).toBeVisible();

  // The subtask is listed inside its parent's row.
  const parent = taskRows(page).filter({ hasText: "Plan trip" }).first();
  await expect(parent.locator("[data-task-id]").filter({ hasText: "Book flights" })).toBeVisible();
});

test("Alt+Arrow reorders tasks from the keyboard", async ({ page }) => {
  await signUp(page);
  await addTask(page, "First");
  await addTask(page, "Second");
  await expect(taskRows(page).first()).toContainText("First");

  await page.getByRole("button", { name: "Second", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(taskRows(page).first()).toContainText("Second");

  await page.reload();
  await expect(taskRows(page).first()).toContainText("Second");
});

test("the command palette navigates", async ({ page }) => {
  await signUp(page);
  await page.keyboard.press("Control+K");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill("today");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/today/);
  await expect(palette).toBeHidden();
});

test("signing out protects the app", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/login/);
});
