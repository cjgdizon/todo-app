import { expect, test, type Page } from "@playwright/test";
import { addTask, openTask, reloadWhenSaved, signUp } from "./helpers";

const drawer = (page: Page) => page.getByRole("dialog", { name: "Task details" });
const timerBar = (page: Page) => page.getByRole("region", { name: "Running timer" });

test("a timer starts from a task, shows on every page, survives a reload and stops", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Write report");
  await openTask(page, "Write report");

  await drawer(page).getByRole("button", { name: "Start timer" }).click();
  await expect(timerBar(page)).toContainText("Timing");
  await expect(timerBar(page)).toContainText("Write report");
  await expect(drawer(page).getByRole("button", { name: "Stop timer" })).toBeVisible();

  await reloadWhenSaved(page);
  await expect(timerBar(page)).toContainText("Timing");

  await timerBar(page).getByRole("button", { name: "Stop", exact: true }).click();
  await expect(timerBar(page)).toHaveCount(0);

  await page.getByRole("link", { name: "Stats" }).click();
  await expect(page.getByRole("heading", { name: "Stats", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Time tracked per day" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tasks completed per day" })).toBeVisible();
});

test("a focus session counts down and starting another task moves the timer", async ({ page }) => {
  await signUp(page);
  await addTask(page, "First task");
  await addTask(page, "Second task");

  await openTask(page, "First task");
  await drawer(page).getByRole("button", { name: "Focus 25 minutes" }).click();
  await expect(timerBar(page)).toContainText("Focus");
  await expect(timerBar(page)).toContainText("left");
  await page.keyboard.press("Escape");

  await openTask(page, "Second task");
  await expect(drawer(page).getByText(/stops the timer that is running on another task/)).toBeVisible();
  await drawer(page).getByRole("button", { name: "Start timer" }).click();
  await expect(timerBar(page)).toContainText("Timing");
  await expect(timerBar(page)).toContainText("Second task");
  await expect(timerBar(page)).not.toContainText("left");
});
