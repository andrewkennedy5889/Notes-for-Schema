import { getDb } from './db.js';

const db = getDb();

console.log('Seeding database...');

// ─── Clear existing data ───────────────────────────────────────────────────────
db.exec(`
  DELETE FROM _splan_discussions;
  DELETE FROM _splan_feature_data_reviews;
  DELETE FROM _splan_data_access_rules;
  DELETE FROM _splan_feature_concerns;
  DELETE FROM _splan_change_log;
  DELETE FROM _splan_module_use_fields;
  DELETE FROM _splan_features;
  DELETE FROM _splan_data_fields;
  DELETE FROM _splan_data_tables;
  DELETE FROM _splan_modules;
  DELETE FROM _splan_tag_catalog;
`);

// ─── Modules ──────────────────────────────────────────────────────────────────
const modules = db.prepare(`
  INSERT INTO _splan_modules (module_name, module_purpose, module_description, platforms, tags, is_system_created)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const modFeedback = modules.run('Feed Back', 'Collect user feedback and bug reports', 'Module for collecting feedback from users across all platforms', '["Web App","Mobile"]', '["feedback","support"]', 0);
const modArch     = modules.run('Architecture', 'System architecture planning and documentation', 'Document and plan system architecture decisions', '["Web App"]', '["planning","technical"]', 1);
const modTables   = modules.run('Table Organization Ideas', 'Organize and plan database table structures', 'A workspace for brainstorming and organizing data table ideas', '["Web App"]', '["database","planning"]', 0);
const modPersons  = modules.run('Persons Listings', 'List and manage person records', 'Display and manage person contact information', '["Web App","Mobile"]', '["contacts","persons"]', 0);
const modWorkbook = modules.run('Workbook', 'Multi-sheet data workbook for operations', 'Spreadsheet-like module for complex data entry and review', '["Web App"]', '["operations","data"]', 0);

console.log('Inserted 5 modules');

// ─── Data Tables ──────────────────────────────────────────────────────────────
const tables = db.prepare(`
  INSERT INTO _splan_data_tables (table_name, description_purpose, record_ownership, table_status, tags)
  VALUES (?, ?, ?, ?, ?)
`);

const tblProfiles  = tables.run('profiles', 'User profile information for all system users', 'user_private', 'active', '["users","auth"]');
const tblOrgs      = tables.run('organizations', 'Organization records for multi-tenant support', 'org_shared', 'active', '["orgs","tenants"]');
const tblTools     = tables.run('tools', 'Tools and equipment tracked in the system', 'org_private', 'active', '["tools","equipment"]');
const tblProcesses = tables.run('processes', 'Business process definitions and workflows', 'org_shared', 'planned', '["processes","workflows"]');
const tblPersons   = tables.run('persons', 'External persons and contacts', 'org_private', 'active', '["contacts","persons"]');

console.log('Inserted 5 data tables');

// ─── Data Fields ──────────────────────────────────────────────────────────────
const fields = db.prepare(`
  INSERT INTO _splan_data_fields (field_name, data_table_id, data_type, is_required, field_status, name_reasoning)
  VALUES (?, ?, ?, ?, ?, ?)
`);

fields.run('id', tblProfiles.lastInsertRowid, 'UUID', 1, 'active', 'Primary key for profile records');
fields.run('email', tblProfiles.lastInsertRowid, 'Text', 1, 'active', 'User email address for authentication');
fields.run('full_name', tblProfiles.lastInsertRowid, 'Text', 0, 'active', 'Display name for the user');
fields.run('id', tblOrgs.lastInsertRowid, 'UUID', 1, 'active', 'Primary key for organization records');
fields.run('org_name', tblOrgs.lastInsertRowid, 'Text', 1, 'active', 'Official organization name');
fields.run('tool_id', tblTools.lastInsertRowid, 'UUID', 1, 'active', 'Primary key for tool records');
fields.run('tool_name', tblTools.lastInsertRowid, 'Text', 1, 'active', 'Name of the tool or equipment item');
fields.run('process_id', tblProcesses.lastInsertRowid, 'UUID', 1, 'planned', 'Primary key for process records');
fields.run('first_name', tblPersons.lastInsertRowid, 'Text', 1, 'active', 'First name of the person');
fields.run('last_name', tblPersons.lastInsertRowid, 'Text', 1, 'active', 'Last name of the person');

console.log('Inserted 10 data fields');

// ─── Features ─────────────────────────────────────────────────────────────────
const featStmt = db.prepare(`
  INSERT INTO _splan_features (feature_name, description, status, priority, platforms, feature_tags, data_tables, data_fields)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const feat1 = featStmt.run(
  'User Authentication Flow',
  'Complete sign-in, sign-up, and password reset flow for all platforms',
  'In Progress',
  'High',
  '["Web App","Mobile"]',
  '["auth","security"]',
  JSON.stringify([tblProfiles.lastInsertRowid]),
  '[]'
);

const feat2 = featStmt.run(
  'Organization Management Dashboard',
  'Admin view for managing organizations, their members, and settings',
  'Idea',
  'Medium',
  '["Web App"]',
  '["admin","orgs"]',
  JSON.stringify([tblOrgs.lastInsertRowid, tblProfiles.lastInsertRowid]),
  '[]'
);

const feat3 = featStmt.run(
  'Tool Inventory Tracker',
  'Track tools and equipment across job sites with check-in/check-out functionality',
  'Planned',
  'Medium',
  '["Web App","Mobile"]',
  '["tools","inventory"]',
  JSON.stringify([tblTools.lastInsertRowid]),
  '[]'
);

console.log('Inserted 3 features');

// ─── Feature Concerns ─────────────────────────────────────────────────────────
db.prepare(`
  INSERT INTO _splan_feature_concerns (feature_id, tier, concern_text, mitigation_text, status)
  VALUES (?, ?, ?, ?, ?)
`).run(feat1.lastInsertRowid, 1, 'Token expiry handling on mobile could cause silent failures', 'Implement refresh token rotation with silent re-authentication', 'Open');

db.prepare(`
  INSERT INTO _splan_feature_concerns (feature_id, tier, concern_text, mitigation_text, status)
  VALUES (?, ?, ?, ?, ?)
`).run(feat2.lastInsertRowid, 2, 'Performance at scale with large org member lists', 'Add pagination and virtual scrolling to member list', 'Mitigated');

console.log('Inserted 2 feature concerns');

// ─── Access Rules ─────────────────────────────────────────────────────────────
db.prepare(`
  INSERT INTO _splan_data_access_rules (table_id, role, access_level, scope_notes)
  VALUES (?, ?, ?, ?)
`).run(tblProfiles.lastInsertRowid, 'admin', 'full', 'Admins can read and modify all profile records');

db.prepare(`
  INSERT INTO _splan_data_access_rules (table_id, role, access_level, scope_notes)
  VALUES (?, ?, ?, ?)
`).run(tblOrgs.lastInsertRowid, 'org_admin', 'full', 'Org admins can manage their own organization record');

console.log('Inserted 2 access rules');

// ─── Discussion ───────────────────────────────────────────────────────────────
db.prepare(`
  INSERT INTO _splan_discussions (entity_type, entity_id, title, content, source)
  VALUES (?, ?, ?, ?, ?)
`).run('feature', feat1.lastInsertRowid, 'Auth Flow Architecture Notes', 'Consider using PKCE flow for mobile clients. The implicit flow is deprecated per OAuth 2.1 draft. We should also evaluate whether to use Supabase Auth or a custom JWT solution.', 'claude_code');

console.log('Inserted 1 discussion');

// ─── Tag Catalog ──────────────────────────────────────────────────────────────
const tagStmt = db.prepare('INSERT OR IGNORE INTO _splan_tag_catalog (tag_name, tier) VALUES (?, ?)');
const tags = [
  ['auth', 1], ['security', 1], ['admin', 2], ['orgs', 2], ['users', 2],
  ['tools', 2], ['inventory', 3], ['feedback', 2], ['planning', 2], ['database', 2],
];
for (const [name, tier] of tags) {
  tagStmt.run(name, tier);
}

console.log('Inserted tag catalog entries');
console.log('\nSeed complete!');
