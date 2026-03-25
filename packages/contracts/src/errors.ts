export const CORE_ERROR_CODES = [
  "policy_denied",
  "scope_missing",
  "snapshot_required",
  "target_outside_sandbox",
  "rollback_unavailable",
  "journal_write_failed"
] as const;

export type CoreErrorCode = (typeof CORE_ERROR_CODES)[number];

export interface CoreError {
  code: CoreErrorCode;
  message: string;
  retryable?: boolean;
  details?: Readonly<Record<string, unknown>>;
}
