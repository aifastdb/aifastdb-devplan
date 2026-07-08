/**
 * EmbedQueue — DevPlan 文档向量化的补发式异步队列
 *
 * 背景：
 * `synapse.embed(text)` 是 NAPI 同步调用（典型耗时 100ms~3s），
 * 在 saveSection 路径上同步执行会撑长 taskWriteMutex 持有时间，
 * 导致并发 saveSection 排队等待，用户感知"保存很慢"。
 *
 * 设计：
 * - **fire-and-forget**：调用方 enqueue 后立即返回，由队列在背景 drain。
 * - **dedupe by entityId**：同一文档反复保存时，旧任务被新任务替换，
 *   保证最终落入 HNSW 的向量与 graph 中的 properties 是同一份内容。
 * - **背压**：队列长度超过 `maxQueueLength` 时，丢弃最老的任务并计数 dropped。
 * - **drainNow**：进程退出 / 显式 sync 时可 await 队列清空，避免数据丢失。
 * - **错误隔离**：单个任务 embed 失败仅记录，不抛出，不阻塞其他任务。
 *
 * Phase-251：embed / indexEntity 注入函数都支持 sync 或 async 返回。
 * - 'async' mode：embed 同步（主线程 NAPI），indexEntity 走 graph.indexEntityAsync
 *   → 让出 NAPI worker pool，HNSW 写入不阻塞主线程。
 * - 'async-worker' mode：embed 走 worker_threads（不阻塞主线程），
 *   indexEntity 仍走 graph.indexEntityAsync。
 */

export interface EmbedQueueTask {
  entityId: string;
  title: string;
  content: string;
  enqueuedAt: number;
}

export interface EmbedQueueStats {
  queueLength: number;
  running: boolean;
  enqueued: number;
  processed: number;
  failed: number;
  dropped: number;
  replaced: number;
  /** 最近一次 embed 调用的耗时（毫秒），用于诊断 */
  lastEmbedMs: number | null;
  /** 最近一次失败的简要原因（用于诊断） */
  lastError: string | null;
}

export interface EmbedQueueOptions {
  /** 队列最大长度（默认 256）。超出时丢弃最老任务。 */
  maxQueueLength?: number;
  /** 任务执行间是否调用 setImmediate 让出事件循环（默认 true）。 */
  yieldBetweenTasks?: boolean;
  /** 诊断日志钩子（默认 console.warn）。*/
  warn?: (msg: string) => void;
}

/**
 * 单飞、串行、补发式的 embedding 队列。
 *
 * 用法：
 * ```ts
 * const q = new EmbedQueue(
 *   (text) => synapse.embed(text),
 *   (id, vec) => graph.indexEntity(id, vec),
 * );
 * q.enqueue({ entityId, title, content });   // 立即返回
 * await q.drainNow();                          // 进程退出前等待清空
 * ```
 */
export class EmbedQueue {
  private readonly queue: EmbedQueueTask[] = [];
  private running = false;
  private readonly maxQueueLength: number;
  private readonly yieldBetweenTasks: boolean;
  private readonly warn: (msg: string) => void;
  private drainPromise: Promise<void> | null = null;
  private drainResolve: (() => void) | null = null;
  private stats: Omit<EmbedQueueStats, 'queueLength' | 'running'> = {
    enqueued: 0,
    processed: 0,
    failed: 0,
    dropped: 0,
    replaced: 0,
    lastEmbedMs: null,
    lastError: null,
  };

  constructor(
    private readonly embed: (text: string) => number[] | Promise<number[]>,
    private readonly indexEntity: (entityId: string, embedding: number[]) => void | Promise<void>,
    options?: EmbedQueueOptions,
  ) {
    this.maxQueueLength = Math.max(1, options?.maxQueueLength ?? 256);
    this.yieldBetweenTasks = options?.yieldBetweenTasks !== false;
    this.warn = options?.warn ?? ((msg) => console.warn(msg));
  }

  /**
   * 入队一个 embedding 任务。立即返回。
   *
   * 同 entityId 已在队列中时，旧任务被新任务替换（保留最新内容）。
   */
  enqueue(task: Omit<EmbedQueueTask, 'enqueuedAt'>): void {
    const existingIdx = this.queue.findIndex((t) => t.entityId === task.entityId);
    if (existingIdx >= 0) {
      this.queue.splice(existingIdx, 1);
      this.stats.replaced++;
    }

    if (this.queue.length >= this.maxQueueLength) {
      this.queue.shift();
      this.stats.dropped++;
    }

    this.queue.push({ ...task, enqueuedAt: Date.now() });
    this.stats.enqueued++;
    this.kick();
  }

  /**
   * 等待队列清空（含正在执行的任务）。
   *
   * 队列已空且未运行时立即 resolve；否则返回一个共享 Promise，
   * 在 worker 把队列消费完时统一 resolve。
   */
  drainNow(): Promise<void> {
    if (!this.running && this.queue.length === 0) {
      return Promise.resolve();
    }
    if (!this.drainPromise) {
      this.drainPromise = new Promise<void>((resolve) => {
        this.drainResolve = resolve;
      });
    }
    return this.drainPromise;
  }

  getStats(): EmbedQueueStats {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      running: this.running,
    };
  }

  /** 仅供测试：清空所有未处理任务，不影响已开始执行的任务。 */
  clear(): void {
    this.queue.length = 0;
  }

  private kick(): void {
    if (this.running) return;
    this.running = true;
    setImmediate(() => this.drain());
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      const start = Date.now();
      try {
        const text = `${task.title}\n${task.content}`;
        // 兼容 sync / async embed 实现：worker 模式返回 Promise<number[]>
        const embedding = await this.embed(text);
        // Phase-251：indexEntity 走 graph.indexEntityAsync 时也是 Promise<void>，
        // 保持 await 兼容两种实现。
        await this.indexEntity(task.entityId, embedding);
        this.stats.processed++;
        this.stats.lastEmbedMs = Date.now() - start;
      } catch (e) {
        this.stats.failed++;
        const msg = e instanceof Error ? e.message : String(e);
        this.stats.lastError = msg;
        this.warn(
          `[DevPlan] EmbedQueue: failed to index ${task.entityId} ` +
          `(queueAge=${Date.now() - task.enqueuedAt}ms, contentLen=${task.content.length}): ${msg}`
        );
      }

      // 让出事件循环，避免连续 embed 把 MCP 心跳/新请求饿死
      if (this.yieldBetweenTasks && this.queue.length > 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    this.running = false;
    if (this.drainResolve) {
      const resolve = this.drainResolve;
      this.drainResolve = null;
      this.drainPromise = null;
      resolve();
    }
  }
}
