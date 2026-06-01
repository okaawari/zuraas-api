import { db } from '../db/index.js';
import { manhwas } from '../db/schema.js';
import { eq } from 'drizzle-orm';

async function updateStatus() {
  console.log('Updating statuses in database...');
  const result = await db
    .update(manhwas)
    .set({ status: 'Гарч байгаа' })
    .where(eq(manhwas.status, 'Үргэлжлэх'))
    .returning();
  
  console.log(`Successfully updated ${result.length} manhwa(s) status to 'Гарч байгаа'.`);
  process.exit(0);
}

updateStatus().catch(err => {
  console.error('Update failed:', err);
  process.exit(1);
});
