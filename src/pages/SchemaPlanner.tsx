import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import SchemaPlannerTab from "../components/schema-planner/SchemaPlannerTab";
import AgentsTab from "../components/schema-planner/AgentsTab";
import { TABLE_CONFIGS, SUB_TABS } from "../components/schema-planner/constants";
import { fetchSyncStatus, syncPush, syncPull, deployCode, fetchAppConfig, type SyncStatus, type AppMode } from "../lib/api";

const START_COMMANDS = [
  { cmd: "/nexus-start", desc: "Start or restart March Nexus dev server" },
  { cmd: "/schema-start", desc: "Start or restart Schema Planner app" },
];

const COMMAND_GROUPS = [
  {
    label: "Planning & Design",
    commands: [
      { cmd: "/feature", desc: "Propose new feature with dependency analysis" },
      { cmd: "/ap", desc: "Discuss and approve before implementing" },
      { cmd: "/schema", desc: "Query & modify Schema Planner via MCP" },
    ],
  },
  {
    label: "Development",
    commands: [
      { cmd: "/feature-dev", desc: "Guided feature dev with architecture focus" },
      { cmd: "/frontend-design", desc: "Build production-grade frontend UI" },
      { cmd: "/claude-api", desc: "Build Claude API / SDK integrations" },
      { cmd: "/c", desc: "Continue after an interruption" },
    ],
  },
  {
    label: "Projects",
    commands: [
      { cmd: "/commit-verify", desc: "Verify dependency tests, commit, verify again" },
    ],
  },
  {
    label: "Code Quality",
    commands: [
      { cmd: "/simplify", desc: "Review code for reuse & efficiency" },
      { cmd: "/commit", desc: "Create a git commit" },
      { cmd: "/commit-push-pr", desc: "Commit, push, and open a PR" },
      { cmd: "/clean_gone", desc: "Clean up deleted remote branches" },
    ],
  },
  {
    label: "Automation",
    commands: [
      { cmd: "/loop", desc: "Run command on recurring interval" },
      { cmd: "/schedule", desc: "Create cron-scheduled agents" },
      { cmd: "/ralph-loop", desc: "Start Ralph Loop in session" },
    ],
  },
  {
    label: "Utility",
    commands: [
      { cmd: "/my-commands", desc: "List all custom slash commands" },
    ],
  },
];

const TAB_ICONS: Record<string, string> = {
  projects: "📁",
  modules: "🌐",
  features: "⚡",
  data_tables: "⊞",
  data_fields: "≡",
  module_use_fields: "⇌",
  feature_concerns: "⚠",
  data_reviews: "✓",
  access_matrix: "⊠",
  prototypes: "🧪",
  concepts: "💡",
  research: "🔬",
  data_access_rules: "🔒",
  change_log: "📋",
  all_test_cases: "✅",
  agents: "🤖",
  settings: "⚙",
};

const TAB_LABELS: Record<string, string> = {
  prototypes: "Prototypes",
  all_test_cases: "Test Cases",
};

const TAB_GROUPS = [
  { label: "Projects", tabs: ["projects"] },
  { label: "Core", tabs: ["modules", "features", "concepts", "research", "all_test_cases"] },
  { label: "Data", tabs: ["data_tables", "data_fields", "module_use_fields"] },
  { label: "Quality", tabs: ["feature_concerns", "data_reviews", "access_matrix", "prototypes"] },
  { label: "Access & Audit", tabs: ["data_access_rules", "change_log"] },
  { label: "Settings", tabs: ["agents", "settings"] },
];

const DEFAULT_DEPTH_COLORS = ["#f2b661", "#5bc0de", "#a855f7", "#4ecb71", "#e05555"];
const DEPTH_COLOR_PALETTE = ["#f2b661", "#5bc0de", "#5cb85c", "#a855f7", "#4ecb71", "#e67d4a", "#da3b36", "#e05555", "#428bca", "#8899a6"];

// ─── Reference appearance defaults ───
export const DEFAULT_REF_COLORS: Record<string, string> = {
  table: "#a855f7",
  field: "#5bc0de",
  image: "#4ecb71",
  module: "#e67d4a",
  feature: "#a855f7",
  concept: "#f2b661",
  research: "#5bc0de",
};
export const DEFAULT_REF_ICONS: Record<string, string> = {
  table: "",
  field: "",
  image: "🎨",
  module: "🌐",
  feature: "⚡",
  concept: "💡",
  research: "🔬",
};
const REF_ICON_OPTIONS = ["", "🌐", "💻", "⚡", "💡", "🎨", "📋", "🔒", "⚠", "⊞", "≡", "⇌", "◈", "🧪", "⚙", "🔬"];
const REF_TYPES = [
  { key: "table", label: "Table" },
  { key: "field", label: "Field" },
  { key: "module", label: "Module" },
  { key: "feature", label: "Feature" },
  { key: "concept", label: "Concept" },
  { key: "research", label: "Research" },
  { key: "image", label: "Image" },
];

export function getRefColors(): Record<string, string> {
  try { const s = localStorage.getItem("splan_ref_colors"); return s ? { ...DEFAULT_REF_COLORS, ...JSON.parse(s) } : DEFAULT_REF_COLORS; } catch { return DEFAULT_REF_COLORS; }
}
export function getRefIcons(): Record<string, string> {
  try { const s = localStorage.getItem("splan_ref_icons"); return s ? { ...DEFAULT_REF_ICONS, ...JSON.parse(s) } : DEFAULT_REF_ICONS; } catch { return DEFAULT_REF_ICONS; }
}

function useRefAppearance(): [Record<string, string>, (c: Record<string, string>) => void, Record<string, string>, (i: Record<string, string>) => void] {
  const [colors, setColors] = useState<Record<string, string>>(getRefColors);
  const [icons, setIcons] = useState<Record<string, string>>(getRefIcons);
  const saveColors = (c: Record<string, string>) => { setColors(c); localStorage.setItem("splan_ref_colors", JSON.stringify(c)); };
  const saveIcons = (i: Record<string, string>) => { setIcons(i); localStorage.setItem("splan_ref_icons", JSON.stringify(i)); };
  return [colors, saveColors, icons, saveIcons];
}

function useDepthColors(): [string[], (colors: string[]) => void] {
  const [colors, setColors] = useState<string[]>(() => {
    try { const s = localStorage.getItem("splan_depth_colors"); return s ? JSON.parse(s) : DEFAULT_DEPTH_COLORS; } catch { return DEFAULT_DEPTH_COLORS; }
  });
  const save = (c: string[]) => { setColors(c); localStorage.setItem("splan_depth_colors", JSON.stringify(c)); };
  return [colors, save];
}

export default function SchemaPlanner() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [depthColors, setDepthColors] = useDepthColors();
  const [refColors, setRefColors, refIcons, setRefIcons] = useRefAppearance();
  const [githubPat, setGithubPat] = useState("");
  const [githubPatPreview, setGithubPatPreview] = useState("");
  const [githubPatSaved, setGithubPatSaved] = useState(false);
  const [showPat, setShowPat] = useState(false);

  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncLoading, setSyncLoading] = useState<'push' | 'pull' | 'deploy' | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // App mode (local vs hosted) — gates dev-only UI surfaces
  const [appMode, setAppMode] = useState<AppMode>('local');
  const isHosted = appMode === 'hosted';

  useEffect(() => {
    fetchAppConfig().then(c => setAppMode(c.mode)).catch(() => {});
  }, []);

  // Load sync status on mount + poll every 60s
  useEffect(() => {
    const load = () => fetchSyncStatus().then(setSyncStatus).catch(() => {});
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleSyncPush = useCallback(async () => {
    setSyncLoading('push');
    setSyncResult(null);
    try {
      const result = await syncPush();
      if (result.success) {
        setSyncResult(`Pushed ${result.totalRows} rows to remote`);
      } else {
        setSyncResult(`Push failed: ${result.error}`);
      }
      fetchSyncStatus().then(setSyncStatus).catch(() => {});
    } catch (e) {
      setSyncResult(`Push failed: ${(e as Error).message}`);
    } finally {
      setSyncLoading(null);
    }
  }, []);

  const handleSyncPull = useCallback(async () => {
    setSyncLoading('pull');
    setSyncResult(null);
    try {
      const result = await syncPull();
      if (result.success) {
        setSyncResult(`Pulled ${result.totalRows} rows from remote`);
      } else {
        setSyncResult(`Pull failed: ${result.error}`);
      }
      fetchSyncStatus().then(setSyncStatus).catch(() => {});
    } catch (e) {
      setSyncResult(`Pull failed: ${(e as Error).message}`);
    } finally {
      setSyncLoading(null);
    }
  }, []);

  const handleDeployCode = useCallback(async () => {
    setSyncLoading('deploy');
    setSyncResult(null);
    try {
      const result = await deployCode();
      if (result.success) {
        const detail = result.status === 'nothing' ? result.message
          : result.filesChanged ? `Deployed ${result.filesChanged} file(s) — ${result.commitHash || 'pushed'}`
          : result.message;
        setSyncResult(detail);
      } else {
        setSyncResult(`Deploy failed: ${result.error}`);
      }
    } catch (e) {
      setSyncResult(`Deploy failed: ${(e as Error).message}`);
    } finally {
      setSyncLoading(null);
    }
  }, []);

  // Load PAT status from server on mount
  useEffect(() => {
    fetch("/api/projects/github-config").then(r => r.json()).then((d: { hasToken: boolean; preview: string }) => {
      if (d.hasToken) { setGithubPatPreview(d.preview); setGithubPatSaved(true); }
    }).catch(() => {});
  }, []);

  const saveGithubPat = useCallback(async (pat: string) => {
    try {
      await fetch("/api/projects/github-config", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat }),
      });
      setGithubPatSaved(!!pat);
      setGithubPatPreview(pat ? pat.substring(0, 7) + "..." + pat.substring(pat.length - 4) : "");
      setGithubPat("");
    } catch { /* ignore */ }
  }, []);

  const ALL_VALID_TABS = [...SUB_TABS, "prototypes", "projects", "agents", "settings"];
  const activeTab = ALL_VALID_TABS.includes(searchParams.get("sptab") || "modules")
    ? (searchParams.get("sptab") || "modules")
    : "modules";

  const setTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sptab", tab);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col shrink-0 border-r overflow-hidden transition-all duration-200"
        style={{
          width: sidebarOpen ? 200 : 48,
          background: "var(--color-surface)",
          borderColor: "var(--color-divider)",
        }}
      >
        {/* App header */}
        <div
          className="flex items-center gap-2 px-3 py-3 border-b shrink-0"
          style={{ borderColor: "var(--color-divider)", minHeight: 48 }}
        >
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="w-7 h-7 rounded flex items-center justify-center shrink-0 text-base transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-muted)" }}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {sidebarOpen ? "◀" : "▶"}
          </button>
          {sidebarOpen && (
            <span className="text-sm font-bold truncate" style={{ color: "var(--color-text)" }}>
              Schema Planner
            </span>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-2">
          {TAB_GROUPS.map((group) => (
            <div key={group.label} className="mb-1">
              {sidebarOpen && (
                <div
                  className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--color-text-subtle)" }}
                >
                  {group.label}
                </div>
              )}
              {group.tabs.map((tabKey) => {
                const label = tabKey === "access_matrix"
                  ? "Access Matrix"
                  : TAB_LABELS[tabKey] ?? TABLE_CONFIGS[tabKey]?.label ?? tabKey;
                const icon = TAB_ICONS[tabKey] ?? "•";
                const isActive = activeTab === tabKey;
                return (
                  <button
                    key={tabKey}
                    onClick={() => setTab(tabKey)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors"
                    style={{
                      backgroundColor: isActive ? "rgba(66,139,202,0.15)" : "transparent",
                      color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
                      borderLeft: isActive ? "2px solid var(--color-primary)" : "2px solid transparent",
                    }}
                    title={!sidebarOpen ? label : undefined}
                  >
                    <span className="text-base shrink-0 w-5 text-center leading-none" style={{ fontSize: 13 }}>
                      {icon}
                    </span>
                    {sidebarOpen && (
                      <>
                        <span className="truncate font-medium" style={{ fontSize: 12 }}>
                          {label}
                        </span>
                        {tabKey === "settings" && syncStatus?.configured && (syncStatus.remote?.changeCount ?? 0) > 0 && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0 ml-auto"
                            style={{ backgroundColor: "#f2b661" }}
                            title={`${syncStatus.remote!.changeCount} unsaved remote change(s)`}
                          />
                        )}
                        {tabKey === "settings" && syncStatus?.configured && (syncStatus.remote?.changeCount ?? 0) === 0 && syncStatus.lastSync && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0 ml-auto"
                            style={{ backgroundColor: "#4ecb71" }}
                            title="In sync"
                          />
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Commands toggle button */}
        <div className="border-t shrink-0" style={{ borderColor: "var(--color-divider)" }}>
          <button
            onClick={() => setCommandsOpen((v) => !v)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-white/5"
            style={{ color: commandsOpen ? "#4ecb71" : "var(--color-text-muted)" }}
            title={sidebarOpen ? undefined : "Claude Code Commands"}
          >
            <span className="text-base shrink-0 w-5 text-center leading-none" style={{ fontSize: 13 }}>
              {commandsOpen ? "⌨" : "⌨"}
            </span>
            {sidebarOpen && (
              <span className="truncate font-medium flex items-center gap-2" style={{ fontSize: 11 }}>
                Commands
                <span style={{ fontSize: 9, opacity: 0.5 }}>{commandsOpen ? "▸" : "▸"}</span>
              </span>
            )}
          </button>
        </div>

        {/* Footer */}
        {sidebarOpen && (
          <div
            className="px-3 py-2 border-t text-[10px] shrink-0"
            style={{ borderColor: "var(--color-divider)", color: "var(--color-text-subtle)" }}
          >
            Local · SQLite
          </div>
        )}
      </aside>

      {/* Commands panel — slides out horizontally from sidebar */}
      {commandsOpen && (
        <div
          className="shrink-0 border-r overflow-y-auto"
          style={{
            width: 400,
            background: "var(--color-surface)",
            borderColor: "var(--color-divider)",
          }}
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b sticky top-0"
            style={{ borderColor: "var(--color-divider)", background: "var(--color-surface)" }}
          >
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-text)" }}>
              Claude Code Commands
            </span>
            <button
              onClick={() => setCommandsOpen(false)}
              className="w-6 h-6 rounded flex items-center justify-center text-xs hover:bg-white/10 transition-colors"
              style={{ color: "var(--color-text-muted)" }}
              title="Close commands panel"
            >
              ✕
            </button>
          </div>

          {/* Start Commands — top section */}
          <div className="px-3 pt-3 pb-2">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider mb-2"
              style={{ color: "#f59e0b", opacity: 0.9 }}
            >
              Start Commands
            </div>
            <div className="space-y-1">
              {START_COMMANDS.map((c) => (
                <div
                  key={c.cmd}
                  className="flex items-start gap-3 px-2 py-1.5 rounded transition-colors hover:bg-white/[0.03]"
                >
                  <code
                    className="text-[11px] font-mono shrink-0 font-semibold"
                    style={{ color: "#f59e0b", minWidth: 120 }}
                  >
                    {c.cmd}
                  </code>
                  <span
                    className="text-[11px] leading-tight"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {c.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderBottom: "1px solid var(--color-divider)", margin: "0 12px" }} />

          {/* Command groups — two columns */}
          <div className="p-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 12px" }}>
            {COMMAND_GROUPS.map((group) => (
              <div key={group.label}>
                <div
                  className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                  style={{ color: "var(--color-text-subtle)", opacity: 0.7 }}
                >
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.commands.map((c) => (
                    <div
                      key={c.cmd}
                      className="flex flex-col px-2 py-1.5 rounded transition-colors hover:bg-white/[0.03]"
                    >
                      <code
                        className="text-[11px] font-mono font-semibold"
                        style={{ color: "#4ecb71" }}
                      >
                        {c.cmd}
                      </code>
                      <span
                        className="text-[10px] leading-tight mt-0.5"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {c.desc}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto p-4" style={{ minWidth: 0 }}>
        {activeTab === "agents" ? (
          <AgentsTab />
        ) : activeTab === "settings" ? (
          <div style={{ maxWidth: 600 }}>
            <h2 className="text-lg font-bold mb-6" style={{ color: "var(--color-text)" }}>Settings</h2>

            {/* Section Depth Colors */}
            <div className="mb-8">
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--color-text)" }}>
                Section Depth Colors
              </h3>
              <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
                Colors for collapsible section arrows and border boxes at each nesting depth.
                <br />Depth 1 = <code>##</code>, Depth 2 = <code>###</code>, Depth 3 = <code>####</code>, etc.
              </p>
              <div className="flex flex-col gap-3">
                {depthColors.map((color, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs font-mono w-20 shrink-0" style={{ color: "var(--color-text-muted)" }}>
                      {"#".repeat(i + 2)} Depth {i + 1}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {DEPTH_COLOR_PALETTE.map((c) => (
                        <button
                          key={c}
                          onClick={() => { const next = [...depthColors]; next[i] = c; setDepthColors(next); }}
                          className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                          style={{
                            backgroundColor: c,
                            borderColor: color === c ? "#fff" : "transparent",
                            boxShadow: color === c ? `0 0 0 2px ${c}` : "none",
                          }}
                          title={c}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] font-mono" style={{ color }}>{color}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setDepthColors([...DEFAULT_DEPTH_COLORS])}
                className="mt-4 px-3 py-1 text-xs rounded border hover:bg-white/5 transition-colors"
                style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}
              >
                Reset to defaults
              </button>
            </div>

            {/* Reference Appearance */}
            <div className="mb-8">
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--color-text)" }}>
                Reference Appearance
              </h3>
              <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
                Customize the color and icon for each reference type in notes and record tables.
              </p>
              <div className="flex flex-col gap-3">
                {REF_TYPES.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-xs font-medium w-16 shrink-0" style={{ color: refColors[key] }}>{label}</span>
                    {/* Color picker */}
                    <div className="flex items-center gap-1.5">
                      {DEPTH_COLOR_PALETTE.map((c) => (
                        <button
                          key={c}
                          onClick={() => setRefColors({ ...refColors, [key]: c })}
                          className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                          style={{
                            backgroundColor: c,
                            borderColor: refColors[key] === c ? "#fff" : "transparent",
                            boxShadow: refColors[key] === c ? `0 0 0 2px ${c}` : "none",
                          }}
                        />
                      ))}
                      <input
                        type="color"
                        value={refColors[key]}
                        onChange={(e) => setRefColors({ ...refColors, [key]: e.target.value })}
                        className="w-5 h-5 rounded cursor-pointer border-0 p-0"
                        style={{ backgroundColor: "transparent" }}
                        title="Custom color"
                      />
                    </div>
                    {/* Icon picker */}
                    <select
                      value={refIcons[key]}
                      onChange={(e) => setRefIcons({ ...refIcons, [key]: e.target.value })}
                      className="px-1 py-0.5 text-xs rounded border cursor-pointer"
                      style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", width: 48 }}
                    >
                      {REF_ICON_OPTIONS.map((ico) => (
                        <option key={ico} value={ico}>{ico || "(none)"}</option>
                      ))}
                    </select>
                    {/* Preview */}
                    <span className="text-xs font-medium" style={{ color: refColors[key] }}>
                      ({refIcons[key] ? `${refIcons[key]} ` : ""}Sample{label})
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { setRefColors({ ...DEFAULT_REF_COLORS }); setRefIcons({ ...DEFAULT_REF_ICONS }); }}
                className="mt-4 px-3 py-1 text-xs rounded border hover:bg-white/5 transition-colors"
                style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}
              >
                Reset to defaults
              </button>
            </div>

            {/* GitHub Integration */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                  GitHub Integration
                </h3>
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: isHosted ? "rgba(168,85,247,0.15)" : "rgba(78,203,113,0.15)",
                    color: isHosted ? "#a855f7" : "#4ecb71",
                    border: `1px solid ${isHosted ? "rgba(168,85,247,0.3)" : "rgba(78,203,113,0.3)"}`,
                  }}
                  title="APP_MODE — controls which endpoints are callable on this instance"
                >
                  {isHosted ? "HOSTED" : "LOCAL"}
                </span>
              </div>
              <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
                Personal Access Token used to sync commits and manage repos from the Projects tab.
                <br />Stored in a local config file in this project folder — never in the database, browser, or Data Sync payload.
              </p>

              {isHosted ? (
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className="text-xs font-mono px-2 py-1 rounded"
                    style={{
                      backgroundColor: githubPatSaved ? "rgba(78,203,113,0.1)" : "rgba(148,163,184,0.1)",
                      color: githubPatSaved ? "#4ecb71" : "var(--color-text-muted)",
                      border: `1px solid ${githubPatSaved ? "rgba(78,203,113,0.2)" : "var(--color-divider)"}`,
                    }}
                  >
                    {githubPatSaved ? `PAT configured: ${githubPatPreview}` : "No PAT on this instance"}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--color-text-subtle)" }}>
                    Managed from the local instance — rotate it there.
                  </span>
                </div>
              ) : githubPatSaved ? (
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-mono px-2 py-1 rounded" style={{ backgroundColor: "rgba(78,203,113,0.1)", color: "#4ecb71", border: "1px solid rgba(78,203,113,0.2)" }}>
                    PAT configured: {githubPatPreview}
                  </span>
                  <button
                    onClick={() => saveGithubPat("")}
                    className="px-3 py-1 text-xs rounded border hover:bg-white/5 transition-colors"
                    style={{ color: "#e05555", borderColor: "var(--color-divider)" }}
                  >
                    Remove PAT
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-2">
                  <div className="relative flex-1">
                    <input
                      type={showPat ? "text" : "password"}
                      value={githubPat}
                      onChange={(e) => setGithubPat(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full px-3 py-1.5 text-xs rounded border font-mono pr-16"
                      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
                      onKeyDown={(e) => { if (e.key === "Enter" && githubPat.trim()) saveGithubPat(githubPat.trim()); }}
                    />
                    <button
                      onClick={() => setShowPat(!showPat)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] rounded hover:bg-white/10"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {showPat ? "Hide" : "Show"}
                    </button>
                  </div>
                  <button
                    onClick={() => { if (githubPat.trim()) saveGithubPat(githubPat.trim()); }}
                    disabled={!githubPat.trim()}
                    className="px-3 py-1.5 text-xs rounded font-medium transition-colors"
                    style={{ backgroundColor: "rgba(78,203,113,0.15)", color: "#4ecb71", opacity: githubPat.trim() ? 1 : 0.4 }}
                  >
                    Save
                  </button>
                </div>
              )}
              <p className="text-[10px] mt-2" style={{ color: "var(--color-text-subtle)" }}>
                Needs the <code>repo</code> scope for private repos. Create one at{" "}
                <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--color-primary)" }}>
                  github.com/settings/tokens
                </a>
              </p>
            </div>

            {/* Data Sync */}
            <div className="mb-8">
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--color-text)" }}>
                Data Sync
              </h3>
              <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
                Push local data to the remote web app, or pull remote changes back to your local database.
              </p>

              {!syncStatus ? (
                <p className="text-xs" style={{ color: "var(--color-text-subtle)" }}>Loading sync status...</p>
              ) : !syncStatus.configured ? (
                <div className="text-xs p-3 rounded border" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>
                  <p className="font-medium mb-1">Not configured</p>
                  <p>Set <code>SYNC_REMOTE_URL</code> and <code>SYNC_REMOTE_PASSWORD</code> environment variables to enable sync.</p>
                  {syncStatus.error && <p className="mt-1" style={{ color: "#e05555" }}>{syncStatus.error}</p>}
                </div>
              ) : (
                <>
                  {/* Status line */}
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: (syncStatus.remote?.changeCount ?? 0) > 0 ? "#f2b661" : "#4ecb71" }}
                    />
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {syncStatus.lastSync
                        ? `Last sync: ${new Date(syncStatus.lastSync.syncedAt + 'Z').toLocaleString()} (${syncStatus.lastSync.direction}, ${syncStatus.lastSync.rowsSynced} rows)`
                        : "Never synced"}
                    </span>
                  </div>

                  {/* Change warnings */}
                  {(syncStatus.remote?.changeCount ?? 0) > 0 && (
                    <div className="text-xs p-2 rounded mb-3" style={{ backgroundColor: "rgba(242,182,97,0.1)", border: "1px solid rgba(242,182,97,0.3)", color: "#f2b661" }}>
                      Remote has {syncStatus.remote!.changeCount} change(s) since last sync — pull before pushing to avoid overwriting.
                    </div>
                  )}
                  {(syncStatus.local?.changeCount ?? 0) > 0 && (
                    <div className="text-xs p-2 rounded mb-3" style={{ backgroundColor: "rgba(66,139,202,0.1)", border: "1px solid rgba(66,139,202,0.3)", color: "#428bca" }}>
                      Local has {syncStatus.local!.changeCount} change(s) since last sync — push to update remote.
                    </div>
                  )}

                  {syncStatus.error && (
                    <div className="text-xs p-2 rounded mb-3" style={{ backgroundColor: "rgba(224,85,85,0.1)", border: "1px solid rgba(224,85,85,0.3)", color: "#e05555" }}>
                      {syncStatus.error}
                    </div>
                  )}

                  {/* Buttons */}
                  <div className="flex items-center gap-3 mb-2">
                    <button
                      onClick={handleSyncPush}
                      disabled={!!syncLoading}
                      className="px-4 py-2 text-xs rounded font-medium transition-colors"
                      style={{
                        backgroundColor: syncLoading === 'push' ? "rgba(78,203,113,0.05)" : "rgba(78,203,113,0.15)",
                        color: "#4ecb71",
                        opacity: syncLoading && syncLoading !== 'push' ? 0.4 : 1,
                      }}
                    >
                      {syncLoading === 'push' ? "Pushing..." : "Push Data"}
                    </button>
                    <button
                      onClick={handleSyncPull}
                      disabled={!!syncLoading}
                      className="px-4 py-2 text-xs rounded font-medium transition-colors"
                      style={{
                        backgroundColor: syncLoading === 'pull' ? "rgba(66,139,202,0.05)" : "rgba(66,139,202,0.15)",
                        color: "#428bca",
                        opacity: syncLoading && syncLoading !== 'pull' ? 0.4 : 1,
                      }}
                    >
                      {syncLoading === 'pull' ? "Pulling..." : "Pull Data"}
                    </button>
                    {!isHosted && (
                      <button
                        onClick={handleDeployCode}
                        disabled={!!syncLoading}
                        className="px-4 py-2 text-xs rounded font-medium transition-colors"
                        style={{
                          backgroundColor: syncLoading === 'deploy' ? "rgba(168,85,247,0.05)" : "rgba(168,85,247,0.15)",
                          color: "#a855f7",
                          opacity: syncLoading && syncLoading !== 'deploy' ? 0.4 : 1,
                        }}
                        title="Shells out to git on this server — only available on the local instance"
                      >
                        {syncLoading === 'deploy' ? "Deploying..." : "Deploy Code"}
                      </button>
                    )}
                  </div>
                  {isHosted && (
                    <p className="text-[10px] mt-1" style={{ color: "var(--color-text-subtle)" }}>
                      Deploy Code is hidden on the hosted instance — run it from the local app.
                    </p>
                  )}

                  {/* Result message */}
                  {syncResult && (
                    <p className="text-xs mt-2" style={{ color: syncResult.includes('failed') ? "#e05555" : "#4ecb71" }}>
                      {syncResult}
                    </p>
                  )}

                  <p className="text-[10px] mt-3" style={{ color: "var(--color-text-subtle)" }}>
                    Remote: {syncStatus.remoteUrl}
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <SchemaPlannerTab
            subTab={activeTab}
            onSubTabChange={setTab}
            depthColors={depthColors}
          />
        )}
      </main>
    </div>
  );
}
