import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jwt, sign, verify } from 'hono/jwt'
import { eq, like, and, or, desc, asc, sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import * as dotenv from 'dotenv'

dotenv.config()

import { db } from './db/index.js'
import { manhwas, users, chapters, categories, tags, manhwasToCategories, manhwasToTags, readingHistory, bookmarks } from './db/schema.js'

interface AppJWTPayload {
  id: number;
  email: string;
  role: string;
  exp: number;
}

const app = new Hono()

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_change_me'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'your_google_client_id.apps.googleusercontent.com'

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

app.use('*', cors())

// Auth routes
app.post('/api/auth/register', async (c) => {
  try {
    const { name, email, password } = await c.req.json()
    
    if (!name || !email || !password) {
      return c.json({ error: 'Нэр, имэйл, нууц үг шаардлагатай' }, 400)
    }

    // Check if user exists
    const existingUser = await db.select().from(users).where(eq(users.email, email))
    if (existingUser.length > 0) {
      return c.json({ error: 'Энэ имэйл хаяг бүртгэлтэй байна' }, 400)
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    
    const newUser = await db.insert(users).values({
      name,
      email,
      password: hashedPassword,
      role: 'user' // Default role
    }).returning()

    const token = await sign({ 
      id: newUser[0].id, 
      email: newUser[0].email, 
      role: newUser[0].role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
    }, JWT_SECRET, 'HS256')

    return c.json({
      user: {
        id: newUser[0].id,
        name: newUser[0].name,
        email: newUser[0].email,
        role: newUser[0].role
      },
      token
    })
  } catch (error: any) {
    return c.json({ error: 'Бүртгэл үүсгэхэд алдаа гарлаа: ' + error.message }, 500)
  }
})

app.post('/api/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json()
    
    if (!email || !password) {
      return c.json({ error: 'Имэйл, нууц үг шаардлагатай' }, 400)
    }

    const result = await db.select().from(users).where(eq(users.email, email))
    const user = result[0]

    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      return c.json({ error: 'Имэйл эсвэл нууц үг буруу байна' }, 401)
    }

    const token = await sign({ 
      id: user.id, 
      email: user.email, 
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
    }, JWT_SECRET, 'HS256')

    return c.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      },
      token
    })
  } catch (error: any) {
    return c.json({ error: 'Нэвтрэхэд алдаа гарлаа: ' + error.message }, 500)
  }
})

app.post('/api/auth/google', async (c) => {
  try {
    const { credential } = await c.req.json()
    
    if (!credential) {
      return c.json({ error: 'Google credential шаардлагатай' }, 400)
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    })

    const payload = ticket.getPayload()
    if (!payload) {
      return c.json({ error: 'Google токен буруу байна' }, 400)
    }

    const { email, name, picture } = payload
    
    if (!email) {
      return c.json({ error: 'Имэйл хаяг олдсонгүй' }, 400)
    }

    // Check if user exists
    let userResult = await db.select().from(users).where(eq(users.email, email))
    let user = userResult[0]

    if (!user) {
      // Create new user if not exists
      const newUser = await db.insert(users).values({
        name: name || 'Google User',
        email: email,
        avatar: picture,
        role: 'user'
      }).returning()
      user = newUser[0]
    } else if (picture && !user.avatar) {
      // Update avatar if not set
      await db.update(users).set({ avatar: picture }).where(eq(users.id, user.id))
      user.avatar = picture
    }

    const token = await sign({ 
      id: user.id, 
      email: user.email, 
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
    }, JWT_SECRET, 'HS256')

    return c.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      },
      token
    })
  } catch (error: any) {
    return c.json({ error: 'Google-ээр нэвтрэхэд алдаа гарлаа: ' + error.message }, 500)
  }
})

// Auth middleware
const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Нэвтрэх шаардлагатай' }, 401)
  }

  const token = authHeader.split(' ')[1]
  try {
    const payload = await verify(token, JWT_SECRET, 'HS256')
    c.set('jwtPayload', payload)
    await next()
  } catch (error: any) {
    return c.json({ error: 'Хүчингүй токен' }, 401)
  }
}

app.get('/api/auth/me', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Токен байхгүй байна' }, 401)
  }

  const token = authHeader.split(' ')[1]
  try {
    const payload = await verify(token, JWT_SECRET, 'HS256')
    const result = await db.select().from(users).where(eq(users.id, payload.id as number))
    const user = result[0]

    if (!user) {
      return c.json({ error: 'Хэрэглэгч олдсонгүй' }, 404)
    }

    return c.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    })
  } catch (error: any) {
    console.error('JWT Verification Error in /api/auth/me:', error.message);
    return c.json({ error: 'Хүчингүй токен: ' + error.message }, 401)
  }
})

// Middleware to check roles
const checkRole = (roles: string[]) => {
  return async (c: any, next: any) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Нэвтрэх шаардлагатай' }, 401)
    }

    const token = authHeader.split(' ')[1]
    try {
      const payload = await verify(token, JWT_SECRET, 'HS256')
      const userId = payload.id as number
      
      // Fetch fresh user from DB to check current role
      const result = await db.select().from(users).where(eq(users.id, userId))
      const user = result[0]

      if (!user || !roles.includes(user.role)) {
        return c.json({ error: 'Хандах эрхгүй байна' }, 403)
      }
      
      await next()
    } catch (error: any) {
      console.error('CheckRole Middleware Error:', error);
      if (error.name === 'JwtTokenInvalid' || error.name === 'JwtTokenExpired' || error.name === 'JwtTokenIssuedAt') {
        return c.json({ error: 'Хүчингүй токен: ' + error.message }, 401)
      }
      return c.json({ error: 'Серверийн алдаа: ' + error.message }, 500)
    }
  }
}

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', message: 'Hono амжилттай ажиллаж байна' })
})

app.get('/api/manhwas', async (c) => {
  try {
    const featured = c.req.query('featured')
    const q = c.req.query('q')
    const categoryId = c.req.query('categoryId')
    const tagId = c.req.query('tagId')
    const type = c.req.query('type')
    const status = c.req.query('status')
    const sort = c.req.query('sort')
    
    let whereClause: any = undefined;
    const conditions = [];

    if (featured === 'true') {
      conditions.push(eq(manhwas.isFeatured, 'true'));
    }

    if (q) {
      conditions.push(like(manhwas.title, `%${q}%`));
    }

    if (type) {
      conditions.push(eq(manhwas.type, type));
    }

    if (status) {
      conditions.push(eq(manhwas.status, status));
    }

    if (conditions.length > 0) {
      whereClause = and(...conditions);
    }

    let orderBy: any = desc(manhwas.createdAt);
    if (sort === 'oldest') orderBy = asc(manhwas.createdAt);
    if (sort === 'rating') orderBy = desc(manhwas.rating);
    if (sort === 'title') orderBy = asc(manhwas.title);

    const result = await db.query.manhwas.findMany({
      where: whereClause,
      orderBy: orderBy,
      with: {
        categories: {
          with: {
            category: true
          }
        },
        tags: {
          with: {
            tag: true
          }
        }
      }
    })
    
    // Filter by category or tag in memory if specified (Drizzle findMany with: doesn't easily support filtering by related table fields in the same call without complex subqueries)
    // For a real production app with many records, I'd use joins or subqueries, but for now this is fine.
    let filteredResult = result.map(m => ({
      ...m,
      categories: m.categories.map(c => c.category),
      tags: m.tags.map(t => t.tag)
    }))

    if (categoryId) {
      const catId = parseInt(categoryId);
      filteredResult = filteredResult.filter(m => m.categories.some(c => c.id === catId));
    }

    if (tagId) {
      const tId = parseInt(tagId);
      filteredResult = filteredResult.filter(m => m.tags.some(t => t.id === tId));
    }
    
    return c.json(filteredResult)
  } catch (error: any) {
    return c.json({ error: 'Өгөгдлийг татахад алдаа гарлаа: ' + error.message }, 500)
  }
})

app.get('/api/categories', async (c) => {
  try {
    const result = await db.select().from(categories)
    return c.json(result)
  } catch (error: any) {
    return c.json({ error: 'Ангилал татахад алдаа гарлаа' }, 500)
  }
})

app.get('/api/tags', async (c) => {
  try {
    const result = await db.select().from(tags)
    return c.json(result)
  } catch (error: any) {
    return c.json({ error: 'Таг татахад алдаа гарлаа' }, 500)
  }
})


app.get('/api/manhwas/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Буруу ID байна' }, 400)
  }

  try {
    const manga = await db.query.manhwas.findFirst({
      where: eq(manhwas.id, id),
      with: {
        categories: {
          with: {
            category: true
          }
        },
        tags: {
          with: {
            tag: true
          }
        }
      }
    })

    if (!manga) {
      return c.json({ error: 'Манхва олдсонгүй' }, 404)
    }
    
    // Format response
    const formattedManga = {
      ...manga,
      categories: manga.categories.map(c => c.category),
      tags: manga.tags.map(t => t.tag)
    }
    
    // Check if manga is premium and user is not VIP/Moderator/Admin
    if (formattedManga.isPremium === 'true') {
      const authHeader = c.req.header('Authorization')
      if (!authHeader) {
        return c.json({ ...formattedManga, description: 'Энэ контент зөвхөн VIP хэрэглэгчдэд нээлттэй', isLocked: true })
      }
      
      const token = authHeader.split(' ')[1]
      try {
        const payload = await verify(token, JWT_SECRET, 'HS256') as unknown as AppJWTPayload
        const role = payload.role as string
        if (role === 'user') {
          return c.json({ ...formattedManga, description: 'Энэ контент зөвхөн VIP хэрэглэгчдэд нээлттэй', isLocked: true })
        }
      } catch (error) {
        return c.json({ ...formattedManga, description: 'Энэ контент зөвхөн VIP хэрэглэгчдэд нээлттэй', isLocked: true })
      }
    }

    return c.json(formattedManga)
  } catch (error: any) {
    return c.json({ error: 'Өгөгдлийг татахад алдаа гарлаа: ' + error.message }, 500)
  }
})

// Admin Dashboard endpoint
app.get('/api/admin/stats', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const totalUsersCount = await db.select().from(users);
    const totalManhwasCount = await db.select().from(manhwas);
    
    return c.json({
      totalUsers: totalUsersCount.length,
      vipUsers: totalUsersCount.filter(u => u.role === 'vip').length,
      totalManhwas: totalManhwasCount.length,
      pendingReports: 0 // Placeholder until reporting system is implemented
    })
  } catch (error: any) {
    return c.json({ error: 'Статистик татахад алдаа гарлаа: ' + error.message }, 500)
  }
})

// Manage Manhwas
app.post('/api/admin/manhwas', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const data = await c.req.json()
    // Remove relations and id if present
    const { categories, tags, id, createdAt, updatedAt, ...insertData } = data
    const newManhwa = await db.insert(manhwas).values(insertData).returning()
    return c.json(newManhwa[0])
  } catch (error: any) {
    return c.json({ error: 'Манхва нэмэхэд алдаа гарлаа: ' + error.message }, 500)
  }
})

app.put('/api/admin/manhwas/:id', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()
    
    // Remove relations, id, and dates that are strings
    const { categories, tags, id: _, createdAt, updatedAt, ...updateData } = data
    
    const updated = await db.update(manhwas)
      .set({
        ...updateData,
        updatedAt: new Date()
      })
      .where(eq(manhwas.id, id))
      .returning()
      
    return c.json(updated[0])
  } catch (error: any) {
    return c.json({ error: 'Засахад алдаа гарлаа: ' + error.message }, 500)
  }
})

app.delete('/api/admin/manhwas/:id', checkRole(['admin']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    await db.delete(manhwas).where(eq(manhwas.id, id))
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: 'Устгахад алдаа гарлаа: ' + error.message }, 500)
  }
})

// Manage Tags
app.post('/api/admin/tags', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const { name, slug } = await c.req.json()
    if (!name || !slug) return c.json({ error: 'Нэр болон slug шаардлагатай' }, 400)
    
    const newTag = await db.insert(tags).values({ name, slug }).returning()
    return c.json(newTag[0])
  } catch (error: any) {
    return c.json({ error: 'Таг нэмэхэд алдаа гарлаа: ' + error.message }, 500)
  }
})

app.put('/api/admin/tags/:id', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const { name, slug } = await c.req.json()
    
    const updated = await db.update(tags)
      .set({ name, slug })
      .where(eq(tags.id, id))
      .returning()
      
    return c.json(updated[0])
  } catch (error: any) {
    return c.json({ error: 'Таг засахад алдаа гарлаа: ' + error.message }, 500)
  }
})

app.delete('/api/admin/tags/:id', checkRole(['admin']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    // Cleanup relations first
    await db.delete(manhwasToTags).where(eq(manhwasToTags.tagId, id))
    await db.delete(tags).where(eq(tags.id, id))
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: 'Таг устгахад алдаа гарлаа: ' + error.message }, 500)
  }
})

// User Management
app.get('/api/admin/users', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const allUsers = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      avatar: users.avatar,
      createdAt: users.createdAt
    }).from(users);
    return c.json(allUsers);
  } catch (error: any) {
    return c.json({ error: 'Хэрэглэгчдийн мэдээллийг татахад алдаа гарлаа: ' + error.message }, 500)
  }
})

app.put('/api/admin/users/:id/role', checkRole(['admin']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const { role } = await c.req.json()
    
    if (!['user', 'vip', 'moderator', 'admin'].includes(role)) {
      return c.json({ error: 'Буруу эрх сонгосон байна' }, 400)
    }

    const updated = await db.update(users).set({ role }).where(eq(users.id, id)).returning()
    return c.json(updated[0])
  } catch (error: any) {
    return c.json({ error: 'Эрх өөрчлөхөд алдаа гарлаа: ' + error.message }, 500)
  }
})

app.delete('/api/admin/users/:id', checkRole(['admin']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    await db.delete(users).where(eq(users.id, id))
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: 'Хэрэглэгчийг устгахад алдаа гарлаа: ' + error.message }, 500)
  }
})

// Chapters Routes
app.get('/api/manhwas/:id/chapters', async (c) => {
  try {
    const manhwaId = parseInt(c.req.param('id'))
    const result = await db.select().from(chapters).where(eq(chapters.manhwaId, manhwaId))
    return c.json(result)
  } catch (error: any) {
    return c.json({ error: 'Бүлгүүдийг татахад алдаа гарлаа' }, 500)
  }
})

app.get('/api/chapters/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const result = await db.select().from(chapters).where(eq(chapters.id, id))
    if (!result[0]) return c.json({ error: 'Бүлэг олдсонгүй' }, 404)
    return c.json(result[0])
  } catch (error: any) {
    return c.json({ error: 'Бүлгийг татахад алдаа гарлаа' }, 500)
  }
})

app.post('/api/admin/chapters', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const data = await c.req.json()
    // Remove id and dates if present
    const { id, createdAt, updatedAt, ...insertData } = data
    const newChapter = await db.insert(chapters).values(insertData).returning()
    
    // Update manhwa chapter count (simple increment or set)
    // You might want to get the actual count
    const manhwaId = data.manhwaId
    const countResult = await db.select().from(chapters).where(eq(chapters.manhwaId, manhwaId))
    await db.update(manhwas).set({ chapterCount: countResult.length.toString() }).where(eq(manhwas.id, manhwaId))
    
    return c.json(newChapter[0])
  } catch (error: any) {
    return c.json({ error: 'Бүлэг нэмэхэд алдаа гарлаа: ' + error.message }, 500)
  }
})

app.put('/api/admin/chapters/:id', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const data = await c.req.json()
    
    // Remove id and dates
    const { id: _, createdAt, updatedAt, ...updateData } = data
    
    const updated = await db.update(chapters)
      .set({
        ...updateData,
        updatedAt: new Date()
      })
      .where(eq(chapters.id, id))
      .returning()
      
    return c.json(updated[0])
  } catch (error: any) {
    return c.json({ error: 'Бүлэг засахад алдаа гарлаа: ' + error.message }, 500)
  }
})

app.delete('/api/admin/chapters/:id', checkRole(['admin']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const chapterToDelete = await db.select().from(chapters).where(eq(chapters.id, id))
    if (chapterToDelete[0]) {
      const manhwaId = chapterToDelete[0].manhwaId
      await db.delete(chapters).where(eq(chapters.id, id))
      const countResult = await db.select().from(chapters).where(eq(chapters.manhwaId, manhwaId))
      await db.update(manhwas).set({ chapterCount: countResult.length.toString() }).where(eq(manhwas.id, manhwaId))
    }
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: 'Бүлэг устгахад алдаа гарлаа: ' + error.message }, 500)
  }
})

// History Routes
app.post('/api/history', authMiddleware, async (c) => {
  try {
    const { manhwaId, chapterId, progress } = await c.req.json()
    const payload = c.get('jwtPayload') as unknown as AppJWTPayload
    const userId = payload.id

    // Check if history already exists
    const existing = await db.select()
      .from(readingHistory)
      .where(and(eq(readingHistory.userId, userId), eq(readingHistory.manhwaId, manhwaId)))
    
    if (existing.length > 0) {
      await db.update(readingHistory)
        .set({ 
          chapterId, 
          progress: progress !== undefined ? progress : existing[0].progress,
          lastReadAt: new Date() 
        })
        .where(eq(readingHistory.id, existing[0].id))
    } else {
      await db.insert(readingHistory).values({
        userId,
        manhwaId,
        chapterId,
        progress: progress || 0
      })
    }

    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: 'Түүх хадгалахад алдаа гарлаа: ' + error.message }, 500)
  }
})

app.get('/api/history/check/:manhwaId', authMiddleware, async (c) => {
  try {
    const manhwaId = parseInt(c.req.param('manhwaId'))
    if (isNaN(manhwaId)) {
      return c.json({ error: 'Буруу ID байна' }, 400)
    }

    const payload = c.get('jwtPayload') as unknown as AppJWTPayload
    const userId = payload.id

    const result = await db.query.readingHistory.findFirst({
      where: (history, { and, eq }) => and(eq(history.userId, userId), eq(history.manhwaId, manhwaId)),
      with: {
        chapter: true
      }
    })

    return c.json(result || null)
  } catch (error: any) {
    console.error('History Check Error:', error);
    return c.json({ error: 'Алдаа гарлаа: ' + error.message }, 500)
  }
})

app.get('/api/history', authMiddleware, async (c) => {
  try {
    const payload = c.get('jwtPayload') as unknown as AppJWTPayload
    const userId = payload.id

    const result = await db.query.readingHistory.findMany({
      where: (history, { eq }) => eq(history.userId, userId),
      orderBy: (history, { desc }) => [desc(history.lastReadAt)],
      with: {
        manhwa: true,
        chapter: true
      }
    })

    return c.json(result)
  } catch (error: any) {
    console.error('History List Error:', error);
    return c.json({ error: 'Түүх татахад алдаа гарлаа: ' + error.message }, 500)
  }
})

// Bookmark Routes
app.post('/api/bookmarks', authMiddleware, async (c) => {
  try {
    const { manhwaId } = await c.req.json()
    const payload = c.get('jwtPayload') as unknown as AppJWTPayload
    const userId = payload.id

    // Check if already bookmarked
    const existing = await db.select()
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.manhwaId, manhwaId)))
    
    if (existing.length > 0) {
      await db.delete(bookmarks).where(eq(bookmarks.id, existing[0].id))
      return c.json({ bookmarked: false })
    } else {
      await db.insert(bookmarks).values({
        userId,
        manhwaId,
      })
      return c.json({ bookmarked: true })
    }
  } catch (error: any) {
    return c.json({ error: 'Хадгалахад алдаа гарлаа: ' + error.message }, 500)
  }
})

app.get('/api/bookmarks', authMiddleware, async (c) => {
  try {
    const payload = c.get('jwtPayload') as unknown as AppJWTPayload
    const userId = payload.id

    const result = await db.query.bookmarks.findMany({
      where: eq(bookmarks.userId, userId),
      orderBy: desc(bookmarks.createdAt),
      with: {
        manhwa: {
          with: {
            categories: { with: { category: true } },
            tags: { with: { tag: true } }
          }
        }
      }
    })

    const formatted = result.map(b => ({
      ...b.manhwa,
      categories: b.manhwa.categories.map(c => c.category),
      tags: b.manhwa.tags.map(t => t.tag)
    }))

    return c.json(formatted)
  } catch (error: any) {
    return c.json({ error: 'Хадгалсан контент татахад алдаа гарлаа: ' + error.message }, 500)
  }
})

app.get('/api/bookmarks/check/:manhwaId', authMiddleware, async (c) => {
  try {
    const manhwaId = parseInt(c.req.param('manhwaId'))
    if (isNaN(manhwaId)) {
      return c.json({ error: 'Буруу ID байна' }, 400)
    }

    const payload = c.get('jwtPayload') as unknown as AppJWTPayload
    const userId = payload.id

    const existing = await db.select()
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.manhwaId, manhwaId)))
    
    return c.json({ bookmarked: existing.length > 0 })
  } catch (error: any) {
    console.error('Bookmark Check Error:', error);
    return c.json({ error: 'Алдаа гарлаа: ' + error.message }, 500)
  }
})

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001

serve({
  fetch: app.fetch,
  port
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
