/**
 * Slab Market / Flipit — backend, now backed by Supabase Postgres
 * ------------------------------------------------------------------
 * Every route keeps the exact same URL, method, and response shape as
 * before — the frontend (market-app.html) needs ZERO changes. All
 * that changed is where the data actually lives: a real hosted
 * Postgres database instead of JSON files that vanished every time
 * Render restarted the server.
 *
 * Required environment variables (set these on Render, and in a local
 * .env file for testing — see the setup instructions):
 *   SUPABASE_URL           - your project's URL (Settings -> API)
 *   SUPABASE_SERVICE_KEY   - your project's service_role secret key
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const heicConvert = require('heic-convert');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.static(__dirname));
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 3001;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.');
  console.error('Set these before starting the server -- see schema.sql setup instructions.');
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Small helper: Supabase calls return { data, error } -- this throws on
// error so route handlers can just try/catch instead of checking twice.
async function sb(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------------- device profile (pre-login fallback identity) ---------------- */
app.get('/api/profile', async (req, res) => {
  try {
    const rows = await sb(supabase.from('legacy_profile').select('*').eq('id', 1));
    const row = rows[0] || { display_name: 'Collector', bio: '', photo: '' };
    res.json({ displayName: row.display_name, bio: row.bio, photo: row.photo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/profile', async (req, res) => {
  try {
    const update = {};
    if (typeof req.body.displayName === 'string') update.display_name = req.body.displayName;
    if (typeof req.body.bio === 'string') update.bio = req.body.bio;
    if (typeof req.body.photo === 'string') update.photo = req.body.photo;
    const rows = await sb(supabase.from('legacy_profile').update(update).eq('id', 1).select());
    const row = rows[0];
    res.json({ displayName: row.display_name, bio: row.bio, photo: row.photo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- listings (Marketplace feed) ---------------- */
function listingOut(row) {
  return {
    id: row.id, sellerName: row.seller_name, sellerPaypalUsername: row.seller_paypal_username,
    name: row.name, sport: row.sport, team: row.team, year: row.year,
    price: Number(row.price), condition: row.condition, grade: row.grade, details: row.details,
    photos: row.photos || [], photo: row.photo,
    compPrice: Number(row.comp_price), compScreenshot: row.comp_screenshot,
    ratings: row.ratings || [], status: row.status,
    soldPrice: row.sold_price !== null ? Number(row.sold_price) : null,
    soldAt: row.sold_at, buyerName: row.buyer_name, createdAt: row.created_at,
  };
}

app.get('/api/listings', async (req, res) => {
  try {
    const rows = await sb(supabase.from('listings').select('*').order('created_at', { ascending: false }));
    res.json(rows.map(listingOut));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/listings', async (req, res) => {
  try {
    const photos = Array.isArray(req.body.photos) ? req.body.photos.slice(0, 4) : (req.body.photo ? [req.body.photo] : []);
    if (!req.body.compScreenshot || !req.body.compPrice) {
      return res.status(400).json({ error: 'Comp proof (screenshot + sold price) is required to list a card.' });
    }
    const row = {
      id: newId('listing'),
      seller_name: req.body.sellerName || 'Collector',
      seller_paypal_username: req.body.sellerPaypalUsername || '',
      name: req.body.name || 'Untitled card',
      sport: req.body.sport || '', team: req.body.team || '', year: req.body.year || '',
      price: Number(req.body.price) || 0, condition: req.body.condition || 'Raw', grade: req.body.grade || 'Raw',
      details: req.body.details || '', photos, photo: photos[0] || null,
      comp_price: Number(req.body.compPrice), comp_screenshot: req.body.compScreenshot,
      ratings: [], status: 'active',
    };
    const rows = await sb(supabase.from('listings').insert(row).select());
    res.json(listingOut(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/listings/:id/rate', async (req, res) => {
  try {
    const stars = Number(req.body.stars);
    if (!stars || stars < 1 || stars > 5) return res.status(400).json({ error: 'stars must be 1-5' });
    const existing = await sb(supabase.from('listings').select('ratings').eq('id', req.params.id));
    if (!existing[0]) return res.status(404).json({ error: 'Listing not found' });
    const ratings = [...(existing[0].ratings || []), { stars, ts: new Date().toISOString() }];
    const rows = await sb(supabase.from('listings').update({ ratings }).eq('id', req.params.id).select());
    res.json(listingOut(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/listings/:id/sold', async (req, res) => {
  try {
    const existing = await sb(supabase.from('listings').select('price').eq('id', req.params.id));
    if (!existing[0]) return res.status(404).json({ error: 'Listing not found' });
    const update = {
      status: 'sold',
      sold_price: req.body.soldPrice ? Number(req.body.soldPrice) : existing[0].price,
      sold_at: new Date().toISOString(),
      buyer_name: req.body.buyerName || null,
    };
    const rows = await sb(supabase.from('listings').update(update).eq('id', req.params.id).select());
    res.json(listingOut(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/listings/:id', async (req, res) => {
  try {
    const existing = await sb(supabase.from('listings').select('id').eq('id', req.params.id));
    await sb(supabase.from('listings').delete().eq('id', req.params.id));
    res.json({ deleted: existing.length > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- My Collection ---------------- */
function collectionOut(row) {
  return {
    id: row.id, name: row.name, sport: row.sport, team: row.team, year: row.year,
    pricePaid: Number(row.price_paid), condition: row.condition, grade: row.grade, details: row.details,
    photos: row.photos || [], photo: row.photo, createdAt: row.created_at,
  };
}
app.get('/api/collection', async (req, res) => {
  try {
    const rows = await sb(supabase.from('collection_items').select('*').order('created_at', { ascending: false }));
    res.json(rows.map(collectionOut));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/collection', async (req, res) => {
  try {
    const photos = Array.isArray(req.body.photos) ? req.body.photos.slice(0, 4) : (req.body.photo ? [req.body.photo] : []);
    const row = {
      id: newId('coll'), name: req.body.name || 'Untitled card', sport: req.body.sport || '',
      team: req.body.team || '', year: req.body.year || '', price_paid: Number(req.body.pricePaid) || 0,
      condition: req.body.condition || 'Raw', grade: req.body.grade || 'Raw', details: req.body.details || '',
      photos, photo: photos[0] || null,
    };
    const rows = await sb(supabase.from('collection_items').insert(row).select());
    res.json(collectionOut(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/collection/:id', async (req, res) => {
  try {
    const existing = await sb(supabase.from('collection_items').select('id').eq('id', req.params.id));
    await sb(supabase.from('collection_items').delete().eq('id', req.params.id));
    res.json({ deleted: existing.length > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- messages ---------------- */
function threadOut(row) {
  return {
    id: row.id, contactName: row.contact_name, listingName: row.listing_name, listingId: row.listing_id,
    messages: row.messages || [], urgent: row.urgent, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
app.get('/api/messages', async (req, res) => {
  try {
    const rows = await sb(supabase.from('message_threads').select('*').order('updated_at', { ascending: false }));
    res.json(rows.map(threadOut));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/messages', async (req, res) => {
  try {
    const { threadId, contactName, listingName, listingId, text, urgent } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message text is required' });

    let existing = null;
    if (threadId) {
      const rows = await sb(supabase.from('message_threads').select('*').eq('id', threadId));
      existing = rows[0] || null;
    } else {
      const rows = await sb(supabase.from('message_threads').select('*').eq('listing_id', listingId).eq('contact_name', contactName));
      existing = rows[0] || null;
    }

    const newMessage = { from: 'me', text: text.trim(), ts: new Date().toISOString() };

    if (existing) {
      const messages = [...(existing.messages || []), newMessage];
      const update = { messages, updated_at: new Date().toISOString() };
      if (urgent) update.urgent = true;
      const rows = await sb(supabase.from('message_threads').update(update).eq('id', existing.id).select());
      res.json(threadOut(rows[0]));
    } else {
      const row = {
        id: newId('thread'), contact_name: contactName || 'Collector', listing_name: listingName || '',
        listing_id: listingId || null, messages: [newMessage], urgent: !!urgent, updated_at: new Date().toISOString(),
      };
      const rows = await sb(supabase.from('message_threads').insert(row).select());
      res.json(threadOut(rows[0]));
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/messages/:id/seen', async (req, res) => {
  try {
    const rows = await sb(supabase.from('message_threads').update({ urgent: false }).eq('id', req.params.id).select());
    if (!rows[0]) return res.status(404).json({ error: 'Thread not found' });
    res.json(threadOut(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/messages/:id', async (req, res) => {
  try {
    const existing = await sb(supabase.from('message_threads').select('id').eq('id', req.params.id));
    await sb(supabase.from('message_threads').delete().eq('id', req.params.id));
    res.json({ deleted: existing.length > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- HEIC/HEIF conversion (unchanged) ---------------- */
app.post('/api/convert-heic', async (req, res) => {
  try {
    const { dataUrl } = req.body;
    if (!dataUrl || !dataUrl.includes(',')) return res.status(400).json({ error: 'Missing image data' });
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
   Same bcrypt + random-token session design as before -- only the
   storage moved to Supabase tables instead of JSON files. */
async function findSession(token) {
  const rows = await sb(supabase.from('sessions').select('username').eq('token', token));
  return rows[0] ? rows[0].username : null;
}
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const username = token && await findSession(token);
    if (!username) return res.status(401).json({ error: 'Not logged in' });
    req.username = username;
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
}
function publicUser(user) {
  return {
    username: user.username, email: user.email, shippingAddress: user.shipping_address,
    paypalUsername: user.paypal_username, bio: user.bio || '', photo: user.photo || '',
    createdAt: user.created_at,
  };
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email, shippingAddress } = req.body;
    if (!username || !username.trim() || !password || password.length < 6) {
      return res.status(400).json({ error: 'Username is required and password must be at least 6 characters.' });
    }
    const key = username.trim().toLowerCase();
    const existing = await sb(supabase.from('users').select('username').eq('username', key));
    if (existing.length > 0) return res.status(409).json({ error: 'That username is already taken.' });

    const row = {
      username: key, password_hash: bcrypt.hashSync(password, 10),
      email: email || '', shipping_address: shippingAddress || '',
    };
    const rows = await sb(supabase.from('users').insert(row).select());
    const user = rows[0];

    const token = crypto.randomBytes(24).toString('hex');
    await sb(supabase.from('sessions').insert({ token, username: user.username }));
    res.json({ token, user: publicUser({ ...user, username: username.trim() }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    const key = username.trim().toLowerCase();
    const rows = await sb(supabase.from('users').select('*').eq('username', key));
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    await sb(supabase.from('sessions').insert({ token, username: user.username }));
    res.json({ token, user: publicUser(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.slice(7);
    await sb(supabase.from('sessions').delete().eq('token', token));
    res.json({ loggedOut: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const rows = await sb(supabase.from('users').select('*').eq('username', req.username));
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const update = {};
    if (typeof req.body.email === 'string') update.email = req.body.email;
    if (typeof req.body.shippingAddress === 'string') update.shipping_address = req.body.shippingAddress;
    if (typeof req.body.paypalUsername === 'string') update.paypal_username = req.body.paypalUsername.trim();
    if (typeof req.body.bio === 'string') update.bio = req.body.bio;
    if (typeof req.body.photo === 'string') update.photo = req.body.photo;
    if (Object.keys(update).length === 0) {
      const rows = await sb(supabase.from('users').select('*').eq('username', req.username));
      return res.json({ user: publicUser(rows[0]) });
    }
    const rows = await sb(supabase.from('users').update(update).eq('username', req.username).select());
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- followers / following ---------------- */
app.get('/api/users/:username/followers', async (req, res) => {
  try {
    const rows = await sb(supabase.from('follows').select('follower_username, created_at').eq('followed_username', req.params.username).order('created_at', { ascending: false }));
    res.json(rows.map(r => ({ username: r.follower_username, since: r.created_at })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/users/:username/following', async (req, res) => {
  try {
    const rows = await sb(supabase.from('follows').select('followed_username, created_at').eq('follower_username', req.params.username).order('created_at', { ascending: false }));
    res.json(rows.map(r => ({ username: r.followed_username, since: r.created_at })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/follow', requireAuth, async (req, res) => {
  try {
    const target = (req.body.username || '').trim().toLowerCase();
    if (!target) return res.status(400).json({ error: 'username is required' });
    if (target === req.username) return res.status(400).json({ error: "You can't follow yourself." });
    const existingUser = await sb(supabase.from('users').select('username').eq('username', target));
    if (!existingUser[0]) return res.status(404).json({ error: 'User not found' });
    await sb(supabase.from('follows').upsert({ follower_username: req.username, followed_username: target }, { onConflict: 'follower_username,followed_username' }));
    res.json({ following: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/follow/:username', requireAuth, async (req, res) => {
  try {
    await sb(supabase.from('follows').delete().eq('follower_username', req.username).eq('followed_username', req.params.username));
    res.json({ following: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Flipit server running on http://localhost:${PORT} (Supabase-backed)`));
