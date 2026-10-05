import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  analyze,
  buildQuestions,
  hashInput,
  validateRequest,
  inspectResult,
  writeResultAtomic,
  validateCatalog,
  CATALOG,
  CATALOG_VERSION,
  SCHEMA_VERSION,
  type ClassifierVerdict,
} from './triz.ts';

const trizPath = fileURLToPath(new URL('./triz.ts', import.meta.url));

const technicalRequest = {
  evidence: [
    { id: 'E1', text: 'Users report the dashboard is slow.' },
    { id: 'E2', text: 'Caching reduced latency but users now see stale data.' },
  ],
  desiredImprovement: 'Reduce dashboard latency',
  worseningOutcome: 'Data freshness',
};

const physicalRequest = {
  evidence: [{ id: 'P1', text: 'The cache must be large for hit rate and small for memory.' }],
  desiredImprovement: 'Maximize hit rate while minimizing memory',
  element: 'response cache',
  opposingProperties: ['large for hit rate', 'small for memory'],
};

const noneRequest = {
  evidence: [{ id: 'N1', text: 'A retry was added with no measured trade-off.' }],
  desiredImprovement: 'Improve reliability',
};

const insufficientRequest = {
  evidence: [{ id: 'I1', text: 'Something feels off.' }],
  desiredImprovement: 'Make it better',
};

const technicalVerdict: ClassifierVerdict = {
  classification: 'technical',
  confidence: 0.92,
  evidenceIds: ['E1', 'E2'],
  grounding: true,
  rationale: 'Latency improved at the cost of freshness.',
};

const physicalVerdict: ClassifierVerdict = {
  classification: 'physical',
  confidence: 0.9,
  evidenceIds: ['P1'],
  grounding: true,
};

const noneVerdict: ClassifierVerdict = {
  classification: 'none',
  confidence: 0.8,
  evidenceIds: ['N1'],
  grounding: true,
};

const insufficientVerdict: ClassifierVerdict = {
  classification: 'insufficient',
  confidence: 0.7,
  evidenceIds: [],
  grounding: true,
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'triz-'));
}

test('analyze classifies a grounded technical contradiction as technical', async () => {
  const result = await analyze(technicalRequest, { offline: technicalVerdict });
  assert.equal(result.classification, 'technical');
});

test('analyze classifies a grounded physical contradiction as physical', async () => {
  const result = await analyze(physicalRequest, { offline: physicalVerdict });
  assert.equal(result.classification, 'physical');
});

test('analyze classifies a grounded none response as none', async () => {
  const result = await analyze(noneRequest, { offline: noneVerdict });
  assert.equal(result.classification, 'none');
});

test('analyze classifies an insufficient response as insufficient', async () => {
  const result = await analyze(insufficientRequest, { offline: insufficientVerdict });
  assert.equal(result.classification, 'insufficient');
});

test('analyze classifies a malformed classifier response as uncertain', async () => {
  const result = await analyze(technicalRequest, {
    offline: { classification: 'bogus', confidence: 0.9, evidenceIds: ['E1'], grounding: true },
  });
  assert.equal(result.classification, 'uncertain');
});

test('analyze classifies a below-threshold confidence response as uncertain', async () => {
  const result = await analyze(technicalRequest, {
    offline: { classification: 'technical', confidence: 0.2, evidenceIds: ['E1'], grounding: true },
  });
  assert.equal(result.classification, 'uncertain');
});

test('analyze classifies a response citing unknown evidence ids as uncertain', async () => {
  const result = await analyze(technicalRequest, {
    offline: { classification: 'technical', confidence: 0.9, evidenceIds: ['E999'], grounding: true },
  });
  assert.equal(result.classification, 'uncertain');
});

test('technical results recommend only the four curated broad heuristics', async () => {
  const result = await analyze(technicalRequest, { offline: technicalVerdict });
  assert.deepEqual(result.principles.map((p) => p.id), ['1', '10', '23', '24']);
});

test('physical results recommend the three separation heuristics', async () => {
  const result = await analyze(physicalRequest, { offline: physicalVerdict });
  assert.deepEqual(result.principles.map((p) => p.name), [
    'separation in time',
    'separation in space',
    'separation by condition',
  ]);
});

test('result records the schema version', async () => {
  const result = await analyze(technicalRequest, { offline: technicalVerdict });
  assert.equal(result.schemaVersion, SCHEMA_VERSION);
});

test('result records the input hash', async () => {
  const result = await analyze(technicalRequest, { offline: technicalVerdict });
  assert.equal(result.inputHash, hashInput(technicalRequest));
});

test('result records the catalog version', async () => {
  const result = await analyze(technicalRequest, { offline: technicalVerdict });
  assert.equal(result.catalogVersion, CATALOG_VERSION);
});

test('result records the requested provider and model', async () => {
  const result = await analyze(technicalRequest, { offline: technicalVerdict });
  assert.deepEqual(result.requested, { provider: 'openrouter', model: '~typesafe/jev-latest' });
});

test('result reports unavailable provenance when the classifier returns no model', async () => {
  const classify = async () => ({
    answers: {
      classification: { type: 'choice', choice: 'technical', confidence: 0.9 },
      evidence_grounding: { type: 'bool', probability: 0.9 },
      evidence_E1: { type: 'bool', probability: 0.9 },
    },
  });
  const result = await analyze(technicalRequest, { classify });
  assert.equal(result.reported.model, 'unavailable');
});

test('result reports the actual model when the classifier returns one', async () => {
  const classify = async () => ({
    provider: 'openrouter',
    model: 'typesafe/jev-test',
    answers: {
      classification: { type: 'choice', choice: 'technical', confidence: 0.9 },
      evidence_grounding: { type: 'bool', probability: 0.9 },
      evidence_E1: { type: 'bool', probability: 0.9 },
    },
  });
  const result = await analyze(technicalRequest, { classify });
  assert.equal(result.reported.model, 'typesafe/jev-test');
});

test('result does not claim classifier inference is deterministic', async () => {
  const result = await analyze(technicalRequest, { offline: technicalVerdict });
  assert.equal(result.inferenceDeterministic, false);
});

test('result leaves billed cost unknown', async () => {
  const result = await analyze(technicalRequest, { offline: technicalVerdict });
  assert.equal(result.billedCostUsd, null);
});

test('result includes classifier usage when reported', async () => {
  const classify = async () => ({
    answers: {
      classification: { type: 'choice', choice: 'technical', confidence: 0.9 },
      evidence_grounding: { type: 'bool', probability: 0.9 },
      evidence_E1: { type: 'bool', probability: 0.9 },
    },
    usage: { input: 42, output: 7, totalTokens: 49, cost: { total: 0.001 } },
  });
  const result = await analyze(technicalRequest, { classify });
  assert.equal(result.usage?.input, 42);
});

test('a classifier that exceeds the timeout yields an uncertain result', async () => {
  const classify = () => new Promise<never>(() => {});
  const result = await analyze(technicalRequest, { classify, timeoutMs: 25 });
  assert.equal(result.classification, 'uncertain');
});

test('classification question is a closed choice', () => {
  const questions = buildQuestions(technicalRequest);
  assert.equal(questions.classification.type, 'choice');
});

test('evidence grounding question is a boolean', () => {
  const questions = buildQuestions(technicalRequest);
  assert.equal(questions.evidence_grounding.type, 'bool');
});

test('hashInput ignores object key order', () => {
  assert.equal(hashInput({ a: 1, b: 2 }), hashInput({ b: 2, a: 1 }));
});

test('validateRequest rejects evidence entries without an id', () => {
  assert.throws(() => validateRequest({ evidence: [{ text: 'no id' }], desiredImprovement: 'x' }));
});

test('catalog cites both TRIZ contradiction and principle references', () => {
  assert.deepEqual(CATALOG.citations, ['https://triz.org/contradictions/', 'https://triz.org/principles/']);
});

test('catalog is not a canonical classical matrix lookup', () => {
  assert.equal(CATALOG.canonicalMatrixLookup, false);
});

test('validateCatalog accepts the curated catalog', () => {
  assert.equal(validateCatalog(CATALOG).ok, true);
});

test('validateCatalog rejects a catalog with an empty version', () => {
  assert.equal(validateCatalog({ ...CATALOG, version: '' }).ok, false);
});

test('writeResultAtomic leaves no temporary files behind', async () => {
  const dir = tempDir();
  const out = join(dir, 'result.json');
  await analyze(technicalRequest, { offline: technicalVerdict, out });
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp')), []);
  rmSync(dir, { recursive: true, force: true });
});

test('inspectResult rejects a result with an unsupported schema version', () => {
  const dir = tempDir();
  const out = join(dir, 'result.json');
  writeFileSync(out, JSON.stringify({ schemaVersion: 2, classification: 'technical' }));
  assert.throws(() => inspectResult(out));
  rmSync(dir, { recursive: true, force: true });
});

test('CLI analyze writes a result that a fresh process can inspect', () => {
  const dir = tempDir();
  const requestPath = join(dir, 'request.json');
  const fixturePath = join(dir, 'response.json');
  const outPath = join(dir, 'result.json');
  writeFileSync(requestPath, JSON.stringify(technicalRequest));
  writeFileSync(fixturePath, JSON.stringify(technicalVerdict));

  spawnSync(process.execPath, [trizPath, 'analyze', requestPath, '--offline', fixturePath, '--out', outPath], {
    encoding: 'utf8',
  });
  const inspected = spawnSync(process.execPath, [trizPath, 'inspect', outPath], { encoding: 'utf8' });
  assert.equal(JSON.parse(inspected.stdout).classification, 'technical');
  rmSync(dir, { recursive: true, force: true });
});
