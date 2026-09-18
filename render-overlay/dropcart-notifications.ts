import type { BookingData } from "./booking-data";

type PgPool = import("pg").Pool;

const runtimeGlobal = globalThis as typeof globalThis & { __dropcartPgPool?: PgPool };

function normalizePhone(value: string) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (raw.startsWith("+") && digits.length >= 10) return "+" + digits;
  return "";
}

function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  );
}

async function twilioPost(resource: "Messages" | "Calls", params: Record<string, string>) {
  if (!twilioConfigured()) return { ok: false, skipped: true };

  const sid = String(process.env.TWILIO_ACCOUNT_SID);
  const token = String(process.env.TWILIO_AUTH_TOKEN);
  const response = await fetch(
    "https://api.twilio.com/2010-04-01/Accounts/" + sid + "/" + resource + ".json",
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(sid + ":" + token),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    },
  );

  if (!response.ok) {
    console.error("[notify] Twilio request failed", resource, response.status);
    return { ok: false, skipped: false };
  }

  return { ok: true, skipped: false };
}

async function sendSms(to: string, body: string) {
  const phone = normalizePhone(to);
  if (!phone) return;
  await twilioPost("Messages", {
    To: phone,
    From: String(process.env.TWILIO_FROM_NUMBER || ""),
    Body: body,
  });
}

async function makeCall(to: string, message: string) {
  const phone = normalizePhone(to);
  if (!phone) return;
  const safe = String(message).replaceAll("&", "and").replaceAll("<", "").replaceAll(">", "");
  await twilioPost("Calls", {
    To: phone,
    From: String(process.env.TWILIO_FROM_NUMBER || ""),
    Twiml:
      "<Response><Say>" +
      safe +
      "</Say><Pause length=\"1\"/><Say>Open the Dropcart employee dashboard now.</Say></Response>",
  });
}

async function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!runtimeGlobal.__dropcartPgPool) {
    const { Pool } = await import("pg");
    runtimeGlobal.__dropcartPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
    });
  }
  return runtimeGlobal.__dropcartPgPool;
}

async function ensureTables(pool: PgPool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dropcart_bookings (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      created_at BIGINT NOT NULL,
      arrival_at BIGINT NOT NULL,
      eta_minutes INTEGER NOT NULL,
      status TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      zip TEXT NOT NULL,
      grocery_load TEXT NOT NULL,
      stairs BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT NOT NULL DEFAULT '',
      contact_consent BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "ALTER TABLE dropcart_bookings ADD COLUMN IF NOT EXISTS contact_consent BOOLEAN NOT NULL DEFAULT FALSE",
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_notification_settings (
      employee_email TEXT PRIMARY KEY,
      phone TEXT NOT NULL DEFAULT '',
      sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      call_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function syncBookingToPostgresAndNotify(
  data: BookingData,
  reference: string,
  status: string,
  now: number,
) {
  const pool = await getPool();
  if (!pool) return;

  try {
    await ensureTables(pool);

    await pool.query(
      `INSERT INTO dropcart_bookings
        (id, reference, created_at, arrival_at, eta_minutes, status, customer_name, phone, address, city, state, zip, grocery_load, stairs, notes, contact_consent, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
       ON CONFLICT (id) DO UPDATE SET
         reference=EXCLUDED.reference,
         arrival_at=EXCLUDED.arrival_at,
         eta_minutes=EXCLUDED.eta_minutes,
         status=EXCLUDED.status,
         customer_name=EXCLUDED.customer_name,
         phone=EXCLUDED.phone,
         address=EXCLUDED.address,
         city=EXCLUDED.city,
         state=EXCLUDED.state,
         zip=EXCLUDED.zip,
         grocery_load=EXCLUDED.grocery_load,
         stairs=EXCLUDED.stairs,
         notes=EXCLUDED.notes,
         contact_consent=EXCLUDED.contact_consent,
         updated_at=NOW()`,
      [
        data.requestId,
        reference,
        now,
        now + data.eta * 60000,
        data.eta,
        status,
        data.name,
        data.phone,
        data.address,
        data.city,
        "FL",
        data.zip,
        data.load,
        data.stairs,
        data.notes,
        Boolean(data.consent),
      ],
    );

    if (data.consent) {
      void sendSms(
        data.phone,
        "Dropcart: We received " +
          reference +
          ". We’ll text you when a team member claims it. Reply STOP to opt out.",
      ).catch((error) => console.error("[notify] customer receipt SMS failed", error));
    }

    const alertRows = await pool.query(
      "SELECT phone, sms_enabled, call_enabled FROM employee_notification_settings WHERE phone <> '' AND (sms_enabled = TRUE OR call_enabled = TRUE)",
    );

    const loadLabel =
      data.load === "small"
        ? "1 to 5 bags"
        : data.load === "large"
          ? "16 plus bags"
          : "6 to 15 bags";

    for (const alert of alertRows.rows) {
      const text =
        "URGENT Dropcart: New unload " +
        reference +
        ". " +
        loadLabel +
        ", " +
        data.city +
        ". Open the employee dashboard now.";

      if (alert.sms_enabled) {
        void sendSms(alert.phone, text).catch((error) =>
          console.error("[notify] employee SMS failed", error),
        );
      }

      if (alert.call_enabled) {
        void makeCall(
          alert.phone,
          "Urgent Dropcart booking. New unload " + reference + " in " + data.city + ".",
        ).catch((error) => console.error("[notify] employee call failed", error));
      }
    }
  } catch (error) {
    console.error("[employee] booking mirror/notification failed", error);
  }
}
