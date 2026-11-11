/**
 * Facts shown on the public homepage, /privacy and /terms.
 */
export const APP_NAME = "Vibrium Trade";
export const COMPANY_NAME = "Vibrium AI";
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://vibrium-trade-suite.vercel.app"
).replace(/\/$/, "");
/** Shown as the privacy / support contact. Must be a monitored inbox. */
export const LEGAL_CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || "privacy@vibrium.ai";
export const LEGAL_LAST_UPDATED = "4 November 2026";
