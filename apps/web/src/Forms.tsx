import { useEffect, useRef, useState } from "react";
import type PapaType from "papaparse";
import {
  CampaignInput,
  type CampaignFields,
  type Campaign,
  type Business,
  type Connection,
  type Provider,
} from "@lead/contracts";
import { parseBusinesses } from "./data";
const list = (value: string) => [
  ...new Set(
    value
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
export function CampaignForm({
  onSave,
  busy,
  initial,
  onChange,
  submitLabel = "Create campaign",
}: {
  onSave: (c: CampaignFields) => Promise<unknown>;
  busy: boolean;
  initial?: CampaignFields;
  onChange?: (fields: CampaignFields) => void;
  submitLabel?: string;
}) {
  const [validationError, setValidationError] = useState("");
  const blank: CampaignFields = {
    name: "",
    offer: "",
    categories: [],
    locations: [],
    requiredEvidence: [],
  };
  const [localFields, setLocalFields] = useState<CampaignFields>(
    initial ?? blank,
  );
  const [rawLists, setRawLists] = useState({
    categories: (initial ?? blank).categories.join(", "),
    locations: (initial ?? blank).locations.join(", "),
    requiredEvidence: (initial ?? blank).requiredEvidence.join(", "),
  });
  const lastEmitted = useRef<CampaignFields | undefined>(initial);
  const fields = initial && onChange ? initial : localFields;

  useEffect(() => {
    if (
      !initial ||
      JSON.stringify(initial) === JSON.stringify(lastEmitted.current)
    )
      return;
    setLocalFields(initial);
    setRawLists({
      categories: initial.categories.join(", "),
      locations: initial.locations.join(", "),
      requiredEvidence: initial.requiredEvidence.join(", "),
    });
    lastEmitted.current = initial;
  }, [initial]);

  const update = (key: keyof CampaignFields, value: string) => {
    const isList =
      key === "categories" || key === "locations" || key === "requiredEvidence";
    const parsed = isList ? list(value) : value;
    if (isList) setRawLists((current) => ({ ...current, [key]: value }));
    const next = {
      ...fields,
      [key]: parsed,
    };
    setLocalFields(next);
    lastEmitted.current = next;
    onChange?.(next);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const result = CampaignInput.safeParse({
          ...fields,
          categories: list(rawLists.categories),
          locations: list(rawLists.locations),
          requiredEvidence: list(rawLists.requiredEvidence),
        });
        if (!result.success) {
          setValidationError(
            result.error.issues[0]?.message || "Check the campaign values.",
          );
          return;
        }
        setValidationError("");
        void onSave(result.data);
      }}
    >
      {validationError && (
        <p className="form-error" role="alert">
          {validationError}
        </p>
      )}
      <label>
        Name
        <input
          name="name"
          value={fields.name}
          onChange={(e) => update("name", e.target.value)}
          required
          maxLength={100}
          placeholder="Clinics · Cebu"
        />
      </label>
      <label>
        What do you sell?
        <textarea
          name="offer"
          value={fields.offer}
          onChange={(e) => update("offer", e.target.value)}
          required
          maxLength={500}
          rows={2}
          placeholder="Appointment scheduling software"
        />
      </label>
      <div className="form-grid">
        <label>
          Business categories
          <input
            name="categories"
            value={rawLists.categories}
            onChange={(e) => update("categories", e.target.value)}
            maxLength={400}
            placeholder="Dental clinic, medical clinic"
          />
        </label>
        <label>
          Target locations
          <input
            name="locations"
            value={rawLists.locations}
            onChange={(e) => update("locations", e.target.value)}
            maxLength={400}
            placeholder="Cebu, Mandaue"
          />
        </label>
      </div>
      <label>
        Evidence to confirm
        <textarea
          name="evidence"
          value={rawLists.requiredEvidence}
          onChange={(e) => update("requiredEvidence", e.target.value)}
          rows={2}
          maxLength={800}
          placeholder="Appointment workflow confirmed"
        />
      </label>
      <p className="field-help">Separate multiple values with commas.</p>
      <div className="dialog-actions">
        <button className="button primary" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
export function SearchForm({
  campaign,
  onSearch,
  busy,
  demo,
}: {
  campaign: Campaign;
  onSearch: (query: string, limit: number) => Promise<void>;
  busy: boolean;
  demo: boolean;
}) {
  const [query, setQuery] = useState(
    `${campaign.categories[0] || "businesses"} in ${campaign.locations[0] || ""}`.trim(),
  );
  const [limit, setLimit] = useState(20);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSearch(query, limit);
      }}
    >
      <label>
        Business search
        <input
          required
          minLength={2}
          maxLength={200}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <label>
        Result limit
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        >
          <option value={10}>10 businesses</option>
          <option value={20}>20 businesses</option>
        </select>
      </label>
      <p className="field-help">
        {demo
          ? "Live discovery requires sign-in and a SerpApi connection. You can import a CSV in the sample workspace."
          : "Uses one SerpApi search request. Returns available businesses up to the selected limit."}
      </p>
      <div className="dialog-actions">
        <button className="button primary" disabled={busy || demo}>
          Search businesses
        </button>
      </div>
    </form>
  );
}
export function ImportForm({
  onImport,
  busy,
}: {
  onImport: (b: Business[]) => Promise<void>;
  busy: boolean;
}) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [error, setError] = useState("");
  async function load(file: File) {
    setError("");
    setBusinesses([]);
    if (file.size > 1_000_000) {
      setError("Choose a CSV smaller than 1 MB.");
      return;
    }
    try {
      const Papa: typeof PapaType = (await import("papaparse")).default;
      const result = Papa.parse<Record<string, string>>(await file.text(), {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
      });
      if (result.errors.length)
        throw Error(
          "The CSV contains invalid rows. Check delimiters and quotation marks.",
        );
      if (result.data.length > 200)
        throw Error("Import up to 200 businesses at a time.");
      if (!result.data.length) throw Error("The CSV has no business rows.");
      setBusinesses(parseBusinesses(result.data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The CSV could not be read.");
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onImport(businesses);
      }}
    >
      <label>
        CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(file);
          }}
        />
      </label>
      <p className="field-help">
        Columns: Business or Company Name, Category, Address, Phone, Website.
        Review the records before importing.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {businesses.length > 0 && (
        <>
          <p className="preview-count">
            {businesses.length}{" "}
            {businesses.length === 1 ? "business" : "businesses"} ready to
            import
          </p>
          <div className="import-preview">
            <table>
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {businesses.slice(0, 8).map((b, i) => (
                  <tr key={i}>
                    <td>{b.name}</td>
                    <td>{b.address || "Not listed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {businesses.length > 8 && (
            <p className="field-help">Showing the first 8 records.</p>
          )}
        </>
      )}
      <div className="dialog-actions">
        <button
          className="button primary"
          disabled={busy || !businesses.length}
        >
          Import {businesses.length || ""}{" "}
          {businesses.length === 1 ? "business" : "businesses"}
        </button>
      </div>
    </form>
  );
}
export function ProviderConnection({
  provider,
  connection,
  onSave,
  onRemove,
  onTest,
  disabled,
  busy,
}: {
  provider: Provider;
  connection: Connection | undefined;
  onSave: (key: string, allowMembers: boolean) => Promise<boolean | void>;
  onRemove: () => Promise<unknown>;
  onTest: () => Promise<void>;
  disabled: boolean;
  busy: boolean;
}) {
  const [key, setKey] = useState("");
  const [shared, setShared] = useState(connection?.allowMembers || false);
  const [saveFailed, setSaveFailed] = useState(false);
  return (
    <form
      className="connection-row"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaveFailed(false);
        try {
          const result = await onSave(key, shared);
          if (result === false) setSaveFailed(true);
          else setKey("");
        } catch {
          setSaveFailed(true);
        }
      }}
    >
      <div className="connection-description">
        <h3>
          {
            {
              serpapi: "SerpApi",
              groq: "Groq",
              google: "Google AI",
              compatible: "Compatible API",
              firecrawl: "Firecrawl",
            }[provider]
          }
        </h3>
        <p>
          {
            {
              serpapi: "Business discovery",
              groq: "Campaign drafting and research analysis",
              google: "Campaign drafting and research analysis",
              compatible: "Campaign drafting and research analysis",
              firecrawl: "Website research",
            }[provider]
          }
        </p>
        <span className="connection-status">
          {connection ? `Connected · ${connection.mask}` : "Not connected"}
        </span>
      </div>
      <div className="connection-controls">
        <label>
          {connection ? "Replace API key" : "API key"}
          <input
            type="password"
            autoComplete="off"
            value={key}
            minLength={8}
            maxLength={1000}
            onChange={(e) => {
              setKey(e.target.value);
              setSaveFailed(false);
            }}
            disabled={disabled}
            placeholder={
              connection ? "Enter a replacement key" : "Enter your provider key"
            }
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={shared}
            disabled={disabled}
            onChange={(e) => {
              setShared(e.target.checked);
              setSaveFailed(false);
            }}
          />
          Allow workspace members to use this key
        </label>
        <div className="inline-actions">
          <button
            className="button"
            disabled={busy || disabled || key.length < 8}
          >
            Save connection
          </button>
          {connection && (
            <>
              <button
                className="button"
                type="button"
                disabled={busy || disabled}
                onClick={() => void onTest()}
              >
                Test
              </button>
              <button
                className="text-button destructive"
                type="button"
                disabled={busy || disabled}
                onClick={() => void onRemove()}
              >
                Remove
              </button>
            </>
          )}
        </div>
        {saveFailed && (
          <p className="form-error" role="alert">
            Connection was not saved. Check the provider details and try again.
          </p>
        )}
        {provider === "firecrawl" && connection && (
          <p className="field-help">
            Testing fetches example.com and can use one provider credit.
          </p>
        )}
      </div>
    </form>
  );
}
