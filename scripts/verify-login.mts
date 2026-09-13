/**
 * Drives the Privy login path end to end in a real browser: signed out →
 * signed in but seatless → claimed. 1.5 is the one step whose whole surface
 * is client-side, so it cannot be proven by a request; something has to
 * click the buttons.
 *
 *   pnpm verify:login <orgId> <email>
 *
 * Privy mails a six-digit code to that address and this pauses for it, so
 * run it somewhere you can type. Test accounts (`test-####@privy.io`, code
 * `123456`) are NOT enabled on this app — measured, not assumed: the code is
 * refused and the boxes clear. So a real inbox it is.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const [orgId, email] = process.argv.slice(2);
if (!orgId || !email) {
  console.error("usage: pnpm verify:login <orgId> <email>");
  process.exit(1);
}

/** Privy's codes are short-lived, so this is asked for only once it is sent. */
async function askForCode(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question(`\n  code sent to ${email} — enter it: `)).trim();
      if (/^\d{6}$/.test(answer)) return answer;
      console.log("  six digits, please.");
    }
  } finally {
    rl.close();
  }
}

const base = process.env.BASE_URL ?? "http://localhost:3002";
const shots = process.env.SHOT_DIR ?? "/tmp/rolebound-login";
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.error("  page error:", e.message));

let step = 0;
async function shot(name: string) {
  // Best effort: a screenshot that will not take is not a failed login.
  const path = `${shots}/${String(++step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path }).catch((e) => console.error(`    (no screenshot ${name}: ${e.message.split("\n")[0]})`));
}
function ok(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  throw new Error(msg);
}

try {
  console.log(`\nVerifying login at ${base}/orgs/${orgId}\n`);

  // 1 — signed out
  await page.goto(`${base}/orgs/${orgId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 30_000 });
  await shot("signed-out");
  ok("signed out: sign-in screen, Privy ready (button enabled)");

  // 2 — Privy modal
  await page.getByRole("button", { name: "Sign in" }).click();
  const emailField = page.locator('input[type="email"], input[name="email"]').first();
  await emailField.waitFor({ timeout: 20_000 });
  await shot("privy-modal");
  ok("Privy modal opened with an email field");

  // 3 — email + code
  await emailField.fill(email);
  await page.keyboard.press("Enter");
  // Privy splits the code across six single-character boxes that advance on
  // keypress, so it has to be typed rather than filled.
  const code = page.locator('input[name^="code-"]');
  await code.first().waitFor({ timeout: 20_000 });
  await shot("code-prompt");
  ok(`code prompt reached for ${email}`);

  const otp = await askForCode();
  await code.first().click();
  await page.keyboard.type(otp, { delay: 60 });

  // 4 — seatless
  const whoAreYou = page.getByText("Who are you?");
  await whoAreYou.waitFor({ timeout: 60_000 }).catch(async (e) => {
    const modal = await page.locator("body").innerText();
    const boxes = await code.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join(""));
    // Privy clears the boxes on a bad code and says nothing, so an empty
    // strip is the refusal, not a missing keystroke.
    if (boxes === "" || /invalid|incorrect|expired|wrong/i.test(modal)) {
      fail(`Privy refused the code. Codes expire quickly — request a fresh one and rerun.`);
    }
    throw e;
  });
  await shot("claim-seat");
  ok("signed in but seatless: claim screen");

  const offered = await page.locator("form button[type=submit]").allInnerTexts();
  console.log(`    seats offered: ${offered.join(", ")}`);
  if (offered.some((t) => /agent/i.test(t))) fail("an agent seat was offered to a person");
  ok("no agent seat offered");

  // 5 — claim
  const seat = offered[0];
  await page.getByRole("button", { name: seat, exact: true }).click();
  await page.getByRole("link", { name: "Roles" }).waitFor({ timeout: 30_000 });
  await shot("claimed");
  ok(`claimed the ${seat} seat; app shell rendered`);

  const header = await page.locator("header").innerText();
  if (!header.includes(seat)) fail(`header does not name the actor: ${header.replace(/\n/g, " | ")}`);
  ok("header names the signed-in member");

  // 6 — survives reload, so the seat is persisted, not just in React state
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Roles" }).waitFor({ timeout: 30_000 });
  await shot("after-reload");
  ok("still signed in and seated after a reload");

  console.log(`\n1.5 verified. Screenshots in ${shots}\n`);
} catch (e) {
  await shot("failure");
  console.error(`\nFAILED: ${(e as Error).message}`);
  console.error(`Screenshots in ${shots}`);
  const text = await page.locator("body").innerText().catch(() => "");
  console.error(`\n--- page text ---\n${text.slice(0, 1200)}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
