// Optional: seed a few starter books so the home page is not empty.
// Usage: npm run seed   (set SEED_OWNER_EMAIL / SEED_OWNER_NAME in .env if you like)
require("dotenv").config();
const { MongoClient } = require("mongodb");

const books = [
  ["The Midnight Library", "Matt Haig", "Fiction", 4, "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=600&q=80", "A woman finds a library between life and death where every book lets her live a different life she might have had."],
  ["A Brief History of Time", "Stephen Hawking", "Science", 3, "https://images.unsplash.com/photo-1532012197267-da84d127e765?w=600&q=80", "A clear tour through black holes, the Big Bang and the nature of time, written for curious general readers."],
  ["Sapiens", "Yuval Noah Harari", "History", 5, "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=600&q=80", "The story of how humans came to dominate the planet, from the cognitive revolution to the modern age."],
  ["The Gruffalo", "Julia Donaldson", "Kids", 6, "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=600&q=80", "A clever mouse invents a terrible monster to scare off hungry predators, until the monster turns out to be real."],
  ["Cosmos", "Carl Sagan", "Science", 2, "https://images.unsplash.com/photo-1519682337058-a94d519337bc?w=600&q=80", "A poetic journey through the universe that explains how science shaped our view of our place in it."],
  ["Pather Panchali", "Bibhutibhushan Bandyopadhyay", "Fiction", 3, "https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=600&q=80", "A tender coming-of-age story of Apu and his family in a Bengal village, full of nature and small joys."],
  ["Guns, Germs, and Steel", "Jared Diamond", "History", 2, "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=600&q=80", "Why some societies rose to power while others did not, explained through geography, farming and disease."],
  ["Atomic Habits", "James Clear", "Others", 5, "https://images.unsplash.com/photo-1589998059171-988d887df646?w=600&q=80", "A practical guide to building good habits and breaking bad ones through tiny, consistent changes."],
];

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db(process.env.DB_NAME || "booknook").collection("books");
  const now = Date.now();
  const docs = books.map(([title, author, category, copies, image, description], i) => ({
    title, author, category, image, description,
    totalCopies: copies,
    copies,
    ownerName: process.env.SEED_OWNER_NAME || "BookNook Team",
    ownerEmail: process.env.SEED_OWNER_EMAIL || "team@booknook.dev",
    createdAt: new Date(now - (books.length - i) * 3600 * 1000),
  }));
  const res = await col.insertMany(docs);
  console.log(`Seeded ${res.insertedCount} books.`);
  await client.close();
})();
