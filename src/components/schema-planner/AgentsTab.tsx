import React, { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentParam {
  key: string;
  label: string;
  type: "text" | "select";
  options?: string[];
  placeholder?: string;
}

interface AgentPrompt {
  label: string;
  prompt: string;
  params?: AgentParam[];
}

interface AgentDef {
  id: string;
  name: string;
  icon: string;
  tier: 1 | 2;
  description: string;
  prompts: AgentPrompt[];
  schedulable?: boolean;
}

interface PromptConfig {
  customPrompt?: string;
  paramDefaults?: Record<string, string>;
}

interface ScheduleConfig {
  cronExpression: string;
  cronLabel: string;
  scheduleTime: ScheduleTime;
  promptOverride?: string;
  paramDefaults?: Record<string, string>;
  triggerId?: string;
  enabled: boolean;
}

interface HistoryEntry {
  ts: number;
  runId: string;
  agentId: string;
  agentName: string;
  promptLabel: string;
  params?: Record<string, string>;
}

interface AgentResult {
  status: "success" | "partial" | "failed";
  summary: string;
  issues?: { problem: string; resolution: string }[];
  findings?: string[];
  completedAt?: number;
}

// ─── Agent definitions ───────────────────────────────────────────────────────

const ENTITY_TYPE_OPTIONS = ["feature", "module", "table", "field", "concept"];

const AGENTS: AgentDef[] = [
  {
    id: "schema-integrity",
    name: "Schema Integrity",
    icon: "🛡",
    tier: 1,
    description:
      "Validates the entire Schema Planner database for data quality — orphaned fields, missing references, empty tables, and inconsistent cross-links.",
    prompts: [
      {
        label: "Validate data quality",
        prompt:
          'Use the /schema skill. Run schema_list for every entity type (modules, features, data_tables, data_fields, concepts, tests). For each, check: fields referencing deleted tables, tables with zero fields, features with no module, concerns with no mitigations, and empty required text fields. Report a prioritized list of issues found. Do NOT fix anything yet — just report.',
      },
      {
        label: "Auto-fix issues",
        prompt:
          'Use the /schema skill. Run schema_list for every entity type and identify data quality issues: orphaned foreign keys, broken cross-references, and missing required fields. For each issue, use schema_update to fix it — re-link orphaned fields, remove stale references, and fill obvious defaults. Log each fix with reasoning via schema_discuss. Report what was fixed.',
      },
    ],
  },
  {
    id: "impact-analysis",
    name: "Impact Analysis",
    icon: "🔍",
    tier: 1,
    description:
      "Traces downstream dependencies from any changed entity — finds affected tests, code changes, access rules, and concerns that may be stale.",
    prompts: [
      {
        label: "Trace from entity",
        params: [
          { key: "entityType", label: "Entity type", type: "select", options: ENTITY_TYPE_OPTIONS },
          { key: "entityName", label: "Entity name", type: "text", placeholder: "e.g. users, auth_tokens" },
        ],
        prompt:
          'Use the /schema skill. The entity that changed is a {{entityType}} named "{{entityName}}". Use schema_search and schema_get to find everything that depends on it: tests covering that entity, code changes referencing it, access rules for it, concerns linked to it, and modules that use it. Build a dependency tree and report what is downstream of the change.',
      },
      {
        label: "Flag stale tests",
        prompt:
          'Use the /schema skill. List all tests via schema_list. For each test, use schema_get on its linked feature/concept/module. Compare the test updatedAt vs the entity updatedAt — if the entity was modified more recently than the test, flag the test as potentially stale. Report all stale tests grouped by entity, with the time gap.',
      },
    ],
  },
  {
    id: "test-coverage",
    name: "Test Coverage",
    icon: "✅",
    tier: 1,
    description:
      "Detects testing gaps across features, modules, and concepts — then scaffolds draft tests for uncovered entities.",
    prompts: [
      {
        label: "Find coverage gaps",
        prompt:
          'Use the /schema skill. List all features, modules, and concepts via schema_list. For each, check its _testCount. Report entities with zero tests, entities with only one test type (e.g. unit but no integration), and high-priority features (priority 1-2) that have only draft-status tests. Group the report by severity.',
      },
      {
        label: "Scaffold draft tests",
        prompt:
          'Use the /schema skill. List all features via schema_list. Find features with zero or low test coverage (_testCount < 2). For each uncovered feature, read its description, implementation notes, and linked concerns via schema_get. Then use schema_create to generate draft tests — include a title, description, preconditions derived from concerns, and expected results derived from the feature description. Create 2-3 tests per feature covering different test types (unit, integration, acceptance).',
      },
    ],
  },
  {
    id: "access-auditor",
    name: "Access Rule Auditor",
    icon: "🔒",
    tier: 2,
    description:
      "Scans the data access matrix for gaps — tables missing rules for certain roles, tiers, or user types.",
    prompts: [
      {
        label: "Audit access gaps",
        prompt:
          'Use the /schema skill. List all data tables via schema_list. For each table, fetch its access rules. Identify tables with no access rules at all, and tables where rules exist but are missing coverage for common roles or tiers visible in other tables\u0027 rules. Report the gaps as a matrix showing table vs role coverage.',
      },
    ],
  },
  {
    id: "concept-researcher",
    name: "Concept Researcher",
    icon: "🔬",
    tier: 2,
    schedulable: true,
    description:
      "Reviews concepts from your knowledge base and researches new or related information on each topic. Can be scheduled to run automatically on a recurring basis.",
    prompts: [
      {
        label: "Research concepts",
        params: [
          { key: "count", label: "How many concepts", type: "select", options: ["1", "2", "3", "5", "10"] },
          { key: "filter", label: "Status filter", type: "select", options: ["all", "draft", "active", "review", "archived"] },
        ],
        prompt:
          'Use the /schema skill. List all concepts via schema_list. {{filter_instruction}} Select up to {{count}} concepts, prioritizing those with the oldest updated_at timestamps (least recently reviewed). For each selected concept, do the following:\n1. Read the concept details via schema_get to understand the topic, description, and any existing notes.\n2. Use web search to find recent developments, related research, new tools, or updated best practices related to the concept topic.\n3. Summarize what you found — highlight anything new or changed since the concept was last updated.\n4. For each concept with findings, use schema_create to create a record in the _splan_research table with: title (a short descriptive title), concept_id (the concept ID), summary (1-2 sentence overview), findings (detailed text of what you found), sources (JSON array of objects with url, title, and snippet fields for each source you referenced), status set to "new".\n5. After creating the research record, update the concept notes via schema_update to append a reference to the research record using the format (r:RESEARCH_ID:title) so it appears as a clickable link in the concept notes.\n\nReport a summary for each concept researched: concept name, what was searched, key findings, the research record ID created, and sources found.',
      },
    ],
  },
  {
    id: "github-sync",
    name: "GitHub Sync Monitor",
    icon: "📡",
    tier: 2,
    description:
      "Syncs recent commits from GitHub-connected projects and links them to features and modules.",
    prompts: [
      {
        label: "Sync and link commits",
        prompt:
          'Use the /schema skill. List all projects via schema_list. For each project that has a GitHub repo configured, call the GitHub sync endpoint (POST /api/projects/github-sync with the projectId). Then review the newly synced code changes — check their commit messages and file paths against feature names and module names. Suggest dependency links for any unlinked code changes. Report what was synced and what was linked.',
      },
    ],
  },
  {
    id: "discussion-digest",
    name: "Discussion Digest",
    icon: "💬",
    tier: 2,
    description:
      "Summarizes all analysis discussions attached to an entity into a concise digest.",
    prompts: [
      {
        label: "Summarize discussions",
        params: [
          { key: "entityType", label: "Entity type", type: "select", options: ENTITY_TYPE_OPTIONS },
          { key: "entityName", label: "Entity name", type: "text", placeholder: "e.g. Authentication, users" },
        ],
        prompt:
          'Use the /schema skill. Summarize discussions for the {{entityType}} named "{{entityName}}". Use schema_search to find it, then fetch all its discussions. Group discussions by topic and date. Produce a concise digest: key decisions made, open questions remaining, and any contradictions between different analysis sessions. Format as a brief markdown report.',
      },
    ],
  },
  {
    id: "impl-tracker",
    name: "Implementation Tracker",
    icon: "📊",
    tier: 2,
    description:
      "Reviews implementation steps across features and reports progress, blockers, and suggested next actions.",
    prompts: [
      {
        label: "Track progress",
        prompt:
          'Use the /schema skill. List all features via schema_list. For each feature that has implementation steps, fetch the steps and group by status (pending, in-progress, done). Calculate completion percentage per feature. Identify features with steps stuck in "in-progress" for a long time, and features with all steps done but status not marked complete. Report a progress dashboard sorted by completion percentage.',
      },
    ],
  },
];

// ─── Schedule time helpers ───────────────────────────────────────────────────

type FrequencyType = "daily" | "weekdays" | "every_n_hours";

const US_TIMEZONES = [
  { label: "Eastern (ET)",  value: "America/New_York" },
  { label: "Central (CT)",  value: "America/Chicago" },
  { label: "Mountain (MT)", value: "America/Denver" },
  { label: "Pacific (PT)",  value: "America/Los_Angeles" },
];

const WEEKDAY_LABELS = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12
const MINUTE_OPTIONS = [0, 15, 30, 45];
const N_HOURS_OPTIONS = [1, 2, 3, 4, 6, 8, 12];

interface ScheduleTime {
  frequency: FrequencyType;
  hour: number;    // 1-12
  minute: number;  // 0,15,30,45
  ampm: "AM" | "PM";
  timezone: string;
  weekdays: number[]; // 0-6, only used when frequency === "weekdays"
  everyNHours: number; // only used when frequency === "every_n_hours"
}

function to24(hour: number, ampm: "AM" | "PM"): number {
  if (ampm === "AM") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function cronFromSchedule(s: ScheduleTime): string {
  if (s.frequency === "every_n_hours") {
    return `0 */${s.everyNHours} * * *`;
  }
  const h24 = to24(s.hour, s.ampm);
  if (s.frequency === "daily") {
    return `${s.minute} ${h24} * * *`;
  }
  // weekdays — specific days
  const days = s.weekdays.length > 0 ? s.weekdays.sort().join(",") : "1-5";
  return `${s.minute} ${h24} * * ${days}`;
}

function labelFromSchedule(s: ScheduleTime): string {
  if (s.frequency === "every_n_hours") {
    const tzShort = US_TIMEZONES.find((t) => t.value === s.timezone)?.label || s.timezone;
    return `Every ${s.everyNHours}h (${tzShort})`;
  }
  const timeStr = `${s.hour}:${s.minute.toString().padStart(2, "0")} ${s.ampm}`;
  const tzShort = US_TIMEZONES.find((t) => t.value === s.timezone)?.label || s.timezone;
  if (s.frequency === "daily") {
    return `Daily at ${timeStr} ${tzShort}`;
  }
  const dayNames = s.weekdays.map((d) => WEEKDAY_LABELS[d]?.label).join(", ");
  return `${dayNames || "Weekdays"} at ${timeStr} ${tzShort}`;
}

function defaultScheduleTime(): ScheduleTime {
  return { frequency: "daily", hour: 9, minute: 0, ampm: "AM", timezone: "America/New_York", weekdays: [1, 2, 3, 4, 5], everyNHours: 6 };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function interpolate(template: string, params: Record<string, string>): string {
  let result = template.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] || `{{${key}}}`);
  // Handle filter_instruction for concept researcher
  if (params.filter && params.filter !== "all") {
    result = result.replace("{{filter_instruction}}", `Filter to concepts with status "${params.filter}".`);
  } else {
    result = result.replace("{{filter_instruction}}", "Consider all concepts regardless of status.");
  }
  return result;
}

function pKey(agentId: string, idx: number) {
  return `${agentId}-${idx}`;
}

function generateRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `run-${ts}-${rand}`;
}

function buildReportingBlock(runId: string): string {
  return (
    ` --- REPORTING REQUIREMENT: When you are completely finished with the task above, ` +
    `you MUST write your results to the file .splan/agent-results/${runId}.json ` +
    `with this exact JSON structure: ` +
    `{"status":"success","summary":"1-2 sentence summary","issues":[{"problem":"what went wrong","resolution":"how resolved"}],"findings":["finding 1","finding 2"],"completedAt":0}. ` +
    `Set status to "success" if everything worked, "partial" if some parts failed, or "failed" if the task could not be completed. ` +
    `Set completedAt to the current Unix timestamp in milliseconds (Date.now()). ` +
    `Always write this file even if the task failed — describe what went wrong in the summary and issues.`
  );
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

function duration(startTs: number, endTs: number): string {
  const s = Math.floor((endTs - startTs) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const STATUS_STYLES: Record<string, { dot: string; label: string; color: string }> = {
  success: { dot: "\u25CF", label: "Success", color: "#4ecb71" },
  partial: { dot: "\u25CF", label: "Partial", color: "#f59e0b" },
  failed:  { dot: "\u25CF", label: "Failed",  color: "#e05555" },
  pending: { dot: "\u25CB", label: "Pending", color: "#8899a6" },
};

const TIER_LABELS: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: "Essential", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  2: { label: "Useful", color: "#8899a6", bg: "rgba(136,153,166,0.10)" },
};

// ─── Main component ─────────────────────────────────────────────────────────

export default function AgentsTab() {
  const [launching, setLaunching] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ key: string; ok: boolean; msg: string } | null>(null);
  const [configs, setConfigs] = useState<Record<string, PromptConfig>>({});
  const [schedules, setSchedules] = useState<Record<string, ScheduleConfig>>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [results, setResults] = useState<Record<string, AgentResult>>({});
  const [historyOpen, setHistoryOpen] = useState(false);

  // Load config + history + schedules on mount
  useEffect(() => {
    fetch("/api/agents/config").then((r) => r.json()).then(setConfigs).catch(() => {});
    fetch("/api/agents/history").then((r) => r.json()).then(setHistory).catch(() => {});
    fetch("/api/agents/schedules").then((r) => r.json()).then(setSchedules).catch(() => {});
  }, []);

  // Fetch results for history entries when panel opens
  const fetchedRef = useRef(new Set<string>());
  const fetchResults = useCallback(async (entries: HistoryEntry[]) => {
    const toFetch = entries.filter((e) => e.runId && !fetchedRef.current.has(e.runId)).slice(0, 20);
    if (toFetch.length === 0) return;
    const fetched: Record<string, AgentResult> = {};
    await Promise.all(
      toFetch.map(async (e) => {
        fetchedRef.current.add(e.runId);
        try {
          const r = await fetch(`/api/agents/results/${e.runId}`);
          const d = await r.json();
          if (d.found) fetched[e.runId] = d.data as AgentResult;
        } catch { /* ignore */ }
      }),
    );
    if (Object.keys(fetched).length > 0) {
      setResults((prev) => ({ ...prev, ...fetched }));
    }
  }, []);

  useEffect(() => {
    if (historyOpen && history.length > 0) fetchResults(history);
  }, [historyOpen, history, fetchResults]);

  const handleRefreshResults = () => {
    fetchedRef.current.clear();
    fetchResults(history);
  };

  const saveConfigs = useCallback(
    async (next: Record<string, PromptConfig>) => {
      setConfigs(next);
      await fetch("/api/agents/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch(() => {});
    },
    [],
  );

  const saveSchedule = async (agentId: string, config: ScheduleConfig, agent: AgentDef, promptIdx: number) => {
    const promptDef = agent.prompts[promptIdx];
    const activePrompt = config.promptOverride ?? promptDef.prompt;
    const finalPrompt = interpolate(activePrompt, config.paramDefaults ?? {});

    try {
      const res = await fetch("/api/agents/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, agentName: agent.name, config, prompt: finalPrompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFlash({ key: `sched-${agentId}`, ok: false, msg: data.error || "Failed to save schedule" });
        setTimeout(() => setFlash((f) => (f?.key === `sched-${agentId}` ? null : f)), 4000);
        return;
      }
      const updatedConfig = { ...config, triggerId: data.triggerId, enabled: true };
      setSchedules((prev) => ({ ...prev, [agentId]: updatedConfig }));
      setFlash({ key: `sched-${agentId}`, ok: true, msg: "Schedule saved" });
      setTimeout(() => setFlash((f) => (f?.key === `sched-${agentId}` ? null : f)), 3000);
    } catch (e) {
      setFlash({ key: `sched-${agentId}`, ok: false, msg: (e as Error).message });
      setTimeout(() => setFlash((f) => (f?.key === `sched-${agentId}` ? null : f)), 4000);
    }
  };

  const removeSchedule = async (agentId: string) => {
    const existing = schedules[agentId];
    try {
      const res = await fetch(`/api/agents/schedules/${agentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerId: existing?.triggerId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFlash({ key: `sched-${agentId}`, ok: false, msg: data.error || "Failed to remove" });
        setTimeout(() => setFlash((f) => (f?.key === `sched-${agentId}` ? null : f)), 4000);
        return;
      }
      setSchedules((prev) => { const next = { ...prev }; delete next[agentId]; return next; });
      setFlash({ key: `sched-${agentId}`, ok: true, msg: "Schedule removed" });
      setTimeout(() => setFlash((f) => (f?.key === `sched-${agentId}` ? null : f)), 3000);
    } catch (e) {
      setFlash({ key: `sched-${agentId}`, ok: false, msg: (e as Error).message });
      setTimeout(() => setFlash((f) => (f?.key === `sched-${agentId}` ? null : f)), 4000);
    }
  };

  const launch = async (agent: AgentDef, promptIdx: number, finalPrompt: string, paramValues: Record<string, string>) => {
    const key = pKey(agent.id, promptIdx);
    const runId = generateRunId();
    setLaunching(key);
    setFlash(null);

    // Inject reporting instruction
    const fullPrompt = finalPrompt + buildReportingBlock(runId);

    try {
      const res = await fetch("/api/agents/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: agent.name, prompt: fullPrompt, runId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        setFlash({ key, ok: false, msg: body.error || "Failed to launch" });
        return;
      }
      setFlash({ key, ok: true, msg: "Terminal opened" });
      const entry: HistoryEntry = {
        ts: Date.now(),
        runId,
        agentId: agent.id,
        agentName: agent.name,
        promptLabel: agent.prompts[promptIdx].label,
        params: Object.keys(paramValues).length > 0 ? paramValues : undefined,
      };
      await fetch("/api/agents/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      }).catch(() => {});
      setHistory((prev) => [entry, ...prev]);
    } catch (e) {
      setFlash({ key, ok: false, msg: (e as Error).message });
    } finally {
      setLaunching(null);
      setTimeout(() => setFlash((f) => (f?.key === key ? null : f)), 3000);
    }
  };

  const handleManualResult = async (runId: string, result: AgentResult) => {
    try {
      await fetch(`/api/agents/results/${runId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      setResults((prev) => ({ ...prev, [runId]: { ...result, completedAt: Date.now() } }));
    } catch { /* ignore */ }
  };

  const tier1 = AGENTS.filter((a) => a.tier === 1);
  const tier2 = AGENTS.filter((a) => a.tier === 2);

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold" style={{ color: "var(--color-text)" }}>Agents</h2>
        {history.length > 0 && (
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="px-3 py-1 text-[11px] font-medium rounded transition-colors"
            style={{
              backgroundColor: historyOpen ? "rgba(66,139,202,0.15)" : "transparent",
              color: "#428bca",
              border: "1px solid rgba(66,139,202,0.25)",
            }}
          >
            History ({history.length}){historyOpen ? " \u25B4" : " \u25BE"}
          </button>
        )}
      </div>
      <p className="text-xs mb-6" style={{ color: "var(--color-text-muted)" }}>
        Launch a Claude Code terminal pre-loaded with a specialized prompt.
        Click a prompt label to view and edit the prompt before launching.
      </p>

      {historyOpen && (
        <HistoryPanel
          history={history}
          results={results}
          onRefresh={handleRefreshResults}
          onManualResult={handleManualResult}
        />
      )}

      <TierSection tier={1} agents={tier1} configs={configs} schedules={schedules} launching={launching} flash={flash} onLaunch={launch} onSaveConfigs={saveConfigs} onSaveSchedule={saveSchedule} onRemoveSchedule={removeSchedule} />
      <TierSection tier={2} agents={tier2} configs={configs} schedules={schedules} launching={launching} flash={flash} onLaunch={launch} onSaveConfigs={saveConfigs} onSaveSchedule={saveSchedule} onRemoveSchedule={removeSchedule} />
    </div>
  );
}

// ─── Tier section ────────────────────────────────────────────────────────────

function TierSection({
  tier, agents, configs, schedules, launching, flash, onLaunch, onSaveConfigs, onSaveSchedule, onRemoveSchedule,
}: {
  tier: 1 | 2;
  agents: AgentDef[];
  configs: Record<string, PromptConfig>;
  schedules: Record<string, ScheduleConfig>;
  launching: string | null;
  flash: { key: string; ok: boolean; msg: string } | null;
  onLaunch: (agent: AgentDef, promptIdx: number, finalPrompt: string, paramValues: Record<string, string>) => void;
  onSaveConfigs: (next: Record<string, PromptConfig>) => void;
  onSaveSchedule: (agentId: string, config: ScheduleConfig, agent: AgentDef, promptIdx: number) => void;
  onRemoveSchedule: (agentId: string) => void;
}) {
  const t = TIER_LABELS[tier];
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4 pb-2" style={{ borderBottom: "1px solid var(--color-divider)" }}>
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded" style={{ color: t.color, backgroundColor: t.bg }}>
          {t.label}
        </span>
        <span className="text-[10px]" style={{ color: "var(--color-text-subtle)" }}>
          {tier === 1 ? "High-impact agents for daily workflow" : "Specialized agents for periodic tasks"}
        </span>
      </div>
      <div className="flex flex-col gap-4">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} configs={configs} schedule={schedules[agent.id]} launching={launching} flash={flash} onLaunch={onLaunch} onSaveConfigs={onSaveConfigs} onSaveSchedule={onSaveSchedule} onRemoveSchedule={onRemoveSchedule} />
        ))}
      </div>
    </div>
  );
}

// ─── Agent card ──────────────────────────────────────────────────────────────

function AgentCard({
  agent, configs, schedule, launching, flash, onLaunch, onSaveConfigs, onSaveSchedule, onRemoveSchedule,
}: {
  agent: AgentDef;
  configs: Record<string, PromptConfig>;
  schedule?: ScheduleConfig;
  launching: string | null;
  flash: { key: string; ok: boolean; msg: string } | null;
  onLaunch: (agent: AgentDef, promptIdx: number, finalPrompt: string, paramValues: Record<string, string>) => void;
  onSaveConfigs: (next: Record<string, PromptConfig>) => void;
  onSaveSchedule: (agentId: string, config: ScheduleConfig, agent: AgentDef, promptIdx: number) => void;
  onRemoveSchedule: (agentId: string) => void;
}) {
  const schedFlash = flash?.key === `sched-${agent.id}` ? flash : null;
  return (
    <div className="rounded-lg border px-5 py-4" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)" }}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xl leading-none">{agent.icon}</span>
        <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{agent.name}</h3>
        {schedule?.enabled && (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: "rgba(78,203,113,0.12)", color: "#4ecb71" }}>
            Scheduled: {schedule.cronLabel}
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed mb-4" style={{ color: "var(--color-text-muted)" }}>{agent.description}</p>
      <div className="flex flex-col gap-2">
        {agent.prompts.map((p, i) => (
          <PromptRow
            key={i}
            agent={agent}
            promptDef={p}
            promptIdx={i}
            config={configs[pKey(agent.id, i)]}
            launching={launching}
            flash={flash}
            onLaunch={onLaunch}
            onSaveConfig={(cfg) => onSaveConfigs({ ...configs, [pKey(agent.id, i)]: cfg })}
            onResetConfig={() => { const next = { ...configs }; delete next[pKey(agent.id, i)]; onSaveConfigs(next); }}
          />
        ))}
      </div>
      {agent.schedulable && (
        <SchedulePanel
          agent={agent}
          schedule={schedule}
          flash={schedFlash}
          onSave={(config) => onSaveSchedule(agent.id, config, agent, 0)}
          onRemove={() => onRemoveSchedule(agent.id)}
        />
      )}
    </div>
  );
}

// ─── Prompt row (expandable) ─────────────────────────────────────────────────

function PromptRow({
  agent, promptDef, promptIdx, config, launching, flash, onLaunch, onSaveConfig, onResetConfig,
}: {
  agent: AgentDef;
  promptDef: AgentPrompt;
  promptIdx: number;
  config?: PromptConfig;
  launching: string | null;
  flash: { key: string; ok: boolean; msg: string } | null;
  onLaunch: (agent: AgentDef, promptIdx: number, finalPrompt: string, paramValues: Record<string, string>) => void;
  onSaveConfig: (cfg: PromptConfig) => void;
  onResetConfig: () => void;
}) {
  const key = pKey(agent.id, promptIdx);
  const isLaunching = launching === key;
  const thisFlash = flash?.key === key ? flash : null;

  const [expanded, setExpanded] = useState(false);
  const [editText, setEditText] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const activePrompt = config?.customPrompt ?? promptDef.prompt;
  const isCustom = config?.customPrompt != null;

  useEffect(() => {
    if (expanded) {
      setEditText(activePrompt);
      setDirty(false);
      const defaults: Record<string, string> = {};
      for (const p of promptDef.params ?? []) {
        defaults[p.key] = config?.paramDefaults?.[p.key] ?? (p.type === "select" && p.options ? p.options[0] : "");
      }
      setParamValues(defaults);
    }
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTextChange = (val: string) => { setEditText(val); setDirty(val !== promptDef.prompt); };
  const handleSave = () => {
    const isDefault = editText.trim() === promptDef.prompt.trim();
    onSaveConfig({ customPrompt: isDefault ? undefined : editText, paramDefaults: Object.keys(paramValues).length > 0 ? paramValues : undefined });
    setDirty(false);
  };
  const handleReset = () => { setEditText(promptDef.prompt); setDirty(false); onResetConfig(); };
  const handleLaunch = () => {
    const finalPrompt = interpolate(editText || activePrompt, paramValues);
    if (promptDef.params && promptDef.params.length > 0) {
      onSaveConfig({ customPrompt: config?.customPrompt, paramDefaults: paramValues });
    }
    onLaunch(agent, promptIdx, finalPrompt, paramValues);
  };

  const hasParams = promptDef.params && promptDef.params.length > 0;
  const paramsFilled = !hasParams || promptDef.params!.every((p) => p.type === "select" || (paramValues[p.key] && paramValues[p.key].trim().length > 0));

  return (
    <div className="rounded overflow-hidden" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center gap-3 px-3 py-2">
        <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span className="text-[10px] shrink-0 transition-transform" style={{ color: "var(--color-text-subtle)", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>{"\u25B6"}</span>
          <span className="text-xs font-medium truncate" style={{ color: "var(--color-text)" }}>{promptDef.label}</span>
          {isCustom && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ backgroundColor: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>edited</span>}
        </button>
        {thisFlash && <span className="text-[10px] font-medium shrink-0" style={{ color: thisFlash.ok ? "#4ecb71" : "#e05555" }}>{thisFlash.msg}</span>}
        <button
          onClick={handleLaunch}
          disabled={isLaunching || !paramsFilled}
          className="shrink-0 px-3 py-1 text-[11px] font-medium rounded transition-colors"
          style={{ backgroundColor: isLaunching ? "rgba(66,139,202,0.08)" : "rgba(66,139,202,0.15)", color: "#428bca", opacity: isLaunching || !paramsFilled ? 0.5 : 1, cursor: isLaunching || !paramsFilled ? "not-allowed" : "pointer" }}
          title={!paramsFilled ? "Fill in all parameters first" : undefined}
        >
          {isLaunching ? "Launching\u2026" : "Launch"}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3" style={{ borderTop: "1px solid var(--color-divider)" }}>
          {hasParams && (
            <div className="pt-3 pb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-subtle)" }}>Parameters</div>
              <div className="flex flex-wrap gap-3">
                {promptDef.params!.map((p) => (
                  <div key={p.key} className="flex flex-col gap-1" style={{ minWidth: 160 }}>
                    <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>{p.label}</label>
                    {p.type === "select" ? (
                      <select value={paramValues[p.key] || (p.options ? p.options[0] : "")} onChange={(e) => setParamValues((v) => ({ ...v, [p.key]: e.target.value }))} className="px-2 py-1 text-xs rounded border" style={{ backgroundColor: "var(--color-surface)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}>
                        {p.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={paramValues[p.key] || ""} onChange={(e) => setParamValues((v) => ({ ...v, [p.key]: e.target.value }))} placeholder={p.placeholder} className="px-2 py-1 text-xs rounded border" style={{ backgroundColor: "var(--color-surface)", borderColor: "var(--color-divider)", color: "var(--color-text)" }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-subtle)" }}>Prompt</span>
              <div className="flex items-center gap-2">
                {isCustom && <button onClick={handleReset} className="text-[10px] hover:underline" style={{ color: "#e05555" }}>Reset to default</button>}
                {dirty && <button onClick={handleSave} className="px-2 py-0.5 text-[10px] font-medium rounded" style={{ backgroundColor: "rgba(78,203,113,0.15)", color: "#4ecb71" }}>Save</button>}
              </div>
            </div>
            <textarea value={editText} onChange={(e) => handleTextChange(e.target.value)} rows={5} className="w-full px-3 py-2 text-xs rounded border font-mono leading-relaxed resize-y" style={{ backgroundColor: "var(--color-surface)", borderColor: dirty ? "#f59e0b" : "var(--color-divider)", color: "var(--color-text)", minHeight: 80 }} />
            {hasParams && <p className="text-[10px] mt-1" style={{ color: "var(--color-text-subtle)" }}>Use {"{{paramName}}"} syntax to insert parameter values into the prompt.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Schedule panel ─────────────────────────────────────────────────────────

function SchedulePanel({
  agent, schedule, flash, onSave, onRemove,
}: {
  agent: AgentDef;
  schedule?: ScheduleConfig;
  flash: { key: string; ok: boolean; msg: string } | null;
  onSave: (config: ScheduleConfig) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const promptDef = agent.prompts[0];
  const hasParams = promptDef.params && promptDef.params.length > 0;

  const [time, setTime] = useState<ScheduleTime>(() => schedule?.scheduleTime ?? defaultScheduleTime());
  const [promptOverride, setPromptOverride] = useState(schedule?.promptOverride || "");
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    if (schedule?.paramDefaults) return schedule.paramDefaults;
    const defaults: Record<string, string> = {};
    for (const p of promptDef.params ?? []) {
      defaults[p.key] = p.type === "select" && p.options ? p.options[0] : "";
    }
    return defaults;
  });

  const updateTime = (patch: Partial<ScheduleTime>) => setTime((t) => ({ ...t, ...patch }));
  const toggleWeekday = (day: number) => setTime((t) => {
    const next = t.weekdays.includes(day) ? t.weekdays.filter((d) => d !== day) : [...t.weekdays, day];
    return { ...t, weekdays: next };
  });

  const selectStyle = { backgroundColor: "var(--color-surface)", borderColor: "var(--color-divider)", color: "var(--color-text)" };

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      cronExpression: cronFromSchedule(time),
      cronLabel: labelFromSchedule(time),
      scheduleTime: time,
      promptOverride: promptOverride.trim() || undefined,
      paramDefaults: Object.keys(paramValues).length > 0 ? paramValues : undefined,
      triggerId: schedule?.triggerId,
      enabled: true,
    });
    setSaving(false);
  };

  const handleRemove = async () => {
    setSaving(true);
    await onRemove();
    setSaving(false);
  };

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-divider)" }}>
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left">
          <span className="text-[10px] shrink-0 transition-transform" style={{ color: "var(--color-text-subtle)", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>{"\u25B6"}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-subtle)" }}>Schedule</span>
        </button>
        {schedule?.enabled && !open && (
          <span className="text-[10px]" style={{ color: "#4ecb71" }}>{schedule.cronLabel}</span>
        )}
        {flash && (
          <span className="text-[10px] font-medium" style={{ color: flash.ok ? "#4ecb71" : "#e05555" }}>{flash.msg}</span>
        )}
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3 pl-4">
          {/* Frequency type */}
          <div>
            <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Frequency</label>
            <div className="flex gap-1">
              {([["daily", "Daily"], ["weekdays", "Specific Days"], ["every_n_hours", "Every N Hours"]] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => updateTime({ frequency: val })}
                  className="px-3 py-1 text-[11px] font-medium rounded transition-colors"
                  style={{
                    backgroundColor: time.frequency === val ? "rgba(66,139,202,0.2)" : "transparent",
                    color: time.frequency === val ? "#428bca" : "var(--color-text-muted)",
                    border: `1px solid ${time.frequency === val ? "rgba(66,139,202,0.4)" : "var(--color-divider)"}`,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Weekday selector (only for "weekdays" frequency) */}
          {time.frequency === "weekdays" && (
            <div>
              <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Days</label>
              <div className="flex gap-1">
                {WEEKDAY_LABELS.map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => toggleWeekday(value)}
                    className="px-2 py-1 text-[11px] font-medium rounded transition-colors"
                    style={{
                      backgroundColor: time.weekdays.includes(value) ? "rgba(78,203,113,0.2)" : "transparent",
                      color: time.weekdays.includes(value) ? "#4ecb71" : "var(--color-text-muted)",
                      border: `1px solid ${time.weekdays.includes(value) ? "rgba(78,203,113,0.4)" : "var(--color-divider)"}`,
                      minWidth: 36,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Every N hours selector */}
          {time.frequency === "every_n_hours" && (
            <div>
              <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Run every</label>
              <div className="flex items-center gap-2">
                <select value={time.everyNHours} onChange={(e) => updateTime({ everyNHours: Number(e.target.value) })} className="px-2 py-1 text-xs rounded border" style={selectStyle}>
                  {N_HOURS_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>hours</span>
              </div>
            </div>
          )}

          {/* Time picker (not shown for every_n_hours) */}
          {time.frequency !== "every_n_hours" && (
            <div>
              <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Time</label>
              <div className="flex items-center gap-2">
                <select value={time.hour} onChange={(e) => updateTime({ hour: Number(e.target.value) })} className="px-2 py-1 text-xs rounded border" style={selectStyle}>
                  {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>:</span>
                <select value={time.minute} onChange={(e) => updateTime({ minute: Number(e.target.value) })} className="px-2 py-1 text-xs rounded border" style={selectStyle}>
                  {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{m.toString().padStart(2, "0")}</option>)}
                </select>
                <select value={time.ampm} onChange={(e) => updateTime({ ampm: e.target.value as "AM" | "PM" })} className="px-2 py-1 text-xs rounded border" style={selectStyle}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
          )}

          {/* Timezone */}
          <div>
            <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Timezone</label>
            <select value={time.timezone} onChange={(e) => updateTime({ timezone: e.target.value })} className="px-2 py-1 text-xs rounded border" style={{ ...selectStyle, minWidth: 200 }}>
              {US_TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
          </div>

          {/* Parameters */}
          {hasParams && (
            <div>
              <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Parameters</label>
              <div className="flex flex-wrap gap-3">
                {promptDef.params!.map((p) => (
                  <div key={p.key} className="flex flex-col gap-1" style={{ minWidth: 160 }}>
                    <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>{p.label}</label>
                    {p.type === "select" ? (
                      <select value={paramValues[p.key] || (p.options ? p.options[0] : "")} onChange={(e) => setParamValues((v) => ({ ...v, [p.key]: e.target.value }))} className="px-2 py-1 text-xs rounded border" style={selectStyle}>
                        {p.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={paramValues[p.key] || ""} onChange={(e) => setParamValues((v) => ({ ...v, [p.key]: e.target.value }))} placeholder={p.placeholder} className="px-2 py-1 text-xs rounded border" style={selectStyle} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prompt override */}
          <div>
            <label className="text-[10px] font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>
              Prompt {promptOverride ? "(customized)" : "(default)"}
            </label>
            <textarea
              value={promptOverride || promptDef.prompt}
              onChange={(e) => setPromptOverride(e.target.value === promptDef.prompt ? "" : e.target.value)}
              rows={4}
              className="w-full px-3 py-2 text-xs rounded border font-mono leading-relaxed resize-y"
              style={{ backgroundColor: "var(--color-surface)", borderColor: promptOverride ? "#f59e0b" : "var(--color-divider)", color: "var(--color-text)", minHeight: 72 }}
            />
            {promptOverride && (
              <button onClick={() => setPromptOverride("")} className="text-[10px] mt-1 hover:underline" style={{ color: "#e05555" }}>
                Reset to default prompt
              </button>
            )}
          </div>

          {/* Preview */}
          <div className="text-[10px] px-2 py-1.5 rounded" style={{ backgroundColor: "rgba(66,139,202,0.08)", color: "var(--color-text-muted)" }}>
            Cron: <span className="font-mono">{cronFromSchedule(time)}</span> &mdash; {labelFromSchedule(time)}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-[11px] font-medium rounded transition-colors"
              style={{ backgroundColor: "rgba(78,203,113,0.15)", color: "#4ecb71", opacity: saving ? 0.4 : 1, cursor: saving ? "not-allowed" : "pointer" }}
            >
              {saving ? "Saving\u2026" : schedule?.enabled ? "Update Schedule" : "Create Schedule"}
            </button>
            {schedule?.enabled && (
              <button
                onClick={handleRemove}
                disabled={saving}
                className="px-3 py-1.5 text-[11px] font-medium rounded transition-colors"
                style={{ backgroundColor: "rgba(224,85,85,0.12)", color: "#e05555", opacity: saving ? 0.4 : 1 }}
              >
                {saving ? "Removing\u2026" : "Remove Schedule"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── History panel ───────────────────────────────────────────────────────────

function HistoryPanel({
  history, results, onRefresh, onManualResult,
}: {
  history: HistoryEntry[];
  results: Record<string, AgentResult>;
  onRefresh: () => void;
  onManualResult: (runId: string, result: AgentResult) => void;
}) {
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  return (
    <div className="mb-6 rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--color-divider)" }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-subtle)" }}>Recent Executions</span>
        <button onClick={onRefresh} className="text-[10px] font-medium px-2 py-0.5 rounded hover:bg-white/5 transition-colors" style={{ color: "#428bca" }}>
          Refresh results
        </button>
      </div>
      <div style={{ maxHeight: 400, overflowY: "auto" }}>
        {history.length === 0 ? (
          <div className="px-4 py-3 text-xs" style={{ color: "var(--color-text-subtle)" }}>No executions yet.</div>
        ) : (
          <table className="w-full text-xs" style={{ color: "var(--color-text)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
                <th className="text-left px-3 py-1.5 font-medium" style={{ color: "var(--color-text-muted)", width: 28 }}></th>
                <th className="text-left px-2 py-1.5 font-medium" style={{ color: "var(--color-text-muted)" }}>Agent</th>
                <th className="text-left px-2 py-1.5 font-medium" style={{ color: "var(--color-text-muted)" }}>Prompt</th>
                <th className="text-left px-2 py-1.5 font-medium" style={{ color: "var(--color-text-muted)" }}>Issues</th>
                <th className="text-left px-2 py-1.5 font-medium" style={{ color: "var(--color-text-muted)" }}>Summary</th>
                <th className="text-right px-3 py-1.5 font-medium" style={{ color: "var(--color-text-muted)" }}>When</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 50).map((e, i) => {
                const r = e.runId ? results[e.runId] : undefined;
                const st = r ? STATUS_STYLES[r.status] : STATUS_STYLES.pending;
                const isExpanded = expandedRun === e.runId;
                const issueCount = r?.issues?.length ?? 0;
                return (
                  <React.Fragment key={`${e.ts}-${i}`}>
                    <tr
                      className="transition-colors hover:bg-white/[0.03] cursor-pointer"
                      style={{ borderBottom: isExpanded ? "none" : "1px solid var(--color-divider)" }}
                      onClick={() => setExpandedRun(isExpanded ? null : e.runId)}
                    >
                      <td className="px-3 py-1.5 text-center" title={st.label}>
                        <span style={{ color: st.color, fontSize: 10 }}>{st.dot}</span>
                      </td>
                      <td className="px-2 py-1.5 font-medium">{e.agentName}</td>
                      <td className="px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>{e.promptLabel}</td>
                      <td className="px-2 py-1.5">
                        {r ? (
                          issueCount > 0 ? (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(224,85,85,0.12)", color: "#e05555" }}>
                              {issueCount}
                            </span>
                          ) : (
                            <span className="text-[10px]" style={{ color: "var(--color-text-subtle)" }}>{"\u2014"}</span>
                          )
                        ) : (
                          <span className="text-[10px]" style={{ color: "var(--color-text-subtle)" }}>{"\u2014"}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: "var(--color-text-muted)", maxWidth: 220 }}>
                        <span className="truncate block text-[11px]">
                          {r?.summary || (r ? "" : "")}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap" style={{ color: "var(--color-text-subtle)" }}>
                        {timeAgo(e.ts)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
                        <td colSpan={6} className="px-3 py-0">
                          <HistoryDetail entry={e} result={r} onManualResult={onManualResult} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── History detail (expanded row) ───────────────────────────────────────────

function HistoryDetail({
  entry, result, onManualResult,
}: {
  entry: HistoryEntry;
  result?: AgentResult;
  onManualResult: (runId: string, result: AgentResult) => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);

  if (result) {
    const st = STATUS_STYLES[result.status];
    return (
      <div className="py-3 pl-6" style={{ backgroundColor: "rgba(0,0,0,0.15)" }}>
        {/* Status + duration */}
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[11px] font-medium" style={{ color: st.color }}>
            {st.dot} {st.label}
          </span>
          {result.completedAt && (
            <span className="text-[10px]" style={{ color: "var(--color-text-subtle)" }}>
              Duration: {duration(entry.ts, result.completedAt)}
            </span>
          )}
          {entry.params && (
            <span className="text-[10px] font-mono" style={{ color: "var(--color-text-subtle)" }}>
              {Object.entries(entry.params).map(([k, v]) => `${k}=${v}`).join(", ")}
            </span>
          )}
        </div>

        {/* Summary */}
        {result.summary && (
          <div className="mb-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-subtle)" }}>Summary</div>
            <p className="text-xs leading-relaxed" style={{ color: "var(--color-text)" }}>{result.summary}</p>
          </div>
        )}

        {/* Issues */}
        {result.issues && result.issues.length > 0 && (
          <div className="mb-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#e05555" }}>Issues</div>
            <div className="flex flex-col gap-1.5">
              {result.issues.map((issue, i) => (
                <div key={i} className="rounded px-3 py-2 text-xs" style={{ backgroundColor: "rgba(224,85,85,0.06)", border: "1px solid rgba(224,85,85,0.15)" }}>
                  <div className="font-medium" style={{ color: "var(--color-text)" }}>{issue.problem}</div>
                  {issue.resolution && (
                    <div className="mt-1" style={{ color: "#4ecb71" }}>Resolved: {issue.resolution}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Findings */}
        {result.findings && result.findings.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-subtle)" }}>Findings</div>
            <ul className="text-xs leading-relaxed pl-4" style={{ color: "var(--color-text-muted)", listStyleType: "disc" }}>
              {result.findings.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // No result — show pending state with manual log option
  return (
    <div className="py-3 pl-6" style={{ backgroundColor: "rgba(0,0,0,0.15)" }}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px]" style={{ color: "var(--color-text-subtle)" }}>
          {"\u25CB"} No results yet — agent may still be running.
        </span>
        {entry.params && (
          <span className="text-[10px] font-mono" style={{ color: "var(--color-text-subtle)" }}>
            {Object.entries(entry.params).map(([k, v]) => `${k}=${v}`).join(", ")}
          </span>
        )}
      </div>
      {!manualOpen ? (
        <button
          onClick={() => setManualOpen(true)}
          className="text-[11px] font-medium px-3 py-1 rounded transition-colors"
          style={{ backgroundColor: "rgba(66,139,202,0.12)", color: "#428bca" }}
        >
          Log result manually
        </button>
      ) : (
        <ManualResultForm runId={entry.runId} onSubmit={onManualResult} onCancel={() => setManualOpen(false)} />
      )}
    </div>
  );
}

// ─── Manual result form ──────────────────────────────────────────────────────

function ManualResultForm({
  runId, onSubmit, onCancel,
}: {
  runId: string;
  onSubmit: (runId: string, result: AgentResult) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<"success" | "partial" | "failed">("success");
  const [summary, setSummary] = useState("");
  const [issueText, setIssueText] = useState("");
  const [findingsText, setFindingsText] = useState("");

  const handleSubmit = () => {
    const issues: { problem: string; resolution: string }[] = [];
    for (const line of issueText.split("\n").filter((l) => l.trim())) {
      const parts = line.split("|").map((s) => s.trim());
      issues.push({ problem: parts[0], resolution: parts[1] || "" });
    }
    const findings = findingsText.split("\n").map((l) => l.trim()).filter(Boolean);
    onSubmit(runId, { status, summary, issues: issues.length > 0 ? issues : undefined, findings: findings.length > 0 ? findings : undefined });
  };

  const inputStyle = {
    backgroundColor: "var(--color-surface)",
    borderColor: "var(--color-divider)",
    color: "var(--color-text)",
  };

  return (
    <div className="flex flex-col gap-2 mt-1" style={{ maxWidth: 500 }}>
      <div className="flex items-center gap-3">
        <label className="text-[10px] font-medium shrink-0" style={{ color: "var(--color-text-muted)", width: 50 }}>Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="px-2 py-1 text-xs rounded border" style={inputStyle}>
          <option value="success">Success</option>
          <option value="partial">Partial</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <div className="flex items-start gap-3">
        <label className="text-[10px] font-medium shrink-0 pt-1" style={{ color: "var(--color-text-muted)", width: 50 }}>Summary</label>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder="Brief summary of what happened" className="flex-1 px-2 py-1 text-xs rounded border resize-y" style={inputStyle} />
      </div>
      <div className="flex items-start gap-3">
        <label className="text-[10px] font-medium shrink-0 pt-1" style={{ color: "var(--color-text-muted)", width: 50 }}>Issues</label>
        <textarea value={issueText} onChange={(e) => setIssueText(e.target.value)} rows={2} placeholder="One per line: problem | resolution" className="flex-1 px-2 py-1 text-xs rounded border font-mono resize-y" style={inputStyle} />
      </div>
      <div className="flex items-start gap-3">
        <label className="text-[10px] font-medium shrink-0 pt-1" style={{ color: "var(--color-text-muted)", width: 50 }}>Findings</label>
        <textarea value={findingsText} onChange={(e) => setFindingsText(e.target.value)} rows={2} placeholder="One finding per line" className="flex-1 px-2 py-1 text-xs rounded border font-mono resize-y" style={inputStyle} />
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button onClick={handleSubmit} disabled={!summary.trim()} className="px-3 py-1 text-[11px] font-medium rounded transition-colors" style={{ backgroundColor: "rgba(78,203,113,0.15)", color: "#4ecb71", opacity: summary.trim() ? 1 : 0.4 }}>
          Save result
        </button>
        <button onClick={onCancel} className="px-3 py-1 text-[11px] rounded transition-colors hover:bg-white/5" style={{ color: "var(--color-text-muted)" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
