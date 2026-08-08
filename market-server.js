/**
 * Slab Market — backend
 * ----------------------
 * No eBay, no external API calls at all. This just serves the app file
 * and stores your data (profile, listings, collection, messages) as
 * simple JSON files on this computer. On one local server, there's only
 * one real user — you — but the storage model works the same way once
 * this is hosted somewhere multiple people can reach it.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const heicConvert = require('heic-convert');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname)); // serves market-app.html directly
app.use(express.json({ limit: '20mb' })); // room for a few photos per listing

const PORT = process.env.PORT || 3001;
const DATA_DIR = __dirname;

const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');
const LISTINGS_FILE = path.join(DATA_DIR, 'listings.json');
const COLLECTION_FILE = path.join(DATA_DIR, 'collection.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Couldn't read ${file}:`, e.message);
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ---------------- profile ---------------- */
app.get('/api/profile', (req, res) => {
  res.json(readJSON(PROFILE_FILE, { displayName: 'Collector', createdAt: new Date().toISOString() }));
});
app.post('/api/profile', (req, res) => {
  const current = readJSON(PROFILE_FILE, {});
  const updated = { ...current, ...req.body };
  writeJSON(PROFILE_FILE, updated);
  res.json(updated);
});

/* ---------------- listings (the Marketplace feed) ----------------
   Every listing requires comp proof (a screenshot + claimed sold price)
   at creation time. Ranking in the feed is based on how far below that
   comp a listing is priced. Since there's no automated way to verify a
   sold price without a licensed sold-comps API, the community rates
   each listing's screenshot 1-5 stars — that's the trust mechanism. */
app.get('/api/listings', (req, res) => {
  res.json(readJSON(LISTINGS_FILE, []));
});
app.post('/api/listings', (req, res) => {
  const listings = readJSON(LISTINGS_FILE, []);
  const photos = Array.isArray(req.body.photos) ? req.body.photos.slice(0, 4) : (req.body.photo ? [req.body.photo] : []);
  if (!req.body.compScreenshot || !req.body.compPrice) {
    return res.status(400).json({ error: 'Comp proof (screenshot + sold price) is required to list a card.' });
  }
  const listing = {
    id: 'listing-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    createdAt: new Date().toISOString(),
    sellerName: req.body.sellerName || 'Collector',
    sellerPaypalUsername: req.body.sellerPaypalUsername || '',
    name: req.body.name || 'Untitled card',
    sport: req.body.sport || '',
    team: req.body.team || '',
    year: req.body.year || '',
    price: Number(req.body.price) || 0,
    condition: req.body.condition || 'Raw',
    grade: req.body.grade || 'Raw',
    details: req.body.details || '',
    photos,
    photo: photos[0] || null,
    compPrice: Number(req.body.compPrice),
    compScreenshot: req.body.compScreenshot,
    ratings: [],
    status: 'active', // 'active' | 'sold'
    soldPrice: null,
    soldAt: null,
    buyerName: null,
  };
  listings.unshift(listing);
  writeJSON(LISTINGS_FILE, listings);
  res.json(listing);
});
app.post('/api/listings/:id/rate', (req, res) => {
  const listings = readJSON(LISTINGS_FILE, []);
  const listing = listings.find(l => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  const stars = Number(req.body.stars);
  if (!stars || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'stars must be 1-5' });
  }
  if (!Array.isArray(listing.ratings)) listing.ratings = [];
  listing.ratings.push({ stars, ts: new Date().toISOString() });
  writeJSON(LISTINGS_FILE, listings);
  res.json(listing);
});
app.delete('/api/listings/:id', (req, res) => {
  const listings = readJSON(LISTINGS_FILE, []);
  const next = listings.filter(l => l.id !== req.params.id);
  writeJSON(LISTINGS_FILE, next);
  res.json({ deleted: listings.length !== next.length });
});

// Seller marks their own listing as sold — this is what actually powers
// the Sellers dashboard's order history and revenue total. There's no
// in-app payment processing yet, so this is a manual record, not an
// automated transaction.
app.post('/api/listings/:id/sold', (req, res) => {
  const listings = readJSON(LISTINGS_FILE, []);
  const listing = listings.find(l => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  listing.status = 'sold';
  listing.soldPrice = req.body.soldPrice ? Number(req.body.soldPrice) : listing.price;
  listing.soldAt = new Date().toISOString();
  listing.buyerName = req.body.buyerName || null;
  writeJSON(LISTINGS_FILE, listings);
  res.json(listing);
});

/* ---------------- My Collection (cards you own, not for sale) ---------------- */
app.get('/api/collection', (req, res) => {
  res.json(readJSON(COLLECTION_FILE, []));
});
app.post('/api/collection', (req, res) => {
  const items = readJSON(COLLECTION_FILE, []);
  const photos = Array.isArray(req.body.photos) ? req.body.photos.slice(0, 4) : (req.body.photo ? [req.body.photo] : []);
  const item = {
    id: 'coll-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    createdAt: new Date().toISOString(),
    name: req.body.name || 'Untitled card',
    sport: req.body.sport || '',
    team: req.body.team || '',
    year: req.body.year || '',
    pricePaid: Number(req.body.pricePaid) || 0,
    condition: req.body.condition || 'Raw',
    grade: req.body.grade || 'Raw',
    details: req.body.details || '',
    photos,
    photo: photos[0] || null,
  };
  items.unshift(item);
  writeJSON(COLLECTION_FILE, items);
  res.json(item);
});
app.delete('/api/collection/:id', (req, res) => {
  const items = readJSON(COLLECTION_FILE, []);
  const next = items.filter(i => i.id !== req.params.id);
  writeJSON(COLLECTION_FILE, next);
  res.json({ deleted: items.length !== next.length });
});

/* ---------------- messages ---------------- */
app.get('/api/messages', (req, res) => {
  res.json(readJSON(MESSAGES_FILE, []));
});
app.post('/api/messages', (req, res) => {
  const threads = readJSON(MESSAGES_FILE, []);
  const { threadId, contactName, listingName, listingId, text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Message text is required' });
  }
  let thread = threadId
    ? threads.find(t => t.id === threadId)
    : threads.find(t => t.listingId === listingId && t.contactName === contactName);
  if (!thread) {
    thread = {
      id: 'thread-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      contactName: contactName || 'Collector',
      listingName: listingName || '',
      listingId: listingId || null,
      messages: [],
      createdAt: new Date().toISOString(),
    };
    threads.unshift(thread);
  }
  thread.messages.push({ from: 'me', text: text.trim(), ts: new Date().toISOString() });
  thread.updatedAt = new Date().toISOString();
  writeJSON(MESSAGES_FILE, threads);
  res.json(thread);
});
app.delete('/api/messages/:id', (req, res) => {
  const threads = readJSON(MESSAGES_FILE, []);
  const next = threads.filter(t => t.id !== req.params.id);
  writeJSON(MESSAGES_FILE, next);
  res.json({ deleted: threads.length !== next.length });
});

/* ---------------- HEIC/HEIF conversion ----------------
   iPhones save photos as HEIC by default, which no browser can display.
   Converting server-side with a real Node library is far more reliable
   than any browser-based decoder — no CDN dependency, no waiting on a
   script to load, and broader format support. */
app.post('/api/convert-heic', async (req, res) => {
  try {
    const { dataUrl } = req.body;
    if (!dataUrl || !dataUrl.includes(',')) {
      return res.status(400).json({ error: 'Missing image data' });
    }
    const base64 = dataUrl.split(',')[1];
    const inputBuffer = Buffer.from(base64, 'base64');
    const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.85 });
    res.json({ dataUrl: 'data:image/jpeg;base64,' + outputBuffer.toString('base64') });
  } catch (err) {
    console.error('HEIC conversion failed:', err.message);
    res.status(500).json({ error: 'This photo could not be converted: ' + err.message });
  }
});

/* ---------------- accounts / authentication ----------------
   Real accounts: username + password (hashed with bcrypt, never stored
   or returned in plain text), email, and a shipping address. Sessions
   are a random token mapped to a username, sent by the client as
   "Authorization: Bearer <token>" on requests that need to know who's
   logged in. Like everything else in this app right now, this data
   lives in a JSON file on this server — it survives restarts only if
   a persistent disk is attached (same caveat as your listings data). */

function findSession(token) {
  const sessions = readJSON(SESSIONS_FILE, {});
  return sessions[token] || null;
}
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const username = token && findSession(token);
  if (!username) return res.status(401).json({ error: 'Not logged in' });
  req.username = username;
  next();
}
function publicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

app.post('/api/auth/register', (req, res) => {
  const { username, password, email, shippingAddress } = req.body;
  if (!username || !username.trim() || !password || password.length < 6) {
    return res.status(400).json({ error: 'Username is required and password must be at least 6 characters.' });
  }
  const users = readJSON(USERS_FILE, {});
  const key = username.trim().toLowerCase();
  if (users[key]) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }
  const user = {
    username: username.trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    email: email || '',
    shippingAddress: shippingAddress || '',
    createdAt: new Date().toISOString(),
  };
  users[key] = user;
  writeJSON(USERS_FILE, users);

  const token = crypto.randomBytes(24).toString('hex');
  const sessions = readJSON(SESSIONS_FILE, {});
  sessions[token] = user.username;
  writeJSON(SESSIONS_FILE, sessions);

  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  const users = readJSON(USERS_FILE, {});
  const key = username.trim().toLowerCase();
  const user = users[key];
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  const sessions = readJSON(SESSIONS_FILE, {});
  sessions[token] = user.username;
  writeJSON(SESSIONS_FILE, sessions);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.slice(7);
  const sessions = readJSON(SESSIONS_FILE, {});
  delete sessions[token];
  writeJSON(SESSIONS_FILE, sessions);
  res.json({ loggedOut: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const users = readJSON(USERS_FILE, {});
  const user = users[req.username.toLowerCase()];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

app.put('/api/auth/me', requireAuth, (req, res) => {
  const users = readJSON(USERS_FILE, {});
  const key = req.username.toLowerCase();
  const user = users[key];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (typeof req.body.email === 'string') user.email = req.body.email;
  if (typeof req.body.shippingAddress === 'string') user.shippingAddress = req.body.shippingAddress;
  if (typeof req.body.paypalUsername === 'string') user.paypalUsername = req.body.paypalUsername.trim();
  users[key] = user;
  writeJSON(USERS_FILE, users);
  res.json({ user: publicUser(user) });
});

app.listen(PORT, () => console.log(`Slab Market server running on http://localhost:${PORT}`));
