import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
  ArrowUpRight,
} from "lucide-react";
import { BusinessAvatar } from "./BusinessAvatar";
import { isFollowUpDue } from "./followups";
import {
  fitChecks,
  type Prospect,
  type Campaign,
  type Member,
} from "@lead/contracts";
export function ProspectTable({
  prospects,
  campaign,
  members,
  selected,
  setSelected,
  active,
  onOpen,
  onResetFilters,
  emptyCampaign = false,
}: {
  prospects: Prospect[];
  campaign: Campaign | undefined;
  members: Member[];
  selected: Set<string>;
  setSelected: (value: Set<string>) => void;
  active: string | null;
  onOpen: (p: Prospect) => void;
  onResetFilters?: () => void;
  emptyCampaign?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const columns = useMemo<ColumnDef<Prospect>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <input
            type="checkbox"
            aria-label="Select visible prospects"
            checked={
              prospects.length > 0 && prospects.every((p) => selected.has(p.id))
            }
            ref={(el) => {
              if (el)
                el.indeterminate =
                  prospects.some((p) => selected.has(p.id)) &&
                  !prospects.every((p) => selected.has(p.id));
            }}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? new Set(prospects.map((p) => p.id))
                  : new Set(),
              )
            }
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.business.name}`}
            checked={selected.has(row.original.id)}
            onChange={() => toggle(row.original.id)}
          />
        ),
      },
      {
        id: "business",
        accessorFn: (p) => p.business.name,
        header: ({ column }) => (
          <button
            className="sort-button"
            onClick={() => column.toggleSorting()}
            aria-label="Sort by business"
          >
            Business{" "}
            {column.getIsSorted() === "asc" ? (
              <ArrowUp size={13} />
            ) : column.getIsSorted() === "desc" ? (
              <ArrowDown size={13} />
            ) : (
              <ArrowUpDown size={13} />
            )}
          </button>
        ),
        cell: ({ row }) => (
          <>
            <button
              className="company-button"
              data-prospect={row.original.id}
              onClick={() => onOpen(row.original)}
              aria-expanded={active === row.original.id}
            >
              <BusinessAvatar name={row.original.business.name} />
              <span>
                {row.original.business.name}
                <small>
                  {row.original.business.category || "Category not listed"}
                </small>
                {row.original.followUpOn && (
                  <small
                    className={
                      isFollowUpDue(row.original) ? "follow-up-due" : ""
                    }
                  >
                    Follow up {row.original.followUpOn}
                  </small>
                )}
              </span>
              <ArrowUpRight
                className="record-open-icon"
                size={14}
                aria-hidden="true"
              />
            </button>
          </>
        ),
      },
      {
        id: "location",
        accessorFn: (p) => p.business.address,
        header: "Location",
        cell: ({ row }) => (
          <span className="location-cell">
            {row.original.business.address || "Not listed"}
          </span>
        ),
      },
      {
        id: "fit",
        header: "Profile match",
        cell: ({ row }) => {
          const p = row.original;
          const checks =
            p.analysis?.assessments ||
            (campaign ? fitChecks(p.business, campaign) : []);
          return (
            <span className="fit-cell">
              {checks.filter((c) => c.result === "match").length} match
              <small
                className={
                  checks.some((c) => c.result === "mismatch")
                    ? "has-mismatch"
                    : ""
                }
              >
                {checks.filter((c) => c.result === "unknown").length} unknown
                {checks.some((c) => c.result === "mismatch")
                  ? " · mismatch"
                  : ""}
              </small>
            </span>
          );
        },
      },
      {
        accessorKey: "stage",
        header: "Stage",
        cell: ({ row }) => (
          <span
            className={`stage stage-${row.original.stage.toLowerCase().replaceAll(" ", "-")}`}
          >
            {row.original.stage}
          </span>
        ),
      },
      {
        id: "owner",
        header: "Owner",
        cell: ({ row }) => {
          const m = members.find((m) => m.userId === row.original.assignedTo);
          return (
            <span className="owner-cell">
              {m ? m.email.split("@")[0] : "Unassigned"}
            </span>
          );
        },
      },
    ],
    [prospects, selected, active, campaign, members],
  );
  const table = useReactTable({
    data: prospects,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <div className="table-scroll">
      <table className="prospect-table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  aria-sort={
                    header.column.getCanSort()
                      ? header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={`${active === row.original.id ? "active-row" : ""} ${selected.has(row.original.id) ? "selected-row" : ""}`}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!prospects.length && (
        <div className="table-empty">
          <Building2 size={24} />
          <h3>
            {emptyCampaign
              ? "No businesses in this campaign"
              : "No prospects match"}
          </h3>
          <p>
            {emptyCampaign
              ? "Find businesses or import a CSV to start your list."
              : "Try a different search or clear your filters."}
          </p>
          {!emptyCampaign && onResetFilters && (
            <button className="button" onClick={onResetFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
