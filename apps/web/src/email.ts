import {
  EmailDraftInput,
  type EmailDraft,
  type Campaign,
  type Prospect,
} from "@lead/contracts";

export { EmailDraftInput as OutreachDraftSchema } from "@lead/contracts";
export type OutreachDraft = EmailDraft;

export function createOutreachDraft(
  prospect: Prospect,
  campaign?: Campaign,
  context = "",
): EmailDraft {
  const offer = campaign?.offer.trim();
  return {
    to: prospect.business.email,
    subject: (offer ? `Introduction: ${offer}` : "A quick introduction")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 200),
    context,
    body: [
      `Hello ${prospect.business.name.trim() || "there"},`,
      "",
      ...(offer ? [`I’d like to introduce ${offer}.`, ""] : []),
      ...(context.trim() ? [`For context: ${context.trim()}`, ""] : []),
      "If this is relevant to your work, would you be open to a brief conversation?",
      "",
      "Best,",
    ].join("\n"),
  };
}

export function buildMailto(draft: {
  to: string;
  subject: string;
  body: string;
  context?: string;
}): string | null {
  const parsed = EmailDraftInput.safeParse(draft);
  if (
    !parsed.success ||
    !parsed.data.to ||
    !parsed.data.subject.trim() ||
    !parsed.data.body.trim()
  )
    return null;
  const recipient = encodeURIComponent(parsed.data.to).replace(/%40/gi, "@");
  const query = new URLSearchParams({
    subject: parsed.data.subject,
    body: parsed.data.body,
  })
    .toString()
    .replace(/\+/g, "%20");
  return `mailto:${recipient}?${query}`;
}
