import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
export const manhwas = pgTable('manhwas', {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    coverImage: text('cover_image'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
