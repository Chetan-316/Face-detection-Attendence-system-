import { describe, it, expect } from 'vitest';
import { TemplateMatcher } from '../src/modules/recognition/template-matcher';
import { CachedTemplate } from '../src/modules/recognition/recognition.types';

function createBlockVector(startIndex: number, endIndex: number): number[] {
  const v = new Array(128).fill(0);
  for (let i = startIndex; i < endIndex; i++) {
    v[i] = 1;
  }
  return TemplateMatcher.normalizeVector(v);
}

describe('TemplateMatcher Unit Tests', () => {
  const matcher = new TemplateMatcher({
    matchThreshold: 0.60,
    uncertainThreshold: 0.40,
    minMargin: 0.08,
  });

  const resident1Vector = createBlockVector(0, 50);
  const resident2Vector = createBlockVector(50, 90);
  const orthogonalVector = createBlockVector(90, 128);

  const candidates: CachedTemplate[] = [
    {
      residentId: 'res-1',
      residentCode: 'R001',
      fullName: 'Rahul Patil',
      hostelId: 'hostel-1',
      organizationId: 'org-1',
      template: resident1Vector,
      modelName: 'SFace',
      modelVersion: '2021dec',
      templateVersion: '1.0.0',
      enrolledAt: new Date(),
    },
    {
      residentId: 'res-2',
      residentCode: 'R002',
      fullName: 'Amit Kumar',
      hostelId: 'hostel-1',
      organizationId: 'org-1',
      template: resident2Vector,
      modelName: 'SFace',
      modelVersion: '2021dec',
      templateVersion: '1.0.0',
      enrolledAt: new Date(),
    },
  ];

  it('classifies as MATCH when similarity >= matchThreshold and separation margin >= minMargin', () => {
    // Query very close to resident 1
    const query = resident1Vector.slice();
    const result = matcher.match(query, candidates);

    expect(result.classification).toBe('MATCH');
    expect(result.resident).toBeDefined();
    expect(result.resident?.residentCode).toBe('R001');
    expect(result.resident?.fullName).toBe('Rahul Patil');
    expect(result.similarity).toBeGreaterThanOrEqual(0.60);
    expect(result.similarity - result.secondBestSimilarity).toBeGreaterThanOrEqual(0.08);
  });

  it('classifies as UNCERTAIN when similarity is between uncertainThreshold and matchThreshold', () => {
    // Generate a vector that has moderate similarity (~0.45 - 0.55) to resident 1
    // By blending resident1 with orthogonal vector: 0.5 * resident1 + 0.866 * orthogonal
    const blend = resident1Vector.map((v, i) => v * 0.5 + orthogonalVector[i] * 0.866);
    const query = TemplateMatcher.normalizeVector(blend);

    const result = matcher.match(query, candidates);

    expect(result.similarity).toBeGreaterThanOrEqual(0.40);
    expect(result.similarity).toBeLessThan(0.60);
    expect(result.classification).toBe('UNCERTAIN');
    // CRITICAL PRIVACY RULE: candidate identity must NOT be revealed in result.resident!
    expect(result.resident).toBeUndefined();
  });

  it('classifies as UNCERTAIN when similarity >= matchThreshold but candidate separation margin < minMargin', () => {
    // Create two nearly identical candidate templates
    const lookalikeCandidates: CachedTemplate[] = [
      {
        residentId: 'res-twin-1',
        residentCode: 'R010',
        fullName: 'Twin One',
        hostelId: 'hostel-1',
        organizationId: 'org-1',
        template: resident1Vector,
        modelName: 'SFace',
        modelVersion: '2021dec',
        templateVersion: '1.0.0',
        enrolledAt: new Date(),
      },
      {
        residentId: 'res-twin-2',
        residentCode: 'R011',
        fullName: 'Twin Two',
        hostelId: 'hostel-1',
        organizationId: 'org-1',
        // Slight perturbation giving margin ~ 0.02
        template: TemplateMatcher.normalizeVector(resident1Vector.map((v, i) => v * 0.98 + orthogonalVector[i] * 0.2)),
        modelName: 'SFace',
        modelVersion: '2021dec',
        templateVersion: '1.0.0',
        enrolledAt: new Date(),
      },
    ];

    const result = matcher.match(resident1Vector, lookalikeCandidates);
    expect(result.similarity).toBeGreaterThanOrEqual(0.60);
    const margin = result.similarity - result.secondBestSimilarity;
    expect(margin).toBeLessThan(0.08);

    // Margin is too small, must become UNCERTAIN to protect against look-alikes
    expect(result.classification).toBe('UNCERTAIN');
    expect(result.resident).toBeUndefined();
  });

  it('classifies as UNKNOWN when best candidate similarity is below uncertainThreshold', () => {
    // Orthogonal vector far from all candidates
    const query = orthogonalVector.slice();
    const result = matcher.match(query, candidates);

    expect(result.classification).toBe('UNKNOWN');
    expect(result.resident).toBeUndefined();
  });

  it('classifies as UNKNOWN when candidate list is empty', () => {
    const result = matcher.match(resident1Vector, []);
    expect(result.classification).toBe('UNKNOWN');
    expect(result.resident).toBeUndefined();
    expect(result.similarity).toBe(0);
    expect(result.secondBestSimilarity).toBe(0);
  });

  it('safely excludes corrupted or invalid candidate vectors (NaN, wrong dimension, all zeros)', () => {
    const corruptCandidates: CachedTemplate[] = [
      {
        residentId: 'res-bad-1',
        residentCode: 'BAD1',
        fullName: 'NaN Vector',
        hostelId: 'hostel-1',
        organizationId: 'org-1',
        template: [NaN, ...new Array(127).fill(0.1)],
        modelName: 'SFace',
        modelVersion: '2021dec',
        templateVersion: '1.0.0',
        enrolledAt: new Date(),
      },
      {
        residentId: 'res-bad-2',
        residentCode: 'BAD2',
        fullName: 'Short Vector',
        hostelId: 'hostel-1',
        organizationId: 'org-1',
        template: [0.1, 0.2, 0.3], // length 3 instead of 128
        modelName: 'SFace',
        modelVersion: '2021dec',
        templateVersion: '1.0.0',
        enrolledAt: new Date(),
      },
      {
        residentId: 'res-bad-3',
        residentCode: 'BAD3',
        fullName: 'Zero Vector',
        hostelId: 'hostel-1',
        organizationId: 'org-1',
        template: new Array(128).fill(0),
        modelName: 'SFace',
        modelVersion: '2021dec',
        templateVersion: '1.0.0',
        enrolledAt: new Date(),
      },
    ];

    const result = matcher.match(resident1Vector, corruptCandidates);
    expect(result.classification).toBe('UNKNOWN');
    expect(result.resident).toBeUndefined();
  });

  it('validates the 512-D AdaFace migration contract without accepting it as legacy 128-D', () => {
    const adafaceVector = TemplateMatcher.normalizeVector(new Array(512).fill(0.01));

    expect(TemplateMatcher.isValidVector(adafaceVector, 512)).toBe(true);
    expect(TemplateMatcher.isValidVector(adafaceVector, 128)).toBe(false);
    expect(TemplateMatcher.isValidVector(new Array(128).fill(0.01), 512)).toBe(false);
  });

  it('validates threshold constructor order (matchThreshold must be > uncertainThreshold)', () => {
    expect(() => {
      new TemplateMatcher({ matchThreshold: 0.4, uncertainThreshold: 0.6 });
    }).toThrow(/strictly greater/i);
  });
});
