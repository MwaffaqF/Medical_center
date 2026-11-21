# Medical Center Booking System — MVP Specification

| | |
|---|---|
| **Status** | Draft v0.1 — for review with center management |
| **Date** | 2026-11-21 |
| **Scope** | MVP / pilot for the first center |

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
| D10 | WhatsApp in the MVP = **click-to-chat links** (`wa.me`) | The Meta WhatsApp Cloud API comes in Phase 2, behind the same notification module. |
| D11 | Hosting on **Cloudflare** | Workers, D1, R2 and Turnstile. See §12. |
| D12 | The system is run by **receptionists** | The center manager configures it; doctors get read-only access (optional). |

## 4. Users and roles

| Role | Who | Can do |
|---|---|---|
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
`name_ar`, `name_en`, `slug`, `logo_url`, `phone`, `whatsapp_phone`, `address_ar`, `address_en`, `map_url`, `timezone`, `default_country_code`, `opening_hours_ar`, `opening_hours_en`, `about_ar`, `about_en`, booking rules (`slot_step_minutes`, `min_lead_minutes`, `max_advance_days`), `default_language`.

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
`name`, `email`, `password_hash`, `role` (`manager` | `receptionist` | `doctor`), `is_active`, `last_login_at`.

### message_templates
`key` (`confirmation` | `reminder` | `rescheduled` | `cancelled` | `request_followup`), `body_ar`, `body_en`.

### message_log
`appointment_id` or `request_id`, `template_key`, `channel` (`whatsapp_link`), `sent_by`, `sent_at`.
Click-to-chat can't confirm delivery, so this only records that staff opened the message.

### audit_log
`user_id`, `entity`, `entity_id`, `action`, `changes` (JSON), `at`.

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

## 12. Technical architecture (Cloudflare)

| Layer | Choice |
|---|---|
| Framework | **Next.js** (App Router, TypeScript), deployed to **Cloudflare Workers** with the `@opennextjs/cloudflare` adapter. Fallback if the adapter causes problems: React Router or Hono on Workers. |
| UI | Tailwind CSS with RTL support (logical properties) and an accessible component library |
| Internationalisation | `next-intl`: Arabic and English, `dir="rtl"` for Arabic, locale-aware date, time and currency formats |
| Database | **Cloudflare D1** (SQLite) through **Drizzle ORM** and migrations. Drizzle keeps a later move to PostgreSQL (through Hyperdrive) possible. |
| File storage | **Cloudflare R2**: doctor photos, logo, images (resized before upload) |
| Bot protection | **Cloudflare Turnstile** on the public booking and request forms |
| Rate limiting | Cloudflare rate-limiting rules plus per-phone limits in the app |
| Staff authentication | Email and password with secure, HTTP-only session cookies (e.g. Better Auth with D1), role-based access checks on the server |
| Scheduled jobs | Cron Triggers: daily database export to R2, highlighting stale pending items. Later: WhatsApp API reminders. |
| Backups | D1 Time Travel (point-in-time restore) plus a daily export to R2 |
| Environments | `staging` and `production` (separate D1 and R2 resources) |
| CI/CD | GitHub Actions: lint, type-check, tests, deploy with Wrangler |
| Monitoring | Cloudflare Workers logs and analytics, plus error tracking |

### Code structure (planned)
```
/app
  /[locale]/(public)/...     public website
  /[locale]/dashboard/...    staff dashboard
  /api/...                   API routes (also used by the future mobile app)
/src
  /db        Drizzle schema and migrations
  /domain    booking rules: slot calculation, status transitions, re-visit check
  /notify    notification module (WhatsApp link builder now, Cloud API later)
  /i18n      messages: ar.json, en.json
```

**API-first:** the booking logic lives in `/src/domain` and is exposed through `/api`, so a future mobile app reuses it.

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

**Phase 2 (WhatsApp Cloud API):**
- Meta Business verification and approved utility templates.
- Automatic confirmation and reminders (Cron Triggers and Queues), phone verification codes on the website.
- Later, a booking chatbot.
- The `/src/notify` module switches from building links to API calls; the dashboard flows stay the same.

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
- **Data residency**: Cloudflare D1 does not guarantee storage in a specific country. The applicable local health and personal-data law must be confirmed (§17). If in-country storage is required, the database layer moves to a local PostgreSQL host; Drizzle keeps that change contained.
- A privacy notice on the website, and patient consent at booking (a checkbox with a link).

## 16. Delivery plan (estimate)

| Milestone | Content | Estimate |
|---|---|---|
| M0 | Project setup: repo, CI, Cloudflare environments, i18n/RTL base, auth, database schema | 1 week |
| M1 | Configuration: specialties, doctors (profiles and photos), booking types and prices, center settings, users | 1.5 weeks |
| M2 | Availability planner and the slot engine (with tests) | 1 week |
| M3 | Public website and the booking/request flow | 2 weeks |
| M4 | Reception operations: Today screen, calendar, appointment panel, requests inbox, patients, WhatsApp links and templates | 2 weeks |
| M5 | Cash payments, daily cash report, appointments report, audit log | 1 week |
| M6 | Pilot preparation: real data entry with the center, staff training, acceptance testing, fixes, go-live | 1–2 weeks |

**Total: about 9–10 weeks** for one developer. Faster with two.

### Key acceptance criteria
- A patient on a phone can book an available slot in Arabic or English in under 2 minutes.
- Two patients can never hold the same doctor and time.
- A doctor with no open session can only receive booking requests.
- Reception can confirm a pending booking and send the WhatsApp confirmation in two clicks.
- The daily cash report total matches the sum of payments recorded that day.
- Changing a doctor's price changes only future bookings (appointments keep their price snapshot).

## 17. Open questions (for the session with management)

1. **Country of the center**, and whether local law requires health or patient data to be stored in the country. This affects §12 and §15.
2. Lengths and prices for each doctor and booking type (initial data).
3. Slot step (10 min?), minimum notice for online booking (2 hours?), how far ahead patients can book (30 days?).
4. Default website language (Arabic?) and digit style.
5. Which WhatsApp number to use (a center number on a dedicated phone, preferably WhatsApp Business), and who holds the device.
6. Patient details to collect: name and phone only, or also gender and date of birth?
7. Should doctors get dashboard access in the MVP?
8. Domain name, logo, brand colours, photos of the center and doctors.
9. Are discounts allowed at reception, and who can approve them?
10. Center holidays and closures: shown on the website?
11. The wording of the privacy notice and consent text.

## 18. Out of scope for the MVP (future phases)

- **Phase 2**: WhatsApp Cloud API (automatic confirmations and reminders, phone verification codes), WhatsApp booking chatbot, waiting list, patient reviews, richer analytics.
- **Phase 3**: native mobile app, patient accounts (self-service reschedule and cancel requests), online payments and deposits, multiple branches, multi-center SaaS (center onboarding, platform admin, billing, custom domains).
- **Not planned without a separate compliance review**: medical records, prescriptions, lab results, video consultations.
