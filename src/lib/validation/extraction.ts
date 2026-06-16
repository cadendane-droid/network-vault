import type { ExtractionResult, SourceKind } from '@/lib/claude';

const VALID_FACT_TYPES = new Set([
  'role',
  'org',
  'location',
  'interest',
  'background',
  'context',
  'connection',
  'quote',
  'life_situation',
  'religion',
  'contact_info',
  'personality',
  'values',
  'skills',
  'needs',
  'future_plans',
  'dates',
  'miscellaneous',
]);

// Standalone pronouns that must never appear as person_name / person_a / person_b.
// These indicate Claude attributed a fact to a pronoun instead of resolving it
// to the primary subject's real name — the result would be a ghost people row.
const STANDALONE_PRONOUNS = new Set([
  'he',
  'she',
  'they',
  'it',
  'him',
  'her',
  'them',
  'his',
  'hers',
  'their',
  'theirs',
  'its',
]);

const VALID_RELATIONSHIP_TYPES = new Set([
  'colleagues',
  'co_investors',
  'collaborators',
  'introduced_by',
  'shared_interest',
  'classmates',
  'co_founders',
  'friends',
  'siblings',
]);

export interface InvalidItem {
  item: unknown;
  reason: string;
}

export interface ValidationResult {
  validFacts: ExtractionResult['facts'];
  validEdges: ExtractionResult['edges'];
  invalid: InvalidItem[];
}

// Implements all 7 DM §6.3 validation rules.
// Invalid items are collected and returned — never thrown.
// Partial success: valid items are written even when some fail.
export function validateExtractionOutput(
  result: ExtractionResult,
  sourceKind: SourceKind
): ValidationResult {
  const invalid: InvalidItem[] = [];

  // Shape guard: Claude is instructed to always return facts/edges arrays, but
  // it occasionally returns null or omits a key. Default to empty arrays and
  // flag the anomaly rather than throwing — a single malformed response must
  // never crash the extract job (which would leave the source stuck forever).
  const facts = Array.isArray(result.facts) ? result.facts : [];
  const edges = Array.isArray(result.edges) ? result.edges : [];
  if (!Array.isArray(result.facts)) {
    invalid.push({ item: result.facts, reason: 'facts was not an array' });
  }
  if (!Array.isArray(result.edges)) {
    invalid.push({ item: result.edges, reason: 'edges was not an array' });
  }

  // ── Facts ──────────────────────────────────────────────────────────────────

  const validFacts: ExtractionResult['facts'] = [];

  for (const f of facts) {
    // Rule 1: non-empty required fields
    if (!f.person_name?.trim() || !f.type?.trim() || !f.value?.trim()) {
      invalid.push({
        item: f,
        reason: 'missing required field: person_name, type, or value',
      });
      continue;
    }

    // Pronoun guard: reject facts where person_name is a standalone pronoun.
    // These are ghost rows caused by Claude attributing a fact to "He" or "She"
    // instead of resolving to the primary subject's real name.
    if (STANDALONE_PRONOUNS.has(f.person_name.trim().toLowerCase())) {
      invalid.push({
        item: f,
        reason: `person_name "${f.person_name}" is a pronoun — must be resolved to a full name`,
      });
      continue;
    }

    // Rule 2: legal fact type
    if (!VALID_FACT_TYPES.has(f.type)) {
      invalid.push({ item: f, reason: `invalid type "${f.type}"` });
      continue;
    }

    // Rule 6: quotes only from conversation sources
    if (f.type === 'quote' && sourceKind !== 'conversation') {
      invalid.push({
        item: f,
        reason: 'quote facts are only valid when source kind is conversation',
      });
      continue;
    }

    // Rule 7: value length cap — truncate and flag but keep
    const value =
      f.value.length > 500
        ? (invalid.push({
            item: f,
            reason: `value truncated from ${f.value.length} to 500 chars`,
          }),
          f.value.slice(0, 500))
        : f.value;

    validFacts.push({ ...f, value });
  }

  // ── Edges ──────────────────────────────────────────────────────────────────

  const validEdges: ExtractionResult['edges'] = [];

  for (const e of edges) {
    // Rule 1 (edges): non-empty fields
    if (
      !e.person_a?.trim() ||
      !e.person_b?.trim() ||
      !e.relationship_type?.trim()
    ) {
      invalid.push({
        item: e,
        reason:
          'missing required field: person_a, person_b, or relationship_type',
      });
      continue;
    }

    // Pronoun guard: reject edges where either party is a standalone pronoun.
    if (
      STANDALONE_PRONOUNS.has(e.person_a.trim().toLowerCase()) ||
      STANDALONE_PRONOUNS.has(e.person_b.trim().toLowerCase())
    ) {
      invalid.push({
        item: e,
        reason: `edge contains a pronoun as person_a or person_b — must be a full name`,
      });
      continue;
    }

    // Rule 4: no self-referential edges
    if (e.person_a.toLowerCase() === e.person_b.toLowerCase()) {
      invalid.push({
        item: e,
        reason: 'self-referential edge (person_a equals person_b)',
      });
      continue;
    }

    // Rule 3: legal relationship type
    if (!VALID_RELATIONSHIP_TYPES.has(e.relationship_type)) {
      invalid.push({
        item: e,
        reason: `invalid relationship_type "${e.relationship_type}"`,
      });
      continue;
    }

    validEdges.push(e);
  }

  // ── Rule 5: connection facts must have a matching edge ─────────────────────

  for (const f of validFacts.filter((f) => f.type === 'connection')) {
    const personLower = f.person_name.toLowerCase();
    const hasEdge = validEdges.some(
      (e) =>
        e.person_a.toLowerCase() === personLower ||
        e.person_b.toLowerCase() === personLower
    );
    if (!hasEdge) {
      invalid.push({
        item: f,
        reason: 'connection fact has no corresponding edge',
      });
    }
  }

  return { validFacts, validEdges, invalid };
}
