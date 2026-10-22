#!/usr/bin/env node
// Minimal, dependency-free TRIZ contradiction classification CLI and library.
//
// The classification is produced by a typed classifier (TypeSafe's Jev via the
// installed Pi SDK) and is probabilistic. The catalog below is a complete
// software-adapted contradiction-resolution heuristic set: all 40 main
// Inventive Principles plus the six modern MATRIZ physical-contradiction
// resolution routes. It is NOT the complete classical TRIZ 39x39
// contradiction matrix, nor the whole TRIZ body of knowledge, and a software
// heuristic is not a canonical matrix lookup.

import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, resolve, join, basename, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Fixed taxonomy and bounds
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;
export const CATALOG_VERSION = 'triz-software-2';
export const CONFIDENCE_THRESHOLD = 0.6;
export const CLASSIFIER_TIMEOUT_MS = 45000;

/** The only classifications a classifier may return. `uncertain` is derived by
 * this module, never requested from the classifier. */
export const CLASSIFICATIONS = ['technical', 'physical', 'none', 'insufficient'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** The full set of classifications a result may carry, including the derived
 * `uncertain` state used for low-confidence or malformed classifier output. */
export const RESULT_CLASSIFICATIONS = [...CLASSIFICATIONS, 'uncertain'] as const;
export type ResultClassification = (typeof RESULT_CLASSIFICATIONS)[number];

export const DEFAULT_TRIZ_MODEL = { provider: 'openrouter', id: '~typesafe/jev-latest' };

// ---------------------------------------------------------------------------
// Versioned, curated software-adapted catalog
// ---------------------------------------------------------------------------

export type CatalogPrinciple = {
  id: string;
  name: string;
  heuristic: string;
  source: string;
};

export type Catalog = {
  version: string;
  citations: readonly string[];
  canonicalMatrixLookup: false;
  completeClassicalMatrix: false;
  disclaimer: string;
  technical: readonly CatalogPrinciple[];
  physical: readonly CatalogPrinciple[];
};

const CONTRADICTIONS_SOURCE = 'https://triz.org/contradictions/';
const PRINCIPLES_SOURCE = 'https://triz.org/principles/';

const MATRIZ_METHODOLOGY_SOURCE = 'https://matriz.org/methodology/';
const MATRIZ_CONTRADICTIONS_SOURCE =
  'https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/contradictions/';
const MATRIZ_MATRIX_SOURCE =
  'https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/contradictions/engineering-contradiction-5995/contradiction-matrix-6026/';
const MATRIZ_PHYSICAL_SOURCE =
  'https://matriz.org/wp-content/uploads/2020/04/Selected-Topics-for-Level-1-Training.pdf';

const SOFTWARE_TRIZ_SOURCE =
  'https://doi.org/10.1016/j.proeng.2015.12.413';

/** Canonical main Inventive Principle IDs, in numbering order. */
export const PRINCIPLE_IDS: readonly string[] = Array.from({ length: 40 }, (_, i) => String(i + 1));

/** The modern MATRIZ physical-contradiction resolution routes in flow order. */
export const PHYSICAL_ROUTE_IDS = [
  'space-separation',
  'time-separation',
  'condition-separation',
  'system-level-separation',
  'satisfy-both-demands',
  'bypass-contradiction',
] as const;

export const CATALOG: Catalog = {
  version: CATALOG_VERSION,

  citations: [
    CONTRADICTIONS_SOURCE,
    PRINCIPLES_SOURCE,
    MATRIZ_METHODOLOGY_SOURCE,
    MATRIZ_CONTRADICTIONS_SOURCE,
    MATRIZ_MATRIX_SOURCE,
    MATRIZ_PHYSICAL_SOURCE,
    SOFTWARE_TRIZ_SOURCE,
  ],

  // The 40 principles are complete, but this object does not perform
  // a lookup in the classical 39 x 39 engineering-parameter matrix.
  canonicalMatrixLookup: false,

  // Complete principles != complete contradiction matrix.
  // This remains false until all 39 parameters and matrix cells are represented.
  completeClassicalMatrix: false,

  disclaimer:
    'Complete software-adapted TRIZ contradiction-resolution heuristic catalog: ' +
    'all 40 main Inventive Principles plus the modern MATRIZ physical-contradiction ' +
    'resolution routes. Heuristic wording is software-adapted rather than canonical TRIZ wording. ' +
    'This object does not embed the classical 39x39 Altshuller contradiction matrix and is not ' +
    'a complete representation of the broader TRIZ body of knowledge, which also includes ARIZ, ' +
    'Substance-Field analysis, Standard Inventive Solutions, trends of engineering-system evolution, ' +
    'scientific effects, function analysis, and related methods.',

  technical: [
    {
      id: '1',
      name: 'segmentation',
      heuristic:
        'Split the conflicting system, responsibility, data, or workflow into independently changeable parts so each can be optimized without forcing the same trade-off on the whole.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '2',
      name: 'extraction',
      heuristic:
        'Extract or isolate the component, responsibility, data, behavior, or dependency causing the harmful effect, or retain only the part actually required.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '3',
      name: 'local quality',
      heuristic:
        'Replace uniform treatment with locally specialized structure, behavior, configuration, or policy so each part operates under conditions suited to its role.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '4',
      name: 'asymmetry',
      heuristic:
        'Break unnecessary symmetry: allow different components, replicas, paths, users, or states to have different roles or policies when identical treatment creates the conflict.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '5',
      name: 'consolidation',
      heuristic:
        'Combine compatible components, resources, requests, or operations in space or time when duplication, separation, or coordination overhead creates the conflict.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '6',
      name: 'universality',
      heuristic:
        'Let one component or abstraction perform several compatible functions so redundant components, interfaces, dependencies, or transformations can be removed.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '7',
      name: 'nesting',
      heuristic:
        'Compose components, scopes, containers, or abstractions hierarchically so one can contain, encapsulate, or pass through another.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '8',
      name: 'counterweight',
      heuristic:
        'Offset load, latency, cost, risk, or resource pressure with a compensating mechanism rather than strengthening the constrained mechanism directly.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '9',
      name: 'prior counteraction',
      heuristic:
        'Apply a compensating or protective action before an expected harmful effect occurs so the later effect is neutralized when it arrives.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '10',
      name: 'preliminary action',
      heuristic:
        'Precompute, preload, prefetch, preconfigure, validate, reserve, or position what will be needed before the latency-sensitive or failure-sensitive path begins.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '11',
      name: 'cushion in advance',
      heuristic:
        'Prepare redundancy, rollback, fallback, reserve capacity, circuit breaking, recovery data, or other emergency protection before a failure occurs.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '12',
      name: 'equipotentiality',
      heuristic:
        'Equalize states, representations, interfaces, privileges, or operating levels so useful work no longer requires repeated expensive transitions between them.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '13',
      name: 'do it in reverse',
      heuristic:
        'Reverse direction, responsibility, dependency, ownership, control flow, or operation; make the active side passive or the fixed side movable when the conventional direction creates the conflict.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '14',
      name: 'spheroidality',
      heuristic:
        'Replace unnecessarily linear structures or flows with cyclic, ring, rotational, curved, or recursive organization when linearity creates the constraint.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '15',
      name: 'dynamicity',
      heuristic:
        'Make components, parameters, policies, capacity, topology, or bindings adjustable and reconfigurable so behavior can change with operating conditions.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '16',
      name: 'partial or excessive action',
      heuristic:
        'When the exact target is expensive or difficult to achieve directly, deliberately under-shoot or over-shoot it and handle the smaller remaining difference separately.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '17',
      name: 'transition into a new dimension',
      heuristic:
        'Add an axis, layer, hierarchy, partition, channel, dimension, or level of indirection to escape a constraint imposed by the current representation.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '18',
      name: 'mechanical vibration',
      heuristic:
        'Replace static behavior with controlled oscillation, pulsing, polling, heartbeats, resonance, or higher-frequency interaction when periodic variation exposes a better operating regime.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '19',
      name: 'periodic action',
      heuristic:
        'Replace continuous work with periodic, event-driven, scheduled, sampled, or batched action; tune the cadence and use the gaps for other useful work.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '20',
      name: 'continuity of useful action',
      heuristic:
        'Keep useful work flowing and minimize idle or intermediate stages through streaming, pipelining, concurrency, background processing, or reuse of otherwise idle capacity.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '21',
      name: 'rushing through',
      heuristic:
        'Perform an unavoidable harmful, inconsistent, blocked, or risky transitional state quickly so the system spends the minimum possible time exposed to it.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '22',
      name: 'convert harm into benefit',
      heuristic:
        'Turn a harmful factor, waste product, failure mode, contention signal, or rejected result into a useful resource or signal; combine harmful effects when doing so can neutralize them.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '23',
      name: 'feedback',
      heuristic:
        'Observe the actual outcome and feed it back into control decisions so behavior adapts instead of accepting the trade-off; change the feedback loop when the existing one is ineffective or unstable.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '24',
      name: 'intermediary',
      heuristic:
        'Insert a mediator, proxy, adapter, broker, queue, cache, buffer, gateway, or temporary abstraction between conflicting parties.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '25',
      name: 'self-service',
      heuristic:
        'Make a component observe, maintain, heal, configure, replenish, or clean up itself, and reuse otherwise wasted outputs or resources where practical.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '26',
      name: 'copying',
      heuristic:
        'Operate on a replica, cache, snapshot, proxy, model, simulation, projection, or transformed representation when operating on the original is expensive, dangerous, unavailable, or disruptive.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '27',
      name: 'dispose',
      heuristic:
        'Replace an expensive long-lived element with inexpensive disposable or ephemeral instances when durability, lifecycle, or cleanup guarantees create unnecessary complexity.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '28',
      name: 'replacement of mechanical system',
      heuristic:
        'Replace direct or tightly coupled interaction with signals, metadata, events, sensing, declarative rules, virtualization, or another more controllable interaction mechanism.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '29',
      name: 'pneumatic or hydraulic constructions',
      heuristic:
        'Replace rigidly provisioned capacity with elastic or flow-based mechanisms such as queues, streams, pools, buffers, backpressure, or dynamically allocated resources.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '30',
      name: 'flexible membranes or thin films',
      heuristic:
        'Use a lightweight flexible boundary such as a wrapper, facade, policy layer, filter, interceptor, or virtual boundary instead of rigid structural separation.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '31',
      name: 'porous material',
      heuristic:
        'Make a boundary selectively permeable using controlled openings, filters, extension points, plugins, admission rules, sampling, or pre-established channels.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '32',
      name: 'changing the color',
      heuristic:
        'Change representation, labeling, visibility, transparency, telemetry, or observability so otherwise hidden state, differences, or behavior become distinguishable.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '33',
      name: 'homogeneity',
      heuristic:
        'Make interacting elements use the same or closely compatible representation, protocol, abstraction, runtime, or substrate to reduce conversion and mismatch costs.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '34',
      name: 'rejecting and regenerating parts',
      heuristic:
        'Expire, discard, release, recycle, or transform elements after their useful function is complete, and regenerate or restore them when they become necessary again.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '35',
      name: 'transformation of properties',
      heuristic:
        'Resolve the conflict by changing state, configuration, granularity, consistency, concentration, flexibility, precision, capacity, or another governing parameter rather than redesigning the whole system.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '36',
      name: 'phase transition',
      heuristic:
        'Move the element into a qualitatively different operating state, mode, representation, or lifecycle phase whose properties remove the original conflict.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '37',
      name: 'thermal expansion',
      heuristic:
        'Use controlled expansion or contraction of capacity, scope, buffering, replication, or resource allocation in response to changing operating conditions.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '38',
      name: 'accelerated oxidation',
      heuristic:
        'Increase the strength or activation level of an enabling mechanism stepwise—such as validation, enforcement, isolation, replication, or signal intensity—when a weaker interaction requires compensating complexity.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '39',
      name: 'inert environment',
      heuristic:
        'Run the interaction in an isolated, neutralized, sandboxed, side-effect-free, simulated, or otherwise controlled environment so harmful interactions cannot propagate.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '40',
      name: 'composite materials',
      heuristic:
        'Combine heterogeneous components, representations, storage models, algorithms, or execution strategies so the composite provides properties that a uniform design cannot.',
      source: PRINCIPLES_SOURCE,
    },
  ],

  physical: [
    {
      id: 'space-separation',
      name: 'separation in space',
      heuristic:
        'Let each opposing requirement hold in a different component, node, region, layer, partition, namespace, or architectural location.',
      source: MATRIZ_PHYSICAL_SOURCE,
    },
    {
      id: 'time-separation',
      name: 'separation in time',
      heuristic:
        'Let each opposing requirement hold at a different time, phase, transaction stage, deployment window, operating mode, or lifecycle state.',
      source: MATRIZ_PHYSICAL_SOURCE,
    },
    {
      // Preserve the existing public ID if it is already persisted or consumed.
      // Current MATRIZ terminology is "Separation in Relation".
      id: 'condition-separation',
      name: 'separation in relation (condition/context)',
      heuristic:
        'Let the same element satisfy opposite properties for different users, requests, tenants, relationships, contexts, modes, workloads, or other operating conditions.',
      source: MATRIZ_PHYSICAL_SOURCE,
    },
    {
      id: 'system-level-separation',
      name: 'separation in system level',
      heuristic:
        'Place one required property at the whole-system or supersystem level and the opposing property at a subsystem, component, instance, or lower abstraction level.',
      source: MATRIZ_PHYSICAL_SOURCE,
    },
    {
      id: 'satisfy-both-demands',
      name: 'satisfying contradictory demands',
      heuristic:
        'Change state, representation, protocol, parameters, or mechanism so both opposing requirements can hold simultaneously rather than being separated.',
      source: MATRIZ_PHYSICAL_SOURCE,
    },
    {
      id: 'bypass-contradiction',
      name: 'bypassing contradictory demands',
      heuristic:
        'Redesign the workflow, interaction, architecture, or system boundary so the conflicted parameter or requirement becomes irrelevant instead of being optimized.',
      source: MATRIZ_PHYSICAL_SOURCE,
    },
  ],
};

function validateHeuristics(
  catalog: any,
  key: 'technical' | 'physical',
  expected: readonly string[],
  exactOrder: boolean,
  errors: string[],
): void {
  const list = catalog[key];
  if (!Array.isArray(list) || list.length === 0) {
    errors.push(`catalog.${key} must be a non-empty array`);
    return;
  }
  const ids: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`catalog.${key} entries must be objects`);
      continue;
    }
    if (typeof item.id !== 'string' || !item.id.trim()) errors.push(`catalog.${key} entries need a non-empty id`);
    else ids.push(item.id);
    if (typeof item.name !== 'string' || !item.name.trim()) errors.push(`catalog.${key} entry ${item.id} needs a non-empty name`);
    if (typeof item.heuristic !== 'string' || !item.heuristic.trim()) {
      errors.push(`catalog.${key} entry ${item.id} needs a non-empty heuristic`);
    }
    if (typeof item.source !== 'string' || !item.source.trim()) {
      errors.push(`catalog.${key} entry ${item.id} needs a non-empty source`);
    } else if (Array.isArray(catalog.citations) && !catalog.citations.includes(item.source)) {
      errors.push(`catalog.${key} entry ${item.id} source is not cited in catalog.citations`);
    }
  }
  const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (duplicates.length) errors.push(`catalog.${key} has duplicate ids: ${duplicates.join(', ')}`);
  if (exactOrder) {
    if (ids.length !== expected.length || ids.some((id, i) => id !== expected[i])) {
      errors.push(`catalog.${key} ids must be exactly [${expected.join(', ')}] in order`);
    }
    return;
  }
  const missing = expected.filter((id) => !ids.includes(id));
  const outOfRange = [...new Set(ids.filter((id) => !expected.includes(id)))];
  if (missing.length) errors.push(`catalog.${key} is missing ids: ${missing.join(', ')}`);
  if (outOfRange.length) errors.push(`catalog.${key} has out-of-range ids: ${outOfRange.join(', ')}`);
}

export function validateCatalog(catalog: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { ok: false, errors: ['catalog must be an object'] };
  }
  if (typeof catalog.version !== 'string' || !catalog.version.trim()) errors.push('catalog.version must be a non-empty string');
  if (!Array.isArray(catalog.citations) || catalog.citations.length === 0) {
    errors.push('catalog.citations must be a non-empty array');
  } else if (catalog.citations.some((c: any) => typeof c !== 'string' || !c.trim())) {
    errors.push('catalog.citations entries must be non-empty strings');
  }
  // Completeness flags must stay false: a principle catalog is not a matrix.
  if (catalog.canonicalMatrixLookup !== false) errors.push('catalog.canonicalMatrixLookup must be false');
  if (catalog.completeClassicalMatrix !== false) errors.push('catalog.completeClassicalMatrix must be false');
  validateHeuristics(catalog, 'technical', PRINCIPLE_IDS, false, errors);
  validateHeuristics(catalog, 'physical', PHYSICAL_ROUTE_IDS, true, errors);
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Request contract
// ---------------------------------------------------------------------------

export type Evidence = { id: string; text: string };

export type TrizRequest = {
  evidence: Evidence[];
  desiredImprovement: string;
  worseningOutcome?: string;
  element?: string;
  opposingProperties?: string[];
};

/** A request-contract violation that carries a stable machine-readable code so
 * callers (including the CLI) can react to specific refusals. */
export class TrizRequestError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TrizRequestError';
    this.code = code;
  }
}

/** Keys accepted on a new request and on each evidence item. Unknown keys are
 * rejected so misspelled optional fields cannot be silently ignored. */
const REQUEST_KEYS = ['evidence', 'desiredImprovement', 'worseningOutcome', 'element', 'opposingProperties'] as const;
const EVIDENCE_KEYS = ['id', 'text'] as const;

function firstUnknownKey(value: object, allowed: readonly string[]): string | undefined {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return key;
  }
  return undefined;
}

export function validateRequest(input: any): TrizRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('request must be an object');
  const unknownTopLevel = firstUnknownKey(input, REQUEST_KEYS);
  if (unknownTopLevel) throw Error(`request has unknown key: ${unknownTopLevel}`);
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) throw Error('request.evidence must be a non-empty array');
  for (const e of input.evidence) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw Error('each evidence entry must be an object');
    const unknownEvidence = firstUnknownKey(e, EVIDENCE_KEYS);
    if (unknownEvidence) throw Error(`evidence entry ${e.id ?? '(missing id)'} has unknown key: ${unknownEvidence}`);
    if (typeof e.id !== 'string' || !e.id.trim()) throw Error('each evidence entry needs a non-empty id');
    if (typeof e.text !== 'string' || !e.text.trim()) throw Error(`evidence ${e.id} needs non-empty text`);
  }
  if (typeof input.desiredImprovement !== 'string' || !input.desiredImprovement.trim()) {
    throw Error('request.desiredImprovement is required');
  }
  if (input.worseningOutcome !== undefined && typeof input.worseningOutcome !== 'string') {
    throw Error('request.worseningOutcome must be a string');
  }
  if (input.element !== undefined && typeof input.element !== 'string') {
    throw Error('request.element must be a string');
  }
  if (
    input.opposingProperties !== undefined &&
    (!Array.isArray(input.opposingProperties) || input.opposingProperties.some((p: any) => typeof p !== 'string'))
  ) {
    throw Error('request.opposingProperties must be an array of strings');
  }
  // A request describes one contradiction framing. Mixing the technical framing
  // (worseningOutcome) with the physical framing (element/opposingProperties)
  // is ambiguous, so it is refused before any classifier call.
  const hasWorsening = input.worseningOutcome !== undefined;
  const hasPhysicalFrame = input.element !== undefined || input.opposingProperties !== undefined;
  if (hasWorsening && hasPhysicalFrame) {
    throw new TrizRequestError(
      'mixed_framing',
      'request mixes a technical framing (worseningOutcome) with a physical framing ' +
        '(element/opposingProperties); split it into separate one-framing requests',
    );
  }
  const request: TrizRequest = {
    evidence: input.evidence.map((e: any) => ({ id: e.id, text: e.text })),
    desiredImprovement: input.desiredImprovement,
  };
  if (input.worseningOutcome !== undefined) request.worseningOutcome = input.worseningOutcome;
  if (input.element !== undefined) request.element = input.element;
  if (input.opposingProperties !== undefined) request.opposingProperties = [...input.opposingProperties];
  return request;
}

// ---------------------------------------------------------------------------
// Classifier verdicts (normalized) and interpretation
// ---------------------------------------------------------------------------

/** A normalized classifier verdict. Live Jev answers are adapted into this
 * shape; offline fixtures provide it directly. */
export type ClassifierVerdict = {
  classification: string;
  confidence: number | null;
  evidenceIds: string[];
  grounding: boolean;
  rationale?: string;
  provider?: string;
  model?: string;
  usage?: unknown;
  /** Offline-only: principle-id -> P(true) relevance map for ranking. */
  relevance?: Record<string, number>;
};

export type TrizVerdict = {
  classification: ResultClassification;
  confidence: number | null;
  groundedEvidenceIds: string[];
  rationale: string;
  notes: string[];
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function uncertainVerdict(reason: string, raw?: any, confidence: number | null = null): TrizVerdict {
  return {
    classification: 'uncertain',
    confidence: typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null,
    groundedEvidenceIds: [],
    rationale: str(raw?.rationale) ?? '',
    notes: [reason],
  };
}

function insufficientVerdict(reason: string, raw?: any, confidence: number | null = null): TrizVerdict {
  return {
    classification: 'insufficient',
    confidence: typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null,
    groundedEvidenceIds: [],
    rationale: str(raw?.rationale) ?? '',
    notes: [reason],
  };
}

/** Pure map from a classifier verdict to a validated result classification.
 * Malformed or ungrounded confident output becomes `uncertain`; a confident
 * classification missing the fields its taxonomy needs becomes `insufficient`. */
export function interpretVerdict(request: TrizRequest, raw: any): TrizVerdict {
  const known = new Set(request.evidence.map((e) => e.id));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return uncertainVerdict('classifier response was not an object');

  const cls = raw.classification;
  if (typeof cls !== 'string' || !(CLASSIFICATIONS as readonly string[]).includes(cls)) {
    return uncertainVerdict('classifier returned an unknown classification', raw);
  }

  const confRaw = raw.confidence;
  if (
    confRaw !== null &&
    confRaw !== undefined &&
    (typeof confRaw !== 'number' || !Number.isFinite(confRaw) || confRaw < 0 || confRaw > 1)
  ) {
    return uncertainVerdict('classifier confidence was outside 0..1', raw);
  }
  const confidence = typeof confRaw === 'number' ? confRaw : null;

  if (raw.grounding !== true) return uncertainVerdict('classifier did not ground its answer in the input evidence', raw, confidence);
  if (!Array.isArray(raw.evidenceIds) || raw.evidenceIds.some((id: any) => typeof id !== 'string')) {
    return uncertainVerdict('classifier evidence references were malformed', raw, confidence);
  }
  const unknown = raw.evidenceIds.filter((id: string) => !known.has(id));
  if (unknown.length) return uncertainVerdict(`classifier cited evidence not present in the input: ${unknown.join(', ')}`, raw, confidence);
  if (confidence === null || confidence < CONFIDENCE_THRESHOLD) {
    return uncertainVerdict('classifier confidence was below the grounding threshold', raw, confidence);
  }

  if (cls === 'technical') {
    if (!str(request.worseningOutcome)) return insufficientVerdict('technical contradiction needs a worsening outcome', raw, confidence);
    if (!raw.evidenceIds.length) return uncertainVerdict('confident technical classification cited no input evidence', raw, confidence);
  }
  if (cls === 'physical') {
    if (!str(request.element) || !Array.isArray(request.opposingProperties) || request.opposingProperties.length < 2) {
      return insufficientVerdict('physical contradiction needs an element and two opposing properties', raw, confidence);
    }
    if (!raw.evidenceIds.length) return uncertainVerdict('confident physical classification cited no input evidence', raw, confidence);
  }
  if (cls === 'none' && !raw.evidenceIds.length) {
    return uncertainVerdict('confident none classification cited no input evidence', raw, confidence);
  }

  return {
    classification: cls as Classification,
    confidence,
    groundedEvidenceIds: raw.evidenceIds.slice(),
    rationale: str(raw.rationale) ?? '',
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Fixed classifier questions and live-answer adapter
// ---------------------------------------------------------------------------

export type ClassifierQuestion = {
  type: 'choice' | 'bool' | 'score';
  instructions: string;
  criteria: Record<string, string> | string[];
};

/** Deterministic, non-model-generated question set: one closed classification
 * choice, one evidence-grounding bool, and one bool per input evidence id so
 * confident output can cite real input evidence. */
export function buildQuestions(request: TrizRequest): Record<string, ClassifierQuestion> {
  const questions: Record<string, ClassifierQuestion> = {
    classification: {
      type: 'choice',
      instructions: 'Classify the contradiction described by the evidence and desired improvement.',
      criteria: {
        technical: 'Improving one outcome worsens another (a trade-off between two outcomes).',
        physical: 'The same element must have two opposing properties at once.',
        none: 'No contradiction is present in the evidence.',
        insufficient: 'The evidence is not sufficient to identify a contradiction.',
      },
    },
    evidence_grounding: {
      type: 'bool',
      instructions: 'Is the classification grounded only in the provided evidence, with every cited evidence id present in the input?',
      criteria: { true: 'Grounded in the provided evidence', false: 'Not grounded' },
    },
  };
  for (const e of request.evidence) {
    questions[`evidence_${e.id}`] = {
      type: 'bool',
      instructions: `Does evidence ${e.id} support the classification?`,
      criteria: { true: 'Supports the classification', false: 'Does not support the classification' },
    };
  }
  return questions;
}

export function buildState(request: TrizRequest): Record<string, unknown> {
  return {
    desiredImprovement: request.desiredImprovement,
    worseningOutcome: request.worseningOutcome ?? null,
    element: request.element ?? null,
    opposingProperties: request.opposingProperties ?? [],
    evidence: request.evidence.map((e) => ({ id: e.id, text: e.text })),
  };
}

/** Pure adapter from a raw Jev classifier result to a normalized verdict. */
export function adaptClassifierResponse(response: any): ClassifierVerdict {
  const answers =
    response && typeof response === 'object' && response.answers && typeof response.answers === 'object' ? response.answers : {};
  const cls = answers.classification;
  const classification = cls && cls.type === 'choice' && typeof cls.choice === 'string' ? cls.choice : undefined;
  const confidence = cls && cls.type === 'choice' && typeof cls.confidence === 'number' ? cls.confidence : null;
  const groundingAnswer = answers.evidence_grounding;
  const grounding =
    !!(groundingAnswer &&
      groundingAnswer.type === 'bool' &&
      typeof groundingAnswer.probability === 'number' &&
      groundingAnswer.probability >= CONFIDENCE_THRESHOLD);
  const evidenceIds: string[] = [];
  for (const key of Object.keys(answers)) {
    if (!key.startsWith('evidence_') || key === 'evidence_grounding') continue;
    const a = answers[key];
    if (a && a.type === 'bool' && typeof a.probability === 'number' && a.probability >= CONFIDENCE_THRESHOLD) {
      evidenceIds.push(key.slice('evidence_'.length));
    }
  }
  return { classification, confidence, evidenceIds, grounding };
}

// ---------------------------------------------------------------------------
// Relevance questions and adapter (ranked shortlist)
// ---------------------------------------------------------------------------

/** Every principle id that exists in the curated catalog, so relevance answers
 * for invented ids can be dropped rather than ranked. */
const CATALOG_PRINCIPLE_IDS = new Set<string>([...CATALOG.technical, ...CATALOG.physical].map((p) => p.id));

/** Deterministic, non-model-generated relevance questions: one bool per
 * catalog entry, keyed `relevance_<id>`, naming the principle and heuristic so
 * a confident result can be ranked without asking Jev for free text. */
export function buildRelevanceQuestions(
  request: TrizRequest,
  classification: 'technical' | 'physical',
): Record<string, ClassifierQuestion> {
  const catalog = classification === 'technical' ? CATALOG.technical : CATALOG.physical;
  const questions: Record<string, ClassifierQuestion> = {};
  for (const p of catalog) {
    questions[`relevance_${p.id}`] = {
      type: 'bool',
      instructions:
        `Does the "${p.name}" principle help resolve the stated contradiction? ` +
        `Principle heuristic: ${p.heuristic}`,
      criteria: {
        true: `The ${p.name} principle helps resolve the stated contradiction`,
        false: `The ${p.name} principle does not help resolve the stated contradiction`,
      },
    };
  }
  return questions;
}

/** Pure adapter from a raw Jev relevance result to a principle-id -> P(true)
 * map. Key shape, boolean answers, unknown ids, and non-finite values are all
 * filtered out. */
export function adaptRelevanceResponse(response: any): Record<string, number> {
  const answers =
    response && typeof response === 'object' && response.answers && typeof response.answers === 'object'
      ? response.answers
      : {};
  const out: Record<string, number> = {};
  for (const key of Object.keys(answers)) {
    if (!key.startsWith('relevance_')) continue;
    const id = key.slice('relevance_'.length);
    if (!CATALOG_PRINCIPLE_IDS.has(id)) continue;
    const a = answers[key];
    if (!a || typeof a !== 'object' || a.type !== 'bool') continue;
    const v = (a as { probability?: unknown }).probability;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[id] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Result building, hashing and atomic persistence
// ---------------------------------------------------------------------------

function canonicalize(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

/** Stable content hash of the request, independent of object key order. */
export function hashInput(input: unknown): string {
  return 'sha256:' + createHash('sha256').update(canonicalize(input)).digest('hex');
}

export type NormalizedUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  /** True only when the Pi SDK reported a usage object. When false the token
   * counts are unknown zeros, not authoritative zeros. */
  available: boolean;
  /** Legacy flat Pi-reported total in USD. null means the Pi SDK reported no
   * finite cost; 0 means it reported a cost of zero. Never a bill. */
  costUsd: number | null;
  /** Labelled Pi-reported cost. `available:false` means the cost is unknown,
   * not that the call was free. */
  piReported: PiReportedCost;
};

export type PiReportedCost = {
  amountUsd: number | null;
  available: boolean;
  source: 'pi_reported';
};

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function normalizeUsage(u: any): NormalizedUsage | null {
  if (!u || typeof u !== 'object') return null;
  // A cost object only counts when it carries a finite numeric total, so an
  // empty `{}` or a non-numeric total cannot masquerade as a reported zero.
  const cost = u.cost && typeof u.cost === 'object' ? u.cost : null;
  const total = cost ? finiteOrNull(cost.total) : null;
  return {
    input: num(u.input),
    output: num(u.output),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    totalTokens: num(u.totalTokens),
    available: true,
    costUsd: total,
    piReported: { amountUsd: total, available: total !== null, source: 'pi_reported' },
  };
}

export type Provenance = { provider: string; model: string };

/** A catalog principle plus its ranking metadata. A confident technical or
 * physical result carries a ranked shortlist; an unranked catalog carries the
 * principle fields only. */
export type RankedPrinciple = CatalogPrinciple & {
  rank?: number;
  relevance?: number;
  reason?: string;
  belowThreshold?: boolean;
};

export type TrizResult = {
  schemaVersion: number;
  inputHash: string;
  catalogVersion: string;
  requested: Provenance;
  reported: { provider: string; model: string; available: boolean };
  classification: ResultClassification;
  confidence: number | null;
  groundedEvidenceIds: string[];
  rationale: string;
  principles: RankedPrinciple[];
  needs: string[];
  usage: NormalizedUsage | null;
  billedCostUsd: null;
  inferenceDeterministic: false;
  catalog: {
    version: string;
    citations: string[];
    canonicalMatrixLookup: false;
    disclaimer: string;
  };
  notes: string[];
};

/** Minimum relevance for a principle to count as a confident match. */
export const RELEVANCE_FLOOR = 0.5;
/** A confident result returns at most this many ranked principles. */
export const MAX_RANKED_PRINCIPLES = 8;
/** When fewer than this many principles clear the relevance floor, the top
 * few by relevance are returned flagged `belowThreshold`. */
export const MIN_QUALIFYING_PRINCIPLES = 3;

function catalogFor(classification: ResultClassification): CatalogPrinciple[] {
  if (classification === 'technical') return CATALOG.technical.map((p) => ({ ...p }));
  if (classification === 'physical') return CATALOG.physical.map((p) => ({ ...p }));
  return [];
}

function relevanceReason(relevance: number, request: TrizRequest, verdict: TrizVerdict): string {
  const score = relevance.toFixed(2);
  const ids = verdict.groundedEvidenceIds.length ? verdict.groundedEvidenceIds.join(', ') : 'none';
  if (verdict.classification === 'physical') {
    const props = (request.opposingProperties ?? []).join(' and ');
    return `Relevance ${score} to ${request.element ?? 'the element'} needing ${props}; grounded in ${ids}`;
  }
  return `Relevance ${score} to improving ${request.desiredImprovement} without worsening ${
    request.worseningOutcome ?? 'the worsening outcome'
  }; grounded in ${ids}`;
}

/** Deterministic ranking only: order comes solely from the relevance answers
 * over the existing catalog. With no usable relevance data the full catalog is
 * returned unranked, preserving today's behaviour. */
export function rankPrinciples(
  catalog: CatalogPrinciple[],
  relevance: Record<string, number> | null,
  request: TrizRequest,
  verdict: TrizVerdict,
): RankedPrinciple[] {
  const unranked = (): RankedPrinciple[] => catalog.map((p) => ({ ...p }));
  if (!relevance || typeof relevance !== 'object') return unranked();

  const scored: { principle: CatalogPrinciple; relevance: number }[] = [];
  for (const p of catalog) {
    const v = relevance[p.id];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    scored.push({ principle: p, relevance: v });
  }
  if (scored.length === 0) return unranked();

  // Array.prototype.sort is stable, so equal relevance keeps catalog order.
  scored.sort((a, b) => b.relevance - a.relevance);
  const qualifying = scored.filter((s) => s.relevance >= RELEVANCE_FLOOR);
  const useFallback = qualifying.length < MIN_QUALIFYING_PRINCIPLES;
  const chosen = (useFallback ? scored.slice(0, MIN_QUALIFYING_PRINCIPLES) : qualifying).slice(0, MAX_RANKED_PRINCIPLES);

  return chosen.map((s, i) => ({
    ...s.principle,
    rank: i + 1,
    relevance: s.relevance,
    reason: relevanceReason(s.relevance, request, verdict),
    ...(useFallback ? { belowThreshold: true } : {}),
  }));
}

/** Deterministic rationale for a confident technical or physical result. The
 * classifier rationale, when present, is appended so the named request fields
 * and grounded evidence ids are always present. */
function deterministicRationale(request: TrizRequest, verdict: TrizVerdict): string {
  const ids = verdict.groundedEvidenceIds.length ? verdict.groundedEvidenceIds.join(', ') : 'no evidence id';
  if (verdict.classification === 'technical') {
    return `Improving ${request.desiredImprovement} without worsening ${
      request.worseningOutcome ?? 'the worsening outcome'
    }; grounded in evidence ${ids}.`;
  }
  if (verdict.classification === 'physical') {
    const props = (request.opposingProperties ?? []).join(' and ');
    return `${request.element ?? 'The element'} must satisfy ${props}; grounded in evidence ${ids}.`;
  }
  return '';
}

/** Request fields or evidence the caller should add to make progress. */
function needsFor(request: TrizRequest, verdict: TrizVerdict): string[] {
  if (verdict.classification === 'uncertain') {
    return ['more evidence that states the trade-off directly', ...verdict.notes];
  }
  if (verdict.classification === 'insufficient') {
    const physical =
      verdict.notes.some((n) => /physical/i.test(n)) ||
      request.element !== undefined ||
      (request.opposingProperties?.length ?? 0) > 0;
    return physical ? ['element', 'opposingProperties'] : ['worseningOutcome'];
  }
  return [];
}

export function buildResult(input: {
  inputHash: string;
  request: TrizRequest;
  requested: Provenance;
  verdict: TrizVerdict;
  provenance: Provenance;
  usage: NormalizedUsage | null;
  relevance?: Record<string, number> | null;
}): TrizResult {
  const { inputHash, request, requested, verdict, provenance, usage, relevance } = input;
  const confident = verdict.classification === 'technical' || verdict.classification === 'physical';
  const principles = confident ? rankPrinciples(catalogFor(verdict.classification), relevance ?? null, request, verdict) : [];
  const rankingUnavailable = confident && principles.length > 0 && principles.every((p) => p.rank === undefined);
  const deterministic = deterministicRationale(request, verdict);
  const rationale = deterministic
    ? verdict.rationale
      ? `${deterministic} ${verdict.rationale}`
      : deterministic
    : verdict.rationale;
  return {
    schemaVersion: SCHEMA_VERSION,
    inputHash,
    catalogVersion: CATALOG.version,
    requested: { provider: requested.provider, model: requested.model },
    reported: {
      provider: provenance.provider,
      model: provenance.model,
      available: provenance.provider !== 'unavailable' || provenance.model !== 'unavailable',
    },
    classification: verdict.classification,
    confidence: verdict.confidence,
    groundedEvidenceIds: verdict.groundedEvidenceIds,
    rationale,
    principles,
    needs: needsFor(request, verdict),
    usage,
    billedCostUsd: null,
    inferenceDeterministic: false,
    catalog: {
      version: CATALOG.version,
      citations: [...CATALOG.citations],
      canonicalMatrixLookup: CATALOG.canonicalMatrixLookup,
      disclaimer: CATALOG.disclaimer,
    },
    notes: [
      ...verdict.notes,
      ...(rankingUnavailable
        ? ['Principle ranking was unavailable: the classifier returned no usable relevance answers; the full catalog is returned unranked.']
        : []),
      ...(provenance.model.startsWith('~') ? ['Provider reported a model alias; the resolved underlying model version is unavailable.'] : []),
      'Classifier output is probabilistic inference; only the catalog mapping is deterministic.',
      'Billed cost is unknown: no upstream provider billing response is captured. A finite Pi SDK usage cost is labelled as Pi-reported (source: pi_reported) and is an estimate, not a bill; an absent cost is unknown, not free.',
    ],
  };
}

/** Write the result to `path` atomically: a same-directory temp file is fully
 * written, then renamed over the target. */
export function writeResultAtomic(path: string, result: TrizResult): void {
  const target = resolve(path);
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(target)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(result, null, 2));
  renameSync(tmp, target);
}

/** Read and validate a persisted result through the public handoff contract. */
export function inspectResult(path: string): TrizResult {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('result must be an object');
  if (parsed.schemaVersion !== SCHEMA_VERSION) throw Error(`unsupported schemaVersion: ${parsed.schemaVersion}`);
  if (!(RESULT_CLASSIFICATIONS as readonly string[]).includes(parsed.classification)) {
    throw Error(`unknown classification: ${parsed.classification}`);
  }
  return parsed as TrizResult;
}

// ---------------------------------------------------------------------------
// Live classifier (installed Pi SDK)
// ---------------------------------------------------------------------------

export type TrizClassifier = (
  context: { state: Record<string, unknown>; questions: Record<string, ClassifierQuestion> },
  options?: { signal?: AbortSignal },
) => Promise<any>;

/** Resolve the installed Pi SDK entry. No dependency install, no credentials
 * printed. Mirrors the supported worker.ts loadPiSdk approach. */
export async function loadPiSdk(): Promise<any> {
  const explicit = process.env.PI_SDK_MODULE || process.env.PI_SDK_PATH;
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  candidates.push(
    pathToFileURL(
      join(dirname(process.execPath), '..', 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
    ).href,
  );
  candidates.push('@earendil-works/pi-coding-agent');
  let lastErr: unknown;
  for (const c of candidates) {
    try {
      return await import(c);
    } catch (e) {
      lastErr = e;
    }
  }
  throw Error(`Pi SDK could not be loaded. Set PI_SDK_MODULE to the installed SDK entry point. Last error: ${msg(lastErr)}`);
}

/** Select a classifier catalog entry, falling back to an explicit
 * `{ provider, id }`. A fresh registry is created per call so the latest alias
 * resolves against the current catalog. */
export function resolveClassifierModel(registry: any, modelDef: {provider:string;id:string} = DEFAULT_TRIZ_MODEL): any {
  const found = registry?.getModelOfType?.('classifier', modelDef.provider, modelDef.id);
  if (found) return found;
  return { provider: modelDef.provider, id: modelDef.id };
}

export async function createTrizClassifier(modelDef: {provider:string;id:string} = DEFAULT_TRIZ_MODEL): Promise<TrizClassifier> {
  const sdk = await loadPiSdk();
  const runtime = await sdk.ModelRuntime.create();
  const registry = new sdk.ModelRegistry(runtime);
  const model = resolveClassifierModel(registry, modelDef);
  return async (context, options) => registry.classify(model, context, options);
}

// ---------------------------------------------------------------------------
// Bounded invocation
// ---------------------------------------------------------------------------

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal | undefined, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectPromise(new Error(`${label} timed out after ${Math.max(1, timeoutMs)}ms`));
      }
    }, Math.max(1, timeoutMs));
    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(new Error(`${label} aborted`));
      }
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener?.('abort', onAbort);
          resolvePromise(value);
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener?.('abort', onAbort);
          rejectPromise(error);
        }
      },
    );
  });
}

async function invokeClassifier(
  classify: TrizClassifier,
  context: { state: Record<string, unknown>; questions: Record<string, ClassifierQuestion> },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ result?: any; error?: string }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    const result = await withTimeout(
      Promise.resolve().then(() => classify(context, { signal: controller.signal })),
      timeoutMs,
      signal,
      'classifier request',
    );
    if (!result || typeof result !== 'object') return { error: 'classifier returned no result' };
    if (typeof result.stopReason === 'string' && result.stopReason !== 'stop') {
      return { result, error: result.errorMessage || `classifier stopReason=${result.stopReason}` };
    }
    if (result.errorMessage) return { result, error: result.errorMessage };
    if (!result.answers || typeof result.answers !== 'object') return { result, error: 'classifier returned no answers' };
    return { result };
  } catch (e) {
    return { error: msg(e) };
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
  }
}

// ---------------------------------------------------------------------------
// Analysis orchestration
// ---------------------------------------------------------------------------

/** Sum two normalized usages, used when a confident result makes a
 * classification call and a relevance call. A cost is known only when at least
 * one call reported a finite one. */
function addUsage(a: NormalizedUsage | null, b: NormalizedUsage | null): NormalizedUsage | null {
  if (!a) return b;
  if (!b) return a;
  const costA = a.piReported.available ? a.piReported.amountUsd : null;
  const costB = b.piReported.available ? b.piReported.amountUsd : null;
  const total = costA === null && costB === null ? null : (costA ?? 0) + (costB ?? 0);
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    available: true,
    costUsd: total,
    piReported: { amountUsd: total, available: total !== null, source: 'pi_reported' },
  };
}

export type AnalyzeOptions = {
  /** Deterministic offline fixture: a normalized verdict object or its path. */
  offline?: ClassifierVerdict | string;
  /** Injectable live classifier seam. Tests pass offline mocks. */
  classify?: TrizClassifier;
  /** Explicit output path; written atomically. */
  out?: string;
  provider?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export async function analyze(requestInput: unknown, options: AnalyzeOptions = {}): Promise<TrizResult> {
  const request = validateRequest(requestInput);
  const inputHash = hashInput(requestInput);
  const requested: Provenance = {
    provider: options.provider ?? DEFAULT_TRIZ_MODEL.provider,
    model: options.model ?? DEFAULT_TRIZ_MODEL.id,
  };
  const timeoutMs = options.timeoutMs ?? CLASSIFIER_TIMEOUT_MS;
  const signal = options.signal;

  let verdict: TrizVerdict;
  let provenance: Provenance = { provider: 'unavailable', model: 'unavailable' };
  let usage: NormalizedUsage | null = null;
  let relevance: Record<string, number> | null = null;

  if (options.offline !== undefined) {
    const fixture: any =
      typeof options.offline === 'string' ? JSON.parse(readFileSync(options.offline, 'utf8')) : options.offline;
    verdict = interpretVerdict(request, fixture);
    provenance = { provider: str(fixture?.provider) ?? 'unavailable', model: str(fixture?.model) ?? 'unavailable' };
    usage = normalizeUsage(fixture?.usage);
    const rawRelevance = fixture?.relevance;
    relevance =
      rawRelevance && typeof rawRelevance === 'object' && !Array.isArray(rawRelevance)
        ? (rawRelevance as Record<string, number>)
        : null;
  } else {
    let classify = options.classify;
    if (!classify) {
      try {
        classify = await withTimeout(
          createTrizClassifier({ provider: requested.provider, id: requested.model }),
          timeoutMs,
          signal,
          'classifier startup',
        );
      } catch (e) {
        verdict = uncertainVerdict(`classifier unavailable: ${msg(e)}`);
      }
    }
    if (classify) {
      const { result, error } = await invokeClassifier(
        classify,
        { state: buildState(request), questions: buildQuestions(request) },
        timeoutMs,
        signal,
      );
      if (error) {
        verdict = uncertainVerdict(error);
      } else {
        provenance = { provider: str(result?.provider) ?? 'unavailable', model: str(result?.model) ?? 'unavailable' };
        usage = normalizeUsage(result?.usage);
        verdict = interpretVerdict(request, adaptClassifierResponse(result));
        // Only a confident technical/physical verdict has a principle catalog to
        // rank, so only then is the second (relevance) classifier call made.
        if (verdict.classification === 'technical' || verdict.classification === 'physical') {
          const relevanceCall = await invokeClassifier(
            classify,
            {
              state: buildState(request),
              questions: buildRelevanceQuestions(request, verdict.classification),
            },
            timeoutMs,
            signal,
          );
          if (!relevanceCall.error) {
            usage = addUsage(usage, normalizeUsage(relevanceCall.result?.usage));
            const adapted = adaptRelevanceResponse(relevanceCall.result);
            relevance = Object.keys(adapted).length > 0 ? adapted : null;
          }
        }
      }
    }
  }

  const result = buildResult({ inputHash, request, requested, verdict: verdict!, provenance, usage, relevance });
  if (options.out) writeResultAtomic(options.out, result);
  return result;
}

// ---------------------------------------------------------------------------
// Package location and version
// ---------------------------------------------------------------------------

const PACKAGE_NAME = '@matthew-cochran/triz';

/** The directory holding this package's package.json: the module's own
 * directory when run from source (`triz.ts`), or its parent when run from the
 * compiled `dist/triz.js`, whether in a checkout or an installed package. */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const dir of [here, dirname(here)]) {
    try {
      if (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === PACKAGE_NAME) return dir;
    } catch {
      // Not this directory; try the next candidate.
    }
  }
  throw Error(`cannot find the ${PACKAGE_NAME} package.json next to ${here}`);
}

const PACKAGE_ROOT = packageRoot();
export const TRIZ_VERSION: string = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type CliOptionSpec = { hasValue: boolean };

type CliCommandSpec = {
  name: string;
  options: Record<string, CliOptionSpec>;
  minPositional: number;
  maxPositional: number;
  usage: string;
};

const CLI_COMMANDS: Record<string, CliCommandSpec> = {
  analyze: {
    name: 'analyze',
    options: {
      offline: { hasValue: true },
      out: { hasValue: true },
      provider: { hasValue: true },
      model: { hasValue: true },
      'timeout-ms': { hasValue: true },
    },
    minPositional: 1,
    maxPositional: 1,
    usage:
      'Usage: triz analyze <request.json> [--offline <response.json>] [--out <result.json>] [--provider <provider>] [--model <model>] [--timeout-ms <n>]',
  },
  inspect: {
    name: 'inspect',
    options: {},
    minPositional: 1,
    maxPositional: 1,
    usage: 'Usage: triz inspect <result.json>',
  },
  catalog: {
    name: 'catalog',
    options: {},
    minPositional: 0,
    maxPositional: 0,
    usage: 'Usage: triz catalog',
  },
};

const MAIN_USAGE = [
  'Usage: triz <command> [options]',
  '',
  'Commands:',
  '  analyze <request.json>  Classify a TRIZ request',
  '  inspect <result.json>   Print a persisted result',
  '  catalog                 Print the curated catalog',
  '  skills <action>         Install, uninstall or list agent skills',
  '',
  'Options:',
  '  -h, --help              Show help',
  '  -V, --version           Print the triz version',
  '',
  'Run "triz <command> --help" for command-specific options.',
].join('\n');

type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; positional: string[]; flags: Record<string, string | true> };

/** Strict per-command argument parser. It recognizes `-h`/`--help`, rejects
 * unknown options (including short flags), missing option values, and excess
 * positionals, and performs no filesystem or provider action itself. */
function parseCommandArgs(spec: CliCommandSpec, args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') return { kind: 'help' };
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const inlineValue = eq === -1 ? undefined : a.slice(eq + 1);
      const option = spec.options[name];
      if (!name || !option) return { kind: 'error', message: `unknown option: --${name}` };
      if (option.hasValue) {
        if (inlineValue !== undefined) {
          if (!inlineValue.trim()) return { kind: 'error', message: "option requires a nonempty value" };
          flags[name] = inlineValue;
        } else {
          const next = args[i + 1];
          if (next === undefined || next.startsWith('-')) {
            return { kind: 'error', message: `option --${name} requires a value` };
          }
          flags[name] = next;
          i++;
        }
      } else {
        if (inlineValue !== undefined) return { kind: 'error', message: `option --${name} does not take a value` };
        flags[name] = true;
      }
    } else if (a.startsWith('-') && a !== '-') {
      return { kind: 'error', message: `unknown option: ${a}` };
    } else {
      positional.push(a);
    }
  }
  if (positional.length < spec.minPositional) {
    return { kind: 'error', message: `${spec.name} requires a path argument` };
  }
  if (positional.length > spec.maxPositional) {
    return { kind: 'error', message: `${spec.name} accepts at most ${spec.maxPositional} positional argument(s)` };
  }
  return { kind: 'ok', positional, flags };
}

function reportCliError(message: string, usage: string): void {
  console.error(`error: ${message}`);
  console.error(usage);
}

/** Render an uncaught CLI error, including a stable `[code]` when the error
 * carries one (for example a TrizRequestError with `mixed_framing`). */
function formatCliException(e: unknown): string {
  const code = e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : null;
  return code ? `error[${code}]: ${msg(e)}` : `error: ${msg(e)}`;
}

async function cliAnalyze(spec: CliCommandSpec, args: string[]): Promise<number> {
  const parsed = parseCommandArgs(spec, args);
  if (parsed.kind === 'help') {
    console.log(spec.usage);
    return 0;
  }
  if (parsed.kind === 'error') {
    reportCliError(parsed.message, spec.usage);
    return 1;
  }
  const { positional, flags } = parsed;
  const options: AnalyzeOptions = {};
  if (typeof flags.offline === 'string') options.offline = flags.offline;
  if (typeof flags.out === 'string') options.out = flags.out;
  if (typeof flags.provider === 'string') options.provider = flags.provider;
  if (typeof flags.model === 'string') options.model = flags.model;
  if (typeof flags['timeout-ms'] === 'string') {
    const timeoutMs = Number(flags['timeout-ms']);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      reportCliError('--timeout-ms requires a positive number', spec.usage);
      return 1;
    }
    options.timeoutMs = timeoutMs;
  }
  const requestInput = JSON.parse(readFileSync(positional[0], 'utf8'));
  const result = await analyze(requestInput, options);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

function cliInspect(spec: CliCommandSpec, args: string[]): number {
  const parsed = parseCommandArgs(spec, args);
  if (parsed.kind === 'help') {
    console.log(spec.usage);
    return 0;
  }
  if (parsed.kind === 'error') {
    reportCliError(parsed.message, spec.usage);
    return 1;
  }
  const result = inspectResult(parsed.positional[0]);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

function cliCatalog(spec: CliCommandSpec, args: string[]): number {
  const parsed = parseCommandArgs(spec, args);
  if (parsed.kind === 'help') {
    console.log(spec.usage);
    return 0;
  }
  if (parsed.kind === 'error') {
    reportCliError(parsed.message, spec.usage);
    return 1;
  }
  console.log(JSON.stringify(CATALOG, null, 2));
  return 0;
}

// ---------------------------------------------------------------------------
// Agent skills installer (`triz skills install|uninstall|list`)
// ---------------------------------------------------------------------------
//
// Copies the agent skills shipped under `skills/` into the directories each
// agent tool reads. Every skills root written to gets a manifest,
// SKILLS_MANIFEST_FILE, recording the sha256 of each file as written and the
// targets that installed into the root. A later run uses it to tell triz's
// files from the user's: a file not in the manifest is foreign, a file whose
// hash no longer matches was edited by the user, and only a file that still
// matches is replaced or removed. `--force` overwrites foreign and edited
// files. A root shared by several targets (`.agents/skills`) keeps its files
// until the last of them is uninstalled. Each run plans and validates every
// change before the first write, writes atomically, and never writes MCP
// configuration.

export const SKILLS_MANIFEST_FILE = '.triz-skills.json';
export const SKILLS_MANIFEST_SCHEMA = 1;
const SKILLS_LOCK_FILE = '.triz-skills.lock';
const SKILLS_LOCK_STALE_MS = 10 * 60 * 1000;
const SKILLS_LOCK_POLL_MS = 50;
const SKILLS_LOCK_WRITE_GRACE_MS = 2000;
const SKILLS_LOCK_WAIT_DEFAULT_MS = 5000;
export const SKILL_TARGETS = ['claude', 'codex', 'cursor', 'copilot', 'gemini', 'agents-md', 'all'] as const;
export type SkillTarget = (typeof SKILL_TARGETS)[number];

const AGENTS_BLOCK_BEGIN = '<!-- triz:begin -->';
const AGENTS_BLOCK_END = '<!-- triz:end -->';

const SKILLS_USAGE = [
  'Usage:',
  '  triz skills install   --target <target> (--project <dir> | --user) [--dry-run] [--force]',
  '  triz skills uninstall --target <target> (--project <dir> | --user) [--dry-run]',
  '  triz skills list      [--project <dir> | --user]',
  '',
  'Targets:',
  '  claude     Claude Code      .claude/skills/          (user: ~/.claude/skills/)',
  '  codex      OpenAI Codex     .agents/skills/          (user: ~/.agents/skills/)',
  '  cursor     Cursor           .cursor/skills/          (user: ~/.cursor/skills/)',
  '  copilot    GitHub Copilot   .github/skills/          (user: ~/.copilot/skills/)',
  '  gemini     Gemini CLI       .agents/skills/ + .gemini/commands/triz-*.toml',
  '  agents-md  AGENTS.md block + .agents/skills/         (project only; for user scope use codex)',
  '  all        .claude/skills/ + .agents/skills/',
  '',
  'A file you edited, or one triz did not write, is kept and reported as skipped;',
  '--force overwrites it. No MCP configuration is written.',
].join('\n');

type SkillsManifest = {
  schema: number;
  triz_version: string;
  targets: string[];
  files: Record<string, string>;
  agents_md_block?: string;
  agents_md_created?: boolean;
};

type SkillStatus = 'created' | 'updated' | 'unchanged' | 'modified, skipped' | 'foreign, skipped' | 'removed';
const SKILL_STATUSES: SkillStatus[] = ['created', 'updated', 'unchanged', 'modified, skipped', 'foreign, skipped', 'removed'];

type SkillScope = { kind: 'user' | 'project'; base: string };
type SkillRoot = { dir: string; kind: 'skills' | 'gemini' };

class SkillsUsageError extends Error {}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Every file under the shipped `skills/` directory as (`/`-separated path, contents). */
function shippedSkillFiles(): [string, string][] {
  const base = join(PACKAGE_ROOT, 'skills');
  const files: [string, string][] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), childRel);
      else if (entry.isFile()) files.push([childRel, readFileSync(join(dir, entry.name), 'utf8')]);
    }
  };
  walk(base, '');
  return files;
}

/** The shipped skills (directories holding a SKILL.md) and their front-matter descriptions. */
function shippedSkills(files: [string, string][]): { name: string; description: string }[] {
  return files
    .filter(([rel]) => /^[^/]+\/SKILL\.md$/.test(rel))
    .map(([rel, text]) => {
      const name = rel.split('/')[0];
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
      const raw = /^description:\s*(.*)$/m.exec(front)?.[1]?.trim() ?? '';
      const description = raw.startsWith('"') ? JSON.parse(raw) : raw;
      return { name, description };
    });
}

function skillsHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function agentsRoot(base: string): SkillRoot {
  return { dir: join(base, '.agents', 'skills'), kind: 'skills' };
}

function rootsFor(target: SkillTarget, scope: SkillScope): SkillRoot[] {
  const skills = (rel: string): SkillRoot => ({ dir: join(scope.base, rel, 'skills'), kind: 'skills' });
  switch (target) {
    case 'claude':
      return [skills('.claude')];
    case 'codex':
    case 'agents-md':
      return [agentsRoot(scope.base)];
    case 'cursor':
      return [skills('.cursor')];
    case 'copilot':
      return [skills(scope.kind === 'user' ? '.copilot' : '.github')];
    case 'gemini':
      return [agentsRoot(scope.base), { dir: join(scope.base, '.gemini', 'commands'), kind: 'gemini' }];
    case 'all':
      return [skills('.claude'), agentsRoot(scope.base)];
  }
}

/** Every root any target can write for `scope`, for `list`. */
function allSkillRoots(scope: SkillScope): SkillRoot[] {
  const roots: SkillRoot[] = [];
  for (const target of ['claude', 'codex', 'cursor', 'copilot', 'gemini'] as const) {
    for (const root of rootsFor(target, scope)) if (!roots.some((r) => r.dir === root.dir)) roots.push(root);
  }
  return roots;
}

function tomlString(text: string): string {
  return JSON.stringify(text);
}

/** A Gemini CLI command that points Gemini at the installed skill, so the
 * skill stays the single source of instructions. */
function geminiCommand(name: string, description: string, scope: SkillScope): string {
  const skillPath =
    scope.kind === 'project' ? `.agents/skills/${name}/SKILL.md` : join(scope.base, '.agents', 'skills', name, 'SKILL.md');
  const prompt =
    `Follow the \`${name}\` agent skill for this request. Activate it with the activate_skill tool if it is ` +
    `available; otherwise read the file ${skillPath} and follow its instructions exactly, resolving its relative ` +
    `links from that file's directory. It uses the triz CLI.\n\nRequest: {{args}}\n`;
  return [
    '# Generated by triz skills install --target gemini. An edited copy is kept and no longer updated.',
    `description = ${tomlString(description)}`,
    `prompt = ${tomlString(prompt)}`,
    '',
  ].join('\n');
}

function plannedSkillFiles(root: SkillRoot, scope: SkillScope, files: [string, string][]): [string, string][] {
  if (root.kind === 'skills') return files;
  return shippedSkills(files)
    .filter((s) => s.name.startsWith('triz-'))
    .map((s) => [`${s.name}.toml`, geminiCommand(s.name, s.description, scope)]);
}

function agentsMdBlock(names: string[], eol: string): string {
  const lines = [
    AGENTS_BLOCK_BEGIN,
    '## triz',
    '',
    'This project resolves technical and physical contradictions with the `triz` CLI',
    '(`npx -y @matthew-cochran/triz`). `triz catalog` is offline; a live `triz analyze` is a paid',
    'classifier call and needs explicit authorization (`--offline <response.json>` replays one).',
    '',
    'Agent skills for it live in `.agents/skills/`:',
    '',
    ...names.map((n) => `- \`${n}\`: \`.agents/skills/${n}/SKILL.md\``),
    '',
    'This block is managed by `triz skills install --target agents-md`; keep your own notes',
    'outside the markers.',
    AGENTS_BLOCK_END,
  ];
  return lines.join(eol);
}

function lineEnding(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Character range of the managed AGENTS.md block, from the start of the
 * begin line to the end of the end line (its terminator excluded). */
function findAgentsBlock(text: string, shown: string): [number, number] | null {
  const refuse = (what: string) => Error(`${shown}: ${what}; fix the triz markers by hand (nothing was changed)`);
  let pos = 0;
  let open: number | null = null;
  let found: [number, number] | null = null;
  for (const line of text.split(/(?<=\n)/)) {
    const content = line.replace(/\n$/, '').replace(/\r$/, '');
    const marker = content.trim();
    if (marker === AGENTS_BLOCK_BEGIN) {
      if (open !== null) throw refuse(`nested ${AGENTS_BLOCK_BEGIN}`);
      if (found) throw refuse('more than one triz block');
      open = pos;
    } else if (marker === AGENTS_BLOCK_END) {
      if (open === null) throw refuse(`${AGENTS_BLOCK_END} without a begin marker`);
      found = [open, pos + content.length];
      open = null;
    }
    pos += line.length;
  }
  if (open !== null) throw refuse(`${AGENTS_BLOCK_BEGIN} without ${AGENTS_BLOCK_END}`);
  return found;
}

/** Refuse when `path` (under `root`) is a symlink, or a directory between
 * `root` and `path` is a symlink that resolves outside `root`. */
function checkInside(root: string, path: string): void {
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error(`${path} is not under ${root}`);
  const parts = rel.split(sep);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return;
    }
    if (!stat.isSymbolicLink()) continue;
    if (i === parts.length - 1) throw Error(`${current} is a symlink; refusing to write through it`);
    let inside = false;
    try {
      inside = !relative(realpathSync(root), realpathSync(current)).startsWith('..');
    } catch {
      inside = false;
    }
    if (!inside) throw Error(`refusing to follow the symlink ${current} out of ${root}`);
  }
}

/** The file to read and write for `<dir>/AGENTS.md`: the path itself, or the
 * target of a symlink that resolves to a file inside `dir`. */
function resolveAgentsMd(dir: string): string {
  const path = join(dir, 'AGENTS.md');
  try {
    if (!lstatSync(path).isSymbolicLink()) return path;
  } catch {
    return path;
  }
  let resolved: string;
  try {
    resolved = realpathSync(path);
  } catch {
    throw Error(`${path} is a symlink to a missing file; refusing to write through it`);
  }
  const rel = relative(realpathSync(dir), resolved);
  if (rel.startsWith('..') || isAbsolute(rel) || !statSync(resolved).isFile()) {
    throw Error(`${path} is a symlink to ${resolved}, which is not a file inside the project ${dir}; refusing to write through it`);
  }
  return resolved;
}

function readIfExists(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

/** Write `data` to `path` via a temp file in the same directory and a rename. */
function writeFileAtomic(path: string, data: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.triz-tmp-${process.pid}`);
  rmSync(tmp, { force: true });
  try {
    const fd = openSync(tmp, 'wx');
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Remove now-empty directories from `path`'s parent up to, not including, `root`. */
function pruneEmptyDirs(root: string, path: string): void {
  for (let dir = dirname(path); dir !== root && !relative(root, dir).startsWith('..'); dir = dirname(dir)) {
    try {
      rmdirSync(dir);
    } catch {
      return;
    }
  }
}

function joinRel(root: string, rel: string): string {
  return join(root, ...rel.split('/'));
}

/** Whether a manifest key is a safe relative path this root kind can hold. */
function validManifestKey(kind: SkillRoot['kind'], key: string, names: string[]): boolean {
  if (!key || key.startsWith('/') || /[\\:]/.test(key) || /[\u0000-\u001f]/.test(key)) return false;
  const segments = key.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) return false;
  if (kind === 'gemini') return segments.length === 1 && /^triz-[a-z0-9-]+\.toml$/.test(key);
  return segments.length >= 2 && (names.includes(segments[0]) || /^triz(-[a-z0-9-]+)?$/.test(segments[0]));
}

function loadSkillsManifest(root: SkillRoot, names: string[]): SkillsManifest | null {
  const path = join(root.dir, SKILLS_MANIFEST_FILE);
  checkInside(root.dir, path);
  const bytes = readIfExists(path);
  if (!bytes) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    throw Error(`${path} is not a valid manifest (${msg(e)}); remove it to start over`);
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.files !== 'object' || !parsed.files) {
    throw Error(`${path} is not a valid manifest; remove it to start over`);
  }
  if (typeof parsed.schema !== 'number' || parsed.schema > SKILLS_MANIFEST_SCHEMA) {
    throw Error(`${path} was written by triz ${parsed.triz_version} (manifest schema ${parsed.schema}); upgrade triz`);
  }
  const bad = Object.keys(parsed.files).find((k) => !validManifestKey(root.kind, k, names));
  if (bad !== undefined) {
    throw Error(
      `${path} lists the unsafe or unknown path ${JSON.stringify(bad)}; refusing to touch ${root.dir} (nothing was changed; delete the manifest to start over)`,
    );
  }
  return {
    schema: parsed.schema,
    triz_version: String(parsed.triz_version ?? ''),
    targets: Array.isArray(parsed.targets) ? parsed.targets.map(String) : [],
    files: { ...parsed.files },
    ...(typeof parsed.agents_md_block === 'string' ? { agents_md_block: parsed.agents_md_block } : {}),
    ...(parsed.agents_md_created === true ? { agents_md_created: true } : {}),
  };
}

function saveSkillsManifest(dir: string, manifest: SkillsManifest): void {
  const path = join(dir, SKILLS_MANIFEST_FILE);
  checkInside(dir, path);
  if (Object.keys(manifest.files).length === 0 && manifest.agents_md_block === undefined) {
    rmSync(path, { force: true });
    return;
  }
  const files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const out: SkillsManifest = {
    schema: SKILLS_MANIFEST_SCHEMA,
    triz_version: TRIZ_VERSION,
    targets: [...new Set(manifest.targets)].sort(),
    files,
  };
  if (manifest.agents_md_block !== undefined) out.agents_md_block = manifest.agents_md_block;
  if (manifest.agents_md_block !== undefined && manifest.agents_md_created) out.agents_md_created = true;
  writeFileAtomic(path, JSON.stringify(out, null, 2) + '\n');
}

class SkillsReport {
  lines: string[] = [];
  counts = new Map<SkillStatus, number>();
  record(status: SkillStatus, path: string): void {
    this.lines.push(`${status}  ${path}`);
    this.counts.set(status, this.count(status) + 1);
  }
  count(status: SkillStatus): number {
    return this.counts.get(status) ?? 0;
  }
  summary(): string {
    return SKILL_STATUSES.map((s) => `${this.count(s)} ${s.replace(', skipped', ' (skipped)')}`).join(', ');
  }
}

type FileOp = {
  path: string;
  rel: string;
  status: SkillStatus | null;
  write?: string;
  remove?: boolean;
  entry: { set: string } | 'keep' | 'drop';
};

type RootPlan = { root: SkillRoot; manifest: SkillsManifest; ops: FileOp[]; keptBy?: string[] };

function emptyManifest(): SkillsManifest {
  return { schema: SKILLS_MANIFEST_SCHEMA, triz_version: TRIZ_VERSION, targets: [], files: {} };
}

/** Remove `rel` if it still matches the manifest; keep it if edited. */
function planRemoval(root: string, rel: string, recorded: string): FileOp {
  const path = joinRel(root, rel);
  checkInside(root, path);
  const current = readIfExists(path);
  if (!current) return { path, rel, status: null, entry: 'drop' };
  if (sha256Hex(current) === recorded) return { path, rel, status: 'removed', remove: true, entry: 'drop' };
  return { path, rel, status: 'modified, skipped', entry: 'keep' };
}

function planInstallRoot(root: SkillRoot, scope: SkillScope, target: SkillTarget, force: boolean, files: [string, string][], names: string[]): RootPlan {
  const old = loadSkillsManifest(root, names);
  const manifest: SkillsManifest = old ? { ...old, files: { ...old.files } } : emptyManifest();
  if (!manifest.targets.includes(target)) manifest.targets.push(target);
  const planned = plannedSkillFiles(root, scope, files);
  const ops: FileOp[] = [];
  for (const [rel, content] of planned) {
    const path = joinRel(root.dir, rel);
    checkInside(root.dir, path);
    const current = readIfExists(path);
    const recorded = old?.files[rel];
    const hash = sha256Hex(content);
    if (!current) ops.push({ path, rel, status: 'created', write: content, entry: { set: hash } });
    else if (current.equals(Buffer.from(content))) ops.push({ path, rel, status: 'unchanged', entry: { set: hash } });
    else if (force || recorded === sha256Hex(current)) ops.push({ path, rel, status: 'updated', write: content, entry: { set: hash } });
    else ops.push({ path, rel, status: recorded ? 'modified, skipped' : 'foreign, skipped', entry: 'keep' });
  }
  // Files an older triz wrote that this one no longer ships.
  for (const [rel, recorded] of Object.entries(old?.files ?? {})) {
    if (!planned.some(([p]) => p === rel)) ops.push(planRemoval(root.dir, rel, recorded));
  }
  return { root, manifest, ops };
}

function planUninstallRoot(root: SkillRoot, target: SkillTarget, names: string[]): RootPlan | null {
  const manifest = loadSkillsManifest(root, names);
  if (!manifest) return null;
  const remaining = manifest.targets.filter((t) => t !== target);
  manifest.targets = remaining;
  if (remaining.length > 0) return { root, manifest, ops: [], keptBy: remaining.sort() };
  const ops = Object.entries(manifest.files).map(([rel, recorded]) => planRemoval(root.dir, rel, recorded));
  return { root, manifest, ops };
}

/** Run a root plan. On a failed write the manifest is saved for what was done
 * so far, so the next run still recognizes those files. */
function executeRootPlan(plan: RootPlan, dryRun: boolean, report: SkillsReport): void {
  const manifest = { ...plan.manifest, files: { ...plan.manifest.files } };
  for (const op of plan.ops) {
    if (!dryRun) {
      try {
        if (op.write !== undefined) writeFileAtomic(op.path, op.write);
        else if (op.remove) {
          rmSync(op.path);
          pruneEmptyDirs(plan.root.dir, op.path);
        }
      } catch (e) {
        saveSkillsManifest(plan.root.dir, manifest);
        throw e;
      }
    }
    if (op.entry === 'drop') delete manifest.files[op.rel];
    else if (op.entry !== 'keep') manifest.files[op.rel] = op.entry.set;
    if (op.status) report.record(op.status, op.path);
  }
  if (plan.keptBy) report.lines.push(`kept (still used by ${plan.keptBy.join(', ')})  ${plan.root.dir}`);
  if (!dryRun) saveSkillsManifest(plan.root.dir, manifest);
}

type AgentsPlan = {
  shown: string;
  file: string;
  status: SkillStatus;
  newText?: string;
  /** The block hash to record; `null` clears it; `undefined` leaves the manifest alone. */
  record?: string | null;
  created: boolean;
  deleteFile: boolean;
};

function planInstallAgentsMd(dir: string, names: string[], recorded: string | undefined, force: boolean): AgentsPlan {
  const shown = join(dir, 'AGENTS.md');
  const file = resolveAgentsMd(dir);
  const existing = readIfExists(file)?.toString('utf8') ?? null;
  const eol = existing === null ? '\n' : lineEnding(existing);
  const block = agentsMdBlock(names, eol);
  let status: SkillStatus;
  let newText: string | undefined;
  if (existing === null) {
    status = 'created';
    newText = `${block}${eol}`;
  } else {
    const range = findAgentsBlock(existing, shown);
    if (!range) {
      status = 'updated';
      if (existing === '') newText = `${block}${eol}`;
      else if (existing.endsWith(eol)) newText = `${existing}${eol}${block}${eol}`;
      else newText = `${existing}${eol}${eol}${block}`;
    } else {
      const current = existing.slice(range[0], range[1]);
      if (current === block) status = 'unchanged';
      else if (force || recorded === sha256Hex(current)) {
        status = 'updated';
        newText = existing.slice(0, range[0]) + block + existing.slice(range[1]);
      } else status = recorded ? 'modified, skipped' : 'foreign, skipped';
    }
  }
  const ours = status === 'created' || status === 'updated' || status === 'unchanged';
  return { shown, file, status, newText, record: ours ? sha256Hex(block) : undefined, created: existing === null, deleteFile: false };
}

function planUninstallAgentsMd(dir: string, recorded: string | undefined, created: boolean): AgentsPlan | null {
  const shown = join(dir, 'AGENTS.md');
  const file = resolveAgentsMd(dir);
  const text = readIfExists(file)?.toString('utf8');
  if (text === undefined) return null;
  const range = findAgentsBlock(text, shown);
  if (!range) return null;
  if (recorded !== sha256Hex(text.slice(range[0], range[1]))) {
    return { shown, file, status: recorded ? 'modified, skipped' : 'foreign, skipped', created: false, deleteFile: false };
  }
  // Undo exactly what install added, so install + uninstall is byte-identical.
  const eol = lineEnding(text);
  const before = text.slice(0, range[0]);
  const after = text.slice(range[1]);
  const terminator = after.startsWith('\r\n') ? '\r\n' : after.startsWith('\n') ? '\n' : '';
  let rest: string;
  if (after === '') rest = before.endsWith(eol + eol) ? before.slice(0, -2 * eol.length) : before;
  else if (after === terminator) rest = before.endsWith(terminator) ? before.slice(0, -terminator.length) : before;
  else rest = before + after.slice(terminator.length);
  const deleteFile = rest === '' && created;
  return { shown, file, status: 'removed', newText: deleteFile ? undefined : rest, record: null, created: false, deleteFile };
}

function executeAgentsPlan(plan: AgentsPlan, skillsRoot: SkillRoot, names: string[], dryRun: boolean, report: SkillsReport): void {
  report.record(plan.status, plan.shown);
  if (dryRun) return;
  if (plan.deleteFile) rmSync(plan.file);
  else if (plan.newText !== undefined) writeFileAtomic(plan.file, plan.newText);
  if (plan.record === undefined) return;
  const manifest = loadSkillsManifest(skillsRoot, names) ?? emptyManifest();
  if (plan.record === null) {
    delete manifest.agents_md_block;
    delete manifest.agents_md_created;
  } else {
    manifest.agents_md_created = plan.created || manifest.agents_md_created === true;
    manifest.agents_md_block = plan.record;
  }
  saveSkillsManifest(skillsRoot.dir, manifest);
}

type SkillsOptions = { target?: SkillTarget; scope?: SkillScope; dryRun: boolean; force: boolean };

const SKILLS_COMMANDS: Record<string, CliCommandSpec> = {
  install: {
    name: 'skills install',
    options: { target: { hasValue: true }, project: { hasValue: true }, user: { hasValue: false }, 'dry-run': { hasValue: false }, force: { hasValue: false } },
    minPositional: 0,
    maxPositional: 0,
    usage: SKILLS_USAGE,
  },
  uninstall: {
    name: 'skills uninstall',
    options: { target: { hasValue: true }, project: { hasValue: true }, user: { hasValue: false }, 'dry-run': { hasValue: false } },
    minPositional: 0,
    maxPositional: 0,
    usage: SKILLS_USAGE,
  },
  list: {
    name: 'skills list',
    options: { project: { hasValue: true }, user: { hasValue: false } },
    minPositional: 0,
    maxPositional: 0,
    usage: SKILLS_USAGE,
  },
};

function skillsOptions(flags: Record<string, string | true>): SkillsOptions {
  const opts: SkillsOptions = { dryRun: flags['dry-run'] === true, force: flags.force === true };
  if (typeof flags.target === 'string') {
    if (!(SKILL_TARGETS as readonly string[]).includes(flags.target)) {
      throw new SkillsUsageError(`unknown target: ${flags.target} (${SKILL_TARGETS.join(', ')})`);
    }
    opts.target = flags.target as SkillTarget;
  }
  if (typeof flags.project === 'string' && flags.user === true) throw new SkillsUsageError('give one of --project <dir> or --user');
  if (typeof flags.project === 'string') {
    const dir = resolve(flags.project);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) throw new SkillsUsageError(`--project ${flags.project}: not an existing directory`);
    opts.scope = { kind: 'project', base: dir };
  }
  if (flags.user === true) opts.scope = { kind: 'user', base: skillsHome() };
  return opts;
}

function requireTargetAndScope(opts: SkillsOptions): { target: SkillTarget; scope: SkillScope } {
  if (!opts.target) throw new SkillsUsageError('--target <target> is required');
  if (!opts.scope) throw new SkillsUsageError('give one of --project <dir> or --user');
  if (opts.target === 'agents-md' && opts.scope.kind === 'user') {
    throw new SkillsUsageError('--target agents-md is project only (there is no user-level AGENTS.md); for user scope use --target codex --user');
  }
  return { target: opts.target, scope: opts.scope };
}

/** How long a run waits for a busy lock, from TRIZ_SKILLS_LOCK_WAIT_MS. */
function skillsLockWaitMs(): number {
  const raw = process.env.TRIZ_SKILLS_LOCK_WAIT_MS;
  if (raw === undefined || raw === '') return SKILLS_LOCK_WAIT_DEFAULT_MS;
  const ms = Number(raw);
  return Number.isInteger(ms) && ms >= 0 ? ms : SKILLS_LOCK_WAIT_DEFAULT_MS;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The contents of a lock that can be taken over, or null when it is live.
 * A lock is stale when it is older than ten minutes or names a same-host
 * process id that is no longer running. A lock without readable contents is
 * stale only once its file is older than SKILLS_LOCK_WRITE_GRACE_MS, since a
 * live run creates the file before it writes its owner. */
function staleSkillsLock(path: string): Buffer | null {
  let mtimeMs: number;
  let bytes: Buffer;
  try {
    mtimeMs = statSync(path).mtimeMs;
    bytes = readFileSync(path);
  } catch {
    return null;
  }
  let info: any;
  try {
    info = JSON.parse(bytes.toString('utf8'));
  } catch {
    info = null;
  }
  if (!info || typeof info !== 'object') return Date.now() - mtimeMs > SKILLS_LOCK_WRITE_GRACE_MS ? bytes : null;
  const created = typeof info.created === 'string' ? Date.parse(info.created) : NaN;
  if (!Number.isFinite(created) || Date.now() - created > SKILLS_LOCK_STALE_MS) return bytes;
  if (info.host === hostname() && typeof info.pid === 'number') {
    try {
      process.kill(info.pid, 0);
    } catch (e: any) {
      if (e?.code === 'ESRCH') return bytes;
    }
  }
  return null;
}

/** Create `<root>/.triz-skills.lock` with `wx`, recovering a stale lock and
 * waiting up to `waitMs` for a live one. Returns the lock path. */
function acquireRootLock(root: SkillRoot, waitMs: number): string {
  mkdirSync(root.dir, { recursive: true });
  const path = join(root.dir, SKILLS_LOCK_FILE);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), created: new Date().toISOString() }));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      return path;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
    }
    const stale = staleSkillsLock(path);
    // Remove it only if it still holds what was judged stale, so a lock that
    // another run took over in the meantime is never deleted.
    if (stale && readIfExists(path)?.equals(stale)) {
      rmSync(path, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw Error(
        `${path} is locked by another running triz skills command; ` +
          `if no other run is active, delete the lock file (waited ${waitMs} ms)`,
      );
    }
    sleepSync(SKILLS_LOCK_POLL_MS);
  }
}

/** Take a lock for every root (sorted by path so concurrent runs agree on the
 * order), run `fn`, then always release the locks and drop roots left empty. */
function withRootLocks<T>(roots: SkillRoot[], fn: () => T): T {
  const ordered = [...roots].sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  const waitMs = skillsLockWaitMs();
  const locked: { dir: string; path: string }[] = [];
  try {
    for (const root of ordered) locked.push({ dir: root.dir, path: acquireRootLock(root, waitMs) });
    return fn();
  } finally {
    for (const lock of locked) rmSync(lock.path, { force: true });
    for (const lock of locked) {
      try {
        rmdirSync(lock.dir);
      } catch {
        // Not empty: it still holds someone's files.
      }
    }
  }
}

function skillsInstall(opts: SkillsOptions): string[] {
  const { target, scope } = requireTargetAndScope(opts);
  const files = shippedSkillFiles();
  const names = shippedSkills(files).map((s) => s.name);
  const roots = rootsFor(target, scope);
  return withRootLocks(opts.dryRun ? [] : roots, () => {
    // Validate and plan everything before the first write.
    const plans = roots.map((root) => planInstallRoot(root, scope, target, opts.force, files, names));
    const agents = target === 'agents-md' ? planInstallAgentsMd(scope.base, names, plans[0].manifest.agents_md_block, opts.force) : null;
    const report = new SkillsReport();
    for (const plan of plans) executeRootPlan(plan, opts.dryRun, report);
    if (agents) executeAgentsPlan(agents, roots[0], names, opts.dryRun, report);
    const out = [...report.lines];
    out.push(
      `triz ${TRIZ_VERSION} skills install --target ${target} (${scope.kind}): ${report.summary()}${opts.dryRun ? ' (dry run: nothing written)' : ''}`,
    );
    if (report.count('modified, skipped') + report.count('foreign, skipped') > 0) {
      out.push('Skipped files were kept as they are; rerun with --force to overwrite them.');
    }
    if (target === 'all') {
      out.push(
        'Note: --target all writes .claude/skills (Claude Code) and .agents/skills (Codex, Gemini and others) only. ' +
          'Cursor and Copilot read both directories and may list each skill twice; to avoid that, install with --target cursor or --target copilot alone.',
      );
    }
    return out;
  });
}

function skillsUninstall(opts: SkillsOptions): string[] {
  const { target, scope } = requireTargetAndScope(opts);
  const names = shippedSkills(shippedSkillFiles()).map((s) => s.name);
  const isDir = (dir: string) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  };
  const roots = rootsFor(target, scope).filter((r) => isDir(r.dir));
  return withRootLocks(opts.dryRun ? [] : roots, () => {
    const plans = roots.map((root) => planUninstallRoot(root, target, names)).filter((p): p is RootPlan => p !== null);
    const agentsSkills = agentsRoot(scope.base);
    let agents: AgentsPlan | null = null;
    if (target === 'agents-md') {
      const manifest = plans.find((p) => p.root.dir === agentsSkills.dir)?.manifest;
      agents = planUninstallAgentsMd(scope.base, manifest?.agents_md_block, manifest?.agents_md_created === true);
    }
    const report = new SkillsReport();
    for (const plan of plans) executeRootPlan(plan, opts.dryRun, report);
    if (agents) executeAgentsPlan(agents, agentsSkills, names, opts.dryRun, report);
    return [
      ...report.lines,
      `triz ${TRIZ_VERSION} skills uninstall --target ${target} (${scope.kind}): ${report.summary()}${opts.dryRun ? ' (dry run: nothing removed)' : ''}`,
    ];
  });
}

function skillsList(opts: SkillsOptions): string[] {
  const scopes: SkillScope[] = opts.scope
    ? [opts.scope]
    : [
        { kind: 'user', base: skillsHome() },
        { kind: 'project', base: process.cwd() },
      ];
  const names = shippedSkills(shippedSkillFiles()).map((s) => s.name);
  const out: string[] = [];
  let found = 0;
  for (const scope of scopes) {
    for (const root of allSkillRoots(scope)) {
      const manifest = loadSkillsManifest(root, names);
      if (!manifest) continue;
      const entries = Object.entries(manifest.files);
      let modified = 0;
      let missing = 0;
      for (const [rel, recorded] of entries) {
        const current = readIfExists(joinRel(root.dir, rel));
        if (!current) missing++;
        else if (sha256Hex(current) !== recorded) modified++;
      }
      const label = `(${scope.kind}) triz ${manifest.triz_version}`;
      if (entries.length > 0) {
        found++;
        out.push(`${root.dir}  ${label} [${manifest.targets.join(', ')}]: ${entries.length} files, ${modified} modified, ${missing} missing`);
      }
      if (manifest.agents_md_block !== undefined) {
        found++;
        out.push(`${join(dirname(dirname(root.dir)), 'AGENTS.md')}  ${label}: managed block`);
      }
    }
  }
  out.push(`${found} triz skill installs found under ${scopes.map((s) => s.base).join(', ')}`);
  return out;
}

function cliSkills(args: string[]): number {
  const [sub, ...rest] = args;
  if (sub === undefined) {
    reportCliError('missing skills command (install, uninstall, list)', SKILLS_USAGE);
    return 1;
  }
  if (sub === '--help' || sub === '-h' || sub === 'help') {
    console.log(SKILLS_USAGE);
    return 0;
  }
  const spec = SKILLS_COMMANDS[sub];
  if (!spec) {
    reportCliError(`unknown skills command: ${sub}`, SKILLS_USAGE);
    return 1;
  }
  const parsed = parseCommandArgs(spec, rest);
  if (parsed.kind === 'help') {
    console.log(SKILLS_USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    reportCliError(parsed.message, SKILLS_USAGE);
    return 1;
  }
  try {
    const opts = skillsOptions(parsed.flags);
    const lines = sub === 'install' ? skillsInstall(opts) : sub === 'uninstall' ? skillsUninstall(opts) : skillsList(opts);
    console.log(lines.join('\n'));
    return 0;
  } catch (e) {
    if (e instanceof SkillsUsageError) {
      reportCliError(e.message, SKILLS_USAGE);
    } else {
      console.error(formatCliException(e));
    }
    return 1;
  }
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    console.error(MAIN_USAGE);
    return 1;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(MAIN_USAGE);
    return 0;
  }
  if (command === '--version' || command === '-V') {
    console.log(`triz ${TRIZ_VERSION}`);
    return 0;
  }
  if (command.startsWith('-')) {
    reportCliError(`unknown option: ${command}`, MAIN_USAGE);
    return 1;
  }
  if (command === 'skills') return cliSkills(rest);
  const spec = CLI_COMMANDS[command];
  if (!spec) {
    reportCliError(`unknown command: ${command}`, MAIN_USAGE);
    return 1;
  }
  if (spec.name === 'analyze') {
    try {
      return await cliAnalyze(spec, rest);
    } catch (e) {
      console.error(formatCliException(e));
      return 1;
    }
  }
  if (spec.name === 'inspect') return cliInspect(spec, rest);
  return cliCatalog(spec, rest);
}

/** True when this module is the process entry point. Resolving real paths
 * makes the check work for `node triz.ts`, the compiled `node dist/triz.js`,
 * Unix npm bin symlinks (`.bin/triz`), and Windows npm `.cmd`/`.ps1` shims
 * that invoke the real compiled file. Comparison by real path also keeps the
 * check independent of the script name, so compiled output is recognized. */
function isDirectInvocation(argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(formatCliException(e));
      process.exitCode = 1;
    },
  );
}