import type { Prospect } from "@lead/contracts";

type FollowUpProspect = Pick<Prospect, "followUpOn" | "stage">;

export function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isFollowUpDue(
  prospect: FollowUpProspect,
  today = localDate(),
): boolean {
  return (
    prospect.stage !== "Not a fit" &&
    Boolean(prospect.followUpOn) &&
    (prospect.followUpOn || "") <= today
  );
}
