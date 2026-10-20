import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { addTask, signUp, taskRows } from "./helpers";

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings (import and export)" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

async function download(page: Page, buttonName: string): Promise<string> {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: buttonName }).click(),
  ]);
  return readFile(await file.path(), "utf8");
}

const chooseFile = (page: Page, name: string, mimeType: string, content: string) =>
  page.getByLabel("File to import").setInputFiles({ name, mimeType, buffer: Buffer.from(content, "utf8") });

test("export writes a JSON backup and a spreadsheet-safe CSV", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Pay rent every 1st at 9am p2");
  await addTask(page, "=SUM(A1)");
  await openSettings(page);

  const json = JSON.parse(await download(page, "Download JSON backup"));
  expect(json).toMatchObject({ format: "todo-export", version: 1 });
  const rent = json.tasks.find((t: { title: string }) => t.title === "Pay rent");
  expect(rent).toMatchObject({ priority: 2, rrule: "FREQ=MONTHLY;BYMONTHDAY=1", dueAllDay: false });
  expect(json.tasks.map((t: { title: string }) => t.title)).toContain("=SUM(A1)");

  const csv = await download(page, "Download CSV");
  expect(csv.charCodeAt(0)).toBe(0xfeff); // byte order mark so Excel reads UTF-8
  expect(csv).toContain("id,parent_id,title,notes,priority,due,all_day,repeat");
  expect(csv).toContain("'=SUM(A1)"); // a leading apostrophe stops it running as a formula
  expect(csv).toContain("Pay rent");
});

test("a JSON backup imports as new tasks, and the import can be undone", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Buy milk");
  await addTask(page, "Call mom");
  await openSettings(page);
  const backup = await download(page, "Download JSON backup");

  await chooseFile(page, "backup.json", "application/json", backup);
  await expect(page.getByText("This will add 2 tasks")).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported 2 tasks.")).toBeVisible();

  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(taskRows(page)).toHaveCount(4);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(taskRows(page)).toHaveCount(2);
});

test("a hand-written CSV creates the project, section and labels it names", async ({ page }) => {
  await signUp(page);
  await openSettings(page);

  const csv =
    "title,priority,due,project,section,labels,repeat\n" +
    "Buy gift,p1,2026-12-24,Errands,Shopping,home; xmas,\n" +
    "Pay rent,,2026-12-01 09:00,,,,FREQ=MONTHLY;BYMONTHDAY=1\n";
  await chooseFile(page, "tasks.csv", "text/csv", csv);
  await expect(page.getByText(/This will add 2 tasks, 1 new project, 1 new section, 2 new labels/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(/Imported 2 tasks, 1 project, 2 labels\./)).toBeVisible();

  await page.getByRole("navigation", { name: "Projects" }).getByRole("link", { name: "Errands" }).click();
  const gift = taskRows(page).filter({ hasText: "Buy gift" });
  await expect(gift).toBeVisible();
  await expect(gift).toContainText("P1");
  await expect(gift).toContainText("Dec 24");
  await expect(gift).toContainText("home");

  await page.getByRole("link", { name: "Inbox" }).click();
  const rent = taskRows(page).filter({ hasText: "Pay rent" });
  await expect(rent).toBeVisible();
  await expect(rent).toContainText("Monthly on day 1");
});

test("a file that cannot be read shows why and adds nothing", async ({ page }) => {
  await signUp(page);
  await openSettings(page);

  // Next's route announcer is also an alert, so look only inside the Import section.
  const problem = page.getByRole("region", { name: "Import" }).getByRole("alert");

  await chooseFile(page, "backup.json", "application/json", "{ this is not json");
  await expect(problem).toContainText("not valid JSON");

  await chooseFile(page, "other.csv", "text/csv", "name,notes\nx,y\n");
  await expect(problem).toContainText("title column");

  await chooseFile(page, "wrong.json", "application/json", JSON.stringify({ hello: "world" }));
  await expect(problem).toContainText("not a Todo export");

  await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
});

test("anything skipped or changed is listed before the import starts", async ({ page }) => {
  await signUp(page);
  await openSettings(page);

  await chooseFile(page, "messy.csv", "text/csv", "title,priority\n,1\nKeep me,urgent\n");
  await expect(page.getByText("2 things were skipped or changed")).toBeVisible();
  await page.getByText("2 things were skipped or changed").click();
  await expect(page.getByText(/Row 2: skipped, it has no title/)).toBeVisible();
  await expect(page.getByText(/priority "urgent" is not 1 to 4/)).toBeVisible();

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported 1 task.")).toBeVisible();
  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(taskRows(page)).toHaveCount(1);
  await expect(taskRows(page).first()).toContainText("Keep me");
});
