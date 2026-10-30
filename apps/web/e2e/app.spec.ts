import { expect, test } from "@playwright/test";
import { addTask, createProject, openTask, quickAdd, reloadWhenSaved, signUp, taskRow, taskRows } from "./helpers";

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

  await reloadWhenSaved(page);
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
  // Wait for each save to reach the server before reloading, or the reload would cancel it.
  const saved = (text: string) =>
    page.waitForResponse(
      (response) => response.request().method() === "PATCH" && (response.request().postData() ?? "").includes(text),
    );

  const prioritySaved = saved('"priority":1');
  await drawer.getByLabel("Priority").selectOption("1");
  await prioritySaved;

  await drawer.getByLabel("Notes").fill("Include the Q3 numbers");
  const notesSaved = saved("Include the Q3 numbers");
  await drawer.getByLabel("Title").focus(); // leaving the notes field saves them
  await notesSaved;
  await expect(taskRow(page, "Draft report")).toContainText("P1");

  await reloadWhenSaved(page);
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

  // A slow machine can re-render the row after it is focused and drop the key; pressing again is
  // harmless once "Second" is already on top.
  await expect(async () => {
    await page.getByRole("button", { name: "Second", exact: true }).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(taskRows(page).first()).toContainText("Second", { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  await reloadWhenSaved(page);
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

test("a search can be saved as a filter, reopened, and deleted with undo", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Urgent thing p1");
  await addTask(page, "Calm thing");

  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("p1");
  await expect(taskRow(page, "Urgent thing")).toBeVisible();
  await expect(taskRow(page, "Calm thing")).toHaveCount(0);

  await page.getByRole("button", { name: "Save filter" }).click();
  const dialog = page.getByRole("dialog", { name: "Save filter" });
  await dialog.getByLabel("Filter name").fill("Urgent");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page).toHaveURL(/\/filter\//);
  await expect(page.getByRole("heading", { name: "Urgent", level: 1 })).toBeVisible();
  await expect(taskRow(page, "Urgent thing")).toBeVisible();
  await expect(taskRow(page, "Calm thing")).toHaveCount(0);
  const sidebarFilters = page.getByRole("navigation", { name: "Filters" });
  await expect(sidebarFilters.getByRole("link", { name: "Urgent" })).toBeVisible();

  await reloadWhenSaved(page);
  await expect(page.getByRole("heading", { name: "Urgent", level: 1 })).toBeVisible();
  await expect(taskRow(page, "Urgent thing")).toBeVisible();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
  await expect(sidebarFilters).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page).toHaveURL(/\/filter\//);
  await expect(page.getByRole("heading", { name: "Urgent", level: 1 })).toBeVisible();
});

test("selecting a range of tasks and changing their priority, with undo", async ({ page }) => {
  await signUp(page);
  for (const title of ["Alpha", "Beta", "Gamma"]) await addTask(page, title);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select: Alpha" }).click();
  // Shift-click selects everything from Alpha down to Gamma.
  await page.getByRole("checkbox", { name: "Select: Gamma" }).click({ modifiers: ["Shift"] });
  await expect(page.getByText("3 selected")).toBeVisible();

  await page.getByRole("combobox", { name: "Set priority" }).selectOption("1");
  await expect(page.getByText("Set 3 tasks to P1.")).toBeVisible();
  await expect(taskRows(page).filter({ hasText: "P1" })).toHaveCount(3);
  await expect(page.getByText("0 selected")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(taskRows(page).filter({ hasText: "P1" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Bulk actions" })).toHaveCount(0);
});

test("bulk move, complete and delete each work and can be undone", async ({ page }) => {
  await signUp(page);
  for (const title of ["Alpha", "Beta", "Gamma"]) await addTask(page, title);

  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByLabel("Project name").fill("Work");
  await page.getByLabel("Project name").press("Enter");
  await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(taskRows(page)).toHaveCount(3);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  const pick = (title: string) => page.getByRole("checkbox", { name: `Select: ${title}` }).click();

  // Move two tasks to the Work project.
  await pick("Alpha");
  await pick("Beta");
  await page.getByRole("combobox", { name: "Move to project" }).selectOption({ label: "Work" });
  await expect(page.getByText("Moved 2 tasks to Work.")).toBeVisible();
  await expect(taskRows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(taskRows(page)).toHaveCount(3);

  // Complete one.
  await pick("Gamma");
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.getByText("1 task completed.")).toBeVisible();
  await expect(taskRow(page, "Gamma")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(taskRow(page, "Gamma")).toBeVisible();

  // Delete everything, then bring it back.
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Deleted 3 tasks.")).toBeVisible();
  await expect(taskRows(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(taskRows(page)).toHaveCount(3);
});

/** Today's date as YYYY-MM-DD in this machine's zone, which is the zone the app uses in the browser. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

test("the calendar shows a task on its day, and dragging reschedules it", async ({ page }) => {
  await signUp(page);
  await addTask(page, "Dentist today at 3pm");
  await page.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();

  const todayCell = page.locator(`td[data-day="${localToday()}"]`);
  await expect(todayCell).toHaveAttribute("aria-current", "date");
  const chip = todayCell.getByRole("button", { name: /Dentist/ });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("15:00");

  // Drag it onto the next day (or the previous one on a Sunday).
  const next = todayCell.locator("xpath=following-sibling::td[1]");
  const target = (await next.count()) > 0 ? next : todayCell.locator("xpath=preceding-sibling::td[1]");
  const targetDay = await target.getAttribute("data-day");
  const from = await chip.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("The chip or the target day is not on screen");
  await page.mouse.move(from.x + 12, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  const moved = page.locator(`td[data-day="${targetDay}"]`).getByRole("button", { name: /Dentist/ });
  await expect(moved).toBeVisible();
  await expect(moved).toContainText("15:00"); // the time of day is kept
  await expect(todayCell.getByRole("button", { name: /Dentist/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(todayCell.getByRole("button", { name: /Dentist/ })).toBeVisible();

  await reloadWhenSaved(page);
  await expect(page.locator(`td[data-day="${localToday()}"]`).getByRole("button", { name: /Dentist/ })).toBeVisible();
});

test("the calendar moves between months and back to today", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Calendar" }).click();

  const title = (date: Date) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  await expect(page.getByRole("heading", { name: title(now), level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: title(nextMonth), level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByRole("heading", { name: title(now), level: 2 })).toBeVisible();
});

test("a project board has sections, and cards move between them", async ({ page }) => {
  await signUp(page);
  await createProject(page, "Plan");
  await addTask(page, "Write spec");
  await addTask(page, "Review spec");

  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page.getByRole("textbox", { name: "New section" }).fill("Doing");
  await page.getByRole("button", { name: "Add section" }).click();

  const none = page.getByRole("region", { name: "No section" });
  const doing = page.getByRole("region", { name: "Doing" });
  await expect(doing).toBeVisible();
  await expect(none.getByRole("button", { name: "Write spec", exact: true })).toBeVisible();
  await expect(none.getByRole("button", { name: "Review spec", exact: true })).toBeVisible();

  // Drag "Write spec" by its handle into the Doing column.
  const handle = page.getByRole("button", { name: "Move: Write spec" });
  const from = await handle.boundingBox();
  const to = await doing.getByRole("list").boundingBox();
  if (!from || !to) throw new Error("The card or the column is not on screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(doing.getByRole("button", { name: "Write spec", exact: true })).toBeVisible();
  await expect(none.getByRole("button", { name: "Write spec", exact: true })).toHaveCount(0);

  // The move is saved.
  await reloadWhenSaved(page);
  await expect(
    page.getByRole("region", { name: "Doing" }).getByRole("button", { name: "Write spec", exact: true }),
  ).toBeVisible();

  // The drawer's Section field moves a card without dragging.
  await openTask(page, "Review spec");
  await page.getByRole("dialog", { name: "Task details" }).getByLabel("Section").selectOption({ label: "Doing" });
  await expect(
    page.getByRole("region", { name: "Doing" }).getByRole("button", { name: "Review spec", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Rename, then delete with undo: the cards fall back to No section and return on undo.
  await page.getByRole("button", { name: "Rename section Doing" }).click();
  await page.getByRole("dialog", { name: "Rename section Doing" }).getByLabel("Section name").fill("In progress");
  await page.getByRole("dialog", { name: "Rename section Doing" }).getByRole("button", { name: "Save" }).click();
  const renamed = page.getByRole("region", { name: "In progress" });
  await expect(renamed).toBeVisible();

  await page.getByRole("button", { name: "Delete section In progress" }).click();
  await expect(page.getByRole("region", { name: "In progress" })).toHaveCount(0);
  const noSection = page.getByRole("region", { name: "No section" });
  await expect(noSection.getByRole("button", { name: "Write spec", exact: true })).toBeVisible();
  await expect(noSection.getByRole("button", { name: "Review spec", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  const restored = page.getByRole("region", { name: "In progress" });
  await expect(restored.getByRole("button", { name: "Write spec", exact: true })).toBeVisible();
  await expect(restored.getByRole("button", { name: "Review spec", exact: true })).toBeVisible();
});

test("moving a task to another project clears its board column", async ({ page }) => {
  await signUp(page);
  await createProject(page, "Alpha");
  await addTask(page, "Carry me");
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page.getByRole("textbox", { name: "New section" }).fill("Doing");
  await page.getByRole("button", { name: "Add section" }).click();
  await openTask(page, "Carry me");
  const drawer = page.getByRole("dialog", { name: "Task details" });
  await drawer.getByLabel("Section").selectOption({ label: "Doing" });
  await expect(
    page.getByRole("region", { name: "Doing" }).getByRole("button", { name: "Carry me", exact: true }),
  ).toBeVisible();

  // Changing project must not trip the database's section/project check.
  await drawer.getByLabel("Project").selectOption({ label: "Inbox" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Carry me", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(taskRow(page, "Carry me")).toBeVisible();
  await reloadWhenSaved(page);
  await expect(taskRow(page, "Carry me")).toBeVisible();
});

test("signing out protects the app", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/login/);
});
