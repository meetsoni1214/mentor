import { z } from 'zod';

export const loginCredentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z
    .string()
    .max(256)
    .refine((value) => {
      const length = Array.from(value).length;
      return length >= 9 && length <= 128;
    }, 'Use a password between 9 and 128 characters.'),
});
