// PROTOCOL FIXTURE ONLY. Never imported by production or development entrypoints.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Rpc } from '../server/codex.js';
export class Fixture extends EventEmitter implements Rpc {
  ready = true;
  calls: { method: string; params: any }[] = [];
  active = new Map<string, string>();
  imageHistory = new Map<string, any[]>();
  account: any = { type: 'chatgpt', planType: 'plus' };
  failure: string | null = null;
  async request(method: string, params: any = {}) {
    this.calls.push({ method, params });
    if (this.failure) throw Error(this.failure);
    if (method === 'account/read') return { account: this.account };
    if (method === 'account/rateLimits/read')
      return {
        rateLimits: { primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 2000000000 } },
      };
    if (method === 'model/list')
      return {
        data: [
          { id: 'fixture-image', model: 'fixture-image', displayName: 'Fixture Image', inputModalities: ['text', 'image'], isDefault: true },
        ],
      };
    if (method === 'thread/start' || method === 'thread/fork')
      return { thread: { id: randomUUID() } };
    if (method === 'thread/resume') return { thread: { id: params.threadId } };
    if (method === 'thread/read')
      return { thread: { id: params.threadId, turns: [{ items: this.imageHistory.get(params.threadId) || [] }] } };
    if (method === 'turn/start') {
      const id = randomUUID();
      this.active.set(params.threadId, id);
      setTimeout(
        () =>
          this.emit('notification', 'turn/started', {
            threadId: params.threadId,
            turn: { id, status: 'inProgress' },
          }),
        1,
      );
      return { turn: { id, status: 'inProgress' } };
    }
    if (method === 'turn/interrupt') {
      this.emit('notification', 'turn/completed', {
        threadId: params.threadId,
        turn: { id: params.turnId, status: 'interrupted', error: null },
      });
      return {};
    }
    return {};
  }
  delta(threadId: string, text: string, itemId = 'answer') {
    this.emit('notification', 'item/agentMessage/delta', {
      threadId,
      turnId: this.active.get(threadId),
      itemId,
      delta: text,
    });
  }
  complete(threadId: string, text: string) {
    this.emit('notification', 'item/completed', {
      threadId,
      turnId: this.active.get(threadId),
      item: { type: 'agentMessage', id: 'answer', text },
    });
    this.emit('notification', 'turn/completed', {
      threadId,
      turn: { id: this.active.get(threadId), status: 'completed', error: null },
    });
  }
  tokenUsage(threadId: string, values: Partial<{ totalTokens: number; inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number; outputTokens: number; reasoningOutputTokens: number }>) {
    const usage = {
      totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
      ...values,
    };
    this.emit('notification', 'thread/tokenUsage/updated', {
      threadId,
      turnId: this.active.get(threadId),
      tokenUsage: { total: usage, last: usage, modelContextWindow: 128000 },
    });
  }
  close() {
    this.ready = false;
    this.emit('down');
  }
}
