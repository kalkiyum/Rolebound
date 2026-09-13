/**
 * The responsive and mutation-feedback pass, measured rather than eyeballed.
 *
 * Two literal judging criteria live in phase 5, and both are the kind of
 * thing that looks fine on the machine it was built on. This walks every
 * screen at desktop and phone width, fails on any horizontal overflow, and
 * then drives a real over-cap payment to prove the outcome panel appears and
 * stays. Screenshots come out either way, so a failure is diagnosable.
 *
 *   pnpm verify:ui <orgId>
 *
 * Run it against the local Anvil dev server — it switches actors through the
 * development switcher, which Privy mode does not render.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const orgId = process.argv[2];
if (!orgId) {
  console.error("usage: pnpm verify:ui <orgId>");
  process.exit(1);
}

const base = process.env.BASE_URL ?? "http://localhost:3001";
const shots = process.env.SHOT_DIR ?? "/tmp/rolebound-ui";
mkdirSync(shots, { recursive: true });

const WIDTHS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const problems: string[] = [];
function ok(msg: string) { console.log(`  ✓ ${msg}`); }
function bad(msg: string) { console.log(`  ✗ ${msg}`); problems.push(msg); }

const browser = await chromium.launch({ channel: "chromium" });

async function pages(page: Page) {
  const roleId = await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>('a[href*="/roles/"]');
    return link ? link.getAttribute("href")!.split("/roles/")[1] : null;
  });

  return [
    ["roles", `/orgs/${orgId}`],
    ["approvals", `/orgs/${orgId}/approvals`],
    ["recurring", `/orgs/${orgId}/recurring`],
    ["activity", `/orgs/${orgId}/activity`],
    ["members", `/orgs/${orgId}/members`],
    ...(roleId ? ([["role-detail", `/orgs/${orgId}/roles/${roleId}`]] as const) : []),
  ] as [string, string][];
}

try {
  for (const size of WIDTHS) {
    console.log(`\n${size.name} — ${size.width}px\n`);
    const page = await browser.newPage({ viewport: size });
    await page.goto(`${base}/orgs/${orgId}`, { waitUntil: "networkidle" });

    for (const [name, path] of await pages(page)) {
      await page.goto(base + path, { waitUntil: "networkidle" });
      await page
        .screenshot({ path: `${shots}/${size.name}-${name}.png`, fullPage: true })
        .catch(() => {});

      // The page body must never scroll sideways. Wide tables and code are
      // allowed their own scroller; the document is not.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) bad(`${name} overflows by ${overflow}px at ${size.width}px`);
      else ok(`${name} fits`);

      // Controls under ~28px tall are a miss on a phone. Inline text links
      // are exempt: they sit in a line of prose or a row that is itself the
      // target, and holding them to a control's height would just pad text.
      if (size.name === "phone") {
        const small = await page.evaluate(() => {
          const targets = [...document.querySelectorAll("button, select, input, a")];
          return targets
            .filter((el) => {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0 || r.height >= 28) return false;
              return getComputedStyle(el).display !== "inline";
            })
            .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 24)}`);
        });
        if (small.length) bad(`${name} has ${small.length} small tap targets: ${small.slice(0, 4).join(", ")}`);
        else ok(`${name} tap targets`);
      }
    }
    await page.close();
  }

  // The outcome panel, driven for real rather than reasoned about.
  console.log("\nmutation feedback\n");
  const page = await browser.newPage({ viewport: WIDTHS[0] });
  await page.goto(`${base}/orgs/${orgId}`, { waitUntil: "networkidle" });

  const spender = process.env.SPENDER ?? "Dev Raman";
  await page.selectOption("#actor", { label: spender }).catch(() => {});
  await page.waitForTimeout(1500);

  // Whichever role this actor can actually spend from — the first card is
  // not necessarily one of them, and a skipped check reads as a pass.
  const roleHrefs = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/roles/"]')].map(
      (a) => a.getAttribute("href")!,
    ),
  );
  let amount = page.locator("#amount");
  for (const href of roleHrefs) {
    await page.goto(base + href, { waitUntil: "networkidle" });
    amount = page.locator("#amount");
    if (await amount.count()) break;
  }

  if (await amount.count()) {
    // Far over any sane per-payment cap, so this lands on an approver.
    await amount.fill("100000");
    await page.locator("#to").fill("0x000000000000000000000000000000000000bEEF");
    await page.locator("#reason").fill("Verifying the outcome panel");
    await page.getByRole("button", { name: "Send payment" }).click();

    const outcome = page.locator('[role="status"]').first();
    await outcome.waitFor({ timeout: 30_000 });
    const text = (await outcome.innerText()).replace(/\n/g, " ");
    ok(`payment outcome shown and kept: "${text}"`);

    // Still there a beat later — the whole point of not using a toast.
    await page.waitForTimeout(6000);
    if (await outcome.isVisible()) ok("outcome survives longer than a toast");
    else bad("the outcome disappeared");

    await page.screenshot({ path: `${shots}/outcome.png` }).catch(() => {});
  } else {
    bad(`${spender} cannot spend on the first role, so the panel was not exercised`);
  }
  await page.close();
} finally {
  await browser.close();
}

console.log(`\nScreenshots in ${shots}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log("\nAll clear.\n");
}
