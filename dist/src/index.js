import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { db } from './db/index.js';
import { manhwas } from './db/schema.js';
const app = new Hono();
app.get('/api/health', (c) => {
    return c.json({ status: 'ok', message: 'Hono is running' });
});
app.get('/api/manhwas', async (c) => {
    try {
        const result = await db.select().from(manhwas);
        return c.json(result);
    }
    catch (error) {
        return c.json({ error: error.message }, 500);
    }
});
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
serve({
    fetch: app.fetch,
    port
}, (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
});
