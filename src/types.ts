export type AppScreen = 'home' | 'workspace' | 'memory' | 'settings';
export type SettingsTab = 'account' | 'developer' | 'admin';
export type ReasoningMode = 'auto' | 'math' | 'knowledge' | 'model' | 'plan';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'user';
  created_at: string;
}

export interface AuthStatus {
  initialized: boolean;
  userCount: number;
  envPasscodeConfigured: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  mode: ReasoningMode;
  created_at?: string;
  updated_at: string;
  message_count: number;
}

export interface ConversationSmartSummary {
  bullets: string[];
  metrics: {
    total_messages: number;
    verified_count: number;
    not_learned_count: number;
  };
}

export interface NativeTrace {
  mode?: string;
  engine_path?: string[];
  latency_ms?: number;
  python_version?: string;
  external_models_used?: boolean;
  math?: {
    expression: string;
    result: number;
    steps: string[];
  };
  matched_triples?: Array<{
    id: string;
    subject: string;
    relation: string;
    object: string;
    source: string;
  }>;
  teach?: {
    triple: { subject: string; relation: string; object: string };
    duplicate: boolean;
    contradictions: string[];
  };
  checkpoint?: {
    checkpoint_version: number;
    perplexity: number;
    matched_vocab: number;
    generated: string | null;
    reason?: string;
  };
  external_tool?: {
    tool_id: string;
    status: string;
    invocation_id: string | null;
    trust_grade?: string | null;
    distinct_providers?: string[];
    kg_matches_count?: number;
    limitations?: string[];
    analysis_summary?: string | null;
  };
}

export interface MessageItem {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: ReasoningMode;
  trace_json: string | null;
  status: string;
  created_at: string;
}

export interface SystemMetrics {
  python_version: string;
  platform: string;
  cpu_count: number;
  load_1m: number;
  mem_total_mb: number;
  mem_available_mb: number;
  disk_free_gb: number;
  disk_total_gb: number;
  sqlite_db_kb: number;
}

export interface HomeSummary {
  recent_conversations: ConversationSummary[];
  counts: {
    triples: number;
    checkpoints: number;
    datasets: number;
    pending_approvals: number;
    evaluations?: number;
  };
  system: SystemMetrics;
}

export interface KnowledgeTriple {
  id: string;
  subject: string;
  relation: string;
  object: string;
  source: string;
  confidence: number;
  created_by: string;
  created_at: string;
}

export interface WorkflowGroup {
  id: string;
  name: string;
  description: string;
  requires_approval: boolean;
  stages: string[];
}

export interface WorkflowStageResult {
  stage: string;
  status: string;
  detail?: string;
}

export interface WorkflowRun {
  id: string;
  group_id: string;
  status: string;
  requires_approval: number;
  triggered_by: string;
  approved_by: string | null;
  summary: string;
  stages_json: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  scopes_json: string;
  quota_daily: number;
  requests_today: number;
  last_used_at: string | null;
  revoked: number;
  created_at: string;
}

export interface DatasetItem {
  id: string;
  name: string;
  manifest_hash: string;
  total_records: number;
  train_count: number;
  val_count: number;
  test_count: number;
  leakage_detected: number;
  status: string;
  created_at: string;
}

export interface CheckpointItem {
  id: string;
  version: number;
  dataset_id: string;
  vocab_size: number;
  ngram_order: number;
  train_loss: number;
  val_loss: number;
  perplexity: number;
  eval_accuracy: number | null;
  eval_status: string;
  created_at: string;
}

export interface EvaluationItem {
  id: string;
  checkpoint_version: number | null;
  suite_name: string;
  overall_status: string;
  math_score: number;
  knowledge_score: number;
  planning_score: number;
  test_accuracy: number | null;
  perplexity: number | null;
  baseline_delta_json: string | null;
  created_at: string;
}

export interface DeveloperOverview {
  keys: ApiKeyItem[];
  datasets: DatasetItem[];
  checkpoints: CheckpointItem[];
  evaluations?: EvaluationItem[];
  usage: {
    total_requests: number;
    avg_latency_ms: number;
    daily_quota: number;
    recent: Array<{
      endpoint: string;
      method: string;
      status_code: number;
      latency_ms: number;
      created_at: string;
    }>;
  };
}

export interface AuditLogItem {
  id: string;
  actor_id: string;
  actor_email: string;
  action: string;
  target: string;
  outcome: string;
  created_at: string;
}

export interface ExternalToolItem {
  id: string;
  name: string;
  category: 'web' | 'document' | 'compute' | 'file';
  description: string;
  endpoint_allowlist_json: string;
  permission_mode: 'auto' | 'approval_required' | 'disabled';
  enabled: number;
  quota_daily: number;
  calls_today: number;
  last_reset_date: string;
  updated_at: string;
}

export interface ToolInvocationItem {
  id: string;
  tool_id: string;
  conversation_id: string | null;
  user_id: string;
  status: 'PENDING_APPROVAL' | 'COMPLETED' | 'REJECTED' | 'FAILED' | 'BLOCKED';
  input_json: string;
  output_json: string | null;
  analysis_summary: string | null;
  approved_by: string | null;
  latency_ms: number;
  created_at: string;
}

export interface WorkspaceFileItem {
  name: string;
  size_bytes: number;
  modified_at: string;
}

export interface ToolsOverview {
  tools: ExternalToolItem[];
  invocations: ToolInvocationItem[];
  workspace_files: WorkspaceFileItem[];
}

export interface AdminOverview {
  users: User[];
  pending_runs: WorkflowRun[];
  pending_tool_invocations?: ToolInvocationItem[];
  tools?: ExternalToolItem[];
  audit_logs: AuditLogItem[];
  system: SystemMetrics;
}
