// ── Week date-range helper ────────────────────────────────────────────────────
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

// ── Parse raw sheet data (2-D array) into structured planning object ──────────
function parseRawData(raw) {
  const company    = String(raw[0][0]);
  const title      = String(raw[2][0]);
  const dateRange  = String(raw[3][0]);

  // Week headers from row 6 (every 3rd column starting at col 2, last group is "Total")
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
  weekHeaders.push(String(headerRow[14])); // "Total"

  // Employee rows (row 8 onward, stop before grand-total)
  const employees      = [];
  const employeeTotals = {};
  let currentEmployee  = null;

  for (let r = 8; r < raw.length - 1; r++) {
    const row  = raw[r];
    const col0 = String(row[0]).trim();
    const col1 = String(row[1]).trim();

    if (col0.startsWith('Total - ')) {
      // Employee total row — store separately
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
      continue;
    }
    if (col0 === 'Total') continue;

    if (col0 && !col1) {
      // New employee header row
      currentEmployee = { name: col0, projects: [] };
      employees.push(currentEmployee);
    } else if (col1 && currentEmployee) {
      // Project row (col0 may be empty OR equal to employee name on same line)
      if (col0 && col0 !== currentEmployee.name) {
        // Inline employee+project (e.g. Frank Geerds)
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

  // Grand total (last row)
  const tr = raw[raw.length - 1];
  const grandTotal = { weeks: [], total: null };
  for (let w = 0; w < 4; w++) {
    const b = 2 + w * 3;
    grandTotal.weeks.push({ allocated: Number(tr[b]) });
  }
  grandTotal.total = { allocated: Number(tr[14]) };

  weekRanges.push(''); // "Total" has no date range
  return { company, title, dateRange, weekHeaders, weekRanges, employees, employeeTotals, grandTotal };
}

// ── Render planning data into the #app element ────────────────────────────────
function render(data, username) {
  const app = document.getElementById('app');
  const { company, title, dateRange, weekHeaders, weekRanges, employees, employeeTotals, grandTotal } = data;

  function allocCell(allocated) {
    if (allocated === null) {
      return `<td class="cell-week"><span class="no-alloc">—</span></td>`;
    }
    const val = Number.isInteger(allocated) ? allocated : Number(allocated).toFixed(1);
    return `<td class="cell-week"><span class="alloc-val">${val}h</span></td>`;
  }

  function formatProjectLabel(label) {
    const parts = label.split(' : ');
    if (parts.length === 1) {
      const m = label.match(/^(Proj-\S+)\s+(.+)$/);
      if (m) return `<span class="proj-id">${m[1]}</span><span class="proj-name">${m[2]}</span>`;
      return `<span class="proj-name">${label}</span>`;
    }
    const projMatch = parts[1] ? parts[1].match(/^(Proj-\S+)\s+(.+)$/) : null;
    const custMatch = parts[0] ? parts[0].match(/^(Cus-\S+)\s+(.+)$/) : null;
    const custName  = custMatch ? custMatch[2] : parts[0];
    const projId    = projMatch ? projMatch[1] : '';
    const projName  = projMatch ? projMatch[2] : parts[1];
    return `<span class="proj-id">${projId} &nbsp;·&nbsp; ${custName}</span><span class="proj-name">${projName}</span>`;
  }

  // thead
  let weekHeaderCells = `<th class="col-resource">Employee</th><th class="col-project">Customer · Project</th>`;
  weekHeaders.forEach((wh, i) => {
    const cls   = i < weekHeaders.length - 1 ? ' week-group' : '';
    const range = weekRanges[i] ? `<span class="week-range">${weekRanges[i]}</span>` : '';
    weekHeaderCells += `<th class="cell-week${cls}">${wh}${range}</th>`;
  });

  // tbody
  let bodyRows = '';
  employees.forEach(emp => {
    bodyRows += `<tr class="employee-row" data-employee="${emp.name}"><td class="col-resource" colspan="2">${emp.name}</td>`;
    weekHeaders.forEach(() => bodyRows += `<td></td>`);
    bodyRows += `</tr>`;

    emp.projects.forEach(proj => {
      bodyRows += `<tr class="project-row"><td class="col-resource"></td><td class="col-project">${formatProjectLabel(proj.label)}</td>`;
      proj.weeks.forEach(w => bodyRows += allocCell(w.allocated));
      bodyRows += allocCell(proj.total.allocated);
      bodyRows += `</tr>`;
    });

    const et = employeeTotals[emp.name];
    if (et) {
      bodyRows += `<tr class="employee-total-row"><td class="col-resource" colspan="2">Total — ${emp.name}</td>`;
      et.weeks.forEach(w => bodyRows += allocCell(w.allocated));
      bodyRows += allocCell(et.total.allocated);
      bodyRows += `</tr>`;
    }
  });

  bodyRows += `<tr class="grand-total-row"><td class="col-resource" colspan="2">GRAND TOTAL</td>`;
  grandTotal.weeks.forEach(w => bodyRows += allocCell(w.allocated));
  bodyRows += allocCell(grandTotal.total.allocated);
  bodyRows += `</tr>`;

  app.innerHTML = `
    <div id="header">
      <h1>${title}</h1>
      <div class="date-range">${dateRange}</div>
      <div class="user-info">
        <span class="user-name">${username || ''}</span>
        <a href="/logout" class="logout">Sign out</a>
      </div>
    </div>
    <div id="table-wrapper">
      <div class="table-outer">
        <table>
          <thead><tr class="week-headers">${weekHeaderCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`;

  // Sync table-wrapper height to header
  const headerEl = document.getElementById('header');
  document.documentElement.style.setProperty('--header-h', headerEl.offsetHeight + 'px');
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────────
function initDragDrop(username) {
  const overlay = document.getElementById('drop-overlay');
  let dragCounter = 0; // track nested dragenter/dragleave pairs

  document.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.add('visible');
  });

  document.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter === 0) overlay.classList.remove('visible');
  });

  document.addEventListener('dragover', e => e.preventDefault());

  document.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('visible');

    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.(xls|xlsx)$/i.test(file.name)) {
      alert(`"${file.name}" is not an XLS file.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb   = XLSX.read(ev.target.result, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const data = parseRawData(raw);
        render(data, username);
        if (username) {
          const match = findMatchingEmployee(username, data.employees);
          if (match) scrollToEmployee(match.name);
        }
      } catch (err) {
        alert('Could not parse file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ── Match username to an employee name ───────────────────────────────────────
function findMatchingEmployee(username, employees) {
  // Normalise: lowercase, letters only
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
  const u = norm(username);

  let best = null;
  let bestScore = 0;

  for (const emp of employees) {
    const parts     = emp.name.trim().split(/\s+/);
    const firstName = norm(parts[0] || '');
    const lastName  = norm(parts[parts.length - 1] || '');
    const fullNorm  = norm(emp.name);

    let score = 0;

    if (u === fullNorm)                                  score = 100; // exact full name
    else if (lastName.length > 2  && u.includes(lastName))  score =  70; // last name in username
    else if (firstName.length > 2 && u.includes(firstName)) score =  40; // first name in username
    else if (fullNorm.length > 2  && u.includes(fullNorm))  score =  30; // full name inside username

    if (score > bestScore) { bestScore = score; best = emp; }
  }

  return bestScore >= 40 ? best : null; // only act on reasonable confidence
}

// ── Scroll to and highlight a matched employee row ────────────────────────────
function scrollToEmployee(name) {
  const row = document.querySelector(`tr.employee-row[data-employee="${CSS.escape(name)}"]`);
  if (!row) return;

  const wrapper = document.getElementById('table-wrapper');
  // Scroll inside the table wrapper, accounting for the sticky thead height
  const thead       = document.querySelector('thead');
  const theadHeight = thead ? thead.offsetHeight : 0;
  const rowTop      = row.offsetTop - theadHeight - 8; // 8px breathing room
  wrapper.scrollTo({ top: rowTop, behavior: 'smooth' });

  // Brief highlight pulse
  row.classList.add('highlight-match');
  setTimeout(() => row.classList.remove('highlight-match'), 2000);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  // Load planning data and current user in parallel
  let data, username;
  try {
    const [planRes, meRes] = await Promise.all([
      fetch('/api/planning'),
      fetch('/api/me'),
    ]);
    if (!planRes.ok) throw new Error(`HTTP ${planRes.status}`);
    data     = await planRes.json();
    username = meRes.ok ? (await meRes.json()).username : null;
    if (data.error) throw new Error(data.error);
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div id="error"><strong>Failed to load planning data.</strong><br>${err.message}<br><br>
       Make sure the server is running: <code>node server.js</code></div>`;
    initDragDrop(username);
    return;
  }

  render(data, username);

  // Auto-scroll to the matching employee
  if (username) {
    const match = findMatchingEmployee(username, data.employees);
    if (match) scrollToEmployee(match.name);
  }

  initDragDrop(username);
})();
