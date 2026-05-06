// ─── Shared types ────────────────────────────────────────────────────────────

export interface AgentMeta {
  auto: boolean;
  paused: boolean;
}

export interface PipelineState {
  globalStop: boolean;
  agents: Record<string, AgentMeta>;
  pendingMap: Record<string, number>;
  reviewQueueSize: number;
  publishQueueSize: number;
}

export interface ReviewItem {
  id: string; title: string; category: string | null; slug: string | null;
  compliance_status: string | null; risk_tags: string[]; compliance_reasons: unknown;
  cover_url: string | null; summary: string | null; source: string; url: string;
}

export interface PublishItem {
  id: string; title: string; category: string | null; slug: string | null;
  cover_url: string | null; cover_sizes: unknown; summary: string | null; source: string;
}

export interface DistTask {
  item_id: string; title: string; slug: string | null;
  task_id: string; channel: string; copy: string; status: string; created_at: string;
}

export interface AgentRunRow {
  agent: string; total: number; success: number; failed: number;
  avg_latency_ms: number; total_cost_usd: number;
}

export interface QueueStat {
  name: string;
  counts: { waiting: number; active: number; delayed: number; completed: number; failed: number };
}

export interface ItemHistory {
  item: Record<string, unknown>;
  runs: Array<{ id: string; agent: string; status: string; latency_ms: number | null; cost_usd: number | null; error: string | null; output: unknown; started_at: string; finished_at: string | null }>;
}

export interface LiveJobs {
  active: Record<string, Array<{ itemId: string | null; label: string; since: string | null }>>;
  recent: Record<string, Array<{ agent: string; item_id: string | null; title: string | null; finished_at: string; latency_ms: number | null; status: string }>>;
}

export interface Source {
  id: string;
  platform: string;
  external_id: string;
  name: string;
  url: string;
  status: string;
  score: number | null;
  last_fetch_at: string | null;
  config: Record<string, unknown>;
  credential_id: string | null;
  credential_name: string | null;
  credential_status: string | null;
}

export interface CredentialRow {
  id: string;
  platform: string;
  name: string;
  status: string;
  cookie_len: number;
  user_agent: string | null;
  source_count: number;
  last_used_at: string | null;
  last_auth_check_at: string | null;
  last_auth_ok: boolean | null;
  has_secret: boolean;
  secret_username: string | null;
  secret_last_refresh_at: string | null;
  secret_last_refresh_ok: boolean | null;
  secret_consecutive_failures: number | null;
  secret_last_refresh_error: string | null;
}

export interface RawItem {
  id: string;
  url: string | null;
  fetched_at: string;
  media_urls: string[];
  /** mp4 URLs when the underlying post had a video (X video, GIF, etc).
   *  media_urls stores the still poster; this lets the lightbox play the actual video. */
  video_urls: string[];
  dedupe_key: string;
  source_id: string;
  source_name: string;
  platform: string;
  title: string;
}

export interface AuthSuspect {
  id: string;
  name: string;
  platform: string;
  auth_status: number | null;
  auth_reason: string | null;
  candidates: number | null;
  finished_at: string;
}
