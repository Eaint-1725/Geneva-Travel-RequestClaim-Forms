import { promises as fs } from "fs";
import path from "path";

export interface SubmissionRecord {
  id: string;
  createdAt: string;
  month: string;
  team: string;
  name: string;
  dutyStation: string;
  grandTotalPerDiemUsd: number;
  grandTotalAmountMmk: number;
}

const STORE_PATH = path.join(process.cwd(), "data", "travel-submissions.json");

async function readAll(): Promise<SubmissionRecord[]> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw) as SubmissionRecord[];
  } catch {
    return [];
  }
}

export async function addSubmission(record: SubmissionRecord): Promise<void> {
  const all = await readAll();
  all.push(record);
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(all, null, 2), "utf-8");
}

export async function listSubmissions(): Promise<SubmissionRecord[]> {
  return readAll();
}
