import type { MailConnectionRow, MailSecret } from "../types";

export type ProviderRef = { id: string; date?: string };

export interface ProviderSession {
  /** IDs of messages received at/after `since`, oldest first. */
  listSince(since: Date, cap: number): Promise<ProviderRef[]>;
  /** Raw RFC 822 bytes, or null when the provider says to skip (draft/spam/trash). */
  fetchRaw(ref: ProviderRef): Promise<Buffer | null>;
  close(): Promise<void>;
  /** Secret after any token refresh — persist when `secretChanged`. */
  secret: MailSecret;
  secretChanged: boolean;
}

export type OAuthIdentity = {
  email: string;
  displayName: string | null;
  secret: MailSecret;
};

export type OpenSession = (
  conn: MailConnectionRow,
  secret: MailSecret,
) => Promise<ProviderSession>;
