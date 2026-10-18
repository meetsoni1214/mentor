import { z } from 'zod';
import { loginCredentials } from '../application/credentials.js';

export const ownerCredentials = loginCredentials
  .extend({
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    message: 'Passwords do not match.',
    path: ['confirmation'],
  });
