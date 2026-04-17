import type Database from 'better-sqlite3';
import {
  CONCEPT_RESEARCHER_PROMPT_TEMPLATE,
  buildConceptResearcherInputs,
  validateConceptResearcherResults,
  writeConceptResearcherResults,
  type Validation,
} from './concept-researcher.js';

export type ScheduledAgentDef = {
  promptTemplate: string;
  inputsBuilder: (ctx: { db: Database.Database; params: Record<string, unknown> }) => unknown;
  resultsValidator: (payload: { findings: unknown }) => Validation;
  resultsWriter: (ctx: {
    db: Database.Database;
    runId: string;
    findings: unknown[];
    params: Record<string, unknown>;
  }) => unknown;
};

export const SCHEDULED_AGENTS: Record<string, ScheduledAgentDef> = {
  'concept-researcher': {
    promptTemplate: CONCEPT_RESEARCHER_PROMPT_TEMPLATE,
    inputsBuilder: ({ db, params }) =>
      buildConceptResearcherInputs({ db, params: params as { limit?: number; status?: string } }),
    resultsValidator: ({ findings }) => validateConceptResearcherResults({ findings }),
    resultsWriter: ({ db, runId, findings, params }) =>
      writeConceptResearcherResults({
        db,
        runId,
        findings: findings as Parameters<typeof writeConceptResearcherResults>[0]['findings'],
        params: params as { limit?: number; status?: string },
      }),
  },
};

export function getScheduledAgent(agentId: string): ScheduledAgentDef | undefined {
  return SCHEDULED_AGENTS[agentId];
}
