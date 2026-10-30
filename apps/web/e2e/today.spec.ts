import { expect, test } from "@playwright/test";
import { addTask, signUp } from "./helpers";

test("Today shows next up, progress and the finished state", async ({ page }) => {
  await signUp(page);
  // Late-evening times keep both tasks ahead of "now" for any normal test run.
  await addTask(page, "Earlier one today at 11:58pm");
  await addTask(page, "Later one today at 11:59pm");

  await page.getByRole("link", { name: "Today" }).click();
  const nextUp = page.getByRole("region", { name: "Next up" });
  await expect(nextUp).toContainText("Earlier one");
  await expect(page.getByText("0 of 2 done")).toBeVisible();

  await nextUp.getByRole("checkbox", { name: "Complete next up: Earlier one" }).click();
  await expect(nextUp).toContainText("Later one");
  await expect(page.getByText("1 of 2 done")).toBeVisible();

  await nextUp.getByRole("checkbox", { name: "Complete next up: Later one" }).click();
  await expect(page.getByText("Nothing left today")).toBeVisible();
  await expect(nextUp).toHaveCount(0);

  // Undo brings the card back.
  // The screen updates before the save finishes, so wait for the second toast.
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toHaveCount(2);
  await undo.last().click();
  await expect(nextUp).toContainText("Later one");
  await expect(page.getByText("1 of 2 done")).toBeVisible();
});

test("Today shows neither card nor progress when nothing is due", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Today" }).click();
  await expect(page.getByText("Nothing is due today.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Next up" })).toHaveCount(0);
  await expect(page.getByRole("progressbar", { name: "Tasks done today" })).toHaveCount(0);
});
