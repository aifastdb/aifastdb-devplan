import { PhaseSnapshot, TestToolDefinition, TestToolStatus } from './types';
export interface CollectToolStatusOptions {
    getCurrentPhase?: (projectName: string) => PhaseSnapshot | undefined;
}
export declare function collectToolStatus(tool: TestToolDefinition, options?: CollectToolStatusOptions): Promise<TestToolStatus>;
//# sourceMappingURL=monitor.d.ts.map