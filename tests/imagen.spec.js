// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Regression tests for the 4 design-feedback bugs + a generation smoke test.
 *
 * HERMETIC: every OpenRouter network call is intercepted — no API key sent over
 * the wire, no credits spent, no VPN required, deterministic. The real
 * /images/models payload (38 models, supported_parameters as objects) is served
 * from tests/fixtures/models.json so the UI behaves exactly like production.
 */

const MODELS_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/models.json'), 'utf8')
);

// Valid 8×8 PNG (Python-generated) for the mock /images response.
const MOCK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNQcPiPFTEMLQkAEgZXwUfPxlkAAAAASUVORK5CYII=';

/** Intercept all OpenRouter calls with fixtures/mocks. Call in beforeEach. */
async function mockOpenRouter(page) {
  // GET /images/models (list) — exact path, must NOT match /models/{id}/endpoints
  await page.route('**/api/v1/images/models', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', json: MODELS_FIXTURE });
  });

  // GET /images/models/{id}/endpoints — return per-model authoritative pricing
  await page.route('**/endpoints', async (route) => {
    const url = route.request().url();
    let cost = 6e-05, unit = 'token'; // default ~gemini
    if (url.includes('gpt-image-2')) cost = 3e-05;
    else if (url.includes('flux')) { cost = 0.03; unit = 'megapixel'; }
    else if (url.includes('recraft') || url.includes('seedream')) { cost = 0.04; unit = 'image'; }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      json: [{ provider_name: 'mock', pricing: [{ billable: 'output_image', unit, cost_usd: cost }] }],
    });
  });

  // POST /chat/completions — Prompt Assistant returns a canned prompt
  await page.route('**/chat/completions', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      json: { choices: [{ message: { content: 'A cinematic photo of a mountain lake at dawn, misty, serene, golden light.' } }] },
    });
  });

  // POST /images — generation returns one fake image + a cost
  await page.route('**/api/v1/images', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      json: {
        created: 0,
        data: [{ b64_json: MOCK_PNG_B64, media_type: 'image/png' }],
        usage: { cost: 0.0672, completion_tokens_details: { image_tokens: 1120 } },
      },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockOpenRouter(page);
  await page.goto('/');
  // Auto-wait for the async model list to render (the original race bug #2)
  await expect(page.getByText('Nano Banana').first()).toBeVisible({ timeout: 10000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug #2 + #3: controls and pricing show for the default Gemini model on load
// ─────────────────────────────────────────────────────────────────────────────
test('resolution + pricing visible on load for Gemini (bugs #2, #3)', async ({ page }) => {
  await expect(page.locator('#resolutionSection')).toBeVisible();
  await expect(page.locator('#qualitySection')).toBeHidden();   // Gemini has no quality
  await expect(page.locator('#backgroundSection')).toBeHidden();
  await expect(page.locator('#priceRate')).toContainText('$60/1M img-tok');
  await expect(page.locator('#priceEstimate')).toContainText('@1K');
  await expect(page.locator('#priceEstimate')).toContainText('0.0672'); // 1120 tok × $60/1M
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug #4: pricing updates when resolution changes
// ─────────────────────────────────────────────────────────────────────────────
test('pricing updates on resolution change (bug #4)', async ({ page }) => {
  await page.locator('#resolutionSection .btn-toggle[data-resolution="2K"]').click();
  await expect(page.locator('#priceEstimate')).toContainText('@2K');
  await expect(page.locator('#priceEstimate')).toContainText('0.1008'); // 1680 tok × $60/1M

  await page.locator('#resolutionSection .btn-toggle[data-resolution="4K"]').click();
  await expect(page.locator('#priceEstimate')).toContainText('@4K');
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug #1: Prompt Assistant opens on a single click + Generate auto-inserts
// ─────────────────────────────────────────────────────────────────────────────
test('prompt assistant: one click opens + generate auto-inserts (bug #1)', async ({ page }) => {
  // Single header click must open it (the old double-toggle bug cancelled itself)
  await page.locator('#promptAssistantHeader').click();
  await expect(page.locator('#assistantIdea')).toBeVisible();

  // Fill idea + Generate (chat/completions is intercepted → no spend)
  await page.locator('#assistantIdea').fill('mountain lake at dawn');
  await page.locator('#generatePromptBtn').click();

  // The generated prompt must auto-insert into the main generation field.
  // NB: use toHaveValue (not toContainText) — textareas expose text via .value,
  // not .textContent, so toContainText would read stale/empty content.
  await expect(page.locator('#promptInput')).toHaveValue(/mountain lake/, { timeout: 10000 });
  await expect(page.locator('#assistantOutput')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug #1 (reference): reference image is attached to the assistant request
// ─────────────────────────────────────────────────────────────────────────────
test('reference image is attached to the assistant chat request (bug #1)', async ({ page }) => {
  let capturedBody = null;
  await page.route('**/chat/completions', async (route) => {
    capturedBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      json: { choices: [{ message: { content: 'prompt based on the reference' } }] },
    });
  });

  await page.locator('#promptAssistantHeader').click();
  // Inject a reference image into app state, then generate
  await page.evaluate(() => {
    state.references.push('data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNQcPiPFTEMLQkAEgZXwUfPxlkAAAAASUVORK5CYII=');
    renderReferenceSlots();
  });
  await page.locator('#assistantIdea').fill('use the reference');
  await page.locator('#generatePromptBtn').click();

  await expect.poll(() => capturedBody, { timeout: 10000 }).not.toBeNull();
  const userMsg = capturedBody.messages.find((m) => m.role === 'user');
  expect(Array.isArray(userMsg.content)).toBeTruthy();
  expect(userMsg.content.some((p) => p.type === 'image_url')).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// Number of Images: clamps + disables +/- for single-image models (Gemini/Flux)
// ─────────────────────────────────────────────────────────────────────────────
test('image count clamps and disables +/- for single-image models', async ({ page }) => {
  const openDropdown = async () => page.locator('#modelSelectTrigger').click();
  const pick = async (id) => page.locator(`.custom-select-option[data-value="${id}"]`).click();

  // GPT supports n up to 10 — set a high count, + stays enabled
  await openDropdown(); await pick('openai/gpt-image-2');
  await page.locator('#imageCount').fill('9');
  await expect(page.locator('#imageCount')).toHaveValue('9');
  await expect(page.locator('#increaseCount')).toBeEnabled();

  // Switch to Gemini (n.max = 1) — count must clamp to 1 and +/- disable
  await openDropdown(); await pick('google/gemini-3.1-flash-image');
  await expect(page.locator('#imageCount')).toHaveValue('1');
  await expect(page.locator('#increaseCount')).toBeDisabled();
  await expect(page.locator('#decreaseCount')).toBeDisabled();
  await expect(page.locator('#increaseCount')).toHaveAttribute('title', /1 image per request/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Smoke: image generation inserts a gallery card with the real usage.cost
// ─────────────────────────────────────────────────────────────────────────────
test('generate inserts image card with cost (smoke)', async ({ page }) => {
  await page.locator('#promptInput').fill('a minimal blue circle on white');
  await page.locator('#generateBtn').click();

  const card = page.locator('.image-card:not(.loading-placeholder)').first();
  await expect(card).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.cost-tag').first()).toContainText('$0.0672');
});
