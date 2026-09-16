CREATE TABLE `bookings` (
  `id` text PRIMARY KEY NOT NULL,
  `reference` text NOT NULL,
  `request_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  `arrival_at` integer NOT NULL,
  `eta_minutes` integer NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `customer_name` text NOT NULL,
  `phone` text NOT NULL,
  `address` text NOT NULL,
  `city` text NOT NULL,
  `state` text DEFAULT 'FL' NOT NULL,
  `zip` text NOT NULL,
  `grocery_load` text NOT NULL,
  `stairs` integer NOT NULL,
  `notes` text NOT NULL,
  `contact_consent` integer NOT NULL,
  `source_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_reference_unique` ON `bookings` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_bookings_source_created` ON `bookings` (`source_key`,`created_at`);
