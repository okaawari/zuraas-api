import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const manhwas = pgTable('manhwas', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  coverImage: text('cover_image'),
  bannerImage: text('banner_image'),
  type: text('type').default('Manhwa'), // 'Manhwa', 'Manga', 'Manhua'
  status: text('status').default('Гарч байгаа'), // 'Гарч байгаа', 'Дууссан', 'Завсарласан'
  rating: text('rating').default('0.0'),
  chapterCount: text('chapter_count').default('0'),
  author: text('author'),
  artist: text('artist'),
  isFeatured: text('is_featured').default('false'),
  isPremium: text('is_premium').default('false'),
  anilistId: integer('anilist_id'),
  anilistUrl: text('anilist_url'),
  alternativeTitles: text('alternative_titles'),
  genres: text('genres'),
  year: integer('year'),
  averageScore: integer('average_score'),
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
  characters: many(characters),
  staff: many(manhwasToStaff),
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
export const characters = pgTable('characters', {
  id: serial('id').primaryKey(),
  manhwaId: integer('manhwa_id').references(() => manhwas.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  image: text('image'),
  role: text('role'), // 'MAIN', 'SUPPORTING'
  anilistId: integer('anilist_id'),
});

export const staff = pgTable('staff', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  image: text('image'),
  description: text('description'),
  anilistId: integer('anilist_id'),
});

export const manhwasToStaff = pgTable('manhwas_to_staff', {
  manhwaId: integer('manhwa_id').references(() => manhwas.id, { onDelete: 'cascade' }).notNull(),
  staffId: integer('staff_id').references(() => staff.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(), // e.g. 'Story', 'Art', 'Original Creator'
});

export const charactersRelations = relations(characters, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [characters.manhwaId],
    references: [manhwas.id],
  }),
}));

export const staffRelations = relations(staff, ({ many }) => ({
  manhwas: many(manhwasToStaff),
}));

export const manhwasToStaffRelations = relations(manhwasToStaff, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [manhwasToStaff.manhwaId],
    references: [manhwas.id],
  }),
  staff: one(staff, {
    fields: [manhwasToStaff.staffId],
    references: [staff.id],
  }),
}));

export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  manhwaId: integer('manhwa_id').references(() => manhwas.id, { onDelete: 'cascade' }).notNull(),
  chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  parentId: integer('parent_id'),
  content: text('content').notNull(),
  likes: integer('likes').default(0).notNull(),
  dislikes: integer('dislikes').default(0).notNull(),
  isEdited: integer('is_edited').default(0).notNull(),
  isReported: integer('is_reported').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const commentLikes = pgTable('comment_likes', {
  id: serial('id').primaryKey(),
  commentId: integer('comment_id').references(() => comments.id, { onDelete: 'cascade' }).notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const commentsRelations = relations(comments, ({ one, many }) => ({
  manhwa: one(manhwas, {
    fields: [comments.manhwaId],
    references: [manhwas.id],
  }),
  chapter: one(chapters, {
    fields: [comments.chapterId],
    references: [chapters.id],
  }),
  user: one(users, {
    fields: [comments.userId],
    references: [users.id],
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: 'comment_replies',
  }),
  replies: many(comments, {
    relationName: 'comment_replies',
  }),
}));

export const commentLikesRelations = relations(commentLikes, ({ one }) => ({
  comment: one(comments, {
    fields: [commentLikes.commentId],
    references: [comments.id],
  }),
  user: one(users, {
    fields: [commentLikes.userId],
    references: [users.id],
  }),
}));

