import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
async function resetAdmin() {
    console.log('Resetting admin password...');
    const hashedPassword = await bcrypt.hash('admin123', 10);
    // Find or create admin
    const existing = await db.select().from(users).where(eq(users.email, 'admin@app.com'));
    if (existing.length > 0) {
        await db.update(users)
            .set({ password: hashedPassword, role: 'admin' })
            .where(eq(users.email, 'admin@app.com'));
        console.log('Admin password updated to "admin123"');
    }
    else {
        await db.insert(users).values({
            name: 'Admin',
            email: 'admin@app.com',
            password: hashedPassword,
            role: 'admin'
        });
        console.log('Admin user created with password "admin123"');
    }
    process.exit(0);
}
resetAdmin().catch((err) => {
    console.error('Reset failed:', err);
    process.exit(1);
});
