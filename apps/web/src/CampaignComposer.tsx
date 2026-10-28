import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CampaignDraft,
  CampaignFields,
  DraftRequest,
} from "@lead/contracts";
import { CampaignForm } from "./Forms";
import "./ai-ui.css";

const emptyFields = (): CampaignFields => ({
  name: "",
  offer: "",
  categories: [],
  locations: [],
  requiredEvidence: [],
});
type SavedComposer = {
  brief: string;
  answers: string;
  fields: CampaignFields;
  draftId?: string;
  appliedDraftId?: string;
  pendingRequest?: DraftRequest;
};
const active = (draft?: CampaignDraft | null) =>
  Boolean(draft && ["queued", "running", "pending"].includes(draft.status));

export function CampaignComposer({
  onSave,
  busy,
  demo,
  storageKey,
  configured,
  requestDraft,
  getDraft,
  cancelDraft,
  latestDraft,
  onConnect,
}: {
  onSave: (fields: CampaignFields, draftId?: string) => Promise<boolean>;
  busy: boolean;
  demo: boolean;
  storageKey: string;
  configured: boolean;
  requestDraft: (input: DraftRequest) => Promise<CampaignDraft>;
  getDraft: (id: string) => Promise<CampaignDraft>;
  cancelDraft: (draft: CampaignDraft) => Promise<void>;
  latestDraft?: CampaignDraft;
  onConnect?: () => void;
}) {
  const [brief, setBrief] = useState("");
  const [answers, setAnswers] = useState("");
  const [fields, setFields] = useState<CampaignFields>(emptyFields);
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [pendingRequest, setPendingRequest] = useState<DraftRequest | null>(
    null,
  );
  const [appliedDraftId, setAppliedDraftId] = useState<string>();
  const [busyRequest, setBusyRequest] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const skipNextPersist = useRef(false);
  const latestSeen = useRef<string | undefined>(undefined);
  const localContentExists = useRef(false);
  const draftFields = draft?.result?.fields;
  const canGenerate =
    brief.trim().length >= 12 &&
    brief.trim().length <= 4000 &&
    !busyRequest &&
    !saving &&
    !active(draft);

  useEffect(() => {
    let cancelled = false;
    const restore = (value: CampaignDraft, hasLocalContent: boolean) => {
      if (cancelled) return;
      setDraft(value);
      if (!hasLocalContent && !localContentExists.current) {
        setBrief(value.brief);
        setAnswers(value.answers);
      }
    };
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as SavedComposer;
        const hasLocalContent = Boolean(
          parsed.brief ||
          parsed.answers ||
          parsed.draftId ||
          parsed.appliedDraftId ||
          parsed.pendingRequest ||
          parsed.fields?.name ||
          parsed.fields?.offer ||
          parsed.fields?.categories?.length ||
          parsed.fields?.locations?.length ||
          parsed.fields?.requiredEvidence?.length,
        );
        localContentExists.current = hasLocalContent;
        setBrief(parsed.brief || "");
        setAnswers(parsed.answers || "");
        setFields(parsed.fields || emptyFields());
        setAppliedDraftId(parsed.appliedDraftId);
        setPendingRequest(parsed.pendingRequest || null);
        if (parsed.pendingRequest) {
          void getDraft(parsed.pendingRequest.requestId)
            .then((value) => {
              restore(value, hasLocalContent);
              if (!cancelled) setPendingRequest(null);
            })
            .catch(async () => {
              if (parsed.draftId) {
                try {
                  restore(await getDraft(parsed.draftId), hasLocalContent);
                } catch {
                  if (!cancelled)
                    setError(
                      "An earlier draft request may still be processing. Retry to safely check the same request.",
                    );
                }
              } else if (!cancelled) {
                setError(
                  "An earlier draft request may still be processing. Retry to safely check the same request.",
                );
              }
            });
        } else if (parsed.draftId) {
          void getDraft(parsed.draftId)
            .then((value) => {
              restore(value, hasLocalContent);
            })
            .catch(() => {
              if (!cancelled)
                setError(
                  "The saved AI draft could not be restored. Your campaign details are still here.",
                );
            });
        } else if (latestDraft) {
          latestSeen.current = latestDraft.id;
          restore(latestDraft, hasLocalContent);
        }
      } else if (latestDraft) {
        latestSeen.current = latestDraft.id;
        restore(latestDraft, false);
      }
    } catch {
      setError(
        "Saved draft details could not be read. You can continue with the campaign form.",
      );
    } finally {
      setRestored(true);
    }
    return () => {
      cancelled = true;
    };
    // Restore only when this composer is first mounted for its storage key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!latestDraft || latestSeen.current === latestDraft.id) return;
    latestSeen.current = latestDraft.id;
    const hasEdits =
      localContentExists.current ||
      Boolean(
        brief ||
        answers ||
        draft ||
        fields.name ||
        fields.offer ||
        fields.categories.length ||
        fields.locations.length ||
        fields.requiredEvidence.length ||
        pendingRequest,
      );
    if (!hasEdits) {
      setDraft(latestDraft);
      setBrief(latestDraft.brief);
      setAnswers(latestDraft.answers);
    }
  }, [latestDraft, brief, answers, draft, fields, pendingRequest]);

  useEffect(() => {
    if (!restored) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* storage may be unavailable */
      }
      return;
    }
    const saved: SavedComposer = {
      brief,
      answers,
      fields,
      draftId: draft?.id,
      appliedDraftId,
      pendingRequest: pendingRequest || undefined,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      /* storage may be unavailable */
    }
  }, [
    restored,
    storageKey,
    brief,
    answers,
    fields,
    draft?.id,
    appliedDraftId,
    pendingRequest,
  ]);

  useEffect(() => {
    if (!active(draft) || !draft) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      try {
        const next = await getDraft(draft.id);
        if (cancelled) return;
        failures = 0;
        setError("");
        setDraft(next);
        if (active(next)) timer = setTimeout(poll, 2000);
      } catch {
        if (!cancelled) {
          failures += 1;
          setError(
            "Could not refresh the AI draft. It may still be processing; try again shortly.",
          );
          if (failures < 4) timer = setTimeout(poll, 4000);
        }
      }
    };
    timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft?.id, draft?.status, getDraft]);

  const previewFields = useMemo(() => draftFields, [draftFields]);
  const generate = async () => {
    setError("");
    setBusyRequest(true);
    try {
      const candidateContent = {
        brief: brief.trim(),
        answers: answers.trim(),
        current: fields,
        ...(draft?.id || pendingRequest?.parentId
          ? { parentId: draft?.id || pendingRequest?.parentId }
          : {}),
      };
      const { requestId: _previousRequestId, ...pendingContent } =
        pendingRequest || { requestId: "", ...candidateContent };
      const isSameRequest =
        pendingRequest &&
        JSON.stringify(pendingContent) === JSON.stringify(candidateContent);
      const input: DraftRequest = isSameRequest
        ? pendingRequest
        : { ...candidateContent, requestId: crypto.randomUUID() };
      setPendingRequest(input);
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            brief,
            answers,
            fields,
            draftId: draft?.id,
            appliedDraftId,
            pendingRequest: input,
          } satisfies SavedComposer),
        );
      } catch {
        /* storage may be unavailable */
      }
      const next = await requestDraft(input);
      setDraft(next);
      setPendingRequest(null);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "The AI draft could not be created. Try again.",
      );
    } finally {
      setBusyRequest(false);
    }
  };
  const useDraft = () => {
    if (!previewFields || !draft) return;
    localContentExists.current = true;
    setFields(previewFields);
    setAppliedDraftId(draft.id);
  };
  const startNew = () => {
    if (latestDraft) {
      latestSeen.current = latestDraft.id;
      localContentExists.current = true;
    }
    setBrief("");
    setAnswers("");
    setFields(emptyFields());
    setDraft(null);
    setPendingRequest(null);
    setAppliedDraftId(undefined);
    setError("");
  };
  const saveCampaign = async (values: CampaignFields) => {
    setSaving(true);
    try {
      const saved = await onSave(values, appliedDraftId);
      if (saved) {
        skipNextPersist.current = true;
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* storage may be unavailable */
        }
        setBrief("");
        setAnswers("");
        setFields(emptyFields());
        setDraft(null);
        setPendingRequest(null);
        setAppliedDraftId(undefined);
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "The campaign could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="campaign-composer">
      <section className="ai-composer" aria-labelledby="draft-heading">
        <div className="ai-composer-heading">
          <div>
            <h2 id="draft-heading">
              {demo ? "Sample draft" : "Draft with AI"}
            </h2>
            <p>
              Describe your offer, target businesses, and what you want to
              confirm.
            </p>
          </div>
          {draft && (
            <button type="button" className="text-button" onClick={startNew}>
              Start new
            </button>
          )}
        </div>
        {!demo && !configured && (
          <p className="ai-composer-notice" role="status">
            Connect an AI provider to create a draft. You can still create a
            campaign manually.
            {onConnect && (
              <button type="button" className="text-button" onClick={onConnect}>
                Connect AI
              </button>
            )}
          </p>
        )}
        <label>
          Campaign brief
          <textarea
            rows={4}
            maxLength={4000}
            value={brief}
            onChange={(event) => {
              localContentExists.current = true;
              setBrief(event.target.value);
            }}
            placeholder="We sell appointment scheduling software to independent clinics in Cebu. Find clinics with an online booking workflow we can improve."
          />
        </label>
        <p className="field-help">
          At least 12 characters. {brief.length}/4000
        </p>
        {Boolean(draft?.result?.questions.length) && (
          <label>
            Answers to AI questions
            <textarea
              rows={3}
              maxLength={2000}
              value={answers}
              onChange={(event) => {
                localContentExists.current = true;
                setAnswers(event.target.value);
              }}
              placeholder="Add any missing details here."
            />
          </label>
        )}
        <div className="inline-actions">
          <button
            type="button"
            className="button primary"
            disabled={!canGenerate || (!demo && !configured)}
            onClick={() => void generate()}
          >
            {busyRequest
              ? "Requesting draft…"
              : draft
                ? "Update draft"
                : "Generate draft"}
          </button>
          {active(draft) && draft && (
            <>
              {error && (
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    void getDraft(draft.id)
                      .then((value) => {
                        setDraft(value);
                        setError("");
                      })
                      .catch(() =>
                        setError(
                          "The draft status could not be refreshed. Reopen this form to try again.",
                        ),
                      )
                  }
                >
                  Check status
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={() =>
                  void cancelDraft(draft)
                    .then(() =>
                      setDraft({
                        ...draft,
                        status: "cancelled",
                        message: "Draft cancelled.",
                      }),
                    )
                    .catch(() => setError("The draft could not be cancelled."))
                }
              >
                Cancel draft
              </button>
            </>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {draft && (
          <DraftPreview draft={draft} fields={previewFields} onUse={useDraft} />
        )}
      </section>
      <section
        className="campaign-editor"
        aria-labelledby="campaign-fields-heading"
      >
        <h2 id="campaign-fields-heading">Campaign details</h2>
        <CampaignForm
          key={appliedDraftId || "manual"}
          initial={fields}
          onChange={(next) => {
            localContentExists.current = true;
            setFields(next);
          }}
          onSave={saveCampaign}
          busy={busy || saving}
        />
      </section>
    </div>
  );
}

function DraftPreview({
  draft,
  fields,
  onUse,
}: {
  draft: CampaignDraft;
  fields?: CampaignFields;
  onUse: () => void;
}) {
  const isReady = draft.result?.status === "ready";
  return (
    <div className="ai-draft-preview" aria-live="polite">
      <p className="ai-draft-status" role="status">
        {draft.message ||
          (active(draft)
            ? "Draft is processing."
            : isReady
              ? "Draft is ready."
              : "Draft needs more information.")}
      </p>
      {draft.result?.questions.length ? (
        <div>
          <h3>Questions</h3>
          <ul>
            {draft.result.questions.slice(0, 3).map((question, index) => (
              <li key={`${index}-${question}`}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {draft.result?.assumptions.length ? (
        <div>
          <h3>Assumptions</h3>
          <ul>
            {draft.result.assumptions.slice(0, 5).map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {fields && (
        <div className="ai-field-preview">
          <h3>Draft fields</h3>
          <dl>
            <dt>Name</dt>
            <dd>{fields.name || "Not set yet"}</dd>
            <dt>Offer</dt>
            <dd>{fields.offer || "Not set yet"}</dd>
            <dt>Business categories</dt>
            <dd>{fields.categories.join(", ") || "Not set yet"}</dd>
            <dt>Target locations</dt>
            <dd>{fields.locations.join(", ") || "Not set yet"}</dd>
            <dt>Evidence to confirm</dt>
            <dd>{fields.requiredEvidence.join(", ") || "Not set yet"}</dd>
          </dl>
        </div>
      )}
      {fields && (
        <button
          type="button"
          className="button"
          disabled={active(draft)}
          onClick={onUse}
        >
          Use draft in campaign form
        </button>
      )}
    </div>
  );
}
