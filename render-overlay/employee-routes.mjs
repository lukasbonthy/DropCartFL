import { timingSafeEqual } from "node:crypto";
import express from "express";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const employeeJson = express.json({ limit: "32kb" });
const customerJson = express.json({ limit: "32kb" });

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(value || "").trim().startsWith("+") && digits.length >= 10) return "+" + digits;
  return "";
}

function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  );
}

async function twilioPost(resource, params) {
  if (!twilioConfigured()) {
    console.info("[notify] Twilio not configured; skipping", resource);
    return { ok: false, skipped: true };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/${resource}.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${sid}:${token}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[notify] Twilio request failed", resource, response.status, detail.slice(0, 300));
    return { ok: false, skipped: false };
  }

  return { ok: true, skipped: false };
}

async function sendSms(to, body) {
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, skipped: true };
  return twilioPost("Messages", {
    To: phone,
    From: process.env.TWILIO_FROM_NUMBER || "",
    Body: body,
  });
}

async function makeUrgentCall(to, message) {
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, skipped: true };
  const safe = String(message)
    .replaceAll("&", "and")
    .replaceAll("<", "")
    .replaceAll(">", "");
  return twilioPost("Calls", {
    To: phone,
    From: process.env.TWILIO_FROM_NUMBER || "",
    Twiml: `<Response><Say>${safe}</Say><Pause length="1"/><Say>Open the Dropcart employee dashboard now.</Say></Response>`,
  });
}

async function customerStatusText(booking, status) {
  if (!booking?.contact_consent || !booking?.phone) return;
  const ref = booking.reference || "your booking";
  const messages = {
    accepted: `Dropcart: ${ref} has been claimed by a team member. We’ll keep you updated here. Reply STOP to opt out.`,
    en_route: `Dropcart: Your helper is on the way for ${ref}. Please have your groceries ready for unloading.`,
    arrived: `Dropcart: Your helper has arrived for ${ref}.`,
    completed: `Dropcart: ${ref} is marked complete. Thanks for using Dropcart!`,
  };
  const body = messages[status];
  if (!body) return;
  await sendSms(booking.phone, body);
}

async function ensureEmployeeTables() {
  await pool.query("CREATE TABLE IF NOT EXISTS employee_assignments (booking_id TEXT PRIMARY KEY, employee_email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'accepted', accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS employee_profiles (employee_email TEXT PRIMARY KEY, online BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS dropcart_bookings (id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, created_at BIGINT NOT NULL, arrival_at BIGINT NOT NULL, eta_minutes INTEGER NOT NULL, status TEXT NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL, zip TEXT NOT NULL, grocery_load TEXT NOT NULL, stairs BOOLEAN NOT NULL DEFAULT FALSE, notes TEXT NOT NULL DEFAULT '', contact_consent BOOLEAN NOT NULL DEFAULT FALSE, code_word TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("ALTER TABLE dropcart_bookings ADD COLUMN IF NOT EXISTS contact_consent BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE dropcart_bookings ADD COLUMN IF NOT EXISTS code_word TEXT NOT NULL DEFAULT ''");
  await pool.query("CREATE TABLE IF NOT EXISTS employee_notification_settings (employee_email TEXT PRIMARY KEY, phone TEXT NOT NULL DEFAULT '', sms_enabled BOOLEAN NOT NULL DEFAULT TRUE, call_enabled BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS driver_locations (booking_id TEXT PRIMARY KEY, employee_email TEXT NOT NULL, latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL, accuracy DOUBLE PRECISION, heading DOUBLE PRECISION, speed DOUBLE PRECISION, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS booking_messages (id BIGSERIAL PRIMARY KEY, booking_id TEXT NOT NULL, sender_role TEXT NOT NULL, sender_label TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS booking_messages_booking_idx ON booking_messages (booking_id, id)");
}

function allowedEmails() {
  return String(process.env.EMPLOYEE_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function requireEmployee(req, res, next) {
  const email = String(req.session?.user?.email || "").trim().toLowerCase();
  if (!email) return res.status(401).json({ error: "Please sign in first." });
  if (!allowedEmails().includes(email)) return res.status(403).json({ error: "This account is not enabled for the employee portal." });
  req.employeeEmail = email;
  next();
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function earningsCents(load, stairs) {
  return (load === "small" ? 1499 : load === "large" ? 2799 : 1999) + (stairs ? 500 : 0);
}

function employeeName(req) {
  return req.session?.user?.displayName || req.session?.user?.name || "Employee";
}

function cleanMessage(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 1000);
}

async function getCustomerBooking(reference, token) {
  const result = await pool.query(
    `SELECT b.*, ea.employee_email, ea.status AS assignment_status,
       dl.latitude, dl.longitude, dl.accuracy, dl.heading, dl.speed, dl.updated_at AS location_updated_at
     FROM dropcart_bookings b
     LEFT JOIN employee_assignments ea ON ea.booking_id = b.id
     LEFT JOIN driver_locations dl ON dl.booking_id = b.id
     WHERE b.reference = $1 AND b.id = $2
     LIMIT 1`,
    [String(reference || "").trim().toUpperCase(), String(token || "").trim()],
  );
  return result.rows[0] || null;
}

async function getMessages(bookingId) {
  const result = await pool.query(
    "SELECT id, sender_role, sender_label, body, created_at FROM booking_messages WHERE booking_id = $1 ORDER BY id ASC LIMIT 120",
    [bookingId],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    senderRole: row.sender_role,
    senderLabel: row.sender_label,
    body: row.body,
    createdAt: new Date(row.created_at).getTime(),
  }));
}

export function installEmployeeRoutes(app) {
  void ensureEmployeeTables().catch((error) => console.error("[employee] table setup failed", error));

  app.get("/api/customer/bookings/:reference", async (req, res) => {
    try {
      await ensureEmployeeTables();
      const token = String(req.query?.token || "");
      const booking = await getCustomerBooking(req.params.reference, token);
      if (!booking) return res.status(404).json({ error: "We couldn't verify that secure tracking link." });

      const messages = await getMessages(booking.id);
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        booking: {
          id: booking.id,
          reference: booking.reference,
          status: booking.status,
          assignmentStatus: booking.assignment_status || null,
          arrivalAt: Number(booking.arrival_at),
          etaMinutes: Number(booking.eta_minutes),
          customerName: booking.customer_name,
          address: booking.address,
          city: booking.city,
          state: booking.state,
          zip: booking.zip,
          codeWord: booking.code_word || "",
          assigned: Boolean(booking.employee_email),
        },
        driverLocation:
          booking.employee_email && Number.isFinite(Number(booking.latitude)) && Number.isFinite(Number(booking.longitude))
            ? {
                latitude: Number(booking.latitude),
                longitude: Number(booking.longitude),
                accuracy: booking.accuracy == null ? null : Number(booking.accuracy),
                heading: booking.heading == null ? null : Number(booking.heading),
                speed: booking.speed == null ? null : Number(booking.speed),
                updatedAt: booking.location_updated_at ? new Date(booking.location_updated_at).getTime() : null,
              }
            : null,
        messages,
      });
    } catch (error) {
      console.error("[customer] tracking load failed", error);
      return res.status(500).json({ error: "We couldn't load tracking right now." });
    }
  });

  app.post("/api/customer/bookings/:reference/messages", customerJson, async (req, res) => {
    try {
      await ensureEmployeeTables();
      const booking = await getCustomerBooking(req.params.reference, req.body?.token);
      if (!booking) return res.status(404).json({ error: "We couldn't verify that secure tracking link." });
      const body = cleanMessage(req.body?.body);
      if (!body) return res.status(400).json({ error: "Write a message first." });

      const result = await pool.query(
        "INSERT INTO booking_messages (booking_id, sender_role, sender_label, body) VALUES ($1, 'customer', $2, $3) RETURNING id, created_at",
        [booking.id, booking.customer_name || "Customer", body],
      );
      return res.json({
        ok: true,
        message: {
          id: Number(result.rows[0].id),
          senderRole: "customer",
          senderLabel: booking.customer_name || "Customer",
          body,
          createdAt: new Date(result.rows[0].created_at).getTime(),
        },
      });
    } catch (error) {
      console.error("[customer] message failed", error);
      return res.status(500).json({ error: "We couldn't send that message." });
    }
  });

  app.get("/api/employee/access", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = String(req.session?.user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ authenticated: false, employee: false });
    return res.json({ authenticated: true, employee: allowedEmails().includes(email) });
  });

  app.get("/api/employee/notification-settings", requireEmployee, async (req, res) => {
    try {
      await ensureEmployeeTables();
      const result = await pool.query(
        "SELECT phone, sms_enabled, call_enabled FROM employee_notification_settings WHERE employee_email = $1",
        [req.employeeEmail],
      );
      const row = result.rows[0] || {};
      res.json({
        phone: row.phone || "",
        smsEnabled: row.sms_enabled ?? true,
        callEnabled: row.call_enabled ?? true,
        providerConfigured: twilioConfigured(),
      });
    } catch (error) {
      console.error("[notify] settings load failed", error);
      res.status(500).json({ error: "We couldn't load notification settings." });
    }
  });

  app.post("/api/employee/notification-settings", employeeJson, requireEmployee, async (req, res) => {
    try {
      await ensureEmployeeTables();
      const phone = normalizePhone(req.body?.phone);
      const smsEnabled = Boolean(req.body?.smsEnabled);
      const callEnabled = Boolean(req.body?.callEnabled);

      if ((smsEnabled || callEnabled) && !phone) {
        return res.status(400).json({ error: "Enter a valid U.S. phone number for alerts." });
      }

      await pool.query(
        `INSERT INTO employee_notification_settings (employee_email, phone, sms_enabled, call_enabled, updated_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (employee_email) DO UPDATE SET
           phone=EXCLUDED.phone, sms_enabled=EXCLUDED.sms_enabled,
           call_enabled=EXCLUDED.call_enabled, updated_at=NOW()`,
        [req.employeeEmail, phone, smsEnabled, callEnabled],
      );

      res.json({ ok: true, phone, smsEnabled, callEnabled, providerConfigured: twilioConfigured() });
    } catch (error) {
      console.error("[notify] settings save failed", error);
      res.status(500).json({ error: "We couldn't save notification settings." });
    }
  });

  app.post("/api/employee/notification-settings/test", requireEmployee, async (req, res) => {
    try {
      await ensureEmployeeTables();
      const result = await pool.query(
        "SELECT phone, sms_enabled, call_enabled FROM employee_notification_settings WHERE employee_email = $1",
        [req.employeeEmail],
      );
      const row = result.rows[0];
      if (!row?.phone) return res.status(400).json({ error: "Save an alert phone number first." });
      if (!twilioConfigured()) return res.status(503).json({ error: "Phone alerts are ready in Dropcart, but Twilio credentials have not been connected yet." });

      const tasks = [];
      if (row.sms_enabled) tasks.push(sendSms(row.phone, "Dropcart test alert: SMS notifications are working."));
      if (row.call_enabled) tasks.push(makeUrgentCall(row.phone, "This is a Dropcart test alert. Your urgent booking call is working."));
      if (!tasks.length) return res.status(400).json({ error: "Turn on text or phone-call alerts first." });
      await Promise.all(tasks);
      res.json({ ok: true });
    } catch (error) {
      console.error("[notify] test failed", error);
      res.status(500).json({ error: "We couldn't send the test alert." });
    }
  });

  app.post("/api/employee/login", employeeJson, (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const configuredEmail = String(process.env.TEST_EMPLOYEE_EMAIL || "").trim().toLowerCase();
    const configuredPassword = String(process.env.TEST_EMPLOYEE_PASSWORD || "");

    const emailAllowed = Boolean(configuredEmail) && allowedEmails().includes(configuredEmail);
    const emailMatches = Boolean(configuredEmail) && secureEqual(email, configuredEmail);
    const passwordMatches = Boolean(configuredPassword) && secureEqual(password, configuredPassword);

    const valid =
      configuredEmail &&
      configuredPassword &&
      emailAllowed &&
      emailMatches &&
      passwordMatches;

    if (!valid) {
      console.warn("[employee] login rejected", {
        bodyParsed: Boolean(req.body),
        emailReceived: Boolean(email),
        passwordReceived: Boolean(password),
        configuredEmail: Boolean(configuredEmail),
        configuredPassword: Boolean(configuredPassword),
        emailAllowed,
        emailMatches,
        passwordMatches,
      });
      return res.status(401).json({
        ok: false,
        error: "We couldn't sign you into the employee portal. Check your email and password.",
      });
    }

    if (!req.session) {
      console.error("[employee] login missing session middleware");
      return res.status(500).json({
        ok: false,
        error: "Employee sign-in is temporarily unavailable.",
      });
    }

    req.session.user = {
      userId: `employee:${configuredEmail}`,
      email: configuredEmail,
      displayName: "Test Employee",
    };
    req.session.cookie.maxAge = req.body?.remember
      ? 14 * 24 * 60 * 60 * 1000
      : 12 * 60 * 60 * 1000;

    req.session.save((error) => {
      if (error) {
        console.error("[employee] login session failed", error);
        return res.status(500).json({
          ok: false,
          error: "Employee sign-in is temporarily unavailable.",
        });
      }
      console.info("[employee] login succeeded");
      return res.json({ ok: true, redirectTo: "/employee" });
    });
  });

  app.get("/api/employee/dashboard", requireEmployee, async (req, res) => {
    try {
      await ensureEmployeeTables();
      const profile = await pool.query("SELECT online FROM employee_profiles WHERE employee_email = $1", [req.employeeEmail]);
      const result = await pool.query(
        "SELECT b.*, ea.employee_email, ea.status AS assignment_status FROM dropcart_bookings b LEFT JOIN employee_assignments ea ON ea.booking_id = b.id WHERE (ea.employee_email = $1 OR ea.booking_id IS NULL) AND b.status NOT IN ('cancelled') ORDER BY CASE WHEN ea.employee_email = $1 THEN 0 ELSE 1 END, b.arrival_at ASC LIMIT 50",
        [req.employeeEmail],
      );
      const jobs = result.rows.map((row) => ({
        id: row.id, reference: row.reference, arrivalAt: Number(row.arrival_at), etaMinutes: Number(row.eta_minutes),
        status: row.status, customerName: row.customer_name, phone: row.phone, address: row.address, city: row.city,
        state: row.state, zip: row.zip, groceryLoad: row.grocery_load, stairs: Boolean(row.stairs), notes: row.notes || "",
        assignmentStatus: row.assignment_status || null,
        codeWord: row.employee_email === req.employeeEmail ? (row.code_word || "") : "",
        earningsCents: earningsCents(row.grocery_load, Boolean(row.stairs)),
      }));
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const completedToday = jobs.filter((job) => job.assignmentStatus === "completed" && job.arrivalAt >= todayStart.getTime());
      const active = jobs.filter((job) => ["accepted", "en_route", "arrived"].includes(job.assignmentStatus || ""));
      res.json({
        employee: { name: employeeName(req), email: req.employeeEmail },
        online: Boolean(profile.rows[0]?.online),
        stats: {
          todayCents: completedToday.reduce((sum, job) => sum + job.earningsCents, 0),
          completedToday: completedToday.length,
          available: jobs.filter((job) => job.assignmentStatus === null).length,
          active: active.length,
        },
        jobs,
      });
    } catch (error) {
      console.error("[employee] dashboard failed", error);
      res.status(500).json({ error: "We couldn't load employee jobs right now." });
    }
  });

  app.post("/api/employee/availability", employeeJson, requireEmployee, async (req, res) => {
    try {
      await ensureEmployeeTables();
      const online = Boolean(req.body?.online);
      await pool.query(
        "INSERT INTO employee_profiles (employee_email, online, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (employee_email) DO UPDATE SET online = EXCLUDED.online, updated_at = NOW()",
        [req.employeeEmail, online],
      );
      res.json({ ok: true, online });
    } catch (error) {
      console.error("[employee] availability failed", error);
      res.status(500).json({ error: "We couldn't update your shift." });
    }
  });

  app.post("/api/employee/jobs/:id/accept", requireEmployee, async (req, res) => {
    try {
      await ensureEmployeeTables();
      const profile = await pool.query("SELECT online FROM employee_profiles WHERE employee_email = $1", [req.employeeEmail]);
      if (!profile.rows[0]?.online) return res.status(409).json({ error: "Go available before claiming a new unload." });
      const result = await pool.query(
        "INSERT INTO employee_assignments (booking_id, employee_email, status) SELECT id, $1, 'accepted' FROM dropcart_bookings WHERE id = $2 AND status NOT IN ('cancelled', 'completed') AND NOT EXISTS (SELECT 1 FROM employee_assignments WHERE booking_id = $2) RETURNING booking_id",
        [req.employeeEmail, req.params.id],
      );
      if (!result.rowCount) return res.status(409).json({ error: "That unload was just claimed by someone else." });
      await pool.query("UPDATE dropcart_bookings SET status = 'assigned', updated_at = NOW() WHERE id = $1", [req.params.id]);
      const booking = await pool.query("SELECT reference, phone, contact_consent FROM dropcart_bookings WHERE id = $1", [req.params.id]);
      void customerStatusText(booking.rows[0], "accepted").catch((error) => console.error("[notify] customer accepted SMS failed", error));
      res.json({ ok: true });
    } catch (error) {
      console.error("[employee] accept failed", error);
      res.status(500).json({ error: "We couldn't claim that unload." });
    }
  });

  app.post("/api/employee/jobs/:id/location", employeeJson, requireEmployee, async (req, res) => {
    try {
      await ensureEmployeeTables();
      const assignment = await pool.query(
        "SELECT status FROM employee_assignments WHERE booking_id = $1 AND employee_email = $2",
        [req.params.id, req.employeeEmail],
      );
      if (!assignment.rowCount) return res.status(404).json({ error: "That unload isn't assigned to you." });
      if (assignment.rows[0].status === "completed") return res.status(409).json({ error: "Tracking is closed for completed unloads." });

      const latitude = Number(req.body?.latitude);
      const longitude = Number(req.body?.longitude);
      const accuracy = req.body?.accuracy == null ? null : Number(req.body.accuracy);
      const heading = req.body?.heading == null ? null : Number(req.body.heading);
      const speed = req.body?.speed == null ? null : Number(req.body.speed);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        return res.status(400).json({ error: "Invalid driver location." });
      }

      await pool.query(
        `INSERT INTO driver_locations (booking_id, employee_email, latitude, longitude, accuracy, heading, speed, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (booking_id) DO UPDATE SET employee_email=EXCLUDED.employee_email, latitude=EXCLUDED.latitude,
         longitude=EXCLUDED.longitude, accuracy=EXCLUDED.accuracy, heading=EXCLUDED.heading,
         speed=EXCLUDED.speed, updated_at=NOW()`,
        [req.params.id, req.employeeEmail, latitude, longitude, Number.isFinite(accuracy) ? accuracy : null, Number.isFinite(heading) ? heading : null, Number.isFinite(speed) ? speed : null],
      );
      return res.json({ ok: true });
    } catch (error) {
      console.error("[tracking] driver location failed", error);
      return res.status(500).json({ error: "We couldn't update live location." });
    }
  });

  app.get("/api/employee/jobs/:id/messages", requireEmployee, async (req, res) => {
    try {
      await ensureEmployeeTables();
      const assignment = await pool.query(
        "SELECT booking_id FROM employee_assignments WHERE booking_id = $1 AND employee_email = $2",
        [req.params.id, req.employeeEmail],
      );
      if (!assignment.rowCount) return res.status(404).json({ error: "That unload isn't assigned to you." });
      return res.json({ messages: await getMessages(req.params.id) });
    } catch (error) {
      console.error("[employee] messages load failed", error);
      return res.status(500).json({ error: "We couldn't load messages." });
    }
  });

  app.post("/api/employee/jobs/:id/messages", employeeJson, requireEmployee, async (req, res) => {
    try {
      await ensureEmployeeTables();
      const assignment = await pool.query(
        "SELECT booking_id FROM employee_assignments WHERE booking_id = $1 AND employee_email = $2",
        [req.params.id, req.employeeEmail],
      );
      if (!assignment.rowCount) return res.status(404).json({ error: "That unload isn't assigned to you." });
      const body = cleanMessage(req.body?.body);
      if (!body) return res.status(400).json({ error: "Write a message first." });

      const result = await pool.query(
        "INSERT INTO booking_messages (booking_id, sender_role, sender_label, body) VALUES ($1, 'employee', $2, $3) RETURNING id, created_at",
        [req.params.id, employeeName(req), body],
      );
      return res.json({
        ok: true,
        message: {
          id: Number(result.rows[0].id),
          senderRole: "employee",
          senderLabel: employeeName(req),
          body,
          createdAt: new Date(result.rows[0].created_at).getTime(),
        },
      });
    } catch (error) {
      console.error("[employee] message failed", error);
      return res.status(500).json({ error: "We couldn't send that message." });
    }
  });

  app.post("/api/employee/jobs/:id/:status", requireEmployee, async (req, res) => {
    const status = String(req.params.status);
    if (!["en_route", "arrived", "completed"].includes(status)) return res.status(400).json({ error: "Unsupported job status." });
    try {
      await ensureEmployeeTables();
      const result = await pool.query(
        "UPDATE employee_assignments SET status = $1, updated_at = NOW() WHERE booking_id = $2 AND employee_email = $3 RETURNING booking_id",
        [status, req.params.id, req.employeeEmail],
      );
      if (!result.rowCount) return res.status(404).json({ error: "That unload isn't assigned to you." });
      if (status === "completed") {
        await pool.query("UPDATE dropcart_bookings SET status = 'completed', updated_at = NOW() WHERE id = $1", [req.params.id]);
        await pool.query("DELETE FROM driver_locations WHERE booking_id = $1", [req.params.id]);
      }
      const booking = await pool.query("SELECT reference, phone, contact_consent FROM dropcart_bookings WHERE id = $1", [req.params.id]);
      void customerStatusText(booking.rows[0], status).catch((error) => console.error("[notify] customer status SMS failed", error));
      res.json({ ok: true });
    } catch (error) {
      console.error("[employee] status update failed", error);
      res.status(500).json({ error: "We couldn't update that unload." });
    }
  });
}
