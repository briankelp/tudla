import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  Minus,
  Crosshair,
  MapPin,
  Building2,
  Github,
  Workflow,
} from "lucide-react";
import { fitChecks } from "@lead/contracts";
import { BrandMark } from "./BrandMark";
import { BusinessAvatar } from "./BusinessAvatar";
import { ProspectTable } from "./ProspectTable";
import { sampleState } from "./data";
import "./landing.css";

const repositoryUrl = "https://github.com/briankelp/tudla";
const contactUrl = "mailto:brianfallaria@gmail.com?subject=Tudla";

const steps = [
  {
    title: "Set up a campaign",
    text: "Choose a location, business type, and fit criteria.",
  },
  {
    title: "Add prospects",
    text: "Import a CSV or add businesses manually.",
  },
  {
    title: "Review and follow up",
    text: "Check sources, update stages, and save outreach notes.",
  },
];

function ProductPreview({ onExplore }: { onExplore: () => void }) {
  const [sample] = useState(sampleState);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(sample.prospects[1]?.id || "");
  const [view, setView] = useState("all");
  const prospects = sample.prospects.filter(
    (p) => view === "all" || p.stage === "Shortlisted",
  );
  const chosen = prospects.find((p) => p.id === active) || prospects[0];
  const campaign = sample.campaigns[0];
  if (!chosen || !campaign) return null;
  const checks = fitChecks(chosen.business, campaign);
  return (
    <section
      className="product-preview"
      id="product"
      aria-label="Interactive product preview"
    >
      <div className="preview-window" data-ui>
        <div className="preview-rail" aria-hidden="true">
          <BrandMark size={26} />
          <span className="preview-rail-active">
            <Building2 size={18} />
          </span>
          <Crosshair size={18} />
          <Workflow size={18} />
          <span className="preview-rail-avatar">S</span>
        </div>
        <div className="preview-body">
          <div className="preview-topbar">
            <span>Prospects</span>
            <button className="text-button" onClick={onExplore}>
              Open demo <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="preview-workspace">
            <div className="preview-list">
              <div className="preview-heading">
                <div>
                  <p className="preview-field-label">Campaign</p>
                  <h2>Clinics · Cebu</h2>
                </div>
                <span className="preview-category">
                  <MapPin size={12} aria-hidden="true" /> Cebu, Philippines
                </span>
              </div>
              <div className="preview-tabs" aria-label="Preview stages">
                <button
                  aria-pressed={view === "all"}
                  onClick={() => {
                    setView("all");
                    setSelected(new Set());
                  }}
                >
                  All prospects <span>{sample.prospects.length}</span>
                </button>
                <button
                  aria-pressed={view === "shortlisted"}
                  onClick={() => {
                    setView("shortlisted");
                    setSelected(new Set());
                  }}
                >
                  Shortlisted{" "}
                  <span>
                    {
                      sample.prospects.filter((p) => p.stage === "Shortlisted")
                        .length
                    }
                  </span>
                </button>
                {selected.size > 0 && (
                  <span className="preview-selection" role="status">
                    {selected.size} selected
                  </span>
                )}
              </div>
              <ProspectTable
                prospects={prospects}
                campaign={campaign}
                members={sample.members}
                selected={selected}
                setSelected={setSelected}
                active={chosen.id}
                onOpen={(p) => setActive(p.id)}
              />
            </div>
            <aside
              className="preview-research"
              aria-label={`Preview research for ${chosen.business.name}`}
            >
              <BusinessAvatar name={chosen.business.name} />
              <h3>{chosen.business.name}</h3>
              <p className="preview-business-category">
                {chosen.business.category}
              </p>
              <h4>Profile match</h4>
              <ul className="preview-checks">
                {checks.map((check, i) => (
                  <li key={i}>
                    {check.result === "match" ? (
                      <Check size={14} aria-hidden="true" />
                    ) : check.result === "mismatch" ? (
                      <Minus size={14} aria-hidden="true" />
                    ) : (
                      <CircleHelp size={14} aria-hidden="true" />
                    )}
                    <span>
                      {check.criterion}
                      <small>
                        {check.result === "match"
                          ? "Match"
                          : check.result === "mismatch"
                            ? "Mismatch"
                            : "Unknown"}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
              {chosen.notes && (
                <div className="preview-notes">
                  <h4>Notes</h4>
                  <p>{chosen.notes}</p>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Landing({
  onExplore,
  onSignIn,
  canSignIn,
  error,
}: {
  onExplore: () => void;
  onSignIn: () => void;
  canSignIn: boolean;
  error: string;
}) {
  return (
    <div className="landing">
      <a className="landing-skip" href="#main-content">
        Skip to content
      </a>
      <header className="landing-header landing-container">
        <a className="landing-brand" href="/" aria-label="Tudla home">
          <BrandMark size={32} />
          <span>
            Tudla<span className="brand-period">.</span>
          </span>
        </a>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#product">Preview</a>
          <a href="#how-it-works">How it works</a>
          <a href={repositoryUrl} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </nav>
        <div className="landing-header-actions">
          {canSignIn && (
            <button className="landing-sign-in" onClick={onSignIn}>
              Sign in
            </button>
          )}
          <button
            className="landing-button landing-button-small"
            onClick={onExplore}
          >
            Explore the demo <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {error && (
          <div className="landing-error landing-container" role="alert">
            {error}
          </div>
        )}
        <section
          className="landing-hero landing-container"
          aria-labelledby="landing-title"
        >
          <div className="landing-hero-copy">
            <h1 id="landing-title">
              Find businesses.
              <br />
              Build your shortlist.
            </h1>
          </div>
          <div className="landing-hero-aside">
            <p className="landing-intro">
              A prospecting workspace for researching businesses and managing
              outreach.
            </p>
            <div className="landing-hero-actions">
              <button className="landing-button" onClick={onExplore}>
                Explore the demo <ArrowRight size={17} aria-hidden="true" />
              </button>
              <a
                className="landing-text-link landing-source-link"
                href={repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Github size={16} aria-hidden="true" />
                View on GitHub
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </div>
            <p className="landing-demo-note">The demo uses sample data.</p>
          </div>
        </section>
        <div className="landing-container">
          <ProductPreview onExplore={onExplore} />
        </div>
        <section
          className="landing-workflow landing-container"
          id="how-it-works"
          aria-labelledby="workflow-title"
        >
          <h2 id="workflow-title">How it works</h2>
          <ol className="landing-steps" role="list">
            {steps.map(({ title, text }) => (
              <li className="landing-step" key={title}>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <a className="landing-brand" href="/" aria-label="Tudla home">
          <BrandMark size={25} />
          <span>
            Tudla<span className="brand-period">.</span>
          </span>
        </a>
        <nav className="landing-footer-links" aria-label="Project links">
          <a href={repositoryUrl} target="_blank" rel="noopener noreferrer">
            View on GitHub <ArrowUpRight size={13} aria-hidden="true" />
          </a>
          <a href={contactUrl}>Contact me</a>
          <a href="/privacy.html">Privacy</a>
        </nav>
      </footer>
    </div>
  );
}
