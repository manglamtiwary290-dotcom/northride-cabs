const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const api = async (url, options = {}) => {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const d = await r.json().catch(() => ({ error: 'Unexpected server response.' }));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
};

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

let seen = new Set(), sound = false, ctx = null;
let allBookings = [];
let allUsers = [];
let allReviews = [];

function notice(msg, error = false) {
  const el = $('#adminMsg');
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
  el.className = 'admin-notice' + (error ? ' error' : '');
  setTimeout(() => { if (el) el.hidden = true; }, 7000);
}

function loginNotice(msg) {
  const el = $('#loginMsg');
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
  el.className = 'admin-notice error';
}

const fareDefaults = {
  chandigarh_delhi: 3199,
  chandigarh_noida: 3799,
  chandigarh_ghaziabad: 3699,
  chandigarh_gurugram: 3799,
  chandigarh_patiala: 2199,
  chandigarh_ludhiana: 2199,
  chandigarh_amritsar: 3199
};

function fareMessage(message, error = false) {
  const el = $('#fareMsg');
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
  el.className = 'admin-notice' + (error ? ' error' : '');
}

async function loadFarePrices() {
  try {
    const d = await api('/api/admin/fare-prices');
    const prices = { ...fareDefaults, ...(d.prices || {}) };
    const form = $('#fareForm');
    Object.keys(fareDefaults).forEach(key => {
      if (form.elements[key]) form.elements[key].value = prices[key];
    });
    const msg = $('#fareMsg');
    if (msg) msg.hidden = true;
  } catch (e) {
    fareMessage('Could not load fares: ' + e.message, true);
  }
}

$('#fareForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const prices = {};
  Object.keys(fareDefaults).forEach(key => {
    prices[key] = Number(form.elements[key].value);
  });
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/admin/fare-prices', {
      method: 'POST',
      body: JSON.stringify({ prices })
    });
    fareMessage('Route fares saved successfully.');
  } catch (e) {
    fareMessage('Could not save fares: ' + e.message, true);
  } finally {
    button.disabled = false;
  }
});

async function check() {
  try {
    const d = await api('/api/admin/me');
    showApp(d.loggedIn);
  } catch {
    showApp(false);
  }
}

function showApp(on) {
  $('#loginPanel').hidden = on;
  $('#dashboard').hidden = !on;
  if (on) refreshAll();
}

$('#loginForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#username').value,
        password: $('#password').value
      })
    });
    $('#loginMsg').hidden = true;
    showApp(true);
  } catch (err) {
    loginNotice(err.message);
  }
});

$('#logoutBtn')?.addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  showApp(false);
});

// TAB SWITCHING
function switchTab(tabName) {
  const target = 'tab-' + tabName;
  $$('.admin-tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === tabName));
  $$('.admin-section').forEach(x => {
    const selected = x.id === target;
    x.classList.toggle('active', selected);
    x.hidden = !selected;
    x.style.display = selected ? 'block' : 'none';
  });

  if (tabName === 'bookings') loadBookings();
  if (tabName === 'users') loadUsers();
  if (tabName === 'reviews') loadReviews();
  if (tabName === 'cars') loadCars();
  if (tabName === 'payments') loadPayments();
  if (tabName === 'fares') loadFarePrices();
}

$$('.admin-tabs button').forEach(b => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

function playAlert() {
  if (!sound) return;
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!ctx) ctx = new C();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.12;
    o.start();
    o.stop(ctx.currentTime + 0.22);
    setTimeout(() => {
      const o2 = ctx.createOscillator();
      o2.connect(g);
      o2.frequency.value = 660;
      o2.start();
      o2.stop(ctx.currentTime + 0.25);
    }, 260);
  } catch {}
}

$('#soundToggle')?.addEventListener('change', e => {
  sound = e.target.checked;
  if (sound) playAlert();
});

// ----------------------------------------------------
// BOOKINGS MANAGEMENT
// ----------------------------------------------------
function renderBookings(list) {
  const container = $('#bookingTable');
  const countBadge = $('#bookingCountBadge');

  if (countBadge) {
    countBadge.textContent = `${list.length} of ${allBookings.length} booking(s)`;
  }

  if (!list.length) {
    container.innerHTML = '<p style="padding:20px;color:#627d98">No matching bookings found.</p>';
    return;
  }

  container.innerHTML = `<table>
    <thead>
      <tr>
        <th>REFERENCE &amp; DATE</th>
        <th>CUSTOMER &amp; ID</th>
        <th>JOURNEY &amp; NOTES</th>
        <th>VEHICLE &amp; PAYMENT</th>
        <th>STATUS</th>
        <th>ACTION</th>
      </tr>
    </thead>
    <tbody>
      ${list.map(b => `
        <tr>
          <td>
            <b style="color:#0f3057">${esc(b.reference)}</b><br>
            <span style="font-weight:600">${esc(b.pickup_date)} ${esc(b.pickup_time)}</span><br>
            <small style="color:#627d98">Booked: ${esc(new Date(b.created_at).toLocaleString('en-IN'))}</small>
          </td>
          <td>
            <b>${esc(b.name)}</b><br>
            <a href="tel:${esc(b.phone)}" style="color:#0f3057">${esc(b.phone)}</a><br>
            <small style="display:inline-block;margin-top:3px;padding:2px 6px;background:#e2ecf5;border-radius:4px;font-family:monospace;font-weight:600">ID: ${esc(b.user_id)}</small>
          </td>
          <td>
            <span style="display:inline-block;padding:2px 6px;background:#f0f5f9;border-radius:4px;font-size:11px;font-weight:600">${esc(b.trip_type)}</span><br>
            <b>${esc(b.pickup)}</b> &rarr; <b>${esc(b.dropoff)}</b><br>
            <small style="color:#52616b">${esc(b.notes || 'No extra notes')}</small>
          </td>
          <td>
            <b>${esc(b.car_category)}</b><br>
            <span style="font-size:12px;color:#52616b">${esc(b.payment_method)}</span>
          </td>
          <td>
            <span class="status ${esc(b.status)}">${esc(b.status)}</span>
          </td>
          <td>
            <select aria-label="Update status" data-status-id="${b.id}" style="padding:6px;border-radius:6px;border:1px solid #c9d6df;font-size:12px">
              <option value="Pending" ${b.status === 'Pending' ? 'selected' : ''}>Pending</option>
              <option value="Confirmed" ${b.status === 'Confirmed' ? 'selected' : ''}>Confirmed</option>
              <option value="Cancelled" ${b.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
              <option value="Completed" ${b.status === 'Completed' ? 'selected' : ''}>Completed</option>
            </select>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="small-btn" data-save-status="${b.id}">Save</button>
              ${b.status === 'Cancelled' ? `<button class="small-btn danger" data-delete-booking="${b.id}" title="Delete cancelled record">Delete</button>` : ''}
            </div>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;

  // Attach status save handlers
  container.querySelectorAll('[data-save-status]').forEach(btn => {
    btn.onclick = async () => {
      try {
        const id = btn.dataset.saveStatus;
        const status = $(`[data-status-id="${id}"]`).value;
        const r = await api(`/api/admin/bookings/${id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status })
        });
        notice(status === 'Confirmed'
          ? (r.smsConfigured ? 'Ride confirmed. SMS sent to customer.' : 'Ride confirmed. (SMS credentials not configured in .env).')
          : `Booking status updated to ${status}.`
        );
        loadBookings();
      } catch (e) {
        notice(e.message, true);
      }
    };
  });

  // Attach delete handlers for cancelled bookings
  container.querySelectorAll('[data-delete-booking]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Are you sure you want to permanently delete this cancelled booking?')) return;
      try {
        const id = btn.dataset.deleteBooking;
        await api(`/api/admin/bookings/${id}`, { method: 'DELETE' });
        notice('Cancelled booking deleted successfully.');
        loadBookings();
      } catch (e) {
        notice(e.message, true);
      }
    };
  });
}

function filterBookings() {
  const query = ($('#bookingSearch')?.value || '').toLowerCase().trim();
  const statusFilter = $('#bookingStatusFilter')?.value || '';

  const filtered = allBookings.filter(b => {
    const matchStatus = !statusFilter || b.status === statusFilter;
    if (!matchStatus) return false;
    if (!query) return true;

    const ref = String(b.reference || '').toLowerCase();
    const custId = String(b.user_id || '').toLowerCase();
    const name = String(b.name || '').toLowerCase();
    const phone = String(b.phone || '').toLowerCase();
    const pickup = String(b.pickup || '').toLowerCase();
    const dropoff = String(b.dropoff || '').toLowerCase();

    return ref.includes(query) || custId.includes(query) || name.includes(query) ||
           phone.includes(query) || pickup.includes(query) || dropoff.includes(query);
  });

  renderBookings(filtered);
}

$('#bookingSearch')?.addEventListener('input', filterBookings);
$('#bookingStatusFilter')?.addEventListener('change', filterBookings);
$('#refreshBookingsBtn')?.addEventListener('click', () => loadBookings());

async function loadBookings() {
  try {
    const bs = await api('/api/admin/bookings');
    allBookings = bs;

    const current = new Set(bs.map(b => b.id));
    if (seen.size) {
      const added = bs.filter(b => !seen.has(b.id));
      if (added.length) {
        playAlert();
        notice(`${added.length} new booking${added.length > 1 ? 's' : ''} received.`);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('NorthRide Cabs', { body: `${added.length} new ride request received.` });
        }
      }
    }
    seen = current;
    filterBookings();
  } catch (e) {
    notice(e.message, true);
  }
}

// ----------------------------------------------------
// CUSTOMER PROFILES & IDS
// ----------------------------------------------------
function renderUsers(list) {
  const container = $('#userTable');
  const countBadge = $('#userCountBadge');

  if (countBadge) {
    countBadge.textContent = `${list.length} of ${allUsers.length} customer(s)`;
  }

  if (!list.length) {
    container.innerHTML = '<p style="padding:20px;color:#627d98">No matching customer profiles.</p>';
    return;
  }

  container.innerHTML = `<table>
    <thead>
      <tr>
        <th>CUSTOMER ID</th>
        <th>NAME</th>
        <th>MOBILE</th>
        <th>TOTAL RIDES</th>
        <th>FIRST BOOKED</th>
        <th>ACTION</th>
      </tr>
    </thead>
    <tbody>
      ${list.map(u => `
        <tr>
          <td>
            <b style="font-family:monospace;font-size:14px;color:#0f3057;background:#eef4f8;padding:3px 8px;border-radius:4px">${esc(u.id)}</b>
          </td>
          <td><b>${esc(u.name)}</b></td>
          <td><a href="tel:${esc(u.phone)}" style="color:#0f3057;font-weight:600">${esc(u.phone)}</a></td>
          <td>
            <span style="display:inline-block;padding:2px 8px;background:${u.rides > 1 ? '#d8f36a' : '#edf0ec'};color:#102a43;border-radius:12px;font-weight:700">
              ${u.rides} ride${u.rides === 1 ? '' : 's'}
            </span>
          </td>
          <td><small style="color:#627d98">${esc(new Date(u.created_at).toLocaleDateString('en-IN'))}</small></td>
          <td>
            <button class="small-btn secondary" data-filter-customer="${esc(u.id)}">View Rides &rarr;</button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;

  container.querySelectorAll('[data-filter-customer]').forEach(btn => {
    btn.onclick = () => {
      const custId = btn.dataset.filterCustomer;
      switchTab('bookings');
      const searchBox = $('#bookingSearch');
      if (searchBox) {
        searchBox.value = custId;
        filterBookings();
      }
    };
  });
}

function filterUsers() {
  const q = ($('#userSearch')?.value || '').toLowerCase().trim();
  const filtered = allUsers.filter(u => {
    if (!q) return true;
    const id = String(u.id || '').toLowerCase();
    const name = String(u.name || '').toLowerCase();
    const phone = String(u.phone || '').toLowerCase();
    return id.includes(q) || name.includes(q) || phone.includes(q);
  });
  renderUsers(filtered);
}

$('#userSearch')?.addEventListener('input', filterUsers);
$('#refreshUsersBtn')?.addEventListener('click', () => loadUsers());

async function loadUsers() {
  try {
    const users = await api('/api/admin/users');
    allUsers = users;
    filterUsers();
  } catch (e) {
    notice(e.message, true);
  }
}

// ----------------------------------------------------
// REVIEWS & RATINGS MANAGEMENT
// ----------------------------------------------------
function renderReviews(list) {
  const container = $('#reviewTable');
  const statBadge = $('#reviewStatBadge');

  if (allReviews.length) {
    const approvedOnly = allReviews.filter(r => r.approved);
    const avg = approvedOnly.length
      ? (approvedOnly.reduce((sum, r) => sum + r.rating, 0) / approvedOnly.length).toFixed(1)
      : '5.0';
    if (statBadge) {
      statBadge.textContent = `★ ${avg} / 5 (${approvedOnly.length} active of ${allReviews.length})`;
    }
  }

  if (!list.length) {
    container.innerHTML = '<p style="padding:20px;color:#627d98">No reviews yet.</p>';
    return;
  }

  container.innerHTML = `<table>
    <thead>
      <tr>
        <th>CUSTOMER</th>
        <th>RATING</th>
        <th>REVIEW MESSAGE</th>
        <th>DATE</th>
        <th>STATUS</th>
        <th>ACTIONS</th>
      </tr>
    </thead>
    <tbody>
      ${list.map(r => `
        <tr>
          <td><b>${esc(r.name)}</b></td>
          <td>
            <span style="color:#f59e0b;font-size:16px;letter-spacing:1px">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
            <small style="color:#627d98"> (${r.rating}/5)</small>
          </td>
          <td style="max-width:320px;overflow-wrap:break-word">${esc(r.message)}</td>
          <td><small style="color:#627d98">${esc(new Date(r.created_at).toLocaleDateString('en-IN'))}</small></td>
          <td>
            <span style="display:inline-block;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;${r.approved ? 'background:#dcfce7;color:#166534' : 'background:#fee2e2;color:#991b1b'}">
              ${r.approved ? 'Approved' : 'Hidden'}
            </span>
          </td>
          <td>
            <div style="display:flex;gap:6px">
              <button class="small-btn ${r.approved ? 'secondary' : ''}" data-toggle-review="${r.id}">
                ${r.approved ? 'Hide' : 'Approve'}
              </button>
              <button class="small-btn danger" data-delete-review="${r.id}">Delete</button>
            </div>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;

  container.querySelectorAll('[data-toggle-review]').forEach(btn => {
    btn.onclick = async () => {
      try {
        const id = btn.dataset.toggleReview;
        const res = await api(`/api/admin/reviews/${id}/status`, { method: 'POST' });
        notice(`Review ${res.approved ? 'approved & visible on homepage' : 'hidden'}.`);
        loadReviews();
      } catch (e) {
        notice(e.message, true);
      }
    };
  });

  container.querySelectorAll('[data-delete-review]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Are you sure you want to permanently delete this review?')) return;
      try {
        const id = btn.dataset.deleteReview;
        await api(`/api/admin/reviews/${id}`, { method: 'DELETE' });
        notice('Review deleted.');
        loadReviews();
      } catch (e) {
        notice(e.message, true);
      }
    };
  });
}

$('#refreshReviewsBtn')?.addEventListener('click', () => loadReviews());

async function loadReviews() {
  try {
    const list = await api('/api/admin/reviews');
    allReviews = list;
    renderReviews(allReviews);
  } catch (e) {
    notice(e.message, true);
  }
}

// ----------------------------------------------------
// FLEET MANAGEMENT
// ----------------------------------------------------
async function loadCars() {
  try {
    const d = await api('/api/public-data');
    const cars = d.cars;
    $('#carList').innerHTML = cars.map(c => `
      <div class="item-row">
        <img src="${esc(c.image_url)}" alt="${esc(c.name)}" onerror="this.src='/uploads/default.jpg'">
        <div class="item-copy">
          <b>${esc(c.name)}</b>
          <small>${esc(c.category)} &bull; ${esc(c.description)}</small>
        </div>
        <button class="small-btn secondary" data-edit-car="${c.id}">Edit</button>
        <button class="small-btn danger" data-delete-car="${c.id}">Delete</button>
      </div>
    `).join('') + '<p style="font-size:11px;color:#879398;margin-top:10px">Active vehicles appear on the customer booking page.</p>';

    $$('[data-edit-car]').forEach(b => {
      b.onclick = () => {
        const c = cars.find(x => x.id === Number(b.dataset.editCar));
        const f = $('#carForm');
        f.elements.id.value = c.id;
        f.elements.name.value = c.name;
        f.elements.category.value = c.category;
        f.elements.image_url.value = c.image_url;
        f.elements.description.value = c.description;
        f.scrollIntoView({ behavior: 'smooth' });
      };
    });

    $$('[data-delete-car]').forEach(b => {
      b.onclick = async () => {
        if (confirm('Delete this vehicle/promotion?')) {
          await api(`/api/admin/cars/${b.dataset.deleteCar}`, { method: 'DELETE' });
          loadCars();
          notice('Vehicle removed.');
        }
      };
    });
  } catch (e) {
    notice(e.message, true);
  }
}

$('#carForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.currentTarget;
  const fileInput = f.elements.image_file;

  try {
    // If user selected a file to upload from their device
    if (fileInput && fileInput.files && fileInput.files[0]) {
      const uploadData = new FormData();
      uploadData.append('image_file', fileInput.files[0]);
      const upRes = await fetch('/api/admin/upload-image', {
        method: 'POST',
        body: uploadData
      });
      const upJson = await upRes.json();
      if (!upRes.ok) throw new Error(upJson.error || 'Image upload failed');
      f.elements.image_url.value = upJson.image_url;
    }

    const d = Object.fromEntries(new FormData(f));
    d.active = f.elements.active.checked;
    await api('/api/admin/cars', { method: 'POST', body: JSON.stringify(d) });
    f.reset();
    f.elements.id.value = '';
    notice('Vehicle saved successfully.');
    loadCars();
  } catch (err) {
    notice(err.message, true);
  }
});

// ----------------------------------------------------
// PAYMENT OPTIONS
// ----------------------------------------------------
async function loadPayments() {
  try {
    const d = await api('/api/public-data');
    $('#paymentList').innerHTML = d.payments.map(p => `
      <div class="item-row">
        <div class="item-copy">
          <b>${esc(p.name)}</b>
          <small>${esc(p.details || 'No instructions provided')}</small>
        </div>
        <button class="small-btn secondary" data-edit-payment="${p.id}">Edit</button>
        <button class="small-btn danger" data-delete-payment="${p.id}">Delete</button>
      </div>
    `).join('');

    $$('[data-edit-payment]').forEach(b => {
      b.onclick = () => {
        const p = d.payments.find(x => x.id === Number(b.dataset.editPayment));
        const f = $('#paymentForm');
        f.elements.id.value = p.id;
        f.elements.name.value = p.name;
        f.elements.details.value = p.details;
        f.scrollIntoView({ behavior: 'smooth' });
      };
    });

    $$('[data-delete-payment]').forEach(b => {
      b.onclick = async () => {
        if (confirm('Delete this payment option?')) {
          await api(`/api/admin/payments/${b.dataset.deletePayment}`, { method: 'DELETE' });
          loadPayments();
          notice('Payment option removed.');
        }
      };
    });
  } catch (e) {
    notice(e.message, true);
  }
}

$('#paymentForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.currentTarget;
  const d = Object.fromEntries(new FormData(f));
  d.active = f.elements.active.checked;
  try {
    await api('/api/admin/payments', { method: 'POST', body: JSON.stringify(d) });
    f.reset();
    f.elements.id.value = '';
    notice('Payment option saved.');
    loadPayments();
  } catch (err) {
    notice(err.message, true);
  }
});

$('#settingsForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))
    });
    notice('Announcement saved.');
  } catch (err) {
    notice(err.message, true);
  }
});

$('#passwordForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/admin/password', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))
    });
    e.currentTarget.reset();
    notice('Password updated successfully.');
  } catch (err) {
    notice(err.message, true);
  }
});

async function refreshAll() {
  await Promise.all([loadBookings(), loadUsers(), loadReviews(), loadCars(), loadPayments(), loadFarePrices()]);
}

setInterval(() => {
  if (!$('#dashboard').hidden) loadBookings();
}, 15000);

check();
