import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import EntityDetailPopup from "./EntityDetailPopup";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Project {
  projectId: number;
  projectName: string;
  description: string | null;
  githubRepo: string | null;
  githubPat: string | null;
  branchLiveName: string;
  branchPrimaryName: string;
  branchSecondaryName: string;
  lastSyncedShaLive: string | null;
  lastSyncedShaPrimary: string | null;
  lastSyncedShaSecondary: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface CodeChange {
  changeId: number;
  projectId: number;
  branch: string;
  changeName: string;
  changeType: string;
  implementationPrompt: string | null;
  executionResults: string | null;
  fileLocations: string | null;
  dependencies: Array<{ type: string; id: number }>;
  failedTests: string[];
  failureExplanations: string | null;
  implementationGroup: number | null;
  githubCommitHash: string | null;
  githubCommitUrl: string | null;
  linkedEntityType: string | null;
  linkedEntityId: number | null;
  linkedTables: number[];
  linkedFields: number[];
  createdAt: string;
  updatedAt: string;
}

interface Dep { type: string; id: number }

interface Props {
  allModules: Array<{ moduleId: number; moduleName: string }>;
  allFeatures: Array<{ featureId: number; featureName: string }>;
  allConcepts: Array<{ conceptId: number; conceptName: string }>;
  allDataTables: Array<{ tableId: number; tableName: string }>;
  allDataFields: Array<{ fieldId: number; fieldName: string; dataTableId: number }>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHANGE_TYPES = ["Prototype", "Git Push", "Working Through", "Data Change"] as const;
const BRANCHES = [
  { key: "live", label: "Live" },
  { key: "primary_dev", label: "Primary Dev" },
  { key: "secondary_dev", label: "Secondary Dev" },
] as const;

const CHANGE_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Prototype":       { bg: "rgba(168,85,247,0.15)", text: "#a855f7", border: "rgba(168,85,247,0.3)" },
  "Git Push":        { bg: "rgba(78,203,113,0.15)", text: "#4ecb71", border: "rgba(78,203,113,0.3)" },
  "Working Through": { bg: "rgba(242,182,97,0.15)", text: "#f2b661", border: "rgba(242,182,97,0.3)" },
  "Data Change":     { bg: "rgba(91,192,222,0.15)", text: "#5bc0de", border: "rgba(91,192,222,0.3)" },
};

const DEP_TYPE_COLORS: Record<string, string> = {
  module: "#e67d4a",
  feature: "#a855f7",
  concept: "#f2b661",
  data_table: "#5bc0de",
  data_field: "#4ecb71",
};

const DEP_TYPE_LABELS: Record<string, string> = {
  module: "Module",
  feature: "Feature",
  concept: "Concept",
  data_table: "Table",
  data_field: "Field",
};

// ─── Pill Component ──────────────────────────────────────────────────────────

function Pill({ value, colors }: { value: string; colors: Record<string, { bg: string; text: string; border: string }> }) {
  const c = colors[value] || { bg: "rgba(108,123,255,0.12)", text: "#6c7bff", border: "rgba(108,123,255,0.3)" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {value}
    </span>
  );
}

// ─── Prompt Templates ────────────────────────────────────────────────────────

function buildPromptTemplate(type: string, change: CodeChange, project: Project, resolvedDeps: Array<{ type: string; id: number; name: string }>): string {
  const depList = resolvedDeps.map(d => `- ${DEP_TYPE_LABELS[d.type] || d.type}: ${d.name}`).join("\n") || "None";
  const branchInfo = BRANCHES.find(b => b.key === change.branch);
  const branchDisplay = branchInfo?.label || change.branch;

  switch (type) {
    case "Prototype":
      return `/ap ${change.changeName}

## Understanding
Quick UI mockup / backend endpoint prototype for: ${change.changeName}

## Implementation Plan
- Create prototype at: ${change.fileLocations || "[specify file locations]"}
- Focus: [UI layout / API endpoint / data flow]

## Dependencies
${depList}`;

    case "Working Through":
      return `/ap ${change.changeName}

## Understanding
Iterating on implementation: ${change.changeName}

## Implementation Plan
${change.implementationPrompt || "[step-by-step approach]"}

## Files
${change.fileLocations || "[specify file locations]"}

## Dependencies
${depList}

## Previous Attempt
${change.executionResults || "[no previous results]"}`;

    case "Git Push":
      return `/ap ${change.changeName}

## Commit Summary
${change.changeName}

## Files Changed
${change.fileLocations || "[no files recorded]"}

## Dependencies Affected
${depList}`;

    case "Data Change":
      return `/ap ${change.changeName}

## Schema Change
${change.changeName}

## Affected Tables/Fields
${resolvedDeps.filter(d => d.type === "data_table" || d.type === "data_field").map(d => `- ${DEP_TYPE_LABELS[d.type]}: ${d.name}`).join("\n") || "None"}

## Impact
${depList}`;

    default:
      return `/ap ${change.changeName}\n\n${change.implementationPrompt || ""}`;
  }
}

function buildRetryPrompt(change: CodeChange, project: Project, resolvedDeps: Array<{ type: string; id: number; name: string }>): string {
  const branchInfo = BRANCHES.find(b => b.key === change.branch);
  const branchDisplay = branchInfo?.label || change.branch;
  const depList = resolvedDeps.map(d => `- ${DEP_TYPE_LABELS[d.type] || d.type}: ${d.name}`).join("\n") || "None";
  const failedList = (change.failedTests || []).map(t => `- ${t}`).join("\n") || "None";

  return `/ap ${change.changeName}

## Context
Project: ${project.projectName} | Branch: ${branchDisplay} | Group: #${change.implementationGroup ?? "?"}
Files: ${change.fileLocations || "None"}

## What Was Attempted
${change.implementationPrompt || "[no implementation prompt recorded]"}

## Results
${change.executionResults || "[no results recorded]"}

## Failed Tests
${failedList}

## Likely Issues
${change.failureExplanations || "[no failure explanations]"}

## Dependencies
${depList}

## Feedback
Please fix: `;
}

function buildContextColumn(change: CodeChange, project: Project, resolvedDeps: Array<{ type: string; id: number; name: string }>, testCount: number): string {
  const branchInfo = BRANCHES.find(b => b.key === change.branch);
  const branchDisplay = branchInfo?.label || change.branch;
  return `[Project: ${project.projectName}] [Branch: ${branchDisplay}] [Group: #${change.implementationGroup ?? "?"}]
Files: ${change.fileLocations || "none"}
Dependencies: ${resolvedDeps.map(d => `${DEP_TYPE_LABELS[d.type]}:${d.name}`).join(", ") || "none"}
Tests: ${testCount} associated test cases
Prompt: ${(change.implementationPrompt || "").substring(0, 100)}${(change.implementationPrompt || "").length > 100 ? "..." : ""}`;
}

// ─── Dependency Picker ───────────────────────────────────────────────────────

function DependencyPicker({ deps, onChange, allModules, allFeatures, allConcepts, allDataTables, allDataFields, onClose }: {
  deps: Dep[];
  onChange: (deps: Dep[]) => void;
  allModules: Props["allModules"];
  allFeatures: Props["allFeatures"];
  allConcepts: Props["allConcepts"];
  allDataTables: Props["allDataTables"];
  allDataFields: Props["allDataFields"];
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<string>("module");
  const [search, setSearch] = useState("");

  const tabs = [
    { key: "module", label: "Modules", items: allModules.map(m => ({ id: m.moduleId, name: m.moduleName })) },
    { key: "feature", label: "Features", items: allFeatures.map(f => ({ id: f.featureId, name: f.featureName })) },
    { key: "concept", label: "Concepts", items: allConcepts.map(c => ({ id: c.conceptId, name: c.conceptName })) },
    { key: "data_table", label: "Tables", items: allDataTables.map(t => ({ id: t.tableId, name: t.tableName })) },
    { key: "data_field", label: "Fields", items: allDataFields.map(f => ({ id: f.fieldId, name: f.fieldName })) },
  ];

  const isSelected = (type: string, id: number) => deps.some(d => d.type === type && d.id === id);

  const toggle = (type: string, id: number) => {
    if (isSelected(type, id)) {
      onChange(deps.filter(d => !(d.type === type && d.id === id)));
    } else {
      onChange([...deps, { type, id }]);
    }
  };

  const activeItems = tabs.find(t => t.key === activeTab)?.items || [];
  const filtered = search
    ? activeItems.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    : activeItems;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-lg shadow-xl overflow-hidden flex flex-col"
        style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-divider)", width: 520, maxHeight: "70vh" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-divider)" }}>
          <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Select Dependencies</span>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded hover:bg-white/10" style={{ color: "var(--color-text-muted)" }}>Done</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: "var(--color-divider)" }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSearch(""); }}
              className="flex-1 px-2 py-2 text-[11px] font-medium transition-colors"
              style={{
                color: activeTab === tab.key ? DEP_TYPE_COLORS[tab.key] : "var(--color-text-muted)",
                borderBottom: activeTab === tab.key ? `2px solid ${DEP_TYPE_COLORS[tab.key]}` : "2px solid transparent",
              }}
            >
              {tab.label}
              {deps.filter(d => d.type === tab.key).length > 0 && (
                <span className="ml-1 text-[9px] opacity-70">({deps.filter(d => d.type === tab.key).length})</span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${tabs.find(t => t.key === activeTab)?.label.toLowerCase()}...`}
            className="w-full px-2 py-1.5 text-xs rounded border"
            style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
          />
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-3 pb-3" style={{ maxHeight: 300 }}>
          {filtered.length === 0 && (
            <div className="text-xs py-4 text-center" style={{ color: "var(--color-text-muted)" }}>No items found</div>
          )}
          {filtered.map(item => (
            <label
              key={`${activeTab}-${item.id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-white/5 text-xs"
              style={{ color: "var(--color-text)" }}
            >
              <input
                type="checkbox"
                checked={isSelected(activeTab, item.id)}
                onChange={() => toggle(activeTab, item.id)}
                className="rounded"
              />
              <span className="truncate">{item.name}</span>
            </label>
          ))}
        </div>

        {/* Selected summary */}
        {deps.length > 0 && (
          <div className="px-3 py-2 border-t flex flex-wrap gap-1" style={{ borderColor: "var(--color-divider)" }}>
            {deps.map(d => {
              const items = tabs.find(t => t.key === d.type)?.items || [];
              const item = items.find(i => i.id === d.id);
              return (
                <span
                  key={`${d.type}-${d.id}`}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                  style={{ backgroundColor: `${DEP_TYPE_COLORS[d.type]}20`, color: DEP_TYPE_COLORS[d.type], border: `1px solid ${DEP_TYPE_COLORS[d.type]}40` }}
                >
                  {DEP_TYPE_LABELS[d.type]}: {item?.name || `#${d.id}`}
                  <button onClick={() => toggle(d.type, d.id)} className="hover:opacity-70">×</button>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Retry Prompt Popup ──────────────────────────────────────────────────────

function RetryPromptPopup({ change, project, resolvedDeps, onClose }: {
  change: CodeChange;
  project: Project;
  resolvedDeps: Array<{ type: string; id: number; name: string }>;
  onClose: () => void;
}) {
  const basePrompt = buildRetryPrompt(change, project, resolvedDeps);
  const [feedback, setFeedback] = useState("");
  const [copied, setCopied] = useState(false);

  const fullPrompt = basePrompt + feedback;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullPrompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-lg shadow-xl overflow-hidden flex flex-col"
        style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-divider)", width: 700, maxHeight: "85vh" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-divider)" }}>
          <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Retry Prompt — {change.changeName}</span>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded hover:bg-white/10" style={{ color: "var(--color-text-muted)" }}>×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <pre
            className="text-xs font-mono whitespace-pre-wrap rounded p-3 mb-3"
            style={{ backgroundColor: "var(--color-background)", color: "var(--color-text-muted)", border: "1px solid var(--color-divider)" }}
          >
            {basePrompt}
          </pre>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe what needs to be fixed..."
            className="w-full px-3 py-2 text-xs rounded border resize-y"
            style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)", minHeight: 80 }}
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t" style={{ borderColor: "var(--color-divider)" }}>
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
            style={{ backgroundColor: copied ? "rgba(78,203,113,0.2)" : "rgba(66,139,202,0.15)", color: copied ? "#4ecb71" : "#428bca", border: `1px solid ${copied ? "rgba(78,203,113,0.3)" : "rgba(66,139,202,0.3)"}` }}
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border hover:bg-white/5"
            style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Expandable Text Cell ────────────────────────────────────────────────────

function ExpandableText({ value, maxLen = 60 }: { value: string | null; maxLen?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!value) return <span style={{ color: "var(--color-text-subtle)" }}>—</span>;
  if (value.length <= maxLen) return <span>{value}</span>;
  return (
    <span>
      {expanded ? value : value.substring(0, maxLen) + "..."}
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="ml-1 text-[10px] hover:underline"
        style={{ color: "var(--color-primary)" }}
      >
        {expanded ? "less" : "more"}
      </button>
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export default function ProjectsGrid({ allModules, allFeatures, allConcepts, allDataTables, allDataFields }: Props) {
  // ─── State ─────────────────────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [changes, setChanges] = useState<CodeChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(() => {
    const stored = localStorage.getItem("splan_selected_project");
    return stored ? Number(stored) : null;
  });

  // Project CRUD
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectRepo, setNewProjectRepo] = useState("");
  const [editingProject, setEditingProject] = useState<{ field: string } | null>(null);
  const [deleteProjectConfirm, setDeleteProjectConfirm] = useState(false);

  // Code change CRUD
  const [addingChange, setAddingChange] = useState<{ branch: string } | null>(null);
  const [newChangeName, setNewChangeName] = useState("");
  const [newChangeType, setNewChangeType] = useState<string>("Working Through");
  const [editingCell, setEditingCell] = useState<{ changeId: number; field: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CodeChange | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  // Popups
  const [depPickerTarget, setDepPickerTarget] = useState<CodeChange | null>(null);
  const [retryTarget, setRetryTarget] = useState<CodeChange | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<CodeChange | null>(null);
  const [expandedResults, setExpandedResults] = useState<CodeChange | null>(null);
  const [entityPopup, setEntityPopup] = useState<{ entityType: string; entityId: number } | null>(null);

  // GitHub sync
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // GitHub import / create
  const [showGithubImport, setShowGithubImport] = useState(false);
  const [githubRepos, setGithubRepos] = useState<Array<{ fullName: string; name: string; description: string | null; isPrivate: boolean; url: string; defaultBranch: string; updatedAt: string }>>([]);
  const [githubReposLoading, setGithubReposLoading] = useState(false);
  const [githubReposError, setGithubReposError] = useState<string | null>(null);
  const [showCreateRepo, setShowCreateRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDesc, setNewRepoDesc] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [creatingRepo, setCreatingRepo] = useState(false);

  const addInputRef = useRef<HTMLInputElement>(null);
  const projectNameRef = useRef<HTMLInputElement>(null);

  // ─── Derived ───────────────────────────────────────────────────────────────
  const selectedProject = useMemo(() => projects.find(p => p.projectId === selectedProjectId) || null, [projects, selectedProjectId]);
  const projectChanges = useMemo(() => changes.filter(c => c.projectId === selectedProjectId), [changes, selectedProjectId]);

  // Resolve dependency names for display
  const resolveDep = useCallback((dep: Dep): { type: string; id: number; name: string } => {
    switch (dep.type) {
      case "module": return { ...dep, name: allModules.find(m => m.moduleId === dep.id)?.moduleName || `Module #${dep.id}` };
      case "feature": return { ...dep, name: allFeatures.find(f => f.featureId === dep.id)?.featureName || `Feature #${dep.id}` };
      case "concept": return { ...dep, name: allConcepts.find(c => c.conceptId === dep.id)?.conceptName || `Concept #${dep.id}` };
      case "data_table": return { ...dep, name: allDataTables.find(t => t.tableId === dep.id)?.tableName || `Table #${dep.id}` };
      case "data_field": return { ...dep, name: allDataFields.find(f => f.fieldId === dep.id)?.fieldName || `Field #${dep.id}` };
      default: return { ...dep, name: `${dep.type} #${dep.id}` };
    }
  }, [allModules, allFeatures, allConcepts, allDataTables, allDataFields]);

  // ─── Data Loading ──────────────────────────────────────────────────────────

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/schema-planner?table=_splan_projects");
      if (res.ok) {
        const data = await res.json();
        const rows = (Array.isArray(data) ? data : data.rows || []) as Project[];
        setProjects(rows.sort((a, b) => a.projectName.localeCompare(b.projectName)));
      }
    } catch { /* ignore */ }
  }, []);

  const loadChanges = useCallback(async () => {
    try {
      const res = await fetch("/api/schema-planner?table=_splan_code_changes");
      if (res.ok) {
        const data = await res.json();
        setChanges((Array.isArray(data) ? data : data.rows || []) as CodeChange[]);
      }
    } catch { /* ignore */ }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadProjects(), loadChanges()]);
    setLoading(false);
  }, [loadProjects, loadChanges]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Persist selected project
  useEffect(() => {
    if (selectedProjectId !== null) {
      localStorage.setItem("splan_selected_project", String(selectedProjectId));
    }
  }, [selectedProjectId]);

  // Auto-select first project if none selected
  useEffect(() => {
    if (selectedProjectId === null && projects.length > 0) {
      setSelectedProjectId(projects[0].projectId);
    }
  }, [projects, selectedProjectId]);

  // ─── Project CRUD ──────────────────────────────────────────────────────────

  const createProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    try {
      const res = await fetch("/api/schema-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_projects",
          data: {
            projectName: newProjectName.trim(),
            githubRepo: newProjectRepo.trim() || null,
            status: "active",
          },
          reasoning: `Created project "${newProjectName.trim()}"`,
        }),
      });
      if (res.ok) {
        const created = await res.json() as Project;
        setNewProjectName("");
        setNewProjectRepo("");
        setShowNewProject(false);
        await loadProjects();
        setSelectedProjectId(created.projectId);
      }
    } catch { /* ignore */ }
  }, [newProjectName, newProjectRepo, loadProjects]);

  const updateProject = useCallback(async (data: Partial<Project>) => {
    if (!selectedProject) return;
    try {
      await fetch("/api/schema-planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_projects",
          id: selectedProject.projectId,
          data,
          reasoning: `Updated project "${selectedProject.projectName}"`,
        }),
      });
      loadProjects();
    } catch { /* ignore */ }
    setEditingProject(null);
  }, [selectedProject, loadProjects]);

  const deleteProject = useCallback(async () => {
    if (!selectedProject) return;
    try {
      await fetch("/api/schema-planner", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_projects",
          id: selectedProject.projectId,
          reasoning: `Deleted project "${selectedProject.projectName}"`,
        }),
      });
      setSelectedProjectId(null);
      setDeleteProjectConfirm(false);
      loadProjects();
      loadChanges();
    } catch { /* ignore */ }
  }, [selectedProject, loadProjects, loadChanges]);

  // ─── Code Change CRUD ──────────────────────────────────────────────────────

  const createChange = useCallback(async (branch: string) => {
    if (!newChangeName.trim() || !selectedProjectId) return;
    try {
      const res = await fetch("/api/schema-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_code_changes",
          data: {
            projectId: selectedProjectId,
            branch,
            changeName: newChangeName.trim(),
            changeType: newChangeType,
          },
          reasoning: `Added code change "${newChangeName.trim()}" to ${branch}`,
        }),
      });
      if (res.ok) {
        setNewChangeName("");
        setNewChangeType("Working Through");
        setAddingChange(null);
        loadChanges();
      }
    } catch { /* ignore */ }
  }, [selectedProjectId, newChangeName, newChangeType, loadChanges]);

  const updateChange = useCallback(async (changeId: number, data: Partial<CodeChange>) => {
    try {
      await fetch("/api/schema-planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_code_changes",
          id: changeId,
          data,
          reasoning: `Updated code change`,
        }),
      });
      loadChanges();
    } catch { /* ignore */ }
    setEditingCell(null);
  }, [loadChanges]);

  const deleteChange = useCallback(async () => {
    if (!deleteTarget || !deleteReason.trim()) return;
    try {
      await fetch("/api/schema-planner", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_code_changes",
          id: deleteTarget.changeId,
          reasoning: deleteReason,
        }),
      });
      setDeleteTarget(null);
      setDeleteReason("");
      loadChanges();
    } catch { /* ignore */ }
  }, [deleteTarget, deleteReason, loadChanges]);

  // ─── GitHub Sync ───────────────────────────────────────────────────────────

  const syncGitHub = useCallback(async () => {
    if (!selectedProject || syncing) return;
    setSyncing(true);
    setSyncStatus(null);
    try {
      // PAT is read server-side from .github-config.json — no need to send it
      const res = await fetch("/api/projects/github-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProject.projectId }),
      });
      if (res.ok) {
        const result = await res.json() as { synced: number; errors: string[]; rateLimitRemaining: number | null };
        if (result.errors.length > 0) {
          setSyncStatus(`Synced ${result.synced} commits. Errors: ${result.errors.join("; ")}`);
        } else {
          setSyncStatus(`Synced ${result.synced} new commit${result.synced !== 1 ? "s" : ""}${result.rateLimitRemaining !== null ? ` (${result.rateLimitRemaining} API calls remaining)` : ""}`);
        }
        await loadChanges();
        await loadProjects();
      } else {
        setSyncStatus("Sync failed: " + res.statusText);
      }
    } catch (e) {
      setSyncStatus("Sync error: " + (e as Error).message);
    }
    setSyncing(false);
  }, [selectedProject, syncing, loadChanges, loadProjects]);

  // Auto-sync on project select (if it has a repo)
  useEffect(() => {
    if (selectedProject?.githubRepo && !syncing) {
      syncGitHub();
    }
    // Only trigger on project selection change, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  // ─── GitHub Import / Create ────────────────────────────────────────────────

  const loadGithubRepos = useCallback(async () => {
    setGithubReposLoading(true);
    setGithubReposError(null);
    try {
      const res = await fetch("/api/projects/github-repos");
      if (!res.ok) {
        const err = await res.json() as { error: string };
        setGithubReposError(err.error || res.statusText);
        setGithubRepos([]);
      } else {
        const repos = await res.json();
        setGithubRepos(repos);
      }
    } catch (e) {
      setGithubReposError((e as Error).message);
    }
    setGithubReposLoading(false);
  }, []);

  const importGithubRepo = useCallback(async (repo: { fullName: string; name: string; description: string | null; defaultBranch: string }) => {
    try {
      const res = await fetch("/api/schema-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_projects",
          data: {
            projectName: repo.name,
            description: repo.description,
            githubRepo: repo.fullName,
            branchLiveName: repo.defaultBranch,
            status: "active",
          },
          reasoning: `Imported from GitHub: ${repo.fullName}`,
        }),
      });
      if (res.ok) {
        const created = await res.json() as Project;
        await loadProjects();
        setSelectedProjectId(created.projectId);
      }
    } catch (e) {
      console.error("Import failed:", e);
    }
  }, [loadProjects]);

  const createGithubRepo = useCallback(async () => {
    if (!newRepoName.trim() || creatingRepo) return;
    setCreatingRepo(true);
    try {
      const res = await fetch("/api/projects/github-repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newRepoName.trim(), description: newRepoDesc.trim(), isPrivate: newRepoPrivate }),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        setGithubReposError(err.error || "Failed to create repo");
      } else {
        const repo = await res.json() as { fullName: string; name: string; defaultBranch: string };
        // Create Schema Planner project linked to the new repo
        const projRes = await fetch("/api/schema-planner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            table: "_splan_projects",
            data: {
              projectName: repo.name,
              description: newRepoDesc.trim() || null,
              githubRepo: repo.fullName,
              branchLiveName: repo.defaultBranch,
              status: "active",
            },
            reasoning: `Created new GitHub repo and project: ${repo.fullName}`,
          }),
        });
        if (projRes.ok) {
          const created = await projRes.json() as Project;
          await loadProjects();
          setSelectedProjectId(created.projectId);
          setShowCreateRepo(false);
          setShowGithubImport(false);
          setNewRepoName("");
          setNewRepoDesc("");
        }
      }
    } catch (e) {
      setGithubReposError((e as Error).message);
    }
    setCreatingRepo(false);
  }, [newRepoName, newRepoDesc, newRepoPrivate, creatingRepo, loadProjects]);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <svg className="w-6 h-6 animate-spin" style={{ color: "var(--color-primary)" }} fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div>
      {/* ═══════ PROJECT SELECTOR BAR ═══════ */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={selectedProjectId ?? ""}
          onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
          className="px-3 py-1.5 text-sm rounded border font-medium"
          style={{ backgroundColor: "var(--color-surface)", borderColor: "var(--color-divider)", color: "var(--color-text)", minWidth: 200 }}
        >
          <option value="">Select a project...</option>
          {projects.map(p => (
            <option key={p.projectId} value={p.projectId}>{p.projectName}</option>
          ))}
        </select>

        <button
          onClick={() => { setShowGithubImport(true); loadGithubRepos(); }}
          className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
          style={{ backgroundColor: "rgba(78,203,113,0.12)", color: "#4ecb71", border: "1px solid rgba(78,203,113,0.25)" }}
        >
          + Import / New Project
        </button>

        {selectedProject?.githubRepo && (
          <button
            onClick={syncGitHub}
            disabled={syncing}
            className="px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5"
            style={{ backgroundColor: "rgba(66,139,202,0.12)", color: "#428bca", border: "1px solid rgba(66,139,202,0.25)", opacity: syncing ? 0.6 : 1 }}
          >
            {syncing && (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            Sync GitHub
          </button>
        )}

        {syncStatus && (
          <span className="text-[11px] px-2 py-1 rounded" style={{
            color: syncStatus.includes("error") || syncStatus.includes("Error") || syncStatus.includes("failed") ? "#e05555" : "#4ecb71",
            backgroundColor: syncStatus.includes("error") || syncStatus.includes("Error") || syncStatus.includes("failed") ? "rgba(224,85,85,0.1)" : "rgba(78,203,113,0.1)",
          }}>
            {syncStatus}
          </span>
        )}
      </div>

      {/* ═══════ GITHUB IMPORT / CREATE POPUP ═══════ */}
      {showGithubImport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowGithubImport(false); setShowCreateRepo(false); } }}
        >
          <div
            className="rounded-lg shadow-xl overflow-hidden flex flex-col"
            style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-divider)", width: 600, maxHeight: "80vh" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-divider)" }}>
              <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                {showCreateRepo ? "Create New GitHub Repo" : "Import from GitHub"}
              </span>
              <div className="flex items-center gap-2">
                {!showCreateRepo && (
                  <button
                    onClick={() => setShowCreateRepo(true)}
                    className="text-[11px] px-2 py-1 rounded font-medium"
                    style={{ backgroundColor: "rgba(78,203,113,0.12)", color: "#4ecb71" }}
                  >
                    + Create New Repo
                  </button>
                )}
                <button onClick={() => { setShowGithubImport(false); setShowCreateRepo(false); }} className="text-xs px-2 py-1 rounded hover:bg-white/10" style={{ color: "var(--color-text-muted)" }}>x</button>
              </div>
            </div>

            {showCreateRepo ? (
              /* ─── Create New Repo Form ─── */
              <div className="p-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: "var(--color-text-subtle)" }}>Repository Name</label>
                    <input
                      value={newRepoName}
                      onChange={(e) => setNewRepoName(e.target.value)}
                      placeholder="my-new-project"
                      className="w-full px-2 py-1.5 text-xs rounded border font-mono"
                      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter" && newRepoName.trim()) createGithubRepo(); if (e.key === "Escape") setShowCreateRepo(false); }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: "var(--color-text-subtle)" }}>Description (optional)</label>
                    <input
                      value={newRepoDesc}
                      onChange={(e) => setNewRepoDesc(e.target.value)}
                      placeholder="A brief description..."
                      className="w-full px-2 py-1.5 text-xs rounded border"
                      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--color-text)" }}>
                    <input type="checkbox" checked={newRepoPrivate} onChange={(e) => setNewRepoPrivate(e.target.checked)} />
                    Private repository
                  </label>
                </div>
                {githubReposError && (
                  <div className="mt-3 text-xs px-2 py-1.5 rounded" style={{ color: "#e05555", backgroundColor: "rgba(224,85,85,0.1)" }}>{githubReposError}</div>
                )}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={createGithubRepo}
                    disabled={!newRepoName.trim() || creatingRepo}
                    className="px-3 py-1.5 text-xs rounded font-medium flex items-center gap-1.5"
                    style={{ backgroundColor: "rgba(78,203,113,0.15)", color: "#4ecb71", opacity: newRepoName.trim() && !creatingRepo ? 1 : 0.4 }}
                  >
                    {creatingRepo && <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                    Create Repo & Project
                  </button>
                  <button onClick={() => { setShowCreateRepo(false); setGithubReposError(null); }} className="px-3 py-1.5 text-xs rounded" style={{ color: "var(--color-text-muted)" }}>Back</button>
                </div>
              </div>
            ) : (
              /* ─── Import Existing Repos ─── */
              <div className="flex-1 overflow-y-auto">
                {githubReposLoading && (
                  <div className="flex justify-center py-8">
                    <svg className="w-5 h-5 animate-spin" style={{ color: "var(--color-primary)" }} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                )}
                {githubReposError && (
                  <div className="m-4 text-xs px-3 py-2 rounded" style={{ color: "#e05555", backgroundColor: "rgba(224,85,85,0.1)" }}>
                    {githubReposError}
                    {githubReposError.includes("PAT") && (
                      <span className="block mt-1" style={{ color: "var(--color-text-muted)" }}>Go to Settings tab to add your GitHub Personal Access Token.</span>
                    )}
                  </div>
                )}
                {!githubReposLoading && !githubReposError && githubRepos.length === 0 && (
                  <div className="text-center py-8 text-xs" style={{ color: "var(--color-text-muted)" }}>No repositories found</div>
                )}
                {!githubReposLoading && githubRepos.length > 0 && (
                  <div className="divide-y" style={{ borderColor: "var(--color-divider)" }}>
                    {githubRepos.map(repo => {
                      const alreadyImported = projects.some(p => p.githubRepo === repo.fullName);
                      return (
                        <div key={repo.fullName} className="flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02]">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium truncate" style={{ color: "var(--color-text)" }}>{repo.fullName}</span>
                              {repo.isPrivate && (
                                <span className="text-[9px] px-1 py-0 rounded" style={{ backgroundColor: "rgba(242,182,97,0.15)", color: "#f2b661" }}>private</span>
                              )}
                            </div>
                            {repo.description && (
                              <div className="text-[10px] truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>{repo.description}</div>
                            )}
                          </div>
                          {alreadyImported ? (
                            <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: "#4ecb71", backgroundColor: "rgba(78,203,113,0.1)" }}>Imported</span>
                          ) : (
                            <button
                              onClick={() => importGithubRepo(repo)}
                              className="text-[11px] px-2.5 py-1 rounded font-medium transition-colors hover:bg-white/5"
                              style={{ color: "var(--color-primary)" }}
                            >
                              Import
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ PROJECT DETAIL BAR ═══════ */}
      {selectedProject && (
        <div className="mb-4 p-3 rounded border" style={{ backgroundColor: "var(--color-surface)", borderColor: "var(--color-divider)" }}>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              {editingProject?.field === "projectName" ? (
                <input
                  defaultValue={selectedProject.projectName}
                  className="text-sm font-semibold px-1 py-0.5 rounded border"
                  style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)", color: "var(--color-text)" }}
                  autoFocus
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value !== selectedProject.projectName) updateProject({ projectName: e.target.value.trim() }); else setEditingProject(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingProject(null); }}
                />
              ) : (
                <span className="text-sm font-semibold cursor-pointer hover:underline" style={{ color: "var(--color-text)" }} onClick={() => setEditingProject({ field: "projectName" })}>
                  {selectedProject.projectName}
                </span>
              )}
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                backgroundColor: selectedProject.status === "active" ? "rgba(78,203,113,0.15)" : "rgba(102,102,128,0.15)",
                color: selectedProject.status === "active" ? "#4ecb71" : "#666680",
              }}>
                {selectedProject.status}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {!deleteProjectConfirm ? (
                <button onClick={() => setDeleteProjectConfirm(true)} className="text-[10px] px-2 py-0.5 rounded hover:bg-white/5" style={{ color: "#e05555" }}>Delete</button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px]" style={{ color: "#e05555" }}>Delete this project and all its changes?</span>
                  <button onClick={deleteProject} className="text-[10px] px-2 py-0.5 rounded font-medium" style={{ backgroundColor: "rgba(224,85,85,0.15)", color: "#e05555" }}>Yes</button>
                  <button onClick={() => setDeleteProjectConfirm(false)} className="text-[10px] px-2 py-0.5 rounded" style={{ color: "var(--color-text-muted)" }}>No</button>
                </div>
              )}
            </div>
          </div>

          {/* Editable fields */}
          <div className="grid grid-cols-3 gap-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
            {/* Description */}
            <div className="col-span-3">
              <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--color-text-subtle)" }}>Description</span>
              {editingProject?.field === "description" ? (
                <textarea
                  defaultValue={selectedProject.description || ""}
                  className="w-full mt-1 px-2 py-1 text-xs rounded border resize-y"
                  style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)", color: "var(--color-text)", minHeight: 40 }}
                  autoFocus
                  onBlur={(e) => updateProject({ description: e.target.value || null })}
                  onKeyDown={(e) => { if (e.key === "Escape") setEditingProject(null); }}
                />
              ) : (
                <div className="mt-1 cursor-pointer hover:bg-white/5 rounded px-1 py-0.5" onClick={() => setEditingProject({ field: "description" })}>
                  {selectedProject.description || <span style={{ color: "var(--color-text-subtle)" }}>Click to add description...</span>}
                </div>
              )}
            </div>

            {/* GitHub Repo */}
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--color-text-subtle)" }}>GitHub Repo</span>
              {editingProject?.field === "githubRepo" ? (
                <input
                  defaultValue={selectedProject.githubRepo || ""}
                  placeholder="owner/repo"
                  className="w-full mt-1 px-2 py-1 text-xs rounded border"
                  style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)", color: "var(--color-text)" }}
                  autoFocus
                  onBlur={(e) => updateProject({ githubRepo: e.target.value || null })}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingProject(null); }}
                />
              ) : (
                <div className="mt-1 cursor-pointer hover:bg-white/5 rounded px-1 py-0.5 font-mono" onClick={() => setEditingProject({ field: "githubRepo" })}>
                  {selectedProject.githubRepo || <span style={{ color: "var(--color-text-subtle)" }}>—</span>}
                </div>
              )}
            </div>

            {/* Branch Names */}
            {BRANCHES.map(b => {
              const nameKey = b.key === "live" ? "branchLiveName" : b.key === "primary_dev" ? "branchPrimaryName" : "branchSecondaryName";
              const value = selectedProject[nameKey as keyof Project] as string;
              return (
                <div key={b.key}>
                  <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--color-text-subtle)" }}>{b.label} Branch</span>
                  {editingProject?.field === nameKey ? (
                    <input
                      defaultValue={value}
                      className="w-full mt-1 px-2 py-1 text-xs rounded border font-mono"
                      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)", color: "var(--color-text)" }}
                      autoFocus
                      onBlur={(e) => updateProject({ [nameKey]: e.target.value || value } as Partial<Project>)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingProject(null); }}
                    />
                  ) : (
                    <div className="mt-1 cursor-pointer hover:bg-white/5 rounded px-1 py-0.5 font-mono" onClick={() => setEditingProject({ field: nameKey })}>
                      {value}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════ NO PROJECT SELECTED ═══════ */}
      {!selectedProject && projects.length > 0 && (
        <div className="text-center py-12 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Select a project to view code changes
        </div>
      )}
      {!selectedProject && projects.length === 0 && !showGithubImport && (
        <div className="text-center py-12">
          <div className="text-sm mb-2" style={{ color: "var(--color-text-muted)" }}>No projects yet</div>
          <button
            onClick={() => { setShowGithubImport(true); loadGithubRepos(); }}
            className="px-4 py-2 text-xs font-medium rounded"
            style={{ backgroundColor: "rgba(78,203,113,0.12)", color: "#4ecb71", border: "1px solid rgba(78,203,113,0.25)" }}
          >
            Import from GitHub or create new
          </button>
        </div>
      )}

      {/* ═══════ BRANCH SECTIONS ═══════ */}
      {selectedProject && BRANCHES.map(branch => {
        const branchChanges = projectChanges
          .filter(c => c.branch === branch.key)
          .sort((a, b) => (a.implementationGroup ?? 0) - (b.implementationGroup ?? 0) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        const branchNameKey = branch.key === "live" ? "branchLiveName" : branch.key === "primary_dev" ? "branchPrimaryName" : "branchSecondaryName";
        const branchDisplayName = selectedProject[branchNameKey as keyof Project] as string;

        return (
          <div key={branch.key} className="mb-6">
            {/* Branch header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold" style={{ color: "var(--color-text)" }}>
                  <span style={{ fontSize: "1.25rem", color: branch.key === "live" ? "#4ecb71" : branch.key === "primary_dev" ? "#f0c040" : "#e8853d" }}>{branch.label}</span>: Code Change Records
                </h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-background)", color: "var(--color-text-muted)" }}>
                  {branchDisplayName}
                </span>
                <span className="text-[10px]" style={{ color: "var(--color-text-subtle)" }}>
                  {branchChanges.length} change{branchChanges.length !== 1 ? "s" : ""}
                </span>
              </div>
              <button
                onClick={() => { setAddingChange({ branch: branch.key }); setNewChangeName(""); setNewChangeType("Working Through"); }}
                className="text-[10px] px-2 py-1 rounded font-medium transition-colors hover:bg-white/5"
                style={{ color: "#4ecb71" }}
              >
                + Add Change
              </button>
            </div>

            {/* Add change inline form */}
            {addingChange?.branch === branch.key && (
              <div className="mb-2 flex items-center gap-2 p-2 rounded border" style={{ backgroundColor: "var(--color-surface)", borderColor: "var(--color-divider)" }}>
                <input
                  ref={addInputRef}
                  value={newChangeName}
                  onChange={(e) => setNewChangeName(e.target.value)}
                  placeholder="Change name..."
                  className="flex-1 px-2 py-1 text-xs rounded border"
                  style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") createChange(branch.key); if (e.key === "Escape") setAddingChange(null); }}
                />
                <select
                  value={newChangeType}
                  onChange={(e) => setNewChangeType(e.target.value)}
                  className="px-2 py-1 text-xs rounded border"
                  style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
                >
                  {CHANGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={() => createChange(branch.key)} disabled={!newChangeName.trim()} className="px-2 py-1 text-xs rounded font-medium" style={{ backgroundColor: "rgba(78,203,113,0.15)", color: "#4ecb71", opacity: newChangeName.trim() ? 1 : 0.4 }}>Add</button>
                <button onClick={() => setAddingChange(null)} className="px-2 py-1 text-xs rounded" style={{ color: "var(--color-text-muted)" }}>Cancel</button>
              </div>
            )}

            {/* Code changes table */}
            {branchChanges.length > 0 ? (
              <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--color-divider)" }}>
                <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "var(--color-surface)" }}>
                      {["#", "Change Name", "Type", "Files", "Dependencies", "Prompt", "Results", "Context", "Commit", "Created", "", ""].map((h, i) => (
                        <th key={i} className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "var(--color-text-subtle)", borderBottom: "1px solid var(--color-divider)" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {branchChanges.map((ch, idx) => {
                      const resolvedDeps = (ch.dependencies || []).map(resolveDep);
                      const contextText = buildContextColumn(ch, selectedProject, resolvedDeps, 0);
                      const prevGroup = idx > 0 ? branchChanges[idx - 1].implementationGroup : null;
                      const showGroupDivider = idx > 0 && ch.implementationGroup !== prevGroup;

                      return (
                        <React.Fragment key={ch.changeId}>
                          {showGroupDivider && (
                            <tr><td colSpan={12} style={{ height: 4, backgroundColor: "var(--color-divider)" }} /></tr>
                          )}
                          <tr
                            className="hover:bg-white/[0.02] transition-colors"
                            style={{ borderBottom: "1px solid var(--color-divider)" }}
                          >
                            {/* # Group */}
                            <td className="px-2 py-1.5 text-center font-mono" style={{ color: "var(--color-text-subtle)", width: 36 }}>
                              {ch.implementationGroup ?? "—"}
                            </td>

                            {/* Change Name — clickable to show linked entity popup, double-click to edit */}
                            <td className="px-2 py-1.5" style={{ color: "var(--color-text)", maxWidth: 260 }}>
                              {editingCell?.changeId === ch.changeId && editingCell.field === "changeName" ? (
                                <input
                                  defaultValue={ch.changeName}
                                  className="w-full px-1 py-0.5 text-xs rounded border"
                                  style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)", color: "var(--color-text)" }}
                                  autoFocus
                                  onBlur={(e) => { if (e.target.value.trim()) updateChange(ch.changeId, { changeName: e.target.value.trim() }); else setEditingCell(null); }}
                                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); }}
                                />
                              ) : (
                                <div>
                                  <span
                                    className="truncate block"
                                    style={{
                                      cursor: ch.linkedEntityType ? "pointer" : "default",
                                      color: ch.linkedEntityType ? ({
                                        feature: "#e67d4a", module: "#5bc0de", concept: "#f2b661",
                                        data_table: "#a855f7", data_field: "#4ecb71",
                                      } as Record<string, string>)[ch.linkedEntityType] || "var(--color-text)" : "var(--color-text)",
                                    }}
                                    onClick={() => {
                                      if (ch.linkedEntityType && ch.linkedEntityId) {
                                        setEntityPopup({ entityType: ch.linkedEntityType, entityId: ch.linkedEntityId });
                                      }
                                    }}
                                    onDoubleClick={() => setEditingCell({ changeId: ch.changeId, field: "changeName" })}
                                    title={ch.linkedEntityType ? `Click to view ${ch.linkedEntityType.replace(/_/g, " ")} details` : "Double-click to edit"}
                                  >
                                    {ch.changeName}
                                  </span>
                                  {/* Linked data tables/fields pills for data changes */}
                                  {(ch.linkedTables?.length > 0 || ch.linkedFields?.length > 0) && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {(ch.linkedTables || []).map((tid: number) => {
                                        const t = allDataTables.find((dt) => (dt as Record<string, unknown>).tableId === tid);
                                        const name = t ? String((t as Record<string, unknown>).tableName ?? `#${tid}`) : `#${tid}`;
                                        return (
                                          <span
                                            key={`t${tid}`}
                                            className="text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer hover:opacity-80"
                                            style={{ backgroundColor: "rgba(168,85,247,0.15)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.3)" }}
                                            onClick={() => setEntityPopup({ entityType: "data_table", entityId: tid })}
                                            title={`Table: ${name}`}
                                          >
                                            T: {name.length > 15 ? name.substring(0, 15) + "..." : name}
                                          </span>
                                        );
                                      })}
                                      {(ch.linkedFields || []).map((fid: number) => {
                                        const f = allDataFields.find((df) => (df as Record<string, unknown>).fieldId === fid);
                                        const name = f ? String((f as Record<string, unknown>).fieldName ?? `#${fid}`) : `#${fid}`;
                                        return (
                                          <span
                                            key={`f${fid}`}
                                            className="text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer hover:opacity-80"
                                            style={{ backgroundColor: "rgba(78,203,113,0.15)", color: "#4ecb71", border: "1px solid rgba(78,203,113,0.3)" }}
                                            onClick={() => setEntityPopup({ entityType: "data_field", entityId: fid })}
                                            title={`Field: ${name}`}
                                          >
                                            F: {name.length > 15 ? name.substring(0, 15) + "..." : name}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Type */}
                            <td className="px-2 py-1.5">
                              {editingCell?.changeId === ch.changeId && editingCell.field === "changeType" ? (
                                <select
                                  defaultValue={ch.changeType}
                                  className="px-1 py-0.5 text-[10px] rounded border"
                                  style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)", color: "var(--color-text)" }}
                                  autoFocus
                                  onChange={(e) => updateChange(ch.changeId, { changeType: e.target.value })}
                                  onBlur={() => setEditingCell(null)}
                                >
                                  {CHANGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              ) : (
                                <span className="cursor-pointer" onClick={() => setEditingCell({ changeId: ch.changeId, field: "changeType" })}>
                                  <Pill value={ch.changeType} colors={CHANGE_TYPE_COLORS} />
                                </span>
                              )}
                            </td>

                            {/* Files */}
                            <td className="px-2 py-1.5" style={{ maxWidth: 150 }}>
                              {editingCell?.changeId === ch.changeId && editingCell.field === "fileLocations" ? (
                                <textarea
                                  defaultValue={ch.fileLocations || ""}
                                  className="w-full px-1 py-0.5 text-[10px] rounded border resize-y"
                                  style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)", color: "var(--color-text)", minHeight: 40 }}
                                  autoFocus
                                  onBlur={(e) => { updateChange(ch.changeId, { fileLocations: e.target.value || null }); }}
                                  onKeyDown={(e) => { if (e.key === "Escape") setEditingCell(null); }}
                                />
                              ) : (
                                <span className="cursor-pointer text-[10px] font-mono" style={{ color: "var(--color-text-muted)" }} onClick={() => setEditingCell({ changeId: ch.changeId, field: "fileLocations" })}>
                                  {ch.fileLocations ? (
                                    ch.changeType === "Prototype" ? (
                                      <a
                                        href={`http://localhost:5173/prototypes/${ch.fileLocations.split("\n")[0]}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:underline"
                                        style={{ color: "var(--color-primary)" }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {ch.fileLocations.split("\n")[0]}
                                        {ch.fileLocations.includes("\n") && ` +${ch.fileLocations.split("\n").length - 1}`}
                                      </a>
                                    ) : (
                                      <ExpandableText value={ch.fileLocations.replace(/\n/g, ", ")} maxLen={30} />
                                    )
                                  ) : "—"}
                                </span>
                              )}
                            </td>

                            {/* Dependencies */}
                            <td className="px-2 py-1.5" style={{ maxWidth: 180 }}>
                              <div className="flex flex-wrap gap-0.5 items-center">
                                {resolvedDeps.slice(0, 3).map(d => (
                                  <span
                                    key={`${d.type}-${d.id}`}
                                    className="inline-flex items-center px-1 py-0 rounded text-[9px] font-medium"
                                    style={{ backgroundColor: `${DEP_TYPE_COLORS[d.type]}15`, color: DEP_TYPE_COLORS[d.type] }}
                                  >
                                    {DEP_TYPE_LABELS[d.type]?.charAt(0)}: {d.name.length > 12 ? d.name.substring(0, 12) + "…" : d.name}
                                  </span>
                                ))}
                                {resolvedDeps.length > 3 && (
                                  <span className="text-[9px]" style={{ color: "var(--color-text-subtle)" }}>+{resolvedDeps.length - 3}</span>
                                )}
                                <button
                                  onClick={() => setDepPickerTarget(ch)}
                                  className="text-[10px] px-1 rounded hover:bg-white/10"
                                  style={{ color: "var(--color-primary)" }}
                                  title="Edit dependencies"
                                >
                                  {resolvedDeps.length === 0 ? "+" : "edit"}
                                </button>
                              </div>
                            </td>

                            {/* Prompt */}
                            <td className="px-2 py-1.5" style={{ maxWidth: 120 }}>
                              {ch.implementationPrompt ? (
                                <button onClick={() => setExpandedPrompt(ch)} className="text-[10px] hover:underline truncate block text-left" style={{ color: "var(--color-text-muted)", maxWidth: 120 }}>
                                  {ch.implementationPrompt.substring(0, 40)}...
                                </button>
                              ) : (
                                <button onClick={() => setExpandedPrompt(ch)} className="text-[10px]" style={{ color: "var(--color-text-subtle)" }}>+ add</button>
                              )}
                            </td>

                            {/* Results */}
                            <td className="px-2 py-1.5" style={{ maxWidth: 120 }}>
                              {ch.executionResults ? (
                                <button onClick={() => setExpandedResults(ch)} className="text-[10px] hover:underline truncate block text-left" style={{ color: "var(--color-text-muted)", maxWidth: 120 }}>
                                  {ch.executionResults.substring(0, 40)}...
                                </button>
                              ) : (
                                <button onClick={() => setExpandedResults(ch)} className="text-[10px]" style={{ color: "var(--color-text-subtle)" }}>+ add</button>
                              )}
                            </td>

                            {/* Context (computed) */}
                            <td className="px-2 py-1.5">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(contextText);
                                }}
                                className="text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
                                style={{ color: "var(--color-primary)" }}
                                title={contextText}
                              >
                                Copy
                              </button>
                            </td>

                            {/* Commit */}
                            <td className="px-2 py-1.5 font-mono text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                              {ch.githubCommitHash ? (
                                <a
                                  href={ch.githubCommitUrl || "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline"
                                  style={{ color: "var(--color-primary)" }}
                                >
                                  {ch.githubCommitHash.substring(0, 7)}
                                </a>
                              ) : "—"}
                            </td>

                            {/* Created */}
                            <td className="px-2 py-1.5 text-[10px] whitespace-nowrap" style={{ color: "var(--color-text-subtle)" }}>
                              {new Date(ch.createdAt).toLocaleDateString()}
                            </td>

                            {/* Retry */}
                            <td className="px-2 py-1.5">
                              <button
                                onClick={() => setRetryTarget(ch)}
                                className="text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
                                style={{ color: "#f2b661" }}
                                title="Generate retry prompt"
                              >
                                Retry
                              </button>
                            </td>

                            {/* Delete */}
                            <td className="px-2 py-1.5">
                              <button
                                onClick={() => setDeleteTarget(ch)}
                                className="text-[10px] px-1 py-0.5 rounded hover:bg-white/10 transition-colors"
                                style={{ color: "#e05555" }}
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-4 text-xs rounded border" style={{ color: "var(--color-text-subtle)", borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)" }}>
                No changes on this branch yet
              </div>
            )}
          </div>
        );
      })}

      {/* ═══════ DEPENDENCY PICKER POPUP ═══════ */}
      {depPickerTarget && (
        <DependencyPicker
          deps={depPickerTarget.dependencies || []}
          onChange={(newDeps) => {
            updateChange(depPickerTarget.changeId, { dependencies: newDeps } as unknown as Partial<CodeChange>);
            setDepPickerTarget({ ...depPickerTarget, dependencies: newDeps });
          }}
          allModules={allModules}
          allFeatures={allFeatures}
          allConcepts={allConcepts}
          allDataTables={allDataTables}
          allDataFields={allDataFields}
          onClose={() => setDepPickerTarget(null)}
        />
      )}

      {/* ═══════ RETRY PROMPT POPUP ═══════ */}
      {retryTarget && selectedProject && (
        <RetryPromptPopup
          change={retryTarget}
          project={selectedProject}
          resolvedDeps={(retryTarget.dependencies || []).map(resolveDep)}
          onClose={() => setRetryTarget(null)}
        />
      )}

      {/* ═══════ EXPANDED PROMPT POPUP ═══════ */}
      {expandedPrompt && selectedProject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setExpandedPrompt(null); }}
        >
          <div className="rounded-lg shadow-xl overflow-hidden flex flex-col" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-divider)", width: 600, maxHeight: "80vh" }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-divider)" }}>
              <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Implementation Prompt</span>
              <button onClick={() => setExpandedPrompt(null)} className="text-xs px-2 py-1 rounded hover:bg-white/10" style={{ color: "var(--color-text-muted)" }}>×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] font-medium" style={{ color: "var(--color-text-subtle)" }}>Template for: </span>
                <Pill value={expandedPrompt.changeType} colors={CHANGE_TYPE_COLORS} />
              </div>
              <textarea
                defaultValue={expandedPrompt.implementationPrompt || buildPromptTemplate(expandedPrompt.changeType, expandedPrompt, selectedProject, (expandedPrompt.dependencies || []).map(resolveDep))}
                className="w-full px-3 py-2 text-xs font-mono rounded border resize-y"
                style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)", minHeight: 200 }}
                onBlur={(e) => {
                  updateChange(expandedPrompt.changeId, { implementationPrompt: e.target.value || null });
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══════ EXPANDED RESULTS POPUP ═══════ */}
      {expandedResults && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setExpandedResults(null); }}
        >
          <div className="rounded-lg shadow-xl overflow-hidden flex flex-col" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-divider)", width: 600, maxHeight: "80vh" }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-divider)" }}>
              <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Execution Results</span>
              <button onClick={() => setExpandedResults(null)} className="text-xs px-2 py-1 rounded hover:bg-white/10" style={{ color: "var(--color-text-muted)" }}>×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <textarea
                defaultValue={expandedResults.executionResults || ""}
                placeholder="Paste execution results here..."
                className="w-full px-3 py-2 text-xs font-mono rounded border resize-y"
                style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)", minHeight: 200 }}
                onBlur={(e) => {
                  updateChange(expandedResults.changeId, { executionResults: e.target.value || null });
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══════ DELETE CONFIRMATION ═══════ */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setDeleteTarget(null); setDeleteReason(""); } }}
        >
          <div className="rounded-lg shadow-xl p-4" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-divider)", width: 400 }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "var(--color-text)" }}>Delete "{deleteTarget.changeName}"?</div>
            <input
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Reason for deletion..."
              className="w-full px-2 py-1.5 text-xs rounded border mb-3"
              style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && deleteReason.trim()) deleteChange(); if (e.key === "Escape") { setDeleteTarget(null); setDeleteReason(""); } }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDeleteTarget(null); setDeleteReason(""); }} className="px-3 py-1 text-xs rounded" style={{ color: "var(--color-text-muted)" }}>Cancel</button>
              <button onClick={deleteChange} disabled={!deleteReason.trim()} className="px-3 py-1 text-xs rounded font-medium" style={{ backgroundColor: "rgba(224,85,85,0.15)", color: "#e05555", opacity: deleteReason.trim() ? 1 : 0.4 }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Entity detail popup */}
      {entityPopup && (
        <EntityDetailPopup
          entityType={entityPopup.entityType}
          entityId={entityPopup.entityId}
          onClose={() => setEntityPopup(null)}
        />
      )}
    </div>
  );
}
