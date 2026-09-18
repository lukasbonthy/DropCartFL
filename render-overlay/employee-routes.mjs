import { timingSafeEqual } from "node:crypto";
import express from "express";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const employeeJson = express.json({ limit: "32kb" });

async function ensureEmployeeTables() {
  await pool.query("CREATE TABLE IF NOT EXISTS employee_assignments (booking_id TEXT PRIMARY KEY, employee_email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'accepted', accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS employee_profiles (employee_email TEXT PRIMARY KEY, online BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS dropcart_bookings (id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, created_at BIGINT NOT NULL, arrival_at BIGINT NOT NULL, eta_minutes INTEGER NOT NULL, status TEXT NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL, zip TEXT NOT NULL, grocery_load TEXT NOT NULL, stairs BOOLEAN NOT NULL DEFAULT FALSE, notes TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
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

export function installEmployeeRoutes(app) {
  void ensureEmployeeTables().catch((error) => console.error("[employee] table setup failed", error));

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
        assignmentStatus: row.assignment_status || null, earningsCents: earningsCents(row.grocery_load, Boolean(row.stairs)),
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
      res.json({ ok: true });
    } catch (error) {
      console.error("[employee] accept failed", error);
      res.status(500).json({ error: "We couldn't claim that unload." });
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
      if (status === "completed") await pool.query("UPDATE dropcart_bookings SET status = 'completed', updated_at = NOW() WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (error) {
      console.error("[employee] status update failed", error);
      res.status(500).json({ error: "We couldn't update that unload." });
    }
  });
}
