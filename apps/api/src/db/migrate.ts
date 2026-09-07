import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { config } from '../config';

const client = postgres(config.DATABASE_URL, { max: 1 });
const db = drizzle(client);

async function main() {
  console.log('开始迁移...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('迁移完成');
  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('迁移失败:', err);
  process.exit(1);
});
