import { expect, test, type Page } from "@playwright/test";
import { addTask, openTask, reloadWhenSaved, signUp } from "./helpers";

const daysFromNow = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const drawer = (page: Page) => page.getByRole("dialog", { name: "Task details" });

/** Resolves once the server has answered a reminder call. */
const reminderCall = (page: Page, name: "set_task_reminder" | "clear_task_reminder") =>
  page.waitForResponse((response) => response.url().includes(`/rpc/${name}`));

test("a reminder can be set once a task has a due date, kept, cleared, and refused when too late", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Call the bank");
  await openTask(page, "Call the bank");
  await expect(drawer(page).getByLabel("Reminder")).toHaveCount(0);

  await drawer(page).getByLabel("Due date").fill(daysFromNow(3));
  await expect(drawer(page).getByLabel("Reminder")).toHaveValue("");

  const set = reminderCall(page, "set_task_reminder");
  await drawer(page).getByLabel("Reminder").selectOption({ label: "1 day before" });
  expect((await set).ok()).toBe(true);

  await reloadWhenSaved(page);
  await expect(drawer(page).getByLabel("Reminder")).toHaveValue("1440");

  const cleared = reminderCall(page, "clear_task_reminder");
  await drawer(page).getByLabel("Reminder").selectOption({ label: "No reminder" });
  expect((await cleared).ok()).toBe(true);
  await reloadWhenSaved(page);
  await expect(drawer(page).getByLabel("Reminder")).toHaveValue("");

  // A due date in the past leaves no future time to remind at: the server says so and nothing is kept.
  await drawer(page).getByLabel("Due date").fill(daysFromNow(-1));
  await drawer(page).getByLabel("Reminder").selectOption({ label: "10 minutes before" });
  await expect(page.getByText(/already passed/)).toBeVisible();
  await expect(drawer(page).getByLabel("Reminder")).toHaveValue("");
});
