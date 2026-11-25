# Medical Center Booking System — MVP Specification

| | |
|---|---|
| **Status** | Draft v0.3 — for review with center management |
| **Date** | 2026-11-21 |
| **Scope** | MVP / pilot for the first center |
| **Country** | Syria |

---

## 1. Background

The center is a multi-specialty medical center. Today:

- All bookings and patient communication happen manually over WhatsApp and phone calls.
- There is no website, so patients cannot browse specialties or doctors, or book online.
- Doctors have no fixed weekly schedule. They work on-call or by pre-arranged days.
- Payment is cash at reception, and there is no insurance.

This causes double bookings, lost requests in chat history, repeated questions for staff, no reminders (more no-shows), and no data for management.

## 2. Goals

1. Give the center a **bilingual (Arabic / English), mobile-first website** with specialties and doctor profiles.
2. Let patients **book online** from their phone, with no app and no account.
3. Give receptionists **one place** to manage every appointment, whatever the channel: website, WhatsApp, phone or walk-in.
4. **Prevent double bookings** through real availability and booking-type durations.
5. Keep WhatsApp as the patient channel, using **pre-filled click-to-chat messages** in the MVP.
6. Record **cash payments** and give management a **daily cash report**.

**Success metrics for the pilot (to be agreed with management):**
- Most appointments are recorded in the system rather than in chats.
- No double bookings.
- A share of bookings comes from the website.
- The no-show rate is measured.

## 3. Decisions log

| # | Decision | Notes |
|---|---|---|
| D1 | **Build** a custom platform; this center is the pilot | It may become a multi-center product later. The MVP is single-center, but every record carries `center_id`. |
| D2 | **Cash only** in the MVP | No online payment and no prepayment. |
| D3 | **Arabic and English** from day one | Arabic is right-to-left (RTL). All content fields are bilingual. |
| D4 | **Mobile-first web app (PWA)** | A native mobile app comes later and will reuse the same backend. |
| D5 | Booking types: **Visit, Re-visit, Session** | Length and price are set **per doctor, per type**. A Re-visit costs the same as a Visit by default. |
| D6 | Re-visit = a follow-up with **the same doctor** after an earlier completed visit | If the patient has no earlier visit, the booking is flagged for reception. It is not blocked. |
| D7 | **Patients cannot cancel or reschedule themselves** | They ask via WhatsApp or phone; reception handles it. |
| D8 | Availability uses **per-date availability sessions**, not a weekly template | Fits on-call doctors. A "copy previous week" shortcut is provided. |
| D9 | **Every doctor** can be booked online | If a doctor has no published session, the patient sends a *booking request* instead. |
| D10 | WhatsApp = **click-to-chat links** (`wa.me`), sent by reception | The WhatsApp Business API is **not available for Syria** (§13), so click-to-chat stays the WhatsApp channel. Automation in Phase 2 uses other channels. |
| D11 | Hosting on the **Cloudflare Free plan** for the MVP and pilot | Workers, D1, R2 and Turnstile. Upgrade to Workers Paid (USD 5/month) before or soon after go-live. See §12.4. |
| D12 | The system is run by **receptionists** | The center manager configures it; doctors get read-only access (optional). |
| D13 | A **Super admin** (platform owner) level exists from the MVP | Manages centers, center users and support access. See §11.13. |
| D15 | Country: **Syria** | Defaults and constraints in §19. |
| D14 | Stack: **Astro** (public website), **React SPA** (dashboard), **Hono API** on Workers | Clear frontend/backend split, light enough for the Free plan, and the API is reusable by the future mobile app. See §12. |

## 4. Users and roles

| Role | Who | Can do |
|---|---|---|
| **Super admin** | Platform owner (you) | Everything, across all centers: create, suspend and configure centers; manage center users; support access to any center (logged); platform settings and health |
| **Patient** (no login) | Public | Browse the website, book a slot, send a booking request, contact the center on WhatsApp |
| **Receptionist** | Front desk | Manage appointments and requests, patients, availability sessions, check-in, payments, WhatsApp messages |
| **Manager** | Center management | Everything a receptionist can do, plus specialties, doctors, booking types, center settings, users and all reports |
| **Doctor** (optional in the MVP) | Doctors | See their own daily and upcoming appointment list (read-only) |

### Permissions matrix

| Capability | Receptionist | Manager | Doctor |
|---|:-:|:-:|:-:|
| View, create and edit appointments | ✅ | ✅ | own, read-only |
| Confirm, cancel and mark no-show | ✅ | ✅ | — |
| Record cash payment | ✅ | ✅ | — |
| Edit a payment after the day is closed | — | ✅ | — |
| Manage availability sessions | ✅ | ✅ | — |
| Manage patients | ✅ | ✅ | — |
| Manage doctors, specialties and booking types | — | ✅ | — |
| Center settings and message templates | — | ✅ | — |
| Manage staff users | — | ✅ | — |
| Daily cash report | own | all | — |
| Other reports | — | ✅ | — |

The **Super admin** has every capability in every center, plus the platform console (§11.13). Each support action inside a center is recorded in the audit log as a support action.

## 5. Core concepts

- **Specialty**: for example Dermatology or Pediatrics. Bilingual name, description and icon.
- **Doctor**: a public profile linked to one or more specialties.
- **Booking type**: Visit, Re-visit or Session. Each doctor has a **doctor service** for each type they offer, with its own length (minutes), price and active flag.
- **Availability session**: a block of time on a specific date when a doctor sees patients. Example: *Dr. A, Sat 2026-11-28, 16:00–20:00*.
- **Appointment**: a patient, a doctor, a booking type, a start and end time, and a status.
- **Booking request**: a patient asks for an appointment with a doctor who has no open slot. Reception turns it into an appointment or declines it.
- **Patient**: identified by **phone number + name**. One phone number can belong to several patients, since parents often book for their children.

## 6. Data model

All tables carry `id`, `center_id`, `created_at` and `updated_at`. Times are stored in UTC and displayed in the center's time zone. Bilingual fields come in pairs (`*_ar`, `*_en`).

### centers
`name_ar`, `name_en`, `slug`, `status` (`active` | `suspended`), `logo_url`, `phone`, `whatsapp_phone`, `address_ar`, `address_en`, `map_url`, `timezone`, `default_country_code`, `opening_hours_ar`, `opening_hours_en`, `about_ar`, `about_en`, booking rules (`slot_step_minutes`, `min_lead_minutes`, `max_advance_days`), `default_language`.

### specialties
`name_ar`, `name_en`, `slug`, `description_ar`, `description_en`, `icon`, `sort_order`, `is_active`.

### doctors
`name_ar`, `name_en`, `slug`, `title_ar`, `title_en` (e.g. "Consultant Dermatologist"), `photo_url`, `bio_ar`, `bio_en`, `qualifications_ar`, `qualifications_en`, `languages` (spoken), `gender`, `years_experience`, `sort_order`, `is_active`, `user_id` (optional, for doctor login).

### doctor_specialties
`doctor_id`, `specialty_id`, `is_primary`.

### doctor_services
`doctor_id`, `booking_type` (`visit` | `revisit` | `session`), `duration_minutes`, `price`, `is_active`, `notes_ar`, `notes_en`.
Unique on (`doctor_id`, `booking_type`).

### availability_sessions
`doctor_id`, `date`, `start_time`, `end_time`, `status` (`open` | `closed`), `note`, `created_by`.
Rule: sessions for the same doctor must not overlap.

### patients
`full_name`, `phone` (E.164 format), `gender` (optional), `date_of_birth` (optional), `preferred_language` (`ar` | `en`), `notes` (administrative only, **no medical data**), `source` (`website` | `whatsapp` | `phone` | `walk_in`).
Index on `phone`. Duplicates (same phone and name) can be merged by staff.

### appointments
`patient_id`, `doctor_id`, `booking_type`, `session_id` (nullable for overrides), `start_at`, `end_at`, `status` (see §7), `source` (`website` | `whatsapp` | `phone` | `walk_in`), `price_snapshot`, `revisit_flag` (true when a Re-visit has no earlier completed Visit), `patient_note`, `internal_note`, `cancel_reason`, `cancelled_by`, `confirmed_at`, `checked_in_at`, `completed_at`, `created_by` (null when booked on the website), `reference_code` (short, shown to the patient).

### booking_requests
`patient_id`, `doctor_id`, `booking_type`, `preferred_date` (optional), `preferred_period` (`morning` | `afternoon` | `evening` | `any`), `patient_note`, `status` (`new` | `contacted` | `converted` | `declined`), `appointment_id` (set when converted), `handled_by`.

### payments
`appointment_id`, `amount`, `method` (`cash` only in the MVP), `received_by`, `received_at`, `note` (e.g. the reason for a discount).

### users (staff)
`name`, `email`, `password_hash`, `role` (`super_admin` | `manager` | `receptionist` | `doctor`), `is_active`, `last_login_at`.
The Super admin has `center_id = null`. All other users belong to exactly one center.

### sessions
`id` (SHA-256 of the session token; the token itself lives only in the HTTP-only cookie), `user_id`, `support_center_id` (Super admin support mode), `expires_at` (12-hour sliding lifetime), `user_agent`.

### rate_limits
`key` (e.g. failed logins per email or per IP), `count`, `window_start`. Used to block password guessing: 5 failures per email or 20 per IP in 15 minutes.

### cash_day_closures
`date`, `closed_by`, `closed_at`, `total`. When a manager closes a day, its payments are locked (§11.11).

### message_templates
`key` (`confirmation` | `reminder` | `rescheduled` | `cancelled` | `request_followup`), `body_ar`, `body_en`.

### message_log
`appointment_id` or `request_id`, `template_key`, `channel` (`whatsapp_link`), `sent_by`, `sent_at`.
Click-to-chat can't confirm delivery, so this only records that staff opened the message.

### audit_log
`user_id`, `entity`, `entity_id`, `action`, `changes` (JSON), `is_support_action` (true when done by the Super admin inside a center), `at`.

## 7. Appointment lifecycle

```
                  ┌──────────── cancelled (by reception, with reason)
                  │
 pending ──► confirmed ──► checked_in ──► completed
    │             │
    │             └──► no_show
    └──► cancelled
```

- **Website bookings** start as `pending`. Bookings created by reception start as `confirmed`, and walk-ins can start directly as `checked_in`.
- A `pending` appointment **holds its slot**. There is no auto-expiry in the MVP; pending items older than a set number of hours are highlighted.
- **Reschedule** means changing the time of an existing appointment, which keeps its history and reference code. It is done by reception only and logged in the audit log.
- Only `pending`, `confirmed` and `checked_in` appointments block slots.

## 8. Availability and slot rules

1. A doctor is **bookable instantly** on a date when they have an **open availability session** on that date.
2. Patients choose a booking type first. Its `duration_minutes` comes from that doctor's service.
3. **Candidate start times** run from the session start in steps of `slot_step_minutes` (default 10, set by the center).
4. A start time is **available** when:
   - `[start, start + duration)` fits entirely inside the session;
   - it overlaps no blocking appointment for that doctor;
   - it is at least `min_lead_minutes` from now (default 120) and within `max_advance_days` (default 30).
5. **Double-booking protection**: the check and the insert happen in a single atomic database statement or transaction. If two patients pick the same slot, the second gets "This time was just taken, please choose another."
6. **Reception override**: staff may book outside a session or overlapping another appointment (for example an urgent walk-in), after a visible warning. The override is logged.
7. When a doctor has **no open session** within the booking window, the website shows **"Request an appointment"**, which creates a booking request.
8. **Copy previous week**: copies a doctor's sessions from a chosen week to the next one. Staff then review the copy before it's live.
9. **Closing a session** that still has appointments shows a list of the affected patients, so reception can contact them. Nothing is cancelled automatically.

**Re-visit rule:** when a Re-visit is booked for a patient who has no `completed` appointment with the same doctor, set `revisit_flag = true`. Reception sees a badge and can change the type to Visit when confirming. The price is the same either way by default.

## 9. Public website

Mobile-first, bilingual, RTL for Arabic. URLs are prefixed by language: `/ar/...` and `/en/...`. The default language is Arabic (to confirm).

| Page | Content |
|---|---|
| **Home** | Center intro, specialties grid, featured doctors, "Book now", WhatsApp button, location and hours |
| **Specialties** | List of active specialties |
| **Specialty** | Description and the doctors in that specialty |
| **Doctors** | All doctors, filterable by specialty and gender |
| **Doctor profile** | Photo, title, bio, qualifications, languages, booking types with length and price, next available dates, "Book" button |
| **Booking flow** | See §10 |
| **Booking received** | Reference code, summary, "We will confirm with you on WhatsApp", button to message the center |
| **Contact / About** | Address, map, phone, WhatsApp, opening hours |

Other requirements:
- Floating **WhatsApp button** on every page (opens a chat with the center's WhatsApp number).
- Language switch on every page, which keeps the user on the same page.
- SEO: page titles and descriptions per language, `hreflang`, sitemap, doctor and specialty pages rendered on the server.
- PWA manifest and icons, so the site can be added to the phone's home screen.
- Performance target: the doctor page loads fast on a mid-range phone over 4G (Lighthouse mobile performance ≥ 90).
- Accessibility: readable font sizes, enough contrast, large tap targets.

## 10. Patient booking flow (website)

1. **Choose a doctor**, either directly or through a specialty.
2. **Choose a booking type**: Visit, Re-visit or Session (only the types this doctor offers), with length and price shown.
3. **Choose a date** (only dates with free slots are enabled) and then a **time**.
   - If there are no free dates, show "Request an appointment" with a preferred date or period and a note.
4. **Your details**: full name, mobile number (country code preset), optional "booking for someone else" note, preferred language (preset to the current site language).
5. **Turnstile** bot check (invisible in most cases).
6. **Submit**. An appointment is created as `pending` (or a booking request as `new`). The "Booking received" page shows the reference code.

There is no patient account and no SMS or WhatsApp code in the MVP. Spam is limited by Turnstile, per-phone and per-IP rate limits, and reception confirmation.

## 11. Staff dashboard

Login with email and password. The dashboard is fully bilingual, and each staff member chooses their language. It is usable on a tablet, and usable (if less comfortable) on a phone.

### 11.1 Today (home screen)
- **Pending confirmations** queue, oldest first, with one-click **Confirm + send WhatsApp**.
- **New booking requests** count, with a link to the inbox.
- **Today's agenda** across all doctors (time, patient, doctor, type, status), with quick actions: check in, mark paid, complete, no-show.
- Filters: doctor, status.

### 11.2 Calendar
- Day view with doctors as columns; week view for a single doctor.
- Shows availability sessions as background blocks and appointments as cards coloured by status.
- Click an empty slot to create an appointment. Click a card to open the appointment panel.

### 11.3 Appointment panel
- Patient (name, phone, appointment history), doctor, type, time, status, source, notes, Re-visit flag.
- Actions:
  - confirm, check in, complete, no-show, cancel (reason required), reschedule;
  - change type (Visit ⇄ Re-visit);
  - record payment;
  - **Send WhatsApp**, with a template choice (§13);
  - view the audit history.

### 11.4 New appointment (reception)
- Search the patient by phone number. Pick an existing patient or create a new one inline.
- Choose doctor, type and slot (the same rules as the website, plus the override option).
- Choose a source: WhatsApp, phone or walk-in.
- Default status: `confirmed`; walk-ins can be checked in straight away.

### 11.5 Booking requests inbox
- New, contacted, converted and declined tabs.
- **Convert to appointment** (opens the new-appointment form pre-filled), **Mark contacted**, **Decline**, **Send WhatsApp**.

### 11.6 Patients
- Search by name or phone. Profile with contact details, preferred language and administrative notes.
- Appointment history with status counts (completed, no-shows).
- Merge duplicates (manager only).

### 11.7 Availability planner
- Choose a doctor and a week. Add, edit or close sessions per date.
- "Copy previous week", followed by a review step.
- Warning when an edit affects existing appointments.

### 11.8 Doctors (manager)
- Create and edit the profile (bilingual fields, photo upload to R2), specialties, active and display order.
- Booking types per doctor: enable or disable Visit, Re-visit and Session, and set length and price.
- Optional: link a doctor user account.

### 11.9 Specialties (manager)
Create, edit, reorder and deactivate.

### 11.10 Settings (manager)
- Center information (bilingual), logo, contact and WhatsApp numbers, address and map link, opening hours text.
- Booking rules: slot step, minimum lead time, maximum days ahead.
- WhatsApp message templates (Arabic and English) with placeholders.
- Staff users: invite, set role, deactivate, reset password.

### 11.11 Reports
- **Daily cash report**: total cash received by date, broken down by receptionist and by doctor, plus a list of payments. Printable. A manager can "close the day", after which payments are locked.
- **Appointments summary** (manager): counts by status, doctor, specialty, type and source for a date range; no-show rate.
- Export to CSV.

### 11.12 Doctor view (optional)
A read-only list of the doctor's own appointments for today and upcoming days.

### 11.13 Platform console (Super admin)
A separate area (`/admin`) for the Super admin only.
- **Centers**: list, create, edit, suspend or reactivate. A suspended center's website shows a notice, and its staff can't log in.
- **Center users**: create the first manager account for a center, reset passwords, deactivate users.
- **Support access**: "Open center as support" opens that center's dashboard with full rights. A visible banner shows that support mode is on, and every action is logged with `is_support_action = true`.
- **Activity**: recent logins, audit log across centers, support-access history.
- **Platform health**: error log, daily usage against the Cloudflare plan limits (requests, database reads and writes).

Security rules:
- The Super admin login requires two-factor authentication (an authenticator app, TOTP).
- The center's agreement and privacy notice must state that the platform provider can access data for support.

## 12. Technical architecture (Cloudflare Free plan)

### 12.1 Overview

The system has a clear **frontend / backend split**, in one repository:

```
 Patients (phone browser)        Staff (tablet / PC / phone)
          │                                  │
          ▼                                  ▼
 ┌──────────────────────┐        ┌────────────────────────┐
 │  Public website      │        │  Dashboard (React SPA) │
 │  Astro + React       │        │  reception, manager,   │
 │  islands             │        │  doctor, /admin        │
 │  (server-rendered,   │        │  (static files)        │
 │   SEO)               │        │                        │
 └──────────┬───────────┘        └───────────┬────────────┘
            │       JSON over HTTPS          │
            └──────────────┬─────────────────┘
                           ▼
              ┌──────────────────────────┐
              │  Backend API (Hono)      │  ◄── future mobile app
              │  Cloudflare Workers      │
              │  auth, roles, booking    │
              │  rules, notifications    │
              └─────┬──────────┬─────────┘
                    ▼          ▼
               D1 (database)  R2 (images)
```

### 12.2 Components

| Part | Technology | Why |
|---|---|---|
| **Public website** (frontend) | **Astro**, with **React** "islands" for the interactive booking widget. Server-rendered on Workers, with caching. | Fast pages and good Google search results; ships very little JavaScript to phones. |
| **Dashboard** (frontend) | **React + Vite** single-page app (TypeScript), with TanStack Query for data and React Router for screens | Rich interactive screens (calendar, queues). Built into static files, which Cloudflare serves for free and without counting toward request limits. |
| **Backend API** | **Hono** (TypeScript) on Cloudflare Workers | A small, fast framework that fits the Free plan's 3 MB size and 10 ms CPU limits. All business rules live here. |
| Shared code | A `packages/shared` workspace: types, validation schemas (Zod), translation keys | Frontend and backend use the same types and validation rules. |
| UI | Tailwind CSS with RTL support (logical properties) and an accessible component library | |
| Internationalisation | Arabic and English message files in `packages/shared`; `dir="rtl"` for Arabic; locale-aware dates, times and currency | |
| Database | **Cloudflare D1** (SQLite) through **Drizzle ORM** and migrations | Drizzle keeps a later move to PostgreSQL (through Hyperdrive) possible. |
| File storage | **Cloudflare R2**: doctor photos, logos, images (resized before upload) | |
| Bot protection | **Cloudflare Turnstile** on the public booking and request forms | Free. |
| Staff authentication | Email and password, hashed with PBKDF2 (native Web Crypto, so it stays within the CPU limit). Secure, HTTP-only session cookies. TOTP two-factor for the Super admin, with the secret encrypted (AES-GCM) by a Worker secret. Temporary passwords must be changed at first sign-in. | |
| Scheduled jobs | Cron Triggers: daily database export to R2, highlighting stale pending items | |
| Backups | D1 Time Travel (7 days on Free, 30 on Paid) plus a daily export to R2 | |
| Environments | `staging` and `production` (separate D1 and R2 resources) | |
| CI/CD | GitHub Actions: lint, type-check, tests, deploy with Wrangler | |

**Why not Next.js:** Next.js is a full-stack framework (frontend and backend in one). On the Cloudflare Free plan, its bundle can exceed the 3 MB Worker size limit, and server rendering can exceed the 10 ms CPU limit. The split above stays well inside both limits and keeps the API independent for the mobile app.

### 12.3 Code structure (planned)

```
/apps
  /web          Astro public website (specialties, doctors, booking widget)
  /dashboard    React SPA (reception, manager, doctor view, /admin console)
  /api          Hono backend on Workers
    /routes       public, staff, admin endpoints
    /domain       booking rules: slot calculation, status transitions, re-visit check
    /notify       notification module (WhatsApp link builder now, Cloud API later)
    /db           Drizzle schema and migrations
/packages
  /shared       types, Zod schemas, i18n messages (ar.json, en.json)
```

**API-first:** every screen in the website and dashboard works through the API, so a future mobile app reuses it unchanged.

### 12.4 Cloudflare Free plan: limits and plan

Limits that matter for this project (check Cloudflare's current pricing pages before launch):

| Limit (Free) | Effect on this project |
|---|---|
| 100,000 Worker requests per day | Plenty for one center. Static files (dashboard, images through the CDN) don't count. |
| 10 ms CPU per request | Fine for a lean Hono API. Waiting on the database doesn't count. Heavy work such as password hashing is designed to stay within it. |
| 3 MB Worker size (compressed) | Fine for Hono and Astro; this is the main reason not to use Next.js. |
| 50 database queries per request | Endpoints are designed to stay well below this. |
| D1 daily read and write quotas | Well above one center's needs. **When a daily quota is used up, the database stops answering until the reset (midnight UTC).** |
| D1 Time Travel: 7 days | Combined with the daily export to R2. |
| No uptime guarantee (SLA) | Acceptable for a pilot. |

R2 may require a payment card on the account even while usage stays within the free allowance.

**Recommendation:** develop and run the pilot on the Free plan. Move to **Workers Paid (USD 5 per month)** when real patients depend on it, mainly so that a usage spike can never make bookings fail. The code needs no changes for the upgrade.

## 13. WhatsApp (MVP: click-to-chat)

**How it works:** the dashboard builds a link `https://wa.me/<patient_phone>?text=<message>`. It opens WhatsApp (app or web) on the receptionist's device, signed in to the center's WhatsApp number, with the message pre-filled. The receptionist presses **Send**, and the click is recorded in `message_log`.

**Templates** (editable in Settings, sent in the patient's preferred language). Placeholders: `{patient_name}`, `{doctor_name}`, `{specialty}`, `{booking_type}`, `{date}`, `{time}`, `{price}`, `{reference}`, `{center_name}`, `{center_address}`, `{map_url}`.

| Key | English (default) | Arabic (default) |
|---|---|---|
| confirmation | Hello {patient_name}, your {booking_type} with {doctor_name} is confirmed for {date} at {time}. Fee: {price} (cash). Ref: {reference}. Location: {map_url} — {center_name} | مرحباً {patient_name}، تم تأكيد موعد {booking_type} مع {doctor_name} يوم {date} الساعة {time}. الرسوم: {price} (نقداً). رقم الحجز: {reference}. الموقع: {map_url} — {center_name} |
| reminder | Reminder: your appointment with {doctor_name} is on {date} at {time}. To change it, please reply to this message. — {center_name} | تذكير: موعدك مع {doctor_name} يوم {date} الساعة {time}. للتعديل يرجى الرد على هذه الرسالة. — {center_name} |
| rescheduled | Your appointment with {doctor_name} has been moved to {date} at {time}. Ref: {reference}. — {center_name} | تم تغيير موعدك مع {doctor_name} إلى يوم {date} الساعة {time}. رقم الحجز: {reference}. — {center_name} |
| cancelled | Your appointment with {doctor_name} on {date} at {time} has been cancelled. Contact us to book another time. — {center_name} | تم إلغاء موعدك مع {doctor_name} يوم {date} الساعة {time}. تواصل معنا لحجز موعد آخر. — {center_name} |
| request_followup | Hello {patient_name}, we received your request to see {doctor_name}. Which day and time suit you? — {center_name} | مرحباً {patient_name}، استلمنا طلبك لحجز موعد مع {doctor_name}. ما اليوم والوقت المناسب لك؟ — {center_name} |

The Arabic texts are drafts; the center should review them.

**Reminders in the MVP:** the Today screen has a **"Tomorrow's reminders"** list. Each row has a send button, so reception can work through the list quickly.

**Why the WhatsApp API is not planned:** Meta's WhatsApp Business Platform (Cloud API) lists Syria as not eligible. Businesses in Syria can't use it, and WhatsApp users in Syria can't receive messages sent through it. Unofficial automation tools that drive a normal WhatsApp account break WhatsApp's terms and can get the center's number banned, so they are **not** used.

**Phase 2 automation options** (built behind the same `/notify` module):
- **SMS** through a local Syrian bulk-SMS provider (via the mobile operators) for automatic confirmations, reminders and phone verification codes. Cost and API availability to be checked.
- **Web push notifications** from the PWA, for patients who allow them. Free, but on iPhone it needs the site added to the home screen.
- **Telegram bot**, if the center's patients use Telegram.
- **WhatsApp API**, only if Meta adds Syria to the eligible countries in future.

## 14. Localisation and mobile

- Every user-facing text comes from translation files; nothing is hard-coded.
- Every content field (doctor, specialty, center) is entered in both languages. If one is missing, the other is shown.
- RTL layout is mirrored correctly: icons, arrows, calendar direction.
- Dates follow the language (e.g. "السبت ٢٨ نوفمبر" / "Sat 28 Nov"). Digit style (Western or Arabic-Indic) is a center setting (to confirm).
- Phone input with a preset country code, accepting local formats and normalising to E.164.
- Website and dashboard are tested on small screens (360 px wide) in both languages.

## 15. Security and privacy

- **Minimal data**: names, phone numbers, appointment details, administrative notes. **No diagnoses or medical records** in the MVP. Note that the specialty booked already implies some health context.
- HTTPS everywhere. Session cookies are secure and HTTP-only, with CSRF protection.
- Every dashboard request checks the user's role on the server.
- Passwords are hashed with a strong algorithm, and login attempts are rate-limited.
- Public endpoints return only public data. Patient data is never exposed on the website, and the booking-received page shows only the reference and summary.
- Audit log for appointment, payment and settings changes.
- **Data residency**: Cloudflare D1 does not guarantee storage in a specific country. Syria's Law No. 12 of 2024 on electronic personal data is the relevant law; no explicit in-country storage rule for this kind of data was found, but its application after the 2024–25 transition is unclear. **Confirm with a Syrian lawyer** before go-live (§19). If in-country storage turns out to be required, the database layer moves to a local PostgreSQL host; Drizzle keeps that change contained.
- A privacy notice on the website, and patient consent at booking (a checkbox with a link).

## 16. Delivery plan (estimate)

**Progress:** M0–M4 are done.

- **M4:** reception operations. The Today screen (pending online bookings oldest first with one-click "Confirm + WhatsApp", new requests count, today's agenda with doctor and status filters and quick check-in / complete / no-show, tomorrow's reminders with a sent mark), the calendar (day view with doctors as columns, week view for one doctor, sessions as background blocks, cards coloured by status, click an empty time to book), the appointment panel (status actions, cancel with reason, reschedule and type change with override after a warning, Re-visit check, WhatsApp with a template choice, internal note, history), new appointments by phone, WhatsApp or walk-in (patient search or inline new patient, free times by day, override), the booking requests inbox (tabs, convert, mark contacted, decline, WhatsApp follow-up) and patients (search, profile, edit, history, merge duplicates for managers). "Mark paid" on the Today screen comes with payments in M5.

- **M3:** the public website. A landing page with sections (hero with booking and WhatsApp buttons, specialties, featured doctors, a "For patients" section with how to book, good-to-know points and FAQ, about, visit us with address, hours, map and contact, and a closing call to action), header navigation with a no-JavaScript phone menu, footer, floating WhatsApp button, specialty and doctor pages with filters, the booking flow (type → day → time → details → reference code and WhatsApp link), booking requests when no time suits, privacy notice, 404, sitemap and robots. The public API serves only public fields, re-checks every slot, limits submissions per network and phone, and verifies Turnstile.

- **M2:** the availability planner (per-doctor week view starting Saturday, add/edit/close/delete sessions, a warning that lists booked patients before a change affects them, copy previous week with a preview), the slot engine shared by the dashboard and the website, a reception slots endpoint, and the single-statement "book only if still free" insert that prevents double booking.

- **M1:** the platform console (centers, center users, support mode with audit flag, activity log, TOTP two-factor for the Super admin), forced password change for temporary passwords, and center configuration: settings, logo, WhatsApp templates, staff accounts, specialties, doctors with photos, and booking types with length and price per doctor. The "platform health" usage panel (§11.13) is deferred: it needs the Cloudflare API and a token, and the Cloudflare dashboard already shows usage.
- **M0:** The monorepo, Cloudflare configuration, full database schema and first migration, staff sign-in (sessions, rate limiting, CSRF protection, audit log), the bilingual dashboard shell and the website shell are built, with automated tests and CI.

| Milestone | Content | Estimate |
|---|---|---|
| M0 | Project setup: monorepo (web, dashboard, api, shared), CI, Cloudflare environments, i18n/RTL base, auth, database schema | 1 week |
| M1 | Configuration: platform console (centers, center users, support access, 2FA), specialties, doctors (profiles and photos), booking types and prices, center settings, users | 2 weeks |
| M2 | Availability planner and the slot engine (with tests) | 1 week |
| M3 | Public website and the booking/request flow | 2 weeks |
| M4 | Reception operations: Today screen, calendar, appointment panel, requests inbox, patients, WhatsApp links and templates | 2 weeks |
| M5 | Cash payments, daily cash report, appointments report, audit log | 1 week |
| M6 | Pilot preparation: real data entry with the center, staff training, acceptance testing, fixes, go-live | 1–2 weeks |

**Total: about 10–11 weeks** for one developer. Faster with two.

### Key acceptance criteria
- A patient on a phone can book an available slot in Arabic or English in under 2 minutes.
- Two patients can never hold the same doctor and time.
- A doctor with no open session can only receive booking requests.
- Reception can confirm a pending booking and send the WhatsApp confirmation in two clicks.
- The daily cash report total matches the sum of payments recorded that day.
- Changing a doctor's price changes only future bookings (appointments keep their price snapshot).

## 17. Open questions (for the session with management)

1. **Legal check in Syria** (with a local lawyer): Law No. 12 of 2024 on personal data, whether hosting abroad is allowed, consent wording, and any Ministry of Health or Syrian Medical Syndicate rules on publishing doctor profiles and prices online.
2. Lengths and prices for each doctor and booking type (initial data).
3. Slot step (10 min?), minimum notice for online booking (2 hours?), how far ahead patients can book (30 days?).
4. Default website language (Arabic?) and digit style.
5. Which WhatsApp number to use (a center number on a dedicated phone with the WhatsApp Business app), and who holds the device.
12. Prices in the **new Syrian pound** only, or also shown in USD?
13. Does reception have a backup internet connection (for example, mobile data) and power backup at the front desk?
6. Patient details to collect: name and phone only, or also gender and date of birth?
7. Should doctors get dashboard access in the MVP?
8. Domain name, logo, brand colours, photos of the center and doctors.
9. Are discounts allowed at reception, and who can approve them?
10. Center holidays and closures: shown on the website?
11. The wording of the privacy notice and consent text.

## 18. Out of scope for the MVP (future phases)

- **Phase 2**: automatic confirmations, reminders and phone verification through SMS or web push (§13), waiting list, patient reviews, richer analytics.
- **Phase 3**: native mobile app, patient accounts (self-service reschedule and cancel requests), online payments and deposits, multiple branches, multi-center SaaS (self-service center onboarding, subscription billing, custom domains; the Super admin console already exists from the MVP).
- **Not planned without a separate compliance review**: medical records, prescriptions, lab results, video consultations.

## 19. Syria-specific considerations

### 19.1 Defaults
| Setting | Value |
|---|---|
| Currency | New Syrian pound (SYP, new notes since 1 Jan 2026; 100 old = 1 new). Prices are entered in new pounds. Optional USD display (open question). |
| Phone | Country code +963. Local mobile format `09XXXXXXXX` is accepted and stored as `+9639XXXXXXXX`. |
| Time zone | `Asia/Damascus` (UTC+3 all year) |
| Weekend | Friday (confirm whether the center also closes on Saturday). The calendar week starts on Saturday. |
| Default language | Arabic, with Levantine-friendly wording in messages (to be reviewed by the center) |

### 19.2 Sanctions and service availability
US comprehensive sanctions on Syria were lifted in 2025, and the State Sponsor of Terrorism designation was rescinded in August 2026. Some export-control and targeted restrictions remain. In practice:
- **Cloudflare, GitHub and similar US services**: sign-up should now be possible, but check each provider's current terms when opening accounts. Accounts are opened honestly, with no tools to hide the location.
- **Payment cards**: Syrian bank cards are often not accepted by international services. This matters if R2 asks for a card and when upgrading to Workers Paid (USD 5/month). Decide early whose card is used.
- **WhatsApp Business API**: not available (§13). The WhatsApp app and click-to-chat links work.

### 19.3 Unreliable internet and power
- Public pages stay light (Astro, compressed images) for slow mobile connections.
- The dashboard is a PWA: it keeps showing the last loaded agenda when the connection drops, with a clear "offline" banner, and blocks changes until it reconnects (so there are no conflicting bookings).
- A **printable daily list** per doctor, so reception can keep working during a long outage and enter changes afterwards.
- Reception should have a mobile-data backup connection.
