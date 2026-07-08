/**
 * EmbedWorkerHandle — 主线程侧的 EmbedWorker RPC 封装（Phase-251）
 *
 * 职责：
 * - 启动 worker（lazy；首次 embed 时再 spawn，避免不开 'async-worker' mode 的零成本路径背锅）
 * - 把主线程 → worker 的请求/响应通过 message id 配对成 Promise
 * - 超时 / worker 异常退出时统一拒绝所有 pending 请求并允许调用方降级
 * - 提供 embed/embedBatch/terminate/isReady 接口
 *
 * 使用方式：
 *   const h = new EmbedWorkerHandle({ workerScript, perception, dimension });
 *   await h.start();           // 内部 spawn + 模型加载
 *   const v = await h.embed("hello");
 *   await h.terminate();       // 进程退出 hook 调
 *
 * 注意：worker 脚本路径必须由调用方决定（编译产物 dist/embed-worker.js 还是
 * ts-jest 测试场景下的 ts 源），handle 不假设。启动失败时 throws，调用方应
 * 捕获并降级回主线程同步路径。
 */

import { Worker } from 'worker_threads';
import type { PerceptionConfig } from 'aifastdb';

export interface EmbedWorkerHandleOptions {
  /** Worker 入口文件绝对路径（编译后的 .js）。 */
  workerScript: string;
  /** Perception engine 配置（传给 worker 内部 VibeSynapse）。 */
  perception: PerceptionConfig;
  /** 显式 dimension（Matryoshka 截断时用）。 */
  dimension?: number;
  /** Worker 伴生 storage 路径；不传时 worker 自己用 tmpdir。 */
  storagePath?: string;
  /** 单次 embed 调用的超时（毫秒，默认 30000）。 */
  embedTimeoutMs?: number;
  /** 启动 / shutdown 的超时（毫秒，默认 60000，模型加载冷启动可能较慢）。 */
  startTimeoutMs?: number;
  /** 诊断日志钩子。 */
  warn?: (msg: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  kind: 'init' | 'embed' | 'embedBatch' | 'shutdown';
}

export class EmbedWorkerHandle {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private ready = false;
  private starting: Promise<void> | null = null;
  private terminated = false;
  private readonly warn: (msg: string) => void;
  private readonly embedTimeoutMs: number;
  private readonly startTimeoutMs: number;

  constructor(private readonly options: EmbedWorkerHandleOptions) {
    this.warn = options.warn ?? ((m) => console.warn(m));
    this.embedTimeoutMs = Math.max(1000, options.embedTimeoutMs ?? 30000);
    this.startTimeoutMs = Math.max(5000, options.startTimeoutMs ?? 60000);
  }

  isReady(): boolean {
    return this.ready && !this.terminated;
  }

  /**
   * 启动 worker 并完成 init dry-run。多次调用幂等（共享同一 starting Promise）。
   * 失败时清理 worker 并保持 terminated 状态，调用方应回退到主线程路径。
   */
  start(): Promise<void> {
    if (this.terminated) {
      return Promise.reject(new Error('EmbedWorkerHandle already terminated'));
    }
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;

    this.starting = this.spawnAndInit().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async spawnAndInit(): Promise<void> {
    try {
      this.worker = new Worker(this.options.workerScript);
    } catch (e) {
      this.terminated = true;
      throw new Error(
        `Failed to spawn embed worker: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    this.worker.on('message', (msg: unknown) => this.onMessage(msg));
    this.worker.on('error', (e) => this.onWorkerCrash(e));
    this.worker.on('exit', (code) => {
      if (code !== 0 && !this.terminated) {
        this.onWorkerCrash(new Error(`Embed worker exited with code ${code}`));
      }
    });

    await this.send<void>('init', this.startTimeoutMs, {
      perception: this.options.perception,
      dimension: this.options.dimension,
      storagePath: this.options.storagePath,
    });
    this.ready = true;
  }

  embed(text: string): Promise<number[]> {
    if (this.terminated) {
      return Promise.reject(new Error('EmbedWorkerHandle terminated'));
    }
    if (!this.ready) {
      return Promise.reject(new Error('EmbedWorkerHandle not started'));
    }
    return this.send<number[]>('embed', this.embedTimeoutMs, { text });
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    if (this.terminated) {
      return Promise.reject(new Error('EmbedWorkerHandle terminated'));
    }
    if (!this.ready) {
      return Promise.reject(new Error('EmbedWorkerHandle not started'));
    }
    return this.send<number[][]>('embedBatch', this.embedTimeoutMs, { texts });
  }

  /**
   * 优雅关停：先 shutdown 让 worker 关闭 synapse + 清伴生目录，再 terminate。
   * 任何阶段失败都会强制 terminate，以便进程能正常退出。
   */
  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    const w = this.worker;
    this.worker = null;
    if (!w) {
      this.rejectAllPending(new Error('Worker terminated'));
      return;
    }
    try {
      if (this.ready) {
        // 给 shutdown 较短超时——卡住也无妨，反正马上 terminate
        await Promise.race([
          this.sendOnRaw(w, 'shutdown', {}),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]);
      }
    } catch {
      /* ignore — 强制 terminate 兜底 */
    }
    try {
      await w.terminate();
    } catch {
      /* ignore */
    }
    this.rejectAllPending(new Error('Worker terminated'));
    this.ready = false;
  }

  private send<T>(
    kind: PendingRequest['kind'],
    timeoutMs: number,
    payload: Record<string, unknown>,
  ): Promise<T> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not running'));
    }
    return this.sendOn<T>(this.worker, kind, timeoutMs, payload);
  }

  private sendOn<T>(
    w: Worker,
    kind: PendingRequest['kind'],
    timeoutMs: number,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`Embed worker ${kind} timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        kind,
      });
      try {
        w.postMessage({ type: kind, id, ...payload });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private sendOnRaw(
    w: Worker,
    kind: PendingRequest['kind'],
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.sendOn<void>(w, kind, 5000, payload);
  }

  private onMessage(msg: unknown): void {
    const m = msg as { type?: string; id?: number; vector?: number[]; vectors?: number[][]; message?: string };
    if (!m || typeof m.id !== 'number') return;
    const pending = this.pending.get(m.id);
    if (!pending) return;
    this.pending.delete(m.id);
    clearTimeout(pending.timer);

    switch (m.type) {
      case 'ready':
      case 'shutdownAck':
        pending.resolve(undefined);
        return;
      case 'embedResult':
        pending.resolve(m.vector ?? []);
        return;
      case 'embedBatchResult':
        pending.resolve(m.vectors ?? []);
        return;
      case 'error':
        pending.reject(new Error(m.message ?? 'Embed worker error'));
        return;
      default:
        pending.reject(new Error(`Unknown reply type: ${m.type}`));
    }
  }

  private onWorkerCrash(err: Error): void {
    if (this.terminated) return;
    this.warn(`[DevPlan] EmbedWorker crashed: ${err.message}`);
    this.terminated = true;
    this.ready = false;
    this.worker = null;
    this.rejectAllPending(err);
  }

  private rejectAllPending(err: Error): void {
    const snapshot = Array.from(this.pending.entries());
    this.pending.clear();
    for (const [, p] of snapshot) {
      clearTimeout(p.timer);
      try {
        p.reject(err);
      } catch {
        /* ignore */
      }
    }
  }
}
