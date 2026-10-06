import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
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

function runTriz(args: string[]) {
  return spawnSync(process.execPath, [trizPath, ...args], { encoding: 'utf8' });
}

function analyzeFixture(dir: string): { requestPath: string; fixturePath: string } {
  const requestPath = join(dir, 'request.json');
  const fixturePath = join(dir, 'response.json');
  writeFileSync(requestPath, JSON.stringify(technicalRequest));
  writeFileSync(fixturePath, JSON.stringify(technicalVerdict));
  return { requestPath, fixturePath };
}

function resultFixture(dir: string): string {
  const resultPath = join(dir, 'result.json');
  writeFileSync(
    resultPath,
    JSON.stringify({ schemaVersion: 1, classification: 'technical', catalogVersion: 'triz-software-2' }),
  );
  return resultPath;
}

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

test('technical results recommend the complete forty-principle catalog in order', async () => {
  const result = await analyze(technicalRequest, { offline: technicalVerdict });
  assert.deepEqual(
    result.principles.map((p) => p.id),
    Array.from({ length: 40 }, (_, i) => String(i + 1)),
  );
});

test('physical results recommend the six resolution routes in order', async () => {
  const result = await analyze(physicalRequest, { offline: physicalVerdict });
  assert.deepEqual(result.principles.map((p) => p.id), [
    'space-separation',
    'time-separation',
    'condition-separation',
    'system-level-separation',
    'satisfy-both-demands',
    'bypass-contradiction',
  ]);
});

test('none results carry no principle recommendations', async () => {
  const result = await analyze(noneRequest, { offline: noneVerdict });
  assert.deepEqual(result.principles, []);
});

test('insufficient results carry no principle recommendations', async () => {
  const result = await analyze(insufficientRequest, { offline: insufficientVerdict });
  assert.deepEqual(result.principles, []);
});

test('uncertain results carry no principle recommendations', async () => {
  const result = await analyze(technicalRequest, {
    offline: { classification: 'bogus', confidence: 0.9, evidenceIds: ['E1'], grounding: true },
  });
  assert.deepEqual(result.principles, []);
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

function classifierWithUsage(usage: unknown) {
  return async () => ({
    answers: {
      classification: { type: 'choice', choice: 'technical', confidence: 0.9 },
      evidence_grounding: { type: 'bool', probability: 0.9 },
      evidence_E1: { type: 'bool', probability: 0.9 },
    },
    usage,
  });
}

test('analyze reports cache-read tokens when the classifier provides them', async () => {
  const result = await analyze(technicalRequest, {
    classify: classifierWithUsage({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20, totalTokens: 135 }),
  });
  assert.equal(result.usage?.cacheRead, 100);
});

test('analyze reports cache-write tokens when the classifier provides them', async () => {
  const result = await analyze(technicalRequest, {
    classify: classifierWithUsage({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20, totalTokens: 135 }),
  });
  assert.equal(result.usage?.cacheWrite, 20);
});

test('analyze reports total tokens when the classifier provides them', async () => {
  const result = await analyze(technicalRequest, {
    classify: classifierWithUsage({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20, totalTokens: 135 }),
  });
  assert.equal(result.usage?.totalTokens, 135);
});

test('analyze marks reported usage as available', async () => {
  const result = await analyze(technicalRequest, { classify: classifierWithUsage({ input: 10 }) });
  assert.equal(result.usage?.available, true);
});

test('analyze leaves usage null when the classifier reports no usage', async () => {
  const result = await analyze(technicalRequest, { classify: classifierWithUsage(undefined) });
  assert.equal(result.usage, null);
});

test('analyze labels a finite Pi-reported cost with source pi_reported', async () => {
  const result = await analyze(technicalRequest, {
    classify: classifierWithUsage({ input: 10, cost: { total: 0.002 } }),
  });
  assert.equal(result.usage?.piReported.source, 'pi_reported');
});

test('analyze exposes a finite Pi-reported cost amount', async () => {
  const result = await analyze(technicalRequest, {
    classify: classifierWithUsage({ input: 10, cost: { total: 0.002 } }),
  });
  assert.equal(result.usage?.piReported.amountUsd, 0.002);
});

test('analyze marks a finite Pi-reported cost as available', async () => {
  const result = await analyze(technicalRequest, {
    classify: classifierWithUsage({ input: 10, cost: { total: 0.002 } }),
  });
  assert.equal(result.usage?.piReported.available, true);
});

test('analyze preserves the legacy costUsd field for a finite Pi cost', async () => {
  const result = await analyze(technicalRequest, {
    classify: classifierWithUsage({ input: 10, cost: { total: 0.002 } }),
  });
  assert.equal(result.usage?.costUsd, 0.002);
});

test('analyze leaves costUsd null when the classifier reports no cost', async () => {
  const result = await analyze(technicalRequest, { classify: classifierWithUsage({ input: 10 }) });
  assert.equal(result.usage?.costUsd, null);
});

test('analyze marks an empty Pi cost object as unavailable rather than free', async () => {
  const result = await analyze(technicalRequest, {
    classify: classifierWithUsage({ input: 10, cost: {} }),
  });
  assert.equal(result.usage?.piReported.available, false);
});

test('analyze preserves a valid zero Pi cost as a reported zero', async () => {
  const result = await analyze(technicalRequest, {
    classify: classifierWithUsage({ input: 10, cost: { total: 0 } }),
  });
  assert.equal(result.usage?.costUsd, 0);
});

test('analyze does not promote a Pi-reported cost to billedCostUsd', async () => {
  const result = await analyze(technicalRequest, {
    classify: classifierWithUsage({ input: 10, cost: { total: 0.002 } }),
  });
  assert.equal(result.billedCostUsd, null);
});

test('analyze notes explain that a Pi-reported cost is not a bill', async () => {
  const result = await analyze(technicalRequest, { classify: classifierWithUsage({ input: 10 }) });
  assert.equal(result.notes.some((n) => /pi_reported/i.test(n) && /not a bill/i.test(n)), true);
});

test('inspectResult retains the legacy usage cost field of a saved schema 1 result', () => {
  const dir = tempDir();
  const out = join(dir, 'result.json');
  writeFileSync(
    out,
    JSON.stringify({
      schemaVersion: 1,
      classification: 'technical',
      catalogVersion: 'triz-software-1',
      usage: { input: 1, output: 2, totalTokens: 3, costUsd: 0.001 },
    }),
  );
  assert.equal(inspectResult(out).usage?.costUsd, 0.001);
  rmSync(dir, { recursive: true, force: true });
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

test('validateRequest rejects an unknown top-level request key by name', () => {
  assert.throws(
    () => validateRequest({ ...technicalRequest, desiredImprovment: 'typo' }),
    /desiredImprovment/,
  );
});

test('validateRequest rejects an unknown evidence-item key by name', () => {
  assert.throws(
    () => validateRequest({ ...technicalRequest, evidence: [{ id: 'E1', text: 'x', txt: 'typo' }] }),
    /txt/,
  );
});

test('validateRequest keeps supporting worseningOutcome', () => {
  assert.equal(validateRequest(technicalRequest).worseningOutcome, 'Data freshness');
});

test('validateRequest keeps supporting element', () => {
  assert.equal(validateRequest(physicalRequest).element, 'response cache');
});

test('validateRequest keeps supporting opposingProperties', () => {
  assert.deepEqual(validateRequest(physicalRequest).opposingProperties, ['large for hit rate', 'small for memory']);
});

test('validateRequest accepts a request with only the required fields', () => {
  assert.doesNotThrow(() => validateRequest(noneRequest));
});

test('analyze skips the classifier for a request with an unknown key', async () => {
  let called = false;
  await analyze(
    { ...technicalRequest, ignoredTypo: true },
    {
      classify: async () => {
        called = true;
        return {};
      },
    },
  ).catch(() => {});
  assert.equal(called, false);
});

test('analyze with an unknown request key writes no output file', async () => {
  const dir = tempDir();
  const out = join(dir, 'result.json');
  await analyze({ ...technicalRequest, ignoredTypo: true }, { offline: technicalVerdict, out }).catch(() => {});
  assert.equal(existsSync(out), false);
  rmSync(dir, { recursive: true, force: true });
});

test('inspectResult tolerates unknown historical metadata on a saved schema 1 result', () => {
  const dir = tempDir();
  const out = join(dir, 'result.json');
  writeFileSync(
    out,
    JSON.stringify({ schemaVersion: 1, classification: 'technical', historicalNote: 'kept', legacyMeta: { v: 0 } }),
  );
  assert.equal(inspectResult(out).classification, 'technical');
  rmSync(dir, { recursive: true, force: true });
});

test('catalog cites the seven specified sources', () => {
  assert.deepEqual(CATALOG.citations, [
    'https://triz.org/contradictions/',
    'https://triz.org/principles/',
    'https://matriz.org/methodology/',
    'https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/contradictions/',
    'https://wiki.matriz.org/docs/triz/problem-solving-tools-5890/contradictions/engineering-contradiction-5995/contradiction-matrix-6026/',
    'https://matriz.org/wp-content/uploads/2020/04/Selected-Topics-for-Level-1-Training.pdf',
    'https://doi.org/10.1016/j.proeng.2015.12.413',
  ]);
});

test('catalog version is triz-software-2', () => {
  assert.equal(CATALOG.version, 'triz-software-2');
});

test('catalog lists all forty principles numbered 1 through 40', () => {
  assert.deepEqual(
    CATALOG.technical.map((p) => p.id),
    Array.from({ length: 40 }, (_, i) => String(i + 1)),
  );
});

test('catalog technical principles are sourced from the TRIZ principles reference', () => {
  assert.equal(CATALOG.technical.every((p) => p.source === 'https://triz.org/principles/'), true);
});

test('catalog lists the six physical routes in the specified order', () => {
  assert.deepEqual(CATALOG.physical.map((p) => p.id), [
    'space-separation',
    'time-separation',
    'condition-separation',
    'system-level-separation',
    'satisfy-both-demands',
    'bypass-contradiction',
  ]);
});

test('catalog physical routes are sourced from the MATRIZ physical reference', () => {
  assert.equal(
    CATALOG.physical.every(
      (p) => p.source === 'https://matriz.org/wp-content/uploads/2020/04/Selected-Topics-for-Level-1-Training.pdf',
    ),
    true,
  );
});

test('catalog preserves the condition-separation id while using modern relation wording', () => {
  const route = CATALOG.physical.find((p) => p.id === 'condition-separation');
  assert.equal(route?.name, 'separation in relation (condition/context)');
});

test('catalog is not a canonical classical matrix lookup', () => {
  assert.equal(CATALOG.canonicalMatrixLookup, false);
});

test('catalog does not claim a complete classical matrix', () => {
  assert.equal(CATALOG.completeClassicalMatrix, false);
});

test('catalog disclaimer scopes itself to a contradiction-resolution catalog', () => {
  assert.equal(
    CATALOG.disclaimer.includes('Complete software-adapted TRIZ contradiction-resolution heuristic catalog'),
    true,
  );
});

test('validateCatalog accepts the curated catalog', () => {
  assert.equal(validateCatalog(CATALOG).ok, true);
});

test('validateCatalog rejects a catalog with an empty version', () => {
  assert.equal(validateCatalog({ ...CATALOG, version: '' }).ok, false);
});

test('validateCatalog rejects a catalog missing a principle id', () => {
  assert.equal(validateCatalog({ ...CATALOG, technical: CATALOG.technical.slice(0, 39) }).ok, false);
});

test('validateCatalog rejects a catalog with a duplicate principle id', () => {
  const technical = [...CATALOG.technical.slice(0, 39), { ...CATALOG.technical[0] }];
  assert.equal(validateCatalog({ ...CATALOG, technical }).ok, false);
});

test('validateCatalog rejects a catalog with an out-of-range principle id', () => {
  const technical = [...CATALOG.technical.slice(0, 39), { ...CATALOG.technical[0], id: '41' }];
  assert.equal(validateCatalog({ ...CATALOG, technical }).ok, false);
});

test('validateCatalog rejects a catalog with a wrong route id', () => {
  const physical = CATALOG.physical.map((p) => (p.id === 'system-level-separation' ? { ...p, id: 'bogus' } : p));
  assert.equal(validateCatalog({ ...CATALOG, physical }).ok, false);
});

test('validateCatalog rejects a catalog with routes in the wrong order', () => {
  const physical = [...CATALOG.physical];
  [physical[0], physical[1]] = [physical[1], physical[0]];
  assert.equal(validateCatalog({ ...CATALOG, physical }).ok, false);
});

test('validateCatalog rejects a catalog with a duplicate route id', () => {
  const physical = [CATALOG.physical[0], ...CATALOG.physical.slice(0, 5)];
  assert.equal(validateCatalog({ ...CATALOG, physical }).ok, false);
});

test('validateCatalog rejects a catalog with a blank principle name', () => {
  const technical = CATALOG.technical.map((p) => (p.id === '1' ? { ...p, name: '' } : p));
  assert.equal(validateCatalog({ ...CATALOG, technical }).ok, false);
});

test('validateCatalog rejects a catalog with a blank heuristic', () => {
  const technical = CATALOG.technical.map((p) => (p.id === '1' ? { ...p, heuristic: '   ' } : p));
  assert.equal(validateCatalog({ ...CATALOG, technical }).ok, false);
});

test('validateCatalog rejects a catalog with a source missing from the citations', () => {
  const technical = CATALOG.technical.map((p) => (p.id === '1' ? { ...p, source: 'https://example.com/uncited' } : p));
  assert.equal(validateCatalog({ ...CATALOG, technical }).ok, false);
});

test('validateCatalog rejects a catalog that claims a canonical matrix lookup', () => {
  assert.equal(validateCatalog({ ...CATALOG, canonicalMatrixLookup: true }).ok, false);
});

test('validateCatalog rejects a catalog that claims a complete classical matrix', () => {
  assert.equal(validateCatalog({ ...CATALOG, completeClassicalMatrix: true }).ok, false);
});

test('inspectResult retains the historical catalog version of a saved schema 1 result', () => {
  const dir = tempDir();
  const out = join(dir, 'result.json');
  writeFileSync(
    out,
    JSON.stringify({ schemaVersion: 1, classification: 'technical', catalogVersion: 'triz-software-1' }),
  );
  assert.equal(inspectResult(out).catalogVersion, 'triz-software-1');
  rmSync(dir, { recursive: true, force: true });
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

// --- CLI help ---------------------------------------------------------------

test('top-level --help exits zero', () => {
  assert.equal(runTriz(['--help']).status, 0);
});

test('top-level --help prints top-level usage to stdout', () => {
  assert.match(runTriz(['--help']).stdout, /Usage: triz/);
});

test('top-level -h exits zero', () => {
  assert.equal(runTriz(['-h']).status, 0);
});

test('analyze --help exits zero', () => {
  assert.equal(runTriz(['analyze', '--help']).status, 0);
});

test('analyze --help prints analyze usage to stdout', () => {
  assert.match(runTriz(['analyze', '--help']).stdout, /Usage: triz analyze/);
});

test('analyze -h exits zero', () => {
  assert.equal(runTriz(['analyze', '-h']).status, 0);
});

test('inspect --help exits zero', () => {
  assert.equal(runTriz(['inspect', '--help']).status, 0);
});

test('inspect --help prints inspect usage to stdout', () => {
  assert.match(runTriz(['inspect', '--help']).stdout, /Usage: triz inspect/);
});

test('catalog --help exits zero', () => {
  assert.equal(runTriz(['catalog', '--help']).status, 0);
});

test('catalog -h prints catalog usage to stdout', () => {
  assert.match(runTriz(['catalog', '-h']).stdout, /Usage: triz catalog/);
});

// --- CLI argument validation ------------------------------------------------

test('top-level command rejects an unknown option', () => {
  assert.notEqual(runTriz(['--bogus']).status, 0);
});

test('analyze rejects an unknown short flag', () => {
  const dir = tempDir();
  const { requestPath, fixturePath } = analyzeFixture(dir);
  assert.notEqual(runTriz(['analyze', requestPath, '--offline', fixturePath, '-x']).status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('inspect rejects an unknown option', () => {
  const dir = tempDir();
  const resultPath = resultFixture(dir);
  assert.notEqual(runTriz(['inspect', resultPath, '--bogus']).status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('catalog rejects an unknown option', () => {
  assert.notEqual(runTriz(['catalog', '--bogus']).status, 0);
});

test('analyze rejects a non-numeric timeout value', () => {
  const dir = tempDir();
  const { requestPath, fixturePath } = analyzeFixture(dir);
  assert.notEqual(runTriz(['analyze', requestPath, '--offline', fixturePath, '--timeout-ms', 'soon']).status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('analyze rejects an excess positional argument', () => {
  const dir = tempDir();
  const { requestPath, fixturePath } = analyzeFixture(dir);
  assert.notEqual(runTriz(['analyze', requestPath, '--offline', fixturePath, 'extra']).status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('inspect rejects an excess positional argument', () => {
  const dir = tempDir();
  const resultPath = resultFixture(dir);
  assert.notEqual(runTriz(['inspect', resultPath, 'extra']).status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('catalog rejects an excess positional argument', () => {
  assert.notEqual(runTriz(['catalog', 'extra']).status, 0);
});

test('analyze with an unknown option writes no output file', () => {
  const dir = tempDir();
  const { requestPath, fixturePath } = analyzeFixture(dir);
  const outPath = join(dir, 'result.json');
  runTriz(['analyze', requestPath, '--offline', fixturePath, '--out', outPath, '--bogus']);
  assert.equal(existsSync(outPath), false);
  rmSync(dir, { recursive: true, force: true });
});

test('analyze with a missing option value writes no output file', () => {
  const dir = tempDir();
  const { requestPath, fixturePath } = analyzeFixture(dir);
  const outPath = join(dir, 'result.json');
  runTriz(['analyze', requestPath, '--offline', fixturePath, '--out', outPath, '--provider']);
  assert.equal(existsSync(outPath), false);
  rmSync(dir, { recursive: true, force: true });
});

// --- CLI existing options ---------------------------------------------------

test('analyze accepts provider and model overrides', () => {
  const dir = tempDir();
  const { requestPath, fixturePath } = analyzeFixture(dir);
  const outPath = join(dir, 'result.json');
  runTriz(['analyze', requestPath, '--offline', fixturePath, '--out', outPath, '--provider', 'openrouter', '--model', '~typesafe/jev-custom']);
  assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).requested.model, '~typesafe/jev-custom');
  rmSync(dir, { recursive: true, force: true });
});

test('analyze accepts a numeric timeout option', () => {
  const dir = tempDir();
  const { requestPath, fixturePath } = analyzeFixture(dir);
  const outPath = join(dir, 'result.json');
  runTriz(['analyze', requestPath, '--offline', fixturePath, '--out', outPath, '--timeout-ms', '1000']);
  assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).classification, 'technical');
  rmSync(dir, { recursive: true, force: true });
});
