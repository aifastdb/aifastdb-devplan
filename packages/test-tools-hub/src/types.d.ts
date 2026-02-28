export type TestToolKind = 'http_json_status' | 'ai_db_bench_local';
export interface TestToolDefinition {
    id: string;
    name: string;
    projectName: string;
    description?: string;
    kind: TestToolKind;
    endpoint?: string;
    logPath?: string;
    enabled?: boolean;
    timeoutMs?: number;
    staleSecondsThreshold?: number;
    tags?: string[];
}
export interface TestToolRegistry {
    updatedAt: string;
    tools: TestToolDefinition[];
}
export interface PhaseSnapshot {
    taskId: string;
    title: string;
    status: string;
    completed: number;
    total: number;
    percent: number;
}
export interface TestToolStatus {
    tool: TestToolDefinition;
    reachable: boolean;
    checkedAt: string;
    state: string;
    progress: number;
    phase?: PhaseSnapshot;
    error?: string;
    raw?: unknown;
}
//# sourceMappingURL=types.d.ts.map