import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.delete("/api/state");
});

async function goToQuotes(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
}

async function loadSampleAndReview(page: import("@playwright/test").Page) {
  await goToQuotes(page);
  await page.getByRole("button", { name: /use sample data/i }).click();
  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
}

test("loads wizard and ranks sample suppliers", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await loadSampleAndReview(page);

  await expect(page.getByRole("heading", { name: /review recommendation/i })).toBeVisible();
  await expect(page.getByLabel("Supplier recommendation")).toContainText("Recommended supplier:");
  const ranking = page.getByRole("table").last();
  await expect(ranking).toContainText("Atlas Commodities");
  await expect(ranking).toContainText("Meghna Nutrition");
  await expect(ranking).toContainText("Existing supplier");
  await expect(ranking).toContainText("Not in supplier database");
  await expect(ranking).toContainText("Confidence");
  await expect(ranking).toContainText("Fit notes");
  await expect(ranking).toContainText("Estimated landed cost");
  await expect(page.getByText("5 valid row(s), 0 rejected")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("adds and archives a supplier from optional supplier database", async ({ page }) => {
  await goToQuotes(page);
  await page.getByText("Optional: supplier database").click();
  const supplierPanel = page.locator("details").filter({ hasText: "Optional: supplier database" });
  await supplierPanel.getByLabel("Name").fill("New Test Supplier");
  await supplierPanel.getByLabel("Product", { exact: true }).selectOption("Maize");
  await supplierPanel.getByLabel("Country", { exact: true }).fill("Bangladesh");
  await supplierPanel.getByRole("button", { name: "Add supplier" }).click();
  const supplierTable = page.getByRole("table").first();
  await expect(supplierTable).toContainText("New Test Supplier");
  await page.getByRole("row", { name: /New Test Supplier/ }).getByRole("button", { name: "Archive" }).click();
  await expect(supplierTable).not.toContainText("New Test Supplier");
});

test("captures a purchase request and shows RFQ draft in optional panel", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Product / ingredient").selectOption("Soybean Meal");
  await page.getByLabel("Quantity").fill("50");
  await page.getByLabel("Required date").fill("2026-07-15");
  await page.getByLabel("Delivery location").fill("Dhaka warehouse");
  await page.getByLabel("Preferred country").selectOption("Bangladesh");
  await page.getByLabel("Country risk tolerance").selectOption("Medium");
  await page.getByLabel("Minimum reliability").fill("80");
  await page.getByLabel("Supplier type preference").selectOption("Local");
  await expect(page.locator(".market-card").filter({ hasText: "Low bid price" })).toContainText("435 USD");
  await expect(page.getByText("Average buy price")).toBeVisible();
  await expect(page.locator(".market-card").filter({ hasText: "Average buy price" })).toContainText("455 USD");
  await expect(page.locator(".market-card").filter({ hasText: "Max price you allow" })).toContainText("490 USD");
  await expect(page.getByText("Request: Soybean Meal · 50 MT · 2026-07-15 · Dhaka warehouse")).toBeVisible();

  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Optional: RFQ draft").click();
  await expect(page.getByLabel("RFQ draft")).toContainText("Product: Soybean Meal");
  await expect(page.getByLabel("RFQ draft")).toContainText("Quantity: 50 MT");
  await expect(page.getByLabel("RFQ draft")).toContainText("Delivery location: Dhaka warehouse");
  await expect(page.getByLabel("RFQ draft")).toContainText("Low bid price: 435 USD per MT");
  await expect(page.getByLabel("RFQ draft")).toContainText("Average buy price: 455 USD per MT");
  await expect(page.getByLabel("RFQ draft")).toContainText("Target max price: 490 USD per MT");
});

test("adds a manual quote and shows it in recommendation table", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Product / ingredient").selectOption("Maize");
  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("button", { name: "Online Search" })).toBeVisible();
  await page.getByText("Optional: manually add supplier price").click();
  await page.getByLabel("Supplier", { exact: true }).fill("Phone Supplier");
  await page.getByLabel("Price amount").fill("250");
  await page.getByRole("button", { name: "Save supplier price" }).click();
  await expect(page.getByText("Current data: Manual supplier price")).toBeVisible();
  await expect(page.getByLabel("Price step recommendation")).toContainText("Current recommendation: Phone Supplier");

  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
  const ranking = page.getByRole("table").last();
  await expect(ranking).toContainText("Phone Supplier");
  await expect(ranking).toContainText("Maize");
});

test("runs free agent prototypes locally", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Product / ingredient").selectOption("Maize");
  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Online Search" }).click();
  await expect(page.getByText("Current data: Online search prototype")).toBeVisible();
  await expect(page.getByLabel("Price step recommendation")).toContainText("Current recommendation:");
  await expect(page.getByLabel("Price step recommendation")).toContainText("Confidence");

  await page.getByText("Optional: free agent prototypes").click();
  await expect(page.getByRole("button", { name: "Open real email draft" })).toBeVisible();
  await page.getByLabel("Paste real supplier email reply").fill("From: Delta Agro\nSupplier: Delta Agro\nPrice: USD 244 per MT");
  await page.getByRole("button", { name: "Import pasted reply" }).click();
  await page.getByRole("button", { name: "Queue follow-up" }).click();
  await page.getByRole("button", { name: "Verify mock suppliers" }).click();
  await page.getByRole("button", { name: "Suggest decision" }).click();
  await expect(page.getByText("Imported real pasted email reply from Delta Agro")).toBeVisible();
  await expect(page.getByLabel("Price step recommendation")).toContainText("Current recommendation:");

  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Approval reason").fill("Best fit for demo order");
  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Optional: shipment monitor prototype").click();
  await page.getByRole("button", { name: "Advance shipment status" }).click();
  await expect(page.getByLabel("Order status")).toHaveValue("Approved");
});

test("approves recommended supplier and creates PO/doc/tracking state", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Product / ingredient").selectOption("Maize");
  await page.getByLabel("Quantity").fill("50");
  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: /use sample data/i }).click();
  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Approval reason").fill("Best price and delivery fit");
  await page.getByRole("button", { name: "Approve recommended supplier" }).click();
  await page.locator(".wizard-actions").getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText(/Approved supplier:/)).toBeVisible();
  await expect(page.getByLabel("PO draft")).toContainText("Supplier:");
  await page.getByLabel("Purchase Order").check();
  await page.getByLabel("Order status").selectOption("PO sent");
  await expect(page.getByLabel("Order status")).toHaveValue("PO sent");
  await page.getByText("Optional: audit trail").click();
  await expect(page.locator("li").filter({ hasText: /Reason: Best price and delivery fit/ })).toBeVisible();
});

test("rejects a disguised spreadsheet before analysis", async ({ page }) => {
  await goToQuotes(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "quotes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
  });
  await expect(page.getByText("File content does not match its .csv extension.", { exact: true })).toBeVisible();
  await expect(page.getByText("No file loaded")).toBeVisible();
});
