import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { addTask, openTask, reloadWhenSaved, signUp } from "./helpers";

const drawer = (page: Page) => page.getByRole("dialog", { name: "Task details" });

test("a file can be attached to a task, downloaded unchanged and removed", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Sign contract");
  await openTask(page, "Sign contract");

  const content = "hello attachment";
  await drawer(page).getByLabel(/Add a file/).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await expect(drawer(page).getByRole("button", { name: "Download notes.txt" })).toBeVisible();
  await expect(drawer(page).getByText("16 B")).toBeVisible();

  await reloadWhenSaved(page);
  const downloading = page.waitForEvent("download");
  await drawer(page).getByRole("button", { name: "Download notes.txt" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("notes.txt");
  expect(await readFile(await download.path(), "utf8")).toBe(content);

  await drawer(page).getByRole("button", { name: "Remove notes.txt" }).click();
  await expect(drawer(page).getByRole("button", { name: "Download notes.txt" })).toHaveCount(0);
  await reloadWhenSaved(page);
  await expect(drawer(page).getByRole("button", { name: "Download notes.txt" })).toHaveCount(0);
});

test("an empty or oversized file is refused with the reason", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Archive");
  await openTask(page, "Archive");

  await drawer(page).getByLabel(/Add a file/).setInputFiles({
    name: "big.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.getByText("Files can be at most 10 MB.")).toBeVisible();

  await drawer(page).getByLabel(/Add a file/).setInputFiles({ name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) });
  await expect(page.getByText("That file is empty.")).toBeVisible();
  await expect(drawer(page).getByRole("button", { name: /^Download / })).toHaveCount(0);
});
