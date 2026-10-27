import { expect, test } from "@playwright/test";
import { addTask, openTask, sharedWorkspace, signUp, submitSignUp, taskRow, watchWrites } from "./helpers";

test("an invited person joins a workspace and both see each other's changes live", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await signUp(owner);
    await addTask(owner, "Shared before joining");

    // The owner makes an invite link; it is shown once.
    await owner.getByRole("link", { name: "Members and invites" }).click();
    await expect(owner.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
    await owner.getByRole("button", { name: "Create invite link" }).click();
    const link = await owner.getByLabel("Invite link (shown once)").inputValue();
    expect(link).toMatch(/\/join\?token=[A-Za-z0-9]+$/);

    // A signed-out visitor is sent to sign in first and lands back on the invite.
    watchWrites(guest);
    await guest.goto(link);
    await expect(guest).toHaveURL(/\/login\?next=/);
    await submitSignUp(guest);
    await expect(guest).toHaveURL(/\/join\?token=/);
    await guest.getByRole("button", { name: "Join workspace" }).click();

    // The guest now works in the owner's workspace and sees its tasks.
    await expect(guest).toHaveURL(/\/inbox/);
    await expect(taskRow(guest, "Shared before joining")).toBeVisible();
    await expect(guest.getByRole("combobox", { name: "Workspace" })).toBeVisible();

    // Changes appear on the other side without a reload.
    await owner.getByRole("link", { name: "Inbox" }).click();
    await addTask(owner, "From the owner");
    await expect(taskRow(guest, "From the owner")).toBeVisible();
    await addTask(guest, "From the guest");
    await expect(taskRow(owner, "From the guest")).toBeVisible();

    // The owner sees both people; a plain member does not get the invite controls.
    await owner.getByRole("link", { name: "Members and invites" }).click();
    await expect(owner.getByRole("listitem").filter({ hasText: "(you)" })).toHaveCount(1);
    await expect(owner.getByRole("listitem").filter({ hasText: "Member" })).toHaveCount(1);
    await guest.getByRole("link", { name: "Members and invites" }).click();
    await expect(guest.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Invite people" })).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});

test("a task can be assigned and discussed in comments", async ({ browser }) => {
  const { owner, guest, close } = await sharedWorkspace(browser);
  try {
    await addTask(owner, "Plan the offsite");
    await expect(taskRow(guest, "Plan the offsite")).toBeVisible();

    // Only people with a teammate see the assignee field; the owner picks the guest.
    await openTask(owner, "Plan the offsite");
    const assignee = owner.getByLabel("Assignee");
    const guestName = await assignee.locator("option:not([value=''])").last().innerText();
    await assignee.selectOption({ label: guestName });
    await owner.getByRole("textbox", { name: "Add a comment" }).fill("Can you book a venue?");
    await owner.getByRole("button", { name: "Post comment" }).click();
    await expect(owner.getByText("Can you book a venue?")).toBeVisible();

    // The guest opens the same task: the assignment and the comment arrived without a reload.
    await openTask(guest, "Plan the offsite");
    await expect(guest.getByLabel("Assignee")).toHaveValue(await assignee.inputValue());
    await expect(guest.getByText("Can you book a venue?")).toBeVisible();

    // A reply shows up live in the owner's open drawer; only the author can edit their own comment.
    await guest.getByRole("textbox", { name: "Add a comment" }).fill("On it");
    await guest.getByRole("button", { name: "Post comment" }).click();
    await expect(owner.getByText("On it")).toBeVisible();
    await expect(guest.getByRole("button", { name: "Edit" })).toHaveCount(1);

    await owner.getByRole("button", { name: "Edit" }).click();
    await owner.getByRole("textbox", { name: "Edit comment" }).fill("Can you book a venue by Friday?");
    await owner.getByRole("button", { name: "Save" }).click();
    await expect(guest.getByText("Can you book a venue by Friday?")).toBeVisible();
    await expect(guest.getByText("(edited)")).toBeVisible();

    // Naming someone with @ highlights them and tells them in the activity feed.
    await owner.getByRole("textbox", { name: "Add a comment" }).fill(`@${guestName} can you confirm?`);
    await owner.getByRole("button", { name: "Post comment" }).click();
    await expect(owner.locator("strong", { hasText: `@${guestName}` })).toBeVisible();

    // The activity feed tells each person what happened, in their own terms.
    await owner.keyboard.press("Escape");
    await owner.getByRole("link", { name: "Activity" }).click();
    await expect(owner.getByText(`You assigned “Plan the offsite” to ${guestName}`)).toBeVisible();
    await expect(owner.getByText("commented on “Plan the offsite”").first()).toBeVisible();
    await guest.keyboard.press("Escape");
    await guest.getByRole("link", { name: "Activity" }).click();
    await expect(guest.getByText(/assigned “Plan the offsite” to you$/)).toBeVisible();
    await expect(guest.getByText("You commented on “Plan the offsite”")).toBeVisible();
    await expect(guest.getByText(/mentioned you in “Plan the offsite”/)).toBeVisible();
  } finally {
    await close();
  }
});

test("an invite link works once and a bad link is refused", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [owner, first, second] = await Promise.all(contexts.map((context) => context.newPage()));

  try {
    await signUp(owner!);
    await owner!.getByRole("link", { name: "Members and invites" }).click();
    await owner!.getByRole("button", { name: "Create invite link" }).click();
    const link = await owner!.getByLabel("Invite link (shown once)").inputValue();

    await signUp(first!);
    await first!.goto(link);
    await first!.getByRole("button", { name: "Join workspace" }).click();
    await expect(first!).toHaveURL(/\/inbox/);

    await signUp(second!);
    await second!.goto(link);
    await second!.getByRole("button", { name: "Join workspace" }).click();
    await expect(second!.getByRole("main").getByRole("alert")).toContainText("not valid or has expired");

    await second!.goto("/join?token=%20bad");
    await expect(second!.getByRole("main").getByRole("alert")).toContainText("not valid or has expired");
    await expect(second!.getByRole("button", { name: "Join workspace" })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
