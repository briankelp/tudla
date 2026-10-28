import { describe, expect, it } from "vitest";
import type { Campaign, Prospect } from "@lead/contracts";
import {
  buildMailto,
  createOutreachDraft,
  OutreachDraftSchema,
} from "../apps/web/src/email";

const prospect = {
  id: "prospect-1",
  business: {
    name: "Harbor Clinic",
    email: "contact@example.com",
  },
} as Prospect;

describe("outreach email drafts", () => {
  it("encodes subject and multiline body in a mailto URL", () => {
    const draft = {
      to: "contact@example.com",
      subject: "Hello & welcome?",
      body: "First line\nSecond line",
    };
    const mailto = buildMailto(draft);
    expect(mailto).toBeTruthy();
    const url = new URL(mailto!);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("contact@example.com");
    expect(url.searchParams.get("subject")).toBe(draft.subject);
    expect(url.searchParams.get("body")).toBe(draft.body);
  });

  it("rejects header newlines in recipients and incomplete mailto drafts", () => {
    expect(
      buildMailto({
        to: "person@example.com%0d%0aBcc:evil@example.com",
        subject: "Hello",
        body: "Message",
      }),
    ).toBeNull();
    expect(
      buildMailto({ to: "person@example.com", subject: "", body: "Message" }),
    ).toBeNull();
  });

  it("rejects subject header injection and creates bounded subjects from multiline offers", () => {
    expect(
      buildMailto({
        to: "person@example.com",
        subject: "Hello\r\nBcc: other@example.com",
        body: "Message",
      }),
    ).toBeNull();
    const draft = createOutreachDraft(prospect, {
      offer: "A long proposal\n".repeat(25),
    } as Campaign);
    expect(draft.subject.length).toBeLessThanOrEqual(200);
    expect(draft.subject).not.toMatch(/[\r\n]/);
    expect(OutreachDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("creates a restrained template from the prospect and stated offer", () => {
    const campaign = { offer: "online appointment scheduling" } as Campaign;
    const draft = createOutreachDraft(
      prospect,
      campaign,
      "A proposal for a 15 minute product tour.",
    );
    expect(draft.to).toBe("contact@example.com");
    expect(draft.subject).toContain(campaign.offer);
    expect(draft.body).toContain("Harbor Clinic");
    expect(draft.body).toContain(campaign.offer);
    expect(draft.body).toContain("A proposal for a 15 minute product tour.");
    expect(draft.body).not.toMatch(
      /need|struggling|looking to buy|perfect fit/i,
    );
    expect(OutreachDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("allows a blank recipient when saving and enforces field limits", () => {
    expect(
      OutreachDraftSchema.safeParse({
        to: "",
        subject: "",
        body: "",
        context: "",
      }).success,
    ).toBe(true);
    expect(
      OutreachDraftSchema.safeParse({
        to: "contact@example.com",
        subject: "s".repeat(201),
        body: "",
      }).success,
    ).toBe(false);
  });
});
