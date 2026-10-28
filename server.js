
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
`);

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

app.use(express.static(path.join(__dirname, 'public')));

const requireAdmin = (req, res, next) => {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ error: 'Please sign in as admin.' });
};

const clean = (value, max = 250) =>
  String(value ?? '').trim().slice(0, max);

const phoneOk = value =>
  /^\+?[0-9\s()-]{8,20}$/.test(value);

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

  res.json({
    cars,
    payments,
    settings,
    phones: ['+91 9872347745', '+91 6080556037']
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
    `${b.pickupDate}T${b.pickupTime}:00`
  );

  if (
    Number.isNaN(pickupDateTime.getTime()) ||
    pickupDateTime < new Date()
  ) {
    return res.status(400).json({
      error: 'Pickup date and time must be in the future.'
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

  const normalized = b.phone.replace(/[\s()-]/g, '');
  let user = db.prepare(
    'SELECT id FROM users WHERE phone = ?'
  ).get(normalized);

  if (!user) {
    user = {
      id: 'NR-' + crypto.randomBytes(4).toString('hex').toUpperCase()
    };

    db.prepare(`
      INSERT INTO users(id, name, phone, created_at)
      VALUES(?, ?, ?, ?)
    `).run(user.id, b.name, normalized, new Date().toISOString());
  } else {
    db.prepare(
      'UPDATE users SET name = ? WHERE id = ?'
    ).run(b.name, user.id);
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
    SELECT b.*, u.name, u.phone
    FROM bookings b
    JOIN users u ON u.id = b.user_id
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

// DELETE CANCELLED BOOKING — ADMIN ONLY
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
    !/^https:\/\//i.test(imageUrl)
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

app.listen(port, () => {
  console.log(`NorthRide Cabs running at http://localhost:${port}`);
});
