import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const manhwas = pgTable('manhwas', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  coverImage: text('cover_image'),
  type: text('type').default('Manhwa'), // 'Manhwa', 'Manga', 'Manhua'
  status: text('status').default('Үргэлжлэх'), // 'Үргэлжлэх', 'Дууссан', 'Завсарласан'
  rating: text('rating').default('0.0'),
  chapterCount: text('chapter_count').default('0'),
  author: text('author'),
  artist: text('artist'),
  isFeatured: text('is_featured').default('false'),
  isPremium: text('is_premium').default('false'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
});

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
});

export const manhwasToCategories = pgTable('manhwas_to_categories', {
  manhwaId: integer('manhwa_id').references(() => manhwas.id).notNull(),
  categoryId: integer('category_id').references(() => categories.id).notNull(),
});

export const manhwasToTags = pgTable('manhwas_to_tags', {
  manhwaId: integer('manhwa_id').references(() => manhwas.id).notNull(),
  tagId: integer('tag_id').references(() => tags.id).notNull(),
});

export const chapters = pgTable('chapters', {
  id: serial('id').primaryKey(),
  manhwaId: integer('manhwa_id').references(() => manhwas.id).notNull(),
  number: text('number').notNull(),
  title: text('title'),
  content: text('content'), // Array of image URLs or JSON
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const manhwasRelations = relations(manhwas, ({ many }) => ({
  categories: many(manhwasToCategories),
  tags: many(manhwasToTags),
  chapters: many(chapters),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  manhwas: many(manhwasToCategories),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  manhwas: many(manhwasToTags),
}));

export const chaptersRelations = relations(chapters, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [chapters.manhwaId],
    references: [manhwas.id],
  }),
}));

export const manhwasToCategoriesRelations = relations(manhwasToCategories, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [manhwasToCategories.manhwaId],
    references: [manhwas.id],
  }),
  category: one(categories, {
    fields: [manhwasToCategories.categoryId],
    references: [categories.id],
  }),
}));

export const manhwasToTagsRelations = relations(manhwasToTags, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [manhwasToTags.manhwaId],
    references: [manhwas.id],
  }),
  tag: one(tags, {
    fields: [manhwasToTags.tagId],
    references: [tags.id],
  }),
}));

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password: text('password'), // Optional for Google Auth users
  role: text('role').notNull().default('user'), // 'user', 'vip', 'moderator', 'admin'
  avatar: text('avatar'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const readingHistory = pgTable('reading_history', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  manhwaId: integer('manhwa_id').references(() => manhwas.id).notNull(),
  chapterId: integer('chapter_id').references(() => chapters.id),
  progress: integer('progress').default(0).notNull(),
  lastReadAt: timestamp('last_read_at').defaultNow().notNull(),
});

export const bookmarks = pgTable('bookmarks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  manhwaId: integer('manhwa_id').references(() => manhwas.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const readingHistoryRelations = relations(readingHistory, ({ one }) => ({
  user: one(users, {
    fields: [readingHistory.userId],
    references: [users.id],
  }),
  manhwa: one(manhwas, {
    fields: [readingHistory.manhwaId],
    references: [manhwas.id],
  }),
  chapter: one(chapters, {
    fields: [readingHistory.chapterId],
    references: [chapters.id],
  }),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  user: one(users, {
    fields: [bookmarks.userId],
    references: [users.id],
  }),
  manhwa: one(manhwas, {
    fields: [bookmarks.manhwaId],
    references: [manhwas.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  history: many(readingHistory),
  bookmarks: many(bookmarks),
}));

