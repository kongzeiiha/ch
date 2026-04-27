export interface SourceRow {
  id: string;
  platform: string;
  external_id: string;
  name: string;
  url: string | null;
  config: Record<string, any>;
}

export interface RawCandidate {
  url: string;
  externalId: string;
  title?: string;
  publishedAt?: Date;
  html?: string;
  text?: string;
  mediaUrls?: string[];
  /** When true, ingestion main loop will skip the simhash (content) dedup
   * step. URL-level dedup still applies. Used for per-image extraction where
   * many images share near-identical captions. */
  skipSimhash?: boolean;
  extra?: Record<string, any>;
}

export interface SourceAdapter {
  platform: string;
  fetch(source: SourceRow): Promise<RawCandidate[]>;
}

/**
 * Thrown by an adapter when the upstream rejects our credentials (expired
 * cookie / token / cf_clearance / 401/403/503 anti-bot). The ingestion worker
 * catches this, marks the run with authFail=true, and the workbench surfaces
 * a banner so the user knows to refresh credentials.
 */
export class AdapterAuthError extends Error {
  constructor(public status: number, public reason: string) {
    super(`auth failed: http=${status} ${reason}`);
    this.name = 'AdapterAuthError';
  }
}
