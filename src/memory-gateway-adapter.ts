import type { ScoredMemory, UnifiedRecallOptions } from './types';

export interface MemoryGatewayAdapterConfig {
  preferUnifiedApi?: boolean;
  unifiedApiFallbackEnabled?: boolean;
  fallbackAlertThreshold?: number;
}

type RouteKind = 'gateway' | 'fallback' | 'none';

export interface MemoryGatewayOpTelemetry {
  gatewayCalls: number;
  fallbackCalls: number;
  totalCalls: number;
  gatewayHitRate: number;
  fallbackRate: number;
  lastRoute: RouteKind;
  lastError?: string;
}

export interface MemoryGatewayTelemetry {
  recallUnified: MemoryGatewayOpTelemetry;
  getOutboxEntries: MemoryGatewayOpTelemetry;
  retryOutboxEntry: MemoryGatewayOpTelemetry;
}

type RecallFallback = (query: string, options?: UnifiedRecallOptions) => ScoredMemory[];
type OutboxListFallback = () => any[];
type OutboxRetryFallback = (entryId: string, forceReady?: boolean) => Promise<any>;

const DEFAULT_CONFIG: Required<MemoryGatewayAdapterConfig> = {
  preferUnifiedApi: true,
  unifiedApiFallbackEnabled: true,
  fallbackAlertThreshold: 0.2,
};

export class MemoryGatewayAdapter {
  private readonly config: Required<MemoryGatewayAdapterConfig>;
  private telemetry: MemoryGatewayTelemetry = {
    recallUnified: {
      gatewayCalls: 0, fallbackCalls: 0, totalCalls: 0, gatewayHitRate: 0, fallbackRate: 0, lastRoute: 'none',
    },
    getOutboxEntries: {
      gatewayCalls: 0, fallbackCalls: 0, totalCalls: 0, gatewayHitRate: 0, fallbackRate: 0, lastRoute: 'none',
    },
    retryOutboxEntry: {
      gatewayCalls: 0, fallbackCalls: 0, totalCalls: 0, gatewayHitRate: 0, fallbackRate: 0, lastRoute: 'none',
    },
  };

  constructor(
    private readonly gateway: any,
    config?: MemoryGatewayAdapterConfig,
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...(config || {}),
    };
  }

  recallUnified(
    query: string,
    options: UnifiedRecallOptions | undefined,
    fallback: RecallFallback,
  ): ScoredMemory[] {
    if (!this.config.preferUnifiedApi || !this.gateway || typeof this.gateway.recallUnified !== 'function') {
      this.markFallback('recallUnified');
      return fallback(query, options);
    }

    try {
      const result = this.gateway.recallUnified(query, options || {});
      this.markGateway('recallUnified');
      if (Array.isArray(result)) return result as ScoredMemory[];
      if (result && Array.isArray((result as any).memories)) return (result as any).memories as ScoredMemory[];
      return [];
    } catch (error) {
      this.setError('recallUnified', error);
      if (!this.config.unifiedApiFallbackEnabled) {
        throw error;
      }
      this.markFallback('recallUnified');
      return fallback(query, options);
    }
  }

  getOutboxEntries(fallback: OutboxListFallback): any[] {
    if (!this.config.preferUnifiedApi || !this.gateway || typeof this.gateway.getOutboxEntries !== 'function') {
      this.markFallback('getOutboxEntries');
      return fallback();
    }
    try {
      const entries = this.gateway.getOutboxEntries();
      this.markGateway('getOutboxEntries');
      return Array.isArray(entries) ? entries : [];
    } catch (error) {
      this.setError('getOutboxEntries', error);
      if (!this.config.unifiedApiFallbackEnabled) {
        throw error;
      }
      this.markFallback('getOutboxEntries');
      return fallback();
    }
  }

  async retryOutboxEntry(
    entryId: string,
    forceReady: boolean,
    fallback: OutboxRetryFallback,
  ): Promise<any> {
    if (!this.config.preferUnifiedApi || !this.gateway || typeof this.gateway.retryOutboxEntry !== 'function') {
      this.markFallback('retryOutboxEntry');
      return fallback(entryId, forceReady);
    }
    try {
      const result = await this.gateway.retryOutboxEntry(entryId, forceReady);
      this.markGateway('retryOutboxEntry');
      return result;
    } catch (error) {
      this.setError('retryOutboxEntry', error);
      if (!this.config.unifiedApiFallbackEnabled) {
        throw error;
      }
      this.markFallback('retryOutboxEntry');
      return fallback(entryId, forceReady);
    }
  }

  getTelemetry(): MemoryGatewayTelemetry {
    const clone = JSON.parse(JSON.stringify(this.telemetry)) as MemoryGatewayTelemetry;
    const enrich = (op: MemoryGatewayOpTelemetry): MemoryGatewayOpTelemetry => {
      const total = op.gatewayCalls + op.fallbackCalls;
      const safeTotal = Math.max(1, total);
      return {
        ...op,
        totalCalls: total,
        gatewayHitRate: op.gatewayCalls / safeTotal,
        fallbackRate: op.fallbackCalls / safeTotal,
      };
    };
    clone.recallUnified = enrich(clone.recallUnified);
    clone.getOutboxEntries = enrich(clone.getOutboxEntries);
    clone.retryOutboxEntry = enrich(clone.retryOutboxEntry);
    return clone;
  }

  getFallbackAlertThreshold(): number {
    return this.config.fallbackAlertThreshold;
  }

  private markGateway(op: keyof MemoryGatewayTelemetry): void {
    this.telemetry[op].gatewayCalls += 1;
    this.telemetry[op].lastRoute = 'gateway';
  }

  private markFallback(op: keyof MemoryGatewayTelemetry): void {
    this.telemetry[op].fallbackCalls += 1;
    this.telemetry[op].lastRoute = 'fallback';
  }

  private setError(op: keyof MemoryGatewayTelemetry, error: unknown): void {
    this.telemetry[op].lastError = error instanceof Error ? error.message : String(error);
  }
}
