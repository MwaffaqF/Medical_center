CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text NOT NULL,
	`reference_code` text NOT NULL,
	`patient_id` text NOT NULL,
	`doctor_id` text NOT NULL,
	`booking_type` text NOT NULL,
	`session_id` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`price_snapshot` integer NOT NULL,
	`revisit_flag` integer DEFAULT false NOT NULL,
	`is_override` integer DEFAULT false NOT NULL,
	`patient_note` text,
	`internal_note` text,
	`cancel_reason` text,
	`cancelled_by` text,
	`confirmed_at` integer,
	`checked_in_at` integer,
	`completed_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `availability_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_center_ref_uq` ON `appointments` (`center_id`,`reference_code`);--> statement-breakpoint
CREATE INDEX `appointments_doctor_start_idx` ON `appointments` (`doctor_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `appointments_center_start_idx` ON `appointments` (`center_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `appointments_patient_idx` ON `appointments` (`patient_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text,
	`user_id` text,
	`entity` text NOT NULL,
	`entity_id` text,
	`action` text NOT NULL,
	`changes` text,
	`is_support_action` integer DEFAULT false NOT NULL,
	`ip` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_center_at_idx` ON `audit_log` (`center_id`,`at`);--> statement-breakpoint
CREATE TABLE `availability_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text NOT NULL,
	`doctor_id` text NOT NULL,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `availability_doctor_date_idx` ON `availability_sessions` (`doctor_id`,`date`);--> statement-breakpoint
CREATE TABLE `booking_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text NOT NULL,
	`reference_code` text NOT NULL,
	`patient_id` text NOT NULL,
	`doctor_id` text NOT NULL,
	`booking_type` text NOT NULL,
	`preferred_date` text,
	`preferred_period` text DEFAULT 'any' NOT NULL,
	`patient_note` text,
	`status` text DEFAULT 'new' NOT NULL,
	`appointment_id` text,
	`handled_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`handled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_requests_center_ref_uq` ON `booking_requests` (`center_id`,`reference_code`);--> statement-breakpoint
CREATE INDEX `booking_requests_center_status_idx` ON `booking_requests` (`center_id`,`status`);--> statement-breakpoint
CREATE TABLE `cash_day_closures` (
	`center_id` text NOT NULL,
	`date` text NOT NULL,
	`closed_by` text NOT NULL,
	`closed_at` integer NOT NULL,
	`total` integer NOT NULL,
	PRIMARY KEY(`center_id`, `date`),
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `centers` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`logo_url` text,
	`phone` text,
	`whatsapp_phone` text,
	`address_ar` text,
	`address_en` text,
	`map_url` text,
	`opening_hours_ar` text,
	`opening_hours_en` text,
	`about_ar` text,
	`about_en` text,
	`timezone` text DEFAULT 'Asia/Damascus' NOT NULL,
	`default_country_code` text DEFAULT '963' NOT NULL,
	`currency` text DEFAULT 'SYP' NOT NULL,
	`default_locale` text DEFAULT 'ar' NOT NULL,
	`slot_step_minutes` integer DEFAULT 10 NOT NULL,
	`min_lead_minutes` integer DEFAULT 120 NOT NULL,
	`max_advance_days` integer DEFAULT 30 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `centers_slug_uq` ON `centers` (`slug`);--> statement-breakpoint
CREATE TABLE `doctor_services` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text NOT NULL,
	`doctor_id` text NOT NULL,
	`booking_type` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`price` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`notes_ar` text,
	`notes_en` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doctor_services_doctor_type_uq` ON `doctor_services` (`doctor_id`,`booking_type`);--> statement-breakpoint
CREATE TABLE `doctor_specialties` (
	`doctor_id` text NOT NULL,
	`specialty_id` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`doctor_id`, `specialty_id`),
	FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`specialty_id`) REFERENCES `specialties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `doctors` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text NOT NULL,
	`slug` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`title_ar` text,
	`title_en` text,
	`photo_url` text,
	`bio_ar` text,
	`bio_en` text,
	`qualifications_ar` text,
	`qualifications_en` text,
	`languages` text DEFAULT '[]' NOT NULL,
	`gender` text,
	`years_experience` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doctors_center_slug_uq` ON `doctors` (`center_id`,`slug`);--> statement-breakpoint
CREATE TABLE `message_log` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text NOT NULL,
	`appointment_id` text,
	`request_id` text,
	`template_key` text NOT NULL,
	`channel` text DEFAULT 'whatsapp_link' NOT NULL,
	`sent_by` text,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `booking_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sent_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `message_log_appointment_idx` ON `message_log` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text NOT NULL,
	`key` text NOT NULL,
	`body_ar` text NOT NULL,
	`body_en` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_templates_center_key_uq` ON `message_templates` (`center_id`,`key`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text NOT NULL,
	`full_name` text NOT NULL,
	`phone` text NOT NULL,
	`gender` text,
	`date_of_birth` text,
	`preferred_locale` text DEFAULT 'ar' NOT NULL,
	`notes` text,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `patients_center_phone_idx` ON `patients` (`center_id`,`phone`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`amount` integer NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`received_by` text NOT NULL,
	`received_at` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `payments_center_received_idx` ON `payments` (`center_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `payments_appointment_idx` ON `payments` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`support_center_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`support_center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `specialties` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text NOT NULL,
	`slug` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`description_ar` text,
	`description_en` text,
	`icon` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `specialties_center_slug_uq` ON `specialties` (`center_id`,`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`center_id` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`preferred_locale` text DEFAULT 'ar' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`totp_secret` text,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`center_id`) REFERENCES `centers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_center_idx` ON `users` (`center_id`);