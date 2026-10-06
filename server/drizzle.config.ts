// drizzle-kit: `npm run db:generate` compares src/db/schema.ts with the migrations so far and writes the next
// one to drizzle/ (review it, then commit it). It never touches a database.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
