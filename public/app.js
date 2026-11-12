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

function updateReviewUI(summary, reviewsList) {
  const reviewCount = document.querySelector('#reviewCount');
  const reviewScore = document.querySelector('.reviews-score');
  const reviewStars = document.querySelector('.reviews-stars');
  const reviewsGrid = document.querySelector('#reviewsGrid');

  if (summary) {
    const total = Number(summary.count || 0);
    const average = Number(summary.average || 4.9);

    if (reviewCount) {
      reviewCount.textContent = total === 1 ? '1 Customer Review' : `${total} Customer Reviews`;
    }

    if (reviewScore) {
      reviewScore.innerHTML = `${average.toFixed(1)}<span>/5</span>`;
    }

    if (reviewStars) {
      const rounded = Math.round(average);
      reviewStars.textContent = '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
      reviewStars.setAttribute('aria-label', `Average rating ${average.toFixed(1)} out of 5 stars`);
    }
  }

  if (reviewsGrid && Array.isArray(reviewsList) && reviewsList.length > 0) {
    reviewsGrid.innerHTML = reviewsList.map(r => `
      <article class="review-card">
        <div class="review-stars" aria-label="${r.rating} stars" style="color:#f59e0b;font-size:18px;margin-bottom:8px">
          ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}
        </div>
        <h3 style="margin:6px 0 8px;font-size:16px;color:#102a43">${esc(r.name)}</h3>
        <p style="color:#334e68;line-height:1.5;font-size:14px;margin-bottom:10px">${esc(r.message)}</p>
        <small style="color:#829ab1;font-size:12px;font-weight:500">
          Verified Passenger &bull; ${esc(new Date(r.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }))}
        </small>
      </article>
    `).join('');
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
        : '<p style="padding:20px;color:#627d98">Clean AC cabs ready for local and outstation trips. Call us anytime.</p>';
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

// BOOKING SUBMISSION
$('#bookingForm')?.addEventListener('submit', async e => {
  e.preventDefault();

  const btn = $('#submitBooking');
  const msg = $('#bookingMessage');

  btn.disabled = true;
  btn.textContent = 'Sending ride request…';

  msg.className = 'message';
  msg.textContent = '';

  const f = new FormData(e.currentTarget);
  const payload = Object.fromEntries(f.entries());

  try {
    const d = await api('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    msg.className = 'message success';
    msg.innerHTML = `
      <div style="font-size:15px;line-height:1.6">
        <b style="font-size:16px;color:#166534">&#10003; Booking Request Received Successfully!</b><br>
        Booking Reference: <b style="font-family:monospace;font-size:15px;color:#102a43">${esc(d.reference)}</b><br>
        Your Customer ID: <b style="font-family:monospace;font-size:15px;color:#102a43;background:#e2ecf5;padding:2px 8px;border-radius:4px">${esc(d.userId)}</b><br>
        <span style="font-size:13px;color:#334155">Our team will call you shortly to confirm driver and pickup. Save your Customer ID for future quick bookings.</span>
      </div>
    `;

    e.currentTarget.reset();
    $('#pickup').value = 'Chandigarh';

    if (dateInput) {
      const y = localToday.getFullYear();
      const m = String(localToday.getMonth() + 1).padStart(2, '0');
      const dStr = String(localToday.getDate()).padStart(2, '0');
      dateInput.min = `${y}-${m}-${dStr}`;
    }

    window.scrollTo({
      top: $('#booking').offsetTop - 90,
      behavior: 'smooth'
    });

  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message || 'Booking submission failed. Please try again.';
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Request a ride <span>&nearr;</span>';
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
          message: msgVal
        })
      });

      if (messageBox) {
        messageBox.textContent = result.message || 'Thank you for your rating!';
        messageBox.className = 'message success';
      }

      reviewForm.reset();

      // Immediately prepend the new review into the list
      if (result.review) {
        const reviewsGrid = document.querySelector('#reviewsGrid');
        if (reviewsGrid) {
          const newCard = document.createElement('article');
          newCard.className = 'review-card';
          newCard.innerHTML = `
            <div class="review-stars" aria-label="${result.review.rating} stars" style="color:#f59e0b;font-size:18px;margin-bottom:8px">
              ${'★'.repeat(result.review.rating)}${'☆'.repeat(5 - result.review.rating)}
            </div>
            <h3 style="margin:6px 0 8px;font-size:16px;color:#102a43">${esc(result.review.name)}</h3>
            <p style="color:#334e68;line-height:1.5;font-size:14px;margin-bottom:10px">${esc(result.review.message)}</p>
            <small style="color:#166534;font-size:12px;font-weight:600">
              Verified Passenger &bull; Just now
            </small>
          `;
          reviewsGrid.prepend(newCard);
        }
      }

      if (result.reviewSummary) {
        updateReviewUI(result.reviewSummary);
      }

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
