import type { MailConnectionRow, MailSecret } from "../types";
import type { Listed } from "../syncWindow";

export type ProviderRef = { id: string; date?: string };

export interface ProviderSession {
  /**
   * IDs of messages received at/after `since` (and before `before` when given), oldest first. A window
   * holding more than `cap` returns the newest `cap` and says where it was cut (`truncatedAt`).
   */
  listSince(since: Date, cap: number, before?: Date): Promise<Listed>;
  /** Raw RFC 822 bytes, or null when the provider says to skip (draft/spam/trash). */
  fetchRaw(ref: ProviderRef): Promise<Buffer | null>;
  close(): Promise<void>;
  /** Secret after any token refresh — persist when `secretChanged`. */
  secret: MailSecret;
  secretChanged: boolean;
}

export type OpenSession = (
  conn: MailConnectionRow,
  secret: MailSecret,
) => Promise<ProviderSession>;
