import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addTask, openTask, signUp, taskRows } from "./helpers";

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
      await page.keyboard.press("Control+K");
      await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
      expect(await violations(page), "command palette").toEqual([]);
    });
  });
}
