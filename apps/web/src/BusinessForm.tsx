import { useState } from "react";
import { BusinessInput, type Business } from "@lead/contracts";

export function BusinessForm({
  initial,
  busy,
  onSave,
}: {
  initial?: Business;
  busy: boolean;
  onSave: (business: Business) => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const result = BusinessInput.safeParse({
          ...initial,
          ...Object.fromEntries(new FormData(event.currentTarget)),
        });
        if (!result.success) {
          setError(
            result.error.issues[0]?.message || "Check the business details.",
          );
          return;
        }
        setError("");
        void onSave(result.data);
      }}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {(
        [
          ["name", "Business name", 200],
          ["category", "Category", 200],
          ["address", "Address", 500],
          ["phone", "Phone", 100],
          ["email", "Email", 254],
          ["website", "Website", 2000],
        ] as const
      ).map(([name, label, maxLength]) => (
        <label key={name}>
          {label}
          <input
            name={name}
            type={
              name === "email" ? "email" : name === "phone" ? "tel" : "text"
            }
            defaultValue={initial?.[name] || ""}
            required={name === "name"}
            maxLength={maxLength}
          />
        </label>
      ))}
      <div className="dialog-actions">
        <button className="button primary" disabled={busy}>
          {initial ? "Save business" : "Add business"}
        </button>
      </div>
    </form>
  );
}
