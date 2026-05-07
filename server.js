const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'signups.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { week: getWeekLabel(), signups: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getWeekLabel() {
  const now = new Date();
  const day = now.getDay();
  const diffToSat = (6 - day + 7) % 7 || 7;
  const sat = new Date(now);
  sat.setDate(now.getDate() + diffToSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { saturdayDate: fmt(sat), sundayDate: fmt(sun), saturdayFull: sat.toISOString().split('T')[0], sundayFull: sun.toISOString().split('T')[0] };
}

// Get current signups and week info
app.get('/api/signups', (req, res) => {
  const data = loadData();
  res.json({ ...data, week: getWeekLabel() });
});

// Submit or update a signup
app.post('/api/signup', (req, res) => {
  const { name, saturday, sunday } = req.body;
  if (!name || (!saturday && !sunday)) {
    return res.status(400).json({ error: 'Name and at least one day required.' });
  }
  const data = loadData();
  const trimmedName = name.trim();
  const existing = data.signups.findIndex(s => s.name.toLowerCase() === trimmedName.toLowerCase());
  const entry = { name: trimmedName, saturday: !!saturday, sunday: !!sunday, updatedAt: new Date().toISOString() };
  if (existing >= 0) {
    data.signups[existing] = entry;
  } else {
    data.signups.push(entry);
  }
  data.signups.sort((a, b) => a.name.localeCompare(b.name));
  saveData(data);
  res.json({ success: true, entry });
});

// Remove a signup
app.delete('/api/signup/:name', (req, res) => {
  const data = loadData();
  const name = decodeURIComponent(req.params.name);
  data.signups = data.signups.filter(s => s.name.toLowerCase() !== name.toLowerCase());
  saveData(data);
  res.json({ success: true });
});

// Reset for a new week (coordinator only)
app.post('/api/reset', (req, res) => {
  const fresh = { week: getWeekLabel(), signups: [] };
  saveData(fresh);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Golf signup app running at http://localhost:${PORT}`);
});
