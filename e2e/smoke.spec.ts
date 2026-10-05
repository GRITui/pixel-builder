import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REF = fileURLToPath(new URL("../test/fixtures/refs/mmo-crop.png", import.meta.url));
const SHOT = (name: string) => fileURLToPath(new URL(`../docs/img/ui-${name}.png`, import.meta.url));

test("generate, reference, compare, generate-from-reference, attach, export", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.getByRole("banner").getByText("Pixel Builder")).toBeVisible();

  // No AI key: pill says off, AI buttons are disabled with an explanation (no crash).
  await expect(page.getByRole("button", { name: /AI: off/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Vibe/ })).toBeDisabled();
  await expect(page.getByText(/ANTHROPIC_API_KEY is not set/).first()).toBeVisible();

  // 1. generate an asset (live preview), save it
  await page.getByLabel("Asset name").fill("Smoke hero");
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByText(/Smoke hero/).first()).toBeVisible();
  await page.screenshot({ path: SHOT("workspace"), clip: { x: 0, y: 0, width: 1280, height: 800 } });

  // 2. References panel: add a local PNG
  await page.getByRole("button", { name: /^References/ }).click();
  const panel = page.getByRole("region", { name: "References" });
  await panel.locator('input[type="file"]').setInputFiles(REF);
  await expect(panel.getByLabel("Reference name")).toHaveValue("mmo-crop");
  await expect(page.getByRole("button", { name: /^References \(1\)/ })).toBeVisible();
  await page.screenshot({ path: SHOT("references"), clip: { x: 880, y: 300, width: 400, height: 500 } });

  // 4. Generate from reference
  await panel.getByRole("button", { name: "Generate", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Generate from reference" });
  await expect(dlg.locator("button.var")).toHaveCount(6);
  // AI refinement is not offered without a key
  await expect(dlg.getByRole("button", { name: "Ask Claude" })).toHaveCount(0);
  await page.screenshot({ path: SHOT("generate-from-reference") });
  await dlg.locator("button.var").first().click();
  await expect(dlg).toHaveCount(0);

  // 3. Compare panel: library card for the kept asset has a Compare slider
  await page.getByRole("button", { name: /^Library/ }).click();
  const card = page.locator("article.asset", { hasText: "(ref)" }).first();
  await card.getByRole("button", { name: "Compare" }).click();
  await expect(card.getByRole("img", { name: /^Reference mmo-crop/ })).toBeVisible();
  await expect(card.getByLabel(/Compare split/)).toBeVisible();
  await card.screenshot({ path: SHOT("compare") });

  // 5. AttachReference: attach a local image to the (AI) prompt; AI stays off with a clear message
  await page.getByRole("navigation", { name: "Categories" }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Attach reference" }).first().click({ trial: true });
  await page.locator(".attach-ref input[type=file]").first().setInputFiles(REF);
  await expect(page.getByRole("img", { name: "Attached reference" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Vibe/ })).toBeDisabled();
  await page.getByRole("button", { name: "Remove attached reference" }).click();

  // 6. export: PNG download from the workspace
  await page.getByRole("button", { name: /^Export/ }).first().click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /^PNG/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  const path = await dl.path();
  expect(readFileSync(path!).subarray(1, 4).toString()).toBe("PNG");

  expect(errors).toEqual([]);
});
