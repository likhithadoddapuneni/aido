import { migrate } from '../migrate.ts';

const url = process.env['DATABASE_ADMIN_URL'] ?? 'postgres://aidooi:aidooi@localhost:5433/aidooi';
const applied = await migrate(url, { log: (m) => console.log(m) });
console.log(
  applied.length === 0 ? 'database is up to date' : `applied ${applied.length} migration(s)`,
);
