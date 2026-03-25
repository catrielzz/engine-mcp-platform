import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { JournalEntry } from "@engine-mcp/contracts";

import type { EngineMcpJournalService } from "../shared.js";

const JOURNAL_LOG_FILE_NAME = "journal.ndjson";

export interface FileJournalServiceOptions {
  rootDir: string;
}

export function createFileJournalService(
  options: FileJournalServiceOptions
): EngineMcpJournalService {
  const filePath = join(options.rootDir, JOURNAL_LOG_FILE_NAME);

  return {
    async append(entry): Promise<void> {
      await mkdir(options.rootDir, { recursive: true });
      await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
    },
    async list(): Promise<readonly JournalEntry[]> {
      const lines = await readJsonLines(filePath);
      return Object.freeze(lines as JournalEntry[]);
    }
  };
}

async function readJsonLines(filePath: string): Promise<unknown[]> {
  try {
    const text = await readFile(filePath, "utf8");

    return text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
