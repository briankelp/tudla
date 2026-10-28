import { useEffect, useRef, useState } from "react";
import { BusinessAvatar } from "./BusinessAvatar";
import { NotesEditor } from "./NotesEditor";
import { OutreachComposer } from "./OutreachComposer";
import {
  X,
  ExternalLink,
  Check,
  Minus,
  HelpCircle,
  FileText,
  Mail,
  Phone,
  Pencil,
} from "lucide-react";
import {
  safeWebsite,
  fitChecks,
  stages,
  type Prospect,
  type Campaign,
  type Member,
} from "@lead/contracts";
export function Detail({
  prospect: p,
  campaign,
  members,
  onClose,
  onSave,
  onEdit,
  onDelete,
  onDirtyChange,
  busy,
  demo,
}: {
  prospect: Prospect;
  campaign: Campaign | undefined;
  members: Member[];
  onClose: () => void;
  onSave: (values: Partial<Prospect>) => Promise<boolean>;
  onEdit: () => void;
  onDelete: () => void;
  onDirtyChange: (dirty: boolean) => void;
  busy: boolean;
  demo: boolean;
}) {
  const [tab, setTab] = useState("research");
  const [notesDirty, setNotesDirty] = useState(false);
  const [emailDirty, setEmailDirty] = useState(false);
  useEffect(
    () => onDirtyChange(notesDirty || emailDirty),
    [notesDirty, emailDirty, onDirtyChange],
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);
  const checks =
    p.analysis?.assessments ||
    (campaign ? fitChecks(p.business, campaign) : []);
  return (
    <aside
      className="research-panel"
      aria-label={`Research for ${p.business.name}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="panel-head">
        <span className="eyebrow">Research</span>
        <button
          ref={closeRef}
          className="icon-button"
          aria-label="Close research panel"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <BusinessAvatar name={p.business.name} />
      <h2>{p.business.name}</h2>
      <p className="secondary">
        {p.business.category || "Category not listed"}
      </p>
      <div className="inline-actions" aria-label="Contact business">
        {p.business.email && (
          <a
            className="button"
            href={`mailto:${encodeURIComponent(p.business.email)}`}
          >
            <Mail size={13} />
            Email
          </a>
        )}
        {/^[+]?\d{3,20}$/.test(p.business.phone.replace(/[\s()-]/g, "")) && (
          <a
            className="button"
            href={`tel:${p.business.phone.replace(/[\s()-]/g, "")}`}
          >
            <Phone size={13} />
            Call
          </a>
        )}
        {(safeWebsite(p.business.sourceUrl) ||
          safeWebsite(p.business.website)) && (
          <a
            className="button"
            href={
              safeWebsite(p.business.sourceUrl) ||
              safeWebsite(p.business.website)
            }
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={13} />
            Open page
          </a>
        )}
        <button className="text-button" onClick={onEdit}>
          <Pencil size={13} />
          Edit business
        </button>
        <button
          className="text-button destructive"
          disabled={busy}
          onClick={onDelete}
        >
          Delete prospect
        </button>
      </div>
      <div className="panel-fields">
        <label>
          Stage
          <select
            value={p.stage}
            disabled={busy}
            onChange={(e) =>
              void onSave({ stage: e.target.value as Prospect["stage"] })
            }
          >
            {stages.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <select
            value={p.assignedTo || ""}
            disabled={busy}
            onChange={(e) =>
              void onSave({ assignedTo: e.target.value || null })
            }
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option value={m.userId} key={m.userId}>
                {m.email}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="panel-tabs" role="tablist" aria-label="Prospect details">
        {["research", "notes", "email"].map((value) => (
          <button
            key={value}
            id={`tab-${value}`}
            role="tab"
            aria-selected={tab === value}
            aria-controls={`panel-${value}`}
            onClick={() => setTab(value)}
          >
            {value === "research"
              ? "Research"
              : value === "notes"
                ? "Notes & follow-up"
                : "Email"}
          </button>
        ))}
      </div>
      <div
        id="panel-research"
        role="tabpanel"
        aria-labelledby="tab-research"
        hidden={tab !== "research"}
      >
        <section>
          <h3>Listing details</h3>
          <dl className="facts">
            <div>
              <dt>Address</dt>
              <dd>{p.business.address || "Not listed"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{p.business.phone || "Not listed"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{p.business.email || "Not listed"}</dd>
            </div>
            <div>
              <dt>Website</dt>
              <dd>
                {safeWebsite(p.business.website) ? (
                  <a
                    href={safeWebsite(p.business.website)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {new URL(safeWebsite(p.business.website)).hostname}
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  "Not listed in source"
                )}
              </dd>
            </div>
            {p.business.rating !== null && (
              <div>
                <dt>Rating</dt>
                <dd>
                  {p.business.rating} / 5 · {p.business.reviews ?? "Unknown"}{" "}
                  reviews
                </dd>
              </div>
            )}
          </dl>
          <p className="source-line">
            {p.facts[0]?.source || "Imported record"} ·{" "}
            {new Date(
              p.facts[0]?.observedAt || p.createdAt,
            ).toLocaleDateString()}
          </p>
        </section>
        <section>
          <h3>Profile match</h3>
          <ul className="criteria">
            {checks.map((c, i) => (
              <li key={`${c.criterion}-${i}`}>
                {c.result === "match" ? (
                  <Check size={15} />
                ) : c.result === "mismatch" ? (
                  <Minus size={15} />
                ) : (
                  <HelpCircle size={15} />
                )}
                <span>
                  {c.criterion}
                  <small>
                    {c.result === "unknown"
                      ? "Not confirmed"
                      : c.result === "match"
                        ? "Matches"
                        : "Does not match"}
                  </small>
                </span>
              </li>
            ))}
          </ul>
          {!checks.length && (
            <p className="secondary">Set campaign criteria to assess fit.</p>
          )}
        </section>
        <section>
          <h3>
            {demo ? "Sample research" : "AI research"}
            <span className="small-label">
              {p.analysisStatus === "completed" ? "Draft" : ""}
            </span>
          </h3>
          {p.analysis ? (
            <>
              <p className="analysis-summary">{p.analysis.summary}</p>
              {p.analysis.unknowns.length > 0 && (
                <div className="unknowns">
                  <h4>Still to confirm</h4>
                  <ul>
                    {p.analysis.unknowns.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}
              <h4>Next question</h4>
              <p>{p.analysis.nextQuestion}</p>
            </>
          ) : (
            <p className="secondary">
              {p.analysisError ||
                (p.analysisStatus === "outdated"
                  ? "Details changed. Analyze this prospect again to update its research."
                  : "Select this prospect and choose Analyze to prepare a research brief.")}
            </p>
          )}
        </section>
        <section>
          <h3>Sources</h3>
          {(p.analysis && p.analysisFacts?.length
            ? p.analysisFacts
            : p.facts
          ).map((f) => (
            <details className="source-detail" key={f.id}>
              <summary>
                <FileText size={13} />
                {f.label}
              </summary>
              <p>{f.value}</p>
              <small>
                {f.source} · {new Date(f.observedAt).toLocaleDateString()}
              </small>
              {safeWebsite(f.url) && (
                <a href={safeWebsite(f.url)} target="_blank" rel="noreferrer">
                  Open source <ExternalLink size={12} />
                </a>
              )}
            </details>
          ))}
        </section>
      </div>
      <div
        id="panel-notes"
        role="tabpanel"
        aria-labelledby="tab-notes"
        hidden={tab !== "notes"}
      >
        <NotesEditor
          prospect={p}
          busy={busy}
          onSave={onSave}
          onDirtyChange={setNotesDirty}
        />
      </div>
      <div
        id="panel-email"
        role="tabpanel"
        aria-labelledby="tab-email"
        hidden={tab !== "email"}
      >
        <OutreachComposer
          prospect={p}
          campaign={campaign}
          initial={p.emailDraft}
          busy={busy}
          onSave={(emailDraft) => onSave({ emailDraft })}
          onDirtyChange={setEmailDirty}
        />
      </div>
    </aside>
  );
}
