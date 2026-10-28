import { useEffect, useState } from "react";
import type { Prospect } from "@lead/contracts";

export type NotesEditorValues = {
  notes: string;
  feedback: string;
  followUpOn: string | null;
};

export function NotesEditor({
  prospect,
  busy,
  onSave,
  onDirtyChange,
}: {
  prospect: Prospect;
  busy: boolean;
  onSave: (values: NotesEditorValues) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const initial = {
    notes: prospect.notes,
    feedback: prospect.feedback,
    followUpOn: prospect.followUpOn ?? "",
  };
  const [saved, setSaved] = useState(initial);
  const [notes, setNotes] = useState(initial.notes);
  const [feedback, setFeedback] = useState(initial.feedback);
  const [followUpOn, setFollowUpOn] = useState(initial.followUpOn);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const dirty =
    notes !== saved.notes ||
    feedback !== saved.feedback ||
    followUpOn !== saved.followUpOn;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function save() {
    if (!dirty || busy || saving) return;
    const values = {
      notes,
      feedback,
      followUpOn: followUpOn || null,
    };
    setSaving(true);
    setMessage("");
    try {
      if (!(await onSave(values))) {
        setMessage("Could not save. Your edits are still here; try again.");
        return;
      }
      setSaved({ ...values, followUpOn: values.followUpOn ?? "" });
      setMessage("Notes saved.");
    } catch {
      setMessage("Could not save. Your edits are still here; try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="notes-editor">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Rep notes
          <textarea
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setMessage("");
            }}
            maxLength={5000}
            rows={4}
            disabled={busy || saving}
          />
        </label>
        <label>
          Next follow-up
          <input
            type="date"
            value={followUpOn}
            onChange={(event) => {
              setFollowUpOn(event.target.value);
              setMessage("");
            }}
            disabled={busy || saving}
          />
        </label>
        <label>
          Assessment feedback
          <textarea
            value={feedback}
            onChange={(event) => {
              setFeedback(event.target.value);
              setMessage("");
            }}
            maxLength={1000}
            rows={2}
            placeholder="What should be corrected?"
            disabled={busy || saving}
          />
        </label>
        <div className="notes-editor-actions">
          <button className="button" disabled={busy || saving || !dirty}>
            Save notes
          </button>
          <span className="field-help" aria-live="polite">
            {message || (dirty ? "Unsaved changes" : "Saved")}
          </span>
        </div>
        {message.startsWith("Could not save") && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
