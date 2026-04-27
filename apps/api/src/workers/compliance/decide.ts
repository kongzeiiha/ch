import type { BlacklistHit } from './blacklist.js';
import type { RiskScores } from './score.js';

export type ComplianceStatus = 'COMPLIANCE_PASS' | 'COMPLIANCE_REVIEW' | 'COMPLIANCE_FAIL';

export interface Decision {
  status: ComplianceStatus;
  risk_tags: string[];
  trigger: 'blacklist' | 'llm_reject' | 'llm_review' | 'pass';
  maxScore: number;
}

/**
 * Final verdict. Blacklist always wins — no LLM call can override.
 * LLM score >= 3 is auto-reject, >= 2 is review queue.
 */
export function decide(blacklistHits: BlacklistHit[], risk?: RiskScores): Decision {
  if (blacklistHits.length > 0) {
    return {
      status: 'COMPLIANCE_FAIL',
      risk_tags: [...new Set(blacklistHits.map((h) => h.category))],
      trigger: 'blacklist',
      maxScore: -1,
    };
  }

  if (!risk) {
    // L2 skipped or failed; conservative default: send to review.
    return {
      status: 'COMPLIANCE_REVIEW',
      risk_tags: ['llm_unavailable'],
      trigger: 'llm_review',
      maxScore: -1,
    };
  }

  const values = Object.values(risk.scores);
  const maxScore = values.length ? Math.max(...values) : 0;
  const flagged = Object.entries(risk.scores)
    .filter(([, v]) => v >= 2)
    .map(([k]) => k);

  if (maxScore >= 3) {
    return { status: 'COMPLIANCE_FAIL', risk_tags: flagged, trigger: 'llm_reject', maxScore };
  }
  if (maxScore >= 2) {
    return { status: 'COMPLIANCE_REVIEW', risk_tags: flagged, trigger: 'llm_review', maxScore };
  }
  return { status: 'COMPLIANCE_PASS', risk_tags: [], trigger: 'pass', maxScore };
}
