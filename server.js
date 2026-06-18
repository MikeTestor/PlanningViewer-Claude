const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const XLSX     = require('xlsx');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');

// ── Storage mode ──────────────────────────────────────────────────────────────
// Use MongoDB when users.json does not exist AND MONGODB_URI is set.
// Otherwise fall back to the local users.json file.
const USE_MONGO = !!process.env.MONGODB_URI;
let db; // MongoDB db handle (only used in Mongo mode)

async function getUsers() {
  if (USE_MONGO) return db.collection('users').find({}).toArray();
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

async function findUser(username) {
  if (USE_MONGO) return db.collection('users').findOne({ username });
  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  return users.find(u => u.username === username) || null;
}

async function addUser(username, hashedPassword) {
  if (USE_MONGO) {
    await db.collection('users').insertOne({ username, password: hashedPassword });
  } else {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    users.push({ username, password: hashedPassword });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
}

async function ensureDefaultAdmin() {
  const existing = await findUser('admin');
  if (!existing) {
    const hash = bcrypt.hashSync('admin123', 10);
    await addUser('admin', hash);
    console.log('  ⚠️  Created default user: admin / admin123');
  }
}

// ── Initialise storage, then start the server ─────────────────────────────────
async function init() {
  if (USE_MONGO) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('planningviewer');
    console.log('Connected to MongoDB');
    await ensureDefaultAdmin();
  } else {
    // File mode: create users.json with default admin if it doesn't exist
    if (!fs.existsSync(USERS_FILE)) {
      const hash = bcrypt.hashSync('admin123', 10);
      fs.writeFileSync(USERS_FILE, JSON.stringify([{ username: 'admin', password: hash }], null, 2));
      console.log('  ⚠️  Created default user: admin / admin123');
    }
  }

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(express.urlencoded({ extended: false }));
  app.use(session({
    secret : process.env.SESSION_SECRET || 'planning-viewer-change-this-secret',
    resave : false,
    saveUninitialized: false,
    cookie : { maxAge: 8 * 60 * 60 * 1000 },
  }));

  // ── Week date-range helper ──────────────────────────────────────────────────
  function isoWeekDateRange(week, year) {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const jan4 = new Date(year, 0, 4);
    const mon1 = new Date(jan4);
    mon1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const monday = new Date(mon1);
    monday.setDate(mon1.getDate() + (week - 1) * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const s = monday.getDate(), sm = MONTHS[monday.getMonth()];
    const e = sunday.getDate(),  em = MONTHS[sunday.getMonth()];
    return monday.getMonth() === sunday.getMonth()
      ? `${s} - ${e} ${em}`
      : `${s} ${sm} - ${e} ${em}`;
  }

  // ── Auth middleware ─────────────────────────────────────────────────────────
  function requireAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
  }

  // ── Public routes ───────────────────────────────────────────────────────────
  app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
  });

  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await findUser(username);
    if (user && bcrypt.compareSync(password, user.password)) {
      req.session.user = username;
      res.redirect('/');
    } else {
      res.redirect('/login?error=1');
    }
  });

  app.post('/signup', async (req, res) => {
    const { username, password, confirm } = req.body;

    if (!username || !password || !confirm)
      return res.redirect('/login?signup_error=empty');

    if (password !== confirm)
      return res.redirect('/login?signup_error=mismatch');

    const existing = await findUser(username);
    if (existing) return res.redirect('/login?signup_error=taken');

    await addUser(username, bcrypt.hashSync(password, 10));
    res.redirect('/login?registered=1');
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  // ── Protected routes ────────────────────────────────────────────────────────
  app.use(requireAuth);
  app.use(express.static(__dirname));

  app.get('/api/me', (req, res) => {
    res.json({ username: req.session.user });
  });

  app.get('/api/planning', (req, res) => {
    try {
      const wb = XLSX.readFile(path.join(__dirname, 'report.xls'));
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const company   = String(raw[0][0]);
      const title     = String(raw[2][0]);
      const dateRange = String(raw[3][0]);

      const weekHeaders = [];
      const weekRanges  = [];
      const headerRow   = raw[6];
      for (let c = 2; c < headerRow.length - 3; c += 3) {
        if (headerRow[c]) {
          const cell = String(headerRow[c]);
          weekHeaders.push(cell.replace(/\s*\d{4}/, '').trim());
          const m = cell.match(/(\d+)\s+(\d{4})/);
          weekRanges.push(m ? isoWeekDateRange(+m[1], +m[2]) : '');
        }
      }
      weekHeaders.push(String(headerRow[14]));
      weekRanges.push('');

      const employees = [];
      let currentEmployee = null;

      for (let r = 8; r < raw.length - 1; r++) {
        const row  = raw[r];
        const col0 = String(row[0]).trim();
        const col1 = String(row[1]).trim();

        if (col0.startsWith('Total - ') || col0 === 'Total') continue;

        if (col0 && !col1) {
          currentEmployee = { name: col0, projects: [] };
          employees.push(currentEmployee);
        } else if (col1 && currentEmployee) {
          if (col0 && col0 !== currentEmployee.name) {
            currentEmployee = { name: col0, projects: [] };
            employees.push(currentEmployee);
          }
          const weeks = [];
          for (let w = 0; w < 4; w++) {
            const b = 2 + w * 3;
            weeks.push({ allocated: row[b] === '' ? null : Number(row[b]) });
          }
          currentEmployee.projects.push({
            label: col1,
            weeks,
            total: { allocated: row[14] === '' ? null : Number(row[14]) },
          });
        }
      }

      const employeeTotals = {};
      for (let r = 8; r < raw.length; r++) {
        const row  = raw[r];
        const col0 = String(row[0]).trim();
        if (col0.startsWith('Total - ')) {
          const name  = col0.replace('Total - ', '');
          const weeks = [];
          for (let w = 0; w < 4; w++) {
            const b = 2 + w * 3;
            weeks.push({ allocated: Number(row[b]) || 0 });
          }
          employeeTotals[name] = {
            weeks,
            total: { allocated: Number(row[14]) || 0 },
          };
        }
      }

      const tr = raw[raw.length - 1];
      const grandTotal = { weeks: [], total: null };
      for (let w = 0; w < 4; w++) {
        grandTotal.weeks.push({ allocated: Number(tr[2 + w * 3]) });
      }
      grandTotal.total = { allocated: Number(tr[14]) };

      res.json({ company, title, dateRange, weekHeaders, weekRanges, employees, employeeTotals, grandTotal });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Planning Viewer running at http://0.0.0.0:${PORT}`);
    console.log(`Storage mode: ${USE_MONGO ? 'MongoDB' : 'users.json'}`);
  });
}

init().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
