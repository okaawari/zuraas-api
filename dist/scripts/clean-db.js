import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function cleanDb() {
    console.log('Starting full database wipe...');
    try {
        // 1. Delete all records from reference/association tables first to avoid foreign key violations
        console.log('Deleting association and dependent tables...');
        await db.delete(schema.manhwasToCategories);
        await db.delete(schema.manhwasToTags);
        await db.delete(schema.manhwasToStaff);
        await db.delete(schema.bookmarks);
        await db.delete(schema.readingHistory);
        await db.delete(schema.chapters);
        await db.delete(schema.characters);
        // 2. Delete from parent tables
        console.log('Deleting staff, categories, tags, and manhwas...');
        await db.delete(schema.staff);
        await db.delete(schema.categories);
        await db.delete(schema.tags);
        await db.delete(schema.manhwas);
        // 3. Clean users table and recreate admin user
        console.log('Wiping users table...');
        await db.delete(schema.users);
        console.log('Creating pristine admin user...');
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await db.insert(schema.users).values({
            name: 'Admin',
            email: 'admin@app.com',
            password: hashedPassword,
            role: 'admin',
        });
        console.log('Admin user created successfully (Email: admin@app.com, Password: admin123)');
        // 4. Clean local upload directories
        console.log('Cleaning local upload directories...');
        const uploadDirs = ['covers', 'banners', 'chapters'];
        const apiDir = path.resolve(__dirname, '../..'); // e:/Projects/zuraas/api
        for (const dirName of uploadDirs) {
            const targetPath = path.join(apiDir, 'uploads', dirName);
            if (fs.existsSync(targetPath)) {
                console.log(`Clearing uploads/${dirName} folder at ${targetPath}...`);
                const files = fs.readdirSync(targetPath);
                for (const file of files) {
                    const filePath = path.join(targetPath, file);
                    try {
                        fs.rmSync(filePath, { recursive: true, force: true });
                        console.log(`Deleted: uploads/${dirName}/${file}`);
                    }
                    catch (err) {
                        console.error(`Failed to delete ${file}:`, err.message);
                    }
                }
            }
            else {
                console.log(`Upload directory uploads/${dirName} does not exist. Creating it...`);
                fs.mkdirSync(targetPath, { recursive: true });
            }
        }
        console.log('Database and local files cleaned completely and successfully! DB IS CLEAN AS FUCK! ✨');
        process.exit(0);
    }
    catch (error) {
        console.error('Database clean failed:', error);
        process.exit(1);
    }
}
cleanDb();
