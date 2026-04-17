const Database = require('better-sqlite3');
const db = new Database('schema-planner.db', {readonly: true});
const q = (sql, params=[]) => params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all();
const get = (sql, params=[]) => params.length ? db.prepare(sql).get(...params) : db.prepare(sql).get();

const cmd = process.argv[2] || 'baseline';

if (cmd === 'baseline') {
  console.log('concepts_with_notes:', q(`SELECT concept_id, concept_name, LENGTH(notes) len FROM _splan_concepts WHERE notes IS NOT NULL AND notes != '' ORDER BY concept_id LIMIT 10`));
  console.log('entity_notes:', q(`SELECT entity_type, entity_id, note_key, LENGTH(content) len, updated_at FROM _splan_entity_notes ORDER BY entity_id`));
  console.log('change_log_count:', get(`SELECT COUNT(*) c FROM _splan_change_log`));
  console.log('recent_log:', q(`SELECT id, entity_type, entity_id, field_changed, reasoning, datetime(changed_at) t FROM _splan_change_log ORDER BY id DESC LIMIT 5`));
  console.log('column_defs_concept:', q(`SELECT column_key, label, column_type FROM _splan_column_defs WHERE entity_type='concept'`));
  console.log('column_defs_module:', q(`SELECT column_key, label, column_type FROM _splan_column_defs WHERE entity_type='module'`));
  console.log('column_defs_feature:', q(`SELECT column_key, label, column_type FROM _splan_column_defs WHERE entity_type='feature'`));
} else if (cmd === 'notes') {
  const entity_type = process.argv[3];
  const entity_id = process.argv[4];
  console.log(q(`SELECT note_key, LENGTH(content) len, SUBSTR(content,1,80) preview, updated_at FROM _splan_entity_notes WHERE entity_type=? AND entity_id=?`, [entity_type, Number(entity_id)]));
} else if (cmd === 'log-since') {
  const sinceId = Number(process.argv[3] || 0);
  console.log(q(`SELECT id, entity_type, entity_id, field_changed, action, reasoning, datetime(changed_at) t FROM _splan_change_log WHERE id > ? ORDER BY id`, [sinceId]));
} else if (cmd === 'concept-count') {
  console.log(get(`SELECT COUNT(*) c FROM _splan_concepts`));
  console.log(get(`SELECT COUNT(*) c FROM _splan_entity_notes WHERE entity_type='concept'`));
} else if (cmd === 'sql') {
  console.log(JSON.stringify(q(process.argv[3]), null, 2));
}

db.close();
