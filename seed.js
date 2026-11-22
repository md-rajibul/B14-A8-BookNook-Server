import "dotenv/config";
import { MongoClient } from "mongodb";
const client = new MongoClient(process.env.MONGODB_URI);
const samples = [
  ["Atomic Habits", "James Clear", "Self Help", "9780735211292"],
  ["The Alchemist", "Paulo Coelho", "Fiction", "9780062315007"],
  ["Deep Work", "Cal Newport", "Productivity", "9781455586691"],
  ["Sapiens", "Yuval Noah Harari", "History", "9780062316097"],
  ["Clean Code", "Robert C. Martin", "Technology", "9780132350884"],
  ["The Psychology of Money", "Morgan Housel", "Finance", "9780857197689"],
];
try {
  await client.connect();
  const books = client.db("booknook").collection("books");
  for (const [title, author, category, isbn] of samples) {
    await books.updateOne({ title, ownerId: "seed" }, { $setOnInsert: {
      title, author, category,
      image: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
      description: `Discover ${title}, a well-known book by ${author}. Explore this title at BookNook.`,
      copies: 5, ownerId: "seed", ownerEmail: "seed@booknook.local", createdAt: new Date(), updatedAt: new Date()
    } }, { upsert: true });
  }
  console.log("Six sample books are ready.");
} catch(error) { console.error("Seeding failed:", error.message); process.exitCode = 1; }
finally { await client.close(); }
