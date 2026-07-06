let currentData = null;
let activeTab = 'signup';
let scoresPollInterval = null;
let chatPollInterval = null;
let selectedScoreDate = null;
let selectedCommishDate = null;

// --- Date helpers ---

function parseDateLocal(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDayName(iso) {
  return parseDateLocal(iso).toLocaleDateString('en-US', { weekday: 'long' });
}

function formatDateShort(iso) {
  return parseDateLocal(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateMed(iso) {
  return parseDateLocal(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}


// --- Tab switching ---

function switchTab(tab) {
  activeTab = tab;
  document.getElementById('viewSignup').classList.toggle('hidden', tab !== 'signup');
  document.getElementById('viewScores').classList.toggle('hidden', tab !== 'scores');
  document.getElementById('tabSignup').classList.toggle('active', tab === 'signup');
  document.getElementById('tabScores').classList.toggle('active', tab === 'scores');

  clearInterval(scoresPollInterval);
  clearInterval(chatPollInterval);
  scoresPollInterval = null;
  chatPollInterval = null;
  if (tab === 'scores') {
    renderScoreDayToggle(currentData?.gameDates || []);
    loadScores();
    loadMessages();
    scoresPollInterval = setInterval(loadScores, 10000);
    chatPollInterval = setInterval(loadMessages, 10000);
  }
}

// --- Day toggle helpers ---

function renderScoreDayToggle(playDates) {
  const bar = document.getElementById('scoreDayToggle');
  if (playDates.length <= 1) {
    bar.classList.add('hidden');
    if (playDates.length === 1 && selectedScoreDate !== playDates[0]) {
      selectedScoreDate = playDates[0];
    }
    return;
  }
  if (!selectedScoreDate || !playDates.includes(selectedScoreDate)) {
    selectedScoreDate = playDates[0];
  }
  bar.classList.remove('hidden');
  bar.innerHTML = playDates.map(iso => `
    <button class="day-toggle-btn${iso === selectedScoreDate ? ' active' : ''}"
            onclick="selectScoreDay('${iso}')">${formatDateMed(iso)}</button>
  `).join('');
}

function renderCommishDayToggle(playDates) {
  const section = document.getElementById('commishDaySection');
  const bar = document.getElementById('commishDayToggle');
  if (playDates.length <= 1) {
    section.classList.add('hidden');
    if (playDates.length === 1 && selectedCommishDate !== playDates[0]) {
      selectedCommishDate = playDates[0];
    }
    return;
  }
  if (!selectedCommishDate || !playDates.includes(selectedCommishDate)) {
    selectedCommishDate = playDates[0];
  }
  section.classList.remove('hidden');
  bar.innerHTML = playDates.map(iso => `
    <button class="day-toggle-btn${iso === selectedCommishDate ? ' active' : ''}"
            onclick="selectCommishDay('${iso}')">${formatDateMed(iso)}</button>
  `).join('');
}

window.selectScoreDay = function(iso) {
  selectedScoreDate = iso;
  renderScoreDayToggle(currentData?.gameDates || []);
  loadScores();
  loadMessages();
};

window.selectCommishDay = function(iso) {
  selectedCommishDate = iso;
  renderCommishDayToggle(currentData?.gameDates || []);
  loadCommishScores();
};

function loadCommishScores() {
  if (!selectedCommishDate) return;
  fetch(`/api/scores?date=${encodeURIComponent(selectedCommishDate)}`)
    .then(r => r.json())
    .then(d => {
      populateTeamInputs(d.teams || []);
      populateCtp(d.ctp || { active: false, hole: 13 });
    });
}

// --- Load & render signups ---

async function loadSignups() {
  const res = await fetch('/api/signups');
  currentData = await res.json();
  // Init selected dates from gameDates if not set
  const gameDates = (currentData.gameDates?.length ? currentData.gameDates : currentData.playDates) || [];
  if (gameDates.length > 0) {
    if (!selectedScoreDate || !gameDates.includes(selectedScoreDate)) {
      selectedScoreDate = gameDates[0];
    }
    if (!selectedCommishDate || !gameDates.includes(selectedCommishDate)) {
      selectedCommishDate = gameDates[0];
    }
  }
  render(currentData);
}

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function updateLiveBadge(playDates) {
  const gameDates = currentData?.gameDates || playDates;
  const isLive = gameDates.includes(todayISO());
  document.getElementById('liveBadge').classList.toggle('hidden', !isLive);
}

function render(data) {
  const { playDates, signups } = data;

  document.getElementById('weekLabel').textContent = playDates.map(formatDateMed).join('  ·  ');
  updateLiveBadge(playDates);

  const multiDay = playDates.length >= 2;
  document.getElementById('eitherToggle').style.display = multiDay ? 'block' : 'none';
  document.getElementById('eitherCard').style.display  = multiDay ? 'block' : 'none';

  renderDayToggles(playDates);
  renderDayRosters(playDates, signups);

  const eitherPlayers = signups.filter(s => s.either);
  const fillerPlayers = signups.filter(s => s.filler);
  renderList('eitherList', eitherPlayers);
  renderList('fillerList', fillerPlayers);
  document.getElementById('eitherCount').textContent = eitherPlayers.length;
  document.getElementById('fillerCount').textContent = fillerPlayers.length;
}

function renderDayToggles(playDates) {
  const container = document.getElementById('dayToggles');
  container.innerHTML = playDates.map(iso => `
    <label class="day-toggle">
      <input type="checkbox" id="check-${iso}" />
      <div class="toggle-box">
        <span class="day-name">${formatDayName(iso)}</span>
        <span class="day-date">${formatDateShort(iso)}</span>
      </div>
    </label>
  `).join('');
}

function renderDayRosters(playDates, signups) {
  const container = document.getElementById('dayRosters');
  container.innerHTML = playDates.map(iso => {
    const players = signups.filter(s => s.days && s.days[iso]);
    const rows = players.length
      ? players.map(p => `
          <li>
            <span>${escHtml(p.name)}</span>
            <button class="remove-btn" title="Remove" onclick="removePlayer(${JSON.stringify(p.name)})">✕</button>
          </li>`).join('')
      : '<li class="empty-state">No one yet — be the first!</li>';
    return `
      <section class="card roster-card">
        <div class="roster-header">
          <span class="roster-icon">🏌️</span>
          <div>
            <h2>${formatDayName(iso)}</h2>
            <p class="roster-date">${formatDateShort(iso)}</p>
          </div>
          <span class="count-badge">${players.length}</span>
        </div>
        <ul class="player-list">${rows}</ul>
      </section>`;
  }).join('');
}

function renderList(listId, players) {
  const ul = document.getElementById(listId);
  if (players.length === 0) {
    ul.innerHTML = '<li class="empty-state">No one yet</li>';
    return;
  }
  ul.innerHTML = players.map(p => `
    <li>
      <span>${escHtml(p.name)}</span>
      <button class="remove-btn" title="Remove" onclick="removePlayer(${JSON.stringify(p.name)})">✕</button>
    </li>`).join('');
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Pre-fill checkboxes when a known name is entered
document.getElementById('nameInput').addEventListener('change', () => {
  const name = document.getElementById('nameInput').value.trim().toLowerCase();
  const existing = (currentData?.signups || []).find(s => s.name.toLowerCase() === name);
  if (!existing) return;
  const playDates = currentData?.playDates || [];
  playDates.forEach(iso => {
    const cb = document.getElementById(`check-${iso}`);
    if (cb) cb.checked = !!existing.days?.[iso];
  });
  document.getElementById('eitherCheck').checked = !!existing.either;
  document.getElementById('fillerCheck').checked = !!existing.filler;
});

// --- Signup submit ---

document.getElementById('submitBtn').addEventListener('click', async () => {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) { showFeedback('Please enter your name.', 'error'); return; }

  const playDates = currentData?.playDates || [];
  const days = {};
  playDates.forEach(iso => {
    const cb = document.getElementById(`check-${iso}`);
    if (cb) days[iso] = cb.checked;
  });
  const either = document.getElementById('eitherCheck').checked;
  const filler = document.getElementById('fillerCheck').checked;

  if (!Object.values(days).some(Boolean) && !either && !filler) {
    showFeedback('Pick at least one option!', 'error');
    return;
  }

  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, days, either, filler })
  });
  const result = await res.json();

  if (result.success) {
    const parts = [
      ...playDates.filter(iso => days[iso]).map(formatDayName),
      either && 'Either Day',
      filler && 'Placeholder'
    ].filter(Boolean).join(' & ');
    showFeedback(`✓ ${name} signed up: ${parts}!`, 'success');
    document.getElementById('nameInput').value = '';
    playDates.forEach(iso => {
      const cb = document.getElementById(`check-${iso}`);
      if (cb) cb.checked = false;
    });
    document.getElementById('eitherCheck').checked = false;
    document.getElementById('fillerCheck').checked = false;
    await loadSignups();
  } else {
    showFeedback(result.error || 'Something went wrong.', 'error');
  }
});

async function removePlayer(name) {
  if (!confirm(`Remove ${name} from the list?`)) return;
  await fetch(`/api/signup/${encodeURIComponent(name)}`, { method: 'DELETE' });
  await loadSignups();
}

function showFeedback(msg, type, elId = 'feedback') {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = `feedback ${type}`;
  setTimeout(() => { el.textContent = ''; el.className = 'feedback'; }, 4000);
}

// --- Commish toggle ---

document.getElementById('commishToggle').addEventListener('click', () => {
  const body = document.getElementById('commishBody');
  const chevron = document.getElementById('chevron');
  const opening = body.classList.contains('hidden');
  body.classList.toggle('hidden');
  chevron.classList.toggle('open');
  if (opening) {
    const playDates = currentData?.playDates || [];
    const gameDates = currentData?.gameDates || playDates;
    populateDateInputs(playDates);
    populateGameDateInputs(gameDates);
    renderCommishDayToggle(gameDates);
    loadCommishScores();
  }
});

// --- Date management ---

function populateDateInputs(playDates) {
  const container = document.getElementById('dateInputList');
  container.innerHTML = playDates.map(iso => makeDateRow(iso)).join('');
  updateRemoveButtons(container);
}

function makeDateRow(value = '') {
  return `
    <div class="date-input-row">
      <input type="date" class="date-input" value="${value}" />
      <button class="btn-remove-date" onclick="removeDateRow(this)" title="Remove">✕</button>
    </div>`;
}

function updateRemoveButtons(container) {
  const rows = container.querySelectorAll('.date-input-row');
  rows.forEach(row => {
    row.querySelector('.btn-remove-date').style.visibility = rows.length > 1 ? 'visible' : 'hidden';
  });
}

window.removeDateRow = function(btn) {
  const container = btn.closest('.date-input-row').parentElement;
  const rows = container.querySelectorAll('.date-input-row');
  if (rows.length <= 1) return;
  btn.closest('.date-input-row').remove();
  updateRemoveButtons(container);
};

document.getElementById('addDateBtn').addEventListener('click', () => {
  const container = document.getElementById('dateInputList');
  const rows = container.querySelectorAll('.date-input-row');
  if (rows.length >= 4) return;
  container.insertAdjacentHTML('beforeend', makeDateRow());
  updateRemoveButtons(container);
});

document.getElementById('setDatesBtn').addEventListener('click', async () => {
  const inputs = document.querySelectorAll('#dateInputList .date-input');
  const dates = [...inputs].map(i => i.value).filter(Boolean);
  if (!dates.length) { showFeedback('Enter at least one date.', 'error', 'dateFeedback'); return; }
  const currentDates = (currentData?.playDates || []).slice().sort().join(',');
  const newDates = dates.slice().sort().join(',');
  if (currentDates !== newDates) {
    if (!confirm('WARNING: Changing play dates will delete ALL current signups. Are you sure?')) return;
  }
  const res = await fetch('/api/setdates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dates })
  });
  const result = await res.json();
  if (result.success) {
    if (currentDates === newDates) {
      showFeedback('Dates unchanged — signups preserved. Use "Reset Signups" to clear for a new week.', 'success', 'dateFeedback');
    } else {
      showFeedback('✓ Dates updated! Signups cleared for new week.', 'success', 'dateFeedback');
    }
    await loadSignups();
    populateDateInputs(currentData.playDates);
    selectedCommishDate = currentData.playDates[0];
    renderCommishDayToggle(currentData.playDates);
    loadCommishScores();
  } else {
    showFeedback(result.error || 'Something went wrong.', 'error', 'dateFeedback');
  }
});

// --- Game date management ---

function populateGameDateInputs(gameDates) {
  const container = document.getElementById('gameDateInputList');
  container.innerHTML = gameDates.map(iso => makeDateRow(iso)).join('');
  updateRemoveButtons(container);
}

document.getElementById('addGameDateBtn').addEventListener('click', () => {
  const container = document.getElementById('gameDateInputList');
  const rows = container.querySelectorAll('.date-input-row');
  if (rows.length >= 4) return;
  container.insertAdjacentHTML('beforeend', makeDateRow());
  updateRemoveButtons(container);
});

document.getElementById('setGameDatesBtn').addEventListener('click', async () => {
  const inputs = document.querySelectorAll('#gameDateInputList .date-input');
  const dates = [...inputs].map(i => i.value).filter(Boolean);
  if (!dates.length) { showFeedback('Enter at least one date.', 'error', 'gameDateFeedback'); return; }
  const res = await fetch('/api/setgamedates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dates })
  });
  const result = await res.json();
  if (result.success) {
    showFeedback('✓ Game dates updated!', 'success', 'gameDateFeedback');
    await loadSignups();
    populateGameDateInputs(currentData.gameDates);
    selectedCommishDate = currentData.gameDates[0];
    renderCommishDayToggle(currentData.gameDates);
    loadCommishScores();
  } else {
    showFeedback(result.error || 'Something went wrong.', 'error', 'gameDateFeedback');
  }
});

// --- Teams management (Commish) ---

function makeTeamRow(id = '', name = '', players = '') {
  return `
    <div class="team-input-row" data-id="${escHtml(id)}" data-name="${escHtml(name)}">
      <div class="team-input-fields">
        <input type="text" class="team-players-input date-input" placeholder="Players (e.g. Greg, Bob, Mike, John)" value="${escHtml(players)}" />
      </div>
      <button class="btn-remove-date" onclick="removeTeamRow(this)" title="Remove">✕</button>
    </div>`;
}

function populateTeamInputs(teams) {
  const container = document.getElementById('teamInputList');
  container.innerHTML = teams.length
    ? teams.map(t => makeTeamRow(t.id, t.name, t.players)).join('')
    : makeTeamRow();
}

window.removeTeamRow = function(btn) {
  const rows = document.querySelectorAll('.team-input-row');
  if (rows.length <= 1) {
    btn.closest('.team-input-row').querySelector('.team-players-input').value = '';
    return;
  }
  btn.closest('.team-input-row').remove();
};

document.getElementById('addTeamBtn').addEventListener('click', () => {
  document.getElementById('teamInputList').insertAdjacentHTML('beforeend', makeTeamRow());
});

document.getElementById('saveTeamsBtn').addEventListener('click', async () => {
  if (!selectedCommishDate) { showFeedback('No date selected.', 'error', 'teamsFeedback'); return; }
  const rows = document.querySelectorAll('.team-input-row');
  const teams = [];
  rows.forEach((row, i) => {
    const players = row.querySelector('.team-players-input').value.trim();
    const id = row.dataset.id || `team-${i + 1}`;
    const name = row.dataset.name || `Team ${i + 1}`;
    if (players) teams.push({ id, name, players });
  });
  if (!teams.length) { showFeedback('Enter at least one team.', 'error', 'teamsFeedback'); return; }
  const res = await fetch('/api/scores/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teams, date: selectedCommishDate })
  });
  const result = await res.json();
  if (result.success) {
    showFeedback('✓ Teams saved!', 'success', 'teamsFeedback');
    if (activeTab === 'scores') loadScores();
  } else {
    showFeedback(result.error || 'Something went wrong.', 'error', 'teamsFeedback');
  }
});

function populateCtp(ctp) {
  document.getElementById('ctpActiveCheck').checked = ctp.active;
  document.getElementById('ctpHoleInput').value = ctp.hole || 13;
}

document.getElementById('saveCtpBtn').addEventListener('click', async () => {
  if (!selectedCommishDate) { showFeedback('No date selected.', 'error', 'ctpFeedback'); return; }
  const active = document.getElementById('ctpActiveCheck').checked;
  const hole = parseInt(document.getElementById('ctpHoleInput').value) || 13;
  const res = await fetch('/api/ctp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active, hole, date: selectedCommishDate })
  });
  const result = await res.json();
  if (result.success) {
    showFeedback('✓ CTP updated!', 'success', 'ctpFeedback');
    if (activeTab === 'scores') loadScores();
  } else {
    showFeedback('Something went wrong.', 'error', 'ctpFeedback');
  }
});

document.getElementById('ctpLeaderSaveBtn').addEventListener('click', async () => {
  if (!selectedScoreDate) return;
  const name = document.getElementById('ctpNameInput').value.trim();
  const feet = parseInt(document.getElementById('ctpFeetInput').value) || 0;
  const inches = parseInt(document.getElementById('ctpInchInput').value) || 0;
  const distance = feet + inches / 12;
  if (!name) return;
  if (distance <= 0) { document.getElementById('ctpFeetInput').focus(); return; }
  await fetch('/api/ctp/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, distance, date: selectedScoreDate })
  });
  document.getElementById('ctpNameInput').value = '';
  document.getElementById('ctpFeetInput').value = '';
  document.getElementById('ctpInchInput').value = '';
  loadScores();
});

async function removeCtp(name) {
  if (!selectedScoreDate) return;
  await fetch('/api/ctp/entry/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, date: selectedScoreDate })
  });
  loadScores();
}

document.getElementById('resetScoresBtn').addEventListener('click', async () => {
  if (!selectedCommishDate) return;
  if (!confirm('Remove all teams and scores for this game day?')) return;
  await fetch('/api/scores/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: selectedCommishDate })
  });
  showFeedback('✓ Teams cleared!', 'success', 'teamsFeedback');
  loadCommishScores();
  if (activeTab === 'scores') loadScores();
});

// --- Reset signups ---

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Clear all signups for a new week? Play dates will be kept.')) return;
  await fetch('/api/reset', { method: 'POST' });
  await loadSignups();
});

// --- Scores tab ---

async function loadScores() {
  if (!selectedScoreDate) return;
  const res = await fetch(`/api/scores?date=${encodeURIComponent(selectedScoreDate)}`);
  const data = await res.json();
  renderTeams(data.teams || []);
  renderCtp(data.ctp || { active: false, hole: 13, entries: [] });
}

function formatFtIn(decimalFeet) {
  const ft = Math.floor(decimalFeet);
  const inches = Math.round((decimalFeet - ft) * 12);
  return inches === 0 ? `${ft}'` : `${ft}' ${inches}"`;
}

function renderCtp(ctp) {
  const card = document.getElementById('ctpCard');
  if (!ctp.active) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  document.getElementById('ctpTitle').textContent = `Closest to the Pin — Hole ${ctp.hole}`;

  const entries = (ctp.entries || []).slice().sort((a, b) => a.distance - b.distance);
  const lb = document.getElementById('ctpLeaderboard');
  if (!entries.length) {
    lb.classList.add('hidden');
    return;
  }
  lb.classList.remove('hidden');
  lb.innerHTML = entries.map((e, i) => `
    <li class="ctp-entry ${i === 0 ? 'ctp-leader' : ''}">
      <span class="ctp-rank">${i === 0 ? '🏆' : `${i + 1}.`}</span>
      <span class="ctp-name">${escHtml(e.name)}</span>
      <span class="ctp-dist">${formatFtIn(e.distance)}</span>
      <button class="remove-btn" onclick="removeCtp(${JSON.stringify(e.name)})">✕</button>
    </li>`).join('');
}

function formatScore(score, hole) {
  if (hole === 0) return '-';
  if (score === 0) return 'E';
  return score > 0 ? `+${score}` : `${score}`;
}

function renderTeams(teams) {
  const container = document.getElementById('teamCards');
  const hint = document.getElementById('scoresHint');

  if (!teams.length) {
    container.innerHTML = '';
    hint.classList.remove('hidden');
    return;
  }
  teams = [...teams].sort((a, b) => a.score - b.score);
  hint.classList.add('hidden');

  container.innerHTML = teams.map(t => {
    const notStarted = t.hole === 0;
    const scoreClass = notStarted ? 'even' : t.score < 0 ? 'under' : t.score > 0 ? 'over' : 'even';
    const holeLabel = notStarted ? '-' : t.hole >= 18 ? 'Final' : `Thru ${t.hole}`;
    return `
      <div class="team-card card">
        <div class="team-header">
          <div class="team-info">
            <h2 class="team-name">${escHtml(t.players)}</h2>
          </div>
          <span class="team-thru">${holeLabel}</span>
        </div>
        <div class="score-controls">
          <button class="score-btn" onclick="adjustScore('${escHtml(t.id)}', ${t.score}, ${t.hole}, -1, 0)">−</button>
          <span class="score-display ${scoreClass}">${formatScore(t.score, t.hole)}</span>
          <button class="score-btn" onclick="adjustScore('${escHtml(t.id)}', ${t.score}, ${t.hole}, +1, 0)">+</button>
          <div class="hole-controls">
            <button class="hole-btn" onclick="adjustScore('${escHtml(t.id)}', ${t.score}, ${t.hole}, 0, -1)">◀</button>
            <span class="hole-display">${t.hole === 0 ? '-' : 'Hole ' + t.hole}</span>
            <button class="hole-btn" onclick="adjustScore('${escHtml(t.id)}', ${t.score}, ${t.hole}, 0, +1)">▶</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function adjustScore(id, currentScore, currentHole, scoreDelta, holeDelta) {
  if (!selectedScoreDate) return;
  await fetch('/api/scores/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, score_delta: scoreDelta, hole_delta: holeDelta, date: selectedScoreDate })
  });
  loadScores();
}

// --- Chat ---

async function loadMessages() {
  if (!selectedScoreDate) return;
  const res = await fetch(`/api/messages?date=${encodeURIComponent(selectedScoreDate)}`);
  const msgs = await res.json();
  renderMessages(msgs);
}

function formatMsgTime(ts) {
  const d = new Date(ts + 'Z');
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const REACTION_EMOJIS = ['🔥', '👏', '🐦', '💀', '😂'];

function myReactionKey(date, ts, name, emoji) {
  return `react_${date}_${ts}_${name}_${emoji}`;
}

function renderReactions(m, date) {
  const counts = m.reactions || {};
  const activeChips = REACTION_EMOJIS.filter(e => (counts[e] || 0) > 0).map(emoji => {
    const count = counts[emoji];
    const reacted = !!localStorage.getItem(myReactionKey(date, m.ts, m.name, emoji));
    const active = reacted ? ' rxn-chip-on' : '';
    return `<button class="rxn-chip${active}" data-emoji="${emoji}" data-ts="${escHtml(m.ts)}" data-name="${escHtml(m.name)}">${emoji}<span class="rxn-chip-count">${count}</span></button>`;
  }).join('');
  const addBtn = `<button class="rxn-chip rxn-chip-add" data-ts="${escHtml(m.ts)}" data-name="${escHtml(m.name)}">＋</button>`;
  const picker = `<div class="rxn-picker hidden" data-ts="${escHtml(m.ts)}" data-name="${escHtml(m.name)}">${REACTION_EMOJIS.map(e => `<button class="rxn-pick-btn" data-emoji="${e}" data-ts="${escHtml(m.ts)}" data-name="${escHtml(m.name)}">${e}</button>`).join('')}</div>`;
  return `<div class="rxn-row">${activeChips}${addBtn}${picker}</div>`;
}

function renderMessages(msgs) {
  const container = document.getElementById('chatMessages');
  const hint = document.getElementById('chatHint');
  if (!msgs.length) {
    container.innerHTML = '';
    hint.classList.remove('hidden');
    return;
  }
  hint.classList.add('hidden');
  container.innerHTML = msgs.map(m => `
    <div class="chat-msg card">
      <div class="chat-msg-header">
        <span class="chat-msg-name">${escHtml(m.name)}</span>
        <div class="chat-msg-right" style="display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;gap:6px;">
          ${renderReactions(m, selectedScoreDate)}
          <span class="chat-msg-time">${formatMsgTime(m.ts)}</span>
        </div>
      </div>
      <p class="chat-msg-text">${escHtml(m.text)}</p>
    </div>`).join('');

  async function doReact(ts, name, emoji) {
    const key = myReactionKey(selectedScoreDate, ts, name, emoji);
    const alreadyReacted = !!localStorage.getItem(key);
    const action = alreadyReacted ? 'remove' : 'add';
    if (alreadyReacted) localStorage.removeItem(key); else localStorage.setItem(key, '1');
    await fetch('/api/messages/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: selectedScoreDate, ts, name, emoji, action })
    });
    loadMessages();
  }

  container.querySelectorAll('.rxn-chip:not(.rxn-chip-add)').forEach(btn => {
    btn.addEventListener('click', () => doReact(btn.dataset.ts, btn.dataset.name, btn.dataset.emoji));
  });

  container.querySelectorAll('.rxn-chip-add').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.rxn-picker').forEach(p => {
        if (p.dataset.ts !== btn.dataset.ts || p.dataset.name !== btn.dataset.name) p.classList.add('hidden');
      });
      const picker = btn.closest('.rxn-row').querySelector('.rxn-picker');
      picker.classList.toggle('hidden');
    });
  });

  container.querySelectorAll('.rxn-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.rxn-picker').classList.add('hidden');
      doReact(btn.dataset.ts, btn.dataset.name, btn.dataset.emoji);
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.rxn-picker').forEach(p => p.classList.add('hidden'));
  }, { once: true });
}

document.getElementById('chatSendBtn').addEventListener('click', sendMessage);
document.getElementById('chatTextInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
  const name = document.getElementById('chatNameInput').value.trim();
  const text = document.getElementById('chatTextInput').value.trim();
  if (!name || !text) return;
  if (!selectedScoreDate) return;
  const res = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text, date: selectedScoreDate })
  });
  const result = await res.json();
  if (result.success) {
    document.getElementById('chatTextInput').value = '';
    loadMessages();
  }
}

document.getElementById('clearChatBtn').addEventListener('click', async () => {
  if (!confirm('Clear all chat messages?')) return;
  await fetch('/api/messages/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: selectedScoreDate })
  });
  loadMessages();
});

loadSignups();
