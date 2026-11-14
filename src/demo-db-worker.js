import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';
import schema from '../db/schema.sql?raw';
import seeds from '../db/data.sql?raw';

worker({
  async init({ dataDir }) {
    const db = await PGlite.create({ dataDir });
    await db.transaction(async tx => {
      await tx.exec(schema);
      await tx.exec(seeds);
    });
    return db;
  },
});
