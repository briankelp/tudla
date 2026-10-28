import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient, Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Building2,
  Crosshair,
  Plug,
  Users,
  Activity,
  Gauge,
  Workflow,
  Search,
  Plus,
  Upload,
  Download,
  Filter,
  X,
  ArrowRight,
  Check,
  RefreshCw,
  LogOut,
  ChevronRight,
  Bookmark,
  ArrowLeft,
  ListFilter,
  MapPin,
  Pencil,
  CalendarDays,
} from "lucide-react";
import {
  stages,
  campaignContext,
  listingFacts,
  type Campaign,
  type Prospect,
  type Business,
  type Job,
  type Provider,
  type Workspace,
  type CampaignFields,
  type CampaignDraft,
  type DraftRequest,
  type AISettings,
} from "@lead/contracts";
import {
  readDemo,
  storeDemo,
  sampleState,
  request,
  downloadCsv,
  importDemo,
  sampleAnalysis,
  type State,
  type PublicConfig,
  sampleCampaignDraft,
} from "./data";
import { ProspectTable } from "./ProspectTable";
import { Detail } from "./Detail";
import { Modal } from "./Modal";
import {
  CampaignForm,
  SearchForm,
  ImportForm,
  ProviderConnection,
} from "./Forms";
import { CampaignComposer } from "./CampaignComposer";
import { AISettingsForm } from "./AISettingsForm";
import { BrandMark } from "./BrandMark";
import { Landing } from "./Landing";
import { BusinessForm } from "./BusinessForm";
import { isFollowUpDue } from "./followups";
type Page =
  "Prospects" | "Campaigns" | "Runs" | "Connections" | "Team" | "Usage";
type Dialog =
  | "deleteWorkspace"
  | "campaign"
  | "search"
  | "import"
  | "invite"
  | "workspace"
  | "business"
  | "editCampaign"
  | "editBusiness"
  | null;
type DeleteTarget =
  | { kind: "entries"; ids: string[]; names: string[]; wasDirty: boolean }
  | { kind: "campaign"; id: string; name: string; wasDirty: boolean };
export function App() {
  const cache = useQueryClient();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [auth, setAuth] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [showDemo, setShowDemo] = useState(() => location.hash === "#demo");
  const [workspaceId, setWorkspaceId] = useState("");
  const [page, setPage] = useState<Page>("Prospects");
  const [campaignId, setCampaignId] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [owner, setOwner] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dueOnly, setDueOnly] = useState(false);
  const [detailDirty, setDetailDirty] = useState(false);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const token = session?.access_token || "";
  const mode = token ? "live" : "demo";
  function leaveDetail(action: () => void) {
    if (detailDirty) setLeaveAction(() => action);
    else action();
  }
  useEffect(() => {
    if (!detailDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [detailDirty]);
  useEffect(() => {
    function syncDemo() {
      const next = location.hash === "#demo";
      if (next === showDemo) return;
      setShowDemo(next);
      window.scrollTo(0, 0);
      requestAnimationFrame(() =>
        document.getElementById("main-content")?.focus({ preventScroll: true }),
      );
    }
    window.addEventListener("hashchange", syncDemo);
    return () => window.removeEventListener("hashchange", syncDemo);
  }, [showDemo]);
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    const publicConfig: Promise<PublicConfig> = __SAMPLE_ONLY__
      ? Promise.resolve({
          authEnabled: false,
          supabaseUrl: "",
          publishableKey: "",
        })
      : fetch("/api/config").then((r) => {
          if (!r.ok)
            throw Error("The app could not connect. Refresh to try again.");
          return r.json();
        });
    publicConfig
      .then(async (c: PublicConfig) => {
        if (!alive) return;
        setConfig(c);
        if (!__SAMPLE_ONLY__ && c.authEnabled) {
          const { createClient } = await import("@supabase/supabase-js");
          if (!alive) return;
          const client = createClient(c.supabaseUrl, c.publishableKey, {
            auth: { flowType: "pkce" },
          });
          setAuth(client);
          client.auth.getSession().then(({ data, error }) => {
            if (error) setError("Sign-in could not be completed. Try again.");
            if (alive) setSession(data.session);
          });
          const listener = client.auth.onAuthStateChange((_event, s) => {
            if (alive) setSession(s);
          });
          unsubscribe = () => listener.data.subscription.unsubscribe();
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);
  const bootstrap = useQuery({
    queryKey: ["bootstrap", session?.user.id],
    enabled: !!token,
    queryFn: () =>
      request<{ workspaces: Workspace[]; user: { id: string; email: string } }>(
        "/bootstrap",
        token,
      ),
  });
  const workspaces = bootstrap.data?.workspaces || [];
  const currentWorkspace = workspaces.some((w) => w.id === workspaceId)
    ? workspaceId
    : workspaces[0]?.id || "";
  const dataKey = ["workspace", mode, currentWorkspace];
  const stateQuery = useQuery({
    queryKey: dataKey,
    enabled: mode === "demo" || !!currentWorkspace,
    queryFn: () =>
      mode === "demo"
        ? Promise.resolve(readDemo())
        : request<State>(`/workspaces/${currentWorkspace}`, token),
    refetchInterval: mode === "live" ? 5000 : false,
  });
  const state = stateQuery.data;
  const campaigns = state?.campaigns || [];
  const currentCampaign =
    campaigns.find((c) => c.id === campaignId) || campaigns[0];
  const campaign = currentCampaign;
  const apiBase = `/workspaces/${currentWorkspace}`;
  useEffect(() => {
    setSelected(new Set());
    setActive(null);
    setDetailDirty(false);
    setDialog(null);
    setDeleteTarget(null);
  }, [currentWorkspace, campaign?.id, mode]);
  useEffect(() => {
    if (!token) return;
    const invite = new URLSearchParams(location.search).get("invite");
    if (!invite || !/^[a-f0-9]{64}$/.test(invite)) return;
    void request<{ id: string }>("/invitations/accept", token, "POST", {
      token: invite,
    })
      .then((r) => {
        history.replaceState({}, "", location.pathname);
        setWorkspaceId(r.id);
        void cache.invalidateQueries({ queryKey: ["bootstrap"] });
        setNotice("Joined workspace");
      })
      .catch((e) => {
        history.replaceState({}, "", location.pathname);
        setError(e.message);
      });
  }, [token]);
  function updateDemo(next: State) {
    storeDemo(next);
    cache.setQueryData(dataKey, next);
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (mode === "live")
        await cache.invalidateQueries({
          queryKey: ["workspace", "live", currentWorkspace],
        });
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change could not be saved.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function patch(p: Prospect, values: Partial<Prospect>) {
    return perform(async () => {
      if (mode === "demo")
        updateDemo({
          ...state!,
          prospects: state!.prospects.map((row) =>
            row.id === p.id ? { ...row, ...values } : row,
          ),
        });
      else await request(`${apiBase}/entries/${p.id}`, token, "PATCH", values);
      setNotice("Saved");
    });
  }
  function requestEntryDelete(prospects: Prospect[]) {
    if (!prospects.length) return;
    const target = {
      kind: "entries" as const,
      ids: prospects.map((p) => p.id),
      names: prospects.map((p) => p.business.name),
      wasDirty: detailDirty,
    };
    const affectsActive = !!active && target.ids.includes(active);
    const open = () => {
      setDeleteTarget(target);
      setError("");
    };
    if (affectsActive) leaveDetail(open);
    else open();
  }
  function requestCampaignDelete(value: Campaign) {
    const affectsActive = value.id === campaign?.id && !!active;
    const open = () => {
      setDeleteTarget({
        kind: "campaign",
        id: value.id,
        name: value.name,
        wasDirty: detailDirty,
      });
      setError("");
    };
    if (affectsActive) leaveDetail(open);
    else open();
  }
  async function deleteRecords() {
    if (!deleteTarget || !state) return;
    const target = deleteTarget;
    const saved = await perform(async () => {
      if (target.kind === "entries") {
        if (mode === "demo")
          updateDemo({
            ...state,
            prospects: state.prospects.filter(
              (p) => !target.ids.includes(p.id),
            ),
          });
        else if (target.ids.length === 1)
          await request(`${apiBase}/entries/${target.ids[0]}`, token, "DELETE");
        else
          await request(`${apiBase}/entries`, token, "DELETE", {
            entryIds: target.ids,
          });
        setSelected(
          (current) =>
            new Set([...current].filter((id) => !target.ids.includes(id))),
        );
        if (active && target.ids.includes(active)) {
          setActive(null);
          setDetailDirty(false);
        }
        setDeleteTarget(null);
        setNotice(
          `${target.ids.length} prospect${target.ids.length === 1 ? "" : "s"} removed from this campaign`,
        );
      } else {
        if (mode === "demo")
          updateDemo({
            ...state,
            campaigns: state.campaigns.filter((c) => c.id !== target.id),
            prospects: state.prospects.filter(
              (p) => p.campaignId !== target.id,
            ),
            jobs: state.jobs.filter((j) => j.campaignId !== target.id),
            drafts: state.drafts.map((d) =>
              d.acceptedCampaignId === target.id
                ? { ...d, acceptedCampaignId: null }
                : d,
            ),
          });
        else
          await request(`${apiBase}/campaigns/${target.id}`, token, "DELETE");
        const remaining = state.campaigns.filter((c) => c.id !== target.id);
        if (campaign?.id === target.id) {
          setCampaignId(remaining[0]?.id || "");
          setActive(null);
          setSelected(new Set());
          setDetailDirty(false);
        }
        setDeleteTarget(null);
        setNotice(`Campaign “${target.name}” deleted`);
      }
    });
    if (!saved) setDetailDirty(target.wasDirty);
  }
  async function createCampaign(
    values: CampaignFields,
    draftId?: string,
  ): Promise<boolean> {
    let saved = false;
    await perform(async () => {
      const next =
        mode === "demo"
          ? {
              ...values,
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
            }
          : await request<Campaign>(
              draftId
                ? `${apiBase}/campaign-drafts/${draftId}/accept`
                : `${apiBase}/campaigns`,
              token,
              "POST",
              values,
            );
      if (mode === "demo")
        updateDemo({
          ...state!,
          campaigns: [next, ...state!.campaigns],
          drafts: state!.drafts.map((d) =>
            d.id === draftId
              ? { ...d, status: "accepted", acceptedCampaignId: next.id }
              : d,
          ),
        });
      setCampaignId(next.id);
      setDialog(null);
      setPage("Prospects");
      saved = true;
    });
    return saved;
  }
  const loadDraft = useCallback(
    async (id: string) => {
      if (mode === "live")
        return request<CampaignDraft>(
          `${apiBase}/campaign-drafts/${id}`,
          token,
        );
      const draft = readDemo().drafts.find((d) => d.id === id);
      if (!draft) throw Error("Draft not found.");
      return draft;
    },
    [mode, apiBase, token],
  );
  async function requestCampaignDraft(input: DraftRequest) {
    if (mode === "live") {
      const draft = await request<CampaignDraft>(
        `${apiBase}/campaign-drafts`,
        token,
        "POST",
        input,
      );
      void cache.invalidateQueries({ queryKey: dataKey });
      return draft;
    }
    const current = readDemo();
    const previous = current.drafts.find((d) => d.id === input.requestId);
    if (previous) return previous;
    const draft = sampleCampaignDraft(input);
    updateDemo({ ...current, drafts: [draft, ...current.drafts].slice(0, 20) });
    return draft;
  }
  async function cancelCampaignDraft(draft: CampaignDraft) {
    if (mode === "live" && draft.jobId)
      await request(`${apiBase}/jobs/${draft.jobId}/cancel`, token, "POST", {});
    else {
      const current = readDemo();
      updateDemo({
        ...current,
        drafts: current.drafts.map((d) =>
          d.id === draft.id
            ? { ...d, status: "cancelled", message: "Draft cancelled" }
            : d,
        ),
      });
    }
  }
  async function saveAISettings(settings: AISettings) {
    let saved = false;
    await perform(async () => {
      await request(`${apiBase}/ai-settings`, token, "PUT", settings);
      setNotice("AI settings saved");
      saved = true;
    });
    return saved;
  }
  async function editCampaign(values: CampaignFields) {
    if (!editingCampaign || !state) return;
    await perform(async () => {
      if (mode === "demo") {
        const changed =
          campaignContext(editingCampaign) !== campaignContext(values);
        updateDemo({
          ...state,
          campaigns: state.campaigns.map((c) =>
            c.id === editingCampaign.id ? { ...c, ...values } : c,
          ),
          prospects: state.prospects.map((p) =>
            changed && p.campaignId === editingCampaign.id
              ? {
                  ...p,
                  analysis: null,
                  analysisStatus: "outdated",
                  analysisError: null,
                }
              : p,
          ),
        });
      } else
        await request(
          `${apiBase}/campaigns/${editingCampaign.id}`,
          token,
          "PATCH",
          values,
        );
      setDialog(null);
      setNotice("Campaign saved");
    });
  }
  function openCampaignEditor(value: Campaign) {
    setEditingCampaign(value);
    setDialog("editCampaign");
  }
  async function importRows(businesses: Business[]) {
    if (!campaign) return;
    await perform(async () => {
      if (mode === "demo")
        updateDemo(importDemo(state!, campaign.id, businesses));
      else
        await request(`${apiBase}/import`, token, "POST", {
          campaignId: campaign.id,
          businesses,
        });
      setDialog(null);
      setNotice("Import complete");
    });
  }
  async function addBusiness(business: Business) {
    if (!campaign || !state) return;
    await perform(async () => {
      if (mode === "demo") {
        const next = importDemo(state, campaign.id, [business], "Manual entry");
        if (next.prospects.length === state.prospects.length)
          throw Error("This business is already in the campaign.");
        updateDemo(next);
      } else
        await request(`${apiBase}/entries`, token, "POST", {
          campaignId: campaign.id,
          business,
        });
      setDialog(null);
      setNotice("Business added");
    });
  }
  async function editBusiness(business: Business) {
    if (!chosen || !state) return;
    await perform(async () => {
      if (mode === "demo")
        updateDemo({
          ...state,
          prospects: state.prospects.map((p) =>
            p.businessId === chosen.businessId
              ? {
                  ...p,
                  business,
                  facts: listingFacts(
                    { ...business, sourceUrl: "" },
                    "Manual correction",
                    new Date().toISOString(),
                  ),
                  analysis: null,
                  analysisStatus: "outdated",
                  analysisError: null,
                }
              : p,
          ),
        });
      else
        await request(
          `${apiBase}/businesses/${chosen.businessId}`,
          token,
          "PUT",
          business,
        );
      setDialog(null);
      setNotice("Business saved");
    });
  }
  async function run(
    kind: "analysis" | "enrichment" | "discovery" | "connection_test",
    extra: Record<string, unknown> = {},
  ) {
    await perform(async () => {
      if (mode === "demo") {
        if (kind === "analysis" && campaign) {
          updateDemo({
            ...state!,
            prospects: state!.prospects.map((p) =>
              selected.has(p.id)
                ? {
                    ...p,
                    analysis: sampleAnalysis(p, campaign),
                    analysisStatus: "completed",
                  }
                : p,
            ),
          });
          setNotice("Sample research added");
          return;
        }
        throw Error("Sign in and connect a provider to run live research.");
      }
      await request<Job>(`${apiBase}/jobs`, token, "POST", {
        kind,
        ...(kind === "connection_test" ? {} : { campaignId: campaign!.id }),
        ...(["analysis", "enrichment"].includes(kind)
          ? { entryIds: [...selected] }
          : {}),
        ...extra,
      });
      setDialog(null);
      setNotice("Run queued");
    });
  }
  const filtered = useMemo(
    () =>
      state?.prospects.filter(
        (p) =>
          p.campaignId === campaign?.id &&
          (!dueOnly || isFollowUpDue(p)) &&
          (stage === "all" || p.stage === stage) &&
          (owner === "all" ||
            (owner === "unassigned"
              ? !p.assignedTo
              : p.assignedTo === owner)) &&
          [p.business.name, p.business.category, p.business.address, p.notes]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()),
      ) || [],
    [state, campaign, query, stage, owner, dueOnly],
  );
  const chosen = state?.prospects.find(
    (p) => p.id === active && p.campaignId === campaign?.id,
  );
  useEffect(() => {
    const visible = new Set(filtered.map((p) => p.id));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filtered]);
  const activeJobs =
    state?.jobs.filter((j) =>
      ["queued", "running", "paused"].includes(j.status),
    ) || [];
  const exported = selected.size
    ? filtered.filter((p) => selected.has(p.id))
    : filtered;
  async function exportRows() {
    await perform(async () => {
      if (mode === "live") {
        const response = await fetch(`/api${apiBase}/export`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ entryIds: exported.map((p) => p.id) }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw Error(error.message || "Export failed.");
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = "prospects.csv";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else downloadCsv(exported);
    });
  }
  function openProspect(p: Prospect) {
    if (p.id === active) return;
    leaveDetail(() => {
      setDetailDirty(false);
      setActive(p.id);
      if (innerWidth < 1150)
        setTimeout(
          () =>
            document.querySelector(".research-panel")?.scrollIntoView({
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
              block: "start",
            }),
          0,
        );
    });
  }
  async function signIn() {
    if (!auth) return;
    setError("");
    const invite = new URLSearchParams(location.search).get("invite");
    try {
      const { error } = await auth.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo:
            location.origin +
            (invite ? `/?invite=${encodeURIComponent(invite)}` : "/"),
        },
      });
      if (error) throw error;
    } catch {
      setError("Google sign-in could not start. Please try again.");
    }
  }
  const nav = [
    ["Prospects", Building2],
    ["Campaigns", Crosshair],
    ["Runs", Workflow],
    ["Connections", Plug],
    ["Team", Users],
    ["Usage", Gauge],
  ] as const;
  const campaignProspects =
    state?.prospects.filter((p) => p.campaignId === campaign?.id) || [];
  function resetFilters() {
    setStage("all");
    setOwner("all");
    setQuery("");
    setDueOnly(false);
    setSelected(new Set());
  }
  if (!config && !error)
    return (
      <div className="startup" role="status">
        Loading Tudla…
      </div>
    );
  if (!token && !showDemo)
    return (
      <Landing
        onExplore={() => {
          location.hash = "demo";
        }}
        onSignIn={() => void signIn()}
        canSignIn={!!auth}
        error={error}
      />
    );
  return (
    <div className={`app-shell ${sidebar ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Tudla home">
          <span className="brand-icon">
            <BrandMark size={25} />
          </span>
          <span>
            Tudla<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-picker">
          <span className="workspace-avatar">
            {mode === "demo" ? "S" : (state?.workspace.name || "W")[0]}
          </span>
          <div>
            {mode === "live" && workspaces.length > 1 ? (
              <select
                aria-label="Workspace"
                value={currentWorkspace}
                onChange={(e) => {
                  const value = e.target.value;
                  leaveDetail(() => setWorkspaceId(value));
                }}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{state?.workspace.name || "Workspace"}</strong>
            )}
            <small>
              {mode === "demo"
                ? "Demo mode"
                : state?.workspace.role || "Loading"}
            </small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <span className="nav-section-label">Workspace</span>
          {nav.map(([label, Icon]) => (
            <button
              key={label}
              aria-label={label === "Runs" ? "Research runs" : label}
              title={label === "Runs" ? "Research runs" : label}
              className={`${page === label ? "nav-item active" : "nav-item"} ${label === "Connections" ? "nav-section-start" : ""}`}
              aria-current={page === label ? "page" : undefined}
              onClick={() => {
                leaveDetail(() => {
                  setPage(label);
                  setActive(null);
                  setDetailDirty(false);
                });
              }}
            >
              <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
              <span>{label === "Runs" ? "Research runs" : label}</span>
              {label === "Runs" && activeJobs.length > 0 && (
                <span className="nav-count">{activeJobs.length}</span>
              )}
              {label === "Prospects" && campaignProspects.length > 0 && (
                <span className="nav-count">{campaignProspects.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {mode === "demo" ? (
            <>
              <span className="demo-dot" /> Changes stay in this browser
            </>
          ) : (
            <>
              <span className="demo-dot live" />
              {session?.user.email}
            </>
          )}
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button"
              aria-label={sidebar ? "Collapse navigation" : "Expand navigation"}
              onClick={() => setSidebar(!sidebar)}
            >
              {sidebar ? (
                <PanelLeftClose size={17} />
              ) : (
                <PanelLeftOpen size={17} />
              )}
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page === "Runs" ? "Research runs" : page}</strong>
          </div>
          <div className="topbar-actions">
            {mode === "demo" && (
              <span className="demo-badge">
                <span className="demo-dot" /> Demo workspace
              </span>
            )}
            {mode === "demo" && (
              <a
                className="text-button"
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  leaveDetail(() => {
                    setDetailDirty(false);
                    location.hash = "";
                  });
                }}
              >
                <ArrowLeft size={14} aria-hidden="true" /> Overview
              </a>
            )}
            {mode === "demo" && auth ? (
              <button className="button sign-in" onClick={() => void signIn()}>
                Sign in with Google <ArrowRight size={14} />
              </button>
            ) : mode === "live" ? (
              <button
                className="text-button"
                onClick={() =>
                  void auth?.auth.signOut().then(() => {
                    cache.removeQueries({ queryKey: ["workspace", "live"] });
                    setWorkspaceId("");
                    location.hash = "";
                  })
                }
              >
                <LogOut size={15} />
                Sign out
              </button>
            ) : null}
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-head">
            <div>
              <div className="eyebrow">
                {page === "Prospects" ? "Prospecting" : "Workspace"}
              </div>
              <h1>
                {page === "Runs" ? "Research runs" : page}
                {page === "Prospects" && (
                  <span className="heading-count">
                    {campaignProspects.length}
                  </span>
                )}
              </h1>
              {page === "Prospects" && (
                <div className="campaign-switch">
                  {campaigns.length ? (
                    <select
                      aria-label="Campaign"
                      value={campaign?.id}
                      onChange={(e) => {
                        const value = e.target.value;
                        leaveDetail(() => setCampaignId(value));
                      }}
                    >
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>No campaign selected</span>
                  )}
                </div>
              )}
            </div>
            <div className="page-actions">
              {page === "Prospects" && (
                <>
                  <button
                    className="button"
                    onClick={() =>
                      setDialog(campaign ? "business" : "campaign")
                    }
                  >
                    <Plus size={15} />
                    Add business
                  </button>
                  <button
                    className="button"
                    onClick={() => setDialog(campaign ? "import" : "campaign")}
                  >
                    <Upload size={15} />
                    Import CSV
                  </button>
                  <button
                    className="button primary"
                    onClick={() => setDialog(campaign ? "search" : "campaign")}
                  >
                    <Search size={16} aria-hidden="true" />
                    Find businesses
                  </button>
                </>
              )}
              {page === "Campaigns" && (
                <button
                  className="button primary"
                  onClick={() => setDialog("campaign")}
                >
                  <Plus size={16} />
                  New campaign
                </button>
              )}
              {page === "Team" &&
                mode === "live" &&
                state?.workspace.role !== "member" && (
                  <button
                    className="button primary"
                    onClick={() => setDialog("invite")}
                  >
                    <Plus size={16} />
                    Invite member
                  </button>
                )}
            </div>
          </div>
          {!dialog && (error || stateQuery.error || bootstrap.error) && (
            <div className="message error" role="alert">
              <span>
                {error || stateQuery.error?.message || bootstrap.error?.message}
              </span>
              <button
                className="icon-button"
                aria-label="Dismiss message"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <Check size={16} />
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!state ? (
            <div className="startup">
              {stateQuery.isError
                ? "Workspace unavailable. Refresh to try again."
                : "Loading records…"}
            </div>
          ) : (
            <>
              {page === "Prospects" && (
                <>
                  {campaign && (
                    <div className="campaign-brief">
                      <span className="campaign-offer">
                        <Crosshair size={15} aria-hidden="true" />
                        <span>
                          <small>Offer</small>
                          {campaign.offer}
                        </span>
                      </span>
                      {campaign.locations.length > 0 && (
                        <span className="campaign-location">
                          <MapPin size={14} aria-hidden="true" />
                          {campaign.locations.join(", ")}
                        </span>
                      )}
                      <details>
                        <summary>Profile criteria</summary>
                        <div>
                          <p>
                            <strong>Categories</strong>
                            {campaign.categories.join(", ") || "Any"}
                          </p>
                          <p>
                            <strong>Locations</strong>
                            {campaign.locations.join(", ") || "Any"}
                          </p>
                          <p>
                            <strong>To confirm</strong>
                            {campaign.requiredEvidence.join(", ") ||
                              "No additional criteria"}
                          </p>
                        </div>
                      </details>
                      <button
                        className="text-button"
                        onClick={() => openCampaignEditor(campaign)}
                      >
                        <Pencil size={13} />
                        Edit campaign
                      </button>
                      <button
                        className="text-button destructive"
                        disabled={busy}
                        onClick={() => requestCampaignDelete(campaign)}
                      >
                        Delete campaign
                      </button>
                    </div>
                  )}
                  {activeJobs.length > 0 && (
                    <div className="running-strip">
                      <Activity size={15} />
                      <button onClick={() => setPage("Runs")}>
                        {activeJobs[0]?.message} <span>View runs</span>
                      </button>
                    </div>
                  )}
                  <div className="prospect-workspace">
                    <div className="prospect-list">
                      <div
                        className="prospect-views"
                        aria-label="Prospect stages"
                      >
                        {["all", ...stages].map((value) => (
                          <button
                            key={value}
                            className={
                              stage === value ? "view-tab active" : "view-tab"
                            }
                            aria-pressed={stage === value}
                            onClick={() => {
                              setStage(value);
                              setSelected(new Set());
                            }}
                          >
                            {value === "all" && (
                              <ListFilter size={14} aria-hidden="true" />
                            )}
                            {value === "all" ? "All prospects" : value}
                            <span>
                              {
                                campaignProspects.filter(
                                  (p) => value === "all" || p.stage === value,
                                ).length
                              }
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="table-toolbar">
                        <div className="search-field">
                          <Search size={16} />
                          <input
                            aria-label="Filter prospects"
                            placeholder="Search prospects"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                          {query && (
                            <button
                              className="icon-button"
                              aria-label="Clear search"
                              onClick={() => setQuery("")}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                        <button
                          className={`button ${filtersOpen ? "pressed" : ""}`}
                          aria-expanded={filtersOpen}
                          onClick={() => setFiltersOpen(!filtersOpen)}
                        >
                          <Filter size={14} />
                          Filters
                          {stage !== "all" || owner !== "all" ? (
                            <span className="filter-dot" />
                          ) : null}
                        </button>
                        <button
                          className={`button ${dueOnly ? "pressed" : ""}`}
                          aria-pressed={dueOnly}
                          onClick={() => setDueOnly(!dueOnly)}
                        >
                          <CalendarDays size={14} />
                          Due follow-ups
                        </button>
                        <button
                          className="button"
                          onClick={() => void exportRows()}
                          disabled={busy || !exported.length}
                        >
                          <Download size={14} />
                          Export{selected.size ? ` (${exported.length})` : ""}
                        </button>
                      </div>
                      {filtersOpen && (
                        <div className="filter-bar">
                          <label>
                            Stage
                            <select
                              value={stage}
                              onChange={(e) => setStage(e.target.value)}
                            >
                              <option value="all">All stages</option>
                              {stages.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Owner
                            <select
                              value={owner}
                              onChange={(e) => setOwner(e.target.value)}
                            >
                              <option value="all">Everyone</option>
                              <option value="unassigned">Unassigned</option>
                              {state.members.map((m) => (
                                <option key={m.userId} value={m.userId}>
                                  {m.email}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="text-button"
                            onClick={() =>
                              void perform(async () => {
                                const name = window.prompt("Name this view");
                                if (!name?.trim()) return;
                                const value = {
                                  id: crypto.randomUUID(),
                                  name: name.trim(),
                                  filters: {
                                    stage,
                                    owner,
                                    query,
                                    campaignId: campaign?.id || "",
                                    followUp: dueOnly ? "due" : "all",
                                  },
                                };
                                if (mode === "demo")
                                  updateDemo({
                                    ...state,
                                    views: [...state.views, value],
                                  });
                                else
                                  await request(
                                    `${apiBase}/views`,
                                    token,
                                    "POST",
                                    value,
                                  );
                              })
                            }
                          >
                            <Bookmark size={14} />
                            Save view
                          </button>
                        </div>
                      )}
                      {state.views.length > 0 && (
                        <div className="saved-views">
                          <span>Views</span>
                          {state.views.map((v) => (
                            <button
                              key={v.id}
                              onClick={() => {
                                const apply = () => {
                                  setStage(v.filters.stage || "all");
                                  setOwner(v.filters.owner || "all");
                                  setQuery(v.filters.query || "");
                                  setDueOnly(v.filters.followUp === "due");
                                  if (v.filters.campaignId)
                                    setCampaignId(v.filters.campaignId);
                                };
                                if (
                                  v.filters.campaignId &&
                                  v.filters.campaignId !== campaign?.id
                                )
                                  leaveDetail(apply);
                                else apply();
                              }}
                            >
                              {v.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="table-meta">
                        <span>
                          {filtered.length}{" "}
                          {filtered.length === 1 ? "business" : "businesses"}
                          {filtered.length !== campaignProspects.length
                            ? ` of ${campaignProspects.length}`
                            : ""}
                        </span>
                        {(stage !== "all" ||
                          owner !== "all" ||
                          query ||
                          dueOnly) && (
                          <button
                            className="text-button"
                            onClick={resetFilters}
                          >
                            Clear filters <X size={12} aria-hidden="true" />
                          </button>
                        )}
                        <span>
                          {selected.size ? `${selected.size} selected` : null}
                        </span>
                      </div>
                      {selected.size > 0 && (
                        <div className="selection-bar">
                          <strong>{selected.size} selected</strong>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => void run("analysis")}
                          >
                            Analyze selected
                          </button>
                          <button
                            className="text-button"
                            disabled={busy || mode === "demo"}
                            onClick={() => void run("enrichment")}
                          >
                            Research websites
                          </button>
                          <button
                            className="text-button destructive"
                            disabled={busy}
                            onClick={() =>
                              requestEntryDelete(
                                filtered.filter((p) => selected.has(p.id)),
                              )
                            }
                          >
                            Delete selected
                          </button>
                          <select
                            aria-label="Update selected stage"
                            value=""
                            disabled={busy}
                            onChange={(e) => {
                              const next = e.target.value as Prospect["stage"];
                              void perform(async () => {
                                if (mode === "demo")
                                  updateDemo({
                                    ...state,
                                    prospects: state.prospects.map((p) =>
                                      selected.has(p.id)
                                        ? { ...p, stage: next }
                                        : p,
                                    ),
                                  });
                                else
                                  for (const id of selected)
                                    await request(
                                      `${apiBase}/entries/${id}`,
                                      token,
                                      "PATCH",
                                      { stage: next },
                                    );
                              });
                            }}
                          >
                            <option value="" disabled>
                              Set stage
                            </option>
                            {stages.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                          <button
                            className="icon-button"
                            aria-label="Clear selection"
                            onClick={() => setSelected(new Set())}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      )}
                      <ProspectTable
                        prospects={filtered}
                        campaign={campaign}
                        members={state.members}
                        selected={selected}
                        setSelected={setSelected}
                        active={active}
                        onOpen={openProspect}
                        onResetFilters={resetFilters}
                        emptyCampaign={!campaignProspects.length}
                      />
                      <div className="list-footer">
                        <span>
                          {mode === "demo"
                            ? "Sample records are fictional. Imported records stay in this browser."
                            : "Facts and research stay within this workspace."}
                          {mode === "demo" && (
                            <>
                              {" "}
                              <a
                                href="/privacy.html"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Privacy
                              </a>
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                    {chosen && (
                      <Detail
                        key={chosen.id}
                        prospect={chosen}
                        campaign={campaign}
                        members={state.members}
                        busy={busy}
                        demo={mode === "demo"}
                        onClose={() =>
                          leaveDetail(() => {
                            setDetailDirty(false);
                            const previous = active;
                            setActive(null);
                            setTimeout(
                              () =>
                                document
                                  .querySelector<HTMLButtonElement>(
                                    `[data-prospect="${previous}"]`,
                                  )
                                  ?.focus(),
                              0,
                            );
                          })
                        }
                        onSave={(values) => patch(chosen, values)}
                        onEdit={() => setDialog("editBusiness")}
                        onDelete={() => requestEntryDelete([chosen])}
                        onDirtyChange={setDetailDirty}
                      />
                    )}
                  </div>
                </>
              )}
              {page === "Campaigns" && (
                <div className="content-surface">
                  <table className="simple-table">
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th>Offer</th>
                        <th>Businesses</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => {
                                setCampaignId(c.id);
                                setPage("Prospects");
                              }}
                            >
                              {c.name}
                              <ArrowRight size={14} />
                            </button>
                          </td>
                          <td>{c.offer}</td>
                          <td>
                            {
                              state.prospects.filter(
                                (p) => p.campaignId === c.id,
                              ).length
                            }
                          </td>
                          <td>
                            <button
                              className="text-button"
                              aria-label={`Edit ${c.name}`}
                              onClick={() => openCampaignEditor(c)}
                            >
                              <Pencil size={13} />
                              Edit
                            </button>
                            <button
                              className="text-button destructive"
                              aria-label={`Delete ${c.name}`}
                              disabled={busy}
                              onClick={() => requestCampaignDelete(c)}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!campaigns.length && (
                    <p className="empty-copy">
                      Create a campaign to define your target businesses.
                    </p>
                  )}
                </div>
              )}
              {page === "Connections" && (
                <div className="content-surface settings-surface">
                  <p className="settings-intro">
                    Provider usage is billed to the connected account. Keys are
                    encrypted and shared only as enabled below.
                  </p>
                  {mode === "demo" && (
                    <p className="inline-info">
                      Sign in to connect your own provider accounts.
                    </p>
                  )}
                  <AISettingsForm
                    key={`${currentWorkspace}-${JSON.stringify(state.aiSettings)}`}
                    settings={state.aiSettings}
                    disabled={
                      mode === "demo" || state.workspace.role === "member"
                    }
                    busy={busy}
                    compatibleAvailable={Boolean(config?.compatibleAvailable)}
                    onSave={saveAISettings}
                  />
                  {(
                    [
                      state.aiSettings.provider,
                      "serpapi",
                      "firecrawl",
                    ] as Provider[]
                  ).map((provider) => (
                    <ProviderConnection
                      key={`${provider}-${state.connections.find((c) => c.provider === provider)?.updatedAt || ""}`}
                      provider={provider}
                      connection={state.connections.find(
                        (c) => c.provider === provider,
                      )}
                      disabled={
                        mode === "demo" || state.workspace.role === "member"
                      }
                      busy={busy}
                      onSave={async (key, allowMembers) => {
                        let saved = false;
                        await perform(async () => {
                          await request(
                            `${apiBase}/connections/${provider}`,
                            token,
                            "PUT",
                            { key, enabled: true, allowMembers },
                          );
                          setNotice("Connection saved");
                          saved = true;
                        });
                        return saved;
                      }}
                      onRemove={() =>
                        perform(async () => {
                          await request(
                            `${apiBase}/connections/${provider}`,
                            token,
                            "DELETE",
                          );
                          setNotice("Connection removed");
                        })
                      }
                      onTest={() => run("connection_test", { provider })}
                    />
                  ))}
                </div>
              )}
              {page === "Runs" && (
                <div className="content-surface">
                  <table className="simple-table">
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Status</th>
                        <th>Progress</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.jobs.map((j) => (
                        <tr key={j.id}>
                          <td>
                            <strong>{j.kind.replace("_", " ")}</strong>
                            <small>
                              {new Date(j.createdAt).toLocaleString()}
                            </small>
                          </td>
                          <td>
                            <span className={`run-status ${j.status}`}>
                              {j.status}
                            </span>
                            <small>{j.message}</small>
                          </td>
                          <td>
                            {j.progress} / {j.total}
                          </td>
                          <td>
                            {["queued", "running", "paused", "failed"].includes(
                              j.status,
                            ) && (
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() =>
                                  void perform(async () => {
                                    await request(
                                      `${apiBase}/jobs/${j.id}/${["failed", "paused"].includes(j.status) ? "resume" : "cancel"}`,
                                      token,
                                      "POST",
                                    );
                                  })
                                }
                              >
                                {["failed", "paused"].includes(j.status)
                                  ? "Resume"
                                  : "Cancel"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!state.jobs.length && (
                    <div className="empty-state">
                      <Activity size={26} />
                      <h3>No runs yet</h3>
                      <p>
                        Search businesses or analyze selected prospects to start
                        a run.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {page === "Team" && (
                <div className="content-surface">
                  <table className="simple-table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Role</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.members.map((m) => (
                        <tr key={m.userId}>
                          <td>{m.email}</td>
                          <td>{m.role}</td>
                          <td>
                            {mode === "live" &&
                              state.workspace.role !== "member" &&
                              m.role === "member" && (
                                <button
                                  className="text-button destructive"
                                  onClick={() =>
                                    void perform(async () => {
                                      await request(
                                        `${apiBase}/members/${m.userId}`,
                                        token,
                                        "DELETE",
                                      );
                                      setNotice("Member removed");
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {mode === "live" && (
                    <div className="surface-footer workspace-actions">
                      <button
                        className="button"
                        onClick={() => setDialog("workspace")}
                      >
                        <Plus size={15} />
                        New workspace
                      </button>
                      {state.workspace.role === "owner" && (
                        <button
                          className="text-button destructive"
                          onClick={() => setDialog("deleteWorkspace")}
                        >
                          Delete workspace
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {page === "Usage" && (
                <div className="content-surface">
                  <div className="surface-heading">
                    <h2>Provider requests</h2>
                    <span>Last 30 days</span>
                  </div>
                  <table className="simple-table">
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Status</th>
                        <th>Calls</th>
                        <th>Tokens</th>
                        <th>Credits</th>
                        <th>Cache hits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.usage.map((u, i) => (
                        <tr key={i}>
                          <td>
                            {u.provider}
                            {u.model && (
                              <small
                                className="secondary"
                                style={{ display: "block" }}
                              >
                                {u.model}
                              </small>
                            )}
                          </td>
                          <td>{u.status}</td>
                          <td>{u.calls}</td>
                          <td>
                            {u.tokens ?? "—"}
                            {!!u.unreported && (
                              <small
                                className="secondary"
                                style={{ display: "block" }}
                              >
                                {u.unreported} unreported
                              </small>
                            )}
                          </td>
                          <td>{u.credits}</td>
                          <td>{u.cacheHits}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!state.usage.length && (
                    <p className="empty-copy">No provider usage recorded.</p>
                  )}
                  <p className="surface-footer secondary">
                    Tokens include only reported usage. Credits reflect known
                    endpoint costs. Your provider account remains the source for
                    billing.
                  </p>
                </div>
              )}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>Tudla</span>
          <span>
            {mode === "demo" ? "Demo workspace" : "Private workspace"}
          </span>
        </footer>
      </div>
      {leaveAction && (
        <Modal title="Unsaved changes" onClose={() => setLeaveAction(null)}>
          <p>Your notes or email draft have unsaved changes.</p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setLeaveAction(null)}>
              Keep editing
            </button>
            <button
              className="button destructive"
              onClick={() => {
                const action = leaveAction;
                setLeaveAction(null);
                setDetailDirty(false);
                action();
              }}
            >
              Discard changes
            </button>
          </div>
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          title={
            deleteTarget.kind === "campaign"
              ? "Delete campaign?"
              : deleteTarget.ids.length === 1
                ? "Delete prospect?"
                : "Delete prospects?"
          }
          onClose={() => {
            if (!busy) {
              setDetailDirty(deleteTarget.wasDirty);
              setDeleteTarget(null);
            }
          }}
        >
          <p>
            {deleteTarget.kind === "campaign" ? (
              <>
                Delete <strong>{deleteTarget.name}</strong>? Its prospect
                entries, research, and run history will also be removed. Other
                campaigns will remain.
              </>
            ) : (
              <>
                Permanently remove{" "}
                {deleteTarget.ids.length === 1 ? (
                  <strong>{deleteTarget.names[0]}</strong>
                ) : (
                  <strong>{deleteTarget.ids.length} prospects</strong>
                )}{" "}
                from this campaign, including their notes, email drafts, and
                research? Businesses in other campaigns will remain.
              </>
            )}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setDetailDirty(deleteTarget.wasDirty);
                setDeleteTarget(null);
              }}
            >
              Cancel
            </button>
            <button
              className="button destructive"
              disabled={busy}
              onClick={() => void deleteRecords()}
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
      {dialog && (
        <Modal
          title={
            {
              campaign: "New campaign",
              business: "Add business",
              editCampaign: "Edit campaign",
              editBusiness: "Edit business",
              search: "Find businesses",
              import: "Import CSV",
              invite: "Invite member",
              workspace: "New workspace",
              deleteWorkspace: "Delete workspace",
            }[dialog]
          }
          onClose={() => {
            setDialog(null);
            setInviteUrl("");
          }}
        >
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {dialog === "business" && (
            <BusinessForm busy={busy} onSave={addBusiness} />
          )}
          {dialog === "editBusiness" && chosen && (
            <>
              <p className="field-help">
                Updates this business in every campaign in this workspace.
                Source history is kept.
              </p>
              <BusinessForm
                busy={busy}
                initial={chosen.business}
                onSave={editBusiness}
              />
            </>
          )}
          {dialog === "editCampaign" && editingCampaign && (
            <CampaignForm
              busy={busy}
              initial={editingCampaign}
              onSave={editCampaign}
              submitLabel="Save campaign"
            />
          )}
          {dialog === "deleteWorkspace" && state && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const confirmation = String(
                  new FormData(e.currentTarget).get("confirmation"),
                );
                void perform(async () => {
                  await request(apiBase, token, "DELETE", { confirmation });
                  setDialog(null);
                  setWorkspaceId("");
                  await cache.invalidateQueries({ queryKey: ["bootstrap"] });
                  setNotice("Workspace deleted");
                });
              }}
            >
              <p className="field-help">
                This permanently removes this workspace's records, keys, and run
                history. Active provider requests may finish.
              </p>
              <label>
                Type {state.workspace.name} to confirm
                <input name="confirmation" required autoComplete="off" />
              </label>
              <div className="dialog-actions">
                <button className="button destructive" disabled={busy}>
                  Delete workspace
                </button>
              </div>
            </form>
          )}
          {dialog === "campaign" && (
            <CampaignComposer
              onSave={createCampaign}
              busy={busy}
              demo={mode === "demo"}
              storageKey={`lead-tool-campaign-composer:${mode}:${currentWorkspace || "sample"}`}
              configured={Boolean(
                state?.connections.some(
                  (c) => c.provider === state.aiSettings.provider && c.enabled,
                ),
              )}
              requestDraft={requestCampaignDraft}
              getDraft={loadDraft}
              cancelDraft={cancelCampaignDraft}
              latestDraft={state?.drafts.find((d) => !d.acceptedCampaignId)}
              onConnect={() => {
                setDialog(null);
                setPage("Connections");
              }}
            />
          )}{" "}
          {dialog === "search" && campaign && (
            <SearchForm
              campaign={campaign}
              onSearch={(query, limit) => run("discovery", { query, limit })}
              busy={busy}
              demo={mode === "demo"}
            />
          )}{" "}
          {dialog === "import" && (
            <ImportForm onImport={importRows} busy={busy} />
          )}{" "}
          {dialog === "invite" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const email = String(
                  new FormData(e.currentTarget).get("email"),
                );
                void perform(async () => {
                  const r = await request<{ url: string }>(
                    `${apiBase}/invitations`,
                    token,
                    "POST",
                    { email },
                  );
                  setInviteUrl(r.url);
                });
              }}
            >
              <label>
                Google account email
                <input name="email" type="email" required maxLength={200} />
              </label>
              <p className="field-help">
                The link expires in 7 days and works once for this email.
              </p>
              <button className="button primary" disabled={busy}>
                Create invitation
              </button>
              {inviteUrl && (
                <label>
                  Invitation link
                  <input
                    readOnly
                    value={inviteUrl}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
            </form>
          )}
          {dialog === "workspace" && (
            <form
              className="workspace-form"
              onSubmit={(e) => {
                e.preventDefault();
                const name = String(new FormData(e.currentTarget).get("name"));
                void perform(async () => {
                  const r = await request<{ id: string }>(
                    "/workspaces",
                    token,
                    "POST",
                    { name },
                  );
                  await cache.invalidateQueries({ queryKey: ["bootstrap"] });
                  setWorkspaceId(r.id);
                  setDialog(null);
                });
              }}
            >
              <label>
                Name
                <input name="name" required maxLength={100} />
              </label>
              <button className="button primary" disabled={busy}>
                Create workspace
              </button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
