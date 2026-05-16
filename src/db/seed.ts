import { db } from './index.js';
import { manhwas, categories, tags, manhwasToCategories, manhwasToTags } from './schema.js';

async function seed() {
  console.log('Seeding database...');
  
  // Clean existing data
  console.log('Cleaning existing data...');
  await db.delete(manhwasToCategories);
  await db.delete(manhwasToTags);
  await db.delete(categories);
  await db.delete(tags);
  await db.delete(manhwas);

  // Insert Categories
  console.log('Inserting categories...');
  const catData = [
    { name: 'Action', slug: 'action' },
    { name: 'Adventure', slug: 'adventure' },
    { name: 'Fantasy', slug: 'fantasy' },
    { name: 'Drama', slug: 'drama' },
    { name: 'Sports', slug: 'sports' },
    { name: 'Reincarnation', slug: 'reincarnation' },
    { name: 'Thriller', slug: 'thriller' },
  ];
  const insertedCats = await db.insert(categories).values(catData).returning();

  // Insert Tags
  console.log('Inserting tags...');
  const tagData = [
    { name: 'Overpowered', slug: 'overpowered' },
    { name: 'Magic', slug: 'magic' },
    { name: 'Level Up', slug: 'level-up' },
    { name: 'School Life', slug: 'school-life' },
    { name: 'Monsters', slug: 'monsters' },
  ];
  const insertedTags = await db.insert(tags).values(tagData).returning();

  const manhwaData = [
    {
      title: 'Solo Leveling',
      description: 'Дэлхийн хамгийн сул ан хийгч Сун Жин-Ву хамгийн хүчирхэг болох аялалдаа гарав. Тэрбээр "Системийн" нууцыг тайлж, хязгааргүй хүчийг гартаа авна.',
      coverImage: 'https://images.unsplash.com/photo-1601513235071-f50ef52d1e58?w=800&q=80',
      type: 'Manhwa',
      rating: '9.8',
      status: 'Дуусгасан',
      chapterCount: '179',
      isFeatured: 'true',
    },
    {
      title: 'Tower of God',
      description: 'Бахул нь гэрлийн эзэнтэй уулзахын тулд аварга том цамхагт гарч эхэлнэ. Цамхагийн дээд давхарт очих зам бол шинжлэн судалгаа, тулаан, болон итгэлцэл.',
      coverImage: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80',
      type: 'Manhwa',
      rating: '9.2',
      status: 'Үргэлжлэх',
      chapterCount: '550',
      isFeatured: 'true',
    },
    {
      title: 'Omniscient Reader',
      description: 'Ким Докжа найрлаж буй ном нь яг бодит байдал болж хувирна. Тэрбээр цорын ганц уншигч хэмжээнд үйл явдлуудыг мэдэж, хүн төрөлхтнийг аварна.',
      coverImage: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&q=80',
      type: 'Manhwa',
      rating: '9.5',
      status: 'Үргэлжлэх',
      chapterCount: '150',
      isFeatured: 'true',
    },
    {
      title: 'The Beginning After The End',
      description: 'Хаан Грей ер бусын хүч чадалтай нэгэн боловч ганцаардмал нэгэн байв. Тэрээр шинэ ертөнцөд дахин төрж, өнгөрсөн алдаагаа засахыг хичээнэ.',
      coverImage: 'https://images.unsplash.com/photo-1578632292335-df3abbb0d586?w=800&q=80',
      type: 'Manhwa',
      rating: '9.4',
      status: 'Үргэлжлэх',
      chapterCount: '175',
      isFeatured: 'true',
    },
    {
      title: 'Wind Breaker',
      description: 'Жа Хюн бол сургуулийн шилдэг сурагч боловч түүний жинхэнэ хүсэл тэмүүлэл бол дугуйн спорт юм. Тэрбээр өөрийн багаа бүрдүүлж тэмцээнд оролцоно.',
      coverImage: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&q=80',
      type: 'Manhwa',
      rating: '9.3',
      status: 'Үргэлжлэх',
      chapterCount: '450',
      isFeatured: 'true',
    }
  ];

  console.log('Inserting manhwas...');
  const insertedManhwas = await db.insert(manhwas).values(manhwaData).returning();

  // Link Solo Leveling (Action, Fantasy, Level Up, Monsters)
  const solo = insertedManhwas[0];
  const action = insertedCats.find(c => c.name === 'Action')!;
  const fantasy = insertedCats.find(c => c.name === 'Fantasy')!;
  const levelUp = insertedTags.find(t => t.name === 'Level Up')!;
  const monsters = insertedTags.find(t => t.name === 'Monsters')!;

  await db.insert(manhwasToCategories).values([
    { manhwaId: solo.id, categoryId: action.id },
    { manhwaId: solo.id, categoryId: fantasy.id },
  ]);

  await db.insert(manhwasToTags).values([
    { manhwaId: solo.id, tagId: levelUp.id },
    { manhwaId: solo.id, tagId: monsters.id },
  ]);

  console.log('Database seeded successfully!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
