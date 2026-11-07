import type { ConversationTurn, RunAttempt } from '../domain/conversation.js';

export interface Submission {
  ownerId: string;
  historyVersion: number;
  requestId: string;
  text: string;
}

export interface RetryRequest {
  ownerId: string;
  historyVersion: number;
  turnId: string;
  requestId: string;
}

export interface RunLimits {
  model: string;
  allowedTools: ReadonlyArray<'web_search'>;
  deadlineMs: number;
  maxMessageBytes: number;
  maxContextBytes: number;
  maxOutputTokens: number;
  maxToolCalls: number;
}

export interface AttemptReference {
  ownerId: string;
  historyVersion: number;
  attemptId: string;
}

export interface Admission {
  execute: boolean;
  historyVersion: number;
  turn: ConversationTurn;
  attempt: RunAttempt;
}

export type ConversationProgress =
  | { type: 'accepted'; admission: Admission }
  | {
      type: 'text_delta';
      historyVersion: number;
      turnId: string;
      attemptId: string;
      delta: string;
    };

export type ConversationProgressObserver = (
  progress: ConversationProgress,
) => void;

export interface HistoryCursor {
  historyVersion: number;
  beforeSequence: number;
}

export interface ConversationHistory {
  historyVersion: number;
  turns: Array<ConversationTurn & { attempts: RunAttempt[] }>;
  nextCursor: HistoryCursor | null;
}

export interface CompletedTurn {
  text: string;
  answer: string;
}

export interface ModelMessage {
  role: 'user' | 'assistant';
  text: string;
}
