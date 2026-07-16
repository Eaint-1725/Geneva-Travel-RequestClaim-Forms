// Team -> lines printed beneath the dotted approver signature line on the export.
const APPROVER_BLOCKS: Record<string, string[]> = {
  EPI: ["Team Leader (WHO - EPI)"],
  MAL: ["Dr. Deyer Gopinath", "Medical Officer", "Malaria Team"],
  HIV: ["Medical Officer", "Dr Nabeel Mangandan Konathan"],
};

const DEFAULT_APPROVER_BLOCK = ["Team Leader"];

/** Lines to print beneath the approver's dotted signature line, stacked top to bottom. */
export function getApproverBlock(team: string): string[] {
  return APPROVER_BLOCKS[team] ?? DEFAULT_APPROVER_BLOCK;
}
