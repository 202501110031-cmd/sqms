const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'sqms.db');

for (const suffix of ['', '-wal', '-shm']) {
  const target = `${dbPath}${suffix}`;
  if (fs.existsSync(target)) fs.rmSync(target);
}

require('./db');

console.log(`SQMS database reset with seeded demo data: ${dbPath}`);
