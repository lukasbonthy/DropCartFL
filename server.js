/*
  DropcartFL v4 — Employee Login + Customer Login/Signup
  -------------------------------------------------------
  Render settings:
    Build Command: npm install
    Start Command: npm start

  Main pages:
    /                  public landing page
    /signup            customer signup
    /login             customer login
    /account           customer dashboard
    /employee/login    employee login
    /employee          employee dashboard

  Environment variables for Render:
    SESSION_SECRET=long-random-secret
    EMPLOYEE_USER=employee
    EMPLOYEE_PASSWORD=long-private-password
    BUSINESS_PHONE=+13525551234
    DISPLAY_PHONE=(352) 555-1234
    BUSINESS_EMAIL=hello@dropcart.example
    SERVICE_NAME=Dropcart
*/

const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

const SERVICE_NAME = process.env.SERVICE_NAME || "Dropcart";
const BUSINESS_PHONE = process.env.BUSINESS_PHONE || "+13525551234";
const DISPLAY_PHONE = process.env.DISPLAY_PHONE || "(352) 555-1234";
const BUSINESS_EMAIL = process.env.BUSINESS_EMAIL || "hello@dropcart.example";
const CITY = process.env.CITY || "Inverness";
const STATE = process.env.STATE || "FL";

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-this-session-secret";
const EMPLOYEE_USER = process.env.EMPLOYEE_USER || process.env.ADMIN_USER || "employee";
const EMPLOYEE_PASSWORD = process.env.EMPLOYEE_PASSWORD || process.env.ADMIN_PASSWORD || "change-me-now";
const EMPLOYEE_PASSWORD_RECORD = createPasswordRecord(EMPLOYEE_PASSWORD);

const DATA_DIR = path.join(__dirname, "data");
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");
const CUSTOMERS_FILE = path.join(DATA_DIR, "customers.json");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const ANALYTICS_FILE = path.join(DATA_DIR, "analytics.json");

const VALID_STATUSES = ["new", "contacted", "confirmed", "completed", "cancelled"];
const SERVICE_ZIPS = new Set(["34450", "34452", "34453"]);
const EDGE_ZIPS = new Set(["34446", "34442", "34461", "34465", "34429"]);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    name: "dropcart.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const defaults = [
    [BOOKINGS_FILE, "[]"],
    [CUSTOMERS_FILE, "[]"],
    [LEADS_FILE, "[]"],
    [ANALYTICS_FILE, JSON.stringify({ startedAt: new Date().toISOString(), pageViews: 0, estimates: 0, bookings: 0, signups: 0, customerLogins: 0, employeeLogins: 0, areaChecks: 0, routeViews: {} }, null, 2)],
  ];
  for (const [file, value] of defaults) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, value, "utf8");
  }
}

function readJson(file, fallback) {
  ensureFiles();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureFiles();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function readBookings() {
  const data = readJson(BOOKINGS_FILE, []);
  return Array.isArray(data) ? data : [];
}
function saveBookings(bookings) { writeJson(BOOKINGS_FILE, bookings); }
function readCustomers() {
  const data = readJson(CUSTOMERS_FILE, []);
  return Array.isArray(data) ? data : [];
}
function saveCustomers(customers) { writeJson(CUSTOMERS_FILE, customers); }
function readLeads() {
  const data = readJson(LEADS_FILE, []);
  return Array.isArray(data) ? data : [];
}
function saveLeads(leads) { writeJson(LEADS_FILE, leads); }
function getAnalytics() {
  const a = readJson(ANALYTICS_FILE, {});
  return {
    startedAt: a.startedAt || new Date().toISOString(),
    pageViews: Number(a.pageViews) || 0,
    estimates: Number(a.estimates) || 0,
    bookings: Number(a.bookings) || 0,
    signups: Number(a.signups) || 0,
    customerLogins: Number(a.customerLogins) || 0,
    employeeLogins: Number(a.employeeLogins) || 0,
    areaChecks: Number(a.areaChecks) || 0,
    routeViews: a.routeViews && typeof a.routeViews === "object" ? a.routeViews : {},
  };
}
function saveAnalytics(a) { writeJson(ANALYTICS_FILE, a); }
function bumpAnalytics(key, route) {
  const a = getAnalytics();
  if (key) a[key] = (Number(a[key]) || 0) + 1;
  if (route) a.routeViews[route] = (Number(a.routeViews[route]) || 0) + 1;
  saveAnalytics(a);
}

app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api") && req.path !== "/health") {
    bumpAnalytics("pageViews", req.path);
  }
  next();
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function cleanText(value, max = 500) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
function normalizeEmail(email) { return cleanText(email, 160).toLowerCase(); }
function digitsOnly(value) { return String(value || "").replace(/\D/g, ""); }
function id(prefix) {
  if (crypto.randomUUID) return prefix + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
  return prefix + "-" + Date.now().toString(36).toUpperCase();
}
function money(value) { return "$" + Number(value || 0).toFixed(0); }

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, record) {
  if (!record || !record.includes(":")) return false;
  const [salt, storedHash] = record.split(":");
  const inputHash = crypto.scryptSync(String(password), salt, 64);
  const stored = Buffer.from(storedHash, "hex");
  if (stored.length !== inputHash.length) return false;
  return crypto.timingSafeEqual(stored, inputHash);
}
function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 8) return "Password must be at least 8 characters.";
  if (value.length > 160) return "Password is too long.";
  return "";
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}
function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}
function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  return req.session.csrfToken;
}
function csrfField(req) {
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken(req))}">`;
}
function verifyCsrf(req, res, next) {
  const sent = req.body.csrf || req.headers["x-csrf-token"];
  if (!req.session.csrfToken || sent !== req.session.csrfToken) {
    return res.status(403).send(pageShell({ req, title: `${SERVICE_NAME} — Security Check`, body: `${header(req)}<main class="container section"><div class="glass" style="padding:42px;border-radius:38px"><span class="chip">Security check failed</span><h1 class="adminTitle" style="margin-top:18px">Refresh and try again.</h1><p class="sectionSub" style="margin-left:0;text-align:left">The form token expired or was missing.</p><a class="btn primary" style="margin-top:24px" href="/">Back home</a></div></main>${footer(req)}` }));
  }
  next();
}

const loginAttempts = new Map();
function rateLimitLogin(bucketName, maxAttempts = 8, windowMs = 1000 * 60 * 10) {
  return (req, res, next) => {
    const key = `${bucketName}:${req.ip}`;
    const now = Date.now();
    const current = loginAttempts.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > current.resetAt) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }
    current.count += 1;
    loginAttempts.set(key, current);
    if (current.count > maxAttempts) {
      return res.status(429).send(pageShell({ req, title: `${SERVICE_NAME} — Too Many Attempts`, body: `${header(req)}<main class="container section"><div class="glass" style="padding:42px;border-radius:38px"><span class="chip">Too many attempts</span><h1 class="adminTitle" style="margin-top:18px">Try again later.</h1><p class="sectionSub" style="margin-left:0;text-align:left">There were too many login attempts from this network.</p><a class="btn primary" style="margin-top:24px" href="/">Back home</a></div></main>${footer(req)}` }));
    }
    next();
  };
}

function currentCustomer(req) {
  if (!req.session.customerId) return null;
  return readCustomers().find((c) => c.id === req.session.customerId) || null;
}
function isEmployee(req) { return Boolean(req.session.employeeAuthed); }
function requireCustomer(req, res, next) {
  const customer = currentCustomer(req);
  if (!customer) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  req.customer = customer;
  next();
}
function requireEmployee(req, res, next) {
  if (!isEmployee(req)) return res.redirect(`/employee/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

function calculateEstimate(input = {}) {
  const bags = Math.max(1, Math.min(120, Number(input.bags) || 12));
  const stairs = Math.max(0, Math.min(5, Number(input.stairs) || 0));
  const heavy = Math.max(0, Math.min(4, Number(input.heavy) || 0));
  const placement = Math.max(0, Math.min(4, Number(input.placement) || 0));
  const urgency = Math.max(0, Math.min(3, Number(input.urgency) || 0));
  const distance = Math.max(0, Math.min(3, Number(input.distance) || 0));
  let price = 29;
  let minutes = 28;
  if (bags > 15) {
    const extraBagGroups = Math.ceil((bags - 15) / 8);
    price += extraBagGroups * 4;
    minutes += extraBagGroups * 5;
  }
  price += stairs * 5;
  minutes += stairs * 6;
  price += heavy * 8;
  minutes += heavy * 7;
  price += placement * 6;
  minutes += placement * 6;
  price += urgency * 10;
  minutes += urgency * 2;
  price += distance * 7;
  minutes += distance * 4;
  price = Math.min(149, price);
  minutes = Math.min(135, minutes);
  const deposit = Math.max(10, Math.round(price * 0.25));
  return {
    bags, stairs, heavy, placement, urgency, distance, price, minutes, deposit,
    label: `${money(price)} · about ${minutes} minutes`,
    breakdown: [
      { label: "Base unload", amount: 29 },
      { label: "Extra bags", amount: Math.max(0, price - 29 - stairs * 5 - heavy * 8 - placement * 6 - urgency * 10 - distance * 7) },
      { label: "Stairs", amount: stairs * 5 },
      { label: "Heavy items", amount: heavy * 8 },
      { label: "Placement help", amount: placement * 6 },
      { label: "Rush window", amount: urgency * 10 },
      { label: "Extended area", amount: distance * 7 },
    ].filter((item) => item.amount > 0),
  };
}
function checkServiceArea(input = {}) {
  const zip = digitsOnly(input.zip || input.address).slice(0, 5);
  const address = cleanText(input.address, 160).toLowerCase();
  if (SERVICE_ZIPS.has(zip) || address.includes("inverness")) return { ok: true, status: "inside", zip, fee: 0, message: "Looks like you are inside the main Inverness service area." };
  if (EDGE_ZIPS.has(zip) || address.includes("lecanto") || address.includes("hernando") || address.includes("crystal river")) return { ok: true, status: "edge", zip, fee: 8, message: "You may be slightly outside the core area. We can probably help with a small distance fee." };
  if (!zip && !address) return { ok: false, status: "unknown", zip: "", fee: 0, message: "Enter an address or ZIP so we can check the service area." };
  return { ok: false, status: "outside", zip, fee: 0, message: "This may be outside the current service area. Call or text to double-check." };
}
function getAvailability() {
  const windows = ["8:00 AM – 10:00 AM", "10:30 AM – 12:30 PM", "1:00 PM – 3:00 PM", "3:30 PM – 5:30 PM", "6:00 PM – 8:00 PM"];
  const today = new Date();
  return Array.from({ length: 7 }, (_, dayIndex) => {
    const date = new Date(today);
    date.setDate(today.getDate() + dayIndex);
    const label = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return { date: date.toISOString().slice(0, 10), label, windows: windows.map((window, windowIndex) => {
      const seed = (dayIndex + 1) * (windowIndex + 3);
      const level = seed % 5 === 0 ? "busy" : seed % 3 === 0 ? "limited" : "open";
      return { window, level };
    }) };
  });
}
function statusColor(status) {
  switch (status) {
    case "confirmed": return "blue";
    case "completed": return "green";
    case "cancelled": return "red";
    case "contacted": return "amber";
    default: return "purple";
  }
}

function pageShell({ req, title = SERVICE_NAME, description = "Local grocery unloading in Inverness, Florida.", body = "" }) {
  const customer = req ? currentCustomer(req) : null;
  const employee = req ? isEmployee(req) : false;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="theme-color" content="#070a12" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root{--bg:#060912;--bg2:#0b1020;--text:#f8fafc;--muted:rgba(248,250,252,.66);--muted2:rgba(248,250,252,.45);--panel:rgba(255,255,255,.078);--panel2:rgba(255,255,255,.118);--border:rgba(255,255,255,.13);--border2:rgba(255,255,255,.22);--purple:#7c5cff;--pink:#ff4fd8;--cyan:#35d7ff;--green:#49e6a5;--amber:#ffd166;--red:#ff6b6b;--blue:#5aa7ff;--shadow:0 28px 90px rgba(0,0,0,.42);--glow:0 22px 75px rgba(124,92,255,.34);--safe-bottom:env(safe-area-inset-bottom,0px)}
    *{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}body{min-height:100vh;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:radial-gradient(950px circle at 10% -10%,rgba(124,92,255,.38),transparent 45%),radial-gradient(850px circle at 96% 8%,rgba(255,79,216,.24),transparent 42%),radial-gradient(700px circle at 50% 106%,rgba(53,215,255,.17),transparent 50%),linear-gradient(180deg,var(--bg) 0%,var(--bg2) 45%,var(--bg) 100%);overflow-x:hidden}body:before{content:"";position:fixed;inset:0;z-index:-4;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:70px 70px;mask-image:radial-gradient(circle at 50% 0%,black,transparent 72%)}body:after{content:"";position:fixed;inset:0;z-index:999;opacity:.075;pointer-events:none;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='.7'/%3E%3C/svg%3E")}a{color:inherit;text-decoration:none}button,input,textarea,select{font:inherit}button{cursor:pointer}.container{width:min(1240px,calc(100% - 32px));margin-inline:auto}.display{font-family:"Space Grotesk",Inter,sans-serif}.orb{position:fixed;z-index:-3;pointer-events:none;border-radius:999px;filter:blur(54px);opacity:.28;animation:orbFloat 18s ease-in-out infinite}.orb.one{top:-120px;left:-140px;width:430px;height:430px;background:var(--purple)}.orb.two{top:22%;right:-160px;width:450px;height:450px;background:var(--pink);animation-delay:-7s}.orb.three{bottom:-170px;left:32%;width:380px;height:380px;background:var(--cyan);animation-delay:-11s}@keyframes orbFloat{0%,100%{transform:translate3d(0,0,0) scale(1)}33%{transform:translate3d(38px,-24px,0) scale(1.07)}66%{transform:translate3d(-28px,30px,0) scale(.96)}}.progress{position:fixed;top:0;left:0;z-index:1500;height:4px;width:100%;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,var(--purple),var(--pink),var(--cyan));box-shadow:0 0 24px rgba(255,79,216,.62)}
    .glass{background:linear-gradient(180deg,rgba(255,255,255,.095),rgba(255,255,255,.04));border:1px solid var(--border);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),var(--shadow);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}.soft{background:rgba(255,255,255,.058);border:1px solid rgba(255,255,255,.105);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.chip{display:inline-flex;align-items:center;gap:9px;min-height:32px;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.76);font-size:12px;font-weight:850;letter-spacing:-.01em;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 16px 45px rgba(0,0,0,.22)}.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 22px rgba(73,230,165,.82)}.btn{position:relative;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:13px 20px;border:0;border-radius:18px;font-weight:900;font-size:14px;letter-spacing:-.02em;transition:transform .18s ease,filter .18s ease,background .18s ease,border-color .18s ease;overflow:hidden;user-select:none;white-space:nowrap}.btn:active{transform:scale(.965)}.primary{color:white;background:linear-gradient(135deg,var(--purple) 0%,var(--pink) 55%,var(--cyan) 130%);box-shadow:0 22px 70px rgba(124,92,255,.34),inset 0 1px 0 rgba(255,255,255,.22)}.primary:hover{transform:translateY(-1px);filter:saturate(1.15) brightness(1.08)}.ghost{color:white;background:rgba(255,255,255,.068);border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 16px 48px rgba(0,0,0,.22)}.ghost:hover{background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.2)}.danger{color:white;background:rgba(255,107,107,.14);border:1px solid rgba(255,107,107,.22)}.shine{background:linear-gradient(90deg,#fff 0%,#c9c0ff 22%,#ff7be8 50%,#68e4ff 78%,#fff 100%);background-size:240% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:textShine 8s ease-in-out infinite;text-shadow:0 0 38px rgba(124,92,255,.16)}@keyframes textShine{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
    .header{position:sticky;top:0;z-index:1000;border-bottom:1px solid rgba(255,255,255,.1);background:rgba(7,10,18,.72);backdrop-filter:blur(22px) saturate(1.3);-webkit-backdrop-filter:blur(22px) saturate(1.3)}.nav{display:flex;align-items:center;justify-content:space-between;min-height:72px}.logo{display:inline-flex;align-items:center;gap:12px}.logoIcon{position:relative;display:grid;place-items:center;width:43px;height:43px;border-radius:17px;color:#070a12;background:white;box-shadow:0 20px 60px rgba(124,92,255,.35)}.logoIcon:after{content:"";position:absolute;inset:-9px;z-index:-1;border-radius:24px;background:var(--purple);filter:blur(18px);opacity:.55}.logoTitle{display:block;font-family:"Space Grotesk",Inter,sans-serif;font-size:22px;line-height:1;font-weight:800;letter-spacing:-.045em}.logoSub{display:block;margin-top:2px;font-size:11px;font-weight:800;color:rgba(255,255,255,.45)}.desktopNav{display:flex;align-items:center;gap:5px}.navLink{padding:11px 13px;border-radius:14px;color:rgba(255,255,255,.66);font-size:14px;font-weight:800;transition:background .18s ease,color .18s ease}.navLink:hover{color:white;background:rgba(255,255,255,.07)}.menuBtn{display:none;width:48px;height:48px;padding:0}.mobileMenu{display:none;padding-bottom:14px}.mobileMenu.open{display:block;animation:mobileDrop .23s ease both}@keyframes mobileDrop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}.mobilePanel{padding:12px;border-radius:24px}.mobilePanel a,.mobilePanel button{display:flex;align-items:center;justify-content:space-between;width:100%;padding:14px;border-radius:16px;color:rgba(255,255,255,.74);font-weight:850;background:none;border:0}.mobilePanel a:hover,.mobilePanel button:hover{background:rgba(255,255,255,.07);color:white}.mobileActions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
    .hero{position:relative;display:grid;grid-template-columns:1.04fr .96fr;align-items:center;gap:48px;min-height:calc(100svh - 72px);padding:64px 0 54px}.heroTitle{margin-top:20px;font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(58px,8vw,118px);font-weight:800;letter-spacing:-.078em;line-height:.84;text-wrap:balance}.heroDesc{max-width:680px;margin-top:24px;color:var(--muted);font-size:20px;line-height:1.72}.heroActions{display:flex;flex-wrap:wrap;align-items:center;gap:13px;margin-top:28px}.heroNote{margin-top:14px;color:rgba(255,255,255,.42);font-size:13px;font-weight:700}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:30px}.stat{padding:18px;border-radius:24px}.statNum{font-family:"Space Grotesk",Inter,sans-serif;font-size:27px;line-height:1;font-weight:800;letter-spacing:-.05em}.statLab{margin-top:7px;color:rgba(255,255,255,.47);font-size:12px;font-weight:800}.deviceShell{position:relative;width:min(100%,520px);margin-left:auto;border-radius:42px}.deviceShell:before{content:"";position:absolute;inset:-3px;z-index:-2;border-radius:inherit;background:conic-gradient(from 180deg,rgba(124,92,255,.86),rgba(255,79,216,.65),rgba(53,215,255,.55),rgba(124,92,255,.86));filter:blur(18px);opacity:.86;animation:auraSpin 9s linear infinite}@keyframes auraSpin{to{transform:rotate(360deg)}}.device{padding:18px;border-radius:42px}.screen{position:relative;overflow:hidden;padding:20px;border-radius:32px;background:radial-gradient(520px circle at var(--mx,50%) var(--my,20%),rgba(255,255,255,.13),transparent 48%),linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.1)}.phoneBar{width:78px;height:6px;margin:0 auto 20px;border-radius:999px;background:rgba(255,255,255,.14)}.requestTop{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.kicker{color:rgba(255,255,255,.42);font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.requestTitle{margin-top:4px;font-family:"Space Grotesk",Inter,sans-serif;font-size:29px;font-weight:800;letter-spacing:-.055em}.available{display:inline-flex;align-items:center;gap:8px;padding:9px 11px;border-radius:999px;color:var(--green);background:rgba(73,230,165,.13);border:1px solid rgba(73,230,165,.2);font-size:12px;font-weight:900}.requestCard{margin-top:20px;padding:18px;border-radius:26px;border:1px solid rgba(255,255,255,.105);background:rgba(0,0,0,.23)}.requestRow{display:flex;align-items:flex-start;gap:14px}.requestIcon{display:grid;place-items:center;flex-shrink:0;width:50px;height:50px;border-radius:20px;color:#070a12;background:white;box-shadow:0 18px 50px rgba(255,255,255,.12)}.requestInfo h3{font-size:17px;font-weight:900;letter-spacing:-.025em}.requestInfo p{margin-top:5px;color:rgba(255,255,255,.56);font-size:14px;line-height:1.6}.miniGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:18px}.mini{padding:15px;border-radius:22px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1)}.miniLabel{color:rgba(255,255,255,.48);font-size:12px;font-weight:800}.miniValue{margin-top:5px;font-family:"Space Grotesk",Inter,sans-serif;font-size:28px;line-height:1;font-weight:800;letter-spacing:-.06em}.taskGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-top:16px}.task{padding:14px 10px;border-radius:20px;text-align:center;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.075)}.taskEmoji{font-size:23px;line-height:1}.taskText{margin-top:8px;color:rgba(255,255,255,.56);font-size:12px;font-weight:900}.ready{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:14px;border-radius:22px;background:rgba(124,92,255,.12);border:1px solid rgba(124,92,255,.22)}.ready h4{font-size:14px;font-weight:900}.ready p{margin-top:3px;color:rgba(255,255,255,.47);font-size:12px;font-weight:700}
    .section{padding:86px 0}.sectionHeader{max-width:820px;margin:0 auto 42px;text-align:center}.sectionTitle{margin-top:16px;font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(38px,5vw,64px);line-height:.95;font-weight:800;letter-spacing:-.066em;text-wrap:balance}.sectionSub{max-width:700px;margin:18px auto 0;color:var(--muted);font-size:18px;line-height:1.68}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:15px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}.twoCol{display:grid;grid-template-columns:.86fr 1.14fr;gap:32px;align-items:start}.card{position:relative;overflow:hidden;padding:24px;border-radius:28px;transition:transform .22s ease,border-color .22s ease,background .22s ease}.card:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(500px circle at 20% 0%,rgba(255,255,255,.08),transparent 44%);opacity:.75}.card>*{position:relative;z-index:1}.card:hover{transform:translateY(-4px);border-color:var(--border2);background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.052))}.icon{display:grid;place-items:center;width:48px;height:48px;border-radius:20px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.1);font-size:23px}.card h3{margin-top:18px;font-family:"Space Grotesk",Inter,sans-serif;font-size:22px;line-height:1.1;font-weight:800;letter-spacing:-.045em}.card p{margin-top:10px;color:rgba(255,255,255,.58);font-size:14px;line-height:1.65}.stepNum{display:grid;place-items:center;width:44px;height:44px;border-radius:18px;color:#070a12;background:white;font-family:"Space Grotesk",Inter,sans-serif;font-size:20px;font-weight:900;box-shadow:0 16px 40px rgba(255,255,255,.12)}.priceCards{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.popular{background:radial-gradient(540px circle at 20% 0%,rgba(124,92,255,.22),transparent 42%),linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.045));border-color:rgba(255,255,255,.2)}.priceTop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.priceName{margin:0;font-family:"Space Grotesk",Inter,sans-serif;font-size:29px;font-weight:800;letter-spacing:-.055em}.priceDesc{margin-top:5px;color:rgba(255,255,255,.52);font-size:14px;line-height:1.55}.priceMain{display:flex;align-items:flex-end;gap:8px;margin-top:28px}.priceAmount{font-family:"Space Grotesk",Inter,sans-serif;font-size:70px;line-height:.85;font-weight:800;letter-spacing:-.09em}.priceUnit{padding-bottom:7px;color:rgba(255,255,255,.48);font-size:15px;font-weight:800}.checks{display:grid;gap:12px;margin-top:28px;list-style:none}.checks li{display:flex;align-items:flex-start;gap:10px;color:rgba(255,255,255,.7);font-size:14px;line-height:1.45;font-weight:650}.check{color:var(--green);font-weight:900}.fine{margin-top:12px;color:rgba(255,255,255,.4);font-size:12px;line-height:1.5}
    .formBox{padding:26px;border-radius:38px}.formGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.field label{display:block;margin-bottom:8px;color:rgba(255,255,255,.45);font-size:11px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.field input,.field select,.field textarea{width:100%;min-height:49px;padding:13px 15px;color:white;background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.115);border-radius:18px;outline:none;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}.field textarea{min-height:105px;resize:vertical}.field input::placeholder,.field textarea::placeholder{color:rgba(255,255,255,.36)}.field input:focus,.field select:focus,.field textarea:focus{border-color:rgba(255,255,255,.26);background:rgba(255,255,255,.09);box-shadow:0 0 0 4px rgba(124,92,255,.19)}.full{grid-column:1/-1}.estimateResult{margin-top:18px;padding:22px;border-radius:27px;background:rgba(0,0,0,.27);border:1px solid rgba(255,255,255,.105)}.estimateRow{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}.estimateLabel{color:rgba(255,255,255,.4);font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.estimatePrice{margin-top:4px;font-family:"Space Grotesk",Inter,sans-serif;font-size:72px;line-height:.88;font-weight:800;letter-spacing:-.09em}.estimateSide{color:rgba(255,255,255,.53);font-size:14px;line-height:1.6;text-align:right}.formActions{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.status{min-height:24px;margin-top:13px;font-size:14px;font-weight:800}.success{color:var(--green)}.error{color:var(--amber)}.areaResult{margin-top:14px;padding:16px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.7);line-height:1.55;font-size:14px}.map{position:relative;display:flex;flex-direction:column;justify-content:space-between;min-height:380px;padding:24px;border-radius:28px;border:1px solid rgba(255,255,255,.105);background:radial-gradient(circle at 24% 18%,rgba(124,92,255,.3),transparent 35%),radial-gradient(circle at 80% 70%,rgba(53,215,255,.22),transparent 38%),linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.025))}.rings{position:relative;display:grid;place-items:center;width:220px;height:220px;margin:18px auto;border-radius:50%;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.095)}.rings:before,.rings:after{content:"";position:absolute;border-radius:50%;border:1px solid rgba(255,255,255,.14)}.rings:before{width:158px;height:158px;border-color:rgba(124,92,255,.5)}.rings:after{width:98px;height:98px;border-color:rgba(53,215,255,.46)}.pin{z-index:2;display:grid;place-items:center;width:58px;height:58px;border-radius:50%;color:#070a12;background:white;box-shadow:0 22px 65px rgba(255,255,255,.13),0 0 50px rgba(124,92,255,.45);font-size:25px}

    .portalHero{position:relative;overflow:hidden;padding:34px;border-radius:44px;background:radial-gradient(900px circle at 5% 0%,rgba(124,92,255,.28),transparent 42%),radial-gradient(780px circle at 88% 20%,rgba(255,79,216,.17),transparent 44%),linear-gradient(180deg,rgba(255,255,255,.11),rgba(255,255,255,.045));}
    .portalHeroGrid{display:grid;grid-template-columns:1fr 330px;gap:24px;align-items:center}
    .portalTitle{font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(46px,6vw,86px);line-height:.86;font-weight:800;letter-spacing:-.075em;margin-top:16px}
    .portalText{max-width:720px;margin-top:18px;color:rgba(255,255,255,.66);font-size:18px;line-height:1.7}
    .portalScore{padding:22px;border-radius:32px;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.105)}
    .portalScoreNum{font-family:"Space Grotesk",Inter,sans-serif;font-size:64px;line-height:.88;font-weight:800;letter-spacing:-.08em}
    .rewardTrack{height:12px;margin-top:16px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.08)}
    .rewardFill{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--purple),var(--pink),var(--cyan));box-shadow:0 0 28px rgba(255,79,216,.38)}
    .portalGrid{display:grid;grid-template-columns:.95fr 1.05fr;gap:18px;margin-top:18px}
    .portalPanel{padding:24px;border-radius:32px}
    .portalPanel h2,.portalPanel h3{font-family:"Space Grotesk",Inter,sans-serif;letter-spacing:-.05em}
    .portalPanel h2{font-size:34px;line-height:.95}
    .portalPanel h3{font-size:25px;line-height:1}
    .quickTiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:18px}
    .quickTile{padding:14px;border-radius:20px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.085)}
    .quickTile span{display:block;color:rgba(255,255,255,.42);font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
    .quickTile strong{display:block;margin-top:6px;color:rgba(255,255,255,.82);font-size:14px}
    .portalActions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
    .profileForm{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:18px}
    .portalBooking{padding:22px;border-radius:32px}
    .portalBookingTop{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
    .portalBookingTitle{font-family:"Space Grotesk";font-size:29px;font-weight:800;letter-spacing:-.055em;margin-top:10px}
    .timeline{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:18px}
    .timelineStep{position:relative;padding:12px 8px;border-radius:16px;text-align:center;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.075);color:rgba(255,255,255,.38);font-size:11px;font-weight:900}
    .timelineStep.done{color:var(--green);background:rgba(73,230,165,.09);border-color:rgba(73,230,165,.18)}
    .timelineStep.active{color:white;background:rgba(124,92,255,.16);border-color:rgba(124,92,255,.28);box-shadow:0 0 34px rgba(124,92,255,.16)}
    .timelineDot{display:block;width:10px;height:10px;border-radius:50%;background:currentColor;margin:0 auto 8px}
    .repeatCard{margin-top:16px;padding:18px;border-radius:26px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.09)}
    .emptyPortal{padding:36px;border-radius:32px;text-align:center;background:rgba(255,255,255,.055);border:1px dashed rgba(255,255,255,.18);color:rgba(255,255,255,.64)}


    /* ===== PERSONAL CUSTOMER DASHBOARD V7 ===== */
    body.portalMode{background:radial-gradient(850px circle at 14% -8%,rgba(73,230,165,.18),transparent 46%),radial-gradient(800px circle at 90% 10%,rgba(124,92,255,.22),transparent 42%),radial-gradient(760px circle at 45% 102%,rgba(255,209,102,.11),transparent 50%),linear-gradient(180deg,#06100d 0%,#0a111d 46%,#070a12 100%)}
    .customerShell{padding-top:34px}.hubTopbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.hubMiniNav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.hubMiniNav a,.hubMiniNav button{min-height:40px;padding:10px 13px;border-radius:15px;font-size:12px;font-weight:900;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.055);color:rgba(255,255,255,.72)}.hubMiniNav a:hover,.hubMiniNav button:hover{background:rgba(255,255,255,.1);color:white}
    .personalHero{position:relative;overflow:hidden;border-radius:46px;padding:30px;background:radial-gradient(800px circle at 4% 0%,rgba(73,230,165,.18),transparent 42%),radial-gradient(820px circle at 96% 5%,rgba(124,92,255,.2),transparent 45%),linear-gradient(180deg,rgba(255,255,255,.105),rgba(255,255,255,.038))}.personalHero:before{content:"";position:absolute;inset:18px;border-radius:34px;border:1px solid rgba(255,255,255,.07);pointer-events:none}.personalHeroGrid{position:relative;z-index:1;display:grid;grid-template-columns:1.2fr .8fr;gap:18px;align-items:stretch}.personalGreeting{font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(42px,6vw,82px);line-height:.88;font-weight:800;letter-spacing:-.075em;margin-top:16px;text-wrap:balance}.personalSub{max-width:760px;margin-top:16px;color:rgba(255,255,255,.66);font-size:17px;line-height:1.75}
    .todayCard{position:relative;overflow:hidden;padding:22px;border-radius:34px;background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.055));border:1px solid rgba(255,255,255,.13);box-shadow:var(--shadow)}.todayCard:after{content:"";position:absolute;right:-70px;bottom:-80px;width:220px;height:220px;border-radius:999px;background:rgba(73,230,165,.16);filter:blur(20px)}.todayCard>*{position:relative;z-index:1}.todayLabel{color:rgba(255,255,255,.45);font-size:11px;font-weight:950;letter-spacing:.16em;text-transform:uppercase}.todayMain{margin-top:8px;font-family:"Space Grotesk";font-size:34px;line-height:.95;font-weight:800;letter-spacing:-.06em}.todayText{margin-top:12px;color:rgba(255,255,255,.62);line-height:1.65;font-size:14px}
    .hubStats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:22px}.hubStat{padding:16px;border-radius:24px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.09)}.hubStat strong{display:block;font-family:"Space Grotesk";font-size:28px;line-height:1;letter-spacing:-.06em}.hubStat span{display:block;margin-top:7px;color:rgba(255,255,255,.44);font-size:11px;font-weight:850}
    .hubLayout{display:grid;grid-template-columns:.75fr 1.25fr;gap:18px;margin-top:18px;align-items:start}.hubSidebar{display:grid;gap:14px;position:sticky;top:92px}.hubMain{display:grid;gap:14px}.hubCard{padding:22px;border-radius:32px;background:linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.11);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 22px 70px rgba(0,0,0,.28);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}.hubCardTitle{font-family:"Space Grotesk";font-size:28px;line-height:.98;font-weight:800;letter-spacing:-.055em;margin-top:14px}.hubMuted{margin-top:9px;color:rgba(255,255,255,.58);font-size:14px;line-height:1.65}
    .profileStack{display:grid;gap:10px;margin-top:16px}.profileLine{display:flex;justify-content:space-between;gap:16px;padding:13px;border-radius:18px;background:rgba(255,255,255,.052);border:1px solid rgba(255,255,255,.075)}.profileLine span{color:rgba(255,255,255,.42);font-size:10px;font-weight:950;letter-spacing:.14em;text-transform:uppercase}.profileLine strong{color:rgba(255,255,255,.82);font-size:13px;text-align:right}.rewardRing{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center;margin-top:16px}.ring{--p:0;display:grid;place-items:center;width:98px;height:98px;border-radius:999px;background:conic-gradient(var(--green) calc(var(--p)*1%),rgba(255,255,255,.09) 0);box-shadow:0 0 40px rgba(73,230,165,.16)}.ringInner{display:grid;place-items:center;width:76px;height:76px;border-radius:999px;background:#081014;border:1px solid rgba(255,255,255,.1);font-family:"Space Grotesk";font-size:23px;font-weight:850;letter-spacing:-.06em}.homeMood{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:16px}.moodTile{padding:14px 10px;border-radius:20px;text-align:center;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08)}.moodTile b{display:block;font-size:22px}.moodTile span{display:block;margin-top:7px;font-size:11px;font-weight:850;color:rgba(255,255,255,.55)}
    .personalForm{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:18px}.personalForm .full{grid-column:1/-1}.comfortStrip{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px}.comfort{padding:14px;border-radius:20px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08)}.comfort span{display:block;color:rgba(255,255,255,.42);font-size:10px;font-weight:950;letter-spacing:.14em;text-transform:uppercase}.comfort strong{display:block;margin-top:6px;color:rgba(255,255,255,.82);font-size:14px}.nextUnloadFocus{display:grid;grid-template-columns:.95fr 1.05fr;gap:14px;align-items:stretch}.focusPanel{padding:20px;border-radius:28px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08)}.focusPanel h3{font-family:"Space Grotesk";font-size:28px;letter-spacing:-.055em;line-height:.98}.focusPanel p{margin-top:10px;color:rgba(255,255,255,.58);line-height:1.65;font-size:14px}
    .bookingMemories{display:grid;gap:12px;margin-top:14px}.memoryCard{padding:18px;border-radius:28px;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.1)}.memoryTop{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.memoryTitle{font-family:"Space Grotesk";font-size:25px;line-height:1;letter-spacing:-.055em;margin-top:9px}.memoryText{margin-top:7px;color:rgba(255,255,255,.58);line-height:1.62;font-size:14px}.memoryTimeline{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:15px}.memoryStep{padding:10px 8px;border-radius:15px;text-align:center;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);color:rgba(255,255,255,.36);font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.06em}.memoryStep.done{color:var(--green);background:rgba(73,230,165,.09);border-color:rgba(73,230,165,.18)}.memoryStep.active{color:white;background:rgba(124,92,255,.16);border-color:rgba(124,92,255,.28)}.emptyHome{padding:26px;border-radius:28px;text-align:left;background:rgba(255,255,255,.052);border:1px dashed rgba(255,255,255,.17);color:rgba(255,255,255,.66);line-height:1.7}.tinyActions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}.tinyActions .btn{min-height:42px;padding:10px 14px;font-size:12px;border-radius:15px}
    @media(max-width:1050px){.personalHeroGrid,.hubLayout,.nextUnloadFocus{grid-template-columns:1fr}.hubSidebar{position:relative;top:auto}.hubStats{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:720px){.hubTopbar,.memoryTop{flex-direction:column;align-items:flex-start}.hubMiniNav{width:100%}.hubMiniNav a,.hubMiniNav button{flex:1;justify-content:center}.personalHero{padding:22px;border-radius:32px}.hubStats,.personalForm,.comfortStrip,.memoryTimeline{grid-template-columns:1fr}.rewardRing{grid-template-columns:1fr}.homeMood{grid-template-columns:repeat(3,1fr)}.todayMain{font-size:27px}.hubCard{border-radius:26px;padding:18px}}
    .authWrap{display:grid;grid-template-columns:.9fr 1.1fr;gap:24px;align-items:stretch;min-height:calc(100svh - 72px);padding:64px 0}.authTitle{font-family:"Space Grotesk";font-size:clamp(46px,7vw,84px);line-height:.88;letter-spacing:-.075em}.authCard{padding:28px;border-radius:38px}.accountHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.bookingGrid{display:grid;gap:14px;margin-top:28px}.bookingCard{padding:20px;border-radius:28px}.bookingTop{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.bookingMeta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}.metaBox{padding:12px;border-radius:18px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08)}.metaBox span{display:block;color:rgba(255,255,255,.4);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.14em}.metaBox strong{display:block;margin-top:5px;color:rgba(255,255,255,.78);font-size:14px}.badge{display:inline-flex;align-items:center;padding:7px 10px;border-radius:999px;font-size:12px;font-weight:900;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07)}.badge.green{color:var(--green);background:rgba(73,230,165,.12);border-color:rgba(73,230,165,.2)}.badge.red{color:var(--red);background:rgba(255,107,107,.12);border-color:rgba(255,107,107,.2)}.badge.amber{color:var(--amber);background:rgba(255,209,102,.12);border-color:rgba(255,209,102,.2)}.badge.blue{color:var(--blue);background:rgba(90,167,255,.12);border-color:rgba(90,167,255,.2)}.badge.purple{color:#c9c0ff;background:rgba(124,92,255,.12);border-color:rgba(124,92,255,.2)}.adminActions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.adminActions form{display:flex;gap:8px;align-items:center}.adminActions select{min-height:42px;padding:10px;border-radius:14px;color:white;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12)}.adminTitle{font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(42px,6vw,82px);line-height:.9;font-weight:800;letter-spacing:-.07em}.empty{padding:48px;text-align:center;color:rgba(255,255,255,.56)}.slots{display:grid;grid-template-columns:repeat(7,1fr);gap:10px}.slotDay{padding:14px;border-radius:22px}.slotDay h4{font-family:"Space Grotesk";font-size:18px;letter-spacing:-.04em}.slotList{display:grid;gap:7px;margin-top:12px}.slot{padding:8px 9px;border-radius:12px;font-size:11px;font-weight:850;color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.05)}.slot.open{color:var(--green);border-color:rgba(73,230,165,.18);background:rgba(73,230,165,.09)}.slot.limited{color:var(--amber);border-color:rgba(255,209,102,.18);background:rgba(255,209,102,.08)}.slot.busy{color:rgba(255,255,255,.38)}.faq{display:grid;gap:12px;max-width:860px;margin:0 auto}details.card{padding:0}summary{display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:76px;padding:22px 24px;cursor:pointer;list-style:none;font-weight:900;letter-spacing:-.02em}summary::-webkit-details-marker{display:none}.plus{display:grid;place-items:center;width:31px;height:31px;flex-shrink:0;border-radius:12px;color:white;background:rgba(255,255,255,.08);transition:transform .18s ease}details[open] .plus{transform:rotate(45deg)}details.card p{padding:0 24px 24px;margin:0;color:rgba(255,255,255,.58);line-height:1.65}.final{padding:42px;border-radius:44px;overflow:hidden;background:radial-gradient(800px circle at 12% 0%,rgba(124,92,255,.22),transparent 42%),radial-gradient(800px circle at 90% 20%,rgba(255,79,216,.16),transparent 44%),linear-gradient(180deg,rgba(255,255,255,.11),rgba(255,255,255,.045))}.finalGrid{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:center}.finalTitle{max-width:820px;margin-top:14px;font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(42px,5vw,78px);line-height:.88;font-weight:800;letter-spacing:-.075em}.finalText{max-width:650px;margin-top:18px;color:rgba(255,255,255,.62);font-size:18px;line-height:1.65}.finalActions{display:grid;gap:12px;min-width:220px}.footer{padding:28px 0 calc(28px + var(--safe-bottom));border-top:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.22)}.foot{display:flex;align-items:center;justify-content:space-between;gap:22px}.footTitle{font-family:"Space Grotesk",Inter,sans-serif;font-size:20px;font-weight:800;letter-spacing:-.045em}.footCopy{margin-top:4px;color:rgba(255,255,255,.42);font-size:12px;font-weight:700}.footLinks{display:flex;align-items:center;gap:18px;color:rgba(255,255,255,.48);font-size:13px;font-weight:800}.footLinks a:hover{color:white}.mobileSticky{display:none}.toast{position:fixed;right:18px;bottom:18px;z-index:1600;display:none;max-width:360px;padding:16px 18px;border-radius:22px;background:rgba(7,10,18,.86);border:1px solid rgba(255,255,255,.14);box-shadow:var(--shadow);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);color:rgba(255,255,255,.78);font-size:14px;line-height:1.5;font-weight:750}.toast.show{display:block;animation:toastIn .26s ease both}@keyframes toastIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}.reveal{opacity:0;transform:translateY(20px);transition:opacity .72s cubic-bezier(.22,1,.36,1),transform .72s cubic-bezier(.22,1,.36,1)}.reveal.show{opacity:1;transform:translateY(0)}.d1{transition-delay:.08s}.d2{transition-delay:.16s}.d3{transition-delay:.24s}
    @media(max-width:1050px){.desktopNav{display:none}.menuBtn{display:inline-flex}.hero,.twoCol,.grid2,.authWrap{grid-template-columns:1fr}.hero{min-height:auto;padding-top:48px}.deviceShell{margin-inline:auto}.stats{grid-template-columns:repeat(2,1fr)}.slots{grid-template-columns:repeat(2,1fr)}}@media(max-width:820px){.grid4,.grid3,.priceCards,.bookingMeta{grid-template-columns:repeat(2,1fr)}.finalGrid{grid-template-columns:1fr}.finalActions{grid-template-columns:repeat(2,1fr)}}@media(max-width:620px){.container{width:min(100% - 26px,1240px)}.nav{min-height:66px}.logoIcon{width:40px;height:40px;border-radius:16px}.logoTitle{font-size:20px}.logoSub{display:none}.hero{padding:34px 0;gap:34px}.heroTitle{font-size:clamp(51px,16vw,74px);letter-spacing:-.069em}.heroDesc{font-size:16px;line-height:1.7}.heroActions,.stats,.miniGrid,.taskGrid,.formGrid,.formActions,.mobileActions,.grid4,.grid3,.priceCards,.slots,.bookingMeta,.finalActions{grid-template-columns:1fr}.available{display:none}.section{padding:64px 0}.sectionHeader{margin-bottom:28px}.card,.formBox,.final,.authCard{border-radius:26px;padding:20px}.estimateRow{align-items:flex-start;flex-direction:column}.estimateSide{text-align:left}.estimatePrice,.priceAmount{font-size:58px}.foot{flex-direction:column;text-align:center}.footLinks{justify-content:center;flex-wrap:wrap}.mobileSticky{position:fixed;left:12px;right:12px;bottom:calc(12px + var(--safe-bottom));z-index:1200;display:grid;grid-template-columns:1fr 1fr;gap:10px}.mobileSticky .btn{min-height:50px}.toast{left:12px;right:12px;bottom:calc(82px + var(--safe-bottom));max-width:none}.bookingTop,.accountHeader{flex-direction:column}.adminActions form{width:100%;flex-direction:column;align-items:stretch}.adminActions .btn{width:100%}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.reveal{opacity:1;transform:none}}
  </style>
</head>
<body>
  <div class="orb one"></div><div class="orb two"></div><div class="orb three"></div><div id="progress" class="progress"></div>
  ${body}
  <div id="toast" class="toast"></div>
  <script>
    const $ = (s, r=document) => r.querySelector(s);
    const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
    const progress = $('#progress');
    function updateProgress(){ if(!progress)return; const h=document.documentElement.scrollHeight-window.innerHeight; const p=h>0?window.scrollY/h:0; progress.style.transform='scaleX('+Math.max(0,Math.min(1,p))+')'; }
    updateProgress(); window.addEventListener('scroll',()=>requestAnimationFrame(updateProgress),{passive:true});
    const menuBtn=$('#menuBtn'), mobileMenu=$('#mobileMenu');
    if(menuBtn&&mobileMenu){ menuBtn.addEventListener('click',()=>{ const open=mobileMenu.classList.toggle('open'); menuBtn.setAttribute('aria-expanded',String(open)); }); $$('#mobileMenu a').forEach(a=>a.addEventListener('click',()=>{ mobileMenu.classList.remove('open'); menuBtn.setAttribute('aria-expanded','false'); })); }
    const reveals=$$('.reveal');
    if('IntersectionObserver' in window){ const io=new IntersectionObserver(es=>{ es.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('show'); io.unobserve(e.target); } }); },{threshold:.12,rootMargin:'0px 0px -8% 0px'}); reveals.forEach(el=>io.observe(el)); } else reveals.forEach(el=>el.classList.add('show'));
    const device=$('#heroDevice'); if(device && window.matchMedia('(pointer:fine)').matches){ device.addEventListener('mousemove',e=>{ const r=device.getBoundingClientRect(); const x=((e.clientX-r.left)/r.width)*100; const y=((e.clientY-r.top)/r.height)*100; device.style.setProperty('--mx',x+'%'); device.style.setProperty('--my',y+'%'); }); }
    function showToast(msg){ const t=$('#toast'); if(!t)return; t.textContent=msg; t.classList.add('show'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>t.classList.remove('show'),3600); }
    const estimateFields = ['bags','stairs','heavy','placement','urgency','distance'].map(id => $('#'+id));
    async function updateEstimate(){ if(!estimateFields.every(Boolean)) return; const params = new URLSearchParams({bags:$('#bags').value,stairs:$('#stairs').value,heavy:$('#heavy').value,placement:$('#placement').value,urgency:$('#urgency').value,distance:$('#distance').value}); try{ const res=await fetch('/api/estimate?'+params.toString()); const data=await res.json(); ['estimatePrice','livePrice'].forEach(id=>{ const el=$('#'+id); if(el) el.textContent=data.price; }); ['estimateTime','liveTime'].forEach(id=>{ const el=$('#'+id); if(el) el.textContent=data.minutes; }); const deposit=$('#estimateDeposit'); if(deposit) deposit.textContent=data.deposit; const breakdown=$('#estimateBreakdown'); if(breakdown){ breakdown.innerHTML = data.breakdown.map(item => '<div class="metaBox"><span>'+item.label+'</span><strong>$'+item.amount+'</strong></div>').join(''); } const sms=$('#smsLink'); if(sms){ sms.href='sms:${escapeHtml(BUSINESS_PHONE)}?body='+encodeURIComponent('Hey Dropcart, I need a grocery unload. Estimate: $'+data.price+', about '+data.minutes+' minutes.'); } }catch(err){ console.error(err); } }
    estimateFields.forEach(el=>{ if(el){ el.addEventListener('input',updateEstimate); el.addEventListener('change',updateEstimate); } }); updateEstimate();
    async function loadSlots(){ const wrap=$('#slotWrap'); if(!wrap) return; try{ const res=await fetch('/api/availability'); const data=await res.json(); wrap.innerHTML=data.days.map(day => '<div class="slotDay glass"><h4>'+day.label+'</h4><div class="slotList">'+day.windows.map(w => '<div class="slot '+w.level+'">'+w.window+' · '+w.level+'</div>').join('')+'</div></div>').join(''); }catch(err){ wrap.innerHTML='<div class="card glass">Could not load availability.</div>'; } }
    loadSlots();
    const areaForm=$('#areaForm'); if(areaForm){ areaForm.addEventListener('submit',async e=>{ e.preventDefault(); const out=$('#areaResult'); const params=new URLSearchParams(new FormData(areaForm)); try{ const res=await fetch('/api/area?'+params.toString()); const data=await res.json(); out.innerHTML='<strong>'+data.message+'</strong><br>Status: '+data.status+(data.fee?' · Possible distance fee: $'+data.fee:''); out.className='areaResult'; }catch(err){ out.textContent='Could not check area.'; out.className='areaResult'; } }); }
    const requestForm=$('#requestForm'); if(requestForm){ requestForm.addEventListener('submit',async e=>{ e.preventDefault(); const status=$('#formStatus'); const data=Object.fromEntries(new FormData(requestForm).entries()); estimateFields.forEach(el=>{ if(el && !data[el.id]) data[el.id]=el.value; }); try{ const res=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); const out=await res.json(); if(!res.ok) throw new Error(out.message||'Something went wrong'); status.textContent='Request saved! Booking ID: '+out.booking.id+'.'; status.className='status success'; showToast('Booking request saved.'); requestForm.reset(); updateEstimate(); }catch(err){ status.textContent=err.message; status.className='status error'; showToast(err.message); } }); }
  </script>
</body>
</html>`;
}

function header(req) {
  const customer = currentCustomer(req);
  const employee = isEmployee(req);
  const csrf = req ? csrfToken(req) : "";
  const customerLinks = customer
    ? `<a class="navLink" href="/account">Account</a><form method="post" action="/logout" style="display:inline">${csrfField(req)}<button class="navLink" style="border:0;background:transparent;cursor:pointer" type="submit">Logout</button></form>`
    : `<a class="navLink" href="/login">Login</a><a class="btn ghost" href="/signup">Sign up</a>`;
  const employeeLink = employee ? `<a class="navLink" href="/employee">Employee</a>` : ``;
  return `<header class="header">
    <div class="container nav">
      <a class="logo" href="/#top" aria-label="${escapeHtml(SERVICE_NAME)} home"><span class="logoIcon" aria-hidden="true"><svg width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="M3 4h2l1.1 5.7M7.4 15h9.9L21 7H6.1" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 20.2h.01M17 20.2h.01" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/></svg></span><span><span class="logoTitle">${escapeHtml(SERVICE_NAME)}</span><span class="logoSub">${escapeHtml(CITY)} grocery unloading</span></span></a>
      <nav class="desktopNav" aria-label="Main navigation"><a class="navLink" href="/#how">How it works</a><a class="navLink" href="/#pricing">Pricing</a><a class="navLink" href="/#estimate">Estimate</a><a class="navLink" href="/#area">Area</a>${customerLinks}${employeeLink}<a class="btn primary" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call now</a></nav>
      <button id="menuBtn" class="btn ghost menuBtn" aria-label="Open menu" aria-expanded="false"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/></svg></button>
    </div>
    <div id="mobileMenu" class="mobileMenu container"><div class="mobilePanel glass"><a href="/#how">How it works <span>→</span></a><a href="/#pricing">Pricing <span>→</span></a><a href="/#estimate">Estimate <span>→</span></a><a href="/#area">Service area <span>→</span></a>${customer ? `<a href="/account">Account <span>→</span></a><form method="post" action="/logout">${csrfField(req)}<button type="submit">Logout <span>→</span></button></form>` : `<a href="/login">Customer login <span>→</span></a><a href="/signup">Create account <span>→</span></a>`}${employee ? `<a href="/employee">Employee <span>→</span></a>` : ``}<div class="mobileActions"><a class="btn ghost" href="/#contact">Book</a><a class="btn primary" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call now</a></div></div></div>
  </header>`;
}
function footer(req) {
  return `<footer class="footer"><div class="container foot"><div><div class="footTitle">${escapeHtml(SERVICE_NAME)}</div><div class="footCopy">© ${new Date().getFullYear()} ${escapeHtml(SERVICE_NAME)}. ${escapeHtml(CITY)}, ${escapeHtml(STATE)}. Grocery unloading made simple.</div></div><div class="footLinks"><a href="/#pricing">Pricing</a><a href="/#area">Area</a><a href="/#contact">Contact</a><a href="/login">Login</a><a href="/signup">Sign up</a></div></div></footer>`;
}

function bookingCard(b, { employeeView = false } = {}) {
  const color = statusColor(b.status);
  const created = new Date(b.createdAt).toLocaleString();
  const updated = b.updatedAt ? new Date(b.updatedAt).toLocaleString() : "—";
  const statusOptions = VALID_STATUSES.map((status) => `<option value="${status}" ${status === b.status ? "selected" : ""}>${status}</option>`).join("");
  return `<article class="bookingCard glass"><div class="bookingTop"><div><span class="badge ${color}">${escapeHtml(b.status)}</span><h3 class="display" style="margin-top:12px;font-size:30px;letter-spacing:-.05em">${escapeHtml(b.name)}</h3><p style="color:rgba(255,255,255,.58);line-height:1.6;margin-top:6px">${escapeHtml(b.phone)}${b.email ? " · " + escapeHtml(b.email) : ""}</p></div><div style="text-align:right;color:rgba(255,255,255,.45);font-size:12px;font-weight:800">${escapeHtml(b.id)}<br>${escapeHtml(created)}</div></div><div class="bookingMeta"><div class="metaBox"><span>Address</span><strong>${escapeHtml(b.address)}</strong></div><div class="metaBox"><span>ZIP / Area</span><strong>${escapeHtml(b.zip || "—")} · ${escapeHtml(b.area?.status || "unknown")}</strong></div><div class="metaBox"><span>Preferred</span><strong>${escapeHtml(b.date || "Any day")} · ${escapeHtml(b.timeWindow || "Flexible")}</strong></div><div class="metaBox"><span>Estimate</span><strong>${money(b.estimate?.price)} · ${escapeHtml(String(b.estimate?.minutes || "?"))}m</strong></div><div class="metaBox"><span>Bags</span><strong>${escapeHtml(String(b.estimate?.bags || "—"))}</strong></div><div class="metaBox"><span>Stairs</span><strong>${escapeHtml(String(b.estimate?.stairs || "—"))}</strong></div><div class="metaBox"><span>Heavy</span><strong>${escapeHtml(String(b.estimate?.heavy || "—"))}</strong></div><div class="metaBox"><span>Updated</span><strong>${escapeHtml(updated)}</strong></div></div><p style="margin-top:14px;color:rgba(255,255,255,.6);line-height:1.65">${escapeHtml(b.notes || "No notes.")}</p>${employeeView ? `<div class="adminActions"><form method="post" action="/employee/bookings/${encodeURIComponent(b.id)}/status">${csrfField({session:{csrfToken:"PLACEHOLDER"}}).replace('PLACEHOLDER', '')}</form></div>` : ""}</article>`;
}

function employeeBookingCard(req, b) {
  const color = statusColor(b.status);
  const created = new Date(b.createdAt).toLocaleString();
  const updated = b.updatedAt ? new Date(b.updatedAt).toLocaleString() : "—";
  const statusOptions = VALID_STATUSES.map((status) => `<option value="${status}" ${status === b.status ? "selected" : ""}>${status}</option>`).join("");
  return `<article class="bookingCard glass"><div class="bookingTop"><div><span class="badge ${color}">${escapeHtml(b.status)}</span><h3 class="display" style="margin-top:12px;font-size:30px;letter-spacing:-.05em">${escapeHtml(b.name)}</h3><p style="color:rgba(255,255,255,.58);line-height:1.6;margin-top:6px">${escapeHtml(b.phone)}${b.email ? " · " + escapeHtml(b.email) : ""}${b.customerId ? " · customer account" : " · guest"}</p></div><div style="text-align:right;color:rgba(255,255,255,.45);font-size:12px;font-weight:800">${escapeHtml(b.id)}<br>${escapeHtml(created)}</div></div><div class="bookingMeta"><div class="metaBox"><span>Address</span><strong>${escapeHtml(b.address)}</strong></div><div class="metaBox"><span>ZIP / Area</span><strong>${escapeHtml(b.zip || "—")} · ${escapeHtml(b.area?.status || "unknown")}</strong></div><div class="metaBox"><span>Preferred</span><strong>${escapeHtml(b.date || "Any day")} · ${escapeHtml(b.timeWindow || "Flexible")}</strong></div><div class="metaBox"><span>Estimate</span><strong>${money(b.estimate?.price)} · ${escapeHtml(String(b.estimate?.minutes || "?"))}m</strong></div><div class="metaBox"><span>Bags</span><strong>${escapeHtml(String(b.estimate?.bags || "—"))}</strong></div><div class="metaBox"><span>Stairs</span><strong>${escapeHtml(String(b.estimate?.stairs || "—"))}</strong></div><div class="metaBox"><span>Heavy</span><strong>${escapeHtml(String(b.estimate?.heavy || "—"))}</strong></div><div class="metaBox"><span>Updated</span><strong>${escapeHtml(updated)}</strong></div></div><p style="margin-top:14px;color:rgba(255,255,255,.6);line-height:1.65">${escapeHtml(b.notes || "No notes.")}</p><div class="adminActions"><form method="post" action="/employee/bookings/${encodeURIComponent(b.id)}/status">${csrfField(req)}<select name="status">${statusOptions}</select><button class="btn primary" type="submit">Update</button></form><form method="post" action="/employee/bookings/${encodeURIComponent(b.id)}/delete" onsubmit="return confirm('Delete this booking?')">${csrfField(req)}<button class="btn danger" type="submit">Delete</button></form><a class="btn ghost" href="tel:${escapeHtml(b.phone)}">Call</a><a class="btn ghost" href="sms:${escapeHtml(b.phone)}?body=${encodeURIComponent("Hey, this is Dropcart. I saw your grocery unload request and wanted to confirm the details.")}">Text</a></div></article>`;
}

function homePage(req) {
  const customer = currentCustomer(req);
  const analytics = getAnalytics();
  const bookings = readBookings();
  const pending = bookings.filter((b) => ["new", "contacted", "confirmed"].includes(b.status)).length;
  const body = `${header(req)}<main id="top"><section class="container hero"><div class="reveal"><span class="chip"><span class="dot"></span>${escapeHtml(CITY)}, ${escapeHtml(STATE)} · Local grocery unloading</span><h1 class="heroTitle">You got the groceries. <span class="shine">We do the lifting.</span></h1><p class="heroDesc">${escapeHtml(SERVICE_NAME)} unloads your car, carries everything inside, and places groceries in the kitchen, fridge, pantry, garage, or wherever you need them. Create an account to save your requests, track your unloads, and make future grocery trips easier.</p><div class="heroActions"><a href="tel:${escapeHtml(BUSINESS_PHONE)}" class="btn primary">Call ${escapeHtml(DISPLAY_PHONE)}</a><a href="${customer ? "/account" : "/signup"}" class="btn ghost">${customer ? "Open my account" : "Create customer account"}</a><a href="#estimate" class="btn ghost">Get estimate</a></div><p class="heroNote">Book online or call when you are heading home from the store.</p><div class="stats"><div class="stat soft reveal d1"><div class="statNum">$29+</div><div class="statLab">starting price</div></div><div class="stat soft reveal d2"><div class="statNum">${escapeHtml(String(readCustomers().length))}</div><div class="statLab">customer accounts</div></div><div class="stat soft reveal d3"><div class="statNum">${escapeHtml(String(pending))}</div><div class="statLab">active requests</div></div><div class="stat soft reveal d3"><div class="statNum">${escapeHtml(String(analytics.bookings))}</div><div class="statLab">bookings submitted</div></div></div></div><div class="reveal d2"><div class="deviceShell"><div id="heroDevice" class="device glass"><div class="screen"><div class="phoneBar"></div><div class="requestTop"><div><div class="kicker">Unload request</div><div class="requestTitle">Car to kitchen</div></div><div class="available"><span class="dot"></span>Open</div></div><div class="requestCard"><div class="requestRow"><div class="requestIcon">🛒</div><div class="requestInfo"><h3>Quick grocery help</h3><p>Tell us what you have, where it goes, and when you need help.</p></div></div><div class="miniGrid"><div class="mini"><div class="miniLabel">Estimated price</div><div class="miniValue">$<span id="livePrice">29</span></div></div><div class="mini"><div class="miniLabel">Estimated time</div><div class="miniValue"><span id="liveTime">45</span>m</div></div></div></div><div class="taskGrid"><div class="task"><div class="taskEmoji">🚗</div><div class="taskText">Car</div></div><div class="task"><div class="taskEmoji">🥶</div><div class="taskText">Cold items</div></div><div class="task"><div class="taskEmoji">🏠</div><div class="taskText">Home</div></div></div><div class="ready"><div><h4>Need help today?</h4><p>Send a request and we will follow up.</p></div><a class="btn primary" href="${customer ? "/account" : "/login"}">${customer ? "Account" : "Login"}</a></div></div></div></div></div></section>
  <section class="container section"><div class="grid4"><article class="card glass reveal"><div class="icon">🚗</div><h3>Car-to-kitchen</h3><p>We unload your vehicle and carry groceries where they need to go.</p></article><article class="card glass reveal d1"><div class="icon">🥶</div><h3>Cold items first</h3><p>Freezer and fridge items can be handled first so nothing sits out too long.</p></article><article class="card glass reveal d2"><div class="icon">💪</div><h3>Heavy items</h3><p>Cases of water, bulk groceries, stairs, and awkward bags are exactly what we help with.</p></article><article class="card glass reveal d3"><div class="icon">📲</div><h3>Easy tracking</h3><p>Create an account to see your requests and keep your info ready for next time.</p></article></div></section>
  <section id="how" class="container section"><div class="sectionHeader reveal"><span class="chip">How it works</span><h2 class="sectionTitle">Shop. Request. Relax.</h2><p class="sectionSub">A simple service for days when carrying groceries inside feels like too much.</p></div><div class="grid4"><article class="card glass reveal"><div class="stepNum">1</div><h3>Finish shopping</h3><p>Call or send a request when you are about to head home.</p></article><article class="card glass reveal d1"><div class="stepNum">2</div><h3>Share the details</h3><p>Tell us your address, amount of groceries, stairs, and any special notes.</p></article><article class="card glass reveal d2"><div class="stepNum">3</div><h3>We confirm</h3><p>You get a clear estimate and a follow-up before the unload.</p></article><article class="card glass reveal d3"><div class="stepNum">4</div><h3>We unload</h3><p>Your groceries go from car to kitchen, pantry, fridge, or wherever you ask.</p></article></div></section>
  <section id="pricing" class="container section"><div class="grid2"><div class="reveal"><span class="chip">Pricing</span><h2 class="sectionTitle">Clear prices that make sense.</h2><p class="sectionSub" style="margin-left:0;text-align:left;">Your estimate considers bags, stairs, heavy items, placement help, timing, and distance.</p></div><div class="priceCards"><article class="card glass popular reveal d1"><div class="priceTop"><div><h3 class="priceName">Quick unload</h3><p class="priceDesc">For normal weekly grocery trips.</p></div><span class="chip">Best start</span></div><div class="priceMain"><span class="priceAmount">$29</span><span class="priceUnit">starting</span></div><ul class="checks"><li><span class="check">✓</span>Car-to-kitchen unload</li><li><span class="check">✓</span>Cold items first if requested</li><li><span class="check">✓</span>Stairs and heavy items estimated</li><li><span class="check">✓</span>Track requests in customer account</li></ul><a class="btn primary" style="margin-top:26px;width:100%" href="#contact">Book quick unload</a><p class="fine">Final price confirmed before dispatch.</p></article><article class="card glass reveal d2"><div class="priceTop"><div><h3 class="priceName">Family plan</h3><p class="priceDesc">For frequent shoppers.</p></div><span class="chip">Save</span></div><div class="priceMain"><span class="priceAmount">$79</span><span class="priceUnit">/mo</span></div><ul class="checks"><li><span class="check">✓</span>4 unloads per month</li><li><span class="check">✓</span>Priority response window</li><li><span class="check">✓</span>1 unused unload rolls over</li><li><span class="check">✓</span>Customer account history</li></ul><a class="btn ghost" style="margin-top:26px;width:100%" href="#contact">Ask about plan</a><p class="fine">Plans can be adjusted based on availability.</p></article></div></div></section>
  ${estimateSection()} ${areaSection()} ${contactSection(req, customer)} ${faqSection()}<section class="container section" style="padding-top:30px"><div class="final glass reveal"><div class="finalGrid"><div><span class="chip">Ready?</span><h2 class="finalTitle">Make grocery runs feel lighter.</h2><p class="finalText">Get help unloading your groceries without making ten trips back and forth from the car.</p></div><div class="finalActions"><a href="${customer ? "/account" : "/signup"}" class="btn primary">Customer portal</a><a href="tel:${escapeHtml(BUSINESS_PHONE)}" class="btn ghost">Call now</a></div></div></div></section></main>${footer(req)}<div class="mobileSticky"><a class="btn ghost" href="${customer ? "/account" : "/login"}">${customer ? "Account" : "Login"}</a><a class="btn primary" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call now</a></div>`;
  return pageShell({ req, title: `${SERVICE_NAME} — Grocery Unloading`, body });
}

function estimateSection() {
  return `<section id="estimate" class="container section"><div class="twoCol"><div class="reveal"><span class="chip">Quick estimate</span><h2 class="sectionTitle">See what your unload might cost.</h2><p class="sectionSub" style="margin-left:0;text-align:left;">Adjust a few details to get a rough price before you send a request. The final price is confirmed before anyone heads your way.</p></div><form id="estimateForm" class="formBox glass reveal d1"><div class="formGrid"><div class="field"><label for="bags">Grocery bags</label><input id="bags" name="bags" type="number" min="1" max="120" value="12" /></div><div class="field"><label for="stairs">Flights of stairs</label><select id="stairs" name="stairs"><option value="0">0 flights</option><option value="1">1 flight</option><option value="2">2 flights</option><option value="3">3+ flights</option></select></div><div class="field"><label for="heavy">Heavy items</label><select id="heavy" name="heavy"><option value="0">None</option><option value="1">A few cases</option><option value="2">Lots of heavy stuff</option><option value="3">Very heavy / bulk</option></select></div><div class="field"><label for="placement">Placement</label><select id="placement" name="placement"><option value="0">Kitchen only</option><option value="1">Fridge + pantry</option><option value="2">Full sorting help</option><option value="3">Full setup / organize</option></select></div><div class="field"><label for="urgency">Timing</label><select id="urgency" name="urgency"><option value="0">Flexible</option><option value="1">Today</option><option value="2">Rush / ASAP</option></select></div><div class="field"><label for="distance">Distance</label><select id="distance" name="distance"><option value="0">Inside Inverness</option><option value="1">Near edge</option><option value="2">Outside core area</option></select></div></div><div class="estimateResult"><div class="estimateRow"><div><div class="estimateLabel">Estimated total</div><div class="estimatePrice">$<span id="estimatePrice">29</span></div></div><div class="estimateSide"><div><span id="estimateTime">45</span> minute estimate</div><div>$<span id="estimateDeposit">10</span> suggested deposit</div></div></div></div><div id="estimateBreakdown" class="bookingMeta"></div><div class="formActions"><a class="btn primary" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call to book</a><a id="smsLink" class="btn ghost" href="sms:${escapeHtml(BUSINESS_PHONE)}?body=Hey%20Dropcart%2C%20I%20need%20a%20grocery%20unload.">Text request</a></div></form></div></section>`;
}
function areaSection() {
  return `<section id="area" class="container section"><div class="grid2"><article class="card glass reveal"><span class="chip">Service area</span><h2 class="sectionTitle">Built for ${escapeHtml(CITY)} first.</h2><p class="sectionSub" style="margin-left:0;text-align:left;">We are starting local so service stays fast and reliable. Check your ZIP or city before sending a request.</p><form id="areaForm" style="margin-top:24px"><div class="formGrid"><div class="field"><label for="zip">ZIP</label><input id="zip" name="zip" placeholder="34450" /></div><div class="field"><label for="areaAddress">Address / city</label><input id="areaAddress" name="address" placeholder="Inverness, FL" /></div></div><button class="btn primary" style="margin-top:14px;width:100%" type="submit">Check service area</button><div id="areaResult" class="areaResult">Try ZIP 34450, 34452, or 34453.</div></form></article><article class="card glass reveal d1"><div class="map"><div><span class="chip">Local coverage</span><h3 class="display" style="margin-top:18px;font-size:38px;line-height:.95;letter-spacing:-.06em;">Inverness radius</h3><p style="margin-top:12px;max-width:410px;color:rgba(255,255,255,.58);line-height:1.65;font-size:14px;">Serving Inverness first helps keep response times realistic and personal.</p></div><div class="rings"><div class="pin">📍</div></div><a class="btn primary" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call to check address</a></div></article></div></section>`;
}
function contactSection(req, customer) {
  return `<section id="contact" class="container section"><div class="twoCol"><article class="card glass reveal"><span class="chip">Book now</span><h2 class="sectionTitle">Request a grocery unload.</h2><p class="sectionSub" style="margin-left:0;text-align:left;">${customer ? "You are logged in, so this request will show in your account." : "You can book as a guest, or create an account so your request history is saved for next time."}</p><div style="display:grid;gap:10px;margin-top:26px"><a class="soft" style="padding:14px;border-radius:20px;color:rgba(255,255,255,.66);font-weight:800" href="tel:${escapeHtml(BUSINESS_PHONE)}">📞 ${escapeHtml(DISPLAY_PHONE)}</a><a class="soft" style="padding:14px;border-radius:20px;color:rgba(255,255,255,.66);font-weight:800" href="mailto:${escapeHtml(BUSINESS_EMAIL)}">✉️ ${escapeHtml(BUSINESS_EMAIL)}</a>${customer ? `<a class="btn ghost" href="/account">View my account</a>` : `<a class="btn ghost" href="/signup">Create customer account</a>`}</div></article><form id="requestForm" class="formBox glass reveal d1"><div class="formGrid"><div class="field"><label for="name">Name</label><input id="name" name="name" placeholder="Your name" value="${customer ? escapeHtml(customer.name) : ""}" required /></div><div class="field"><label for="phone">Phone</label><input id="phone" name="phone" placeholder="${escapeHtml(DISPLAY_PHONE)}" value="${customer ? escapeHtml(customer.phone || "") : ""}" required /></div><div class="field"><label for="email">Email</label><input id="email" name="email" type="email" placeholder="optional@email.com" value="${customer ? escapeHtml(customer.email) : ""}" /></div><div class="field"><label for="bookZip">ZIP</label><input id="bookZip" name="zip" placeholder="34450" /></div><div class="field full"><label for="address">Address</label><input id="address" name="address" placeholder="Street, apartment, or neighborhood" required /></div><div class="field"><label for="date">Preferred date</label><input id="date" name="date" type="date" /></div><div class="field"><label for="timeWindow">Time window</label><select id="timeWindow" name="timeWindow"><option>ASAP / flexible</option><option>8:00 AM – 10:00 AM</option><option>10:30 AM – 12:30 PM</option><option>1:00 PM – 3:00 PM</option><option>3:30 PM – 5:30 PM</option><option>6:00 PM – 8:00 PM</option></select></div><div class="field full"><label for="notes">Notes</label><textarea id="notes" name="notes" placeholder="Bags? Stairs? Cold items? Gate code?"></textarea></div></div><button class="btn primary" style="margin-top:18px;width:100%" type="submit">Send request</button><div id="formStatus" class="status" aria-live="polite"></div></form></div></section>`;
}
function faqSection() {
  return `<section id="faq" class="container section"><div class="sectionHeader reveal"><span class="chip">FAQ</span><h2 class="sectionTitle">Quick answers.</h2></div><div class="faq"><details class="card glass reveal"><summary>Do you shop for the groceries too?<span class="plus">+</span></summary><p>No. ${escapeHtml(SERVICE_NAME)} is focused on unloading and carrying groceries after they are already bought or delivered.</p></details><details class="card glass reveal d1"><summary>Can I track my request?<span class="plus">+</span></summary><p>Yes. Create an account to see your submitted requests and their current status.</p></details><details class="card glass reveal d2"><summary>Can you put groceries away?<span class="plus">+</span></summary><p>Yes. You can ask for cold items to go into the fridge or freezer first, then pantry items wherever you want them.</p></details><details class="card glass reveal d3"><summary>Is the estimate the final price?<span class="plus">+</span></summary><p>The estimate is a starting point. The final price is confirmed before help is sent your way.</p></details></div></section>`;
}

function authPage(req, type, message = "") {
  const isSignup = type === "signup";
  const isEmployeeLogin = type === "employee";
  const title = isEmployeeLogin ? "Employee login" : isSignup ? "Customer signup" : "Customer login";
  const action = isEmployeeLogin ? "/employee/login" : isSignup ? "/signup" : "/login";
  const body = `${header(req)}<main class="container authWrap"><section class="glass authCard reveal"><span class="chip">${escapeHtml(title)}</span><h1 class="authTitle" style="margin-top:18px">${isEmployeeLogin ? "Employee portal." : isSignup ? "Create your customer account." : "Welcome back."}</h1><p class="sectionSub" style="margin-left:0;text-align:left">${isEmployeeLogin ? "Employees can manage bookings, update statuses, and contact customers." : isSignup ? "Sign up to track booking requests and make future unloads faster." : "Log in to see your booking requests and status updates."}</p>${message ? `<div class="areaResult" style="border-color:rgba(255,209,102,.2);color:var(--amber)">${escapeHtml(message)}</div>` : ""}</section><form class="glass authCard reveal d1" method="post" action="${action}">${csrfField(req)}${isSignup ? `<div class="field"><label for="name">Name</label><input id="name" name="name" placeholder="Your name" required></div><div style="height:14px"></div><div class="field"><label for="phone">Phone</label><input id="phone" name="phone" placeholder="${escapeHtml(DISPLAY_PHONE)}"></div><div style="height:14px"></div>` : ""}<div class="field"><label for="email">${isEmployeeLogin ? "Employee username" : "Email"}</label><input id="email" name="email" ${isEmployeeLogin ? "" : "type=\"email\""} placeholder="${isEmployeeLogin ? escapeHtml(EMPLOYEE_USER) : "you@example.com"}" required></div><div style="height:14px"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" placeholder="••••••••" required></div><input type="hidden" name="next" value="${escapeHtml(req.query.next || "")}"><button class="btn primary" style="margin-top:18px;width:100%" type="submit">${escapeHtml(title)}</button><div style="margin-top:18px;color:rgba(255,255,255,.55);line-height:1.7;font-size:14px">${isEmployeeLogin ? `Customer? <a style="color:white;text-decoration:underline" href="/login">Customer login</a>` : isSignup ? `Already have an account? <a style="color:white;text-decoration:underline" href="/login">Log in</a>` : `Need an account? <a style="color:white;text-decoration:underline" href="/signup">Sign up</a>`}</div></form></main>${footer(req)}`;
  return pageShell({ req, title: `${SERVICE_NAME} — ${title}`, body });
}


function getCustomerBookings(customer) {
  return readBookings()
    .filter((b) => b.customerId === customer.id || (b.email && normalizeEmail(b.email) === customer.email))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getCustomerTier(bookings) {
  const completed = bookings.filter((b) => b.status === "completed").length;
  if (completed >= 12) return { name: "Diamond Cart", emoji: "💎", next: "You unlocked the top tier.", progress: 100 };
  if (completed >= 6) return { name: "Gold Cart", emoji: "⭐", next: `${12 - completed} more completed unloads to Diamond.`, progress: Math.min(100, Math.round((completed / 12) * 100)) };
  if (completed >= 2) return { name: "Silver Cart", emoji: "🛒", next: `${6 - completed} more completed unloads to Gold.`, progress: Math.min(100, Math.round((completed / 6) * 100)) };
  return { name: "Starter Cart", emoji: "🌱", next: `${Math.max(1, 2 - completed)} more completed unloads to Silver.`, progress: Math.min(100, Math.round((completed / 2) * 100)) };
}

function getPortalStatusLabel(status) {
  const map = {
    new: "Requested",
    contacted: "Contacted",
    confirmed: "Confirmed",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return map[status] || "Requested";
}

function customerPortalBookingCard(b) {
  const flow = ["new", "contacted", "confirmed", "completed"];
  const currentIndex = b.status === "cancelled" ? -1 : Math.max(0, flow.indexOf(b.status));
  const color = statusColor(b.status);
  const created = b.createdAt ? new Date(b.createdAt).toLocaleDateString() : "—";
  const updated = b.updatedAt ? new Date(b.updatedAt).toLocaleDateString() : "—";
  const timeline = b.status === "cancelled"
    ? `<div class="timelineStep active" style="grid-column:1/-1;color:var(--red);background:rgba(255,107,107,.1);border-color:rgba(255,107,107,.22)"><span class="timelineDot"></span>Cancelled</div>`
    : flow.map((status, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "";
        return `<div class="timelineStep ${state}"><span class="timelineDot"></span>${escapeHtml(getPortalStatusLabel(status))}</div>`;
      }).join("");

  return `<article class="portalBooking glass">
    <div class="portalBookingTop">
      <div>
        <span class="badge ${color}">${escapeHtml(getPortalStatusLabel(b.status))}</span>
        <div class="portalBookingTitle">${escapeHtml(b.date || "Flexible day")} · ${escapeHtml(b.timeWindow || "Flexible time")}</div>
        <p style="margin-top:8px;color:rgba(255,255,255,.58);line-height:1.6">${escapeHtml(b.address || "Address not listed")}</p>
      </div>
      <div style="text-align:right;color:rgba(255,255,255,.45);font-size:12px;font-weight:850">${escapeHtml(b.id)}<br>Created ${escapeHtml(created)}</div>
    </div>
    <div class="timeline">${timeline}</div>
    <div class="bookingMeta">
      <div class="metaBox"><span>Estimate</span><strong>${money(b.estimate?.price)} · ${escapeHtml(String(b.estimate?.minutes || "?"))}m</strong></div>
      <div class="metaBox"><span>Bags</span><strong>${escapeHtml(String(b.estimate?.bags || "—"))}</strong></div>
      <div class="metaBox"><span>Area</span><strong>${escapeHtml(b.area?.status || "unknown")}</strong></div>
      <div class="metaBox"><span>Updated</span><strong>${escapeHtml(updated)}</strong></div>
    </div>
    ${b.notes ? `<p style="margin-top:14px;color:rgba(255,255,255,.62);line-height:1.65">${escapeHtml(b.notes)}</p>` : ""}
    <div class="portalActions">
      <a class="btn ghost" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call about this</a>
      <a class="btn ghost" href="sms:${escapeHtml(BUSINESS_PHONE)}?body=${encodeURIComponent(`Hey Dropcart, I have a question about booking ${b.id}.`)}">Text about this</a>
    </div>
  </article>`;
}


function accountPage(req) {
  const customer = req.customer;
  const bookings = getCustomerBookings(customer);
  const activeBookings = bookings.filter((b) => ["new", "contacted", "confirmed"].includes(b.status));
  const completedBookings = bookings.filter((b) => b.status === "completed");
  const cancelledBookings = bookings.filter((b) => b.status === "cancelled");
  const latestActive = activeBookings[0] || null;
  const lastBooking = bookings[0] || null;
  const tier = getCustomerTier(bookings);
  const points = completedBookings.length * 120 + activeBookings.length * 25 + bookings.length * 10;
  const savedAddress = customer.defaultAddress || "";
  const savedZip = customer.defaultZip || "";
  const favoriteWindow = customer.favoriteWindow || "ASAP / flexible";
  const defaultNotes = customer.deliveryNotes || "";
  const firstName = customer.name.split(" ")[0] || customer.name;
  const progress = Math.max(4, Math.min(100, tier.progress || 0));
  const nextBookingText = latestActive
    ? `${getPortalStatusLabel(latestActive.status)} · ${latestActive.date || "Flexible day"} · ${latestActive.timeWindow || "Flexible time"}`
    : savedAddress
      ? "Your saved home is ready for a fast rebook."
      : "Add your home details to unlock faster bookings.";
  const groceryDay = favoriteWindow.includes("ASAP") ? "Flexible grocery day" : favoriteWindow;
  const comfortScore = savedAddress && customer.phone ? "Ready" : "Needs setup";
  const memoryCards = bookings.map((b) => {
    const flow = ["new", "contacted", "confirmed", "completed"];
    const currentIndex = b.status === "cancelled" ? -1 : Math.max(0, flow.indexOf(b.status));
    const created = b.createdAt ? new Date(b.createdAt).toLocaleDateString() : "—";
    const timeline = b.status === "cancelled"
      ? `<div class="memoryStep active" style="grid-column:1/-1;color:var(--red);background:rgba(255,107,107,.1);border-color:rgba(255,107,107,.22)">Cancelled</div>`
      : flow.map((status, index) => {
          const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "";
          return `<div class="memoryStep ${state}">${escapeHtml(getPortalStatusLabel(status))}</div>`;
        }).join("");
    return `<article class="memoryCard">
      <div class="memoryTop">
        <div>
          <span class="badge ${statusColor(b.status)}">${escapeHtml(getPortalStatusLabel(b.status))}</span>
          <div class="memoryTitle">${escapeHtml(b.date || "Flexible day")} · ${escapeHtml(b.timeWindow || "Flexible time")}</div>
          <p class="memoryText">${escapeHtml(b.address || "Address not listed")}</p>
        </div>
        <div style="text-align:right;color:rgba(255,255,255,.42);font-size:12px;font-weight:850">${escapeHtml(b.id)}<br>${escapeHtml(created)}</div>
      </div>
      <div class="memoryTimeline">${timeline}</div>
      <div class="comfortStrip">
        <div class="comfort"><span>Estimate</span><strong>${money(b.estimate?.price)} · ${escapeHtml(String(b.estimate?.minutes || "?"))}m</strong></div>
        <div class="comfort"><span>Bags</span><strong>${escapeHtml(String(b.estimate?.bags || "—"))}</strong></div>
        <div class="comfort"><span>Area</span><strong>${escapeHtml(b.area?.status || "unknown")}</strong></div>
      </div>
      ${b.notes ? `<p class="memoryText">${escapeHtml(b.notes)}</p>` : ""}
      <div class="tinyActions">
        <a class="btn ghost" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call</a>
        <a class="btn ghost" href="sms:${escapeHtml(BUSINESS_PHONE)}?body=${encodeURIComponent(`Hey Dropcart, I have a question about booking ${b.id}.`)}">Text</a>
      </div>
    </article>`;
  }).join("");

  const body = `${header(req)}
  <script>document.body.classList.add('portalMode');</script>
  <main class="container customerShell">
    <div class="hubTopbar reveal show">
      <div><span class="chip">${tier.emoji} ${escapeHtml(tier.name)} · Home Hub</span></div>
      <div class="hubMiniNav">
        <a href="#next-unload">Next unload</a><a href="#home-profile">Home profile</a><a href="#history">History</a>
        <form method="post" action="/logout">${csrfField(req)}<button type="submit">Logout</button></form>
      </div>
    </div>
    <section class="personalHero reveal show">
      <div class="personalHeroGrid">
        <div>
          <span class="chip"><span class="dot"></span>Your personal grocery-unload hub</span>
          <h1 class="personalGreeting">Hey ${escapeHtml(firstName)}, your home base is ready.</h1>
          <p class="personalSub">This page is built around your home, your usual unload preferences, and your request history. Save the details once, then future grocery days become a lot easier.</p>
          <div class="hubStats"><div class="hubStat"><strong>${escapeHtml(String(activeBookings.length))}</strong><span>active requests</span></div><div class="hubStat"><strong>${escapeHtml(String(completedBookings.length))}</strong><span>completed unloads</span></div><div class="hubStat"><strong>${escapeHtml(String(points))}</strong><span>pantry points</span></div><div class="hubStat"><strong>${escapeHtml(comfortScore)}</strong><span>home profile</span></div></div>
          <div class="portalActions"><a class="btn primary" href="#quick-book">Book your usual unload</a><a class="btn ghost" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call ${escapeHtml(DISPLAY_PHONE)}</a></div>
        </div>
        <aside class="todayCard"><div class="todayLabel">Today's Dropcart focus</div><div class="todayMain">${escapeHtml(nextBookingText)}</div><p class="todayText">${latestActive ? "We will update your request as it moves forward. You can call or text if anything changes." : "No active unload right now. Your saved preferences make your next request faster."}</p><div class="rewardRing"><div class="ring" style="--p:${escapeHtml(String(progress))}"><div class="ringInner">${escapeHtml(String(progress))}%</div></div><div><strong style="font-family:'Space Grotesk';font-size:24px;letter-spacing:-.05em">${escapeHtml(tier.name)}</strong><p class="hubMuted">${escapeHtml(tier.next)}</p></div></div></aside>
      </div>
    </section>
    <section class="hubLayout">
      <aside class="hubSidebar">
        <article class="hubCard"><span class="chip">Your saved home</span><h2 class="hubCardTitle">Unload comfort profile</h2><p class="hubMuted">These details are used to make repeat bookings feel personal.</p><div class="profileStack"><div class="profileLine"><span>Address</span><strong>${savedAddress ? escapeHtml(savedAddress) : "Not saved yet"}</strong></div><div class="profileLine"><span>ZIP</span><strong>${savedZip ? escapeHtml(savedZip) : "Not saved"}</strong></div><div class="profileLine"><span>Favorite time</span><strong>${escapeHtml(groceryDay)}</strong></div><div class="profileLine"><span>Notes</span><strong>${defaultNotes ? escapeHtml(defaultNotes.slice(0, 60)) : "No default notes"}</strong></div></div></article>
        <article class="hubCard"><span class="chip">Rewards</span><h2 class="hubCardTitle">Pantry Points</h2><div class="rewardRing"><div class="ring" style="--p:${escapeHtml(String(progress))}"><div class="ringInner">${escapeHtml(String(points))}</div></div><div><p class="hubMuted">Keep using Dropcart to move up tiers and unlock better perks later.</p></div></div><div class="homeMood"><div class="moodTile"><b>🛒</b><span>Easy trips</span></div><div class="moodTile"><b>🥶</b><span>Cold first</span></div><div class="moodTile"><b>🏠</b><span>Home ready</span></div></div></article>
      </aside>
      <section class="hubMain">
        <article id="next-unload" class="hubCard"><span class="chip">Next unload</span><div class="nextUnloadFocus"><div class="focusPanel"><h3>${latestActive ? "Your current request" : "No active unload yet"}</h3><p>${latestActive ? `${escapeHtml(latestActive.address || "Address not listed")} · ${escapeHtml(getPortalStatusLabel(latestActive.status))}` : "Save your home profile, then send a repeat request in under a minute."}</p><div class="tinyActions"><a class="btn primary" href="#quick-book">Book again</a><a class="btn ghost" href="sms:${escapeHtml(BUSINESS_PHONE)}?body=${encodeURIComponent("Hey Dropcart, I want to request a grocery unload.")}">Text Dropcart</a></div></div><div class="focusPanel"><h3>Your usual setup</h3><p>${savedAddress ? `We have your saved address and preferred window: ${escapeHtml(favoriteWindow)}.` : "Add your address, ZIP, phone, and unload notes to unlock your faster repeat booking card."}</p><div class="comfortStrip"><div class="comfort"><span>Requests</span><strong>${escapeHtml(String(bookings.length))}</strong></div><div class="comfort"><span>Cancelled</span><strong>${escapeHtml(String(cancelledBookings.length))}</strong></div><div class="comfort"><span>Last request</span><strong>${lastBooking ? escapeHtml(new Date(lastBooking.createdAt).toLocaleDateString()) : "None"}</strong></div></div></div></div></article>
        <article id="quick-book" class="hubCard"><span class="chip">Fast rebook</span><h2 class="hubCardTitle">Request your usual unload.</h2><p class="hubMuted">This uses your saved home details. Adjust the basics and send the request.</p><form class="personalForm" method="post" action="/account/quick-book">${csrfField(req)}<div class="field"><label>Bags</label><input name="bags" type="number" min="1" max="120" value="12" /></div><div class="field"><label>Stairs</label><select name="stairs"><option value="0">0 flights</option><option value="1">1 flight</option><option value="2">2 flights</option><option value="3">3+ flights</option></select></div><div class="field"><label>Heavy items</label><select name="heavy"><option value="0">None</option><option value="1">A few cases</option><option value="2">Lots of heavy stuff</option><option value="3">Very heavy / bulk</option></select></div><div class="field"><label>Placement</label><select name="placement"><option value="1">Fridge + pantry</option><option value="0">Kitchen only</option><option value="2">Full sorting help</option></select></div><div class="field"><label>Preferred date</label><input name="date" type="date" /></div><div class="field"><label>Time window</label><input name="timeWindow" value="${escapeHtml(favoriteWindow)}" /></div><div class="field full"><label>Extra notes</label><textarea name="notes" placeholder="Anything different for this unload?"></textarea></div><button class="btn primary full" type="submit" ${savedAddress ? "" : "disabled"}>${savedAddress ? "Request repeat unload" : "Save address before rebooking"}</button></form></article>
        <article id="home-profile" class="hubCard"><span class="chip">Home profile</span><h2 class="hubCardTitle">Personalize your unload experience.</h2><p class="hubMuted">Tell Dropcart where to go, when you usually need help, and how you like groceries placed.</p><form class="personalForm" method="post" action="/account/profile">${csrfField(req)}<div class="field"><label>Name</label><input name="name" value="${escapeHtml(customer.name)}" required /></div><div class="field"><label>Phone</label><input name="phone" value="${escapeHtml(customer.phone || "")}" required /></div><div class="field full"><label>Default address</label><input name="defaultAddress" value="${escapeHtml(savedAddress)}" placeholder="Street, apartment, neighborhood" /></div><div class="field"><label>Default ZIP</label><input name="defaultZip" value="${escapeHtml(savedZip)}" placeholder="34450" /></div><div class="field"><label>Favorite window</label><select name="favoriteWindow">${["ASAP / flexible", "8:00 AM – 10:00 AM", "10:30 AM – 12:30 PM", "1:00 PM – 3:00 PM", "3:30 PM – 5:30 PM", "6:00 PM – 8:00 PM"].map((window) => `<option ${favoriteWindow === window ? "selected" : ""}>${escapeHtml(window)}</option>`).join("")}</select></div><div class="field full"><label>Unload notes</label><textarea name="deliveryNotes" placeholder="Gate code, stairs, where cold items go, etc.">${escapeHtml(defaultNotes)}</textarea></div><button class="btn primary full" type="submit">Save my home profile</button></form></article>
        <article id="history" class="hubCard"><span class="chip">Unload memories</span><h2 class="hubCardTitle">Your request history.</h2><p class="hubMuted">Every saved request becomes part of your Home Hub so you can track progress and rebook faster.</p><div class="bookingMemories">${bookings.length ? memoryCards : `<div class="emptyHome">No requests yet. Fill out your Home Profile, then use Fast Rebook to send your first request.</div>`}</div></article>
      </section>
    </section>
  </main>
  ${footer(req)}`;

  return pageShell({ req, title: `${SERVICE_NAME} — Personal Home Hub`, body });
}


function employeePage(req) {
  const bookings = readBookings().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const analytics = getAnalytics();
  const customers = readCustomers();
  const statusCounts = VALID_STATUSES.reduce((acc, status) => { acc[status] = bookings.filter((b) => b.status === status).length; return acc; }, {});
  const cards = bookings.map((b) => employeeBookingCard(req, b)).join("");
  const body = `${header(req)}<main class="container section"><div class="accountHeader reveal show"><div><span class="chip">Employee dashboard</span><h1 class="adminTitle" style="margin-top:18px">Booking requests</h1><p class="sectionSub" style="margin-left:0;text-align:left">Employee-only tools for managing customers, guest bookings, statuses, and follow-up.</p></div><form method="post" action="/employee/logout">${csrfField(req)}<button class="btn ghost" type="submit">Employee logout</button></form></div><div class="stats"><div class="stat glass"><div class="statNum">${bookings.length}</div><div class="statLab">total bookings</div></div><div class="stat glass"><div class="statNum">${statusCounts.new || 0}</div><div class="statLab">new</div></div><div class="stat glass"><div class="statNum">${customers.length}</div><div class="statLab">customers</div></div><div class="stat glass"><div class="statNum">${analytics.pageViews}</div><div class="statLab">page views</div></div></div><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a class="btn primary" href="/">Back home</a><a class="btn ghost" href="/api/bookings">View JSON</a><a class="btn ghost" href="/employee/export">Export bookings</a><a class="btn ghost" href="/employee/customers">View customers</a></div><section class="bookingGrid">${bookings.length ? cards : `<div class="empty glass">No bookings yet.</div>`}</section></main>${footer(req)}`;
  return pageShell({ req, title: `${SERVICE_NAME} — Employee Dashboard`, body });
}

function customersPage(req) {
  const customers = readCustomers().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const rows = customers.map((c) => `<article class="bookingCard glass"><div class="bookingTop"><div><span class="badge purple">customer</span><h3 class="display" style="margin-top:12px;font-size:30px;letter-spacing:-.05em">${escapeHtml(c.name)}</h3><p style="color:rgba(255,255,255,.58);line-height:1.6;margin-top:6px">${escapeHtml(c.email)}${c.phone ? " · " + escapeHtml(c.phone) : ""}</p></div><div style="text-align:right;color:rgba(255,255,255,.45);font-size:12px;font-weight:800">${escapeHtml(c.id)}<br>${escapeHtml(new Date(c.createdAt).toLocaleString())}</div></div></article>`).join("");
  return pageShell({ req, title: `${SERVICE_NAME} — Customers`, body: `${header(req)}<main class="container section"><span class="chip">Employee dashboard</span><h1 class="adminTitle" style="margin-top:18px">Customers</h1><p class="sectionSub" style="margin-left:0;text-align:left">Customer accounts created through /signup.</p><div style="margin-top:24px"><a class="btn primary" href="/employee">Back to employee dashboard</a></div><section class="bookingGrid">${rows || `<div class="empty glass">No customers yet.</div>`}</section></main>${footer(req)}` });
}

// Public pages
app.get("/", (req, res) => res.send(homePage(req)));
app.get("/signup", (req, res) => res.send(authPage(req, "signup")));
app.get("/login", (req, res) => res.send(authPage(req, "login")));
app.get("/employee/login", (req, res) => res.send(authPage(req, "employee")));
app.get("/admin", (req, res) => res.redirect("/employee"));

// Customer auth
app.post("/signup", verifyCsrf, rateLimitLogin("customer-signup"), async (req, res) => {
  const name = cleanText(req.body.name, 80);
  const phone = cleanText(req.body.phone, 40);
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const passwordError = validatePassword(password);
  if (!name || !email || passwordError) return res.status(400).send(authPage(req, "signup", passwordError || "Name and email are required."));
  const customers = readCustomers();
  if (customers.some((c) => c.email === email)) return res.status(409).send(authPage(req, "signup", "That email already has an account. Try logging in."));
  const customer = { id: id("CUS"), name, phone, email, defaultAddress: "", defaultZip: "", favoriteWindow: "ASAP / flexible", deliveryNotes: "", passwordRecord: createPasswordRecord(password), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  customers.push(customer);
  saveCustomers(customers);
  bumpAnalytics("signups");
  await regenerateSession(req);
  req.session.customerId = customer.id;
  req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  res.redirect(req.body.next || "/account");
});

app.post("/login", verifyCsrf, rateLimitLogin("customer-login"), async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const customer = readCustomers().find((c) => c.email === email);
  if (!customer || !verifyPassword(password, customer.passwordRecord)) return res.status(401).send(authPage(req, "login", "Invalid email or password."));
  bumpAnalytics("customerLogins");
  await regenerateSession(req);
  req.session.customerId = customer.id;
  req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  res.redirect(req.body.next || "/account");
});

app.post("/logout", verifyCsrf, async (req, res) => {
  await destroySession(req);
  res.redirect("/");
});

// Employee auth
app.post("/employee/login", verifyCsrf, rateLimitLogin("employee-login", 6), async (req, res) => {
  const username = cleanText(req.body.email, 80);
  const password = String(req.body.password || "");
  if (username !== EMPLOYEE_USER || !verifyPassword(password, EMPLOYEE_PASSWORD_RECORD)) return res.status(401).send(authPage(req, "employee", "Invalid employee username or password."));
  bumpAnalytics("employeeLogins");
  await regenerateSession(req);
  req.session.employeeAuthed = true;
  req.session.employeeUser = EMPLOYEE_USER;
  req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  res.redirect(req.body.next || "/employee");
});
app.post("/employee/logout", verifyCsrf, async (req, res) => {
  await destroySession(req);
  res.redirect("/employee/login");
});

// Protected pages
app.get("/account", requireCustomer, (req, res) => res.send(accountPage(req)));

app.post("/account/profile", requireCustomer, verifyCsrf, (req, res) => {
  const customers = readCustomers();
  const customer = customers.find((c) => c.id === req.customer.id);
  if (!customer) return res.redirect("/login");

  customer.name = cleanText(req.body.name, 80) || customer.name;
  customer.phone = cleanText(req.body.phone, 40) || customer.phone;
  customer.defaultAddress = cleanText(req.body.defaultAddress, 180);
  customer.defaultZip = digitsOnly(req.body.defaultZip).slice(0, 5);
  customer.favoriteWindow = cleanText(req.body.favoriteWindow, 80) || "ASAP / flexible";
  customer.deliveryNotes = cleanText(req.body.deliveryNotes, 900);
  customer.updatedAt = new Date().toISOString();

  saveCustomers(customers);
  res.redirect("/account");
});

app.post("/account/quick-book", requireCustomer, verifyCsrf, (req, res) => {
  const customer = req.customer;
  const address = cleanText(customer.defaultAddress, 180);
  const zip = digitsOnly(customer.defaultZip).slice(0, 5);

  if (!address) return res.status(400).send("Save a default address in your Home Hub before using repeat booking.");

  const date = cleanText(req.body.date, 40);
  const timeWindow = cleanText(req.body.timeWindow || customer.favoriteWindow, 80);
  const notes = cleanText([customer.deliveryNotes, req.body.notes].filter(Boolean).join(" | "), 900);
  const estimate = calculateEstimate(req.body);
  const area = checkServiceArea({ zip, address });
  const bookings = readBookings();

  const booking = {
    id: id("DC"),
    customerId: customer.id,
    status: "new",
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address,
    zip,
    date,
    timeWindow,
    notes,
    estimate,
    area,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "customer-home-hub",
  };

  bookings.push(booking);
  saveBookings(bookings);
  bumpAnalytics("bookings");
  res.redirect("/account");
});

app.get("/employee", requireEmployee, (req, res) => res.send(employeePage(req)));
app.get("/employee/customers", requireEmployee, (req, res) => res.send(customersPage(req)));

// APIs
app.get("/health", (req, res) => res.json({ ok: true, service: SERVICE_NAME, time: new Date().toISOString() }));
app.get("/api/estimate", (req, res) => { bumpAnalytics("estimates"); res.json(calculateEstimate(req.query)); });
app.get("/api/area", (req, res) => { bumpAnalytics("areaChecks"); res.json(checkServiceArea(req.query)); });
app.get("/api/availability", (req, res) => res.json({ ok: true, days: getAvailability() }));
app.get("/api/bookings", requireEmployee, (req, res) => res.json({ ok: true, bookings: readBookings(), customers: readCustomers().map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone })), analytics: getAnalytics() }));
app.get("/api/account/bookings", requireCustomer, (req, res) => {
  const customer = req.customer;
  const bookings = readBookings().filter((b) => b.customerId === customer.id || normalizeEmail(b.email) === customer.email);
  res.json({ ok: true, bookings });
});

app.post("/api/bookings", (req, res) => {
  const customer = currentCustomer(req);
  const name = cleanText(req.body.name || customer?.name, 80);
  const phone = cleanText(req.body.phone || customer?.phone, 40);
  const email = normalizeEmail(req.body.email || customer?.email);
  const address = cleanText(req.body.address, 180);
  const zip = digitsOnly(req.body.zip).slice(0, 5);
  const date = cleanText(req.body.date, 40);
  const timeWindow = cleanText(req.body.timeWindow, 80);
  const notes = cleanText(req.body.notes, 900);
  if (!name || !phone || !address) return res.status(400).json({ ok: false, message: "Please fill out name, phone, and address." });
  const estimate = calculateEstimate(req.body);
  const area = checkServiceArea({ zip, address });
  const bookings = readBookings();
  const booking = { id: id("DC"), customerId: customer?.id || "", status: "new", name, phone, email, address, zip, date, timeWindow, notes, estimate, area, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: customer ? "customer-account" : "guest-website" };
  bookings.push(booking);
  saveBookings(bookings);
  bumpAnalytics("bookings");
  res.status(201).json({ ok: true, message: "Booking request saved.", booking });
});

app.post("/api/leads", (req, res) => {
  const name = cleanText(req.body.name, 80);
  const phone = cleanText(req.body.phone, 40);
  const email = normalizeEmail(req.body.email);
  const zip = digitsOnly(req.body.zip).slice(0, 5);
  if (!phone && !email) return res.status(400).json({ ok: false, message: "Add a phone or email." });
  const leads = readLeads();
  const lead = { id: id("LEAD"), name, phone, email, zip, createdAt: new Date().toISOString() };
  leads.push(lead);
  saveLeads(leads);
  res.status(201).json({ ok: true, lead });
});

// Employee actions
app.get("/employee/export", requireEmployee, (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${SERVICE_NAME.toLowerCase()}-bookings.json"`);
  res.send(JSON.stringify(readBookings(), null, 2));
});
app.post("/employee/bookings/:id/status", requireEmployee, verifyCsrf, (req, res) => {
  const status = cleanText(req.body.status, 40);
  if (!VALID_STATUSES.includes(status)) return res.status(400).send("Invalid status");
  const bookings = readBookings();
  const booking = bookings.find((item) => item.id === req.params.id);
  if (!booking) return res.status(404).send("Booking not found");
  booking.status = status;
  booking.updatedAt = new Date().toISOString();
  saveBookings(bookings);
  res.redirect("/employee");
});
app.post("/employee/bookings/:id/delete", requireEmployee, verifyCsrf, (req, res) => {
  saveBookings(readBookings().filter((item) => item.id !== req.params.id));
  res.redirect("/employee");
});

app.use((req, res) => {
  res.status(404).send(pageShell({ req, title: `${SERVICE_NAME} — Not Found`, body: `${header(req)}<main class="container section"><div class="glass" style="padding:42px;border-radius:38px"><span class="chip">404</span><h1 class="adminTitle" style="margin-top:18px">Page not found.</h1><p class="sectionSub" style="margin-left:0;text-align:left">That route does not exist.</p><a class="btn primary" style="margin-top:24px" href="/">Back home</a></div></main>${footer(req)}` }));
});

ensureFiles();
app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} running at http://localhost:${PORT}`);
  console.log(`Customer login: http://localhost:${PORT}/login`);
  console.log(`Customer signup: http://localhost:${PORT}/signup`);
  console.log(`Employee login: http://localhost:${PORT}/employee/login`);
});
