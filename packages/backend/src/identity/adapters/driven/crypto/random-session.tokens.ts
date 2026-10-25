import { createHash, randomBytes } from 'node:crypto';
import type { SessionTokens } from '../../../application/ports/session-tokens.js';

export class RandomSessionTokens implements SessionTokens {
  generate(): string {
    return randomBytes(32).toString('hex');
  }
  digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
