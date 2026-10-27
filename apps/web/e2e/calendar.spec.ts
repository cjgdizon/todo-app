import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

// The real connection needs Google; scripts/gcal-check covers the sync and the OAuth steps against a
// stand-in Google. Here: the settings section as a person meets it, with the server's answer to
// "connect" decided by the test, so the result does not depend on what is running locally.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

async function answerConnect(page: Page, status: number, body: object) {
  await page.route("**/functions/v1/gcal-connect", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
}

async function openSettings(page: Page) {
  await signUp(page);
  await page.getByRole("link", { name: "Settings (import and export)" }).click();
  const section = page.getByRole("region", { name: "Google Calendar" });
  await expect(section).toBeVisible();
  return section;
}

test("Google Calendar is offered in Settings, off by default, and says so when it cannot start", async ({ page }) => {
  await answerConnect(page, 500, { error: "not configured" });
  const section = await openSettings(page);
  await expect(section.getByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
  await expect(section).toContainText("Optional");
  await expect(section).toContainText("never your other calendars");
  await expect(section.getByRole("button", { name: "Disconnect" })).toHaveCount(0);

  await section.getByRole("button", { name: "Connect Google Calendar" }).click();
  await expect(page.getByText(/Couldn't start the connection with Google/)).toBeVisible();
  await expect(page).toHaveURL(/\/settings/);
});

test("connecting sends the person to Google's address and shows the outcome when they return", async ({ page }) => {
  // Stand in for Google's consent screen: it sends the browser straight back with a result.
  await answerConnect(page, 200, { url: "http://localhost:3000/settings?calendar=connected" });
  const section = await openSettings(page);
  await section.getByRole("button", { name: "Connect Google Calendar" }).click();
  await expect(page).toHaveURL(/calendar=connected/);
  await expect(page.getByText(/Google Calendar is connected/)).toBeVisible();
});

test("the person sees a clear message when they decline on Google's screen", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings?calendar=denied");
  await expect(page.getByText(/not connected, because access was declined/)).toBeVisible();
});
