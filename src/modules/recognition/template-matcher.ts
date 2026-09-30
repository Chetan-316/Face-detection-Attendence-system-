import { CachedTemplate, CandidateScore, MatchResult, MatcherThresholds } from './recognition.types';
import { config } from '../../config';

export class TemplateMatcher {
  private thresholds: MatcherThresholds;

  constructor(customThresholds?: Partial<MatcherThresholds>) {
    this.thresholds = {
      matchThreshold: customThresholds?.matchThreshold ?? config.recognition.matchThreshold,
      uncertainThreshold: customThresholds?.uncertainThreshold ?? config.recognition.uncertainThreshold,
      minMargin: customThresholds?.minMargin ?? config.recognition.minMargin,
    };

    if (this.thresholds.matchThreshold <= this.thresholds.uncertainThreshold) {
      throw new Error(
        `Invalid threshold configuration: matchThreshold (${this.thresholds.matchThreshold}) must be strictly greater than uncertainThreshold (${this.thresholds.uncertainThreshold})`
      );
    }
  }

  public getThresholds(): MatcherThresholds {
    return { ...this.thresholds };
  }

  /**
   * Validates vector integrity: exactly 128 dimensions, finite numbers, non-zero norm.
   */
  public static isValidVector(vector: number[] | null | undefined): boolean {
    if (!vector || !Array.isArray(vector) || vector.length !== 128) {
      return false;
    }

    let sumSq = 0;
    for (let i = 0; i < vector.length; i++) {
      const val = vector[i];
      if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
        return false;
      }
      sumSq += val * val;
    }

    // Must not be all zeros
    return sumSq > 1e-6;
  }

  /**
   * L2 normalizes a 128-dimensional vector
   */
  public static normalizeVector(vector: number[]): number[] {
    let sumSq = 0;
    for (let i = 0; i < vector.length; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm < 1e-6) {
      return vector.slice();
    }
    return vector.map((v) => v / norm);
  }

  /**
   * Computes cosine similarity between two normalized 128-d vectors (dot product).
   */
  public static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
    }
    // Clamp to [-1, 1] to guard against tiny float precision errors
    return Math.max(-1, Math.min(1, dot));
  }

  /**
   * Classifies a query embedding against the cached eligible templates.
   * Enforces 3-state classification: MATCH, UNCERTAIN, or UNKNOWN.
   */
  public match(queryEmbedding: number[] | null | undefined, candidates: CachedTemplate[]): MatchResult {
    if (!TemplateMatcher.isValidVector(queryEmbedding)) {
      return {
        classification: 'UNKNOWN',
        similarity: 0,
        secondBestSimilarity: 0,
      };
    }

    const normQuery = TemplateMatcher.normalizeVector(queryEmbedding!);

    // Filter to only candidates with valid vectors
    const validCandidates: CandidateScore[] = [];
    for (const cand of candidates) {
      if (TemplateMatcher.isValidVector(cand.template)) {
        const normTpl = TemplateMatcher.normalizeVector(cand.template);
        const sim = TemplateMatcher.cosineSimilarity(normQuery, normTpl);
        validCandidates.push({
          candidate: cand,
          similarity: sim,
        });
      }
    }

    if (validCandidates.length === 0) {
      return {
        classification: 'UNKNOWN',
        similarity: 0,
        secondBestSimilarity: 0,
      };
    }

    // Sort descending by similarity
    validCandidates.sort((a, b) => b.similarity - a.similarity);

    const best = validCandidates[0];
    const second = validCandidates.length > 1 ? validCandidates[1] : null;

    const bestSimilarity = Math.round(best.similarity * 1000) / 1000;
    const secondBestSimilarity = second ? Math.round(second.similarity * 1000) / 1000 : 0;
    const margin = Math.round((bestSimilarity - secondBestSimilarity) * 1000) / 1000;

    // Check thresholds:
    // 1. MATCH: best >= matchThreshold AND margin >= minMargin
    if (bestSimilarity >= this.thresholds.matchThreshold && margin >= this.thresholds.minMargin) {
      return {
        classification: 'MATCH',
        resident: {
          id: best.candidate.residentId,
          residentCode: best.candidate.residentCode,
          fullName: best.candidate.fullName,
        },
        similarity: bestSimilarity,
        secondBestSimilarity,
        bestCandidate: best.candidate,
        secondCandidate: second?.candidate,
      };
    }

    // 2. UNCERTAIN: best >= uncertainThreshold (either because best is in uncertain band, OR separation margin is too small)
    if (bestSimilarity >= this.thresholds.uncertainThreshold) {
      return {
        classification: 'UNCERTAIN',
        // CRITICAL PRIVACY RULE: NEVER EXPOSE RESIDENT IDENTITY FOR UNCERTAIN MATCHES
        resident: undefined,
        similarity: bestSimilarity,
        secondBestSimilarity,
        bestCandidate: best.candidate,
        secondCandidate: second?.candidate,
      };
    }

    // 3. UNKNOWN: best < uncertainThreshold
    return {
      classification: 'UNKNOWN',
      resident: undefined,
      similarity: bestSimilarity,
      secondBestSimilarity,
      bestCandidate: best.candidate,
      secondCandidate: second?.candidate,
    };
  }
}
