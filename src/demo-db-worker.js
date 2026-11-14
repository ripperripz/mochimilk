import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';
import schema from '../backend/src/main/resources/schema.sql?raw';
import seeds from '../backend/src/main/resources/data.sql?raw';

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
