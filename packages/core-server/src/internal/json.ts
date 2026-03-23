import { readFileSync } from "node:fs";

export function readJsonFile<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

export function readErrorMessage(error: Record<string, unknown>, fallback: string): string {
  if (typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
