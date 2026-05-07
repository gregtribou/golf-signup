let currentData = null;

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

// --- Load & render ---

async function loadSignups() {
  const res = await fetch('/api/signups');
  currentData = await res.json();
  render(currentData);
}

function render(data) {
  const { playDates, signups } = data;

  // Header subtitle
  document.getElementById('weekLabel').textContent = playDates.map(formatDateMed).join('  ·  ');

  // Show/hide "Either Day" option — only relevant when 2+ days
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

  renderSummary(data);
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
            <button class="remove-btn" title="Remove" onclick="removePlayer('${escHtml(p.name)}')">✕</button>
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
      <button class="remove-btn" title="Remove" onclick="removePlayer('${escHtml(p.name)}')">✕</button>
    </li>`).join('');
}

function renderSummary(data) {
  const { playDates, signups } = data;
  let text = '';
  for (const iso of playDates) {
    const players = signups.filter(s => s.days && s.days[iso]);
    text += `${formatDayName(iso).toUpperCase()} ${formatDateShort(iso)} — ${players.length} player${players.length !== 1 ? 's' : ''}\n`;
    text += players.length ? players.map(p => `  • ${p.name}`).join('\n') : '  (none)';
    text += '\n\n';
  }
  const both = playDates.length >= 2
    ? signups.filter(s => playDates.every(iso => s.days && s.days[iso]))
    : [];
  if (both.length) {
    text += `Playing all days:\n${both.map(p => `  • ${p.name}`).join('\n')}\n\n`;
  }
  const either = signups.filter(s => s.either);
  if (either.length) {
    text += `Either day (commish assigns):\n${either.map(p => `  • ${p.name}`).join('\n')}\n\n`;
  }
  const fillers = signups.filter(s => s.filler);
  if (fillers.length) {
    text += `Placeholders:\n${fillers.map(p => `  • ${p.name}`).join('\n')}`;
  }
  document.getElementById('summaryBox').textContent = text.trim();
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

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
  if (opening) populateDateInputs(currentData?.playDates || []);
});

// --- Date management ---

function populateDateInputs(playDates) {
  const container = document.getElementById('dateInputList');
  container.innerHTML = playDates.map((iso, i) => makeDateRow(iso, playDates.length)).join('');
  updateRemoveButtons();
}

function makeDateRow(value = '') {
  return `
    <div class="date-input-row">
      <input type="date" class="date-input" value="${value}" />
      <button class="btn-remove-date" onclick="removeDateRow(this)" title="Remove">✕</button>
    </div>`;
}

function updateRemoveButtons() {
  const rows = document.querySelectorAll('.date-input-row');
  rows.forEach(row => {
    row.querySelector('.btn-remove-date').style.visibility = rows.length > 1 ? 'visible' : 'hidden';
  });
}

window.removeDateRow = function(btn) {
  const rows = document.querySelectorAll('.date-input-row');
  if (rows.length <= 1) return;
  btn.closest('.date-input-row').remove();
  updateRemoveButtons();
};

document.getElementById('addDateBtn').addEventListener('click', () => {
  const container = document.getElementById('dateInputList');
  const rows = container.querySelectorAll('.date-input-row');
  if (rows.length >= 4) return;
  container.insertAdjacentHTML('beforeend', makeDateRow());
  updateRemoveButtons();
});

document.getElementById('setDatesBtn').addEventListener('click', async () => {
  const inputs = document.querySelectorAll('.date-input');
  const dates = [...inputs].map(i => i.value).filter(Boolean);
  if (!dates.length) { showFeedback('Enter at least one date.', 'error', 'dateFeedback'); return; }
  if (!confirm('Updating dates will clear all current signups. Continue?')) return;
  const res = await fetch('/api/setdates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dates })
  });
  const result = await res.json();
  if (result.success) {
    showFeedback('✓ Dates updated!', 'success', 'dateFeedback');
    await loadSignups();
    populateDateInputs(currentData.playDates);
  } else {
    showFeedback(result.error || 'Something went wrong.', 'error', 'dateFeedback');
  }
});

// --- Reset ---

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Clear all signups for a new week? Play dates will be kept.')) return;
  await fetch('/api/reset', { method: 'POST' });
  await loadSignups();
});

loadSignups();
