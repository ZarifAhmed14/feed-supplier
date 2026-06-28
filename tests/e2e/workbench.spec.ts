import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.delete("/api/state");
});

test("loads the private procurement workbench and ranks sample suppliers", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /supplier quote analyzer/i })).toBeVisible();
  await page.getByRole("button", { name: /use sample data/i }).click();

  await expect(page.getByText("Sample supplier quotes")).toBeVisible();
  const ranking = page.getByRole("table").last();
  await expect(ranking).toContainText("Atlas Commodities");
  await expect(ranking).toContainText("Meghna Nutrition");
  await expect(ranking).toContainText("Existing supplier");
  await expect(ranking).toContainText("New/unmatched supplier");
  await expect(page.getByText("5 valid row(s), 0 rejected")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("adds and archives a supplier", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Name").fill("New Test Supplier");
  await page.getByLabel("Product", { exact: true }).fill("Maize");
  await page.locator("section", { hasText: "3. Supplier database" }).getByLabel("Country").fill("Bangladesh");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByRole("table").first()).toContainText("New Test Supplier");
  await page.getByRole("row", { name: /New Test Supplier/ }).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("table").first()).not.toContainText("New Test Supplier");
});

test("captures a purchase request", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Product / ingredient").fill("Soybean Meal");
  await page.getByLabel("Quantity").fill("50");
  await page.getByLabel("Required date").fill("2026-07-15");
  await page.getByLabel("Delivery location").fill("Dhaka warehouse");
  await expect(page.getByText("Request: Soybean Meal · 50 MT · 2026-07-15 · Dhaka warehouse")).toBeVisible();
  await expect(page.getByLabel("RFQ draft")).toContainText("Product: Soybean Meal");
  await expect(page.getByLabel("RFQ draft")).toContainText("Quantity: 50 MT");
  await expect(page.getByLabel("RFQ draft")).toContainText("Delivery location: Dhaka warehouse");
});

test("adds a manual quote to ranking", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Supplier", { exact: true }).fill("Phone Supplier");
  await page.getByLabel("Ingredient", { exact: true }).fill("Maize");
  await page.getByLabel("Price").fill("250");
  await page.getByLabel("Availability").fill("In stock");
  await page.getByLabel("Reliability").fill("80");
  await page.getByRole("button", { name: "Add quote" }).click();
  const ranking = page.getByRole("table").last();
  await expect(page.getByText("Current file: Manual quote entry")).toBeVisible();
  await expect(ranking).toContainText("Phone Supplier");
  await expect(ranking).toContainText("Maize");
});

test("approves a supplier and creates PO/doc/tracking state", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Product / ingredient").fill("Maize");
  await page.getByLabel("Quantity").fill("50");
  await page.getByRole("button", { name: /use sample data/i }).click();
  await page.getByRole("row", { name: /Padma Feed Inputs/ }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved supplier: Padma Feed Inputs for Maize")).toBeVisible();
  await expect(page.getByLabel("PO draft")).toContainText("Supplier: Padma Feed Inputs");
  await page.getByLabel("Purchase Order").check();
  await page.getByLabel("Order status").selectOption("PO sent");
  await expect(page.getByLabel("Order status")).toHaveValue("PO sent");
  await expect(page.getByText("Approved Padma Feed Inputs for Maize")).toBeVisible();
});

test("rejects a disguised spreadsheet before analysis", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "quotes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
  });
  await expect(page.getByText("File content does not match its .csv extension.", { exact: true })).toBeVisible();
  await expect(page.getByText("No file loaded")).toBeVisible();
});
