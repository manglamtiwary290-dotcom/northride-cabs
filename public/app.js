const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const api = async (url, options = {}) => {
  const r = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const d = await r.json().catch(() => ({
    error: 'Unexpected server response.'
  }));

  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
};

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

const yearEl = $('#year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

$('#menuToggle')?.addEventListener('click', () => {
  document.querySelector('nav')?.classList.toggle('open');
});

document.querySelectorAll('nav a').forEach(a => {
  a.addEventListener('click', () => {
    document.querySelector('nav')?.classList.remove('open');
  });
});

const dateInput = $('#pickupDate');
const localToday = new Date();
if (dateInput) {
  const y = localToday.getFullYear();
  const m = String(localToday.getMonth() + 1).padStart(2, '0');
  const d = String(localToday.getDate()).padStart(2, '0');
  dateInput.min = `${y}-${m}-${d}`;
}

let publicData = {};
let localReviews = [];
try {
  localReviews = JSON.parse(localStorage.getItem('northride_user_reviews') || '[]');
} catch {}

function updateReviewUI(summary, reviewsList) {
  const reviewCount = document.querySelector('#reviewCount');
  const reviewScore = document.querySelector('.reviews-score');
  const reviewStars = document.querySelector('.reviews-stars');
  const reviewsGrid = document.querySelector('#reviewsGrid');
  const heroReviewCount = document.querySelector('#heroReviewCount');
  const recommendRate = document.querySelector('#recommendRate');

  if (summary) {
    const total = Number(summary.count || 525);
    const average = Number(summary.average || 4.9);
    const rounded = Math.round(average);

    if (reviewCount) {
      reviewCount.textContent = `${total} Verified Customer Ratings`;
    }

    if (heroReviewCount) {
      heroReviewCount.textContent = `${total}+`;
    }

    if (reviewScore) {
      reviewScore.innerHTML = `${average.toFixed(1)}<span>/5</span>`;
    }

    if (reviewStars) {
      reviewStars.textContent = '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
      reviewStars.setAttribute('aria-label', `Average rating ${average.toFixed(1)} out of 5 stars`);
    }

    if (recommendRate) {
      recommendRate.textContent = `${summary.recommendationRate || 98}%`;
    }

    // Dynamic Star Breakdown Progress Bars & Counts
    const starCounts = {
      5: summary.stars_5 ?? 464,
      4: summary.stars_4 ?? 50,
      3: summary.stars_3 ?? 9,
      2: summary.stars_2 ?? 2,
      1: summary.stars_1 ?? 1
    };

    const starPcts = {
      5: summary.pct_5 ?? Math.round((starCounts[5] / total) * 100),
      4: summary.pct_4 ?? Math.round((starCounts[4] / total) * 100),
      3: summary.pct_3 ?? Math.round((starCounts[3] / total) * 100),
      2: summary.pct_2 ?? Math.round((starCounts[2] / total) * 100),
      1: summary.pct_1 ?? Math.round((starCounts[1] / total) * 100)
    };

    for (let s = 1; s <= 5; s++) {
      const countEl = document.querySelector(`#statStars${s}`);
      const pctEl = document.querySelector(`#pctStars${s}`);
      const fillEl = document.querySelector(`#barFill${s}`);
      if (countEl) countEl.textContent = starCounts[s];
      if (pctEl) pctEl.textContent = starPcts[s] > 0 ? `${starPcts[s]}%` : '<1%';
      if (fillEl) fillEl.style.width = `${Math.max(starPcts[s], 1)}%`;
    }
  }

  if (reviewsGrid) {
    let list = Array.isArray(reviewsList) ? [...reviewsList] : [];

    // Merge any locally preserved reviews (prevent losing user reviews across restarts)
    if (localReviews.length > 0) {
      const existingIds = new Set(list.map(r => r.id));
      const existingKey = new Set(list.map(r => `${r.name}_${r.message}`));
      localReviews.forEach(lr => {
        if (!existingIds.has(lr.id) && !existingKey.has(`${lr.name}_${lr.message}`)) {
          list.unshift(lr);
        }
      });
    }

    if (list.length > 0) {
      reviewsGrid.innerHTML = list.map(r => `
        <article class="review-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div class="review-stars" aria-label="${r.rating} stars" style="color:#EAB308;font-size:18px">
              ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}
            </div>
            ${r.route ? `<span class="review-route-badge">📍 ${esc(r.route)}</span>` : ''}
          </div>
          <h3 style="margin:4px 0 8px;font-size:16px;color:#0F172A">${esc(r.name)}</h3>
          <p style="color:#475569;line-height:1.6;font-size:14px;margin-bottom:12px;flex:1">${esc(r.message)}</p>
          <div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid #F1F5F9">
            <span style="display:inline-flex;align-items:center;gap:4px;color:#15803D;font-size:11.5px;font-weight:700;background:#DCFCE7;border:1px solid #86EFAC;padding:2px 8px;border-radius:12px">
              ✓ Verified Rider
            </span>
            <small style="color:#94A3B8;font-size:12px">${esc(new Date(r.created_at || Date.now()).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }))}</small>
          </div>
        </article>
      `).join('');
    }
  }
}

function updateFarePrices(farePrices) {
  if (!farePrices || typeof farePrices !== 'object') return;

  const fareKeyMap = {
    'Chandigarh to Delhi': 'chandigarh_delhi',
    'Chandigarh to Noida': 'chandigarh_noida',
    'Chandigarh to Ghaziabad': 'chandigarh_ghaziabad',
    'Chandigarh to Gurugram': 'chandigarh_gurugram',
    'Chandigarh to Patiala': 'chandigarh_patiala',
    'Chandigarh to Ludhiana': 'chandigarh_ludhiana',
    'Chandigarh to Amritsar': 'chandigarh_amritsar'
  };

  document.querySelectorAll('.fare-card').forEach(card => {
    const link = card.querySelector('.fare-book-link');
    const route = link?.dataset?.fareRoute;
    const priceKey = fareKeyMap[route];

    if (priceKey && farePrices[priceKey]) {
      const priceVal = Number(farePrices[priceKey]);
      const priceEl = card.querySelector('.fare-price');
      if (priceEl && !priceEl.classList.contains('fare-price-request') && Number.isFinite(priceVal) && priceVal > 0) {
        priceEl.textContent = '₹' + priceVal.toLocaleString('en-IN');
      }
    }
  });
}

async function loadPublic() {
  try {
    publicData = await api('/api/public-data');

    // Update Reviews and Ratings
    updateReviewUI(publicData.reviewSummary, publicData.reviews);

    // Update Route Fares
    updateFarePrices(publicData.farePrices);

    // Update Payment Options in Booking Form
    const paySelect = $('#paymentMethod');
    if (paySelect && Array.isArray(publicData.payments)) {
      paySelect.innerHTML =
        '<option value="">Choose payment method</option>' +
        publicData.payments.map(p =>
          `<option value="${esc(p.name)}" data-details="${esc(p.details || '')}">${esc(p.name)}</option>`
        ).join('');

      paySelect.addEventListener('change', () => {
        const hint = $('#paymentHint');
        if (hint) {
          hint.textContent = paySelect.selectedOptions[0]?.dataset.details || '';
        }
      });
    }

    // Update Fleet Gallery
    const gallery = $('#carGallery');
    if (gallery) {
      gallery.innerHTML = (publicData.cars && publicData.cars.length)
        ? publicData.cars.map(c => `
          <article class="car-card">
            <img class="car-image"
                 src="${esc(c.image_url)}"
                 alt="${esc(c.name)} - Chandigarh Taxi Service"
                 loading="lazy"
                 decoding="async"
                 onerror="this.style.display='none'">
            <div class="car-info">
              <div class="car-meta">
                <span>${esc(c.category)}</span>
                <span>24x7 AVAILABLE</span>
              </div>
              <h3>${esc(c.name)}</h3>
              <p>${esc(c.description)}</p>
              <a class="car-book" href="#booking">
                Request this car <span>&rarr;</span>
              </a>
            </div>
          </article>
        `).join('')
        : '<p style="padding:20px;color:#475569">Clean AC cabs ready for local and outstation trips. Call us anytime.</p>';
    }

    // Fill booking route if clicked from fare card
    document.querySelectorAll('.fare-book-link[data-fare-route]').forEach(link => {
      link.addEventListener('click', () => {
        const route = link.dataset.fareRoute;
        if (route && route.includes(' to ')) {
          const parts = route.split(' to ');
          const pickupInput = $('#pickup');
          const dropInput = $('#dropoff');
          if (pickupInput && parts[0]) pickupInput.value = parts[0].trim();
          if (dropInput && parts[1]) dropInput.value = parts[1].trim();
        }
      });
    });

  } catch (e) {
    console.warn('Failed to load public data:', e.message);
  }
}

// BOOKING SUBMISSION WITH ANTI-DUPLICATE & DOUBLE-CLICK PROTECTION
let isBookingSubmitting = false;
$('#bookingForm')?.addEventListener('submit', async e => {
  e.preventDefault();

  if (isBookingSubmitting) {
    return; // Block double-clicks or repeated rapid submissions
  }
  isBookingSubmitting = true;

  const btn = $('#submitBooking');
  const msg = $('#bookingMessage');

  btn.disabled = true;
  btn.style.opacity = '0.65';
  btn.style.cursor = 'not-allowed';
  btn.innerHTML = '&#9203; Sending ride request&hellip;';

  msg.className = 'message';
  msg.textContent = '';
  msg.style.background = '';
  msg.style.border = '';
  msg.style.color = '';

  const formEl = e.currentTarget;
  const f = new FormData(formEl);
  const payload = Object.fromEntries(f.entries());

  try {
    const d = await api('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (d.isDuplicate) {
      msg.className = 'message info';
      msg.style.background = '#EFF6FF';
      msg.style.border = '1.5px solid #93C5FD';
      msg.style.color = '#1E3A8A';
      msg.innerHTML = `
        <div style="font-size:15px;line-height:1.6">
          <b style="font-size:16px;color:#1D4ED8">&#9432; Active Booking Already Registered!</b><br>
          Booking Reference: <b style="font-family:monospace;font-size:15px;color:#0F172A">${esc(d.reference)}</b><br>
          Customer ID: <b style="font-family:monospace;font-size:15px;color:#0F172A;background:#DBEAFE;padding:2px 8px;border-radius:4px">${esc(d.userId)}</b><br>
          <span style="font-size:13px;color:#334155">${esc(d.message)} Duplicate request was prevented so you won't be charged or double-booked. Our team is already processing your ride!</span>
          <div style="margin-top:12px">
            <button type="button" id="bookAnotherBtn" class="btn btn-outline" style="padding:6px 16px;font-size:13px;border-color:#1D4ED8;color:#1D4ED8">+ Request A Different Ride</button>
          </div>
        </div>
      `;
    } else {
      msg.className = 'message success';
      msg.innerHTML = `
        <div style="font-size:15px;line-height:1.6">
          <b style="font-size:16px;color:#21865B">&#10003; Booking Request Received Successfully!</b><br>
          Booking Reference: <b style="font-family:monospace;font-size:15px;color:#0F172A">${esc(d.reference)}</b><br>
          Your Customer ID: <b style="font-family:monospace;font-size:15px;color:#0F172A;background:#EFF6FF;border:1px solid #BFDBFE;padding:2px 8px;border-radius:4px">${esc(d.userId)}</b><br>
          <span style="font-size:13px;color:#475569">Our team will call you shortly to confirm driver and pickup. Save your Customer ID for future quick bookings.</span>
          <div style="margin-top:12px">
            <button type="button" id="bookAnotherBtn" class="btn btn-outline" style="padding:6px 16px;font-size:13px;border-color:#1D4ED8;color:#1D4ED8">+ Request Another Cab</button>
          </div>
        </div>
      `;
    }

    formEl.reset();
    $('#pickup').value = 'Chandigarh';

    if (dateInput) {
      const y = localToday.getFullYear();
      const m = String(localToday.getMonth() + 1).padStart(2, '0');
      const dStr = String(localToday.getDate()).padStart(2, '0');
      dateInput.min = `${y}-${m}-${dStr}`;
    }

    // Keep button locked in confirmed state so repeated clicking is impossible
    btn.disabled = true;
    btn.innerHTML = '&#10003; Ride Request Submitted';
    btn.style.opacity = '0.7';
    btn.style.cursor = 'default';

    document.querySelector('#bookAnotherBtn')?.addEventListener('click', () => {
      msg.className = 'message';
      msg.textContent = '';
      msg.style.background = '';
      msg.style.border = '';
      btn.disabled = false;
      btn.innerHTML = 'Request a ride <span>&nearr;</span>';
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      $('#dropoff')?.focus();
    });

    window.scrollTo({
      top: $('#booking').offsetTop - 90,
      behavior: 'smooth'
    });

  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message || 'Booking submission failed. Please try again.';
    btn.disabled = false;
    btn.innerHTML = 'Request a ride <span>&nearr;</span>';
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  } finally {
    setTimeout(() => {
      isBookingSubmitting = false;
    }, 2500);
  }
});

// REVIEWS: TOGGLE & SUBMIT
const writeReviewBtn = document.querySelector('#writeReviewBtn');
const reviewForm = document.querySelector('#reviewForm');

if (writeReviewBtn && reviewForm) {
  writeReviewBtn.addEventListener('click', () => {
    reviewForm.hidden = !reviewForm.hidden;
    if (!reviewForm.hidden) {
      reviewForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.querySelector('#reviewName')?.focus();
    }
  });
}

if (reviewForm) {
  reviewForm.addEventListener('submit', async e => {
    e.preventDefault();

    const submitBtn = reviewForm.querySelector('button[type="submit"]');
    const messageBox = document.querySelector('#reviewFormMessage');

    const nameVal = document.querySelector('#reviewName')?.value.trim();
    const ratingVal = Number(document.querySelector('#reviewRating')?.value);
    const routeVal = document.querySelector('#reviewRoute')?.value.trim() || '';
    const msgVal = document.querySelector('#reviewMessage')?.value.trim();

    if (!nameVal || !ratingVal || !msgVal) {
      if (messageBox) {
        messageBox.textContent = 'Please fill out your name, rating and feedback.';
        messageBox.className = 'message error';
      }
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting your rating…';
    if (messageBox) messageBox.textContent = '';

    try {
      const result = await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          name: nameVal,
          rating: ratingVal,
          route: routeVal,
          message: msgVal
        })
      });

      // Save to localReviews so it permanently persists in this browser
      if (result.review) {
        localReviews.unshift(result.review);
        try {
          localStorage.setItem('northride_user_reviews', JSON.stringify(localReviews));
        } catch {}
      }

      if (messageBox) {
        messageBox.textContent = `✓ Thank you, ${nameVal}! Your ${ratingVal}★ rating has been saved successfully.`;
        messageBox.className = 'message success';
      }

      reviewForm.reset();

      // Update public data and UI immediately with new count and card
      if (!publicData) publicData = {};
      if (!Array.isArray(publicData.reviews)) publicData.reviews = [];
      if (result.review) {
        publicData.reviews.unshift(result.review);
      }
      if (result.reviewSummary) {
        publicData.reviewSummary = result.reviewSummary;
      }
      updateReviewUI(publicData.reviewSummary, publicData.reviews);

    } catch (error) {
      if (messageBox) {
        messageBox.textContent = error.message || 'Rating could not be saved. Please try again.';
        messageBox.className = 'message error';
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit review';
    }
  });
}

// Initial load
loadPublic();
