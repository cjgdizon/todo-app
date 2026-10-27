import { expect, test, type Page } from "@playwright/test";
import { sharedWorkspace, signUp } from "./helpers";

// The deletion itself (real sign-ups, Storage, the Edge Function) is covered by
// scripts/account-check. Here: the screens, with the server's answer decided by the test.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

async function answerDelete(page: Page, status: number, body: object) {
  await page.route("**/functions/v1/delete-account", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
}

const openSettings = (page: Page) => page.getByRole("link", { name: "Settings (import and export)" }).click();
const section = (page: Page) => page.getByRole("region", { name: "Delete account" });

test("deleting the account needs the exact words, then signs the person out", async ({ page }) => {
  await answerDelete(page, 200, { deleted: true });
  await signUp(page);
  await openSettings(page);

  const button = section(page).getByRole("button", { name: "Delete my account" });
  const field = section(page).getByLabel(/Type/);
  await expect(section(page)).toContainText("cannot be undone");
  await expect(button).toBeDisabled();
  await field.fill("delete my acount");
  await expect(button).toBeDisabled();
  await field.fill("delete my account");
  await expect(button).toBeEnabled();

  await button.click();
  await expect(page).toHaveURL(/\/login/);
});

test("when the server refuses, the person is told why and stays signed in", async ({ page }) => {
  await answerDelete(page, 409, { error: "Hand over the workspaces you share with others before deleting your account." });
  await signUp(page);
  await openSettings(page);
  await section(page).getByLabel(/Type/).fill("delete my account");
  await section(page).getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByText(/Hand over the workspaces you share/)).toBeVisible();
  await expect(page).toHaveURL(/\/settings/);
});

test("an owner of a shared workspace must hand it over before the delete form appears", async ({ browser }) => {
  const { owner, guest, close } = await sharedWorkspace(browser);
  try {
    await openSettings(owner);
    await expect(section(owner)).toContainText("You own workspaces that other people use");
    await expect(section(owner).getByRole("button", { name: "Delete my account" })).toHaveCount(0);

    await section(owner).getByRole("button", { name: "Open its members" }).click();
    await expect(owner).toHaveURL(/\/members/);
    owner.once("dialog", (dialog) => void dialog.accept());
    await owner.getByRole("button", { name: /^Make .* the owner$/ }).click();
    await expect(owner.getByText(/is now the owner/)).toBeVisible();

    await openSettings(owner);
    await expect(section(owner).getByRole("button", { name: "Delete my account" })).toBeVisible();
    await expect(section(owner)).not.toContainText("You own workspaces that other people use");

    // The guest is now the owner of the workspace they joined.
    await guest.getByRole("link", { name: "Members and invites" }).click();
    await expect(guest.getByRole("heading", { name: "Invite people" })).toBeVisible();
  } finally {
    await close();
  }
});
