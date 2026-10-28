import { useEffect, useState } from "react";
import {
  EmailDraftInput,
  type EmailDraft,
  type Campaign,
  type Prospect,
} from "@lead/contracts";
import { buildMailto, createOutreachDraft } from "./email";

export function OutreachComposer({
  prospect,
  campaign,
  initial,
  busy,
  onSave,
  onDirtyChange,
}: {
  prospect: Prospect;
  campaign?: Campaign;
  initial?: EmailDraft | null;
  busy: boolean;
  onSave: (draft: EmailDraft) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<EmailDraft>(
    () =>
      initial ?? {
        to: prospect.business.email,
        subject: "",
        body: "",
        context: "",
      },
  );
  const [saved, setSaved] = useState(draft);
  const [message, setMessage] = useState("");
  const [replace, setReplace] = useState(false);
  const dirty = (Object.keys(saved) as (keyof EmailDraft)[]).some(
    (key) => draft[key] !== saved[key],
  );
  const mailto = buildMailto(draft);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (
      !initial &&
      !dirty &&
      !draft.subject &&
      !draft.body &&
      !draft.context &&
      draft.to !== prospect.business.email
    ) {
      const next = { ...draft, to: prospect.business.email };
      setDraft(next);
      setSaved(next);
    }
  }, [initial, dirty, draft, prospect.business.email]);
  const update = (key: keyof EmailDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };
  const create = () => {
    setDraft({
      ...createOutreachDraft(prospect, campaign, draft.context),
      to: draft.to,
    });
    setReplace(false);
    setMessage("");
  };
  async function save() {
    const result = EmailDraftInput.safeParse(draft);
    if (!result.success) {
      setMessage(result.error.issues[0]?.message || "Check the email draft.");
      return;
    }
    if (await onSave(result.data)) {
      setDraft(result.data);
      setSaved(result.data);
      setMessage("Draft saved.");
    } else setMessage("Could not save. Your draft is still here; try again.");
  }
  return (
    <section className="outreach-composer" aria-label="Email draft">
      <p className="field-help">
        Create an editable template from your campaign offer and context. Review
        it before opening your email app.
      </p>
      <label>
        To
        <input
          type="email"
          value={draft.to}
          onChange={(event) => update("to", event.target.value)}
          maxLength={254}
        />
      </label>
      <label>
        Proposal or context
        <textarea
          value={draft.context}
          onChange={(event) => update("context", event.target.value)}
          maxLength={2000}
          rows={3}
        />
      </label>
      <div>
        <button
          className="button"
          onClick={() =>
            draft.subject || draft.body ? setReplace(true) : create()
          }
          disabled={busy}
        >
          Create draft
        </button>
        {replace && (
          <div
            className="inline-info"
            role="group"
            aria-label="Replace email draft"
          >
            <p>Replace the current subject and message?</p>
            <div className="inline-actions">
              <button className="button" onClick={create}>
                Replace draft
              </button>
              <button className="text-button" onClick={() => setReplace(false)}>
                Keep current draft
              </button>
            </div>
          </div>
        )}
      </div>
      <label>
        Subject
        <input
          value={draft.subject}
          onChange={(event) => update("subject", event.target.value)}
          maxLength={200}
        />
      </label>
      <label>
        Message
        <textarea
          value={draft.body}
          onChange={(event) => update("body", event.target.value)}
          maxLength={5000}
          rows={7}
        />
      </label>
      <div className="inline-actions">
        <button
          className="button primary"
          onClick={() => void save()}
          disabled={busy || !dirty}
        >
          Save draft
        </button>
        <button
          className="button"
          disabled={busy || !mailto}
          onClick={() => {
            if (mailto) location.href = mailto;
          }}
        >
          Open in email app
        </button>
        <button
          className="text-button"
          disabled={!draft.body}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `${draft.subject}\n\n${draft.body}`,
              );
              setMessage("Message copied.");
            } catch {
              setMessage(
                "Copy failed. You can select and copy the message above.",
              );
            }
          }}
        >
          Copy message
        </button>
      </div>
      <p className="field-help" role="status">
        {message || (dirty ? "Unsaved draft" : "")}
      </p>
    </section>
  );
}
