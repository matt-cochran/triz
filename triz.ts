#!/usr/bin/env node
// Minimal, dependency-free TRIZ contradiction classification CLI and library.
//
// The classification is produced by a typed classifier (TypeSafe's Jev via the
// installed Pi SDK) and is probabilistic. The catalog below is a small,
// software-adapted heuristic set. It is NOT the complete classical TRIZ 39x39
// contradiction matrix, and a software heuristic is not a canonical matrix
// lookup.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Fixed taxonomy and bounds
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;
export const CATALOG_VERSION = 'triz-software-1';
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

export const CATALOG: Catalog = {
  version: CATALOG_VERSION,
  citations: [CONTRADICTIONS_SOURCE, PRINCIPLES_SOURCE],
  canonicalMatrixLookup: false,
  completeClassicalMatrix: false,
  disclaimer:
    'Small software-adapted TRIZ heuristic catalog. It is not the complete classical 39x39 ' +
    'contradiction matrix, and a software heuristic is not a canonical matrix lookup.',
  technical: [
    {
      id: '1',
      name: 'segmentation',
      heuristic: 'Split the conflicting system into independent parts so each part can be optimized separately.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '10',
      name: 'preliminary action',
      heuristic: 'Perform part of the change ahead of time so a later step no longer trades off against an earlier one.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '23',
      name: 'feedback',
      heuristic: 'Use feedback from the worsening outcome to correct the improvement instead of accepting the trade-off.',
      source: PRINCIPLES_SOURCE,
    },
    {
      id: '24',
      name: 'intermediary',
      heuristic: 'Insert an intermediate carrier or abstraction between the two conflicting outcomes.',
      source: PRINCIPLES_SOURCE,
    },
  ],
  physical: [
    {
      id: 'time-separation',
      name: 'separation in time',
      heuristic: 'Let the element satisfy each opposing property at a different time.',
      source: CONTRADICTIONS_SOURCE,
    },
    {
      id: 'space-separation',
      name: 'separation in space',
      heuristic: 'Let the element satisfy each opposing property in a different place or component.',
      source: CONTRADICTIONS_SOURCE,
    },
    {
      id: 'condition-separation',
      name: 'separation by condition',
      heuristic: 'Let the element satisfy each opposing property under a different condition or context.',
      source: CONTRADICTIONS_SOURCE,
    },
  ],
};

export function validateCatalog(catalog: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { ok: false, errors: ['catalog must be an object'] };
  }
  if (typeof catalog.version !== 'string' || !catalog.version.trim()) errors.push('catalog.version must be a non-empty string');
  if (!Array.isArray(catalog.citations) || catalog.citations.length === 0) errors.push('catalog.citations must be a non-empty array');
  if (!Array.isArray(catalog.technical) || catalog.technical.length === 0) errors.push('catalog.technical must be a non-empty array');
  if (!Array.isArray(catalog.physical) || catalog.physical.length === 0) errors.push('catalog.physical must be a non-empty array');
  if (typeof catalog.canonicalMatrixLookup !== 'boolean') errors.push('catalog.canonicalMatrixLookup must be a boolean');
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

export function validateRequest(input: any): TrizRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('request must be an object');
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) throw Error('request.evidence must be a non-empty array');
  for (const e of input.evidence) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw Error('each evidence entry must be an object');
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
  totalTokens: number;
  costUsd: number | null;
};

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function normalizeUsage(u: any): NormalizedUsage | null {
  if (!u || typeof u !== 'object') return null;
  const cost =
    u.cost && typeof u.cost === 'object' && typeof u.cost.total === 'number' && Number.isFinite(u.cost.total)
      ? u.cost.total
      : null;
  return { input: num(u.input), output: num(u.output), totalTokens: num(u.totalTokens), costUsd: cost };
}

export type Provenance = { provider: string; model: string };

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
  principles: CatalogPrinciple[];
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

function principlesFor(classification: ResultClassification): CatalogPrinciple[] {
  if (classification === 'technical') return CATALOG.technical.map((p) => ({ ...p }));
  if (classification === 'physical') return CATALOG.physical.map((p) => ({ ...p }));
  return [];
}

export function buildResult(input: {
  inputHash: string;
  requested: Provenance;
  verdict: TrizVerdict;
  provenance: Provenance;
  usage: NormalizedUsage | null;
}): TrizResult {
  const { inputHash, requested, verdict, provenance, usage } = input;
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
    rationale: verdict.rationale,
    principles: principlesFor(verdict.classification),
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
      ...(provenance.model.startsWith('~') ? ['Provider reported a model alias; the resolved underlying model version is unavailable.'] : []),
      'Classifier output is probabilistic inference; only the catalog mapping is deterministic.',
      'Billed cost is unknown; usage cost, when present, is a catalog estimate and not a bill.',
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

  if (options.offline !== undefined) {
    const fixture: any =
      typeof options.offline === 'string' ? JSON.parse(readFileSync(options.offline, 'utf8')) : options.offline;
    verdict = interpretVerdict(request, fixture);
    provenance = { provider: str(fixture?.provider) ?? 'unavailable', model: str(fixture?.model) ?? 'unavailable' };
    usage = normalizeUsage(fixture?.usage);
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
      }
    }
  }

  const result = buildResult({ inputHash, requested, verdict: verdict!, provenance, usage });
  if (options.out) writeResultAtomic(options.out, result);
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function cliAnalyze(args: string[]): Promise<number> {
  const { positional, flags } = parseArgs(args);
  if (!positional[0]) {
    console.error('analyze requires a request.json path');
    return 1;
  }
  const requestInput = JSON.parse(readFileSync(positional[0], 'utf8'));
  const options: AnalyzeOptions = {};
  if (typeof flags.offline === 'string') options.offline = flags.offline;
  if (typeof flags.out === 'string') options.out = flags.out;
  if (typeof flags.provider === 'string') options.provider = flags.provider;
  if (typeof flags.model === 'string') options.model = flags.model;
  if (typeof flags['timeout-ms'] === 'string') options.timeoutMs = Number(flags['timeout-ms']);
  const result = await analyze(requestInput, options);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

function cliInspect(args: string[]): number {
  const { positional } = parseArgs(args);
  if (!positional[0]) {
    console.error('inspect requires a result.json path');
    return 1;
  }
  const result = inspectResult(positional[0]);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'analyze') return cliAnalyze(rest);
  if (command === 'inspect') return cliInspect(rest);
  if (command === 'catalog') {
    console.log(JSON.stringify(CATALOG, null, 2));
    return 0;
  }
  console.error(
    'Usage: triz.ts analyze <request.json> [--offline <response.json>] [--out <result.json>] [--provider <p>] [--model <m>] [--timeout-ms <n>]',
  );
  console.error('       triz.ts inspect <result.json>');
  console.error('       triz.ts catalog');
  return 1;
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
      console.error(msg(e));
      process.exitCode = 1;
    },
  );
}