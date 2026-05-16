import { db } from '../db/index.js';
import { users } from '../db/schema.js';

async function checkUsers() {
  const allUsers = await db.select().from(users);
  console.log(JSON.stringify(allUsers.map(u => ({ email: u.email, role: u.role })), null, 2));
  process.exit(0);
}

checkUsers();
