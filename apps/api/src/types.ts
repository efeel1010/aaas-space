import type { users } from './db/schema';

export type AppVariables = {
  user: typeof users.$inferSelect;
  sessionToken?: string;
};
