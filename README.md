# NorthRide Cabs — responsive taxi booking starter

A responsive Chandigarh-focused taxi booking website with a customer booking form, auto-generated customer IDs, booking history for admins, fleet/promotions, payment-option management, an admin dashboard, browser alerts, and optional SMS integration.

## Requirements
- Node.js 20 or newer
- npm

## Run locally
1. Extract this folder.
2. Open a terminal in the folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env` and set a long random `SESSION_SECRET` and a strong `ADMIN_PASSWORD`.
5. Run `npm start`.
6. Open `http://localhost:3000`.
7. Admin page: `http://localhost:3000/admin.html`.

The first run creates the local SQLite database and initial admin account from `.env`. If you start with the example credentials, change the password immediately in the admin Settings tab. Never deploy with the example session secret/password.

## Features included
- Mobile, tablet, laptop and desktop responsive front page.
- Booking fields: trip type, car category, pickup/drop, date/time, name, phone, payment preference, optional notes.
- Chandigarh pre-filled as the primary pickup hub.
- Direct phone links: +91 98723 47745 and +91 60805 56037.
- Persistent SQLite bookings and customer IDs; repeat bookings on a matching phone reuse the customer ID.
- Password-hashed admin login, session cookies, login/booking rate limits, Helmet security headers, server-side input validation.
- Admin booking status changes; optional SMS on customer booking and on admin confirmation.
- Fleet/promo cards managed by HTTPS image URL; payment choices and displayed instructions managed by admin.
- Browser dashboard polls for new bookings and can play an alert sound after the admin enables it.

## Optional SMS setup
1. Create a Twilio account and configure an SMS-capable sender for your account/region.
2. Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` to `.env`.
3. Add `ADMIN_ALERT_PHONE` in E.164 format to receive booking alerts.
4. Restart the server and test with a phone number you control. Twilio account restrictions, destination verification, templates, and local telecom rules may apply. SMS is not active unless configured.

## Before public launch — important
This is a starter application, not a deployed/production-audited service. Before taking real bookings:
- Deploy behind HTTPS on a managed Node host; set `NODE_ENV=production`, `SESSION_SECRET`, and a strong unique admin password.
- Use a persistent disk/database and back it up. For multiple server instances, configure a shared session store.
- Add CSRF protection and stronger request validation, audit logs, monitoring, database backups, and a privacy/retention policy.
- Add a real image upload service if admins must upload files directly (current version accepts image URLs only).
- Configure and verify SMS delivery and use a compliant Indian SMS provider/templates if required. Never promise SMS delivery until provider status is checked.
- Online payments are preference labels only. No payment is collected by this app. Integrate a compliant payment provider before accepting online payments.
- Customer ID creation is not a password-based customer login yet. The current ID is a booking-history identifier; a secure customer portal would need OTP authentication and recovery controls.
- Add authorization/consent language and review applicable privacy, consumer, tax and transport requirements before launch.

## Data storage
`northride.sqlite` and `sessions.sqlite` are created in the project directory when you run the server. They contain customer and booking information; keep them private and out of public/static folders and source control. The public web directory is only `public/`.
