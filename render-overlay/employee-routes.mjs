import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

async function ensureEmployeeTable() {
  await pool.query("CREATE TABLE IF NOT EXISTS employee_assignments (booking_id TEXT PRIMARY KEY, employee_email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'accepted', accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}

function allowedEmails() {
  return String(process.env.EMPLOYEE_EMAILS || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
}

function requireEmployee(req, res, next) {
  const email = String(req.session?.user?.email || "").trim().toLowerCase();
  if (!email) return res.status(401).json({ error: "Please sign in first." });
  if (!allowedEmails().includes(email)) return res.status(403).json({ error: "This account is not enabled for the employee portal." });
  req.employeeEmail = email;
  next();
}

function earningsCents(load, stairs) {
  return (load === "small" ? 1499 : load === "large" ? 2799 : 1999) + (stairs ? 500 : 0);
}

export function installEmployeeRoutes(app) {
  void ensureEmployeeTable().catch((error) => console.error("[employee] table setup failed", error));

  app.get("/api/employee/dashboard", requireEmployee, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT b.*, ea.employee_email, ea.status AS assignment_status FROM bookings b LEFT JOIN employee_assignments ea ON ea.booking_id = b.id WHERE (ea.employee_email = $1 OR ea.booking_id IS NULL) AND b.status NOT IN ('cancelled') ORDER BY CASE WHEN ea.employee_email = $1 THEN 0 ELSE 1 END, b.arrival_at ASC LIMIT 50",
        [req.employeeEmail],
      );
      const jobs = result.rows.map((row) => ({
        id: row.id, reference: row.reference, arrivalAt: Number(row.arrival_at), etaMinutes: Number(row.eta_minutes),
        status: row.status, customerName: row.customer_name, phone: row.phone, address: row.address,
        city: row.city, state: row.state, zip: row.zip, groceryLoad: row.grocery_load, stairs: Boolean(row.stairs),
        notes: row.notes || "", assignmentStatus: row.assignment_status || null,
        earningsCents: earningsCents(row.grocery_load, Boolean(row.stairs)),
      }));
      const completedToday = jobs.filter((job) => job.assignmentStatus === "completed");
      const todayCents = completedToday.reduce((sum, job) => sum + job.earningsCents, 0);
      res.json({
        employee: { name: req.session.user.displayName || req.session.user.name || "Employee", email: req.employeeEmail },
        stats: { todayCents, completedToday: completedToday.length, available: jobs.filter((job) => job.assignmentStatus === null).length },
        jobs,
      });
    } catch (error) {
      console.error("[employee] dashboard failed", error);
      res.status(500).json({ error: "We couldn't load employee jobs right now." });
    }
  });

  app.post("/api/employee/jobs/:id/accept", requireEmployee, async (req, res) => {
    try {
      const result = await pool.query(
        "INSERT INTO employee_assignments (booking_id, employee_email, status) SELECT id, $1, 'accepted' FROM bookings WHERE id = $2 AND status NOT IN ('cancelled') AND NOT EXISTS (SELECT 1 FROM employee_assignments WHERE booking_id = $2) RETURNING booking_id",
        [req.employeeEmail, req.params.id],
      );
      if (!result.rowCount) return res.status(409).json({ error: "That unload was just claimed by someone else." });
      await pool.query("UPDATE bookings SET status = 'assigned' WHERE id = $1", [req.params.id]);
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
      const result = await pool.query(
        "UPDATE employee_assignments SET status = $1, updated_at = NOW() WHERE booking_id = $2 AND employee_email = $3 RETURNING booking_id",
        [status, req.params.id, req.employeeEmail],
      );
      if (!result.rowCount) return res.status(404).json({ error: "That unload isn't assigned to you." });
      if (status === "completed") await pool.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (error) {
      console.error("[employee] status update failed", error);
      res.status(500).json({ error: "We couldn't update that unload." });
    }
  });
}
