function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getVibriumConfig() {
  return {
    apiBaseUrl: (
      process.env.VIBRIUM_API_BASE_URL ||
      process.env.NEXT_PUBLIC_VIBRIUM_API_URL ||
      "https://api-staging.vibrium.ai"
    ).replace(/\/$/, ""),
    agentsBaseUrl: (
      process.env.VIBRIUM_AGENTS_API_BASE_URL ||
      "https://agents-api.vibrium.ai"
    ).replace(/\/$/, ""),
    customerId: required("VIBRIUM_CUSTOMER_ID"),
    username: required("VIBRIUM_SERVICE_USERNAME"),
    password: required("VIBRIUM_SERVICE_PASSWORD"),
    opsCopilotBotId:
      process.env.VIBRIUM_OPS_COPILOT_BOT_ID?.trim() ||
      process.env.VIBRIUM_BOT_ID?.trim() ||
      "",
  };
}

export function getPublicConfig() {
  return {
    apiBaseUrl: (
      process.env.NEXT_PUBLIC_VIBRIUM_API_URL ||
      "https://api-staging.vibrium.ai"
    ).replace(/\/$/, ""),
    customerId: process.env.NEXT_PUBLIC_VIBRIUM_CUSTOMER_ID || "",
    siteName: process.env.NEXT_PUBLIC_SITE_NAME || "Vibrium Trade",
  };
}
