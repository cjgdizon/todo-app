import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addTask, createProject, openTask, signUp, taskRows } from "./helpers";

/** WCAG 2.0 to 2.2 level A and AA rules. The same engine Lighthouse's accessibility audit uses. */
async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("sign-in page has no accessibility violations", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("the offline notice has no accessibility violations", async ({ page }) => {
      await signUp(page);
      await addTask(page, "Kept for later");
      await page.context().setOffline(true);
      await addTask(page, "Written offline");
      await expect(page.getByText(/waiting to sync/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.context().setOffline(false);
    });

    test("the settings page, with an import preview open, has no accessibility violations", async ({ page }) => {
      await signUp(page);
      await page.getByRole("link", { name: "Settings (import and export)" }).click();
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
      expect(await violations(page), "settings").toEqual([]);

      await page.getByLabel("File to import").setInputFiles({
        name: "tasks.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("title,priority\n,1\nKeep me,urgent\n", "utf8"),
      });
      await page.getByText("2 things were skipped or changed").click();
      await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
      expect(await violations(page), "import preview with warnings").toEqual([]);
    });

    test("the members and join pages have no accessibility violations", async ({ page }) => {
      await signUp(page);
      await page.getByRole("link", { name: "Members and invites" }).click();
      await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
      await page.getByRole("button", { name: "Create invite link" }).click();
      await expect(page.getByLabel("Invite link (shown once)")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Revoke the member invite/ })).toBeVisible();
      expect(await violations(page), "members with an open invite").toEqual([]);

      const link = new URL(await page.getByLabel("Invite link (shown once)").inputValue());
      await page.goto(link.pathname + link.search);
      await expect(page.getByRole("heading", { name: "Join a workspace", level: 1 })).toBeVisible();
      expect(await violations(page), "join page").toEqual([]);
    });

    test("the project board has no accessibility violations", async ({ page }) => {
      await signUp(page);
      await createProject(page, "Plan");
      await addTask(page, "Write spec");
      await page.getByRole("link", { name: "Board", exact: true }).click();
      await page.getByRole("textbox", { name: "New section" }).fill("Doing");
      await page.getByRole("button", { name: "Add section" }).click();
      await expect(page.getByRole("region", { name: "Doing" })).toBeVisible();
      expect(await violations(page), "project board").toEqual([]);
    });

    test("app screens have no accessibility violations", async ({ page }) => {
      await signUp(page);
      await addTask(page, "Pay rent every 1st at 9am p2 @bills");
      await addTask(page, "Plain task");
      await expect(taskRows(page)).toHaveCount(2);
      expect(await violations(page), "inbox with tasks").toEqual([]);

      await page.getByRole("button", { name: "Select", exact: true }).click();
      await page.getByRole("checkbox", { name: "Select: Plain task" }).click();
      await expect(page.getByRole("toolbar", { name: "Bulk actions" })).toBeVisible();
      expect(await violations(page), "selection mode with the bulk toolbar").toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("toolbar", { name: "Bulk actions" })).toHaveCount(0);

      await openTask(page, "Plain task");
      expect(await violations(page), "task drawer").toEqual([]);

      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "Calendar" }).click();
      await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
      expect(await violations(page), "calendar").toEqual([]);

      await page.keyboard.press("Control+K");
      await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
      expect(await violations(page), "command palette").toEqual([]);
    });
  });
}
