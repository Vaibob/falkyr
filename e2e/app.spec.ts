// Browser flows through the Clerk-gated app. The headline test is the exact
// bug the founder caught: a SECOND signed-in account must NOT see the first
// user's Glove. Also covers the sign-in gate and the /connect wizard render.
//
// Requires Clerk test keys + two users:
//   falkyr.owner+clerk_test@example.com   (becomes the install owner)
//   falkyr.intruder+clerk_test@example.com (must be walled out)
// Skips cleanly when keys are absent.
import { test, expect } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

const authOn = Boolean(process.env.CLERK_SECRET_KEY && process.env.VITE_CLERK_PUBLISHABLE_KEY);
const OWNER = 'falkyr.owner+clerk_test@example.com';
const INTRUDER = 'falkyr.intruder+clerk_test@example.com';
const SECRET = 'GLOVE-SECRET-CV-DO-NOT-LEAK';

test.describe('Clerk-gated app', () => {
  test.skip(!authOn, 'Clerk test keys absent');

  test('the sign-in gate blocks the Perch when signed out', async ({ page }) => {
    await page.goto('/app');
    // Clerk's <SignIn> renders; the board itself (Scan / Refresh controls) does
    // not. ("the Perch" appears in the gate's own copy, so key on the board.)
    await expect(page.getByText(/sign in/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Scan' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  });

  test('owner can open the Glove; a second account is walled out and sees NO owner data', async ({
    page,
    context,
  }) => {
    // --- Owner signs in, binds the install, writes a secret into the Glove ---
    await setupClerkTestingToken({ context });
    await page.goto('/');
    await clerk.signIn({ page, emailAddress: OWNER });

    await page.goto('/glove');
    const cv = page.locator('#cv');
    await expect(cv).toBeVisible({ timeout: 15_000 });
    await cv.fill(`# Owner Only\n\n${SECRET}`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // Save round-trips (chip flips to "saved").
    await expect(page.getByText('saved', { exact: true })).toBeVisible({ timeout: 10_000 });

    await clerk.signOut({ page });

    // --- Intruder signs in on the SAME install ---
    await page.goto('/');
    await clerk.signIn({ page, emailAddress: INTRUDER });
    await page.goto('/glove');

    // The owner wall renders; the secret is nowhere in the DOM.
    await expect(page.getByText(/belongs to another account/i)).toBeVisible({ timeout: 15_000 });
    expect(await page.content()).not.toContain(SECRET);

    // And the raw API refuses the intruder's own token for this install.
    const status = await page.evaluate(async () => {
      const w = window as unknown as { Clerk?: { session?: { getToken(): Promise<string | null> } } };
      const token = await w.Clerk?.session?.getToken();
      const res = await fetch('/api/profile', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return res.status;
    });
    expect(status).toBe(403);
  });

  test('the connect-your-Claude wizard renders for the owner', async ({ page, context }) => {
    await setupClerkTestingToken({ context });
    await page.goto('/');
    await clerk.signIn({ page, emailAddress: OWNER });
    await page.goto('/connect');
    await expect(page.getByText(/Falkyr flies on your Claude/i)).toBeVisible({ timeout: 15_000 });
    // Never renders a raw token or an authorize secret in the initial DOM.
    expect(await page.content()).not.toMatch(/sk-ant-/);
  });
});
