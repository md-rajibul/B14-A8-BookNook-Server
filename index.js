import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { auth, db, mongoClient } from "./auth.js";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";

const app = express();
const port = Number(process.env.PORT || 5000);
const clientURL = process.env.CLIENT_URL || "http://localhost:3000";

app.use(cors({ origin: clientURL, credentials: true }));

const authHandler = toNodeHandler(auth);

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/auth/")) {
    return next();
  }

  console.log("AUTH REQUEST:", req.method, req.originalUrl);
  return authHandler(req, res);
});
  
app.use(express.json({ limit: "1mb" }));

function normalizeBook(body) {
  const title = String(body.title || "").trim();
  const author = String(body.author || "").trim();
  const category = String(body.category || "").trim();
  const image = String(body.image || "").trim();
  const description = String(body.description || "").trim();
  const copies = Number(body.copies);
  if (!title || !author || !category || !description || !/^https?:\/\//i.test(image) || !Number.isInteger(copies) || copies < 0) {
    throw new Error("Please provide a title, author, category, image URL, description and valid copies.");
  }
  return { title, author, category, image, description, copies };
}
function objectId(value) {
  return ObjectId.isValid(value) && String(new ObjectId(value)) === value ? new ObjectId(value) : null;
}
function present(book) {
  if (!book) return null;
  const { _id, ...rest } = book;
  return { id: _id.toString(), ...rest };
}
function fail(res, error, status = 500) {
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: status >= 500 ? "Server error. Please try again." : String(error.message || error) });
}

async function requireToken(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Please sign in." });
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"], issuer: "booknook" });
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

app.get("/", (req, res) => res.send("BookNook Server is Running!"));
app.get("/api/health", async (req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ server: "ok", mongodb: "connected" });
  } catch (error) {
    res.status(503).json({ server: "ok", mongodb: "disconnected", error: error.message });
  }
});

// Exchange an authenticated Better Auth session for a short-lived JWT.
app.get("/api/session/token", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ error: "Please sign in." });
    const token = jwt.sign(
      { sub: session.user.id, email: session.user.email, name: session.user.name },
      process.env.JWT_SECRET,
      { expiresIn: "15m", issuer: "booknook" }
    );
    res.json({ token });
  } catch (error) { fail(res, error); }
});

app.get("/api/books", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 100);
    const category = String(req.query.category || "All");
    const filter = {};
    if (q) { const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); filter.$or = [{ title: { $regex: safe, $options: "i" } }, { author: { $regex: safe, $options: "i" } }]; }
    if (category !== "All") filter.category = category;
    const sort = req.query.sort === "copies" ? { copies: -1 } : req.query.sort === "title" ? { title: 1 } : { createdAt: -1 };
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const list = await db.collection("books").find(filter).sort(sort).limit(limit).toArray();
    res.json(list.map(present));
  } catch (error) { fail(res, error); }
});

app.get("/api/books/:id", requireToken, async (req, res) => {
  try {
    const id = objectId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid book ID." });
    const book = await db.collection("books").findOne({ _id: id });
    if (!book) return res.status(404).json({ error: "Book not found." });
    res.json(present(book));
  } catch (error) { fail(res, error); }
});

app.post("/api/books", requireToken, async (req, res) => {
  try {
    const data = normalizeBook(req.body);
    const doc = { ...data, ownerId: req.user.sub, ownerEmail: req.user.email, createdAt: new Date(), updatedAt: new Date() };
    const result = await db.collection("books").insertOne(doc);
    res.status(201).json(present({ _id: result.insertedId, ...doc }));
  } catch (error) { fail(res, error, error.message.startsWith("Please provide") ? 400 : 500); }
});

app.get("/api/my-books", requireToken, async (req, res) => {
  try {
    const list = await db.collection("books").find({ ownerId: req.user.sub }).sort({ createdAt: -1 }).toArray();
    res.json(list.map(present));
  } catch (error) { fail(res, error); }
});

app.patch("/api/books/:id", requireToken, async (req, res) => {
  try {
    const id = objectId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid book ID." });
    const current = await db.collection("books").findOne({ _id: id, ownerId: req.user.sub });
    if (!current) return res.status(404).json({ error: "Book not found or not owned by you." });
    // Copies are managed exclusively by borrow/return operations after creation.
    const data = normalizeBook({ ...req.body, copies: current.copies });
    delete data.copies;
    await db.collection("books").updateOne({ _id: id, ownerId: req.user.sub }, { $set: { ...data, updatedAt: new Date() } });
    res.json({ success: true });
  } catch (error) { fail(res, error, error.message.startsWith("Please provide") ? 400 : 500); }
});

app.delete("/api/books/:id", requireToken, async (req, res) => {
  try {
    const id = objectId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid book ID." });
    const ongoing = await db.collection("borrows").countDocuments({ bookId: id.toString(), returned: false });
    if (ongoing) return res.status(409).json({ error: "Return all borrowed copies before deleting this book." });
    const result = await db.collection("books").deleteOne({ _id: id, ownerId: req.user.sub });
    if (!result.deletedCount) return res.status(404).json({ error: "Book not found or not owned by you." });
    res.json({ success: true });
  } catch (error) { fail(res, error); }
});

app.post("/api/borrows", requireToken, async (req, res) => {
  const id = objectId(req.body.bookId);
  if (!id) return res.status(400).json({ error: "Invalid book ID." });
  try {
    const borrows = db.collection("borrows");
    const active = await borrows.findOne({ bookId: id.toString(), userId: req.user.sub, returned: false });
    if (active) return res.status(409).json({ error: "You have already borrowed this book." });
    const updated = await db.collection("books").findOneAndUpdate(
      { _id: id, copies: { $gt: 0 } }, { $inc: { copies: -1 } }, { returnDocument: "after" }
    );
    if (!updated) return res.status(409).json({ error: "No copies available." });
    try {
      await borrows.insertOne({ bookId: id.toString(), userId: req.user.sub, email: req.user.email, title: updated.title, image: updated.image, borrowedAt: new Date(), returned: false });
    } catch (error) {
      await db.collection("books").updateOne({ _id: id }, { $inc: { copies: 1 } });
      if (error.code === 11000) return res.status(409).json({ error: "You have already borrowed this book." });
      throw error;
    }
    res.status(201).json({ success: true });
  } catch (error) { fail(res, error); }
});

app.get("/api/my-borrows", requireToken, async (req, res) => {
  try {
    const list = await db.collection("borrows").find({ userId: req.user.sub }).sort({ borrowedAt: -1 }).toArray();
    res.json(list.map(present));
  } catch (error) { fail(res, error); }
});

app.patch("/api/borrows/:id/return", requireToken, async (req, res) => {
  try {
    const id = objectId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid borrow ID." });
    const borrow = await db.collection("borrows").findOneAndUpdate(
      { _id: id, userId: req.user.sub, returned: false },
      { $set: { returned: true, returnedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!borrow) return res.status(409).json({ error: "Borrow not found or already returned." });
    await db.collection("books").updateOne({ _id: new ObjectId(borrow.bookId) }, { $inc: { copies: 1 } });
    res.json({ success: true });
  } catch (error) { fail(res, error); }
});

app.use((req, res) => res.status(404).json({ error: "Route not found." }));

async function start() {
  if (!process.env.JWT_SECRET || !process.env.BETTER_AUTH_SECRET || !process.env.MONGODB_URI) {
    console.error("Missing MONGODB_URI, JWT_SECRET or BETTER_AUTH_SECRET in .env");
    process.exit(1);
  }
  app.listen(port, () => console.log(`BookNook Server is running on port ${port}`));
  try {
    await mongoClient.connect();
    await db.command({ ping: 1 });
    await db.collection("borrows").createIndex({ userId: 1, bookId: 1 }, { unique: true, partialFilterExpression: { returned: false } });
    console.log("MongoDB Connected Successfully!");
  } catch (error) {
    console.error("MongoDB Connection Failed:", error.message);
  }
}
start();
