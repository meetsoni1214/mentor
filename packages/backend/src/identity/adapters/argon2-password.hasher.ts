import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '../application/provision-owner.js';
import type { PasswordVerifier } from '../application/sessions.js';

// OWASP's Argon2id minimum: 19 MiB, two passes, one lane.
const parameters = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 };

function unpaddedBase64(value: Buffer): string {
  return value.toString('base64').replace(/=+$/, '');
}

export class Argon2PasswordHasher implements PasswordHasher, PasswordVerifier {
  private derive(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      argon2(
        'argon2id',
        { ...parameters, message: password, nonce: salt },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      );
    });
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const tag = await this.derive(password, salt);
    // PHC format carries the algorithm, version, cost, salt, and hash for login.
    return `$argon2id$v=19$m=${parameters.memory},t=${parameters.passes},p=${parameters.parallelism}$${unpaddedBase64(salt)}$${unpaddedBase64(tag)}`;
  }

  async verify(password: string, hash: string | null): Promise<boolean> {
    // Only accept the bounded parameters issued by this version of the app.
    const parts = hash?.match(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/,
    );
    const salt = parts?.[1]
      ? Buffer.from(parts[1], 'base64')
      : Buffer.alloc(16);
    const expected = parts?.[2]
      ? Buffer.from(parts[2], 'base64')
      : Buffer.alloc(32);
    const actual = await this.derive(password, salt);
    return timingSafeEqual(actual, expected) && Boolean(parts);
  }
}
