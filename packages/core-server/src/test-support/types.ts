export interface RootEntry {
  uri: string;
  name: string;
}

export interface RootsListResult {
  roots: RootEntry[];
}

export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ToolUseContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

export interface ToolResultContentBlock {
  type: "tool_result";
  toolUseId: string;
  content?: Array<TextContentBlock | Record<string, unknown>>;
}

export interface SamplingTextResult {
  model?: string;
  role?: string;
  content: {
    type: string;
    text?: string;
  };
  stopReason?: string;
}

export interface SamplingWithToolsResult {
  model?: string;
  role?: string;
  content: Array<ToolUseContentBlock | TextContentBlock | Record<string, unknown>>;
  stopReason?: string;
}

export interface ElicitationAcceptResult {
  action: "accept";
  content?: Record<string, unknown>;
}

export interface ElicitationDeclineResult {
  action: "decline";
  content?: Record<string, unknown>;
}

export interface ElicitationCancelResult {
  action: "cancel";
  content?: Record<string, unknown>;
}

export type ElicitationResult =
  | ElicitationAcceptResult
  | ElicitationDeclineResult
  | ElicitationCancelResult;

export interface TaskDescriptor {
  taskId: string;
  status: "working" | "input_required" | "completed" | "failed" | "cancelled";
  ttl: number;
  createdAt: string;
  lastUpdatedAt: string;
  pollInterval: number;
}

export interface TaskCreatedResult {
  task: {
    taskId: string;
    status?: string;
    ttl?: number;
    pollInterval?: number;
  };
  _meta?: Record<string, unknown>;
}

export interface ToolStructuredResult<TStructured = Record<string, unknown>> {
  structuredContent: TStructured;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

export interface RelatedTaskMeta {
  "io.modelcontextprotocol/related-task"?: {
    taskId: string;
  };
}

export interface JsonRpcRequestMessage<TParams extends Record<string, unknown> = Record<string, unknown>> {
  jsonrpc: "2.0";
  method: string;
  id?: string | number | null;
  params: TParams;
}
