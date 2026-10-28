import { useState } from "react";
import { llmProviders, type AISettings } from "@lead/contracts";
import "./ai-ui.css";

const defaultModels: Record<AISettings["provider"], string> = {
  groq: "openai/gpt-oss-20b",
  google: "gemini-2.5-flash",
  compatible: "",
};

export function AISettingsForm({
  settings,
  disabled,
  busy,
  compatibleAvailable,
  onSave,
}: {
  settings: AISettings;
  disabled: boolean;
  busy: boolean;
  compatibleAvailable: boolean;
  onSave: (settings: AISettings) => Promise<boolean | void>;
}) {
  const [provider, setProvider] = useState(settings.provider);
  const [model, setModel] = useState(settings.model);
  const [responseMode, setResponseMode] = useState(settings.responseMode);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const chooseProvider = (next: AISettings["provider"]) => {
    setProvider(next);
    setModel(defaultModels[next]);
    setSaved(false);
    setSaveFailed(false);
  };
  return (
    <form
      className="ai-settings-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaved(false);
        setSaveFailed(false);
        try {
          const result = await onSave({
            provider,
            model: model.trim(),
            responseMode,
          });
          if (result === false) setSaveFailed(true);
          else setSaved(true);
        } catch {
          setSaveFailed(true);
        }
      }}
    >
      <label>
        AI provider
        <select
          value={provider}
          disabled={disabled || busy}
          onChange={(event) =>
            chooseProvider(event.target.value as AISettings["provider"])
          }
        >
          {llmProviders.map((value) => (
            <option
              key={value}
              value={value}
              disabled={value === "compatible" && !compatibleAvailable}
            >
              {value === "groq"
                ? "Groq"
                : value === "google"
                  ? "Google AI"
                  : "Compatible API"}
              {value === "compatible" && !compatibleAvailable
                ? " · unavailable"
                : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model ID
        <input
          required
          maxLength={160}
          value={model}
          disabled={disabled || busy}
          onChange={(event) => {
            setModel(event.target.value);
            setSaved(false);
            setSaveFailed(false);
          }}
          placeholder="Enter the model ID"
        />
      </label>
      <details className="ai-settings-advanced">
        <summary>Advanced response format</summary>
        <label>
          Response format
          <select
            value={responseMode}
            disabled={disabled || busy}
            onChange={(event) => {
              setResponseMode(event.target.value as AISettings["responseMode"]);
              setSaved(false);
              setSaveFailed(false);
            }}
          >
            <option value="structured">Structured output</option>
            <option value="text">JSON text</option>
          </select>
        </label>
        <p className="field-help">
          Use JSON text if this model does not support structured output.
        </p>
      </details>
      <p className="field-help">
        Provider keys are saved separately in the provider connection below.
      </p>
      <div className="dialog-actions">
        <button
          className="button primary"
          disabled={disabled || busy || !model.trim()}
        >
          {busy ? "Saving…" : "Save AI settings"}
        </button>
        {saved && (
          <span className="field-help" role="status">
            Settings saved.
          </span>
        )}
        {saveFailed && (
          <span className="form-error" role="alert">
            Settings were not saved.
          </span>
        )}
      </div>
    </form>
  );
}
