require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose");

const app = express();
const PORT = process.env.PORT || 5000;
const DB_NAME = process.env.DB_NAME || "booknook";
const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, "");
const ORIGINS = (process.env.CLIENT_ORIGINS || CLIENT_URL)
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

const BORROW_DAYS = 7;
const CATEGORIES = ["Fiction", "Science", "History", "Kids", "Others"];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "1mb" }));

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: false, deprecationErrors: true },
});

let booksCol;
let borrowsCol;
let readyPromise;

// Lazy connect so the same file works locally and on serverless hosts (Vercel).
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await client.connect();
      const db = client.db(DB_NAME);
      booksCol = db.collection("books");
      borrowsCol = db.collection("borrows");
      await booksCol.createIndex({ createdAt: -1 });
      await booksCol.createIndex({ ownerEmail: 1 });
      await borrowsCol.createIndex({ userEmail: 1 });
      // Database-level guard: one active borrow per (book, user)
      await borrowsCol.createIndex({ bookId: 1, userEmail: 1 }, { unique: true });
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

app.use(async (req, res, next) => {
  try {
    await ready();
    next();
  } catch (err) {
    console.error("DB connection failed:", err.message);
    res.status(503).json({ message: "Database is unavailable right now. Please try again shortly." });
  }
});

// ---------- JWT verification (tokens issued by BetterAuth jwt plugin) ----------
let jwks;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${CLIENT_URL}/api/auth/jwks`));
  return jwks;
}

async function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Please log in to continue." });
  try {
    const { payload } = await jwtVerify(token, getJwks());
    const email = payload.email;
    if (!email) return res.status(401).json({ message: "Invalid token payload." });
    req.user = { id: payload.id || payload.sub, email, name: payload.name || "" };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Your session is invalid or expired. Please log in again." });
  }
}

const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

// ---------- Health ----------
app.get("/", (req, res) => res.json({ name: "BookNook API", status: "ok" }));

// ---------- BOOKS ----------

// 1) GET /books  (public). ?sort=latest&limit=6 for new arrivals.
//    ?mine=true returns only the logged-in user's books (JWT required).
app.get("/books", async (req, res, next) => {
  try {
    const { mine, sort, limit, category, search } = req.query;
    const query = {};

    if (mine === "true") {
      await new Promise((resolve) => verifyToken(req, res, resolve));
      if (res.headersSent) return;
      query.ownerEmail = req.user.email;
    }
    if (category && CATEGORIES.includes(category)) query.category = category;
    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { title: { $regex: safe, $options: "i" } },
        { author: { $regex: safe, $options: "i" } },
      ];
    }

    let cursor = booksCol.find(query).sort({ createdAt: -1 });
    if (sort === "oldest") cursor = booksCol.find(query).sort({ createdAt: 1 });
    const lim = parseInt(limit, 10);
    if (lim > 0) cursor = cursor.limit(Math.min(lim, 100));

    res.json(await cursor.toArray());
  } catch (err) {
    next(err);
  }
});

// 2) GET /books/:id  (JWT)
app.get("/books/:id", verifyToken, async (req, res, next) => {
  try {
    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(400).json({ message: "That book id is not valid." });
    const book = await booksCol.findOne({ _id });
    if (!book) return res.status(404).json({ message: "We could not find that book." });
    res.json(book);
  } catch (err) {
    next(err);
  }
});

// 3) POST /books  (JWT)
app.post("/books", verifyToken, async (req, res, next) => {
  try {
    const { title, author, category, image, description, totalCopies } = req.body || {};
    const copies = Number(totalCopies);

    if (!title?.trim() || !author?.trim() || !image?.trim() || !description?.trim()) {
      return res.status(400).json({ message: "Title, author, image and description are required." });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ message: "Please choose a valid category." });
    }
    if (!Number.isInteger(copies) || copies < 1 || copies > 1000) {
      return res.status(400).json({ message: "Total copies must be a whole number between 1 and 1000." });
    }

    const doc = {
      title: title.trim(),
      author: author.trim(),
      category,
      image: image.trim(),
      description: description.trim(),
      totalCopies: copies,
      copies, // currently available copies
      ownerName: req.user.name,
      ownerEmail: req.user.email,
      createdAt: new Date(),
    };
    const result = await booksCol.insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
  } catch (err) {
    next(err);
  }
});

// 4) PATCH /books/:id  (JWT, owner only)
app.patch("/books/:id", verifyToken, async (req, res, next) => {
  try {
    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(400).json({ message: "That book id is not valid." });

    const book = await booksCol.findOne({ _id });
    if (!book) return res.status(404).json({ message: "We could not find that book." });
    if (book.ownerEmail !== req.user.email) {
      return res.status(403).json({ message: "You can only edit books that you added." });
    }

    const { title, author, category, image, description, totalCopies } = req.body || {};
    const $set = {};
    if (title?.trim()) $set.title = title.trim();
    if (author?.trim()) $set.author = author.trim();
    if (image?.trim()) $set.image = image.trim();
    if (description?.trim()) $set.description = description.trim();
    if (category !== undefined) {
      if (!CATEGORIES.includes(category)) return res.status(400).json({ message: "Please choose a valid category." });
      $set.category = category;
    }
    if (totalCopies !== undefined) {
      const next = Number(totalCopies);
      if (!Number.isInteger(next) || next < 1 || next > 1000) {
        return res.status(400).json({ message: "Total copies must be a whole number between 1 and 1000." });
      }
      // Keep the available count consistent: copies currently out on loan stay out.
      const onLoan = Math.max(book.totalCopies - book.copies, 0);
      if (next < onLoan) {
        return res.status(400).json({
          message: `${onLoan} copies are currently borrowed, so total copies cannot be lower than ${onLoan}.`,
        });
      }
      $set.totalCopies = next;
      $set.copies = next - onLoan;
    }
    if (!Object.keys($set).length) return res.status(400).json({ message: "There is nothing to update." });

    $set.updatedAt = new Date();
    await booksCol.updateOne({ _id }, { $set });
    res.json(await booksCol.findOne({ _id }));
  } catch (err) {
    next(err);
  }
});

// 5) DELETE /books/:id  (JWT, owner only)
app.delete("/books/:id", verifyToken, async (req, res, next) => {
  try {
    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(400).json({ message: "That book id is not valid." });

    const book = await booksCol.findOne({ _id });
    if (!book) return res.status(404).json({ message: "We could not find that book." });
    if (book.ownerEmail !== req.user.email) {
      return res.status(403).json({ message: "You can only delete books that you added." });
    }
    await booksCol.deleteOne({ _id });
    await borrowsCol.deleteMany({ bookId: _id.toString() });
    res.json({ deleted: true, _id: _id.toString() });
  } catch (err) {
    next(err);
  }
});

// ---------- BORROWS ----------

// 6) POST /borrows  (JWT)
app.post("/borrows", verifyToken, async (req, res, next) => {
  try {
    const bookId = req.body?.bookId;
    const _id = toObjectId(bookId);
    if (!_id) return res.status(400).json({ message: "That book id is not valid." });

    const book = await booksCol.findOne({ _id });
    if (!book) return res.status(404).json({ message: "We could not find that book." });

    const already = await borrowsCol.findOne({ bookId: _id.toString(), userEmail: req.user.email });
    if (already) {
      return res.status(409).json({ message: "You have already borrowed this book. Return it before borrowing again." });
    }

    // Atomic decrement - only succeeds while copies are available.
    const dec = await booksCol.updateOne({ _id, copies: { $gt: 0 } }, { $inc: { copies: -1 } });
    if (dec.modifiedCount === 0) {
      return res.status(409).json({ message: "Sorry, no copies of this book are available right now." });
    }

    const borrowDate = new Date();
    const returnDate = new Date(borrowDate.getTime() + BORROW_DAYS * 24 * 60 * 60 * 1000);
    const doc = {
      bookId: _id.toString(),
      bookTitle: book.title,
      bookImage: book.image,
      userName: req.user.name,
      userEmail: req.user.email,
      borrowDate,
      returnDate,
    };

    try {
      const result = await borrowsCol.insertOne(doc);
      res.status(201).json({ ...doc, _id: result.insertedId });
    } catch (err) {
      // Roll the copy back if the insert fails (e.g. duplicate from a race condition).
      await booksCol.updateOne({ _id }, { $inc: { copies: 1 } });
      if (err.code === 11000) {
        return res.status(409).json({ message: "You have already borrowed this book. Return it before borrowing again." });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// 7) GET /borrows  (JWT) - borrows of the logged in user
app.get("/borrows", verifyToken, async (req, res, next) => {
  try {
    const list = await borrowsCol.find({ userEmail: req.user.email }).sort({ borrowDate: -1 }).toArray();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// 8) DELETE /borrows/:id  (JWT) - return a book
app.delete("/borrows/:id", verifyToken, async (req, res, next) => {
  try {
    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(400).json({ message: "That borrow id is not valid." });

    const borrow = await borrowsCol.findOne({ _id });
    if (!borrow) return res.status(404).json({ message: "We could not find that borrow record." });
    if (borrow.userEmail !== req.user.email) {
      return res.status(403).json({ message: "You can only return books that you borrowed." });
    }

    await borrowsCol.deleteOne({ _id });
    const bookId = toObjectId(borrow.bookId);
    if (bookId) await booksCol.updateOne({ _id: bookId }, { $inc: { copies: 1 } });
    res.json({ returned: true, _id: _id.toString() });
  } catch (err) {
    next(err);
  }
});

// ---------- Errors ----------
app.use((req, res) => res.status(404).json({ message: "Route not found." }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Something went wrong on our side. Please try again." });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`BookNook API running on port ${PORT}`));
}

module.exports = app;
