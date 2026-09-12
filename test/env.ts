/**
 * Neutralizes deployment-specific configuration for the suite.
 *
 * `dotenv/config` loads `.env`, which describes the *deployed* app: Base
 * Sepolia, and the block RoleboundPay was deployed in. The suite runs against
 * a fresh Anvil whose head is around block 50, so a deployment block of
 * 46,643,471 puts every log scan's starting point tens of millions of blocks
 * past the end of the chain — and `fetchPaymentEvents` correctly returns
 * nothing, for a reason that has nothing to do with the code under test.
 *
 * Runs as a setup file, so it lands before any test module reads the value.
 */
delete process.env.NEXT_PUBLIC_ROLEBOUND_PAY_DEPLOY_BLOCK;
