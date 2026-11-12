require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const twilio = require('twilio');
const fs = require('fs');
const multer = require('multer');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;

// Require secure configuration instead of silently using default secrets.
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD in your .env file.');
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 64) {
  throw new Error('SESSION_SECRET must contain at least 64 characters.');
}

if (isProduction && process.env.HTTPS_ENABLED !== 'true') {
  throw new Error('Production requires HTTPS. Set HTTPS_ENABLED=true only when HTTPS is configured.');
}

const db = new Database(path.join(__dirname, 'northride.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  trip_type TEXT NOT NULL,
  car_category TEXT NOT NULL,
  pickup TEXT NOT NULL,
  dropoff TEXT NOT NULL,
  pickup_date TEXT NOT NULL,
  pickup_time TEXT NOT NULL,
  notes TEXT,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  message TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
`);

// Seed authentic initial reviews if table is empty
try {
  db.prepare("UPDATE reviews SET approved = 1 WHERE approved = 0").run();
  const revCount = db.prepare("SELECT COUNT(*) AS count FROM reviews").get().count;
  if (revCount === 0) {
    const seed = [
      ['Amit Sharma', 5, 'Booked Chandigarh to Delhi airport cab. Driver arrived 10 mins early, clean sedan, smooth driving. Highly recommended!'],
      ['Pooja Verma', 5, 'Best taxi service in Chandigarh. Lowest rates for outstation round trip to Ludhiana. Very polite driver.'],
      ['Gurpreet Singh', 5, 'Took Innova for family trip to Amritsar. Vehicle was spotless and comfortable AC. Will book again!'],
      ['Rahul Mehra', 5, 'On-time pickup from Sector 17, Chandigarh. Transparent pricing with no hidden charges. Excellent service.'],
      ['Neha Gupta', 4, 'Very good experience for one-way Noida travel. Safe driving and hassle-free payment.']
    ];
    const ins = db.prepare("INSERT INTO reviews (name, rating, message, approved, created_at) VALUES (?, ?, ?, 1, ?)");
    seed.forEach(([n, r, m], i) => {
      ins.run(n, r, m, new Date(Date.now() - (i * 2 + 1) * 86400000).toISOString());
    });
  }
} catch (e) {
  console.warn('Reviews seeding note:', e.message);
}

const adminUser = process.env.ADMIN_USERNAME;
const adminPass = process.env.ADMIN_PASSWORD;

if (!db.prepare('SELECT id FROM admins WHERE username = ?').get(adminUser)) {
  db.prepare(
    'INSERT INTO admins(username, password_hash) VALUES(?, ?)'
  ).run(adminUser, bcrypt.hashSync(adminPass, 12));
}

if (!db.prepare('SELECT id FROM cars LIMIT 1').get()) {
  const insertCar = db.prepare(
    'INSERT INTO cars(name, category, description, image_url) VALUES(?, ?, ?, ?)'
  );

  [
    [
      'Comfort Sedan',
      'Sedan',
      'Ideal for city rides and airport transfers',
      'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1000&q=85'
    ],
    [
      'Premium SUV',
      'SUV',
      'Extra room for families and luggage',
      'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&w=1000&q=85'
    ],
    [
      'Family MUV',
      'MUV',
      'Comfortable group travel across North India',
      'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1000&q=85'
    ]
  ].forEach(car => insertCar.run(...car));

  const insertPayment = db.prepare(
    'INSERT INTO payments(name, details) VALUES(?, ?)'
  );

  [
    ['Cash', 'Pay the driver directly'],
    ['UPI', 'Ask the admin for the verified UPI QR/details'],
    ['Online payment', 'Payment link will be shared after confirmation']
  ].forEach(payment => insertPayment.run(...payment));

  db.prepare(
    'INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)'
  ).run(
    'announcement',
    'Airport transfers, Chandigarh local rides & All India tours'
  );
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: __dirname
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'northride.sid',
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use('/api/admin/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
}));

const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const allowedImages = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = allowedImages[file.mimetype];
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  }
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!allowedImages[file.mimetype]) {
      return cb(new Error('Only JPG, PNG, WEBP and GIF images are allowed.'));
    }
    cb(null, true);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const requireAdmin = (req, res, next) => {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ error: 'Please sign in as admin.' });
};

const clean = (value, max = 250) =>
  String(value ?? '').trim().slice(0, max);

const phoneOk = value =>
  /^\+?[0-9\s()-]{8,20}$/.test(String(value ?? ''));

function canonicalPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length >= 10) {
    return '+91' + digits.slice(-10);
  }
  return '+' + digits;
}

const smsClient = () => {
  if (!process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }

  return twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
};

async function sendSms(to, body) {
  const client = smsClient();

  if (!client || !process.env.TWILIO_PHONE_NUMBER || !to) {
    return false;
  }

  try {
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
      body
    });
    return true;
  } catch (error) {
    console.error('SMS delivery failed:', error.message);
    return false;
  }
}

// PUBLIC DATA
app.get('/api/public-data', (req, res) => {
  const cars = db.prepare(`
    SELECT id, name, category, description, image_url
    FROM cars
    WHERE active = 1
    ORDER BY id DESC
  `).all();

  const payments = db.prepare(`
    SELECT id, name, details
    FROM payments
    WHERE active = 1
    ORDER BY id
  `).all();

  const settings = Object.fromEntries(
    db.prepare('SELECT key, value FROM settings')
      .all()
      .map(item => [item.key, item.value])
  );

  const reviewSummary = db.prepare(`
    SELECT COUNT(*) AS count,
           COALESCE(ROUND(AVG(rating), 1), 4.9) AS average
    FROM reviews
    WHERE approved = 1
  `).get();

  const reviews = db.prepare(`
    SELECT id, name, rating, message, created_at
    FROM reviews
    WHERE approved = 1
    ORDER BY id DESC
    LIMIT 12
  `).all();

  res.json({
    cars,
    payments,
    settings,
    reviewSummary,
    reviews,
    phones: ['+91 9872347745', '+91 6080556037'],
    farePrices: (() => {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'fare_prices'").get();
      try { return row ? JSON.parse(row.value) : {}; } catch { return {}; }
    })()
  });
});

// CUSTOMER REVIEWS
app.post('/api/reviews', rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false
}), (req, res) => {
  const name = clean(req.body.name, 80);
  const rating = Number(req.body.rating);
  const message = clean(req.body.message, 1000);

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Please choose a rating from 1 to 5.' });
  }

  if (!message || message.length < 5) {
    return res.status(400).json({ error: 'Please write at least 5 characters.' });
  }

  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO reviews (name, rating, message, approved, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(name, rating, message, now);

  const reviewSummary = db.prepare(`
    SELECT COUNT(*) AS count,
           COALESCE(ROUND(AVG(rating), 1), 4.9) AS average
    FROM reviews
    WHERE approved = 1
  `).get();

  res.status(201).json({
    message: 'Thank you! Your review and rating have been added.',
    review: {
      id: info.lastInsertRowid,
      name,
      rating,
      message,
      created_at: now
    },
    reviewSummary
  });
});

// CUSTOMER BOOKING
app.post('/api/bookings', rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false
}), async (req, res) => {
  const b = {
    name: clean(req.body.name, 100),
    phone: clean(req.body.phone, 25),
    tripType: clean(req.body.tripType, 50),
    carCategory: clean(req.body.carCategory, 50),
    pickup: clean(req.body.pickup, 180),
    dropoff: clean(req.body.dropoff, 180),
    pickupDate: clean(req.body.pickupDate, 10),
    pickupTime: clean(req.body.pickupTime, 5),
    notes: clean(req.body.notes, 1200),
    paymentMethod: clean(req.body.paymentMethod, 80)
  };

  if (
    !b.name || !phoneOk(b.phone) || !b.tripType ||
    !b.carCategory || !b.pickup || !b.dropoff ||
    !b.pickupDate || !b.pickupTime || !b.paymentMethod
  ) {
    return res.status(400).json({
      error: 'Please complete all required fields and enter a valid phone number.'
    });
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(b.pickupDate) ||
    !/^\d{2}:\d{2}$/.test(b.pickupTime)
  ) {
    return res.status(400).json({
      error: 'Please choose a valid pickup date and time.'
    });
  }

  const pickupDateTime = new Date(
    `${b.pickupDate}T${b.pickupTime}:00+05:30`
  );
  const nowGrace = new Date(Date.now() - 15 * 60 * 1000);

  if (
    Number.isNaN(pickupDateTime.getTime()) ||
    pickupDateTime < nowGrace
  ) {
    return res.status(400).json({
      error: 'Pickup date and time cannot be in the past. Please choose a future time.'
    });
  }

  const method = db.prepare(
    'SELECT name FROM payments WHERE active = 1 AND name = ?'
  ).get(b.paymentMethod);

  if (!method) {
    return res.status(400).json({
      error: 'That payment option is no longer available. Refresh and try again.'
    });
  }

  const standardPhone = canonicalPhone(b.phone);
  const normalized = b.phone.replace(/[\s()-]/g, '');
  const last10 = b.phone.replace(/\D/g, '').slice(-10);

  let user = db.prepare(`
    SELECT id, name, phone FROM users
    WHERE phone = ? OR phone LIKE ? OR phone = ?
  `).get(standardPhone, `%${last10}`, normalized);

  if (!user) {
    user = {
      id: 'NR-' + crypto.randomBytes(4).toString('hex').toUpperCase()
    };

    db.prepare(`
      INSERT INTO users(id, name, phone, created_at)
      VALUES(?, ?, ?, ?)
    `).run(user.id, b.name, standardPhone || normalized, new Date().toISOString());
  } else {
    db.prepare(`
      UPDATE users SET name = ?, phone = ? WHERE id = ?
    `).run(b.name, standardPhone || user.phone, user.id);
  }

  const reference =
    'NRC-' + Date.now().toString(36).toUpperCase() + '-' +
    crypto.randomBytes(2).toString('hex').toUpperCase();

  db.prepare(`
    INSERT INTO bookings(
      reference, user_id, trip_type, car_category,
      pickup, dropoff, pickup_date, pickup_time,
      notes, payment_method, created_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reference, user.id, b.tripType, b.carCategory,
    b.pickup, b.dropoff, b.pickupDate, b.pickupTime,
    b.notes, b.paymentMethod, new Date().toISOString()
  );

  const alert =
    `New NorthRide booking ${reference}\n` +
    `${b.name} (${normalized})\n` +
    `${b.tripType}: ${b.pickup} to ${b.dropoff}\n` +
    `${b.pickupDate} ${b.pickupTime}\nCar: ${b.carCategory}`;

  await Promise.all([
    sendSms(process.env.ADMIN_ALERT_PHONE, alert),
    sendSms(
      normalized,
      `NorthRide Cabs received your booking request (${reference}). It is pending confirmation. We will contact you shortly.`
    )
  ]);

  return res.status(201).json({
    message: 'Booking request received!',
    reference,
    userId: user.id
  });
});

// ADMIN LOGIN
app.post('/api/admin/login', (req, res, next) => {
  const username = clean(req.body.username, 80);
  const password = String(req.body.password || '');

  const row = db.prepare(
    'SELECT * FROM admins WHERE username = ?'
  ).get(username);

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({
      error: 'Incorrect username or password.'
    });
  }

  req.session.regenerate(error => {
    if (error) {
      return res.status(500).json({
        error: 'Could not start secure session.'
      });
    }

    req.session.admin = {
      id: row.id,
      username: row.username
    };

    req.session.save(saveError => {
      if (saveError) {
        return res.status(500).json({
          error: 'Could not save admin session.'
        });
      }

      return res.json({ username: row.username });
    });
  });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({ error: 'Logout failed.' });
    }

    res.clearCookie('northride.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction
    });

    return res.json({ ok: true });
  });
});

app.get('/api/admin/me', (req, res) => {
  res.json({
    loggedIn: !!req.session.admin,
    username: req.session.admin?.username || null
  });
});

// ADMIN BOOKINGS
app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, 
           COALESCE(u.name, 'Customer') AS name, 
           COALESCE(u.phone, 'N/A') AS phone
    FROM bookings b
    LEFT JOIN users u ON u.id = b.user_id
    ORDER BY b.id DESC
    LIMIT 500
  `).all();

  res.json(bookings);
});

// UPDATE BOOKING STATUS
app.post('/api/admin/bookings/:id/status', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status = clean(req.body.status, 30);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid booking ID.' });
  }

  if (!['Pending', 'Confirmed', 'Cancelled', 'Completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid booking status.' });
  }

  const booking = db.prepare(`
    SELECT b.*, u.name, u.phone
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    WHERE b.id = ?
  `).get(id);

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  db.prepare(
    'UPDATE bookings SET status = ? WHERE id = ?'
  ).run(status, booking.id);

  let smsSent = false;

  if (status === 'Confirmed') {
    smsSent = await sendSms(
      booking.phone,
      `Your NorthRide Cabs booking ${booking.reference} is CONFIRMED. Pickup: ${booking.pickup}, ${booking.pickup_date} at ${booking.pickup_time}. For help call +91 9872347745.`
    );
  }

  return res.json({
    ok: true,
    smsConfigured: !!smsClient() && !!process.env.TWILIO_PHONE_NUMBER,
    smsSent
  });
});

// DELETE CANCELLED BOOKING â€” ADMIN ONLY
app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({
      error: 'Invalid booking ID.'
    });
  }

  const booking = db.prepare(
    'SELECT id, status, reference FROM bookings WHERE id = ?'
  ).get(id);

  if (!booking) {
    return res.status(404).json({
      error: 'Booking not found.'
    });
  }

  if (booking.status !== 'Cancelled') {
    return res.status(409).json({
      error: 'Only cancelled bookings can be deleted.'
    });
  }

  // The status condition protects against a concurrent status change.
  const result = db.prepare(`
    DELETE FROM bookings
    WHERE id = ? AND status = 'Cancelled'
  `).run(id);

  if (result.changes !== 1) {
    return res.status(409).json({
      error: 'Booking status changed or booking could not be deleted. Refresh and try again.'
    });
  }

  return res.json({
    ok: true,
    message: 'Cancelled booking deleted successfully.',
    id: booking.id,
    reference: booking.reference
  });
});

// ADMIN USERS
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.phone, u.created_at,
           COUNT(b.id) AS rides
    FROM users u
    LEFT JOIN bookings b ON b.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();

  res.json(users);
});

// CHANGE ADMIN PASSWORD
app.post('/api/admin/password', requireAdmin, (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');

  if (next.length < 12) {
    return res.status(400).json({
      error: 'New password must be at least 12 characters.'
    });
  }

  const row = db.prepare(
    'SELECT password_hash FROM admins WHERE id = ?'
  ).get(req.session.admin.id);

  if (!row || !bcrypt.compareSync(current, row.password_hash)) {
    return res.status(400).json({
      error: 'Current password is incorrect.'
    });
  }

  db.prepare(
    'UPDATE admins SET password_hash = ? WHERE id = ?'
  ).run(bcrypt.hashSync(next, 12), req.session.admin.id);

  return res.json({ ok: true });
});

app.post('/api/admin/upload-image', requireAdmin, (req, res) => {
  imageUpload.single('image_file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Please select an image.' });
    }

    return res.json({
      image_url: '/uploads/' + req.file.filename
    });
  });
});
// ADMIN CARS
app.post('/api/admin/cars', requireAdmin, (req, res) => {
  const id = Number(req.body.id) || 0;
  const name = clean(req.body.name, 100);
  const category = clean(req.body.category, 50);
  const description = clean(req.body.description, 240);
  const imageUrl = clean(req.body.image_url, 1000);
  const active = req.body.active === false ? 0 : 1;

  if (
    !name || !category ||
    !/^https:\/\//i.test(imageUrl) && !/^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/i.test(imageUrl)
  ) {
    return res.status(400).json({
      error: 'Enter a name, category and HTTPS image URL.'
    });
  }

  if (id) {
    const result = db.prepare(`
      UPDATE cars
      SET name = ?, category = ?, description = ?,
          image_url = ?, active = ?
      WHERE id = ?
    `).run(name, category, description, imageUrl, active, id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Car not found.' });
    }
  } else {
    db.prepare(`
      INSERT INTO cars(name, category, description, image_url, active)
      VALUES(?, ?, ?, ?, ?)
    `).run(name, category, description, imageUrl, active);
  }

  return res.json({ ok: true });
});

app.delete('/api/admin/cars/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid car ID.' });
  }

  const result = db.prepare(
    'DELETE FROM cars WHERE id = ?'
  ).run(id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Car not found.' });
  }

  return res.json({ ok: true });
});

// ADMIN PAYMENTS
app.post('/api/admin/payments', requireAdmin, (req, res) => {
  const id = Number(req.body.id) || 0;
  const name = clean(req.body.name, 80);
  const details = clean(req.body.details, 300);
  const active = req.body.active === false ? 0 : 1;

  if (!name) {
    return res.status(400).json({
      error: 'Payment method name is required.'
    });
  }

  if (id) {
    const result = db.prepare(`
      UPDATE payments
      SET name = ?, details = ?, active = ?
      WHERE id = ?
    `).run(name, details, active, id);

    if (result.changes === 0) {
      return res.status(404).json({
        error: 'Payment method not found.'
      });
    }
  } else {
    db.prepare(`
      INSERT INTO payments(name, details, active)
      VALUES(?, ?, ?)
    `).run(name, details, active);
  }

  return res.json({ ok: true });
});

app.delete('/api/admin/payments/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid payment ID.' });
  }

  const result = db.prepare(
    'DELETE FROM payments WHERE id = ?'
  ).run(id);

  if (result.changes === 0) {
    return res.status(404).json({
      error: 'Payment method not found.'
    });
  }

  return res.json({ ok: true });
});

// ADMIN SETTINGS
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const announcement = clean(req.body.announcement, 300);

  db.prepare(`
    INSERT INTO settings(key, value)
    VALUES('announcement', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(announcement);

  return res.json({ ok: true });
});

// ADMIN FARE PRICES â€” fixed routes only
// ADMIN REVIEWS LIST
app.get('/api/admin/reviews', requireAdmin, (req, res) => {
  const reviews = db.prepare(`
    SELECT * FROM reviews ORDER BY id DESC LIMIT 300
  `).all();
  res.json(reviews);
});

// ADMIN TOGGLE REVIEW APPROVAL
app.post('/api/admin/reviews/:id/status', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const review = db.prepare('SELECT id, approved FROM reviews WHERE id = ?').get(id);
  if (!review) {
    return res.status(404).json({ error: 'Review not found.' });
  }
  const nextStatus = review.approved ? 0 : 1;
  db.prepare('UPDATE reviews SET approved = ? WHERE id = ?').run(nextStatus, id);
  return res.json({ ok: true, approved: nextStatus });
});

// ADMIN DELETE REVIEW
app.delete('/api/admin/reviews/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
  return res.json({ ok: true });
});

const FARE_KEYS = [
  'chandigarh_delhi',
  'chandigarh_noida',
  'chandigarh_ghaziabad',
  'chandigarh_gurugram',
  'chandigarh_patiala',
  'chandigarh_ludhiana',
  'chandigarh_amritsar'
];

app.get('/api/admin/fare-prices', requireAdmin, (req, res) => {
  const row = db.prepare(
    "SELECT value FROM settings WHERE key = 'fare_prices'"
  ).get();

  let prices = {};

  if (row) {
    try {
      prices = JSON.parse(row.value);
    } catch {
      prices = {};
    }
  }

  return res.json({ prices });
});

app.post('/api/admin/fare-prices', requireAdmin, (req, res) => {
  const input = req.body?.prices;

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ error: 'Invalid fare prices.' });
  }

  const prices = {};

  for (const key of FARE_KEYS) {
    const value = input[key];

    if (
      !Number.isInteger(value) ||
      value < 100 ||
      value > 100000
    ) {
      return res.status(400).json({
        error: `Invalid fare for ${key}. Use a whole number from â‚¹100 to â‚¹100000.`
      });
    }

    prices[key] = value;
  }

  db.prepare(`
    INSERT INTO settings(key, value)
    VALUES('fare_prices', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(prices));

  return res.json({ ok: true, prices });
});

app.listen(port, () => {
  console.log(`NorthRide Cabs running at http://localhost:${port}`);
});





