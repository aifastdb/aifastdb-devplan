/**
 * EmbedWorker — DevPlan 文档 embedding 的 worker_threads 计算节点（Phase-251）
 *
 * 背景：
 * `synapse.embed(text)` 是 NAPI 同步调用，无论同步还是 fire-and-forget 队列，
 * 模型 forward 始终阻塞主线程的 event loop（典型 100ms~3s）。
 * 在 worker_threads 里跑可以让主线程真正不被阻塞，MCP 心跳 / 新 saveSection
 * 都能继续响应，代价是模型在 worker 进程加载一份（内存翻倍）。
 *
 * 协议：
 * - 主线程 → worker：`{ type: 'init' | 'embed' | 'embedBatch' | 'shutdown', id, ... }`
 * - worker → 主线程：`{ type: 'ready' | 'embedResult' | 'embedBatchResult' | 'shutdownAck' | 'error', id, ... }`
 *
 * worker 内部：
 * - 启动时不持有任何 synapse，等 'init' 消息到达后用主线程下发的 perception
 *   配置 + 临时 storage 路径创建独立 VibeSynapse（仅做 embed，不写存储数据）。
 * - 收到 'shutdown' 时关闭 synapse、删伴生临时目录、退出。
 *
 * 注意：本文件由主线程通过 `worker_threads.Worker` 加载，编译后为
 * dist/embed-worker.js；测试环境通过 ts-jest 直接 require .ts 不会触发 worker。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parentPort, isMainThread } from 'worker_threads';

// 仅在 worker 上下文执行；主线程 require 此文件时是 no-op，方便测试。
if (!isMainThread && parentPort) {
  type InitMsg = {
    type: 'init';
    id: number;
    perception: unknown;
    dimension?: number;
    storagePath?: string;
  };
  type EmbedMsg = { type: 'embed'; id: number; text: string };
  type EmbedBatchMsg = { type: 'embedBatch'; id: number; texts: string[] };
  type ShutdownMsg = { type: 'shutdown'; id: number };
  type WorkerCmd = InitMsg | EmbedMsg | EmbedBatchMsg | ShutdownMsg;

  let synapse: unknown = null;
  let tempStorageDir: string | null = null;

  const send = (msg: Record<string, unknown>): void => {
    parentPort!.postMessage(msg);
  };
  const sendError = (id: number, e: unknown): void => {
    send({ type: 'error', id, message: e instanceof Error ? e.message : String(e) });
  };

  const handleInit = (msg: InitMsg): void => {
    try {
      // worker 内部独立 require aifastdb——会重新加载 napi binding 并初始化模型。
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
      const aifastdb = require('aifastdb') as { VibeSynapse: any };
      const VibeSynapse = aifastdb.VibeSynapse;

      // 伴生 storage：worker 不写入业务数据，但 VibeSynapse 构造强制要 path。
      // 用独立 tmpdir 避免与主线程 synapse-data 抢文件锁。
      const baseDir = msg.storagePath
        ? msg.storagePath
        : path.join(os.tmpdir(), `devplan-embed-worker-${process.pid}-${Date.now()}`);
      fs.mkdirSync(baseDir, { recursive: true });
      tempStorageDir = baseDir;

      synapse = new VibeSynapse({
        storage: baseDir,
        ...(msg.dimension ? { dimension: msg.dimension } : {}),
        perception: msg.perception,
      });

      // 触发模型加载并 dry-run 一次，避免后续第一次 embed 仍要冷启动。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = synapse as any;
      if (!s.hasPerception) {
        throw new Error('Worker VibeSynapse perception not available');
      }
      s.embed('init');

      send({ type: 'ready', id: msg.id });
    } catch (e) {
      sendError(msg.id, e);
    }
  };

  const handleEmbed = (msg: EmbedMsg): void => {
    if (!synapse) {
      sendError(msg.id, 'Worker not initialized');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vector = (synapse as any).embed(msg.text) as number[];
      send({ type: 'embedResult', id: msg.id, vector });
    } catch (e) {
      sendError(msg.id, e);
    }
  };

  const handleEmbedBatch = (msg: EmbedBatchMsg): void => {
    if (!synapse) {
      sendError(msg.id, 'Worker not initialized');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vectors = (synapse as any).embedBatch(msg.texts) as number[][];
      send({ type: 'embedBatchResult', id: msg.id, vectors });
    } catch (e) {
      sendError(msg.id, e);
    }
  };

  const handleShutdown = (msg: ShutdownMsg): void => {
    try {
      if (synapse) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const s = synapse as any;
          if (typeof s.close === 'function') s.close();
        } catch {
          /* ignore */
        }
        synapse = null;
      }
      if (tempStorageDir) {
        try {
          fs.rmSync(tempStorageDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        tempStorageDir = null;
      }
      send({ type: 'shutdownAck', id: msg.id });
    } catch (e) {
      sendError(msg.id, e);
    } finally {
      // worker 退出由主线程 terminate 触发；这里不主动 process.exit
    }
  };

  parentPort.on('message', (raw: WorkerCmd) => {
    switch (raw?.type) {
      case 'init':
        handleInit(raw);
        return;
      case 'embed':
        handleEmbed(raw);
        return;
      case 'embedBatch':
        handleEmbedBatch(raw);
        return;
      case 'shutdown':
        handleShutdown(raw);
        return;
      default:
        sendError((raw as { id?: number })?.id ?? -1, `Unknown message type: ${(raw as { type?: string })?.type}`);
    }
  });
}

export {};
