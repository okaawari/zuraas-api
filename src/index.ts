import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jwt, sign, verify } from 'hono/jwt'
import { eq, like, ilike, and, or, desc, asc, sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import * as dotenv from 'dotenv'

dotenv.config()

import { db } from './db/index.js'
import { manhwas, users, chapters, categories, tags, manhwasToCategories, manhwasToTags, readingHistory, bookmarks, characters, staff, manhwasToStaff, comments, commentLikes } from './db/schema.js'
import { serveStatic } from '@hono/node-server/serve-static'
import { uploadFile, deleteFile } from './services/storage.js'

interface AppJWTPayload {
  id: number;
  email: string;
  role: string;
  exp: number;
}

import path from 'path'

const app = new Hono()

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_change_me'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'your_google_client_id.apps.googleusercontent.com'

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

app.use('*', cors())
app.use('/uploads/*', serveStatic({ 
  root: './',
  rewriteRequestPath: (p) => p.replace(/^\//, '')
}))

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

app.put('/api/auth/profile', authMiddleware, async (c) => {
  try {
    const payload = c.get('jwtPayload') as unknown as AppJWTPayload
    const userId = payload.id

    const { name, email, avatar, password, currentPassword } = await c.req.json()

    // 1. Fetch user
    const userResult = await db.select().from(users).where(eq(users.id, userId))
    const user = userResult[0]
    if (!user) {
      return c.json({ error: 'Хэрэглэгч олдсонгүй' }, 404)
    }

    const updateFields: any = { updatedAt: new Date() }

    // 2. Handle profile fields
    if (name) updateFields.name = name
    
    if (email && email !== user.email) {
      // Check if email already taken
      const existingEmail = await db.select().from(users).where(eq(users.email, email))
      if (existingEmail.length > 0) {
        return c.json({ error: 'Энэ имэйл хаяг өөр хэрэглэгч дээр бүртгэлтэй байна' }, 400)
      }
      updateFields.email = email
    }

    if (avatar !== undefined) {
      updateFields.avatar = avatar
    }

    // 3. Handle password change
    if (password) {
      if (!currentPassword) {
        return c.json({ error: 'Одоогийн нууц үгийг оруулна уу' }, 400)
      }
      if (user.password) {
        const passwordMatches = await bcrypt.compare(currentPassword, user.password)
        if (!passwordMatches) {
          return c.json({ error: 'Одоогийн нууц үг буруу байна' }, 400)
        }
      }
      const hashedPassword = await bcrypt.hash(password, 10)
      updateFields.password = hashedPassword
    }

    // 4. Update DB
    const updatedUsers = await db.update(users)
      .set(updateFields)
      .where(eq(users.id, userId))
      .returning()
    
    const updatedUser = updatedUsers[0]

    // 5. Generate a new token so that context synchronizes
    const token = await sign({ 
      id: updatedUser.id, 
      email: updatedUser.email, 
      role: updatedUser.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
    }, JWT_SECRET, 'HS256')

    return c.json({
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        avatar: updatedUser.avatar
      },
      token
    })
  } catch (error: any) {
    return c.json({ error: 'Профайл шинэчлэхэд алдаа гарлаа: ' + error.message }, 500)
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
      conditions.push(
        or(
          ilike(manhwas.title, `%${q}%`),
          ilike(manhwas.alternativeTitles, `%${q}%`)
        )
      );
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
        },
        characters: true,
        staff: {
          with: {
            staff: true
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
      tags: manga.tags.map(t => t.tag),
      characters: manga.characters || [],
      staff: manga.staff?.map(s => ({
        ...s.staff,
        role: s.role
      })) || []
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

// Helper to resolve category names or IDs and return their resolved IDs
async function resolveCategories(items: (string | number)[]): Promise<number[]> {
  const ids: number[] = []
  for (const item of items) {
    if (typeof item === 'number') {
      ids.push(item)
      continue
    }
    if (typeof item === 'string' && !isNaN(Number(item))) {
      ids.push(Number(item))
      continue
    }
    const name = String(item).trim()
    if (!name) continue
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    
    // Find category by exact name
    let cat = await db.query.categories.findFirst({
      where: eq(categories.name, name)
    })
    
    if (!cat) {
      // Find category by slug
      cat = await db.query.categories.findFirst({
        where: eq(categories.slug, slug)
      })
    }
    
    if (!cat) {
      // Create new category
      const inserted = await db.insert(categories).values({ name, slug }).returning()
      cat = inserted[0]
    }
    
    if (cat) {
      ids.push(cat.id)
    }
  }
  return ids
}

// Helper to resolve tag names or IDs and return their resolved IDs
async function resolveTags(items: (string | number)[]): Promise<number[]> {
  const ids: number[] = []
  for (const item of items) {
    if (typeof item === 'number') {
      ids.push(item)
      continue
    }
    if (typeof item === 'string' && !isNaN(Number(item))) {
      ids.push(Number(item))
      continue
    }
    const name = String(item).trim()
    if (!name) continue
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    
    // Find tag by exact name
    let tagRecord = await db.query.tags.findFirst({
      where: eq(tags.name, name)
    })
    
    if (!tagRecord) {
      // Find tag by slug
      tagRecord = await db.query.tags.findFirst({
        where: eq(tags.slug, slug)
      })
    }
    
    if (!tagRecord) {
      // Create new tag
      const inserted = await db.insert(tags).values({ name, slug }).returning()
      tagRecord = inserted[0]
    }
    
    if (tagRecord) {
      ids.push(tagRecord.id)
    }
  }
  return ids
}

// Manage Manhwas
app.post('/api/admin/manhwas', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const data = await c.req.json()
    // Remove relations and id if present
    const { 
      categories: categoryItems, 
      tags: tagItems, 
      characters: characterItems,
      staff: staffItems,
      id, 
      createdAt, 
      updatedAt, 
      ...insertData 
    } = data
    const newManhwa = await db.insert(manhwas).values(insertData).returning()
    const manhwaId = newManhwa[0].id

    // Insert category links if provided (can be mix of IDs and string names)
    if (categoryItems && Array.isArray(categoryItems)) {
      const categoryIds = await resolveCategories(categoryItems)
      const catLinks = categoryIds.map((catId: number) => ({ manhwaId, categoryId: catId }))
      if (catLinks.length > 0) {
        await db.insert(manhwasToCategories).values(catLinks)
      }
    }

    // Insert tag links if provided (can be mix of IDs and string names)
    if (tagItems && Array.isArray(tagItems)) {
      const tagIds = await resolveTags(tagItems)
      const tagLinks = tagIds.map((tId: number) => ({ manhwaId, tagId: tId }))
      if (tagLinks.length > 0) {
        await db.insert(manhwasToTags).values(tagLinks)
      }
    }

    // Insert characters if provided
    if (characterItems && Array.isArray(characterItems)) {
      const charValues = characterItems.map((char: any) => ({
        manhwaId,
        name: char.name,
        image: char.image || '',
        role: char.role || 'MAIN',
        anilistId: char.anilistId || null,
      }))
      if (charValues.length > 0) {
        await db.insert(characters).values(charValues)
      }
    }

    // Insert/Resolve staff and link them
    if (staffItems && Array.isArray(staffItems)) {
      for (const item of staffItems) {
        let staffRecord = null
        if (item.anilistId) {
          staffRecord = await db.query.staff.findFirst({
            where: eq(staff.anilistId, item.anilistId)
          })
        }
        if (!staffRecord) {
          staffRecord = await db.query.staff.findFirst({
            where: eq(staff.name, item.name)
          })
        }
        if (!staffRecord) {
          const inserted = await db.insert(staff).values({
            name: item.name,
            image: item.image || '',
            description: item.description || '',
            anilistId: item.anilistId || null
          }).returning()
          staffRecord = inserted[0]
        }
        
        // Link staff to manhwa
        await db.insert(manhwasToStaff).values({
          manhwaId,
          staffId: staffRecord.id,
          role: item.role || 'Story'
        })
      }
    }

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
    const { 
      categories: categoryItems, 
      tags: tagItems, 
      characters: characterItems,
      staff: staffItems,
      id: _, 
      createdAt, 
      updatedAt, 
      ...updateData 
    } = data
    
    const updated = await db.update(manhwas)
      .set({
        ...updateData,
        updatedAt: new Date()
      })
      .where(eq(manhwas.id, id))
      .returning()

    // Sync categories (resolve mix of string names/ids)
    if (categoryItems && Array.isArray(categoryItems)) {
      await db.delete(manhwasToCategories).where(eq(manhwasToCategories.manhwaId, id))
      const categoryIds = await resolveCategories(categoryItems)
      const catLinks = categoryIds.map((catId: number) => ({ manhwaId: id, categoryId: catId }))
      if (catLinks.length > 0) {
        await db.insert(manhwasToCategories).values(catLinks)
      }
    }

    // Sync tags (resolve mix of string names/ids)
    if (tagItems && Array.isArray(tagItems)) {
      await db.delete(manhwasToTags).where(eq(manhwasToTags.manhwaId, id))
      const tagIds = await resolveTags(tagItems)
      const tagLinks = tagIds.map((tId: number) => ({ manhwaId: id, tagId: tId }))
      if (tagLinks.length > 0) {
        await db.insert(manhwasToTags).values(tagLinks)
      }
    }

    // Sync characters (re-insert all)
    if (characterItems && Array.isArray(characterItems)) {
      await db.delete(characters).where(eq(characters.manhwaId, id))
      const charValues = characterItems.map((char: any) => ({
        manhwaId: id,
        name: char.name,
        image: char.image || '',
        role: char.role || 'MAIN',
        anilistId: char.anilistId || null,
      }))
      if (charValues.length > 0) {
        await db.insert(characters).values(charValues)
      }
    }

    // Sync staff (re-link all)
    if (staffItems && Array.isArray(staffItems)) {
      await db.delete(manhwasToStaff).where(eq(manhwasToStaff.manhwaId, id))
      for (const item of staffItems) {
        let staffRecord = null
        if (item.anilistId) {
          staffRecord = await db.query.staff.findFirst({
            where: eq(staff.anilistId, item.anilistId)
          })
        }
        if (!staffRecord) {
          staffRecord = await db.query.staff.findFirst({
            where: eq(staff.name, item.name)
          })
        }
        if (!staffRecord) {
          const inserted = await db.insert(staff).values({
            name: item.name,
            image: item.image || '',
            description: item.description || '',
            anilistId: item.anilistId || null
          }).returning()
          staffRecord = inserted[0]
        }
        
        // Link staff to manhwa
        await db.insert(manhwasToStaff).values({
          manhwaId: id,
          staffId: staffRecord.id,
          role: item.role || 'Story'
        })
      }
    }
      
    return c.json(updated[0])
  } catch (error: any) {
    return c.json({ error: 'Засахад алдаа гарлаа: ' + error.message }, 500)
  }
})

app.get('/api/staff/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) {
    return c.json({ error: 'Буруу ID байна' }, 400)
  }

  try {
    const staffMember = await db.query.staff.findFirst({
      where: eq(staff.id, id),
      with: {
        manhwas: {
          with: {
            manhwa: true
          }
        }
      }
    })

    if (!staffMember) {
      return c.json({ error: 'Ажилтан олдсонгүй' }, 404)
    }

    // Format works
    const formattedStaff = {
      ...staffMember,
      works: staffMember.manhwas?.map(w => ({
        ...w.manhwa,
        role: w.role
      })) || []
    }

    return c.json(formattedStaff)
  } catch (error: any) {
    return c.json({ error: 'Ажилтны мэдээлэл татахад алдаа гарлаа: ' + error.message }, 500)
  }
})

app.delete('/api/admin/manhwas/:id', checkRole(['admin']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    if (isNaN(id)) {
      return c.json({ error: 'Буруу ID байна' }, 400)
    }

    // 1. Fetch manhwa to prune cover image
    const manhwaToDelete = await db.select().from(manhwas).where(eq(manhwas.id, id))
    if (manhwaToDelete[0]?.coverImage) {
      await deleteFile(manhwaToDelete[0].coverImage)
    }

    // 2. Fetch and prune all chapters' page files
    const chaptersToDelete = await db.select().from(chapters).where(eq(chapters.manhwaId, id))
    for (const chapter of chaptersToDelete) {
      try {
        const pages = JSON.parse(chapter.content || '[]') as string[]
        for (const pageUrl of pages) {
          await deleteFile(pageUrl)
        }
      } catch (err) {
        console.error('Failed to parse pages for deletion on manhwa delete:', err)
      }
    }

    // 3. Manually clean up all dependent reference tables first
    await db.delete(manhwasToCategories).where(eq(manhwasToCategories.manhwaId, id))
    await db.delete(manhwasToTags).where(eq(manhwasToTags.manhwaId, id))
    await db.delete(readingHistory).where(eq(readingHistory.manhwaId, id))
    await db.delete(bookmarks).where(eq(bookmarks.manhwaId, id))
    await db.delete(chapters).where(eq(chapters.manhwaId, id))

    // 4. Safely delete the manhwa (characters & staff link will cascade automatically from schema onDelete rules)
    await db.delete(manhwas).where(eq(manhwas.id, id))

    return c.json({ success: true })
  } catch (error: any) {
    console.error('Delete Manhwa Error:', error)
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
      createdAt: users.createdAt,
      bookmarksCount: sql<number>`count(distinct ${bookmarks.id})`.mapWith(Number),
      historyCount: sql<number>`count(distinct ${readingHistory.id})`.mapWith(Number),
    })
    .from(users)
    .leftJoin(bookmarks, eq(bookmarks.userId, users.id))
    .leftJoin(readingHistory, eq(readingHistory.userId, users.id))
    .groupBy(users.id);

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

    // Compare and prune deleted pages from storage
    const existingChapter = await db.select().from(chapters).where(eq(chapters.id, id))
    if (existingChapter[0]) {
      try {
        const oldPages = JSON.parse(existingChapter[0].content || '[]') as string[]
        const newPages = JSON.parse(data.content || '[]') as string[]
        const pagesToDelete = oldPages.filter(p => !newPages.includes(p))
        for (const pageUrl of pagesToDelete) {
          await deleteFile(pageUrl)
        }
      } catch (err) {
        console.error('Failed to parse pages for deletion on update:', err)
      }
    }
    
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

      // Delete associated page files from storage
      try {
        const pages = JSON.parse(chapterToDelete[0].content || '[]') as string[]
        for (const pageUrl of pages) {
          await deleteFile(pageUrl)
        }
      } catch (err) {
        console.error('Failed to parse pages for deletion on delete:', err)
      }

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

// Upload Route
app.post('/api/admin/upload', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const body = await c.req.parseBody()
    const file = body['file'] as File
    const folder = body['folder'] as string || 'general'
    const storageType = body['storage_type'] as string || undefined

    if (!file) {
      return c.json({ error: 'Файл олдсонгүй' }, 400)
    }

    const url = await uploadFile(file, folder, storageType)
    return c.json({ url })
  } catch (error: any) {
    console.error('Upload Error:', error)
    return c.json({ error: 'Файл хуулахад алдаа гарлаа: ' + error.message }, 500)
  }
})

// Helper to perform fetch requests with optional HTTP/HTTPS proxy support
async function fetchWithProxy(url: string, init?: RequestInit): Promise<Response> {
  let dispatcher: any = undefined;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ANILIST_PROXY;
  if (proxyUrl) {
    try {
      const { ProxyAgent } = await import('undici');
      dispatcher = new ProxyAgent(proxyUrl);
    } catch (err) {
      console.error('[Proxy] Failed to initialize ProxyAgent from undici:', err);
    }
  }
  
  // Create safe headers object and set standard browser User-Agent to bypass Cloudflare bot protection (403 errors)
  const headers = new Headers(init?.headers);
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  }
  
  const options = {
    ...init,
    headers,
    ...(dispatcher ? { dispatcher } : {})
  };
  return fetch(url, options as any);
}

// Upload from URL Route
app.post('/api/admin/upload-url', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const { url, folder = 'covers', storage_type } = await c.req.json()
    if (!url) {
      return c.json({ error: 'URL шаардлагатай' }, 400)
    }

    console.log(`[Storage] Downloading image from URL: ${url}`)
    const response = await fetchWithProxy(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const parsedUrl = new URL(url)
    const filename = path.basename(parsedUrl.pathname) || 'cover.jpg'
    
    const blob = new Blob([arrayBuffer], { type: contentType })
    ;(blob as any).name = filename

    const uploadedUrl = await uploadFile(blob, folder, storage_type)
    console.log(`[Storage] Successfully uploaded cover from URL to: ${uploadedUrl}`)
    return c.json({ url: uploadedUrl })
  } catch (error: any) {
    console.error('Upload URL Error:', error)
    return c.json({ error: 'Зургийн URL-аас хуулахад алдаа гарлаа: ' + error.message }, 500)
  }
})

// AniList Search Proxy Route
app.post('/api/admin/anilist-search', checkRole(['admin', 'moderator']), async (c) => {
  try {
    const { query, variables } = await c.req.json()
    
    console.log(`[AniList Proxy] Forwarding query to AniList GraphQL API...`)
    const response = await fetchWithProxy('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query, variables })
    })

    if (!response.ok) {
      let errorMsg = `AniList responded with status ${response.status}`
      try {
        const errJson = await response.json()
        if (errJson && errJson.errors && Array.isArray(errJson.errors) && errJson.errors[0]?.message) {
          errorMsg = errJson.errors[0].message
        }
      } catch (e) {
        // If parsing JSON fails, try fallback to read response text
        console.error(`[AniList Proxy Error] Failed to parse JSON error:`, e)
      }
      console.error(`[AniList Proxy Error] Response status ${response.status}: ${errorMsg}`)
      return c.json({ error: errorMsg }, response.status as any)
    }

    const data = await response.json()
    return c.json(data)
  } catch (error: any) {
    console.error('[AniList Proxy Error]:', error)
    return c.json({ error: 'Error connecting to AniList service: ' + error.message }, 500)
  }
})

// Comments Endpoints
app.get('/api/comments', async (c) => {
  try {
    const manhwaIdStr = c.req.query('manhwaId');
    const chapterIdStr = c.req.query('chapterId');
    
    if (!manhwaIdStr) {
      return c.json({ error: 'Манхва ID шаардлагатай' }, 400);
    }
    
    const manhwaId = parseInt(manhwaIdStr);
    const chapterId = chapterIdStr ? parseInt(chapterIdStr) : null;
    
    let conditions = [eq(comments.manhwaId, manhwaId)];
    if (chapterId) {
      conditions.push(eq(comments.chapterId, chapterId));
    } else {
      conditions.push(sql`${comments.chapterId} IS NULL`);
    }
    
    // Only fetch top-level comments first
    conditions.push(sql`${comments.parentId} IS NULL`);
    
    const result = await db.query.comments.findMany({
      where: and(...conditions),
      orderBy: desc(comments.createdAt),
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatar: true,
          }
        },
        replies: {
          with: {
            user: {
              columns: {
                id: true,
                name: true,
                email: true,
                role: true,
                avatar: true,
              }
            }
          },
          orderBy: asc(comments.createdAt)
        }
      }
    });
    
    return c.json(result);
  } catch (error: any) {
    console.error('Fetch comments error:', error);
    return c.json({ error: 'Сэтгэгдэл татахад алдаа гарлаа: ' + error.message }, 500);
  }
});

app.post('/api/comments', authMiddleware, async (c) => {
  try {
    const { manhwaId, chapterId, parentId, content } = await c.req.json();
    const payload = c.get('jwtPayload') as unknown as AppJWTPayload;
    const userId = payload.id;
    
    if (!manhwaId || !content || content.trim() === '') {
      return c.json({ error: 'Мэдээлэл дутуу байна' }, 400);
    }
    
    const inserted = await db.insert(comments).values({
      manhwaId: parseInt(manhwaId),
      chapterId: chapterId ? parseInt(chapterId) : null,
      userId,
      parentId: parentId ? parseInt(parentId) : null,
      content,
    }).returning();
    
    const commentId = inserted[0].id;
    const fullComment = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatar: true,
          }
        },
        replies: {
          with: {
            user: {
              columns: {
                id: true,
                name: true,
                email: true,
                role: true,
                avatar: true,
              }
            }
          }
        }
      }
    });
    
    return c.json(fullComment);
  } catch (error: any) {
    return c.json({ error: 'Сэтгэгдэл үүсгэхэд алдаа гарлаа: ' + error.message }, 500);
  }
});

app.put('/api/comments/:id', authMiddleware, async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { content } = await c.req.json();
    const payload = c.get('jwtPayload') as unknown as AppJWTPayload;
    const userId = payload.id;
    
    if (!content || content.trim() === '') {
      return c.json({ error: 'Агуулга хоосон байж болохгүй' }, 400);
    }
    
    const existing = await db.select().from(comments).where(eq(comments.id, id));
    if (existing.length === 0) {
      return c.json({ error: 'Сэтгэгдэл олдсонгүй' }, 404);
    }
    
    if (existing[0].userId !== userId && payload.role !== 'admin' && payload.role !== 'moderator') {
      return c.json({ error: 'Хандах эрхгүй байна' }, 403);
    }
    
    const updated = await db.update(comments)
      .set({
        content,
        isEdited: 1,
        updatedAt: new Date()
      })
      .where(eq(comments.id, id))
      .returning();
      
    return c.json(updated[0]);
  } catch (error: any) {
    return c.json({ error: 'Сэтгэгдэл засахад алдаа гарлаа: ' + error.message }, 500);
  }
});

app.delete('/api/comments/:id', authMiddleware, async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const payload = c.get('jwtPayload') as unknown as AppJWTPayload;
    const userId = payload.id;
    
    const existing = await db.select().from(comments).where(eq(comments.id, id));
    if (existing.length === 0) {
      return c.json({ error: 'Сэтгэгдэл олдсонгүй' }, 404);
    }
    
    if (existing[0].userId !== userId && payload.role !== 'admin' && payload.role !== 'moderator') {
      return c.json({ error: 'Хандах эрхгүй байна' }, 403);
    }
    
    await db.delete(comments).where(eq(comments.id, id));
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: 'Сэтгэгдэл устгахад алдаа гарлаа: ' + error.message }, 500);
  }
});

app.post('/api/comments/:id/like', authMiddleware, async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { type } = await c.req.json();
    const payload = c.get('jwtPayload') as unknown as AppJWTPayload;
    const userId = payload.id;
    
    if (!['like', 'dislike', 'unlike'].includes(type)) {
      return c.json({ error: 'Буруу үйлдэл байна' }, 400);
    }
    
    const comment = await db.select().from(comments).where(eq(comments.id, id));
    if (comment.length === 0) {
      return c.json({ error: 'Сэтгэгдэл олдсонгүй' }, 404);
    }
    
    const existing = await db.select()
      .from(commentLikes)
      .where(and(eq(commentLikes.commentId, id), eq(commentLikes.userId, userId)));
      
    if (existing.length > 0) {
      const prevType = existing[0].type;
      
      if (type === 'unlike' || prevType === type) {
        await db.delete(commentLikes).where(eq(commentLikes.id, existing[0].id));
        const valToSub = prevType === 'like' ? { likes: Math.max(0, comment[0].likes - 1) } : { dislikes: Math.max(0, comment[0].dislikes - 1) };
        await db.update(comments).set(valToSub).where(eq(comments.id, id));
      } else {
        await db.update(commentLikes).set({ type }).where(eq(commentLikes.id, existing[0].id));
        const newLikes = type === 'like' ? comment[0].likes + 1 : Math.max(0, comment[0].likes - 1);
        const newDislikes = type === 'dislike' ? comment[0].dislikes + 1 : Math.max(0, comment[0].dislikes - 1);
        await db.update(comments).set({ likes: newLikes, dislikes: newDislikes }).where(eq(comments.id, id));
      }
    } else if (type !== 'unlike') {
      await db.insert(commentLikes).values({
        commentId: id,
        userId,
        type,
      });
      const valToAdd = type === 'like' ? { likes: comment[0].likes + 1 } : { dislikes: comment[0].dislikes + 1 };
      await db.update(comments).set(valToAdd).where(eq(comments.id, id));
    }
    
    const updatedComment = await db.select().from(comments).where(eq(comments.id, id));
    return c.json(updatedComment[0]);
  } catch (error: any) {
    return c.json({ error: 'Үйлдэл гүйцэтгэхэд алдаа гарлаа: ' + error.message }, 500);
  }
});

app.post('/api/comments/:id/report', authMiddleware, async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const existing = await db.select().from(comments).where(eq(comments.id, id));
    if (existing.length === 0) {
      return c.json({ error: 'Сэтгэгдэл олдсонгүй' }, 404);
    }
    
    await db.update(comments).set({ isReported: 1 }).where(eq(comments.id, id));
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: 'Мэдээлэхэд алдаа гарлаа: ' + error.message }, 500);
  }
});

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001

serve({
  fetch: app.fetch,
  port
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})

