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


function isMobileUserAgent(userAgent = "") {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk|Kindle/i.test(String(userAgent));
}

function getRequestedView(req) {
  const forced = String(req.query.view || "").toLowerCase();
  if (forced === "mobile" || forced === "app") return "mobile";
  if (forced === "desktop" || forced === "full") return "desktop";
  return isMobileUserAgent(req.headers["user-agent"]) ? "mobile" : "desktop";
}

function isMobileRequest(req) {
  return getRequestedView(req) === "mobile";
}

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
  const deviceMode = req ? getRequestedView(req) : "desktop";
  const mobileClass = deviceMode === "mobile" ? "is-mobile-device" : "is-desktop-device";
  return `<!doctype html>
<html lang="en" class="${mobileClass}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="theme-color" content="#070a12" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Dropcart" />
  <meta name="mobile-web-app-capable" content="yes" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root{--bg:#060912;--bg2:#0b1020;--text:#f8fafc;--muted:rgba(248,250,252,.66);--muted2:rgba(248,250,252,.45);--panel:rgba(255,255,255,.078);--panel2:rgba(255,255,255,.118);--border:rgba(255,255,255,.13);--border2:rgba(255,255,255,.22);--purple:#7c5cff;--pink:#ff4fd8;--cyan:#35d7ff;--green:#49e6a5;--amber:#ffd166;--red:#ff6b6b;--blue:#5aa7ff;--shadow:0 28px 90px rgba(0,0,0,.42);--glow:0 22px 75px rgba(124,92,255,.34);--safe-bottom:env(safe-area-inset-bottom,0px)}
    *{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}body{min-height:100vh;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:radial-gradient(950px circle at 10% -10%,rgba(124,92,255,.38),transparent 45%),radial-gradient(850px circle at 96% 8%,rgba(255,79,216,.24),transparent 42%),radial-gradient(700px circle at 50% 106%,rgba(53,215,255,.17),transparent 50%),linear-gradient(180deg,var(--bg) 0%,var(--bg2) 45%,var(--bg) 100%);overflow-x:hidden}body:before{content:"";position:fixed;inset:0;z-index:-4;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:70px 70px;mask-image:radial-gradient(circle at 50% 0%,black,transparent 72%)}body:after{content:"";position:fixed;inset:0;z-index:999;opacity:.075;pointer-events:none;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='.7'/%3E%3C/svg%3E")}a{color:inherit;text-decoration:none}button,input,textarea,select{font:inherit}button{cursor:pointer}.container{width:min(1240px,calc(100% - 32px));margin-inline:auto}.display{font-family:"Space Grotesk",Inter,sans-serif}.orb{position:fixed;z-index:-3;pointer-events:none;border-radius:999px;filter:blur(54px);opacity:.28;animation:orbFloat 18s ease-in-out infinite}.orb.one{top:-120px;left:-140px;width:430px;height:430px;background:var(--purple)}.orb.two{top:22%;right:-160px;width:450px;height:450px;background:var(--pink);animation-delay:-7s}.orb.three{bottom:-170px;left:32%;width:380px;height:380px;background:var(--cyan);animation-delay:-11s}@keyframes orbFloat{0%,100%{transform:translate3d(0,0,0) scale(1)}33%{transform:translate3d(38px,-24px,0) scale(1.07)}66%{transform:translate3d(-28px,30px,0) scale(.96)}}.progress{position:fixed;top:0;left:0;z-index:1500;height:4px;width:100%;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,var(--purple),var(--pink),var(--cyan));box-shadow:0 0 24px rgba(255,79,216,.62)}
    .glass{background:linear-gradient(180deg,rgba(255,255,255,.095),rgba(255,255,255,.04));border:1px solid var(--border);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),var(--shadow);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}.soft{background:rgba(255,255,255,.058);border:1px solid rgba(255,255,255,.105);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.chip{display:inline-flex;align-items:center;gap:9px;min-height:32px;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.76);font-size:12px;font-weight:850;letter-spacing:-.01em;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 16px 45px rgba(0,0,0,.22)}.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 22px rgba(73,230,165,.82)}.btn{position:relative;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:13px 20px;border:0;border-radius:18px;font-weight:900;font-size:14px;letter-spacing:-.02em;transition:transform .18s ease,filter .18s ease,background .18s ease,border-color .18s ease;overflow:hidden;user-select:none;white-space:nowrap}.btn:active{transform:scale(.965)}.primary{color:white;background:linear-gradient(135deg,var(--purple) 0%,var(--pink) 55%,var(--cyan) 130%);box-shadow:0 22px 70px rgba(124,92,255,.34),inset 0 1px 0 rgba(255,255,255,.22)}.primary:hover{transform:translateY(-1px);filter:saturate(1.15) brightness(1.08)}.ghost{color:white;background:rgba(255,255,255,.068);border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 16px 48px rgba(0,0,0,.22)}.ghost:hover{background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.2)}
    .authPill{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:13px 20px;border-radius:18px;font-size:14px;font-weight:900;letter-spacing:-.02em;background:rgba(255,255,255,.068);border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 16px 48px rgba(0,0,0,.22)}
    .authPill:hover{background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.2)}.danger{color:white;background:rgba(255,107,107,.14);border:1px solid rgba(255,107,107,.22)}.shine{background:linear-gradient(90deg,#fff 0%,#c9c0ff 22%,#ff7be8 50%,#68e4ff 78%,#fff 100%);background-size:240% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:textShine 8s ease-in-out infinite;text-shadow:0 0 38px rgba(124,92,255,.16)}@keyframes textShine{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
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

    .bookingStudio{background:radial-gradient(700px circle at 20% 0%,rgba(124,92,255,.18),transparent 45%),linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.04))}
    .bookingStudioTop{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
    .bookingPulse{display:grid;place-items:center;text-align:center;min-width:92px;height:92px;border-radius:28px;background:linear-gradient(135deg,rgba(73,230,165,.16),rgba(53,215,255,.1));border:1px solid rgba(73,230,165,.22);box-shadow:0 18px 45px rgba(73,230,165,.08)}
    .bookingPulse b{display:block;font-family:"Space Grotesk";font-size:28px;line-height:1;letter-spacing:-.07em;color:white}.bookingPulse span{display:block;margin-top:5px;color:rgba(255,255,255,.52);font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
    .bookingForm{margin-top:20px}
    .saveDefaultBox{display:flex;align-items:flex-start;gap:10px;padding:14px;border-radius:20px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.68);font-size:13px;font-weight:800;line-height:1.45}
    .saveDefaultBox input{width:18px;height:18px;accent-color:var(--green);margin-top:1px;flex:0 0 auto}
    .portalTinyGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px}.tinyPerk{padding:14px;border-radius:20px;text-align:center;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08)}.tinyPerk b{display:block;font-size:22px}.tinyPerk span{display:block;margin-top:7px;color:rgba(255,255,255,.55);font-size:12px;font-weight:850}
    .portalFeatureGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:18px}.portalFeature{padding:16px;border-radius:22px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08)}.portalFeature b{display:block;font-size:25px}.portalFeature strong{display:block;margin-top:10px;font-family:"Space Grotesk";font-size:20px;letter-spacing:-.045em}.portalFeature span{display:block;margin-top:7px;color:rgba(255,255,255,.56);font-size:13px;line-height:1.55}

    .personalForm{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:18px}.personalForm .full{grid-column:1/-1}.comfortStrip{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px}.comfort{padding:14px;border-radius:20px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08)}.comfort span{display:block;color:rgba(255,255,255,.42);font-size:10px;font-weight:950;letter-spacing:.14em;text-transform:uppercase}.comfort strong{display:block;margin-top:6px;color:rgba(255,255,255,.82);font-size:14px}.nextUnloadFocus{display:grid;grid-template-columns:.95fr 1.05fr;gap:14px;align-items:stretch}.focusPanel{padding:20px;border-radius:28px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08)}.focusPanel h3{font-family:"Space Grotesk";font-size:28px;letter-spacing:-.055em;line-height:.98}.focusPanel p{margin-top:10px;color:rgba(255,255,255,.58);line-height:1.65;font-size:14px}
    .bookingMemories{display:grid;gap:12px;margin-top:14px}.memoryCard{padding:18px;border-radius:28px;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.1)}.memoryTop{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.memoryTitle{font-family:"Space Grotesk";font-size:25px;line-height:1;letter-spacing:-.055em;margin-top:9px}.memoryText{margin-top:7px;color:rgba(255,255,255,.58);line-height:1.62;font-size:14px}.memoryTimeline{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:15px}.memoryStep{padding:10px 8px;border-radius:15px;text-align:center;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);color:rgba(255,255,255,.36);font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.06em}.memoryStep.done{color:var(--green);background:rgba(73,230,165,.09);border-color:rgba(73,230,165,.18)}.memoryStep.active{color:white;background:rgba(124,92,255,.16);border-color:rgba(124,92,255,.28)}.emptyHome{padding:26px;border-radius:28px;text-align:left;background:rgba(255,255,255,.052);border:1px dashed rgba(255,255,255,.17);color:rgba(255,255,255,.66);line-height:1.7}.tinyActions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}.tinyActions .btn{min-height:42px;padding:10px 14px;font-size:12px;border-radius:15px}
    @media(max-width:1050px){.personalHeroGrid,.hubLayout,.nextUnloadFocus{grid-template-columns:1fr}.hubSidebar{position:relative;top:auto}.hubStats{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:720px){.hubTopbar,.memoryTop{flex-direction:column;align-items:flex-start}.hubMiniNav{width:100%}.hubMiniNav a,.hubMiniNav button{flex:1;justify-content:center}.personalHero{padding:22px;border-radius:32px}.hubStats,.personalForm,.comfortStrip,.memoryTimeline{grid-template-columns:1fr}.rewardRing{grid-template-columns:1fr}.homeMood{grid-template-columns:repeat(3,1fr)}.todayMain{font-size:27px}.hubCard{border-radius:26px;padding:18px}}
    .authWrap{display:grid;grid-template-columns:.9fr 1.1fr;gap:24px;align-items:stretch;min-height:calc(100svh - 72px);padding:64px 0}.authTitle{font-family:"Space Grotesk";font-size:clamp(46px,7vw,84px);line-height:.88;letter-spacing:-.075em}.authCard{padding:28px;border-radius:38px}.accountHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.bookingGrid{display:grid;gap:14px;margin-top:28px}.bookingCard{padding:20px;border-radius:28px}.bookingTop{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.bookingMeta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}.metaBox{padding:12px;border-radius:18px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08)}.metaBox span{display:block;color:rgba(255,255,255,.4);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.14em}.metaBox strong{display:block;margin-top:5px;color:rgba(255,255,255,.78);font-size:14px}.badge{display:inline-flex;align-items:center;padding:7px 10px;border-radius:999px;font-size:12px;font-weight:900;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07)}.badge.green{color:var(--green);background:rgba(73,230,165,.12);border-color:rgba(73,230,165,.2)}.badge.red{color:var(--red);background:rgba(255,107,107,.12);border-color:rgba(255,107,107,.2)}.badge.amber{color:var(--amber);background:rgba(255,209,102,.12);border-color:rgba(255,209,102,.2)}.badge.blue{color:var(--blue);background:rgba(90,167,255,.12);border-color:rgba(90,167,255,.2)}.badge.purple{color:#c9c0ff;background:rgba(124,92,255,.12);border-color:rgba(124,92,255,.2)}.adminActions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.adminActions form{display:flex;gap:8px;align-items:center}.adminActions select{min-height:42px;padding:10px;border-radius:14px;color:white;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12)}.adminTitle{font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(42px,6vw,82px);line-height:.9;font-weight:800;letter-spacing:-.07em}.empty{padding:48px;text-align:center;color:rgba(255,255,255,.56)}.slots{display:grid;grid-template-columns:repeat(7,1fr);gap:10px}.slotDay{padding:14px;border-radius:22px}.slotDay h4{font-family:"Space Grotesk";font-size:18px;letter-spacing:-.04em}.slotList{display:grid;gap:7px;margin-top:12px}.slot{padding:8px 9px;border-radius:12px;font-size:11px;font-weight:850;color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.05)}.slot.open{color:var(--green);border-color:rgba(73,230,165,.18);background:rgba(73,230,165,.09)}.slot.limited{color:var(--amber);border-color:rgba(255,209,102,.18);background:rgba(255,209,102,.08)}.slot.busy{color:rgba(255,255,255,.38)}.faq{display:grid;gap:12px;max-width:860px;margin:0 auto}details.card{padding:0}summary{display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:76px;padding:22px 24px;cursor:pointer;list-style:none;font-weight:900;letter-spacing:-.02em}summary::-webkit-details-marker{display:none}.plus{display:grid;place-items:center;width:31px;height:31px;flex-shrink:0;border-radius:12px;color:white;background:rgba(255,255,255,.08);transition:transform .18s ease}details[open] .plus{transform:rotate(45deg)}details.card p{padding:0 24px 24px;margin:0;color:rgba(255,255,255,.58);line-height:1.65}.final{padding:42px;border-radius:44px;overflow:hidden;background:radial-gradient(800px circle at 12% 0%,rgba(124,92,255,.22),transparent 42%),radial-gradient(800px circle at 90% 20%,rgba(255,79,216,.16),transparent 44%),linear-gradient(180deg,rgba(255,255,255,.11),rgba(255,255,255,.045))}.finalGrid{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:center}.finalTitle{max-width:820px;margin-top:14px;font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(42px,5vw,78px);line-height:.88;font-weight:800;letter-spacing:-.075em}.finalText{max-width:650px;margin-top:18px;color:rgba(255,255,255,.62);font-size:18px;line-height:1.65}.finalActions{display:grid;gap:12px;min-width:220px}.footer{padding:28px 0 calc(28px + var(--safe-bottom));border-top:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.22)}.foot{display:flex;align-items:center;justify-content:space-between;gap:22px}.footTitle{font-family:"Space Grotesk",Inter,sans-serif;font-size:20px;font-weight:800;letter-spacing:-.045em}.footCopy{margin-top:4px;color:rgba(255,255,255,.42);font-size:12px;font-weight:700}.footLinks{display:flex;align-items:center;gap:18px;color:rgba(255,255,255,.48);font-size:13px;font-weight:800}.footLinks a:hover{color:white}.mobileSticky{display:none}.toast{position:fixed;right:18px;bottom:18px;z-index:1600;display:none;max-width:360px;padding:16px 18px;border-radius:22px;background:rgba(7,10,18,.86);border:1px solid rgba(255,255,255,.14);box-shadow:var(--shadow);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);color:rgba(255,255,255,.78);font-size:14px;line-height:1.5;font-weight:750}.toast.show{display:block;animation:toastIn .26s ease both}@keyframes toastIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}.reveal{opacity:0;transform:translateY(20px);transition:opacity .72s cubic-bezier(.22,1,.36,1),transform .72s cubic-bezier(.22,1,.36,1)}.reveal.show{opacity:1;transform:translateY(0)}.d1{transition-delay:.08s}.d2{transition-delay:.16s}.d3{transition-delay:.24s}
    @media(max-width:1050px){.desktopNav{display:none}.menuBtn{display:inline-flex}.hero,.twoCol,.grid2,.authWrap{grid-template-columns:1fr}.hero{min-height:auto;padding-top:48px}.deviceShell{margin-inline:auto}.stats{grid-template-columns:repeat(2,1fr)}.slots{grid-template-columns:repeat(2,1fr)}}@media(max-width:820px){.grid4,.grid3,.priceCards,.bookingMeta{grid-template-columns:repeat(2,1fr)}.finalGrid{grid-template-columns:1fr}.finalActions{grid-template-columns:repeat(2,1fr)}}@media(max-width:620px){.container{width:min(100% - 26px,1240px)}.nav{min-height:66px}.logoIcon{width:40px;height:40px;border-radius:16px}.logoTitle{font-size:20px}.logoSub{display:none}.hero{padding:34px 0;gap:34px}.heroTitle{font-size:clamp(51px,16vw,74px);letter-spacing:-.069em}.heroDesc{font-size:16px;line-height:1.7}.heroActions,.stats,.miniGrid,.taskGrid,.formGrid,.formActions,.mobileActions,.grid4,.grid3,.priceCards,.slots,.bookingMeta,.finalActions{grid-template-columns:1fr}.available{display:none}.section{padding:64px 0}.sectionHeader{margin-bottom:28px}.card,.formBox,.final,.authCard{border-radius:26px;padding:20px}.estimateRow{align-items:flex-start;flex-direction:column}.estimateSide{text-align:left}.estimatePrice,.priceAmount{font-size:58px}.foot{flex-direction:column;text-align:center}.footLinks{justify-content:center;flex-wrap:wrap}.mobileSticky{position:fixed;left:12px;right:12px;bottom:calc(12px + var(--safe-bottom));z-index:1200;display:grid;grid-template-columns:1fr 1fr;gap:10px}.mobileSticky .btn{min-height:50px}.toast{left:12px;right:12px;bottom:calc(82px + var(--safe-bottom));max-width:none}.bookingTop,.accountHeader{flex-direction:column}.adminActions form{width:100%;flex-direction:column;align-items:stretch}.adminActions .btn{width:100%}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.reveal{opacity:1;transform:none}}


    /* ===== Server-detected Mobile Mode ===== */
    .is-mobile-device .header{display:none}
    .is-mobile-device .mobileAppTop{position:sticky;top:0;z-index:1200;display:block;padding:calc(10px + env(safe-area-inset-top,0px)) 13px 10px;background:linear-gradient(180deg,rgba(7,10,18,.96),rgba(7,10,18,.72));backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-bottom:1px solid rgba(255,255,255,.09)}
    .is-mobile-device .appBottomNav{position:fixed;left:10px;right:10px;bottom:calc(10px + var(--safe-bottom));z-index:1400;display:grid;grid-template-columns:repeat(4,1fr);gap:7px;padding:8px;border-radius:26px;background:rgba(8,11,20,.86);border:1px solid rgba(255,255,255,.12);box-shadow:0 22px 70px rgba(0,0,0,.52);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
    .is-mobile-device{padding-bottom:calc(92px + var(--safe-bottom))}
    .is-mobile-device .container{width:min(100% - 22px,1240px)}
    .is-mobile-device .hero{grid-template-columns:1fr;min-height:auto;padding:34px 0;gap:34px}
    .is-mobile-device .heroTitle{font-size:clamp(48px,15vw,72px);letter-spacing:-.069em}
    .is-mobile-device .heroDesc,.is-mobile-device .sectionSub{font-size:15.5px}
    .is-mobile-device .heroActions,.is-mobile-device .stats,.is-mobile-device .miniGrid,.is-mobile-device .taskGrid,.is-mobile-device .formGrid,.is-mobile-device .formActions,.is-mobile-device .mobileActions,.is-mobile-device .grid4,.is-mobile-device .grid3,.is-mobile-device .priceCards,.is-mobile-device .slots,.is-mobile-device .adminStats,.is-mobile-device .bookingMeta,.is-mobile-device .finalActions{grid-template-columns:1fr}
    .is-mobile-device .twoCol,.is-mobile-device .grid2{grid-template-columns:1fr}
    .is-mobile-device .section{padding:42px 0}
    .is-mobile-device .mobileSticky{display:none!important}
    .is-mobile-device .available{display:none}
    .is-mobile-device .btn{width:100%}
    .is-desktop-device .mobileAppTop,.is-desktop-device .appBottomNav,.is-desktop-device .installBanner,.is-desktop-device .mobileQuickSheet{display:none!important}

    /* ===== Mobile App Mode Upgrade ===== */
    .mobileAppTop,.appBottomNav,.installBanner,.mobileQuickSheet{display:none}
    .appOnly{display:none}
    .tapCard{transition:transform .16s ease,background .16s ease,border-color .16s ease}
    .tapCard:active{transform:scale(.985)}
    @media(max-width:720px){
      body{
        background:
          radial-gradient(520px circle at 50% -8%,rgba(124,92,255,.42),transparent 58%),
          linear-gradient(180deg,#070a12 0%,#0b1020 42%,#050711 100%);
        padding-bottom:calc(92px + var(--safe-bottom));
      }
      body:after{opacity:.045}
      .header{display:none}
      .desktopOnly{display:none!important}
      .appOnly{display:initial}
      .mobileAppTop{
        position:sticky;top:0;z-index:1200;display:block;padding:calc(10px + env(safe-area-inset-top,0px)) 13px 10px;
        background:linear-gradient(180deg,rgba(7,10,18,.96),rgba(7,10,18,.72));backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
        border-bottom:1px solid rgba(255,255,255,.09);
      }
      .mobileAppTopInner{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .appBrand{display:flex;align-items:center;gap:10px;min-width:0}
      .appIcon{display:grid;place-items:center;width:42px;height:42px;border-radius:16px;color:#070a12;background:white;box-shadow:0 15px 40px rgba(124,92,255,.38)}
      .appBrandText{min-width:0}.appBrandText strong{display:block;font-family:"Space Grotesk";font-size:18px;line-height:1;letter-spacing:-.045em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.appBrandText span{display:block;margin-top:3px;font-size:11px;font-weight:850;color:rgba(255,255,255,.42)}
      .appTopActions{display:flex;align-items:center;gap:8px}.appCircleBtn{display:grid;place-items:center;width:42px;height:42px;border-radius:16px;border:1px solid rgba(255,255,255,.11);background:rgba(255,255,255,.07);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
      .container{width:min(100% - 22px,1240px)}
      .hero{padding-top:22px}
      .section{padding:42px 0}
      .sectionTitle{font-size:clamp(34px,11vw,54px)}
      .heroTitle{font-size:clamp(48px,15vw,72px)}
      .heroDesc,.sectionSub{font-size:15.5px}
      .card,.formBox,.final,.glass{box-shadow:inset 0 1px 0 rgba(255,255,255,.075),0 18px 55px rgba(0,0,0,.32)}
      .card{border-radius:24px}
      .appBottomNav{
        position:fixed;left:10px;right:10px;bottom:calc(10px + var(--safe-bottom));z-index:1400;display:grid;grid-template-columns:repeat(4,1fr);gap:7px;
        padding:8px;border-radius:26px;background:rgba(8,11,20,.86);border:1px solid rgba(255,255,255,.12);box-shadow:0 22px 70px rgba(0,0,0,.52);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
      }
      .appBottomNav a,.appBottomNav button{
        appearance:none;border:0;color:rgba(255,255,255,.58);background:transparent;display:grid;place-items:center;gap:4px;min-height:54px;border-radius:19px;font-size:10px;font-weight:900;letter-spacing:-.01em;
      }
      .appBottomNav a span,.appBottomNav button span{font-size:20px;line-height:1}
      .appBottomNav a.active,.appBottomNav a:active,.appBottomNav button:active{color:white;background:linear-gradient(135deg,rgba(124,92,255,.35),rgba(255,79,216,.16));box-shadow:inset 0 1px 0 rgba(255,255,255,.09)}
      .mobileSticky{display:none!important}
      .installBanner{
        position:fixed;left:12px;right:12px;bottom:calc(86px + var(--safe-bottom));z-index:1350;padding:14px;border-radius:24px;
        background:rgba(7,10,18,.9);border:1px solid rgba(255,255,255,.13);box-shadow:0 20px 65px rgba(0,0,0,.48);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
      }
      .installBanner.show{display:block;animation:toastIn .24s ease both}
      .installBannerRow{display:flex;align-items:center;gap:12px}.installBannerIcon{display:grid;place-items:center;width:42px;height:42px;border-radius:16px;background:white;color:#070a12;flex:0 0 auto}.installBannerText{min-width:0;flex:1}.installBannerText strong{display:block;font-size:14px}.installBannerText span{display:block;margin-top:2px;color:rgba(255,255,255,.5);font-size:12px;line-height:1.35}.installBannerBtns{display:flex;gap:7px;margin-top:12px}.installBannerBtns .btn{min-height:40px;padding:10px 12px;border-radius:15px;font-size:12px}
      .mobileQuickSheet{position:fixed;inset:0;z-index:1500;background:rgba(0,0,0,.58);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);align-items:flex-end}
      .mobileQuickSheet.show{display:flex}
      .quickSheetPanel{width:100%;padding:16px 14px calc(18px + var(--safe-bottom));border-radius:30px 30px 0 0;background:#080b14;border:1px solid rgba(255,255,255,.12);box-shadow:0 -25px 80px rgba(0,0,0,.55)}
      .quickHandle{width:54px;height:5px;border-radius:999px;background:rgba(255,255,255,.18);margin:0 auto 14px}
      .quickGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.quickGrid .btn{min-height:58px;border-radius:20px}
      .toast{bottom:calc(86px + var(--safe-bottom))}
      input,select,textarea{font-size:16px!important}
    }


    /* ===== v10 Mobile Dimension Fixes ===== */
    .is-mobile-device, .is-mobile-device *{max-width:100%}
    .is-mobile-device{overflow-x:hidden;min-width:0}
    .is-mobile-device body{overflow-x:hidden}
    .is-mobile-device main{overflow:hidden}
    .is-mobile-device .container{width:100%;max-width:100%;padding-left:13px;padding-right:13px;margin-left:auto;margin-right:auto}
    .is-mobile-device .mobileAppTop{left:0;right:0;width:100%;max-width:100vw}
    .is-mobile-device .mobileAppTopInner{min-width:0}
    .is-mobile-device .appBrand{min-width:0;flex:1}
    .is-mobile-device .appBrandText{min-width:0;overflow:hidden}
    .is-mobile-device .appTopActions{flex:0 0 auto}
    .is-mobile-device .appCircleBtn{width:40px;height:40px;border-radius:15px;flex:0 0 40px}
    .is-mobile-device .appIcon{width:40px;height:40px;border-radius:15px;flex:0 0 40px}
    .is-mobile-device .hero{width:100%;padding:24px 0 34px;gap:22px}
    .is-mobile-device .hero:before{width:110vw;height:110vw;min-width:0;min-height:0;max-width:none;max-height:none;top:0}
    .is-mobile-device .heroTitle{font-size:clamp(42px,13.5vw,64px);line-height:.9;letter-spacing:-.06em;overflow-wrap:break-word}
    .is-mobile-device .heroDesc{font-size:15px;line-height:1.62}
    .is-mobile-device .deviceShell{width:100%;max-width:390px;margin:0 auto;border-radius:30px}
    .is-mobile-device .deviceShell:before{inset:-2px;filter:blur(12px)}
    .is-mobile-device .device{padding:11px;border-radius:30px}
    .is-mobile-device .screen{padding:13px;border-radius:23px}
    .is-mobile-device .phoneBar{width:62px;height:5px;margin-bottom:14px}
    .is-mobile-device .requestTitle{font-size:23px}
    .is-mobile-device .requestCard{padding:13px;border-radius:20px;margin-top:14px}
    .is-mobile-device .requestIcon{width:42px;height:42px;border-radius:16px}
    .is-mobile-device .miniValue{font-size:24px}
    .is-mobile-device .task{padding:11px 8px;border-radius:16px}
    .is-mobile-device .ready{align-items:stretch;flex-direction:column;border-radius:18px}
    .is-mobile-device .stats{gap:10px}
    .is-mobile-device .stat{padding:14px;border-radius:20px}
    .is-mobile-device .statNum{font-size:24px}
    .is-mobile-device .section{padding:40px 0}
    .is-mobile-device .sectionHeader{text-align:left;margin-bottom:20px}
    .is-mobile-device .sectionTitle{font-size:clamp(32px,10vw,46px);line-height:.98;letter-spacing:-.055em}
    .is-mobile-device .sectionSub{font-size:15px;line-height:1.62}
    .is-mobile-device .grid4,.is-mobile-device .grid3,.is-mobile-device .grid2,.is-mobile-device .twoCol,.is-mobile-device .priceCards,.is-mobile-device .formGrid,.is-mobile-device .formActions,.is-mobile-device .slots,.is-mobile-device .adminStats,.is-mobile-device .bookingMeta,.is-mobile-device .finalGrid,.is-mobile-device .finalActions{display:grid;grid-template-columns:minmax(0,1fr)!important}
    .is-mobile-device .card,.is-mobile-device .formBox,.is-mobile-device .final,.is-mobile-device .hubCard,.is-mobile-device .memoryCard,.is-mobile-device .bookingCard{padding:17px;border-radius:22px}
    .is-mobile-device .btn{min-height:48px;border-radius:16px;padding:12px 14px;white-space:normal;text-align:center}
    .is-mobile-device input,.is-mobile-device select,.is-mobile-device textarea{width:100%;min-width:0;font-size:16px!important;border-radius:16px}
    .is-mobile-device .estimateResult{padding:17px;border-radius:22px}
    .is-mobile-device .estimatePrice,.is-mobile-device .priceAmount{font-size:52px}
    .is-mobile-device .estimateRow{display:flex;align-items:flex-start;flex-direction:column;gap:10px}
    .is-mobile-device .estimateSide{text-align:left}
    .is-mobile-device .slots{gap:10px}
    .is-mobile-device .slotDay{padding:13px;border-radius:20px}
    .is-mobile-device .map{min-height:320px;padding:17px;border-radius:22px}
    .is-mobile-device .rings{width:170px;height:170px}
    .is-mobile-device .rings:before{width:122px;height:122px}
    .is-mobile-device .rings:after{width:76px;height:76px}
    .is-mobile-device .pin{width:50px;height:50px}
    .is-mobile-device .final{margin-bottom:8px}
    .is-mobile-device .footer{padding-bottom:calc(104px + var(--safe-bottom))}
    .is-mobile-device .appBottomNav{left:8px;right:8px;bottom:calc(8px + var(--safe-bottom));width:auto;max-width:calc(100vw - 16px);grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;padding:7px;border-radius:22px}
    .is-mobile-device .appBottomNav a,.is-mobile-device .appBottomNav button{min-width:0;width:100%;min-height:50px;border-radius:16px;font-size:9.5px;padding:0}
    .is-mobile-device .appBottomNav a span,.is-mobile-device .appBottomNav button span{font-size:18px}
    .is-mobile-device .installBanner{left:10px;right:10px;bottom:calc(76px + var(--safe-bottom));border-radius:22px}
    .is-mobile-device .mobileQuickSheet{width:100vw;max-width:100vw}
    .is-mobile-device .quickSheetPanel{max-height:82dvh;overflow:auto;border-radius:26px 26px 0 0}
    .is-mobile-device .quickGrid{grid-template-columns:1fr 1fr!important}
    .is-mobile-device .toast{left:10px;right:10px;bottom:calc(76px + var(--safe-bottom))}
    .is-mobile-device .hubTopbar{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:12px}
    .is-mobile-device .hubMiniNav{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .is-mobile-device .hubMiniNav a,.is-mobile-device .hubMiniNav button{width:100%;min-height:38px;text-align:center;justify-content:center}
    .is-mobile-device .customerShell{padding-top:16px}
    .is-mobile-device .personalHero{border-radius:26px;padding:18px;margin-top:2px}
    .is-mobile-device .personalHero:before{display:none}
    .is-mobile-device .personalHeroGrid{display:grid;grid-template-columns:minmax(0,1fr)!important;gap:14px}
    .is-mobile-device .personalGreeting{font-size:clamp(34px,10.5vw,48px);line-height:.95;letter-spacing:-.055em}
    .is-mobile-device .personalSub{font-size:14.5px;line-height:1.62}
    .is-mobile-device .hubStats{display:grid;grid-template-columns:1fr 1fr;gap:9px}
    .is-mobile-device .hubStat{padding:13px;border-radius:18px}
    .is-mobile-device .hubStat strong{font-size:23px}
    .is-mobile-device .portalActions{display:grid;grid-template-columns:1fr;gap:9px}
    .is-mobile-device .todayCard{padding:17px;border-radius:23px}
    .is-mobile-device .todayMain{font-size:26px;line-height:1}
    .is-mobile-device .rewardRing{grid-template-columns:1fr;justify-items:start;gap:10px}
    .is-mobile-device .ring{width:82px;height:82px}
    .is-mobile-device .ringInner{width:64px;height:64px;font-size:18px}
    .is-mobile-device .hubLayout{display:grid;grid-template-columns:minmax(0,1fr)!important;gap:12px;margin-top:12px}
    .is-mobile-device .hubSidebar{position:static;display:grid;gap:12px}
    .is-mobile-device .hubMain{display:grid;gap:12px}
    .is-mobile-device .hubCardTitle{font-size:24px;line-height:1}
    .is-mobile-device .profileStack{gap:8px}
    .is-mobile-device .profileLine{grid-template-columns:1fr;gap:4px}
    .is-mobile-device .homeMood{grid-template-columns:1fr!important}
    .is-mobile-device .nextUnloadFocus{display:grid;grid-template-columns:minmax(0,1fr)!important;gap:10px}
    .is-mobile-device .focusPanel{padding:15px;border-radius:20px}
    .is-mobile-device .comfortStrip{display:grid;grid-template-columns:minmax(0,1fr)!important;gap:8px}
    .is-mobile-device .personalForm{display:grid;grid-template-columns:minmax(0,1fr)!important;gap:12px}
    .is-mobile-device .personalForm .full{grid-column:auto}
    .is-mobile-device .memoryTop{display:grid;grid-template-columns:1fr;gap:8px}
    .is-mobile-device .memoryTitle{font-size:22px;line-height:1.05}
    .is-mobile-device .memoryTimeline{display:grid;grid-template-columns:minmax(0,1fr)!important;gap:7px}
    .is-mobile-device .memoryStep{min-height:36px}
    .is-mobile-device .tinyActions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .is-mobile-device .bookingTop{display:grid;grid-template-columns:1fr;gap:10px}
    .is-mobile-device .adminActions,.is-mobile-device .adminActions form{display:grid;grid-template-columns:1fr;gap:8px;width:100%}
    .is-mobile-device .adminActions select{width:100%}
    @media(max-width:380px){
      .is-mobile-device .container{padding-left:10px;padding-right:10px}
      .is-mobile-device .heroTitle{font-size:42px}
      .is-mobile-device .personalGreeting{font-size:34px}
      .is-mobile-device .hubStats{grid-template-columns:1fr}
      .is-mobile-device .quickGrid,.is-mobile-device .tinyActions{grid-template-columns:1fr!important}
      .is-mobile-device .appBottomNav a,.is-mobile-device .appBottomNav button{font-size:9px}
    }


    @media(max-width:720px){.bookingStudioTop{display:grid}.bookingPulse{width:100%;height:auto;min-height:78px;display:flex;justify-content:center;gap:10px}.portalTinyGrid,.portalFeatureGrid{grid-template-columns:1fr}.saveDefaultBox{font-size:12px}.personalForm.bookingForm{grid-template-columns:1fr!important}}


    /* ===== v13 Mobile App Polish ===== */
    .mobileGlowDock,.mobilePageHint{display:none}
    .is-mobile-device *{max-width:100%}
    .is-mobile-device body{overscroll-behavior-y:auto}
    .is-mobile-device .mobileAppTop{box-shadow:0 18px 60px rgba(0,0,0,.28)}
    .is-mobile-device .appIcon{background:linear-gradient(135deg,#fff,#dff7ff);box-shadow:0 16px 42px rgba(53,215,255,.18),0 12px 40px rgba(124,92,255,.28)}
    .is-mobile-device .appCircleBtn{transition:transform .14s ease,background .14s ease}
    .is-mobile-device .appCircleBtn:active{transform:scale(.94);background:rgba(255,255,255,.12)}
    .is-mobile-device .mobilePageHint{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px auto 0;padding:10px 12px;border-radius:18px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.09);color:rgba(255,255,255,.55);font-size:12px;font-weight:850}
    .is-mobile-device .hero{padding-top:18px}
    .is-mobile-device .hero:before{min-width:0;min-height:0;width:120vw;height:120vw;top:-8%;opacity:.72}
    .is-mobile-device .heroTitle{line-height:.88;text-wrap:balance}
    .is-mobile-device .heroDesc{margin-top:18px}
    .is-mobile-device .heroActions{gap:10px}
    .is-mobile-device .stats{gap:10px}
    .is-mobile-device .stat{padding:15px;border-radius:22px;background:rgba(255,255,255,.065)}
    .is-mobile-device .statNum{font-size:25px}
    .is-mobile-device .deviceShell{width:min(100%,360px);margin:0 auto;border-radius:32px}
    .is-mobile-device .deviceShell:before{filter:blur(12px);opacity:.58}
    .is-mobile-device .device{padding:10px;border-radius:32px}
    .is-mobile-device .screen{padding:14px;border-radius:24px}
    .is-mobile-device .requestTitle{font-size:24px}
    .is-mobile-device .requestCard{padding:14px;border-radius:22px}
    .is-mobile-device .requestIcon{width:44px;height:44px;border-radius:17px}
    .is-mobile-device .task{padding:12px 8px;border-radius:18px}
    .is-mobile-device .ready{align-items:stretch;flex-direction:column}
    .is-mobile-device .sectionHeader{text-align:left;margin-bottom:20px}
    .is-mobile-device .chip{max-width:100%;white-space:normal}
    .is-mobile-device .field input,.is-mobile-device .field select,.is-mobile-device .field textarea{min-height:54px;border-radius:19px}
    .is-mobile-device .formBox{padding:18px;border-radius:28px}
    .is-mobile-device .estimateResult{padding:18px;border-radius:24px}
    .is-mobile-device .estimatePrice{font-size:54px}
    .is-mobile-device .quickSheetPanel{max-height:82svh;overflow-y:auto}
    .is-mobile-device .quickGrid{gap:9px}
    .is-mobile-device .quickGrid .btn{min-height:58px}
    .is-mobile-device .appBottomNav{grid-template-columns:1fr 1fr 1.12fr 1fr;border-radius:28px;padding:8px}
    .is-mobile-device .appBottomNav a,.is-mobile-device .appBottomNav button{min-height:56px}
    .is-mobile-device .appBottomNav #quickOpen{color:white;background:linear-gradient(135deg,var(--purple),var(--pink));box-shadow:0 14px 40px rgba(124,92,255,.32),inset 0 1px 0 rgba(255,255,255,.16);transform:translateY(-8px);border-radius:22px}
    .is-mobile-device .appBottomNav #quickOpen span{font-size:24px}
    .is-mobile-device .appBottomNav #quickOpen:active{transform:translateY(-6px) scale(.97)}
    .is-mobile-device .installBanner{border-radius:26px}
    .is-mobile-device .installBannerBtns{grid-template-columns:1fr 1fr;display:grid}
    .is-mobile-device .customerShell{padding-top:12px}
    .is-mobile-device .portalMode{background:linear-gradient(180deg,#081019,#090d16 42%,#050711)}
    .is-mobile-device .hubTopbar{position:sticky;top:72px;z-index:900;display:grid;gap:10px;padding:10px 0;background:linear-gradient(180deg,rgba(7,10,18,.96),rgba(7,10,18,.72),transparent)}
    .is-mobile-device .hubMiniNav{display:flex;gap:8px;overflow-x:auto;padding-bottom:3px;scrollbar-width:none}
    .is-mobile-device .hubMiniNav::-webkit-scrollbar{display:none}
    .is-mobile-device .hubMiniNav a,.is-mobile-device .hubMiniNav button{white-space:nowrap;min-height:38px;padding:9px 12px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.68);font-size:12px;font-weight:900}
    .is-mobile-device .personalHero{padding:18px;border-radius:30px;background:radial-gradient(480px circle at 15% 0%,rgba(73,230,165,.16),transparent 44%),radial-gradient(520px circle at 100% 10%,rgba(124,92,255,.2),transparent 46%),linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.1);box-shadow:0 20px 70px rgba(0,0,0,.28)}
    .is-mobile-device .personalHeroGrid{grid-template-columns:1fr;gap:16px}
    .is-mobile-device .personalGreeting{font-size:clamp(38px,12vw,58px);line-height:.92}
    .is-mobile-device .personalSub{font-size:14px;line-height:1.62}
    .is-mobile-device .hubStats{grid-template-columns:repeat(2,1fr);gap:9px}
    .is-mobile-device .hubStat{border-radius:19px;padding:13px}
    .is-mobile-device .portalActions{display:grid;grid-template-columns:1fr;gap:9px}
    .is-mobile-device .todayCard{border-radius:26px;padding:18px}
    .is-mobile-device .rewardRing{grid-template-columns:1fr;text-align:center;justify-items:center}
    .is-mobile-device .hubLayout{grid-template-columns:1fr;gap:14px}
    .is-mobile-device .hubSidebar,.is-mobile-device .hubMain{display:grid;gap:14px}
    .is-mobile-device .hubCard{border-radius:26px;padding:18px}
    .is-mobile-device .hubCardTitle{font-size:31px;line-height:.96}
    .is-mobile-device .profileLine{align-items:flex-start;gap:8px;flex-direction:column}
    .is-mobile-device .profileLine strong{text-align:left}
    .is-mobile-device .homeMood,.is-mobile-device .portalTinyGrid,.is-mobile-device .portalFeatureGrid,.is-mobile-device .comfortStrip{grid-template-columns:1fr}
    .is-mobile-device .nextUnloadFocus{grid-template-columns:1fr}
    .is-mobile-device .focusPanel{border-radius:22px;padding:16px}
    .is-mobile-device .focusPanel h3{font-size:25px}
    .is-mobile-device .personalForm{grid-template-columns:1fr!important;gap:11px}
    .is-mobile-device .bookingStudioTop{display:grid}
    .is-mobile-device .bookingPulse{width:100%;height:auto;min-height:76px;display:flex;align-items:center;justify-content:center;gap:10px;border-radius:22px}
    .is-mobile-device .saveDefaultBox{font-size:12px;border-radius:18px}
    .is-mobile-device .memoryCard{border-radius:24px;padding:15px}
    .is-mobile-device .memoryTop{flex-direction:column}
    .is-mobile-device .memoryTitle{font-size:22px;line-height:1.05}
    .is-mobile-device .memoryTimeline{grid-template-columns:repeat(2,1fr)}
    .is-mobile-device .tinyActions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .is-mobile-device .tinyActions .btn{min-height:44px;padding:10px 12px}
    .is-mobile-device .bookingTop,.is-mobile-device .accountHeader{flex-direction:column}
    .is-mobile-device .adminActions form{width:100%;flex-direction:column;align-items:stretch}
    .is-mobile-device .adminActions .btn{width:100%}
    .is-mobile-device .footer{display:none}
    @media(max-width:380px){
      .is-mobile-device .container{width:min(100% - 18px,1240px)}
      .is-mobile-device .appBrandText strong{font-size:16px}
      .is-mobile-device .appCircleBtn{width:38px;height:38px;border-radius:14px}
      .is-mobile-device .heroTitle{font-size:44px}
      .is-mobile-device .personalGreeting{font-size:36px}
      .is-mobile-device .appBottomNav{left:6px;right:6px;gap:5px}
      .is-mobile-device .appBottomNav a,.is-mobile-device .appBottomNav button{font-size:9px}
    }


    /* ===== v14 Mobile Scroll + UI Fix ===== */
    html.is-mobile-device,
    body.is-mobile-device{
      height:auto!important;
      min-height:100%!important;
      overflow-x:hidden!important;
      overflow-y:auto!important;
      touch-action:pan-y pinch-zoom!important;
      -webkit-overflow-scrolling:touch!important;
      overscroll-behavior-y:auto!important;
    }
    body.is-mobile-device{
      position:relative!important;
      width:100%!important;
      max-width:100vw!important;
      padding-bottom:calc(96px + var(--safe-bottom))!important;
    }
    .is-mobile-device main,
    .is-mobile-device .customerShell,
    .is-mobile-device .section,
    .is-mobile-device .hero{
      overflow:visible!important;
      height:auto!important;
      min-height:auto!important;
    }
    .is-mobile-device .mobileQuickSheet:not(.show),
    .is-mobile-device .installBanner:not(.show){
      display:none!important;
      pointer-events:none!important;
    }
    .is-mobile-device .mobileQuickSheet.show{
      display:flex!important;
      pointer-events:auto!important;
      touch-action:auto!important;
    }
    .is-mobile-device .quickSheetPanel{
      max-height:78svh!important;
      overflow-y:auto!important;
      -webkit-overflow-scrolling:touch!important;
      touch-action:pan-y!important;
    }
    .is-mobile-device .appBottomNav{
      left:12px!important;
      right:12px!important;
      bottom:calc(12px + var(--safe-bottom))!important;
      max-width:480px!important;
      margin-inline:auto!important;
      transform:none!important;
    }
    .is-mobile-device .appBottomNav #quickOpen{
      transform:none!important;
      border-radius:20px!important;
    }
    .is-mobile-device .appBottomNav #quickOpen:active{
      transform:scale(.97)!important;
    }
    .is-mobile-device .appBottomNav a,
    .is-mobile-device .appBottomNav button{
      touch-action:manipulation!important;
    }
    .is-mobile-device .mobileAppTop{
      position:sticky!important;
      top:0!important;
    }
    .is-mobile-device .hubTopbar{
      position:relative!important;
      top:auto!important;
      background:transparent!important;
      padding-top:0!important;
    }
    .is-mobile-device .hubMiniNav{
      overflow-x:auto!important;
      overflow-y:hidden!important;
      -webkit-overflow-scrolling:touch!important;
      touch-action:pan-x!important;
      padding-bottom:8px!important;
    }
    .is-mobile-device .hubMiniNav a,
    .is-mobile-device .hubMiniNav button{
      flex:0 0 auto!important;
    }
    .is-mobile-device .mobilePageHint{
      display:none!important;
    }
    .is-mobile-device .personalHero{
      margin-top:8px!important;
    }
    .is-mobile-device .deviceShell{
      max-width:340px!important;
    }
    .is-mobile-device .card:hover{
      transform:none!important;
    }
    .is-mobile-device .footer{
      display:block!important;
      padding-bottom:calc(110px + var(--safe-bottom))!important;
    }
    @media(max-width:380px){
      .is-mobile-device .appBottomNav{
        left:8px!important;
        right:8px!important;
        gap:5px!important;
      }
      .is-mobile-device .appBottomNav a,
      .is-mobile-device .appBottomNav button{
        min-height:52px!important;
      }
    }


    /* ===== v15 4K / Ultra-Wide Visual Upgrade ===== */
    @media (min-width: 1440px){
      :root{--shadow:0 34px 110px rgba(0,0,0,.48);--glow:0 28px 95px rgba(124,92,255,.38);}
      .container{width:min(1380px,calc(100% - 72px));}
      .hero{gap:72px;padding:86px 0 76px;}
      .heroTitle{font-size:clamp(86px,7.2vw,142px);}
      .heroDesc{max-width:760px;font-size:22px;line-height:1.78;}
      .section{padding:108px 0;}
      .sectionTitle{font-size:clamp(58px,4.5vw,82px);}
      .sectionSub{font-size:20px;max-width:820px;}
      .card{padding:30px;border-radius:34px;}
      .formBox{padding:34px;border-radius:44px;}
      .grid4,.grid3,.grid2,.priceCards{gap:22px;}
      .deviceShell{width:min(100%,610px);}
      .device{padding:22px;border-radius:50px;}
      .screen{padding:26px;border-radius:40px;}
      .requestTitle{font-size:36px;}
      .requestCard{padding:24px;border-radius:32px;}
      .miniValue{font-size:34px;}
      .final{padding:58px;border-radius:54px;}
      .finalTitle{font-size:clamp(70px,4.8vw,104px);}
    }

    @media (min-width: 1800px){
      body{
        background:
          radial-gradient(1200px circle at 8% -12%,rgba(124,92,255,.42),transparent 45%),
          radial-gradient(1100px circle at 96% 8%,rgba(255,79,216,.28),transparent 42%),
          radial-gradient(900px circle at 50% 106%,rgba(53,215,255,.2),transparent 50%),
          linear-gradient(180deg,var(--bg) 0%,var(--bg2) 45%,var(--bg) 100%);
      }
      body:before{background-size:90px 90px;opacity:.9;}
      .container{width:min(1620px,calc(100% - 96px));}
      .nav{min-height:86px;}
      .logoIcon{width:52px;height:52px;border-radius:20px;}
      .logoTitle{font-size:28px;}
      .logoSub{font-size:13px;}
      .navLink{font-size:15px;padding:13px 16px;}
      .btn{min-height:54px;padding:15px 24px;border-radius:20px;font-size:15px;}
      .hero{min-height:calc(100svh - 86px);grid-template-columns:1fr .98fr;}
      .hero:before{width:62vw;height:62vw;max-width:1180px;max-height:1180px;filter:blur(28px);opacity:.92;}
      .heroTitle{font-size:clamp(112px,6.6vw,174px);letter-spacing:-.082em;}
      .heroDesc{font-size:24px;max-width:860px;}
      .heroActions{gap:16px;margin-top:34px;}
      .stats{gap:18px;margin-top:42px;}
      .stat{padding:24px;border-radius:30px;}
      .statNum{font-size:36px;}
      .statLab{font-size:13px;}
      .deviceShell{width:min(100%,720px);}
      .deviceShell:before{filter:blur(24px);opacity:.95;}
      .device{padding:28px;border-radius:58px;}
      .screen{padding:32px;border-radius:46px;}
      .phoneBar{width:104px;height:8px;margin-bottom:28px;}
      .requestIcon{width:64px;height:64px;border-radius:24px;}
      .requestInfo h3{font-size:22px;}
      .requestInfo p{font-size:16px;}
      .task{padding:18px 12px;border-radius:24px;}
      .taskEmoji{font-size:29px;}
      .taskText{font-size:13px;}
      .ready{padding:18px;border-radius:28px;}
      .section{padding:128px 0;}
      .sectionHeader{max-width:980px;margin-bottom:58px;}
      .sectionTitle{font-size:clamp(72px,4.2vw,104px);}
      .sectionSub{font-size:22px;}
      .card h3{font-size:29px;}
      .card p{font-size:16px;}
      .icon{width:60px;height:60px;border-radius:24px;font-size:29px;}
      .stepNum{width:56px;height:56px;border-radius:22px;font-size:25px;}
      .priceName{font-size:38px;}
      .priceAmount{font-size:92px;}
      .checks li{font-size:16px;}
      .field label{font-size:12px;}
      .field input,.field select,.field textarea{min-height:58px;border-radius:22px;font-size:16px;}
      .estimatePrice{font-size:96px;}
      .estimateSide{font-size:16px;}
      .footer{padding-top:38px;}
    }

    @media (min-width: 2200px){
      .container{width:min(1880px,calc(100% - 128px));}
      .hero{gap:110px;}
      .heroTitle{font-size:clamp(138px,6vw,210px);}
      .heroDesc{font-size:26px;max-width:940px;}
      .deviceShell{width:min(100%,820px);}
      .card{padding:38px;border-radius:40px;}
      .final{padding:72px;}
    }

    @media (min-width: 2600px){
      .container{width:min(2080px,calc(100% - 160px));}
      .heroTitle{font-size:220px;}
      .heroDesc{font-size:28px;}
      .sectionTitle{font-size:118px;}
      .deviceShell{width:min(100%,920px);}
    }

    @media (min-resolution: 2dppx){
      .glass,.soft,.card,.formBox,.final{border-color:rgba(255,255,255,.145);}
      .logoIcon,.requestIcon,.pin,.appIcon{box-shadow:0 20px 70px rgba(124,92,255,.34);}
    }


    /* ===== v16 High-DPI / 4K Phone Quality Upgrade ===== */
    @media (max-width: 720px) and (min-resolution: 2dppx){
      html{
        -webkit-font-smoothing:antialiased;
        -moz-osx-font-smoothing:grayscale;
        text-rendering:geometricPrecision;
      }
      body{
        background:
          radial-gradient(720px circle at 50% -12%,rgba(124,92,255,.36),transparent 58%),
          radial-gradient(580px circle at 100% 14%,rgba(255,79,216,.16),transparent 48%),
          radial-gradient(620px circle at 0% 92%,rgba(53,215,255,.12),transparent 50%),
          linear-gradient(180deg,#050812 0%,#090f1e 45%,#050711 100%)!important;
      }
      body:before{
        background-size:52px 52px!important;
        opacity:.55;
      }
      body:after{
        opacity:.045!important;
      }
      .glass,.soft,.card,.formBox,.final,.hubCard,.personalHero,.estimateResult,.mobileAppTop,.appBottomNav{
        border-color:rgba(255,255,255,.16)!important;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.105),
          0 18px 58px rgba(0,0,0,.34)!important;
      }
      .glass,.soft,.mobileAppTop,.appBottomNav{
        backdrop-filter:blur(26px) saturate(1.28)!important;
        -webkit-backdrop-filter:blur(26px) saturate(1.28)!important;
      }
      .heroTitle,.sectionTitle,.personalGreeting,.hubCardTitle,.finalTitle{
        text-shadow:0 0 1px rgba(255,255,255,.08),0 24px 70px rgba(124,92,255,.16);
      }
      .shine{
        background-size:180% auto!important;
        filter:saturate(1.08);
      }
      .chip{
        border-color:rgba(255,255,255,.16)!important;
        background:rgba(255,255,255,.082)!important;
      }
      .logoIcon,.appIcon,.requestIcon,.stepNum,.pin{
        box-shadow:
          0 18px 54px rgba(124,92,255,.25),
          inset 0 1px 0 rgba(255,255,255,.16)!important;
      }
      .hero{
        padding-top:20px!important;
      }
      .heroTitle{
        letter-spacing:-.073em!important;
      }
      .heroDesc{
        color:rgba(248,250,252,.72)!important;
      }
      .deviceShell{
        width:min(100%,365px)!important;
      }
      .deviceShell:before{
        filter:blur(14px)!important;
        opacity:.72!important;
      }
      .device{
        background:linear-gradient(180deg,rgba(255,255,255,.11),rgba(255,255,255,.045))!important;
      }
      .screen{
        background:
          radial-gradient(420px circle at var(--mx,50%) var(--my,20%),rgba(255,255,255,.15),transparent 48%),
          linear-gradient(180deg,rgba(255,255,255,.095),rgba(255,255,255,.04))!important;
      }
      .requestCard,.mini,.task,.ready,.metaBox,.portalFeature,.tinyPerk,.comfort,.profileLine{
        border-color:rgba(255,255,255,.13)!important;
        background:rgba(255,255,255,.062)!important;
      }
      .btn{
        box-shadow:
          0 18px 50px rgba(0,0,0,.26),
          inset 0 1px 0 rgba(255,255,255,.13)!important;
      }
      .primary{
        background:linear-gradient(135deg,#7c5cff 0%,#b554ff 42%,#168cff 100%)!important;
        box-shadow:
          0 20px 62px rgba(124,92,255,.34),
          0 10px 34px rgba(53,215,255,.13),
          inset 0 1px 0 rgba(255,255,255,.22)!important;
      }
      .field input,.field select,.field textarea{
        border-color:rgba(255,255,255,.155)!important;
        background:rgba(255,255,255,.075)!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.065);
      }
      .field input:focus,.field select:focus,.field textarea:focus{
        border-color:rgba(124,92,255,.55)!important;
        box-shadow:0 0 0 4px rgba(124,92,255,.2),0 0 42px rgba(53,215,255,.1)!important;
      }
      .appBottomNav{
        background:rgba(6,9,18,.88)!important;
      }
      .appBottomNav a,.appBottomNav button{
        text-shadow:0 1px 0 rgba(0,0,0,.18);
      }
      .quickSheetPanel{
        background:
          radial-gradient(480px circle at 50% -10%,rgba(124,92,255,.18),transparent 55%),
          #070a12!important;
        border-color:rgba(255,255,255,.16)!important;
      }
    }

    @media (max-width: 720px) and (min-resolution: 3dppx){
      body:before{
        background-size:44px 44px!important;
        opacity:.42;
      }
      .glass,.soft,.card,.formBox,.final,.hubCard,.personalHero,.estimateResult{
        border-width:.75px;
      }
      .heroTitle{
        font-size:clamp(50px,15.5vw,76px)!important;
      }
      .sectionTitle{
        font-size:clamp(36px,11.2vw,58px)!important;
      }
      .personalGreeting{
        font-size:clamp(39px,12.5vw,62px)!important;
      }
      .hubCardTitle{
        font-size:clamp(30px,9vw,42px)!important;
      }
      .deviceShell{
        width:min(100%,378px)!important;
      }
      .appIcon,.appCircleBtn{
        transform:translateZ(0);
      }
    }

    @media (max-width: 430px) and (min-resolution: 2dppx){
      .container{
        width:min(100% - 24px,1240px)!important;
      }
      .mobileAppTop{
        padding-left:12px!important;
        padding-right:12px!important;
      }
      .heroTitle{
        font-size:clamp(47px,15vw,68px)!important;
      }
      .heroDesc{
        font-size:16px!important;
      }
      .card,.hubCard,.formBox{
        border-radius:26px!important;
      }
      .appBottomNav{
        left:10px!important;
        right:10px!important;
        border-radius:27px!important;
      }
    }

    @media (max-width: 390px) and (min-resolution: 2dppx){
      .heroTitle{
        font-size:45px!important;
      }
      .sectionTitle{
        font-size:34px!important;
      }
      .appBrandText strong{
        font-size:17px!important;
      }
      .appBottomNav a,.appBottomNav button{
        min-height:53px!important;
        font-size:9.5px!important;
      }
      .deviceShell{
        width:min(100%,330px)!important;
      }
    }


    /* ===== v18 Safe Visual Upgrade: stable, no layout-breaking effects ===== */
    .safeGlowLayer{
      position:fixed;
      inset:0;
      z-index:-2;
      pointer-events:none;
      overflow:hidden;
    }
    .safeGlowLayer::before,
    .safeGlowLayer::after{
      content:"";
      position:absolute;
      border-radius:999px;
      filter:blur(64px);
      opacity:.18;
      background:radial-gradient(circle,rgba(124,92,255,.75),rgba(255,79,216,.22) 45%,transparent 70%);
    }
    .safeGlowLayer::before{
      width:520px;
      height:520px;
      left:-160px;
      top:20vh;
    }
    .safeGlowLayer::after{
      width:460px;
      height:460px;
      right:-160px;
      bottom:10vh;
      background:radial-gradient(circle,rgba(53,215,255,.58),rgba(124,92,255,.18) 45%,transparent 70%);
    }

    .safeFloatDecor{
      position:fixed;
      inset:0;
      z-index:-1;
      pointer-events:none;
      overflow:hidden;
    }
    .safeFloatDecor span{
      position:absolute;
      display:grid;
      place-items:center;
      width:38px;
      height:38px;
      border-radius:16px;
      color:rgba(255,255,255,.42);
      background:rgba(255,255,255,.045);
      border:1px solid rgba(255,255,255,.075);
      box-shadow:0 14px 38px rgba(0,0,0,.18);
      backdrop-filter:blur(12px);
      -webkit-backdrop-filter:blur(12px);
    }
    .safeFloatDecor span:nth-child(1){left:5%;top:18%}
    .safeFloatDecor span:nth-child(2){right:6%;top:23%}
    .safeFloatDecor span:nth-child(3){left:10%;bottom:18%}
    .safeFloatDecor span:nth-child(4){right:10%;bottom:16%}

    .primary{
      background:linear-gradient(135deg,#7c5cff 0%,#b554ff 45%,#35d7ff 115%)!important;
      box-shadow:0 20px 62px rgba(124,92,255,.32), inset 0 1px 0 rgba(255,255,255,.22)!important;
    }
    .glass,.card,.formBox,.hubCard,.final{
      box-shadow:inset 0 1px 0 rgba(255,255,255,.09), 0 24px 78px rgba(0,0,0,.34)!important;
    }
    .card,.hubCard,.formBox,.final,.glass{
      transition:transform .18s ease,border-color .18s ease,background .18s ease;
    }
    @media(pointer:fine){
      .card:hover,.hubCard:hover{
        transform:translateY(-3px);
        border-color:rgba(255,255,255,.22)!important;
      }
    }
    .sectionTitle::after{
      content:"";
      display:block;
      width:min(120px,36%);
      height:3px;
      margin:16px auto 0;
      border-radius:999px;
      background:linear-gradient(90deg,transparent,#7c5cff,#35d7ff,transparent);
      opacity:.58;
    }
    .twoCol .sectionTitle::after,
    .grid2 .sectionTitle::after,
    .hubCard .sectionTitle::after,
    .card .sectionTitle::after{
      margin-left:0;
    }
    .requestCard{
      border-color:rgba(255,255,255,.14)!important;
      background:rgba(0,0,0,.21)!important;
    }
    .mini,.task,.comfort,.metaBox,.portalFeature,.tinyPerk{
      border-color:rgba(255,255,255,.11)!important;
    }
    @media(max-width:720px){
      .safeFloatDecor span:nth-child(n+3){
        display:none;
      }
      .safeGlowLayer::before,.safeGlowLayer::after{
        opacity:.12;
        filter:blur(48px);
      }
      .sectionTitle::after{
        margin-left:0;
        margin-right:auto;
      }
      .card:hover,.hubCard:hover{
        transform:none;
      }
    }


    /* ============================================================
       v19 MAX VISUAL SYSTEM — stable CSS-only visual upgrade
       ============================================================ */

    :root {
      --v19-bg-ink: #050711;
      --v19-bg-mid: #090f1e;
      --v19-glass: rgba(255,255,255,.075);
      --v19-glass-strong: rgba(255,255,255,.115);
      --v19-line: rgba(255,255,255,.14);
      --v19-line-strong: rgba(255,255,255,.23);
      --v19-purple: #7c5cff;
      --v19-purple-2: #a56cff;
      --v19-pink: #ff4fd8;
      --v19-cyan: #35d7ff;
      --v19-blue: #168cff;
      --v19-green: #49e6a5;
      --v19-cream: #fff8ef;
      --v19-shadow-deep: 0 30px 100px rgba(0,0,0,.42);
      --v19-shadow-soft: 0 22px 72px rgba(0,0,0,.32);
      --v19-glow-purple: 0 0 70px rgba(124,92,255,.28);
      --v19-glow-cyan: 0 0 70px rgba(53,215,255,.18);
      --v19-ring: linear-gradient(135deg, rgba(124,92,255,.9), rgba(255,79,216,.5), rgba(53,215,255,.65));
    }

    body {
      background:
        radial-gradient(1000px circle at 10% -5%, rgba(124,92,255,.34), transparent 42%),
        radial-gradient(900px circle at 95% 8%, rgba(255,79,216,.20), transparent 42%),
        radial-gradient(820px circle at 50% 108%, rgba(53,215,255,.16), transparent 52%),
        linear-gradient(180deg, var(--v19-bg-ink), var(--v19-bg-mid) 42%, var(--v19-bg-ink)) !important;
    }

    .v19-premium-field {
      position: fixed;
      inset: 0;
      z-index: -5;
      pointer-events: none;
      overflow: hidden;
      contain: strict;
    }

    .v19-premium-field::before {
      content: "";
      position: absolute;
      inset: -20%;
      opacity: .22;
      background:
        conic-gradient(from 180deg at 50% 50%,
          transparent 0deg,
          rgba(124,92,255,.34) 65deg,
          transparent 130deg,
          rgba(53,215,255,.22) 210deg,
          rgba(255,79,216,.20) 280deg,
          transparent 360deg);
      filter: blur(80px);
      transform: translateZ(0);
      animation: v19AuroraSpin 36s linear infinite;
    }

    .v19-premium-field::after {
      content: "";
      position: absolute;
      inset: 0;
      opacity: .18;
      background:
        linear-gradient(120deg, transparent 0%, rgba(255,255,255,.08) 12%, transparent 26%),
        linear-gradient(300deg, transparent 0%, rgba(53,215,255,.07) 20%, transparent 36%);
      background-size: 160% 160%;
      animation: v19LightSweep 18s ease-in-out infinite;
    }

    @keyframes v19AuroraSpin {
      to {
        transform: rotate(360deg) scale(1.05);
      }
    }

    @keyframes v19LightSweep {
      0%, 100% {
        background-position: 0% 50%;
      }
      50% {
        background-position: 100% 50%;
      }
    }

    .v19-orb {
      position: fixed;
      z-index: -4;
      pointer-events: none;
      border-radius: 999px;
      filter: blur(58px);
      opacity: .24;
      transform: translateZ(0);
      animation: v19OrbMove 20s ease-in-out infinite;
    }

    .v19-orb.one {
      width: 420px;
      height: 420px;
      left: -120px;
      top: 24%;
      background: rgba(124,92,255,.8);
    }

    .v19-orb.two {
      width: 380px;
      height: 380px;
      right: -120px;
      top: 16%;
      background: rgba(255,79,216,.5);
      animation-delay: -6s;
    }

    .v19-orb.three {
      width: 360px;
      height: 360px;
      left: 34%;
      bottom: -130px;
      background: rgba(53,215,255,.45);
      animation-delay: -12s;
    }

    @keyframes v19OrbMove {
      0%, 100% {
        transform: translate3d(0, 0, 0) scale(1);
      }
      35% {
        transform: translate3d(34px, -26px, 0) scale(1.08);
      }
      70% {
        transform: translate3d(-20px, 28px, 0) scale(.96);
      }
    }

    .v19-dust {
      position: fixed;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      overflow: hidden;
      opacity: .55;
    }

    .v19-dust span {
      position: absolute;
      display: block;
      width: 3px;
      height: 3px;
      border-radius: 999px;
      background: rgba(255,255,255,.5);
      box-shadow: 0 0 18px rgba(255,255,255,.26);
      animation: v19DustFloat 12s ease-in-out infinite;
    }

    .v19-dust span:nth-child(1) { left: 9%; top: 17%; animation-delay: -1s; }
    .v19-dust span:nth-child(2) { left: 18%; top: 58%; animation-delay: -4s; }
    .v19-dust span:nth-child(3) { left: 27%; top: 30%; animation-delay: -8s; }
    .v19-dust span:nth-child(4) { left: 44%; top: 14%; animation-delay: -2s; }
    .v19-dust span:nth-child(5) { left: 61%; top: 72%; animation-delay: -6s; }
    .v19-dust span:nth-child(6) { left: 79%; top: 22%; animation-delay: -9s; }
    .v19-dust span:nth-child(7) { left: 88%; top: 63%; animation-delay: -3s; }
    .v19-dust span:nth-child(8) { left: 51%; top: 45%; animation-delay: -7s; }

    @keyframes v19DustFloat {
      0%, 100% {
        transform: translateY(0);
        opacity: .15;
      }
      50% {
        transform: translateY(-22px);
        opacity: .75;
      }
    }

    .v19-floating-icons {
      position: fixed;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      overflow: hidden;
    }

    .v19-floating-icons span {
      position: absolute;
      display: grid;
      place-items: center;
      width: 46px;
      height: 46px;
      border-radius: 19px;
      background: rgba(255,255,255,.055);
      border: 1px solid rgba(255,255,255,.09);
      color: rgba(255,255,255,.58);
      box-shadow: 0 18px 52px rgba(0,0,0,.22);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      animation: v19IconFloat 14s ease-in-out infinite;
    }

    .v19-floating-icons span:nth-child(1) { left: 5%; top: 21%; animation-delay: -2s; }
    .v19-floating-icons span:nth-child(2) { right: 6%; top: 24%; animation-delay: -7s; }
    .v19-floating-icons span:nth-child(3) { left: 8%; bottom: 18%; animation-delay: -10s; }
    .v19-floating-icons span:nth-child(4) { right: 10%; bottom: 19%; animation-delay: -4s; }
    .v19-floating-icons span:nth-child(5) { left: 50%; top: 10%; animation-delay: -12s; }
    .v19-floating-icons span:nth-child(6) { left: 64%; bottom: 10%; animation-delay: -5s; }

    @keyframes v19IconFloat {
      0%, 100% {
        transform: translate3d(0, 0, 0) rotate(-4deg);
        opacity: .32;
      }
      50% {
        transform: translate3d(16px, -22px, 0) rotate(7deg);
        opacity: .68;
      }
    }

    .v19-premium-border {
      position: relative;
      isolation: isolate;
    }

    .v19-premium-border::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: var(--v19-ring);
      opacity: .35;
      filter: blur(0px);
      pointer-events: none;
    }

    .v19-premium-border::after {
      content: "";
      position: absolute;
      inset: 1px;
      z-index: -1;
      border-radius: inherit;
      background: rgba(7,10,18,.68);
      pointer-events: none;
    }

    .header {
      box-shadow: 0 20px 70px rgba(0,0,0,.22);
    }

    .logoIcon,
    .appIcon {
      background:
        radial-gradient(circle at 30% 15%, rgba(255,255,255,1), rgba(255,255,255,.82) 45%, rgba(226,242,255,.78));
      box-shadow:
        0 18px 54px rgba(124,92,255,.30),
        0 8px 22px rgba(53,215,255,.16),
        inset 0 1px 0 rgba(255,255,255,.42) !important;
    }

    .hero {
      position: relative;
    }

    .hero::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: 7%;
      width: min(760px, 80vw);
      height: 120px;
      transform: translateX(-50%);
      z-index: -1;
      opacity: .22;
      border-radius: 999px;
      background: radial-gradient(ellipse, rgba(124,92,255,.55), transparent 68%);
      filter: blur(34px);
      pointer-events: none;
    }

    .heroTitle,
    .personalGreeting,
    .finalTitle {
      text-shadow:
        0 0 1px rgba(255,255,255,.10),
        0 22px 70px rgba(124,92,255,.20),
        0 10px 40px rgba(0,0,0,.18);
    }

    .shine {
      filter: drop-shadow(0 18px 42px rgba(124,92,255,.18));
    }

    .chip {
      position: relative;
      overflow: hidden;
    }

    .chip::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(110deg, transparent 0%, rgba(255,255,255,.16) 42%, transparent 58%);
      transform: translateX(-130%);
      animation: v19ChipSweep 7s ease-in-out infinite;
      pointer-events: none;
    }

    @keyframes v19ChipSweep {
      0%, 72%, 100% {
        transform: translateX(-130%);
      }
      84% {
        transform: translateX(130%);
      }
    }

    .btn {
      position: relative;
      overflow: hidden;
      transform: translateZ(0);
    }

    .btn::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: -1;
      opacity: .0;
      background: radial-gradient(circle at 50% 0%, rgba(255,255,255,.24), transparent 48%);
      transition: opacity .2s ease;
    }

    .btn:hover::after {
      opacity: .85;
    }

    .primary {
      background:
        linear-gradient(135deg, #7c5cff 0%, #b554ff 38%, #ff4fd8 58%, #35d7ff 122%) !important;
      background-size: 180% 180% !important;
      box-shadow:
        0 22px 66px rgba(124,92,255,.36),
        0 12px 34px rgba(53,215,255,.12),
        inset 0 1px 0 rgba(255,255,255,.24) !important;
      animation: v19PrimaryFlow 8s ease-in-out infinite;
    }

    @keyframes v19PrimaryFlow {
      0%, 100% {
        background-position: 0% 50%;
      }
      50% {
        background-position: 100% 50%;
      }
    }

    .ghost {
      background:
        radial-gradient(220px circle at 30% 0%, rgba(255,255,255,.11), transparent 46%),
        rgba(255,255,255,.066) !important;
    }

    .glass,
    .card,
    .formBox,
    .hubCard,
    .final,
    .device,
    .screen,
    .estimateResult {
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.10),
        0 24px 86px rgba(0,0,0,.36) !important;
    }

    .card,
    .hubCard,
    .formBox,
    .final,
    .device,
    .screen {
      background-image:
        radial-gradient(520px circle at 20% 0%, rgba(255,255,255,.075), transparent 46%),
        linear-gradient(180deg, rgba(255,255,255,.094), rgba(255,255,255,.038)) !important;
    }

    .card:hover,
    .hubCard:hover {
      border-color: rgba(255,255,255,.22) !important;
    }

    .stat,
    .hubStat,
    .mini,
    .task,
    .metaBox,
    .comfort,
    .moodTile,
    .portalFeature,
    .tinyPerk {
      background:
        radial-gradient(260px circle at 20% 0%, rgba(255,255,255,.085), transparent 46%),
        rgba(255,255,255,.056) !important;
      border-color: rgba(255,255,255,.105) !important;
    }

    .requestCard {
      background:
        radial-gradient(460px circle at 20% 0%, rgba(124,92,255,.13), transparent 48%),
        rgba(0,0,0,.22) !important;
      border-color: rgba(255,255,255,.13) !important;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.075),
        0 20px 64px rgba(0,0,0,.25) !important;
    }

    .requestIcon {
      background:
        linear-gradient(135deg, #ffffff, #e8f3ff) !important;
      box-shadow:
        0 20px 58px rgba(255,255,255,.12),
        0 10px 32px rgba(124,92,255,.22) !important;
    }

    .sectionTitle {
      position: relative;
    }

    .sectionTitle::after {
      content: "";
      display: block;
      width: min(150px, 38%);
      height: 4px;
      margin: 18px auto 0;
      border-radius: 999px;
      background: linear-gradient(90deg, transparent, var(--v19-purple), var(--v19-cyan), transparent);
      opacity: .72;
      box-shadow: 0 0 34px rgba(124,92,255,.35);
    }

    .twoCol .sectionTitle::after,
    .grid2 .sectionTitle::after,
    .hubCard .sectionTitle::after,
    .card .sectionTitle::after {
      margin-left: 0;
    }

    .field input,
    .field select,
    .field textarea {
      background:
        radial-gradient(240px circle at 20% 0%, rgba(255,255,255,.08), transparent 45%),
        rgba(255,255,255,.064) !important;
      border-color: rgba(255,255,255,.13) !important;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
    }

    .field input:focus,
    .field select:focus,
    .field textarea:focus {
      border-color: rgba(124,92,255,.55) !important;
      box-shadow:
        0 0 0 4px rgba(124,92,255,.18),
        0 0 44px rgba(53,215,255,.10) !important;
    }

    .estimatePrice,
    .priceAmount,
    .statNum,
    .miniValue {
      text-shadow:
        0 0 1px rgba(255,255,255,.12),
        0 18px 48px rgba(124,92,255,.16);
    }

    .personalHero {
      background:
        radial-gradient(700px circle at 18% 0%, rgba(73,230,165,.14), transparent 44%),
        radial-gradient(700px circle at 90% 10%, rgba(124,92,255,.20), transparent 46%),
        linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.038)) !important;
    }

    .todayCard {
      background:
        radial-gradient(500px circle at 50% 0%, rgba(53,215,255,.12), transparent 50%),
        linear-gradient(180deg, rgba(255,255,255,.095), rgba(255,255,255,.038)) !important;
    }

    .ring {
      box-shadow:
        0 0 44px rgba(73,230,165,.20),
        0 18px 54px rgba(0,0,0,.25) !important;
    }

    .memoryCard {
      background:
        radial-gradient(520px circle at 20% 0%, rgba(124,92,255,.12), transparent 48%),
        linear-gradient(180deg, rgba(255,255,255,.082), rgba(255,255,255,.035)) !important;
    }

    .memoryStep.done {
      box-shadow: 0 0 28px rgba(73,230,165,.12);
    }

    .memoryStep.active {
      box-shadow: 0 0 28px rgba(124,92,255,.20);
    }

    .appBottomNav {
      box-shadow:
        0 24px 80px rgba(0,0,0,.54),
        inset 0 1px 0 rgba(255,255,255,.10) !important;
    }

    .quickSheetPanel {
      background:
        radial-gradient(520px circle at 50% -10%, rgba(124,92,255,.18), transparent 55%),
        #070a12 !important;
    }

    @media (hover:hover) and (pointer:fine) {
      .card,
      .hubCard,
      .formBox,
      .final {
        transition:
          transform .22s ease,
          border-color .22s ease,
          background .22s ease,
          box-shadow .22s ease;
      }

      .card:hover,
      .hubCard:hover,
      .formBox:hover,
      .final:hover {
        transform: translateY(-4px);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.11),
          0 34px 110px rgba(0,0,0,.42),
          0 0 60px rgba(124,92,255,.08) !important;
      }
    }

    @media (max-width: 720px) {
      .v19-premium-field::before,
      .v19-premium-field::after {
        animation: none;
        opacity: .12;
      }

      .v19-orb {
        opacity: .14;
        filter: blur(44px);
      }

      .v19-floating-icons span {
        width: 34px;
        height: 34px;
        border-radius: 14px;
        opacity: .45;
      }

      .v19-floating-icons span:nth-child(n+4) {
        display: none;
      }

      .v19-dust {
        opacity: .28;
      }

      .sectionTitle::after {
        width: 110px;
        height: 3px;
        margin-left: 0;
        margin-right: auto;
      }

      .chip::after {
        display: none;
      }

      .primary {
        animation: none;
      }

      .card:hover,
      .hubCard:hover,
      .formBox:hover,
      .final:hover {
        transform: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .v19-premium-field::before,
      .v19-premium-field::after,
      .v19-orb,
      .v19-dust span,
      .v19-floating-icons span,
      .chip::after,
      .primary {
        animation: none !important;
      }
    }


    /* ===== v19 Generated Premium Utility + FX Classes ===== */
    .v19-depth-card-1 {
      position: relative;
      overflow: hidden;
      border-radius: 15px;
      border: 1px solid rgba(255,255,255,0.100);
      background: radial-gradient(420px circle at 11% 0%, rgba(255,255,255,0.050), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 17px 41px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-1 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-1::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(121deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(11px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-2 {
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.110);
      background: radial-gradient(420px circle at 12% 0%, rgba(255,255,255,0.060), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 18px 42px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-2 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-2::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(122deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(12px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-3 {
      position: relative;
      overflow: hidden;
      border-radius: 17px;
      border: 1px solid rgba(255,255,255,0.120);
      background: radial-gradient(420px circle at 13% 0%, rgba(255,255,255,0.070), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 19px 43px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-3 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-3::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(123deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(13px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-4 {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.130);
      background: radial-gradient(420px circle at 14% 0%, rgba(255,255,255,0.080), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 44px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-4 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-4::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(124deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(14px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-5 {
      position: relative;
      overflow: hidden;
      border-radius: 19px;
      border: 1px solid rgba(255,255,255,0.140);
      background: radial-gradient(420px circle at 15% 0%, rgba(255,255,255,0.090), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 21px 45px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-5 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-5::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(125deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(15px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-6 {
      position: relative;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.150);
      background: radial-gradient(420px circle at 16% 0%, rgba(255,255,255,0.100), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 46px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-6 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-6::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(126deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(16px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-7 {
      position: relative;
      overflow: hidden;
      border-radius: 21px;
      border: 1px solid rgba(255,255,255,0.160);
      background: radial-gradient(420px circle at 17% 0%, rgba(255,255,255,0.110), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 23px 47px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-7 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-7::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(127deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(17px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-8 {
      position: relative;
      overflow: hidden;
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.170);
      background: radial-gradient(420px circle at 18% 0%, rgba(255,255,255,0.120), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 48px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-8 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-8::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(128deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(18px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-9 {
      position: relative;
      overflow: hidden;
      border-radius: 23px;
      border: 1px solid rgba(255,255,255,0.180);
      background: radial-gradient(420px circle at 19% 0%, rgba(255,255,255,0.130), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 25px 49px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-9 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-9::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(129deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(19px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-10 {
      position: relative;
      overflow: hidden;
      border-radius: 24px;
      border: 1px solid rgba(255,255,255,0.190);
      background: radial-gradient(420px circle at 20% 0%, rgba(255,255,255,0.140), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 26px 50px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-10 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-10::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(130deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(20px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-11 {
      position: relative;
      overflow: hidden;
      border-radius: 25px;
      border: 1px solid rgba(255,255,255,0.200);
      background: radial-gradient(420px circle at 21% 0%, rgba(255,255,255,0.150), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 27px 51px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-11 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-11::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(131deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(21px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-12 {
      position: relative;
      overflow: hidden;
      border-radius: 26px;
      border: 1px solid rgba(255,255,255,0.210);
      background: radial-gradient(420px circle at 22% 0%, rgba(255,255,255,0.160), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 28px 52px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-12 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-12::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(132deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(22px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-13 {
      position: relative;
      overflow: hidden;
      border-radius: 27px;
      border: 1px solid rgba(255,255,255,0.220);
      background: radial-gradient(420px circle at 23% 0%, rgba(255,255,255,0.170), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 29px 53px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-13 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-13::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(133deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(23px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-14 {
      position: relative;
      overflow: hidden;
      border-radius: 28px;
      border: 1px solid rgba(255,255,255,0.230);
      background: radial-gradient(420px circle at 24% 0%, rgba(255,255,255,0.180), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 16px 54px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-14 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-14::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(134deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(24px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-15 {
      position: relative;
      overflow: hidden;
      border-radius: 29px;
      border: 1px solid rgba(255,255,255,0.240);
      background: radial-gradient(420px circle at 25% 0%, rgba(255,255,255,0.190), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 17px 55px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-15 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-15::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(135deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(25px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-16 {
      position: relative;
      overflow: hidden;
      border-radius: 30px;
      border: 1px solid rgba(255,255,255,0.250);
      background: radial-gradient(420px circle at 26% 0%, rgba(255,255,255,0.200), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 18px 56px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-16 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-16::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(136deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(26px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-17 {
      position: relative;
      overflow: hidden;
      border-radius: 31px;
      border: 1px solid rgba(255,255,255,0.260);
      background: radial-gradient(420px circle at 27% 0%, rgba(255,255,255,0.210), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 19px 57px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-17 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-17::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(137deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(27px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-18 {
      position: relative;
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.270);
      background: radial-gradient(420px circle at 28% 0%, rgba(255,255,255,0.220), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 58px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-18 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-18::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(138deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(28px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-19 {
      position: relative;
      overflow: hidden;
      border-radius: 15px;
      border: 1px solid rgba(255,255,255,0.280);
      background: radial-gradient(420px circle at 29% 0%, rgba(255,255,255,0.230), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 21px 59px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-19 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-19::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(139deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(29px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-20 {
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.090);
      background: radial-gradient(420px circle at 30% 0%, rgba(255,255,255,0.040), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 60px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-20 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-20::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(140deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(30px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-21 {
      position: relative;
      overflow: hidden;
      border-radius: 17px;
      border: 1px solid rgba(255,255,255,0.100);
      background: radial-gradient(420px circle at 31% 0%, rgba(255,255,255,0.050), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 23px 61px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-21 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-21::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(141deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(31px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-22 {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.110);
      background: radial-gradient(420px circle at 32% 0%, rgba(255,255,255,0.060), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 62px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-22 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-22::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(142deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(32px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-23 {
      position: relative;
      overflow: hidden;
      border-radius: 19px;
      border: 1px solid rgba(255,255,255,0.120);
      background: radial-gradient(420px circle at 33% 0%, rgba(255,255,255,0.070), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 25px 63px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-23 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-23::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(143deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(33px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-24 {
      position: relative;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.130);
      background: radial-gradient(420px circle at 34% 0%, rgba(255,255,255,0.080), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 26px 64px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-24 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-24::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(144deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(10px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-25 {
      position: relative;
      overflow: hidden;
      border-radius: 21px;
      border: 1px solid rgba(255,255,255,0.140);
      background: radial-gradient(420px circle at 35% 0%, rgba(255,255,255,0.090), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 27px 65px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-25 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-25::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(145deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(11px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-26 {
      position: relative;
      overflow: hidden;
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.150);
      background: radial-gradient(420px circle at 36% 0%, rgba(255,255,255,0.100), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 28px 66px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-26 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-26::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(146deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(12px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-27 {
      position: relative;
      overflow: hidden;
      border-radius: 23px;
      border: 1px solid rgba(255,255,255,0.160);
      background: radial-gradient(420px circle at 37% 0%, rgba(255,255,255,0.110), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 29px 67px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-27 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-27::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(147deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(13px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-28 {
      position: relative;
      overflow: hidden;
      border-radius: 24px;
      border: 1px solid rgba(255,255,255,0.170);
      background: radial-gradient(420px circle at 38% 0%, rgba(255,255,255,0.120), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 16px 68px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-28 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-28::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(148deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(14px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-29 {
      position: relative;
      overflow: hidden;
      border-radius: 25px;
      border: 1px solid rgba(255,255,255,0.180);
      background: radial-gradient(420px circle at 39% 0%, rgba(255,255,255,0.130), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 17px 69px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-29 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-29::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(149deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(15px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-30 {
      position: relative;
      overflow: hidden;
      border-radius: 26px;
      border: 1px solid rgba(255,255,255,0.190);
      background: radial-gradient(420px circle at 40% 0%, rgba(255,255,255,0.140), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 18px 70px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-30 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-30::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(150deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(16px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-31 {
      position: relative;
      overflow: hidden;
      border-radius: 27px;
      border: 1px solid rgba(255,255,255,0.200);
      background: radial-gradient(420px circle at 41% 0%, rgba(255,255,255,0.150), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 19px 71px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-31 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-31::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(151deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(17px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-32 {
      position: relative;
      overflow: hidden;
      border-radius: 28px;
      border: 1px solid rgba(255,255,255,0.210);
      background: radial-gradient(420px circle at 42% 0%, rgba(255,255,255,0.160), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 72px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-32 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-32::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(152deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(18px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-33 {
      position: relative;
      overflow: hidden;
      border-radius: 29px;
      border: 1px solid rgba(255,255,255,0.220);
      background: radial-gradient(420px circle at 43% 0%, rgba(255,255,255,0.170), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 21px 73px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-33 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-33::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(153deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(19px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-34 {
      position: relative;
      overflow: hidden;
      border-radius: 30px;
      border: 1px solid rgba(255,255,255,0.230);
      background: radial-gradient(420px circle at 44% 0%, rgba(255,255,255,0.180), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 74px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-34 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-34::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(154deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(20px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-35 {
      position: relative;
      overflow: hidden;
      border-radius: 31px;
      border: 1px solid rgba(255,255,255,0.240);
      background: radial-gradient(420px circle at 45% 0%, rgba(255,255,255,0.190), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 23px 75px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-35 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-35::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(155deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(21px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-36 {
      position: relative;
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.250);
      background: radial-gradient(420px circle at 46% 0%, rgba(255,255,255,0.200), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 76px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-36 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-36::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(156deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(22px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-37 {
      position: relative;
      overflow: hidden;
      border-radius: 15px;
      border: 1px solid rgba(255,255,255,0.260);
      background: radial-gradient(420px circle at 47% 0%, rgba(255,255,255,0.210), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 25px 77px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-37 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-37::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(157deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(23px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-38 {
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.270);
      background: radial-gradient(420px circle at 48% 0%, rgba(255,255,255,0.220), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 26px 78px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-38 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-38::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(158deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(24px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-39 {
      position: relative;
      overflow: hidden;
      border-radius: 17px;
      border: 1px solid rgba(255,255,255,0.280);
      background: radial-gradient(420px circle at 49% 0%, rgba(255,255,255,0.230), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 27px 79px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-39 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-39::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(159deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(25px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-40 {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.090);
      background: radial-gradient(420px circle at 50% 0%, rgba(255,255,255,0.040), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 28px 40px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-40 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-40::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(160deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(26px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-41 {
      position: relative;
      overflow: hidden;
      border-radius: 19px;
      border: 1px solid rgba(255,255,255,0.100);
      background: radial-gradient(420px circle at 51% 0%, rgba(255,255,255,0.050), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 29px 41px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-41 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-41::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(161deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(27px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-42 {
      position: relative;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.110);
      background: radial-gradient(420px circle at 52% 0%, rgba(255,255,255,0.060), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 16px 42px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-42 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-42::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(162deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(28px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-43 {
      position: relative;
      overflow: hidden;
      border-radius: 21px;
      border: 1px solid rgba(255,255,255,0.120);
      background: radial-gradient(420px circle at 53% 0%, rgba(255,255,255,0.070), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 17px 43px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-43 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-43::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(163deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(29px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-44 {
      position: relative;
      overflow: hidden;
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.130);
      background: radial-gradient(420px circle at 54% 0%, rgba(255,255,255,0.080), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 18px 44px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-44 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-44::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(164deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(30px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-45 {
      position: relative;
      overflow: hidden;
      border-radius: 23px;
      border: 1px solid rgba(255,255,255,0.140);
      background: radial-gradient(420px circle at 55% 0%, rgba(255,255,255,0.090), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 19px 45px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-45 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-45::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(165deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(31px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-46 {
      position: relative;
      overflow: hidden;
      border-radius: 24px;
      border: 1px solid rgba(255,255,255,0.150);
      background: radial-gradient(420px circle at 56% 0%, rgba(255,255,255,0.100), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 46px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-46 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-46::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(166deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(32px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-47 {
      position: relative;
      overflow: hidden;
      border-radius: 25px;
      border: 1px solid rgba(255,255,255,0.160);
      background: radial-gradient(420px circle at 57% 0%, rgba(255,255,255,0.110), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 21px 47px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-47 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-47::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(167deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(33px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-48 {
      position: relative;
      overflow: hidden;
      border-radius: 26px;
      border: 1px solid rgba(255,255,255,0.170);
      background: radial-gradient(420px circle at 58% 0%, rgba(255,255,255,0.120), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 48px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-48 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-48::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(168deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(10px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-49 {
      position: relative;
      overflow: hidden;
      border-radius: 27px;
      border: 1px solid rgba(255,255,255,0.180);
      background: radial-gradient(420px circle at 59% 0%, rgba(255,255,255,0.130), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 23px 49px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-49 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-49::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(169deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(11px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-50 {
      position: relative;
      overflow: hidden;
      border-radius: 28px;
      border: 1px solid rgba(255,255,255,0.190);
      background: radial-gradient(420px circle at 60% 0%, rgba(255,255,255,0.140), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 50px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-50 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-50::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(170deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(12px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-51 {
      position: relative;
      overflow: hidden;
      border-radius: 29px;
      border: 1px solid rgba(255,255,255,0.200);
      background: radial-gradient(420px circle at 61% 0%, rgba(255,255,255,0.150), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 25px 51px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-51 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-51::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(171deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(13px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-52 {
      position: relative;
      overflow: hidden;
      border-radius: 30px;
      border: 1px solid rgba(255,255,255,0.210);
      background: radial-gradient(420px circle at 62% 0%, rgba(255,255,255,0.160), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 26px 52px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-52 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-52::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(172deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(14px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-53 {
      position: relative;
      overflow: hidden;
      border-radius: 31px;
      border: 1px solid rgba(255,255,255,0.220);
      background: radial-gradient(420px circle at 63% 0%, rgba(255,255,255,0.170), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 27px 53px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-53 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-53::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(173deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(15px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-54 {
      position: relative;
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.230);
      background: radial-gradient(420px circle at 64% 0%, rgba(255,255,255,0.180), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 28px 54px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-54 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-54::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(174deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(16px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-55 {
      position: relative;
      overflow: hidden;
      border-radius: 15px;
      border: 1px solid rgba(255,255,255,0.240);
      background: radial-gradient(420px circle at 65% 0%, rgba(255,255,255,0.190), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 29px 55px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-55 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-55::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(175deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(17px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-56 {
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.250);
      background: radial-gradient(420px circle at 66% 0%, rgba(255,255,255,0.200), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 16px 56px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-56 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-56::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(176deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(18px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-57 {
      position: relative;
      overflow: hidden;
      border-radius: 17px;
      border: 1px solid rgba(255,255,255,0.260);
      background: radial-gradient(420px circle at 67% 0%, rgba(255,255,255,0.210), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 17px 57px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-57 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-57::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(177deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(19px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-58 {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.270);
      background: radial-gradient(420px circle at 68% 0%, rgba(255,255,255,0.220), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 18px 58px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-58 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-58::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(178deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(20px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-59 {
      position: relative;
      overflow: hidden;
      border-radius: 19px;
      border: 1px solid rgba(255,255,255,0.280);
      background: radial-gradient(420px circle at 69% 0%, rgba(255,255,255,0.230), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 19px 59px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-59 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-59::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(179deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(21px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-60 {
      position: relative;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.090);
      background: radial-gradient(420px circle at 10% 0%, rgba(255,255,255,0.040), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 60px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-60 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-60::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(22px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-61 {
      position: relative;
      overflow: hidden;
      border-radius: 21px;
      border: 1px solid rgba(255,255,255,0.100);
      background: radial-gradient(420px circle at 11% 0%, rgba(255,255,255,0.050), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 21px 61px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-61 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-61::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(181deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(23px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-62 {
      position: relative;
      overflow: hidden;
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.110);
      background: radial-gradient(420px circle at 12% 0%, rgba(255,255,255,0.060), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 62px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-62 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-62::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(182deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(24px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-63 {
      position: relative;
      overflow: hidden;
      border-radius: 23px;
      border: 1px solid rgba(255,255,255,0.120);
      background: radial-gradient(420px circle at 13% 0%, rgba(255,255,255,0.070), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 23px 63px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-63 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-63::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(183deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(25px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-64 {
      position: relative;
      overflow: hidden;
      border-radius: 24px;
      border: 1px solid rgba(255,255,255,0.130);
      background: radial-gradient(420px circle at 14% 0%, rgba(255,255,255,0.080), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 64px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-64 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-64::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(184deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(26px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-65 {
      position: relative;
      overflow: hidden;
      border-radius: 25px;
      border: 1px solid rgba(255,255,255,0.140);
      background: radial-gradient(420px circle at 15% 0%, rgba(255,255,255,0.090), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 25px 65px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-65 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-65::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(185deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(27px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-66 {
      position: relative;
      overflow: hidden;
      border-radius: 26px;
      border: 1px solid rgba(255,255,255,0.150);
      background: radial-gradient(420px circle at 16% 0%, rgba(255,255,255,0.100), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 26px 66px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-66 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-66::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(186deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(28px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-67 {
      position: relative;
      overflow: hidden;
      border-radius: 27px;
      border: 1px solid rgba(255,255,255,0.160);
      background: radial-gradient(420px circle at 17% 0%, rgba(255,255,255,0.110), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 27px 67px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-67 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-67::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(187deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(29px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-68 {
      position: relative;
      overflow: hidden;
      border-radius: 28px;
      border: 1px solid rgba(255,255,255,0.170);
      background: radial-gradient(420px circle at 18% 0%, rgba(255,255,255,0.120), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 28px 68px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-68 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-68::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(188deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(30px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-69 {
      position: relative;
      overflow: hidden;
      border-radius: 29px;
      border: 1px solid rgba(255,255,255,0.180);
      background: radial-gradient(420px circle at 19% 0%, rgba(255,255,255,0.130), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 29px 69px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-69 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-69::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(189deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(31px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-70 {
      position: relative;
      overflow: hidden;
      border-radius: 30px;
      border: 1px solid rgba(255,255,255,0.190);
      background: radial-gradient(420px circle at 20% 0%, rgba(255,255,255,0.140), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 16px 70px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-70 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-70::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(190deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(32px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-71 {
      position: relative;
      overflow: hidden;
      border-radius: 31px;
      border: 1px solid rgba(255,255,255,0.200);
      background: radial-gradient(420px circle at 21% 0%, rgba(255,255,255,0.150), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 17px 71px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-71 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-71::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(191deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(33px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-72 {
      position: relative;
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.210);
      background: radial-gradient(420px circle at 22% 0%, rgba(255,255,255,0.160), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 18px 72px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-72 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-72::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(192deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(10px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-73 {
      position: relative;
      overflow: hidden;
      border-radius: 15px;
      border: 1px solid rgba(255,255,255,0.220);
      background: radial-gradient(420px circle at 23% 0%, rgba(255,255,255,0.170), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 19px 73px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-73 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-73::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(193deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(11px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-74 {
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.230);
      background: radial-gradient(420px circle at 24% 0%, rgba(255,255,255,0.180), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 74px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-74 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-74::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(194deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(12px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-75 {
      position: relative;
      overflow: hidden;
      border-radius: 17px;
      border: 1px solid rgba(255,255,255,0.240);
      background: radial-gradient(420px circle at 25% 0%, rgba(255,255,255,0.190), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 21px 75px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-75 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-75::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(195deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(13px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-76 {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.250);
      background: radial-gradient(420px circle at 26% 0%, rgba(255,255,255,0.200), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 76px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-76 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-76::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(196deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(14px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-77 {
      position: relative;
      overflow: hidden;
      border-radius: 19px;
      border: 1px solid rgba(255,255,255,0.260);
      background: radial-gradient(420px circle at 27% 0%, rgba(255,255,255,0.210), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 23px 77px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-77 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-77::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(197deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(15px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-78 {
      position: relative;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.270);
      background: radial-gradient(420px circle at 28% 0%, rgba(255,255,255,0.220), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 78px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-78 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-78::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(198deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(16px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-79 {
      position: relative;
      overflow: hidden;
      border-radius: 21px;
      border: 1px solid rgba(255,255,255,0.280);
      background: radial-gradient(420px circle at 29% 0%, rgba(255,255,255,0.230), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 25px 79px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-79 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-79::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(199deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(17px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-80 {
      position: relative;
      overflow: hidden;
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.090);
      background: radial-gradient(420px circle at 30% 0%, rgba(255,255,255,0.040), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 26px 40px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-80 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-80::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(200deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(18px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-81 {
      position: relative;
      overflow: hidden;
      border-radius: 23px;
      border: 1px solid rgba(255,255,255,0.100);
      background: radial-gradient(420px circle at 31% 0%, rgba(255,255,255,0.050), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 27px 41px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-81 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-81::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(201deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(19px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-82 {
      position: relative;
      overflow: hidden;
      border-radius: 24px;
      border: 1px solid rgba(255,255,255,0.110);
      background: radial-gradient(420px circle at 32% 0%, rgba(255,255,255,0.060), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 28px 42px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-82 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-82::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(202deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(20px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-83 {
      position: relative;
      overflow: hidden;
      border-radius: 25px;
      border: 1px solid rgba(255,255,255,0.120);
      background: radial-gradient(420px circle at 33% 0%, rgba(255,255,255,0.070), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 29px 43px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-83 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-83::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(203deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(21px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-84 {
      position: relative;
      overflow: hidden;
      border-radius: 26px;
      border: 1px solid rgba(255,255,255,0.130);
      background: radial-gradient(420px circle at 34% 0%, rgba(255,255,255,0.080), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 16px 44px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-84 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-84::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(204deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(22px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-85 {
      position: relative;
      overflow: hidden;
      border-radius: 27px;
      border: 1px solid rgba(255,255,255,0.140);
      background: radial-gradient(420px circle at 35% 0%, rgba(255,255,255,0.090), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 17px 45px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-85 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-85::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(205deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(23px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-86 {
      position: relative;
      overflow: hidden;
      border-radius: 28px;
      border: 1px solid rgba(255,255,255,0.150);
      background: radial-gradient(420px circle at 36% 0%, rgba(255,255,255,0.100), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 18px 46px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-86 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-86::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(206deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(24px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-87 {
      position: relative;
      overflow: hidden;
      border-radius: 29px;
      border: 1px solid rgba(255,255,255,0.160);
      background: radial-gradient(420px circle at 37% 0%, rgba(255,255,255,0.110), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 19px 47px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-87 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-87::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(207deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(25px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-88 {
      position: relative;
      overflow: hidden;
      border-radius: 30px;
      border: 1px solid rgba(255,255,255,0.170);
      background: radial-gradient(420px circle at 38% 0%, rgba(255,255,255,0.120), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 48px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-88 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-88::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(208deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(26px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-89 {
      position: relative;
      overflow: hidden;
      border-radius: 31px;
      border: 1px solid rgba(255,255,255,0.180);
      background: radial-gradient(420px circle at 39% 0%, rgba(255,255,255,0.130), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 21px 49px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-89 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-89::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(209deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(27px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-90 {
      position: relative;
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.190);
      background: radial-gradient(420px circle at 40% 0%, rgba(255,255,255,0.140), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 50px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-90 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-90::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(210deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(28px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-91 {
      position: relative;
      overflow: hidden;
      border-radius: 15px;
      border: 1px solid rgba(255,255,255,0.200);
      background: radial-gradient(420px circle at 41% 0%, rgba(255,255,255,0.150), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 23px 51px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-91 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-91::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(211deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(29px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-92 {
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.210);
      background: radial-gradient(420px circle at 42% 0%, rgba(255,255,255,0.160), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 52px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-92 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-92::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(212deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(30px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-93 {
      position: relative;
      overflow: hidden;
      border-radius: 17px;
      border: 1px solid rgba(255,255,255,0.220);
      background: radial-gradient(420px circle at 43% 0%, rgba(255,255,255,0.170), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 25px 53px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-93 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-93::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(213deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(31px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-94 {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.230);
      background: radial-gradient(420px circle at 44% 0%, rgba(255,255,255,0.180), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 26px 54px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-94 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-94::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(214deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(32px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-95 {
      position: relative;
      overflow: hidden;
      border-radius: 19px;
      border: 1px solid rgba(255,255,255,0.240);
      background: radial-gradient(420px circle at 45% 0%, rgba(255,255,255,0.190), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 27px 55px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-95 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-95::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(215deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(33px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-96 {
      position: relative;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.250);
      background: radial-gradient(420px circle at 46% 0%, rgba(255,255,255,0.200), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 28px 56px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-96 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-96::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(216deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(10px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-97 {
      position: relative;
      overflow: hidden;
      border-radius: 21px;
      border: 1px solid rgba(255,255,255,0.260);
      background: radial-gradient(420px circle at 47% 0%, rgba(255,255,255,0.210), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 29px 57px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-97 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-97::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(217deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(11px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-98 {
      position: relative;
      overflow: hidden;
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.270);
      background: radial-gradient(420px circle at 48% 0%, rgba(255,255,255,0.220), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 16px 58px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-98 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-98::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(218deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(12px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-99 {
      position: relative;
      overflow: hidden;
      border-radius: 23px;
      border: 1px solid rgba(255,255,255,0.280);
      background: radial-gradient(420px circle at 49% 0%, rgba(255,255,255,0.230), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 17px 59px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-99 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-99::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(219deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(13px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-100 {
      position: relative;
      overflow: hidden;
      border-radius: 24px;
      border: 1px solid rgba(255,255,255,0.090);
      background: radial-gradient(420px circle at 50% 0%, rgba(255,255,255,0.040), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 18px 60px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-100 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-100::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(220deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(14px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-101 {
      position: relative;
      overflow: hidden;
      border-radius: 25px;
      border: 1px solid rgba(255,255,255,0.100);
      background: radial-gradient(420px circle at 51% 0%, rgba(255,255,255,0.050), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 19px 61px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-101 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-101::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(221deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(15px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-102 {
      position: relative;
      overflow: hidden;
      border-radius: 26px;
      border: 1px solid rgba(255,255,255,0.110);
      background: radial-gradient(420px circle at 52% 0%, rgba(255,255,255,0.060), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 62px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-102 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-102::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(222deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(16px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-103 {
      position: relative;
      overflow: hidden;
      border-radius: 27px;
      border: 1px solid rgba(255,255,255,0.120);
      background: radial-gradient(420px circle at 53% 0%, rgba(255,255,255,0.070), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 21px 63px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-103 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-103::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(223deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(17px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-104 {
      position: relative;
      overflow: hidden;
      border-radius: 28px;
      border: 1px solid rgba(255,255,255,0.130);
      background: radial-gradient(420px circle at 54% 0%, rgba(255,255,255,0.080), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 64px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-104 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-104::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(224deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(18px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-105 {
      position: relative;
      overflow: hidden;
      border-radius: 29px;
      border: 1px solid rgba(255,255,255,0.140);
      background: radial-gradient(420px circle at 55% 0%, rgba(255,255,255,0.090), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 23px 65px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-105 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-105::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(225deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(19px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-106 {
      position: relative;
      overflow: hidden;
      border-radius: 30px;
      border: 1px solid rgba(255,255,255,0.150);
      background: radial-gradient(420px circle at 56% 0%, rgba(255,255,255,0.100), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 66px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-106 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-106::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(226deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(20px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-107 {
      position: relative;
      overflow: hidden;
      border-radius: 31px;
      border: 1px solid rgba(255,255,255,0.160);
      background: radial-gradient(420px circle at 57% 0%, rgba(255,255,255,0.110), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 25px 67px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-107 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-107::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(227deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(21px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-108 {
      position: relative;
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.170);
      background: radial-gradient(420px circle at 58% 0%, rgba(255,255,255,0.120), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 26px 68px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-108 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-108::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(228deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(22px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-109 {
      position: relative;
      overflow: hidden;
      border-radius: 15px;
      border: 1px solid rgba(255,255,255,0.180);
      background: radial-gradient(420px circle at 59% 0%, rgba(255,255,255,0.130), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 27px 69px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-109 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-109::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(229deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(23px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-110 {
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.190);
      background: radial-gradient(420px circle at 60% 0%, rgba(255,255,255,0.140), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 28px 70px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-110 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-110::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(230deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(24px);
      opacity: 0.12;
      pointer-events: none;
    }
    .v19-depth-card-111 {
      position: relative;
      overflow: hidden;
      border-radius: 17px;
      border: 1px solid rgba(255,255,255,0.200);
      background: radial-gradient(420px circle at 61% 0%, rgba(255,255,255,0.150), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 29px 71px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-111 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-111::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(231deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(25px);
      opacity: 0.13;
      pointer-events: none;
    }
    .v19-depth-card-112 {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.210);
      background: radial-gradient(420px circle at 62% 0%, rgba(255,255,255,0.160), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 16px 72px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-112 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-112::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(232deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(26px);
      opacity: 0.14;
      pointer-events: none;
    }
    .v19-depth-card-113 {
      position: relative;
      overflow: hidden;
      border-radius: 19px;
      border: 1px solid rgba(255,255,255,0.220);
      background: radial-gradient(420px circle at 63% 0%, rgba(255,255,255,0.170), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 17px 73px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-113 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-113::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(233deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(27px);
      opacity: 0.15;
      pointer-events: none;
    }
    .v19-depth-card-114 {
      position: relative;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.230);
      background: radial-gradient(420px circle at 64% 0%, rgba(255,255,255,0.180), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 18px 74px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-114 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-114::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(234deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(28px);
      opacity: 0.16;
      pointer-events: none;
    }
    .v19-depth-card-115 {
      position: relative;
      overflow: hidden;
      border-radius: 21px;
      border: 1px solid rgba(255,255,255,0.240);
      background: radial-gradient(420px circle at 65% 0%, rgba(255,255,255,0.190), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 19px 75px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-115 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-115::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(235deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(29px);
      opacity: 0.17;
      pointer-events: none;
    }
    .v19-depth-card-116 {
      position: relative;
      overflow: hidden;
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.250);
      background: radial-gradient(420px circle at 66% 0%, rgba(255,255,255,0.200), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 76px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-116 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-116::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(236deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(30px);
      opacity: 0.18;
      pointer-events: none;
    }
    .v19-depth-card-117 {
      position: relative;
      overflow: hidden;
      border-radius: 23px;
      border: 1px solid rgba(255,255,255,0.260);
      background: radial-gradient(420px circle at 67% 0%, rgba(255,255,255,0.210), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 21px 77px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-117 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-117::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(237deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(31px);
      opacity: 0.19;
      pointer-events: none;
    }
    .v19-depth-card-118 {
      position: relative;
      overflow: hidden;
      border-radius: 24px;
      border: 1px solid rgba(255,255,255,0.270);
      background: radial-gradient(420px circle at 68% 0%, rgba(255,255,255,0.220), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 78px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-118 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-118::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(238deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(32px);
      opacity: 0.20;
      pointer-events: none;
    }
    .v19-depth-card-119 {
      position: relative;
      overflow: hidden;
      border-radius: 25px;
      border: 1px solid rgba(255,255,255,0.280);
      background: radial-gradient(420px circle at 69% 0%, rgba(255,255,255,0.230), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 23px 79px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-119 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-119::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(239deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(33px);
      opacity: 0.21;
      pointer-events: none;
    }
    .v19-depth-card-120 {
      position: relative;
      overflow: hidden;
      border-radius: 26px;
      border: 1px solid rgba(255,255,255,0.090);
      background: radial-gradient(420px circle at 10% 0%, rgba(255,255,255,0.040), transparent 48%), rgba(255,255,255,.045);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 40px rgba(0,0,0,.28);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .v19-glow-accent-120 {
      position: relative;
      isolation: isolate;
    }
    .v19-glow-accent-120::before {
      content: "";
      position: absolute;
      inset: -1px;
      z-index: -1;
      border-radius: inherit;
      background: linear-gradient(240deg, rgba(124,92,255,.45), rgba(255,79,216,.16), rgba(53,215,255,.32));
      filter: blur(10px);
      opacity: 0.12;
      pointer-events: none;
    }


    .btn.is-pressing {
      transform: scale(.975);
      filter: brightness(1.08) saturate(1.05);
    }


    /* ============================================================
       v20 OBVIOUS REDESIGN — bold visible homepage upgrade
       ============================================================ */

    .v20-hero-badge-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 22px;
    }

    .v20-mini-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255,255,255,.075);
      border: 1px solid rgba(255,255,255,.13);
      color: rgba(255,255,255,.72);
      font-size: 12px;
      font-weight: 900;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 14px 42px rgba(0,0,0,.24);
    }

    .v20-showcase {
      position: relative;
      margin-top: -12px;
      padding: 34px;
      border-radius: 46px;
      overflow: hidden;
      background:
        radial-gradient(900px circle at 12% 0%, rgba(124,92,255,.34), transparent 46%),
        radial-gradient(900px circle at 92% 20%, rgba(53,215,255,.22), transparent 44%),
        linear-gradient(135deg, rgba(255,255,255,.12), rgba(255,255,255,.045));
      border: 1px solid rgba(255,255,255,.16);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.12),
        0 34px 120px rgba(0,0,0,.42),
        0 0 90px rgba(124,92,255,.12);
    }

    .v20-showcase::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: .22;
      background:
        linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px),
        linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px);
      background-size: 42px 42px;
      mask-image: radial-gradient(circle at 50% 35%, black, transparent 78%);
    }

    .v20-showcase::after {
      content: "";
      position: absolute;
      left: 6%;
      right: 6%;
      top: 50%;
      height: 3px;
      border-radius: 999px;
      background: linear-gradient(90deg, transparent, rgba(73,230,165,.9), rgba(53,215,255,.85), rgba(255,79,216,.65), transparent);
      box-shadow: 0 0 34px rgba(53,215,255,.32);
      opacity: .84;
      transform: rotate(-2deg);
    }

    .v20-showcase-grid {
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: 1fr .82fr 1fr;
      gap: 18px;
      align-items: center;
    }

    .v20-big-panel {
      min-height: 360px;
      padding: 28px;
      border-radius: 34px;
      background:
        radial-gradient(500px circle at 18% 0%, rgba(255,255,255,.13), transparent 44%),
        rgba(0,0,0,.20);
      border: 1px solid rgba(255,255,255,.13);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 24px 80px rgba(0,0,0,.28);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }

    .v20-panel-label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: rgba(255,255,255,.58);
      font-size: 11px;
      font-weight: 950;
      text-transform: uppercase;
      letter-spacing: .16em;
    }

    .v20-panel-title {
      margin-top: 20px;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: clamp(34px, 3.2vw, 58px);
      line-height: .92;
      letter-spacing: -.065em;
      font-weight: 900;
    }

    .v20-panel-copy {
      margin-top: 18px;
      color: rgba(255,255,255,.63);
      font-size: 15px;
      line-height: 1.75;
    }

    .v20-before-list,
    .v20-after-list {
      display: grid;
      gap: 10px;
      margin-top: 22px;
      list-style: none;
    }

    .v20-before-list li,
    .v20-after-list li {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 42px;
      padding: 10px 12px;
      border-radius: 16px;
      background: rgba(255,255,255,.055);
      border: 1px solid rgba(255,255,255,.08);
      color: rgba(255,255,255,.72);
      font-size: 13px;
      font-weight: 800;
    }

    .v20-before-list li span {
      color: #ff8a8a;
    }

    .v20-after-list li span {
      color: var(--green);
    }

    .v20-center-stack {
      display: grid;
      gap: 14px;
    }

    .v20-route-card {
      position: relative;
      min-height: 170px;
      padding: 20px;
      border-radius: 30px;
      background:
        radial-gradient(420px circle at 50% 0%, rgba(124,92,255,.22), transparent 50%),
        linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,.052));
      border: 1px solid rgba(255,255,255,.16);
      box-shadow: 0 26px 90px rgba(0,0,0,.32);
      text-align: center;
      overflow: hidden;
    }

    .v20-route-card::before {
      content: "";
      position: absolute;
      inset: 16px;
      border-radius: 24px;
      border: 1px dashed rgba(255,255,255,.18);
    }

    .v20-route-icon {
      position: relative;
      z-index: 2;
      display: grid;
      place-items: center;
      width: 72px;
      height: 72px;
      margin: 0 auto 12px;
      border-radius: 26px;
      background: white;
      color: #070a12;
      font-size: 34px;
      box-shadow: 0 20px 58px rgba(255,255,255,.12), 0 0 70px rgba(124,92,255,.24);
    }

    .v20-route-card strong {
      position: relative;
      z-index: 2;
      display: block;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 28px;
      line-height: .95;
      letter-spacing: -.055em;
    }

    .v20-route-card small {
      position: relative;
      z-index: 2;
      display: block;
      margin-top: 8px;
      color: rgba(255,255,255,.52);
      font-size: 12px;
      font-weight: 850;
    }

    .v20-floating-tile-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .v20-floating-tile {
      min-height: 112px;
      padding: 16px;
      border-radius: 24px;
      background: rgba(255,255,255,.075);
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.075), 0 18px 58px rgba(0,0,0,.24);
    }

    .v20-floating-tile b {
      display: block;
      font-size: 24px;
      line-height: 1;
    }

    .v20-floating-tile strong {
      display: block;
      margin-top: 12px;
      color: white;
      font-size: 14px;
      line-height: 1.15;
      letter-spacing: -.025em;
    }

    .v20-floating-tile span {
      display: block;
      margin-top: 6px;
      color: rgba(255,255,255,.48);
      font-size: 11px;
      line-height: 1.4;
      font-weight: 750;
    }

    .v20-homepage-strip {
      position: relative;
      overflow: hidden;
      margin-top: 20px;
      padding: 22px;
      border-radius: 34px;
      background:
        linear-gradient(135deg, rgba(124,92,255,.18), rgba(255,79,216,.10), rgba(53,215,255,.14)),
        rgba(255,255,255,.055);
      border: 1px solid rgba(255,255,255,.13);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 80px rgba(0,0,0,.26);
    }

    .v20-strip-track {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }

    .v20-strip-item {
      padding: 18px;
      border-radius: 22px;
      background: rgba(0,0,0,.18);
      border: 1px solid rgba(255,255,255,.08);
    }

    .v20-strip-item b {
      display: block;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 30px;
      letter-spacing: -.06em;
    }

    .v20-strip-item span {
      display: block;
      margin-top: 8px;
      color: rgba(255,255,255,.55);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.4;
    }

    .v20-hero-art {
      position: absolute;
      right: -60px;
      top: -70px;
      width: 240px;
      height: 240px;
      border-radius: 70px;
      background:
        radial-gradient(circle at 30% 20%, rgba(255,255,255,.22), transparent 24%),
        linear-gradient(135deg, rgba(124,92,255,.42), rgba(255,79,216,.24), rgba(53,215,255,.28));
      filter: blur(.2px);
      opacity: .55;
      transform: rotate(18deg);
      pointer-events: none;
    }

    .v20-hero-art::before {
      content: "🛒";
      position: absolute;
      display: grid;
      place-items: center;
      inset: 52px;
      border-radius: 38px;
      background: rgba(255,255,255,.12);
      border: 1px solid rgba(255,255,255,.14);
      font-size: 54px;
      transform: rotate(-18deg);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }

    .hero .reveal:first-child {
      position: relative;
      z-index: 3;
    }

    .hero .reveal:first-child::before {
      content: "";
      position: absolute;
      left: -34px;
      top: -30px;
      width: 150px;
      height: 150px;
      z-index: -1;
      border-radius: 44px;
      background: linear-gradient(135deg, rgba(124,92,255,.26), rgba(53,215,255,.12));
      filter: blur(22px);
      opacity: .85;
    }

    @media (min-width: 1440px) {
      .v20-showcase {
        padding: 44px;
      }

      .v20-big-panel {
        min-height: 420px;
        padding: 34px;
      }

      .v20-route-card {
        min-height: 205px;
      }

      .v20-route-icon {
        width: 86px;
        height: 86px;
        border-radius: 30px;
        font-size: 42px;
      }

      .v20-floating-tile {
        min-height: 138px;
        padding: 20px;
      }
    }

    @media (max-width: 1050px) {
      .v20-showcase-grid {
        grid-template-columns: 1fr;
      }

      .v20-big-panel {
        min-height: auto;
      }

      .v20-showcase::after {
        top: 42%;
        transform: rotate(0deg);
      }

      .v20-strip-track {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 620px) {
      .v20-showcase {
        padding: 16px;
        border-radius: 28px;
      }

      .v20-showcase-grid {
        gap: 12px;
      }

      .v20-big-panel {
        padding: 18px;
        border-radius: 24px;
      }

      .v20-panel-title {
        font-size: 34px;
      }

      .v20-floating-tile-grid {
        grid-template-columns: 1fr;
      }

      .v20-strip-track {
        grid-template-columns: 1fr;
      }

      .v20-homepage-strip {
        padding: 14px;
        border-radius: 26px;
      }

      .v20-hero-art {
        display: none;
      }

      .v20-hero-badge-row {
        gap: 8px;
      }

      .v20-mini-badge {
        min-height: 32px;
        font-size: 11px;
      }
    }


    /* ============================================================
       v21 Audio + Music Controls
       ============================================================ */

    .audioDock {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 1700;
      display: grid;
      gap: 10px;
      justify-items: end;
      pointer-events: none;
    }

    .audioDockPanel {
      display: none;
      width: min(340px, calc(100vw - 28px));
      padding: 14px;
      border-radius: 24px;
      background:
        radial-gradient(420px circle at 10% 0%, rgba(124,92,255,.18), transparent 46%),
        rgba(7,10,18,.88);
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 24px 80px rgba(0,0,0,.46), inset 0 1px 0 rgba(255,255,255,.09);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      pointer-events: auto;
    }

    .audioDock.open .audioDockPanel {
      display: block;
      animation: audioPanelIn .18s ease both;
    }

    @keyframes audioPanelIn {
      from {
        opacity: 0;
        transform: translateY(8px) scale(.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .audioDockTitle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .audioDockTitle strong {
      display: block;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 20px;
      line-height: 1;
      letter-spacing: -.045em;
    }

    .audioDockTitle span {
      display: block;
      margin-top: 3px;
      color: rgba(255,255,255,.48);
      font-size: 12px;
      font-weight: 800;
    }

    .audioNowPlaying {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 13px;
      padding: 12px;
      border-radius: 18px;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.09);
    }

    .audioBars {
      display: inline-flex;
      align-items: end;
      gap: 3px;
      width: 32px;
      height: 28px;
    }

    .audioBars i {
      display: block;
      width: 5px;
      min-height: 6px;
      border-radius: 999px;
      background: linear-gradient(180deg, var(--cyan), var(--purple));
      opacity: .45;
      animation: audioBarIdle 1.2s ease-in-out infinite;
    }

    .audioBars i:nth-child(2) {
      animation-delay: -.2s;
    }

    .audioBars i:nth-child(3) {
      animation-delay: -.4s;
    }

    .audioBars i:nth-child(4) {
      animation-delay: -.6s;
    }

    .audioDock.playing .audioBars i {
      opacity: 1;
      animation-name: audioBarLive;
    }

    @keyframes audioBarIdle {
      0%, 100% { height: 8px; }
      50% { height: 14px; }
    }

    @keyframes audioBarLive {
      0%, 100% { height: 8px; }
      35% { height: 26px; }
      70% { height: 15px; }
    }

    .audioNowText strong {
      display: block;
      color: rgba(255,255,255,.88);
      font-size: 13px;
      font-weight: 900;
    }

    .audioNowText span {
      display: block;
      margin-top: 3px;
      color: rgba(255,255,255,.45);
      font-size: 12px;
      line-height: 1.35;
    }

    .audioControls {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 9px;
      margin-top: 12px;
    }

    .audioSmallBtn {
      min-height: 42px;
      padding: 10px 12px;
      border: 0;
      border-radius: 15px;
      color: white;
      background: rgba(255,255,255,.075);
      border: 1px solid rgba(255,255,255,.11);
      font-size: 12px;
      font-weight: 900;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
    }

    .audioSmallBtn:hover {
      background: rgba(255,255,255,.11);
    }

    .audioSmallBtn.active {
      background: linear-gradient(135deg, rgba(124,92,255,.65), rgba(53,215,255,.28));
      border-color: rgba(255,255,255,.18);
    }

    .audioRangeWrap {
      margin-top: 12px;
      padding: 12px;
      border-radius: 18px;
      background: rgba(0,0,0,.18);
      border: 1px solid rgba(255,255,255,.08);
    }

    .audioRangeTop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
      color: rgba(255,255,255,.54);
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: .12em;
    }

    .audioRange {
      width: 100%;
      accent-color: #7c5cff;
    }

    .audioMainButton {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      min-height: 54px;
      padding: 14px 18px;
      border: 0;
      border-radius: 22px;
      color: white;
      background:
        radial-gradient(160px circle at 20% 0%, rgba(255,255,255,.20), transparent 45%),
        linear-gradient(135deg, rgba(124,92,255,.94), rgba(255,79,216,.65), rgba(53,215,255,.72));
      box-shadow:
        0 20px 64px rgba(124,92,255,.34),
        inset 0 1px 0 rgba(255,255,255,.18);
      font-size: 14px;
      font-weight: 950;
      letter-spacing: -.02em;
    }

    .audioMainButton span {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 10px;
      background: rgba(255,255,255,.16);
    }

    .audioMainButton:active {
      transform: scale(.97);
    }

    .audioHint {
      margin-top: 10px;
      color: rgba(255,255,255,.38);
      font-size: 11px;
      line-height: 1.45;
      font-weight: 750;
    }

    body.audio-sfx-on .btn:active,
    body.audio-sfx-on .card:active,
    body.audio-sfx-on .hubCard:active {
      filter: brightness(1.05);
    }

    @media (max-width: 720px) {
      .audioDock {
        right: 12px;
        left: 12px;
        bottom: calc(88px + var(--safe-bottom));
        justify-items: end;
      }

      .audioDockPanel {
        width: 100%;
      }

      .audioMainButton {
        min-height: 48px;
        padding: 12px 14px;
        border-radius: 18px;
      }

      .audioDock.open {
        z-index: 1800;
      }
    }


    /* ============================================================
       v22 Sensory Experience Layer
       sound + haptics + voice + mood + celebration
       ============================================================ */

    body.vibe-twilight {
      --v22-a: rgba(124,92,255,.38);
      --v22-b: rgba(255,79,216,.20);
      --v22-c: rgba(53,215,255,.16);
    }

    body.vibe-ocean {
      --v22-a: rgba(53,215,255,.34);
      --v22-b: rgba(22,140,255,.20);
      --v22-c: rgba(73,230,165,.14);
    }

    body.vibe-fresh {
      --v22-a: rgba(73,230,165,.28);
      --v22-b: rgba(53,215,255,.18);
      --v22-c: rgba(255,248,239,.10);
    }

    body.vibe-night {
      --v22-a: rgba(74,63,180,.30);
      --v22-b: rgba(28,42,90,.22);
      --v22-c: rgba(3,8,19,.32);
    }

    body.vibe-twilight,
    body.vibe-ocean,
    body.vibe-fresh,
    body.vibe-night {
      background:
        radial-gradient(1000px circle at 12% -8%, var(--v22-a), transparent 45%),
        radial-gradient(900px circle at 96% 8%, var(--v22-b), transparent 42%),
        radial-gradient(800px circle at 50% 108%, var(--v22-c), transparent 52%),
        linear-gradient(180deg, #050711 0%, #090f1e 45%, #050711 100%) !important;
    }

    body.v22-reduced-sensory * {
      animation-duration: .001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .001ms !important;
      scroll-behavior: auto !important;
    }

    .sensoryDock {
      position: fixed;
      left: 18px;
      bottom: 18px;
      z-index: 1701;
      display: grid;
      gap: 10px;
      pointer-events: none;
    }

    .sensoryButton {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      min-height: 54px;
      padding: 14px 18px;
      border: 0;
      border-radius: 22px;
      color: white;
      background:
        radial-gradient(170px circle at 20% 0%, rgba(255,255,255,.18), transparent 45%),
        linear-gradient(135deg, rgba(53,215,255,.82), rgba(124,92,255,.84), rgba(255,79,216,.52));
      box-shadow:
        0 20px 64px rgba(53,215,255,.18),
        0 12px 42px rgba(124,92,255,.25),
        inset 0 1px 0 rgba(255,255,255,.18);
      font-size: 14px;
      font-weight: 950;
      letter-spacing: -.02em;
    }

    .sensoryButton span {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 10px;
      background: rgba(255,255,255,.15);
    }

    .sensoryPanel {
      display: none;
      width: min(360px, calc(100vw - 28px));
      padding: 15px;
      border-radius: 26px;
      background:
        radial-gradient(440px circle at 0% 0%, rgba(53,215,255,.16), transparent 48%),
        radial-gradient(440px circle at 100% 0%, rgba(124,92,255,.16), transparent 48%),
        rgba(7,10,18,.90);
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 26px 86px rgba(0,0,0,.48), inset 0 1px 0 rgba(255,255,255,.09);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      pointer-events: auto;
    }

    .sensoryDock.open .sensoryPanel {
      display: block;
      animation: sensoryPanelIn .18s ease both;
    }

    @keyframes sensoryPanelIn {
      from {
        opacity: 0;
        transform: translateY(8px) scale(.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .sensoryTitle {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .sensoryTitle strong {
      display: block;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 22px;
      line-height: .95;
      letter-spacing: -.05em;
    }

    .sensoryTitle span {
      display: block;
      margin-top: 4px;
      color: rgba(255,255,255,.48);
      font-size: 12px;
      line-height: 1.35;
      font-weight: 800;
    }

    .sensoryGrid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 9px;
      margin-top: 14px;
    }

    .sensoryOption {
      min-height: 72px;
      padding: 12px;
      border: 0;
      border-radius: 18px;
      color: white;
      text-align: left;
      background: rgba(255,255,255,.065);
      border: 1px solid rgba(255,255,255,.10);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
    }

    .sensoryOption b {
      display: block;
      font-size: 19px;
      line-height: 1;
    }

    .sensoryOption strong {
      display: block;
      margin-top: 9px;
      font-size: 12px;
      font-weight: 950;
    }

    .sensoryOption span {
      display: block;
      margin-top: 3px;
      color: rgba(255,255,255,.44);
      font-size: 10.5px;
      line-height: 1.25;
      font-weight: 750;
    }

    .sensoryOption.active {
      background: linear-gradient(135deg, rgba(124,92,255,.55), rgba(53,215,255,.18));
      border-color: rgba(255,255,255,.20);
      box-shadow: 0 14px 44px rgba(124,92,255,.20), inset 0 1px 0 rgba(255,255,255,.12);
    }

    .sensoryActions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 9px;
      margin-top: 12px;
    }

    .sensoryMiniButton {
      min-height: 42px;
      padding: 10px 12px;
      border: 0;
      border-radius: 15px;
      color: white;
      background: rgba(255,255,255,.075);
      border: 1px solid rgba(255,255,255,.11);
      font-size: 12px;
      font-weight: 900;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
    }

    .sensoryMiniButton.active {
      background: linear-gradient(135deg, rgba(73,230,165,.22), rgba(53,215,255,.20));
      border-color: rgba(73,230,165,.26);
    }

    .sensoryHint {
      margin-top: 11px;
      color: rgba(255,255,255,.40);
      font-size: 11px;
      line-height: 1.45;
      font-weight: 750;
    }

    .v22-confetti-layer {
      position: fixed;
      inset: 0;
      z-index: 2200;
      pointer-events: none;
      overflow: hidden;
    }

    .v22-confetti {
      position: absolute;
      top: -24px;
      width: 10px;
      height: 16px;
      border-radius: 4px;
      opacity: .95;
      animation: v22ConfettiFall 1300ms ease-out forwards;
    }

    @keyframes v22ConfettiFall {
      0% {
        transform: translate3d(0, -20px, 0) rotate(0deg);
        opacity: 1;
      }
      100% {
        transform: translate3d(var(--x), 110vh, 0) rotate(540deg);
        opacity: 0;
      }
    }

    .v22-sense-toast {
      position: fixed;
      left: 50%;
      bottom: calc(110px + var(--safe-bottom, 0px));
      z-index: 2300;
      transform: translateX(-50%) translateY(20px) scale(.96);
      opacity: 0;
      max-width: min(360px, calc(100vw - 24px));
      padding: 13px 16px;
      border-radius: 999px;
      color: white;
      background: rgba(7,10,18,.88);
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 22px 72px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.08);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      font-size: 13px;
      font-weight: 900;
      text-align: center;
      pointer-events: none;
      transition: opacity .18s ease, transform .18s ease;
    }

    .v22-sense-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }

    body.v22-haptics-on .btn:active,
    body.v22-haptics-on .sensoryOption:active,
    body.v22-haptics-on .sensoryButton:active {
      transform: scale(.97);
      filter: brightness(1.08);
    }

    body.v22-celebrate .heroTitle {
      animation: v22HeroCelebrate 700ms ease both;
    }

    @keyframes v22HeroCelebrate {
      0%, 100% {
        filter: brightness(1);
      }
      50% {
        filter: brightness(1.25) saturate(1.18);
      }
    }

    .v22-breathe {
      animation: v22Breathe 5.5s ease-in-out infinite;
    }

    @keyframes v22Breathe {
      0%, 100% {
        box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 70px rgba(0,0,0,.30);
      }
      50% {
        box-shadow: inset 0 1px 0 rgba(255,255,255,.11), 0 26px 90px rgba(0,0,0,.36), 0 0 56px rgba(124,92,255,.12);
      }
    }

    @media (max-width: 720px) {
      .sensoryDock {
        left: 12px;
        right: auto;
        bottom: calc(88px + var(--safe-bottom));
      }

      .sensoryPanel {
        width: min(360px, calc(100vw - 24px));
        max-height: 72svh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }

      .sensoryButton {
        min-height: 48px;
        padding: 12px 14px;
        border-radius: 18px;
      }

      .sensoryGrid {
        grid-template-columns: 1fr;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .v22-confetti,
      .v22-breathe,
      body.v22-celebrate .heroTitle {
        animation: none !important;
      }
    }


    /* ============================================================
       v23 Full Theme Engine
       Themes now change the whole design, not just the background.
       ============================================================ */

    body.vibe-twilight {
      --theme-bg-1:#050711;
      --theme-bg-2:#090f1e;
      --theme-surface:rgba(255,255,255,.078);
      --theme-line:rgba(255,255,255,.14);
      --theme-line-2:rgba(255,255,255,.22);
      --theme-text:#f8fafc;
      --theme-muted:rgba(248,250,252,.66);
      --theme-a:#7c5cff;
      --theme-b:#ff4fd8;
      --theme-c:#35d7ff;
      --theme-good:#49e6a5;
      --theme-radius:28px;
      --theme-radius-lg:44px;
      --theme-shadow:0 28px 92px rgba(0,0,0,.42);
      --theme-card:radial-gradient(520px circle at 20% 0%,rgba(255,255,255,.08),transparent 46%),linear-gradient(180deg,rgba(255,255,255,.095),rgba(255,255,255,.04));
      --theme-btn:linear-gradient(135deg,#7c5cff 0%,#ff4fd8 58%,#35d7ff 125%);
      --theme-title:linear-gradient(90deg,#fff 0%,#c9c0ff 24%,#ff7be8 52%,#68e4ff 80%,#fff 100%);
    }

    body.vibe-ocean {
      --theme-bg-1:#02111f;
      --theme-bg-2:#06243d;
      --theme-surface:rgba(34,211,238,.088);
      --theme-line:rgba(125,211,252,.19);
      --theme-line-2:rgba(186,230,253,.32);
      --theme-text:#effaff;
      --theme-muted:rgba(239,250,255,.70);
      --theme-a:#0ea5e9;
      --theme-b:#22d3ee;
      --theme-c:#67e8f9;
      --theme-good:#5eead4;
      --theme-radius:36px;
      --theme-radius-lg:60px;
      --theme-shadow:0 30px 95px rgba(0,35,70,.48);
      --theme-card:radial-gradient(640px circle at 18% 0%,rgba(34,211,238,.16),transparent 48%),radial-gradient(540px circle at 100% 70%,rgba(14,165,233,.11),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.105),rgba(34,211,238,.035));
      --theme-btn:linear-gradient(135deg,#0284c7 0%,#22d3ee 55%,#67e8f9 125%);
      --theme-title:linear-gradient(90deg,#fff 0%,#bae6fd 24%,#22d3ee 52%,#67e8f9 80%,#fff 100%);
    }

    body.vibe-fresh {
      --theme-bg-1:#06140f;
      --theme-bg-2:#0f2a1d;
      --theme-surface:rgba(236,253,245,.09);
      --theme-line:rgba(167,243,208,.18);
      --theme-line-2:rgba(209,250,229,.30);
      --theme-text:#f4fff9;
      --theme-muted:rgba(244,255,249,.70);
      --theme-a:#10b981;
      --theme-b:#49e6a5;
      --theme-c:#f5d48a;
      --theme-good:#bbf7d0;
      --theme-radius:22px;
      --theme-radius-lg:34px;
      --theme-shadow:0 28px 92px rgba(0,45,28,.44);
      --theme-card:radial-gradient(560px circle at 14% 0%,rgba(73,230,165,.15),transparent 48%),radial-gradient(520px circle at 100% 20%,rgba(245,212,138,.10),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.10),rgba(73,230,165,.035));
      --theme-btn:linear-gradient(135deg,#059669 0%,#49e6a5 62%,#f5d48a 135%);
      --theme-title:linear-gradient(90deg,#fff 0%,#bbf7d0 26%,#49e6a5 52%,#f5d48a 80%,#fff 100%);
    }

    body.vibe-night {
      --theme-bg-1:#02030a;
      --theme-bg-2:#070b16;
      --theme-surface:rgba(148,163,184,.065);
      --theme-line:rgba(148,163,184,.13);
      --theme-line-2:rgba(191,219,254,.22);
      --theme-text:#f8fafc;
      --theme-muted:rgba(226,232,240,.62);
      --theme-a:#3b82f6;
      --theme-b:#6366f1;
      --theme-c:#94a3b8;
      --theme-good:#93c5fd;
      --theme-radius:14px;
      --theme-radius-lg:22px;
      --theme-shadow:0 26px 90px rgba(0,0,0,.62);
      --theme-card:linear-gradient(180deg,rgba(148,163,184,.085),rgba(15,23,42,.52));
      --theme-btn:linear-gradient(135deg,#1d4ed8 0%,#4f46e5 60%,#94a3b8 140%);
      --theme-title:linear-gradient(90deg,#fff 0%,#bfdbfe 30%,#60a5fa 56%,#cbd5e1 82%,#fff 100%);
    }

    body.vibe-twilight,
    body.vibe-ocean,
    body.vibe-fresh,
    body.vibe-night {
      color:var(--theme-text)!important;
      background:
        radial-gradient(1100px circle at 10% -10%,color-mix(in srgb,var(--theme-a) 38%,transparent),transparent 45%),
        radial-gradient(900px circle at 96% 8%,color-mix(in srgb,var(--theme-b) 25%,transparent),transparent 42%),
        radial-gradient(780px circle at 50% 108%,color-mix(in srgb,var(--theme-c) 18%,transparent),transparent 52%),
        linear-gradient(180deg,var(--theme-bg-1),var(--theme-bg-2) 46%,var(--theme-bg-1))!important;
    }

    body.vibe-ocean::before{background-size:84px 42px!important;opacity:.42;transform:skewY(-3deg)}
    body.vibe-fresh::before{background-size:76px 76px!important;opacity:.38}
    body.vibe-night::before{background-size:92px 92px!important;opacity:.24;filter:contrast(1.35)}

    body.vibe-ocean .header,body.vibe-ocean .mobileAppTop{background:rgba(2,17,31,.80)!important;border-bottom-color:rgba(125,211,252,.16)!important}
    body.vibe-fresh .header,body.vibe-fresh .mobileAppTop{background:rgba(6,20,15,.80)!important;border-bottom-color:rgba(167,243,208,.16)!important}
    body.vibe-night .header,body.vibe-night .mobileAppTop{background:rgba(2,3,10,.88)!important;border-bottom-color:rgba(148,163,184,.13)!important}

    body.vibe-twilight .glass,body.vibe-twilight .soft,body.vibe-twilight .card,body.vibe-twilight .formBox,body.vibe-twilight .hubCard,body.vibe-twilight .final,body.vibe-twilight .device,body.vibe-twilight .screen,body.vibe-twilight .estimateResult,
    body.vibe-ocean .glass,body.vibe-ocean .soft,body.vibe-ocean .card,body.vibe-ocean .formBox,body.vibe-ocean .hubCard,body.vibe-ocean .final,body.vibe-ocean .device,body.vibe-ocean .screen,body.vibe-ocean .estimateResult,
    body.vibe-fresh .glass,body.vibe-fresh .soft,body.vibe-fresh .card,body.vibe-fresh .formBox,body.vibe-fresh .hubCard,body.vibe-fresh .final,body.vibe-fresh .device,body.vibe-fresh .screen,body.vibe-fresh .estimateResult,
    body.vibe-night .glass,body.vibe-night .soft,body.vibe-night .card,body.vibe-night .formBox,body.vibe-night .hubCard,body.vibe-night .final,body.vibe-night .device,body.vibe-night .screen,body.vibe-night .estimateResult{
      background:var(--theme-card)!important;
      border-color:var(--theme-line)!important;
      border-radius:var(--theme-radius)!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.09),var(--theme-shadow),0 0 74px color-mix(in srgb,var(--theme-a) 18%,transparent)!important;
    }

    body.vibe-ocean .card,body.vibe-ocean .hubCard,body.vibe-ocean .formBox{backdrop-filter:blur(28px) saturate(1.32)!important;-webkit-backdrop-filter:blur(28px) saturate(1.32)!important}
    body.vibe-fresh .card,body.vibe-fresh .hubCard,body.vibe-fresh .formBox{backdrop-filter:blur(18px) saturate(1.18)!important;-webkit-backdrop-filter:blur(18px) saturate(1.18)!important}
    body.vibe-night .card,body.vibe-night .hubCard,body.vibe-night .formBox{backdrop-filter:blur(12px) contrast(1.12)!important;-webkit-backdrop-filter:blur(12px) contrast(1.12)!important}

    body.vibe-ocean .shine,body.vibe-fresh .shine,body.vibe-night .shine,body.vibe-twilight .shine{
      background:var(--theme-title)!important;background-size:220% auto!important;-webkit-background-clip:text!important;background-clip:text!important;color:transparent!important;
    }

    body.vibe-ocean .primary,body.vibe-fresh .primary,body.vibe-night .primary,body.vibe-twilight .primary{
      background:var(--theme-btn)!important;
      box-shadow:0 20px 68px color-mix(in srgb,var(--theme-a) 36%,transparent),inset 0 1px 0 rgba(255,255,255,.22)!important;
    }

    body.vibe-ocean .ghost,body.vibe-fresh .ghost,body.vibe-night .ghost,body.vibe-twilight .ghost{
      background:radial-gradient(220px circle at 30% 0%,color-mix(in srgb,var(--theme-c) 13%,transparent),transparent 48%),var(--theme-surface)!important;
      border-color:var(--theme-line)!important;
    }

    body.vibe-ocean .chip,body.vibe-fresh .chip,body.vibe-night .chip,body.vibe-twilight .chip{
      background:var(--theme-surface)!important;border-color:var(--theme-line)!important;color:var(--theme-muted)!important;
    }

    body.vibe-ocean .logoIcon,body.vibe-ocean .appIcon,body.vibe-ocean .requestIcon{background:linear-gradient(135deg,#effaff,#bae6fd)!important;box-shadow:0 18px 55px rgba(34,211,238,.28),inset 0 1px 0 rgba(255,255,255,.40)!important}
    body.vibe-fresh .logoIcon,body.vibe-fresh .appIcon,body.vibe-fresh .requestIcon{background:linear-gradient(135deg,#f4fff9,#bbf7d0)!important;box-shadow:0 18px 55px rgba(73,230,165,.24),inset 0 1px 0 rgba(255,255,255,.40)!important}
    body.vibe-night .logoIcon,body.vibe-night .appIcon,body.vibe-night .requestIcon{background:linear-gradient(135deg,#f8fafc,#bfdbfe)!important;box-shadow:0 18px 55px rgba(59,130,246,.20),inset 0 1px 0 rgba(255,255,255,.36)!important}

    body.vibe-ocean .sectionTitle::after{background:linear-gradient(90deg,transparent,#22d3ee,#67e8f9,transparent)!important;box-shadow:0 0 32px rgba(34,211,238,.32)!important}
    body.vibe-fresh .sectionTitle::after{background:linear-gradient(90deg,transparent,#49e6a5,#f5d48a,transparent)!important;box-shadow:0 0 32px rgba(73,230,165,.28)!important}
    body.vibe-night .sectionTitle::after{background:linear-gradient(90deg,transparent,#3b82f6,#94a3b8,transparent)!important;box-shadow:0 0 24px rgba(59,130,246,.18)!important}

    body.vibe-ocean .field input,body.vibe-ocean .field select,body.vibe-ocean .field textarea,
    body.vibe-fresh .field input,body.vibe-fresh .field select,body.vibe-fresh .field textarea,
    body.vibe-night .field input,body.vibe-night .field select,body.vibe-night .field textarea{
      background:color-mix(in srgb,var(--theme-surface) 72%,transparent)!important;
      border-color:var(--theme-line)!important;color:var(--theme-text)!important;
    }

    body.vibe-ocean .field input:focus,body.vibe-ocean .field select:focus,body.vibe-ocean .field textarea:focus,
    body.vibe-fresh .field input:focus,body.vibe-fresh .field select:focus,body.vibe-fresh .field textarea:focus,
    body.vibe-night .field input:focus,body.vibe-night .field select:focus,body.vibe-night .field textarea:focus{
      border-color:var(--theme-b)!important;
      box-shadow:0 0 0 4px color-mix(in srgb,var(--theme-a) 22%,transparent),0 0 48px color-mix(in srgb,var(--theme-c) 12%,transparent)!important;
    }

    body.vibe-ocean .appBottomNav,body.vibe-fresh .appBottomNav,body.vibe-night .appBottomNav,body.vibe-twilight .appBottomNav{
      background:color-mix(in srgb,var(--theme-bg-1) 84%,transparent)!important;
      border-color:var(--theme-line)!important;
      box-shadow:0 24px 80px rgba(0,0,0,.52),0 0 44px color-mix(in srgb,var(--theme-a) 16%,transparent)!important;
    }

    body.vibe-ocean .audioDockPanel,body.vibe-ocean .sensoryPanel,body.vibe-fresh .audioDockPanel,body.vibe-fresh .sensoryPanel,body.vibe-night .audioDockPanel,body.vibe-night .sensoryPanel,body.vibe-twilight .audioDockPanel,body.vibe-twilight .sensoryPanel{
      background:radial-gradient(460px circle at 0% 0%,color-mix(in srgb,var(--theme-a) 20%,transparent),transparent 48%),color-mix(in srgb,var(--theme-bg-1) 88%,transparent)!important;
      border-color:var(--theme-line)!important;border-radius:var(--theme-radius)!important;
    }

    body.vibe-ocean .audioMainButton,body.vibe-ocean .sensoryButton,body.vibe-fresh .audioMainButton,body.vibe-fresh .sensoryButton,body.vibe-night .audioMainButton,body.vibe-night .sensoryButton,body.vibe-twilight .audioMainButton,body.vibe-twilight .sensoryButton{
      background:var(--theme-btn)!important;box-shadow:0 20px 64px color-mix(in srgb,var(--theme-a) 32%,transparent),inset 0 1px 0 rgba(255,255,255,.18)!important;
    }

    body.vibe-ocean .v20-showcase{background:radial-gradient(900px circle at 12% 0%,rgba(34,211,238,.30),transparent 46%),radial-gradient(900px circle at 92% 20%,rgba(14,165,233,.20),transparent 44%),linear-gradient(135deg,rgba(255,255,255,.12),rgba(34,211,238,.04))!important;border-radius:58px!important}
    body.vibe-fresh .v20-showcase{background:radial-gradient(900px circle at 12% 0%,rgba(73,230,165,.26),transparent 46%),radial-gradient(900px circle at 92% 20%,rgba(245,212,138,.12),transparent 44%),linear-gradient(135deg,rgba(255,255,255,.12),rgba(73,230,165,.04))!important;border-radius:38px!important}
    body.vibe-night .v20-showcase{background:radial-gradient(900px circle at 12% 0%,rgba(59,130,246,.18),transparent 46%),linear-gradient(135deg,rgba(148,163,184,.10),rgba(15,23,42,.45))!important;border-radius:24px!important}

    body.vibe-ocean .v20-showcase::after{background:linear-gradient(90deg,transparent,rgba(34,211,238,.95),rgba(103,232,249,.85),transparent)!important}
    body.vibe-fresh .v20-showcase::after{background:linear-gradient(90deg,transparent,rgba(73,230,165,.95),rgba(245,212,138,.78),transparent)!important}
    body.vibe-night .v20-showcase::after{background:linear-gradient(90deg,transparent,rgba(59,130,246,.72),rgba(148,163,184,.55),transparent)!important}

    body.vibe-ocean .personalHero,body.vibe-fresh .personalHero,body.vibe-night .personalHero{background:var(--theme-card)!important;border-color:var(--theme-line)!important;border-radius:var(--theme-radius-lg)!important}
    body.vibe-ocean .v22-sense-toast,body.vibe-fresh .v22-sense-toast,body.vibe-night .v22-sense-toast,body.vibe-twilight .v22-sense-toast{
      background:color-mix(in srgb,var(--theme-bg-1) 88%,transparent)!important;border-color:var(--theme-line)!important;
      box-shadow:0 22px 72px rgba(0,0,0,.42),0 0 44px color-mix(in srgb,var(--theme-a) 18%,transparent)!important;
    }

    body.vibe-ocean .sensoryOption.active,body.vibe-fresh .sensoryOption.active,body.vibe-night .sensoryOption.active,body.vibe-twilight .sensoryOption.active{
      background:linear-gradient(135deg,color-mix(in srgb,var(--theme-a) 52%,transparent),color-mix(in srgb,var(--theme-c) 18%,transparent))!important;
      border-color:var(--theme-line-2)!important;
    }

    body.vibe-ocean .btn,body.vibe-ocean .chip,body.vibe-ocean .field input,body.vibe-ocean .field select{border-radius:999px!important}
    body.vibe-ocean .field textarea{border-radius:28px!important}
    body.vibe-fresh .btn,body.vibe-fresh .chip{border-radius:18px!important}
    body.vibe-night .btn,body.vibe-night .chip,body.vibe-night .field input,body.vibe-night .field select,body.vibe-night .field textarea{border-radius:10px!important}
    body.vibe-night .card,body.vibe-night .hubCard,body.vibe-night .formBox,body.vibe-night .final,body.vibe-night .v20-showcase,body.vibe-night .v20-big-panel,body.vibe-night .v20-route-card{border-radius:18px!important}

    body.vibe-ocean .v19-floating-icons span,body.vibe-ocean .safeFloatDecor span{border-radius:999px!important;color:rgba(186,230,253,.72)!important;border-color:rgba(125,211,252,.18)!important}
    body.vibe-fresh .v19-floating-icons span,body.vibe-fresh .safeFloatDecor span{color:rgba(209,250,229,.72)!important;border-color:rgba(167,243,208,.18)!important}
    body.vibe-night .v19-floating-icons span,body.vibe-night .safeFloatDecor span{opacity:.36!important;color:rgba(191,219,254,.48)!important;border-color:rgba(148,163,184,.12)!important}

    @media(max-width:720px){
      body.vibe-ocean .card,body.vibe-ocean .hubCard,body.vibe-ocean .formBox{border-radius:30px!important}
      body.vibe-fresh .card,body.vibe-fresh .hubCard,body.vibe-fresh .formBox{border-radius:24px!important}
      body.vibe-night .card,body.vibe-night .hubCard,body.vibe-night .formBox{border-radius:16px!important}
    }


    /* ============================================================
       v24 Expanded Theme Studio
       More themes + deeper design details per theme.
       ============================================================ */

    body.vibe-luxury {
      --theme-bg-1:#050403;
      --theme-bg-2:#15100a;
      --theme-surface:rgba(255,222,138,.075);
      --theme-line:rgba(255,222,138,.18);
      --theme-line-2:rgba(255,241,190,.32);
      --theme-text:#fff9ed;
      --theme-muted:rgba(255,249,237,.68);
      --theme-a:#d6a84f;
      --theme-b:#fff1be;
      --theme-c:#3b2a16;
      --theme-good:#f6d98d;
      --theme-radius:18px;
      --theme-radius-lg:30px;
      --theme-shadow:0 30px 100px rgba(0,0,0,.64);
      --theme-card:radial-gradient(620px circle at 18% 0%,rgba(255,222,138,.13),transparent 48%),linear-gradient(180deg,rgba(255,241,190,.085),rgba(15,10,5,.50));
      --theme-btn:linear-gradient(135deg,#6f4e1f 0%,#d6a84f 42%,#fff1be 82%,#8a641f 132%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fff1be 25%,#d6a84f 55%,#fff9ed 82%,#fff 100%);
      --theme-pattern-opacity:.18;
      --theme-card-filter:blur(18px) contrast(1.08) saturate(1.06);
    }

    body.vibe-sunset {
      --theme-bg-1:#130617;
      --theme-bg-2:#32111e;
      --theme-surface:rgba(255,158,107,.085);
      --theme-line:rgba(255,183,134,.18);
      --theme-line-2:rgba(255,226,190,.30);
      --theme-text:#fff7f0;
      --theme-muted:rgba(255,247,240,.69);
      --theme-a:#ff7a59;
      --theme-b:#ff4fd8;
      --theme-c:#ffd166;
      --theme-good:#ffd166;
      --theme-radius:32px;
      --theme-radius-lg:52px;
      --theme-shadow:0 28px 96px rgba(54,9,29,.52);
      --theme-card:radial-gradient(620px circle at 10% 0%,rgba(255,122,89,.20),transparent 48%),radial-gradient(520px circle at 100% 20%,rgba(255,79,216,.16),transparent 48%),linear-gradient(180deg,rgba(255,255,255,.105),rgba(255,122,89,.035));
      --theme-btn:linear-gradient(135deg,#ff7a59 0%,#ff4fd8 55%,#ffd166 128%);
      --theme-title:linear-gradient(90deg,#fff 0%,#ffd6c7 22%,#ff7a59 45%,#ff4fd8 70%,#fff 100%);
      --theme-pattern-opacity:.28;
      --theme-card-filter:blur(24px) saturate(1.28);
    }

    body.vibe-ice {
      --theme-bg-1:#041018;
      --theme-bg-2:#0c2635;
      --theme-surface:rgba(232,249,255,.105);
      --theme-line:rgba(232,249,255,.24);
      --theme-line-2:rgba(255,255,255,.36);
      --theme-text:#f6fdff;
      --theme-muted:rgba(246,253,255,.72);
      --theme-a:#a7f3ff;
      --theme-b:#7dd3fc;
      --theme-c:#e0faff;
      --theme-good:#c8fbff;
      --theme-radius:12px;
      --theme-radius-lg:22px;
      --theme-shadow:0 30px 95px rgba(0,26,42,.50);
      --theme-card:linear-gradient(135deg,rgba(255,255,255,.16),rgba(167,243,255,.052)),radial-gradient(540px circle at 30% 0%,rgba(224,250,255,.18),transparent 48%);
      --theme-btn:linear-gradient(135deg,#38bdf8 0%,#a7f3ff 54%,#ffffff 132%);
      --theme-title:linear-gradient(90deg,#fff 0%,#e0faff 28%,#7dd3fc 56%,#fff 82%,#fff 100%);
      --theme-pattern-opacity:.20;
      --theme-card-filter:blur(30px) saturate(1.16);
    }

    body.vibe-market {
      --theme-bg-1:#081006;
      --theme-bg-2:#1e2510;
      --theme-surface:rgba(255,244,205,.082);
      --theme-line:rgba(255,244,205,.18);
      --theme-line-2:rgba(245,212,138,.32);
      --theme-text:#fffbea;
      --theme-muted:rgba(255,251,234,.68);
      --theme-a:#84cc16;
      --theme-b:#f97316;
      --theme-c:#facc15;
      --theme-good:#bef264;
      --theme-radius:20px;
      --theme-radius-lg:38px;
      --theme-shadow:0 28px 92px rgba(9,29,8,.48);
      --theme-card:radial-gradient(560px circle at 18% 0%,rgba(132,204,22,.15),transparent 48%),radial-gradient(520px circle at 100% 20%,rgba(249,115,22,.11),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.095),rgba(132,204,22,.035));
      --theme-btn:linear-gradient(135deg,#65a30d 0%,#84cc16 45%,#f97316 105%);
      --theme-title:linear-gradient(90deg,#fff 0%,#ecfccb 25%,#84cc16 50%,#facc15 72%,#fff 100%);
      --theme-pattern-opacity:.32;
      --theme-card-filter:blur(18px) saturate(1.20);
    }

    body.vibe-mono {
      --theme-bg-1:#030303;
      --theme-bg-2:#111111;
      --theme-surface:rgba(255,255,255,.060);
      --theme-line:rgba(255,255,255,.16);
      --theme-line-2:rgba(255,255,255,.30);
      --theme-text:#ffffff;
      --theme-muted:rgba(255,255,255,.64);
      --theme-a:#ffffff;
      --theme-b:#a3a3a3;
      --theme-c:#525252;
      --theme-good:#ffffff;
      --theme-radius:6px;
      --theme-radius-lg:10px;
      --theme-shadow:0 26px 90px rgba(0,0,0,.72);
      --theme-card:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.025));
      --theme-btn:linear-gradient(135deg,#ffffff 0%,#a3a3a3 100%);
      --theme-title:linear-gradient(90deg,#fff 0%,#d4d4d4 45%,#737373 65%,#fff 100%);
      --theme-pattern-opacity:.16;
      --theme-card-filter:blur(8px) contrast(1.20);
    }

    body.vibe-candy {
      --theme-bg-1:#12051f;
      --theme-bg-2:#270d3b;
      --theme-surface:rgba(255,255,255,.10);
      --theme-line:rgba(255,255,255,.18);
      --theme-line-2:rgba(255,255,255,.34);
      --theme-text:#fff7ff;
      --theme-muted:rgba(255,247,255,.70);
      --theme-a:#ff4fd8;
      --theme-b:#8b5cf6;
      --theme-c:#35d7ff;
      --theme-good:#f9a8d4;
      --theme-radius:42px;
      --theme-radius-lg:70px;
      --theme-shadow:0 28px 96px rgba(46,10,80,.54);
      --theme-card:radial-gradient(600px circle at 18% 0%,rgba(255,79,216,.22),transparent 48%),radial-gradient(560px circle at 96% 22%,rgba(53,215,255,.18),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.045));
      --theme-btn:linear-gradient(135deg,#ff4fd8 0%,#8b5cf6 52%,#35d7ff 126%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fbcfe8 24%,#ff4fd8 48%,#8b5cf6 72%,#fff 100%);
      --theme-pattern-opacity:.34;
      --theme-card-filter:blur(26px) saturate(1.42);
    }

    body.vibe-luxury,
    body.vibe-sunset,
    body.vibe-ice,
    body.vibe-market,
    body.vibe-mono,
    body.vibe-candy {
      color:var(--theme-text)!important;
      background:
        radial-gradient(1120px circle at 10% -10%,color-mix(in srgb,var(--theme-a) 38%,transparent),transparent 45%),
        radial-gradient(900px circle at 96% 8%,color-mix(in srgb,var(--theme-b) 25%,transparent),transparent 42%),
        radial-gradient(780px circle at 50% 108%,color-mix(in srgb,var(--theme-c) 18%,transparent),transparent 52%),
        linear-gradient(180deg,var(--theme-bg-1),var(--theme-bg-2) 46%,var(--theme-bg-1))!important;
    }

    body.vibe-luxury::before,
    body.vibe-sunset::before,
    body.vibe-ice::before,
    body.vibe-market::before,
    body.vibe-mono::before,
    body.vibe-candy::before {
      opacity:var(--theme-pattern-opacity)!important;
    }

    body.vibe-luxury .header,body.vibe-luxury .mobileAppTop,
    body.vibe-sunset .header,body.vibe-sunset .mobileAppTop,
    body.vibe-ice .header,body.vibe-ice .mobileAppTop,
    body.vibe-market .header,body.vibe-market .mobileAppTop,
    body.vibe-mono .header,body.vibe-mono .mobileAppTop,
    body.vibe-candy .header,body.vibe-candy .mobileAppTop {
      background:color-mix(in srgb,var(--theme-bg-1) 84%,transparent)!important;
      border-bottom-color:var(--theme-line)!important;
      box-shadow:0 22px 72px rgba(0,0,0,.28),0 0 42px color-mix(in srgb,var(--theme-a) 12%,transparent)!important;
    }

    body.vibe-luxury .glass,body.vibe-luxury .soft,body.vibe-luxury .card,body.vibe-luxury .formBox,body.vibe-luxury .hubCard,body.vibe-luxury .final,body.vibe-luxury .device,body.vibe-luxury .screen,body.vibe-luxury .estimateResult,
    body.vibe-sunset .glass,body.vibe-sunset .soft,body.vibe-sunset .card,body.vibe-sunset .formBox,body.vibe-sunset .hubCard,body.vibe-sunset .final,body.vibe-sunset .device,body.vibe-sunset .screen,body.vibe-sunset .estimateResult,
    body.vibe-ice .glass,body.vibe-ice .soft,body.vibe-ice .card,body.vibe-ice .formBox,body.vibe-ice .hubCard,body.vibe-ice .final,body.vibe-ice .device,body.vibe-ice .screen,body.vibe-ice .estimateResult,
    body.vibe-market .glass,body.vibe-market .soft,body.vibe-market .card,body.vibe-market .formBox,body.vibe-market .hubCard,body.vibe-market .final,body.vibe-market .device,body.vibe-market .screen,body.vibe-market .estimateResult,
    body.vibe-mono .glass,body.vibe-mono .soft,body.vibe-mono .card,body.vibe-mono .formBox,body.vibe-mono .hubCard,body.vibe-mono .final,body.vibe-mono .device,body.vibe-mono .screen,body.vibe-mono .estimateResult,
    body.vibe-candy .glass,body.vibe-candy .soft,body.vibe-candy .card,body.vibe-candy .formBox,body.vibe-candy .hubCard,body.vibe-candy .final,body.vibe-candy .device,body.vibe-candy .screen,body.vibe-candy .estimateResult {
      background:var(--theme-card)!important;
      border-color:var(--theme-line)!important;
      border-radius:var(--theme-radius)!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.09),var(--theme-shadow),0 0 74px color-mix(in srgb,var(--theme-a) 18%,transparent)!important;
      backdrop-filter:var(--theme-card-filter)!important;
      -webkit-backdrop-filter:var(--theme-card-filter)!important;
    }

    body.vibe-luxury .primary,body.vibe-sunset .primary,body.vibe-ice .primary,body.vibe-market .primary,body.vibe-mono .primary,body.vibe-candy .primary {
      background:var(--theme-btn)!important;
      color:color-mix(in srgb,var(--theme-bg-1) 70%,white)!important;
      box-shadow:0 20px 68px color-mix(in srgb,var(--theme-a) 34%,transparent),inset 0 1px 0 rgba(255,255,255,.28)!important;
    }

    body.vibe-mono .primary { color:#050505!important; }

    body.vibe-luxury .shine,body.vibe-sunset .shine,body.vibe-ice .shine,body.vibe-market .shine,body.vibe-mono .shine,body.vibe-candy .shine {
      background:var(--theme-title)!important;
      background-size:240% auto!important;
      -webkit-background-clip:text!important;
      background-clip:text!important;
      color:transparent!important;
    }

    body.vibe-luxury .ghost,body.vibe-sunset .ghost,body.vibe-ice .ghost,body.vibe-market .ghost,body.vibe-mono .ghost,body.vibe-candy .ghost,
    body.vibe-luxury .chip,body.vibe-sunset .chip,body.vibe-ice .chip,body.vibe-market .chip,body.vibe-mono .chip,body.vibe-candy .chip {
      background:var(--theme-surface)!important;
      border-color:var(--theme-line)!important;
      color:var(--theme-muted)!important;
    }

    body.vibe-luxury .field input,body.vibe-luxury .field select,body.vibe-luxury .field textarea,
    body.vibe-sunset .field input,body.vibe-sunset .field select,body.vibe-sunset .field textarea,
    body.vibe-ice .field input,body.vibe-ice .field select,body.vibe-ice .field textarea,
    body.vibe-market .field input,body.vibe-market .field select,body.vibe-market .field textarea,
    body.vibe-mono .field input,body.vibe-mono .field select,body.vibe-mono .field textarea,
    body.vibe-candy .field input,body.vibe-candy .field select,body.vibe-candy .field textarea {
      background:color-mix(in srgb,var(--theme-surface) 72%,transparent)!important;
      border-color:var(--theme-line)!important;
      color:var(--theme-text)!important;
      border-radius:calc(var(--theme-radius) - 6px)!important;
    }

    body.vibe-luxury .appBottomNav,body.vibe-sunset .appBottomNav,body.vibe-ice .appBottomNav,body.vibe-market .appBottomNav,body.vibe-mono .appBottomNav,body.vibe-candy .appBottomNav,
    body.vibe-luxury .audioDockPanel,body.vibe-luxury .sensoryPanel,body.vibe-sunset .audioDockPanel,body.vibe-sunset .sensoryPanel,body.vibe-ice .audioDockPanel,body.vibe-ice .sensoryPanel,body.vibe-market .audioDockPanel,body.vibe-market .sensoryPanel,body.vibe-mono .audioDockPanel,body.vibe-mono .sensoryPanel,body.vibe-candy .audioDockPanel,body.vibe-candy .sensoryPanel {
      background:color-mix(in srgb,var(--theme-bg-1) 88%,transparent)!important;
      border-color:var(--theme-line)!important;
      border-radius:var(--theme-radius)!important;
      box-shadow:0 24px 80px rgba(0,0,0,.52),0 0 48px color-mix(in srgb,var(--theme-a) 16%,transparent)!important;
    }

    body.vibe-luxury .audioMainButton,body.vibe-luxury .sensoryButton,
    body.vibe-sunset .audioMainButton,body.vibe-sunset .sensoryButton,
    body.vibe-ice .audioMainButton,body.vibe-ice .sensoryButton,
    body.vibe-market .audioMainButton,body.vibe-market .sensoryButton,
    body.vibe-mono .audioMainButton,body.vibe-mono .sensoryButton,
    body.vibe-candy .audioMainButton,body.vibe-candy .sensoryButton {
      background:var(--theme-btn)!important;
      color:color-mix(in srgb,var(--theme-bg-1) 70%,white)!important;
    }

    body.vibe-luxury .sectionTitle::after{background:linear-gradient(90deg,transparent,#d6a84f,#fff1be,transparent)!important;box-shadow:0 0 32px rgba(214,168,79,.32)!important}
    body.vibe-sunset .sectionTitle::after{background:linear-gradient(90deg,transparent,#ff7a59,#ff4fd8,#ffd166,transparent)!important;box-shadow:0 0 36px rgba(255,79,216,.26)!important}
    body.vibe-ice .sectionTitle::after{background:linear-gradient(90deg,transparent,#a7f3ff,#ffffff,#7dd3fc,transparent)!important;box-shadow:0 0 36px rgba(167,243,255,.24)!important}
    body.vibe-market .sectionTitle::after{background:linear-gradient(90deg,transparent,#84cc16,#f97316,#facc15,transparent)!important;box-shadow:0 0 32px rgba(132,204,22,.26)!important}
    body.vibe-mono .sectionTitle::after{background:linear-gradient(90deg,transparent,#fff,#737373,transparent)!important;box-shadow:0 0 20px rgba(255,255,255,.16)!important}
    body.vibe-candy .sectionTitle::after{background:linear-gradient(90deg,transparent,#ff4fd8,#8b5cf6,#35d7ff,transparent)!important;box-shadow:0 0 38px rgba(255,79,216,.26)!important}

    body.vibe-luxury .logoIcon,body.vibe-luxury .appIcon,body.vibe-luxury .requestIcon{background:linear-gradient(135deg,#fff9ed,#d6a84f)!important}
    body.vibe-sunset .logoIcon,body.vibe-sunset .appIcon,body.vibe-sunset .requestIcon{background:linear-gradient(135deg,#fff7f0,#ff7a59)!important}
    body.vibe-ice .logoIcon,body.vibe-ice .appIcon,body.vibe-ice .requestIcon{background:linear-gradient(135deg,#fff,#a7f3ff)!important}
    body.vibe-market .logoIcon,body.vibe-market .appIcon,body.vibe-market .requestIcon{background:linear-gradient(135deg,#fffbea,#84cc16)!important}
    body.vibe-mono .logoIcon,body.vibe-mono .appIcon,body.vibe-mono .requestIcon{background:linear-gradient(135deg,#fff,#a3a3a3)!important}
    body.vibe-candy .logoIcon,body.vibe-candy .appIcon,body.vibe-candy .requestIcon{background:linear-gradient(135deg,#fff,#fbcfe8,#bfdbfe)!important}

    body.vibe-luxury .v20-showcase,body.vibe-sunset .v20-showcase,body.vibe-ice .v20-showcase,body.vibe-market .v20-showcase,body.vibe-mono .v20-showcase,body.vibe-candy .v20-showcase {
      background:var(--theme-card)!important;
      border-color:var(--theme-line)!important;
      border-radius:var(--theme-radius-lg)!important;
      box-shadow:var(--theme-shadow),0 0 90px color-mix(in srgb,var(--theme-a) 18%,transparent)!important;
    }

    body.vibe-luxury .v20-showcase::after{background:linear-gradient(90deg,transparent,#d6a84f,#fff1be,transparent)!important}
    body.vibe-sunset .v20-showcase::after{background:linear-gradient(90deg,transparent,#ff7a59,#ff4fd8,#ffd166,transparent)!important}
    body.vibe-ice .v20-showcase::after{background:linear-gradient(90deg,transparent,#a7f3ff,#fff,#7dd3fc,transparent)!important}
    body.vibe-market .v20-showcase::after{background:linear-gradient(90deg,transparent,#84cc16,#f97316,#facc15,transparent)!important}
    body.vibe-mono .v20-showcase::after{background:linear-gradient(90deg,transparent,#fff,#525252,transparent)!important}
    body.vibe-candy .v20-showcase::after{background:linear-gradient(90deg,transparent,#ff4fd8,#8b5cf6,#35d7ff,transparent)!important}

    body.vibe-luxury .sensoryOption.active,body.vibe-sunset .sensoryOption.active,body.vibe-ice .sensoryOption.active,body.vibe-market .sensoryOption.active,body.vibe-mono .sensoryOption.active,body.vibe-candy .sensoryOption.active{
      background:linear-gradient(135deg,color-mix(in srgb,var(--theme-a) 52%,transparent),color-mix(in srgb,var(--theme-c) 20%,transparent))!important;
      border-color:var(--theme-line-2)!important;
    }

    body.vibe-mono .card,body.vibe-mono .hubCard,body.vibe-mono .formBox,body.vibe-mono .final,body.vibe-mono .v20-showcase{filter:grayscale(1) contrast(1.08)}
    body.vibe-candy .btn,body.vibe-candy .chip{border-radius:999px!important}
    body.vibe-ice .card,body.vibe-ice .hubCard,body.vibe-ice .formBox{border-width:1.5px!important}


    /* ============================================================
       v26 Employee Operations HQ
       Cleaner, premium, usable employee dashboard.
       This intentionally tones down the v25 "command center" look.
       ============================================================ */

    .employeeOps {
      padding-top: 34px;
      padding-bottom: 90px;
    }

    .opsShell {
      display: grid;
      gap: 18px;
    }

    .opsTop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 22px;
      border-radius: 30px;
      background:
        radial-gradient(720px circle at 0% 0%, color-mix(in srgb, var(--theme-a, #7c5cff) 15%, transparent), transparent 45%),
        linear-gradient(180deg, rgba(255,255,255,.085), rgba(255,255,255,.035));
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 22px 72px rgba(0,0,0,.28);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }

    .opsIdentity {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .opsMark {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 54px;
      height: 54px;
      border-radius: 20px;
      background: linear-gradient(135deg, #fff, color-mix(in srgb, var(--theme-c, #35d7ff) 20%, #fff));
      color: #070a12;
      font-size: 26px;
      box-shadow: 0 18px 44px color-mix(in srgb, var(--theme-a, #7c5cff) 22%, transparent);
    }

    .opsKicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 28px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,.065);
      border: 1px solid rgba(255,255,255,.10);
      color: rgba(255,255,255,.60);
      font-size: 11px;
      font-weight: 950;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .opsLiveDot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--theme-good, #49e6a5);
      box-shadow: 0 0 20px color-mix(in srgb, var(--theme-good, #49e6a5) 55%, transparent);
    }

    .opsTitle {
      margin-top: 9px;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: clamp(34px, 4vw, 58px);
      line-height: .92;
      letter-spacing: -.065em;
      font-weight: 900;
    }

    .opsSub {
      margin-top: 8px;
      color: rgba(255,255,255,.55);
      font-size: 14px;
      line-height: 1.55;
      max-width: 780px;
    }

    .opsTopActions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .opsTopActions form {
      margin: 0;
    }

    .opsStats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }

    .opsStat {
      position: relative;
      overflow: hidden;
      padding: 18px;
      min-height: 118px;
      border-radius: 26px;
      background:
        radial-gradient(360px circle at 15% 0%, rgba(255,255,255,.09), transparent 48%),
        rgba(255,255,255,.055);
      border: 1px solid rgba(255,255,255,.10);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 18px 56px rgba(0,0,0,.24);
    }

    .opsStat::after {
      content: "";
      position: absolute;
      right: -24px;
      top: -24px;
      width: 82px;
      height: 82px;
      border-radius: 28px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 30%, transparent), color-mix(in srgb, var(--theme-c, #35d7ff) 18%, transparent));
      opacity: .38;
      transform: rotate(18deg);
    }

    .opsStatLabel {
      position: relative;
      z-index: 2;
      color: rgba(255,255,255,.46);
      font-size: 11px;
      font-weight: 950;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .opsStatValue {
      position: relative;
      z-index: 2;
      margin-top: 13px;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 42px;
      line-height: .85;
      letter-spacing: -.07em;
      font-weight: 900;
    }

    .opsStatNote {
      position: relative;
      z-index: 2;
      margin-top: 9px;
      color: rgba(255,255,255,.48);
      font-size: 12px;
      line-height: 1.4;
      font-weight: 750;
    }

    .opsMainGrid {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }

    .opsPanel {
      padding: 18px;
      border-radius: 28px;
      background:
        radial-gradient(520px circle at 0% 0%, rgba(255,255,255,.075), transparent 46%),
        linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.032));
      border: 1px solid rgba(255,255,255,.10);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 20px 70px rgba(0,0,0,.26);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }

    .opsPanelHead {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    .opsPanelTitle {
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 26px;
      line-height: .98;
      letter-spacing: -.05em;
      font-weight: 900;
    }

    .opsPanelText {
      margin-top: 6px;
      color: rgba(255,255,255,.50);
      font-size: 13px;
      line-height: 1.48;
    }

    .opsMiniPill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,.07);
      border: 1px solid rgba(255,255,255,.10);
      color: rgba(255,255,255,.60);
      font-size: 11px;
      font-weight: 950;
      white-space: nowrap;
    }

    .opsBriefList {
      display: grid;
      gap: 10px;
    }

    .opsBriefItem {
      display: grid;
      grid-template-columns: 40px 1fr;
      gap: 11px;
      padding: 12px;
      border-radius: 18px;
      background: rgba(255,255,255,.052);
      border: 1px solid rgba(255,255,255,.08);
    }

    .opsBriefIcon {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 15px;
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.08);
      font-size: 19px;
    }

    .opsBriefItem strong {
      display: block;
      color: rgba(255,255,255,.84);
      font-size: 13px;
      line-height: 1.25;
    }

    .opsBriefItem span {
      display: block;
      margin-top: 4px;
      color: rgba(255,255,255,.45);
      font-size: 12px;
      line-height: 1.42;
      font-weight: 750;
    }

    .opsFocusCard {
      margin-top: 12px;
      padding: 14px;
      border-radius: 20px;
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 13%, transparent), color-mix(in srgb, var(--theme-c, #35d7ff) 8%, transparent)),
        rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.09);
    }

    .opsFocusCard strong {
      display: block;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 22px;
      line-height: .98;
      letter-spacing: -.045em;
    }

    .opsFocusCard span {
      display: block;
      margin-top: 7px;
      color: rgba(255,255,255,.50);
      font-size: 12px;
      line-height: 1.45;
      font-weight: 750;
    }

    .opsBoard {
      display: grid;
      grid-template-columns: repeat(5, minmax(180px, 1fr));
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 3px;
      -webkit-overflow-scrolling: touch;
    }

    .opsColumn {
      min-height: 210px;
      padding: 12px;
      border-radius: 22px;
      background: rgba(0,0,0,.16);
      border: 1px solid rgba(255,255,255,.08);
    }

    .opsColumnHead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }

    .opsColumnHead strong {
      font-size: 11px;
      font-weight: 950;
      letter-spacing: .10em;
      text-transform: uppercase;
      color: rgba(255,255,255,.68);
    }

    .opsCount {
      display: inline-grid;
      place-items: center;
      min-width: 28px;
      height: 28px;
      padding: 0 7px;
      border-radius: 999px;
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.09);
      font-size: 12px;
      font-weight: 950;
    }

    .opsMiniJob {
      display: grid;
      gap: 5px;
      padding: 11px;
      border-radius: 16px;
      background: rgba(255,255,255,.055);
      border: 1px solid rgba(255,255,255,.075);
      margin-bottom: 8px;
    }

    .opsMiniJob b {
      color: rgba(255,255,255,.84);
      font-size: 13px;
      line-height: 1.22;
    }

    .opsMiniJob span {
      color: rgba(255,255,255,.45);
      font-size: 11px;
      line-height: 1.35;
      font-weight: 750;
    }

    .opsEmptyMini {
      padding: 16px 10px;
      border-radius: 16px;
      border: 1px dashed rgba(255,255,255,.10);
      color: rgba(255,255,255,.34);
      font-size: 12px;
      line-height: 1.35;
      text-align: center;
    }

    .opsToolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .opsSearch {
      flex: 1 1 260px;
      min-height: 48px;
      padding: 12px 14px;
      border-radius: 18px;
      color: white;
      background: rgba(255,255,255,.065);
      border: 1px solid rgba(255,255,255,.10);
      outline: none;
    }

    .opsFilter {
      min-height: 48px;
      padding: 12px 14px;
      border-radius: 18px;
      color: white;
      background: rgba(255,255,255,.065);
      border: 1px solid rgba(255,255,255,.10);
      outline: none;
    }

    .opsJobsHead {
      margin-top: 18px;
      padding: 18px;
      border-radius: 26px;
      background: rgba(255,255,255,.045);
      border: 1px solid rgba(255,255,255,.09);
    }

    .opsJobsHead h2 {
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: clamp(34px, 4vw, 56px);
      line-height: .95;
      letter-spacing: -.065em;
      font-weight: 900;
    }

    .opsJobsHead p {
      margin-top: 8px;
      color: rgba(255,255,255,.52);
      font-size: 14px;
      line-height: 1.55;
      max-width: 780px;
    }

    .opsJobCard {
      position: relative;
      overflow: hidden;
      border-radius: 28px;
      background:
        radial-gradient(620px circle at 0% 0%, rgba(255,255,255,.075), transparent 46%),
        linear-gradient(180deg, rgba(255,255,255,.072), rgba(255,255,255,.030));
      border: 1px solid rgba(255,255,255,.11);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 20px 72px rgba(0,0,0,.28);
    }

    .opsJobCard::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 5px;
      background: var(--job-color, var(--theme-a, #7c5cff));
      box-shadow: 0 0 28px color-mix(in srgb, var(--job-color, #7c5cff) 45%, transparent);
    }

    .ops-status-new { --job-color: #c9c0ff; }
    .ops-status-contacted { --job-color: #ffd166; }
    .ops-status-confirmed { --job-color: #5aa7ff; }
    .ops-status-completed { --job-color: #49e6a5; }
    .ops-status-cancelled { --job-color: #ff6b6b; }

    .opsJobInner {
      padding: 20px 20px 20px 26px;
    }

    .opsJobTop {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .opsJobName {
      margin-top: 11px;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 30px;
      line-height: .98;
      letter-spacing: -.05em;
      font-weight: 900;
    }

    .opsJobContact {
      margin-top: 7px;
      color: rgba(255,255,255,.56);
      font-size: 13px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    .opsJobId {
      color: rgba(255,255,255,.42);
      text-align: right;
      font-size: 12px;
      line-height: 1.5;
      font-weight: 850;
      white-space: nowrap;
    }

    .opsTagRow {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 12px;
    }

    .opsTag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 27px;
      padding: 6px 9px;
      border-radius: 999px;
      background: rgba(255,255,255,.065);
      border: 1px solid rgba(255,255,255,.09);
      color: rgba(255,255,255,.62);
      font-size: 11px;
      font-weight: 850;
    }

    .opsNotes {
      margin-top: 14px;
      padding: 14px;
      border-radius: 18px;
      background: rgba(0,0,0,.16);
      border: 1px solid rgba(255,255,255,.075);
      color: rgba(255,255,255,.60);
      font-size: 13px;
      line-height: 1.58;
    }

    .opsActions {
      display: flex;
      align-items: center;
      gap: 9px;
      flex-wrap: wrap;
      margin-top: 14px;
    }

    .opsActions form {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .opsActions select {
      min-height: 44px;
      padding: 10px 12px;
      border-radius: 15px;
      color: white;
      background: rgba(255,255,255,.065);
      border: 1px solid rgba(255,255,255,.10);
      outline: none;
    }

    .opsHide {
      display: none !important;
    }

    @media (max-width: 1100px) {
      .opsTop,
      .opsMainGrid {
        grid-template-columns: 1fr;
      }

      .opsTop {
        display: grid;
      }

      .opsTopActions {
        justify-content: flex-start;
      }

      .opsStats {
        grid-template-columns: repeat(2, 1fr);
      }

      .opsMainGrid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 720px) {
      .employeeOps {
        padding-top: 18px;
      }

      .opsTop {
        padding: 16px;
        border-radius: 24px;
      }

      .opsIdentity {
        align-items: flex-start;
      }

      .opsMark {
        width: 46px;
        height: 46px;
        border-radius: 17px;
      }

      .opsTitle {
        font-size: 36px;
      }

      .opsTopActions,
      .opsActions,
      .opsActions form {
        display: grid;
        grid-template-columns: 1fr;
        width: 100%;
      }

      .opsTopActions .btn,
      .opsTopActions form,
      .opsTopActions button,
      .opsActions .btn,
      .opsActions button,
      .opsActions select {
        width: 100%;
      }

      .opsStats {
        grid-template-columns: 1fr;
      }

      .opsPanel {
        padding: 15px;
        border-radius: 24px;
      }

      .opsBoard {
        grid-template-columns: repeat(5, minmax(210px, 1fr));
      }

      .opsJobTop {
        flex-direction: column;
      }

      .opsJobId {
        text-align: left;
      }

      .opsJobName {
        font-size: 27px;
      }
    }


    /* ============================================================
       v28 HQ Dispatch Device Route Fix
       ============================================================ */
    .hqDevicePage{min-height:100svh;padding-top:20px;padding-bottom:120px}
    .hqDeviceShell{display:grid;gap:16px}
    .hqTopbar{position:sticky;top:10px;z-index:900;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px;border-radius:28px;background:radial-gradient(700px circle at 0% 0%,color-mix(in srgb,var(--theme-a,#7c5cff) 18%,transparent),transparent 46%),rgba(7,10,18,.82);border:1px solid rgba(255,255,255,.13);box-shadow:0 22px 72px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
    .hqBrand{display:flex;align-items:center;gap:12px;min-width:0}
    .hqBrandIcon{display:grid;place-items:center;flex:0 0 auto;width:52px;height:52px;border-radius:20px;color:#070a12;background:linear-gradient(135deg,#fff,color-mix(in srgb,var(--theme-c,#35d7ff) 22%,#fff));box-shadow:0 18px 44px color-mix(in srgb,var(--theme-a,#7c5cff) 24%,transparent);font-size:25px}
    .hqBrandText{min-width:0}.hqBrandText strong{display:block;font-family:"Space Grotesk",Inter,sans-serif;font-size:25px;line-height:.95;letter-spacing:-.055em;font-weight:900}.hqBrandText span{display:block;margin-top:4px;color:rgba(255,255,255,.52);font-size:12px;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .hqTopActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .hqPill{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:9px 12px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);color:rgba(255,255,255,.66);font-size:12px;font-weight:950}
    .hqLiveDot{width:8px;height:8px;border-radius:999px;background:var(--theme-good,#49e6a5);box-shadow:0 0 24px color-mix(in srgb,var(--theme-good,#49e6a5) 60%,transparent)}
    .hqHero{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}
    .hqHeroCard,.hqNextCard{position:relative;overflow:hidden;padding:24px;border-radius:34px;background:radial-gradient(900px circle at 5% 0%,color-mix(in srgb,var(--theme-a,#7c5cff) 26%,transparent),transparent 46%),radial-gradient(760px circle at 100% 20%,color-mix(in srgb,var(--theme-c,#35d7ff) 16%,transparent),transparent 48%),linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 24px 86px rgba(0,0,0,.30)}
    .hqKicker{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:7px 11px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);color:rgba(255,255,255,.64);font-size:11px;font-weight:950;letter-spacing:.10em;text-transform:uppercase}
    .hqTitle{margin-top:18px;max-width:850px;font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(46px,6vw,92px);line-height:.84;letter-spacing:-.078em;font-weight:900;text-wrap:balance}.hqTitle span{background:var(--theme-title,linear-gradient(90deg,#fff,#c9c0ff,#ff7be8,#68e4ff,#fff));background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent}
    .hqSub{margin-top:16px;max-width:780px;color:rgba(255,255,255,.62);font-size:16px;line-height:1.65}.hqActionRow{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
    .hqNextTop{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.hqNextTitle{font-family:"Space Grotesk",Inter,sans-serif;font-size:30px;line-height:.95;letter-spacing:-.055em;font-weight:900}.hqNextName{margin-top:12px;font-family:"Space Grotesk",Inter,sans-serif;font-size:38px;line-height:.92;letter-spacing:-.065em;font-weight:900}.hqNextDetails{margin-top:10px;color:rgba(255,255,255,.56);font-size:14px;line-height:1.55}
    .hqStatGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.hqStat{position:relative;overflow:hidden;min-height:118px;padding:16px;border-radius:26px;background:radial-gradient(360px circle at 20% 0%,rgba(255,255,255,.09),transparent 48%),rgba(255,255,255,.052);border:1px solid rgba(255,255,255,.10);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 18px 58px rgba(0,0,0,.24)}.hqStat span{display:block;color:rgba(255,255,255,.48);font-size:11px;font-weight:950;letter-spacing:.10em;text-transform:uppercase}.hqStat strong{display:block;margin-top:12px;font-family:"Space Grotesk",Inter,sans-serif;font-size:42px;line-height:.85;letter-spacing:-.07em}.hqStat small{display:block;margin-top:9px;color:rgba(255,255,255,.44);font-size:12px;line-height:1.35;font-weight:750}
    .hqControls{position:sticky;top:94px;z-index:800;display:grid;grid-template-columns:1fr auto auto;gap:10px;padding:12px;border-radius:26px;background:rgba(7,10,18,.78);border:1px solid rgba(255,255,255,.11);box-shadow:0 20px 72px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.07);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}
    .hqSearch,.hqSelect{min-height:50px;padding:12px 14px;border-radius:18px;color:white;background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.10);outline:none;font-size:15px}
    .hqBoard{display:grid;grid-template-columns:repeat(4,minmax(240px,1fr));gap:12px;align-items:start;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}.hqColumn{min-height:360px;padding:12px;border-radius:26px;background:radial-gradient(420px circle at 10% 0%,rgba(255,255,255,.065),transparent 46%),rgba(0,0,0,.17);border:1px solid rgba(255,255,255,.09)}.hqColumnHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;padding:4px 2px}.hqColumnHead strong{font-size:12px;font-weight:950;letter-spacing:.10em;text-transform:uppercase;color:rgba(255,255,255,.68)}.hqCount{display:inline-grid;place-items:center;min-width:30px;height:30px;padding:0 8px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.10);font-size:12px;font-weight:950}
    .hqJob{position:relative;overflow:hidden;display:grid;gap:10px;padding:14px;margin-bottom:10px;border-radius:22px;background:radial-gradient(320px circle at 20% 0%,rgba(255,255,255,.08),transparent 46%),rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.09);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 12px 42px rgba(0,0,0,.20)}.hqJob::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--job-color,var(--theme-a,#7c5cff));box-shadow:0 0 26px color-mix(in srgb,var(--job-color,#7c5cff) 46%,transparent)}.hq-status-new{--job-color:#c9c0ff}.hq-status-contacted{--job-color:#ffd166}.hq-status-confirmed{--job-color:#5aa7ff}.hq-status-completed{--job-color:#49e6a5}
    .hqJobTop{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.hqJobName{padding-left:3px;font-family:"Space Grotesk",Inter,sans-serif;font-size:23px;line-height:.98;letter-spacing:-.045em;font-weight:900}.hqJobMeta{color:rgba(255,255,255,.48);font-size:11px;line-height:1.35;font-weight:800;text-align:right;white-space:nowrap}.hqJobLine{color:rgba(255,255,255,.58);font-size:12px;line-height:1.45;font-weight:750;overflow-wrap:anywhere}.hqJobNotes{padding:10px;border-radius:16px;background:rgba(0,0,0,.16);border:1px solid rgba(255,255,255,.07);color:rgba(255,255,255,.54);font-size:12px;line-height:1.45;max-height:88px;overflow:auto}.hqTagRow{display:flex;flex-wrap:wrap;gap:6px}.hqTag{display:inline-flex;align-items:center;min-height:24px;padding:5px 8px;border-radius:999px;background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.58);font-size:10.5px;font-weight:850}
    .hqQuickActions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.hqQuickActions .btn{min-height:40px;padding:9px 10px;border-radius:14px;font-size:11px;width:100%}.hqStatusButtons{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.hqStatusButtons form{margin:0}.hqStatusButtons button{min-height:38px;width:100%;border:0;border-radius:13px;color:white;background:rgba(255,255,255,.075);border:1px solid rgba(255,255,255,.10);font-size:10.5px;font-weight:950}.hqEmpty{padding:20px 12px;border-radius:18px;border:1px dashed rgba(255,255,255,.11);color:rgba(255,255,255,.36);text-align:center;font-size:12px;line-height:1.45}.hqHidden{display:none!important}
    .hqFullscreenMode .header,.hqFullscreenMode .footer,.hqFullscreenMode .mobileAppTop,.hqFullscreenMode .appBottomNav,.hqFullscreenMode #audioDock,.hqFullscreenMode #sensoryDock{display:none!important}
    @media(max-width:1200px){.hqHero{grid-template-columns:1fr}.hqStatGrid{grid-template-columns:repeat(2,1fr)}.hqBoard{grid-template-columns:repeat(4,minmax(260px,1fr))}}
    @media(max-width:720px){.hqDevicePage{padding-top:12px}.hqTopbar{position:relative;top:auto;display:grid;border-radius:24px}.hqTopActions{justify-content:flex-start}.hqHeroCard,.hqNextCard{padding:18px;border-radius:26px}.hqTitle{font-size:42px}.hqStatGrid{grid-template-columns:1fr}.hqControls{position:relative;top:auto;grid-template-columns:1fr}.hqBoard{grid-template-columns:1fr;overflow-x:visible}.hqColumn{min-height:auto}.hqQuickActions,.hqStatusButtons{grid-template-columns:1fr}}


    /* ============================================================
       v29 More Themes + Expandable Theme Library
       ============================================================ */

    .themeStudioHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 14px;
      padding: 12px;
      border-radius: 20px;
      background:
        radial-gradient(280px circle at 0% 0%, color-mix(in srgb, var(--theme-a, #7c5cff) 13%, transparent), transparent 48%),
        rgba(255,255,255,.052);
      border: 1px solid rgba(255,255,255,.09);
    }

    .themeStudioHeader strong,
    .moreThemesLabel strong {
      display: block;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 16px;
      line-height: 1;
      letter-spacing: -.035em;
    }

    .themeStudioHeader span,
    .moreThemesLabel span {
      display: block;
      margin-top: 4px;
      color: rgba(255,255,255,.44);
      font-size: 11px;
      line-height: 1.35;
      font-weight: 760;
    }

    .themeMoreButton {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 42px;
      padding: 9px 12px;
      border: 0;
      border-radius: 16px;
      color: white;
      background:
        radial-gradient(160px circle at 20% 0%, rgba(255,255,255,.16), transparent 45%),
        linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 58%, rgba(255,255,255,.08)), color-mix(in srgb, var(--theme-c, #35d7ff) 22%, rgba(255,255,255,.08)));
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 14px 38px rgba(0,0,0,.22);
      font-size: 12px;
      font-weight: 950;
    }

    .themeMoreButton span {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      margin: 0;
      border-radius: 9px;
      background: rgba(255,255,255,.14);
      color: white;
      font-size: 16px;
      line-height: 1;
      transition: transform .18s ease;
    }

    .themeMoreButton.open span {
      transform: rotate(45deg);
    }

    .moreThemesPanel {
      margin-top: 12px;
      padding: 12px;
      border-radius: 24px;
      background:
        radial-gradient(420px circle at 0% 0%, color-mix(in srgb, var(--theme-a, #7c5cff) 12%, transparent), transparent 52%),
        rgba(0,0,0,.16);
      border: 1px solid rgba(255,255,255,.09);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
    }

    .moreThemesPanel[hidden] {
      display: none !important;
    }

    .moreThemesPanel.show {
      display: block;
      animation: moreThemesIn .2s ease both;
    }

    @keyframes moreThemesIn {
      from {
        opacity: 0;
        transform: translateY(-5px) scale(.99);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .moreThemesLabel {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 11px;
      padding: 10px;
      border-radius: 18px;
      background: rgba(255,255,255,.045);
      border: 1px solid rgba(255,255,255,.07);
    }

    .moreThemesGrid {
      max-height: 420px;
      overflow-y: auto;
      padding-right: 4px;
      -webkit-overflow-scrolling: touch;
    }

    .moreThemesGrid::-webkit-scrollbar {
      width: 8px;
    }

    .moreThemesGrid::-webkit-scrollbar-thumb {
      border-radius: 999px;
      background: color-mix(in srgb, var(--theme-a, #7c5cff) 45%, rgba(255,255,255,.12));
    }

    .premiumTheme {
      position: relative;
      overflow: hidden;
    }

    .premiumTheme::after {
      content: "";
      position: absolute;
      right: -28px;
      top: -28px;
      width: 76px;
      height: 76px;
      border-radius: 28px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 26%, transparent), color-mix(in srgb, var(--theme-c, #35d7ff) 16%, transparent));
      transform: rotate(18deg);
      opacity: .48;
      pointer-events: none;
    }

    body.vibe-aurora {
      --theme-bg-1:#060818;
      --theme-bg-2:#11113d;
      --theme-surface:rgba(177,141,255,.088);
      --theme-line:rgba(194,181,255,.18);
      --theme-line-2:rgba(209,250,255,.32);
      --theme-text:#fbfbff;
      --theme-muted:rgba(251,251,255,.70);
      --theme-a:#8b5cf6;
      --theme-b:#2dd4bf;
      --theme-c:#f0abfc;
      --theme-good:#99f6e4;
      --theme-radius:34px;
      --theme-radius-lg:58px;
      --theme-shadow:0 30px 100px rgba(16,12,55,.54);
      --theme-card:radial-gradient(680px circle at 16% 0%,rgba(139,92,246,.24),transparent 48%),radial-gradient(620px circle at 100% 30%,rgba(45,212,191,.16),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.11),rgba(255,255,255,.038));
      --theme-btn:linear-gradient(135deg,#8b5cf6 0%,#2dd4bf 56%,#f0abfc 126%);
      --theme-title:linear-gradient(90deg,#fff 0%,#ddd6fe 25%,#2dd4bf 52%,#f0abfc 78%,#fff 100%);
      --theme-pattern-opacity:.32;
      --theme-card-filter:blur(26px) saturate(1.32);
    }

    body.vibe-espresso {
      --theme-bg-1:#120a06;
      --theme-bg-2:#2a160d;
      --theme-surface:rgba(255,230,196,.078);
      --theme-line:rgba(255,230,196,.17);
      --theme-line-2:rgba(255,244,224,.31);
      --theme-text:#fff7ed;
      --theme-muted:rgba(255,247,237,.68);
      --theme-a:#b45309;
      --theme-b:#f59e0b;
      --theme-c:#fed7aa;
      --theme-good:#fdba74;
      --theme-radius:24px;
      --theme-radius-lg:40px;
      --theme-shadow:0 30px 96px rgba(32,14,7,.58);
      --theme-card:radial-gradient(620px circle at 15% 0%,rgba(245,158,11,.14),transparent 48%),linear-gradient(180deg,rgba(255,237,213,.09),rgba(24,12,6,.46));
      --theme-btn:linear-gradient(135deg,#7c2d12 0%,#b45309 44%,#f59e0b 92%,#fed7aa 135%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fed7aa 28%,#f59e0b 56%,#fff7ed 82%,#fff 100%);
      --theme-pattern-opacity:.22;
      --theme-card-filter:blur(18px) contrast(1.08);
    }

    body.vibe-citrus {
      --theme-bg-1:#101300;
      --theme-bg-2:#293300;
      --theme-surface:rgba(254,240,138,.088);
      --theme-line:rgba(254,240,138,.20);
      --theme-line-2:rgba(236,252,203,.34);
      --theme-text:#fffff0;
      --theme-muted:rgba(255,255,240,.70);
      --theme-a:#a3e635;
      --theme-b:#facc15;
      --theme-c:#22c55e;
      --theme-good:#bef264;
      --theme-radius:28px;
      --theme-radius-lg:50px;
      --theme-shadow:0 28px 92px rgba(27,43,0,.48);
      --theme-card:radial-gradient(620px circle at 18% 0%,rgba(250,204,21,.20),transparent 48%),radial-gradient(520px circle at 100% 20%,rgba(34,197,94,.14),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.105),rgba(163,230,53,.035));
      --theme-btn:linear-gradient(135deg,#65a30d 0%,#a3e635 45%,#facc15 82%,#22c55e 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#ecfccb 26%,#facc15 50%,#a3e635 78%,#fff 100%);
      --theme-pattern-opacity:.35;
      --theme-card-filter:blur(20px) saturate(1.32);
    }

    body.vibe-lavender {
      --theme-bg-1:#10091b;
      --theme-bg-2:#211232;
      --theme-surface:rgba(216,180,254,.088);
      --theme-line:rgba(216,180,254,.19);
      --theme-line-2:rgba(245,208,254,.32);
      --theme-text:#fff7ff;
      --theme-muted:rgba(255,247,255,.70);
      --theme-a:#a78bfa;
      --theme-b:#d8b4fe;
      --theme-c:#f0abfc;
      --theme-good:#c4b5fd;
      --theme-radius:38px;
      --theme-radius-lg:66px;
      --theme-shadow:0 30px 96px rgba(38,18,62,.50);
      --theme-card:radial-gradient(620px circle at 18% 0%,rgba(216,180,254,.19),transparent 48%),radial-gradient(520px circle at 100% 20%,rgba(240,171,252,.12),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.11),rgba(216,180,254,.038));
      --theme-btn:linear-gradient(135deg,#8b5cf6 0%,#d8b4fe 56%,#f0abfc 125%);
      --theme-title:linear-gradient(90deg,#fff 0%,#ede9fe 28%,#d8b4fe 54%,#f0abfc 80%,#fff 100%);
      --theme-pattern-opacity:.26;
      --theme-card-filter:blur(24px) saturate(1.24);
    }

    body.vibe-cyber {
      --theme-bg-1:#020617;
      --theme-bg-2:#07111f;
      --theme-surface:rgba(34,211,238,.072);
      --theme-line:rgba(0,255,255,.20);
      --theme-line-2:rgba(0,255,170,.34);
      --theme-text:#f0fdff;
      --theme-muted:rgba(240,253,255,.66);
      --theme-a:#00f5ff;
      --theme-b:#7c3aed;
      --theme-c:#39ff14;
      --theme-good:#39ff14;
      --theme-radius:10px;
      --theme-radius-lg:16px;
      --theme-shadow:0 30px 100px rgba(0,0,0,.66);
      --theme-card:linear-gradient(180deg,rgba(0,245,255,.10),rgba(124,58,237,.035)),radial-gradient(620px circle at 18% 0%,rgba(57,255,20,.10),transparent 48%);
      --theme-btn:linear-gradient(135deg,#00f5ff 0%,#7c3aed 56%,#39ff14 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#00f5ff 32%,#7c3aed 58%,#39ff14 82%,#fff 100%);
      --theme-pattern-opacity:.42;
      --theme-card-filter:blur(10px) contrast(1.28) saturate(1.45);
    }

    body.vibe-cozy {
      --theme-bg-1:#150d08;
      --theme-bg-2:#2a1a0f;
      --theme-surface:rgba(255,245,225,.080);
      --theme-line:rgba(255,229,196,.17);
      --theme-line-2:rgba(255,245,225,.30);
      --theme-text:#fff8ee;
      --theme-muted:rgba(255,248,238,.68);
      --theme-a:#f59e0b;
      --theme-b:#fb7185;
      --theme-c:#fde68a;
      --theme-good:#fcd34d;
      --theme-radius:30px;
      --theme-radius-lg:54px;
      --theme-shadow:0 28px 92px rgba(45,21,7,.52);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(253,230,138,.14),transparent 48%),radial-gradient(520px circle at 100% 20%,rgba(251,113,133,.11),transparent 50%),linear-gradient(180deg,rgba(255,248,238,.10),rgba(255,248,238,.035));
      --theme-btn:linear-gradient(135deg,#b45309 0%,#f59e0b 48%,#fb7185 116%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fde68a 30%,#f59e0b 58%,#fb7185 82%,#fff 100%);
      --theme-pattern-opacity:.24;
      --theme-card-filter:blur(20px) saturate(1.12);
    }

    body.vibe-mint {
      --theme-bg-1:#02130f;
      --theme-bg-2:#083328;
      --theme-surface:rgba(153,246,228,.088);
      --theme-line:rgba(153,246,228,.19);
      --theme-line-2:rgba(204,251,241,.32);
      --theme-text:#effefa;
      --theme-muted:rgba(239,254,250,.70);
      --theme-a:#14b8a6;
      --theme-b:#99f6e4;
      --theme-c:#5eead4;
      --theme-good:#ccfbf1;
      --theme-radius:32px;
      --theme-radius-lg:56px;
      --theme-shadow:0 28px 92px rgba(0,49,42,.48);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(153,246,228,.16),transparent 48%),linear-gradient(180deg,rgba(255,255,255,.10),rgba(20,184,166,.035));
      --theme-btn:linear-gradient(135deg,#0f766e 0%,#14b8a6 52%,#99f6e4 124%);
      --theme-title:linear-gradient(90deg,#fff 0%,#ccfbf1 30%,#14b8a6 58%,#99f6e4 82%,#fff 100%);
      --theme-pattern-opacity:.26;
      --theme-card-filter:blur(22px) saturate(1.18);
    }

    body.vibe-royal {
      --theme-bg-1:#090617;
      --theme-bg-2:#1e123d;
      --theme-surface:rgba(196,181,253,.076);
      --theme-line:rgba(196,181,253,.18);
      --theme-line-2:rgba(226,232,240,.30);
      --theme-text:#faf7ff;
      --theme-muted:rgba(250,247,255,.68);
      --theme-a:#6d28d9;
      --theme-b:#c4b5fd;
      --theme-c:#e5e7eb;
      --theme-good:#ddd6fe;
      --theme-radius:18px;
      --theme-radius-lg:30px;
      --theme-shadow:0 30px 100px rgba(24,13,54,.58);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(109,40,217,.20),transparent 48%),radial-gradient(540px circle at 100% 20%,rgba(229,231,235,.10),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.09),rgba(109,40,217,.034));
      --theme-btn:linear-gradient(135deg,#4c1d95 0%,#6d28d9 52%,#c4b5fd 118%);
      --theme-title:linear-gradient(90deg,#fff 0%,#ddd6fe 28%,#6d28d9 55%,#e5e7eb 82%,#fff 100%);
      --theme-pattern-opacity:.22;
      --theme-card-filter:blur(18px) contrast(1.10);
    }

    body.vibe-peach {
      --theme-bg-1:#180910;
      --theme-bg-2:#361322;
      --theme-surface:rgba(255,218,185,.084);
      --theme-line:rgba(255,218,185,.18);
      --theme-line-2:rgba(255,241,230,.30);
      --theme-text:#fff8f3;
      --theme-muted:rgba(255,248,243,.70);
      --theme-a:#fb7185;
      --theme-b:#fdba74;
      --theme-c:#ffedd5;
      --theme-good:#fed7aa;
      --theme-radius:36px;
      --theme-radius-lg:64px;
      --theme-shadow:0 28px 94px rgba(60,14,29,.52);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(251,113,133,.18),transparent 48%),radial-gradient(540px circle at 100% 20%,rgba(253,186,116,.14),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.11),rgba(251,113,133,.035));
      --theme-btn:linear-gradient(135deg,#fb7185 0%,#fdba74 60%,#ffedd5 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#ffe4e6 28%,#fb7185 54%,#fdba74 78%,#fff 100%);
      --theme-pattern-opacity:.28;
      --theme-card-filter:blur(24px) saturate(1.20);
    }

    body.vibe-storm {
      --theme-bg-1:#020617;
      --theme-bg-2:#0f172a;
      --theme-surface:rgba(148,163,184,.072);
      --theme-line:rgba(147,197,253,.17);
      --theme-line-2:rgba(191,219,254,.28);
      --theme-text:#f8fbff;
      --theme-muted:rgba(248,251,255,.66);
      --theme-a:#2563eb;
      --theme-b:#64748b;
      --theme-c:#f8fafc;
      --theme-good:#93c5fd;
      --theme-radius:12px;
      --theme-radius-lg:20px;
      --theme-shadow:0 30px 100px rgba(0,0,0,.68);
      --theme-card:linear-gradient(180deg,rgba(147,197,253,.085),rgba(15,23,42,.55)),radial-gradient(650px circle at 15% 0%,rgba(37,99,235,.14),transparent 48%);
      --theme-btn:linear-gradient(135deg,#1d4ed8 0%,#2563eb 55%,#f8fafc 135%);
      --theme-title:linear-gradient(90deg,#fff 0%,#bfdbfe 30%,#2563eb 56%,#f8fafc 82%,#fff 100%);
      --theme-pattern-opacity:.22;
      --theme-card-filter:blur(10px) contrast(1.18);
    }

    body.vibe-aurora,
    body.vibe-espresso,
    body.vibe-citrus,
    body.vibe-lavender,
    body.vibe-cyber,
    body.vibe-cozy,
    body.vibe-mint,
    body.vibe-royal,
    body.vibe-peach,
    body.vibe-storm {
      color:var(--theme-text)!important;
      background:
        radial-gradient(1120px circle at 10% -10%,color-mix(in srgb,var(--theme-a) 38%,transparent),transparent 45%),
        radial-gradient(900px circle at 96% 8%,color-mix(in srgb,var(--theme-b) 25%,transparent),transparent 42%),
        radial-gradient(780px circle at 50% 108%,color-mix(in srgb,var(--theme-c) 18%,transparent),transparent 52%),
        linear-gradient(180deg,var(--theme-bg-1),var(--theme-bg-2) 46%,var(--theme-bg-1))!important;
    }

    body.vibe-aurora::before,
    body.vibe-espresso::before,
    body.vibe-citrus::before,
    body.vibe-lavender::before,
    body.vibe-cyber::before,
    body.vibe-cozy::before,
    body.vibe-mint::before,
    body.vibe-royal::before,
    body.vibe-peach::before,
    body.vibe-storm::before {
      opacity:var(--theme-pattern-opacity)!important;
    }

    body.vibe-aurora .header,body.vibe-aurora .mobileAppTop,
    body.vibe-espresso .header,body.vibe-espresso .mobileAppTop,
    body.vibe-citrus .header,body.vibe-citrus .mobileAppTop,
    body.vibe-lavender .header,body.vibe-lavender .mobileAppTop,
    body.vibe-cyber .header,body.vibe-cyber .mobileAppTop,
    body.vibe-cozy .header,body.vibe-cozy .mobileAppTop,
    body.vibe-mint .header,body.vibe-mint .mobileAppTop,
    body.vibe-royal .header,body.vibe-royal .mobileAppTop,
    body.vibe-peach .header,body.vibe-peach .mobileAppTop,
    body.vibe-storm .header,body.vibe-storm .mobileAppTop {
      background:color-mix(in srgb,var(--theme-bg-1) 84%,transparent)!important;
      border-bottom-color:var(--theme-line)!important;
      box-shadow:0 22px 72px rgba(0,0,0,.28),0 0 42px color-mix(in srgb,var(--theme-a) 12%,transparent)!important;
    }

    body.vibe-aurora .glass,body.vibe-aurora .soft,body.vibe-aurora .card,body.vibe-aurora .formBox,body.vibe-aurora .hubCard,body.vibe-aurora .final,body.vibe-aurora .device,body.vibe-aurora .screen,body.vibe-aurora .estimateResult,
    body.vibe-espresso .glass,body.vibe-espresso .soft,body.vibe-espresso .card,body.vibe-espresso .formBox,body.vibe-espresso .hubCard,body.vibe-espresso .final,body.vibe-espresso .device,body.vibe-espresso .screen,body.vibe-espresso .estimateResult,
    body.vibe-citrus .glass,body.vibe-citrus .soft,body.vibe-citrus .card,body.vibe-citrus .formBox,body.vibe-citrus .hubCard,body.vibe-citrus .final,body.vibe-citrus .device,body.vibe-citrus .screen,body.vibe-citrus .estimateResult,
    body.vibe-lavender .glass,body.vibe-lavender .soft,body.vibe-lavender .card,body.vibe-lavender .formBox,body.vibe-lavender .hubCard,body.vibe-lavender .final,body.vibe-lavender .device,body.vibe-lavender .screen,body.vibe-lavender .estimateResult,
    body.vibe-cyber .glass,body.vibe-cyber .soft,body.vibe-cyber .card,body.vibe-cyber .formBox,body.vibe-cyber .hubCard,body.vibe-cyber .final,body.vibe-cyber .device,body.vibe-cyber .screen,body.vibe-cyber .estimateResult,
    body.vibe-cozy .glass,body.vibe-cozy .soft,body.vibe-cozy .card,body.vibe-cozy .formBox,body.vibe-cozy .hubCard,body.vibe-cozy .final,body.vibe-cozy .device,body.vibe-cozy .screen,body.vibe-cozy .estimateResult,
    body.vibe-mint .glass,body.vibe-mint .soft,body.vibe-mint .card,body.vibe-mint .formBox,body.vibe-mint .hubCard,body.vibe-mint .final,body.vibe-mint .device,body.vibe-mint .screen,body.vibe-mint .estimateResult,
    body.vibe-royal .glass,body.vibe-royal .soft,body.vibe-royal .card,body.vibe-royal .formBox,body.vibe-royal .hubCard,body.vibe-royal .final,body.vibe-royal .device,body.vibe-royal .screen,body.vibe-royal .estimateResult,
    body.vibe-peach .glass,body.vibe-peach .soft,body.vibe-peach .card,body.vibe-peach .formBox,body.vibe-peach .hubCard,body.vibe-peach .final,body.vibe-peach .device,body.vibe-peach .screen,body.vibe-peach .estimateResult,
    body.vibe-storm .glass,body.vibe-storm .soft,body.vibe-storm .card,body.vibe-storm .formBox,body.vibe-storm .hubCard,body.vibe-storm .final,body.vibe-storm .device,body.vibe-storm .screen,body.vibe-storm .estimateResult {
      background:var(--theme-card)!important;
      border-color:var(--theme-line)!important;
      border-radius:var(--theme-radius)!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.09),var(--theme-shadow),0 0 74px color-mix(in srgb,var(--theme-a) 18%,transparent)!important;
      backdrop-filter:var(--theme-card-filter)!important;
      -webkit-backdrop-filter:var(--theme-card-filter)!important;
    }

    body.vibe-aurora .primary,body.vibe-espresso .primary,body.vibe-citrus .primary,body.vibe-lavender .primary,body.vibe-cyber .primary,body.vibe-cozy .primary,body.vibe-mint .primary,body.vibe-royal .primary,body.vibe-peach .primary,body.vibe-storm .primary {
      background:var(--theme-btn)!important;
      box-shadow:0 20px 68px color-mix(in srgb,var(--theme-a) 34%,transparent),inset 0 1px 0 rgba(255,255,255,.28)!important;
    }

    body.vibe-aurora .shine,body.vibe-espresso .shine,body.vibe-citrus .shine,body.vibe-lavender .shine,body.vibe-cyber .shine,body.vibe-cozy .shine,body.vibe-mint .shine,body.vibe-royal .shine,body.vibe-peach .shine,body.vibe-storm .shine {
      background:var(--theme-title)!important;
      background-size:240% auto!important;
      -webkit-background-clip:text!important;
      background-clip:text!important;
      color:transparent!important;
    }

    body.vibe-aurora .ghost,body.vibe-aurora .chip,body.vibe-espresso .ghost,body.vibe-espresso .chip,body.vibe-citrus .ghost,body.vibe-citrus .chip,body.vibe-lavender .ghost,body.vibe-lavender .chip,body.vibe-cyber .ghost,body.vibe-cyber .chip,body.vibe-cozy .ghost,body.vibe-cozy .chip,body.vibe-mint .ghost,body.vibe-mint .chip,body.vibe-royal .ghost,body.vibe-royal .chip,body.vibe-peach .ghost,body.vibe-peach .chip,body.vibe-storm .ghost,body.vibe-storm .chip {
      background:var(--theme-surface)!important;
      border-color:var(--theme-line)!important;
      color:var(--theme-muted)!important;
    }

    body.vibe-aurora .field input,body.vibe-aurora .field select,body.vibe-aurora .field textarea,
    body.vibe-espresso .field input,body.vibe-espresso .field select,body.vibe-espresso .field textarea,
    body.vibe-citrus .field input,body.vibe-citrus .field select,body.vibe-citrus .field textarea,
    body.vibe-lavender .field input,body.vibe-lavender .field select,body.vibe-lavender .field textarea,
    body.vibe-cyber .field input,body.vibe-cyber .field select,body.vibe-cyber .field textarea,
    body.vibe-cozy .field input,body.vibe-cozy .field select,body.vibe-cozy .field textarea,
    body.vibe-mint .field input,body.vibe-mint .field select,body.vibe-mint .field textarea,
    body.vibe-royal .field input,body.vibe-royal .field select,body.vibe-royal .field textarea,
    body.vibe-peach .field input,body.vibe-peach .field select,body.vibe-peach .field textarea,
    body.vibe-storm .field input,body.vibe-storm .field select,body.vibe-storm .field textarea {
      background:color-mix(in srgb,var(--theme-surface) 72%,transparent)!important;
      border-color:var(--theme-line)!important;
      color:var(--theme-text)!important;
      border-radius:calc(var(--theme-radius) - 6px)!important;
    }

    body.vibe-aurora .appBottomNav,body.vibe-espresso .appBottomNav,body.vibe-citrus .appBottomNav,body.vibe-lavender .appBottomNav,body.vibe-cyber .appBottomNav,body.vibe-cozy .appBottomNav,body.vibe-mint .appBottomNav,body.vibe-royal .appBottomNav,body.vibe-peach .appBottomNav,body.vibe-storm .appBottomNav,
    body.vibe-aurora .audioDockPanel,body.vibe-aurora .sensoryPanel,body.vibe-espresso .audioDockPanel,body.vibe-espresso .sensoryPanel,body.vibe-citrus .audioDockPanel,body.vibe-citrus .sensoryPanel,body.vibe-lavender .audioDockPanel,body.vibe-lavender .sensoryPanel,body.vibe-cyber .audioDockPanel,body.vibe-cyber .sensoryPanel,body.vibe-cozy .audioDockPanel,body.vibe-cozy .sensoryPanel,body.vibe-mint .audioDockPanel,body.vibe-mint .sensoryPanel,body.vibe-royal .audioDockPanel,body.vibe-royal .sensoryPanel,body.vibe-peach .audioDockPanel,body.vibe-peach .sensoryPanel,body.vibe-storm .audioDockPanel,body.vibe-storm .sensoryPanel {
      background:color-mix(in srgb,var(--theme-bg-1) 88%,transparent)!important;
      border-color:var(--theme-line)!important;
      border-radius:var(--theme-radius)!important;
      box-shadow:0 24px 80px rgba(0,0,0,.52),0 0 48px color-mix(in srgb,var(--theme-a) 16%,transparent)!important;
    }

    body.vibe-aurora .audioMainButton,body.vibe-aurora .sensoryButton,body.vibe-espresso .audioMainButton,body.vibe-espresso .sensoryButton,body.vibe-citrus .audioMainButton,body.vibe-citrus .sensoryButton,body.vibe-lavender .audioMainButton,body.vibe-lavender .sensoryButton,body.vibe-cyber .audioMainButton,body.vibe-cyber .sensoryButton,body.vibe-cozy .audioMainButton,body.vibe-cozy .sensoryButton,body.vibe-mint .audioMainButton,body.vibe-mint .sensoryButton,body.vibe-royal .audioMainButton,body.vibe-royal .sensoryButton,body.vibe-peach .audioMainButton,body.vibe-peach .sensoryButton,body.vibe-storm .audioMainButton,body.vibe-storm .sensoryButton {
      background:var(--theme-btn)!important;
    }

    body.vibe-aurora .sectionTitle::after{background:linear-gradient(90deg,transparent,#8b5cf6,#2dd4bf,#f0abfc,transparent)!important;box-shadow:0 0 36px rgba(45,212,191,.28)!important}
    body.vibe-espresso .sectionTitle::after{background:linear-gradient(90deg,transparent,#7c2d12,#f59e0b,#fed7aa,transparent)!important;box-shadow:0 0 34px rgba(245,158,11,.24)!important}
    body.vibe-citrus .sectionTitle::after{background:linear-gradient(90deg,transparent,#a3e635,#facc15,#22c55e,transparent)!important;box-shadow:0 0 36px rgba(163,230,53,.28)!important}
    body.vibe-lavender .sectionTitle::after{background:linear-gradient(90deg,transparent,#a78bfa,#d8b4fe,#f0abfc,transparent)!important;box-shadow:0 0 36px rgba(216,180,254,.28)!important}
    body.vibe-cyber .sectionTitle::after{background:linear-gradient(90deg,transparent,#00f5ff,#7c3aed,#39ff14,transparent)!important;box-shadow:0 0 40px rgba(0,245,255,.34)!important}
    body.vibe-cozy .sectionTitle::after{background:linear-gradient(90deg,transparent,#f59e0b,#fde68a,#fb7185,transparent)!important;box-shadow:0 0 32px rgba(245,158,11,.24)!important}
    body.vibe-mint .sectionTitle::after{background:linear-gradient(90deg,transparent,#14b8a6,#99f6e4,#5eead4,transparent)!important;box-shadow:0 0 34px rgba(20,184,166,.26)!important}
    body.vibe-royal .sectionTitle::after{background:linear-gradient(90deg,transparent,#6d28d9,#c4b5fd,#e5e7eb,transparent)!important;box-shadow:0 0 32px rgba(109,40,217,.26)!important}
    body.vibe-peach .sectionTitle::after{background:linear-gradient(90deg,transparent,#fb7185,#fdba74,#ffedd5,transparent)!important;box-shadow:0 0 34px rgba(251,113,133,.24)!important}
    body.vibe-storm .sectionTitle::after{background:linear-gradient(90deg,transparent,#2563eb,#64748b,#f8fafc,transparent)!important;box-shadow:0 0 30px rgba(37,99,235,.24)!important}

    body.vibe-aurora .logoIcon,body.vibe-aurora .appIcon,body.vibe-aurora .requestIcon{background:linear-gradient(135deg,#fff,#ddd6fe,#99f6e4)!important}
    body.vibe-espresso .logoIcon,body.vibe-espresso .appIcon,body.vibe-espresso .requestIcon{background:linear-gradient(135deg,#fff7ed,#fed7aa,#b45309)!important}
    body.vibe-citrus .logoIcon,body.vibe-citrus .appIcon,body.vibe-citrus .requestIcon{background:linear-gradient(135deg,#fff,#fef08a,#a3e635)!important}
    body.vibe-lavender .logoIcon,body.vibe-lavender .appIcon,body.vibe-lavender .requestIcon{background:linear-gradient(135deg,#fff,#ede9fe,#d8b4fe)!important}
    body.vibe-cyber .logoIcon,body.vibe-cyber .appIcon,body.vibe-cyber .requestIcon{background:linear-gradient(135deg,#fff,#00f5ff,#39ff14)!important}
    body.vibe-cozy .logoIcon,body.vibe-cozy .appIcon,body.vibe-cozy .requestIcon{background:linear-gradient(135deg,#fff8ee,#fde68a,#fb7185)!important}
    body.vibe-mint .logoIcon,body.vibe-mint .appIcon,body.vibe-mint .requestIcon{background:linear-gradient(135deg,#fff,#ccfbf1,#14b8a6)!important}
    body.vibe-royal .logoIcon,body.vibe-royal .appIcon,body.vibe-royal .requestIcon{background:linear-gradient(135deg,#fff,#ddd6fe,#6d28d9)!important}
    body.vibe-peach .logoIcon,body.vibe-peach .appIcon,body.vibe-peach .requestIcon{background:linear-gradient(135deg,#fff,#ffe4e6,#fdba74)!important}
    body.vibe-storm .logoIcon,body.vibe-storm .appIcon,body.vibe-storm .requestIcon{background:linear-gradient(135deg,#fff,#bfdbfe,#2563eb)!important}

    body.vibe-aurora .v20-showcase,body.vibe-espresso .v20-showcase,body.vibe-citrus .v20-showcase,body.vibe-lavender .v20-showcase,body.vibe-cyber .v20-showcase,body.vibe-cozy .v20-showcase,body.vibe-mint .v20-showcase,body.vibe-royal .v20-showcase,body.vibe-peach .v20-showcase,body.vibe-storm .v20-showcase {
      background:var(--theme-card)!important;
      border-color:var(--theme-line)!important;
      border-radius:var(--theme-radius-lg)!important;
      box-shadow:var(--theme-shadow),0 0 90px color-mix(in srgb,var(--theme-a) 18%,transparent)!important;
    }

    body.vibe-cyber .card,body.vibe-cyber .hubCard,body.vibe-cyber .formBox,body.vibe-cyber .final,body.vibe-cyber .v20-showcase{border-radius:10px!important}
    body.vibe-storm .card,body.vibe-storm .hubCard,body.vibe-storm .formBox,body.vibe-storm .final,body.vibe-storm .v20-showcase{border-radius:14px!important}
    body.vibe-citrus .btn,body.vibe-citrus .chip,body.vibe-mint .btn,body.vibe-mint .chip,body.vibe-peach .btn,body.vibe-peach .chip{border-radius:999px!important}
    body.vibe-cozy .card,body.vibe-cozy .hubCard,body.vibe-cozy .formBox{box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 22px 70px rgba(45,21,7,.38),0 0 50px rgba(245,158,11,.10)!important}

    @media(max-width:720px){
      .themeStudioHeader{align-items:flex-start}
      .moreThemesGrid{max-height:56svh}
      .moreThemesLabel{display:block}
    }


    /* ============================================================
       v30 Effect Themes
       Snow / Rain / Galaxy / Fireflies / Christmas / Blossom
       ============================================================ */

    .effectTheme::before {
      content: "FX";
      position: absolute;
      right: 9px;
      bottom: 9px;
      z-index: 3;
      min-height: 20px;
      padding: 4px 7px;
      border-radius: 999px;
      background: rgba(255,255,255,.13);
      border: 1px solid rgba(255,255,255,.14);
      color: rgba(255,255,255,.76);
      font-size: 9px;
      font-weight: 950;
      letter-spacing: .08em;
    }

    .themeFxLayer {
      position: fixed;
      inset: 0;
      z-index: 2;
      pointer-events: none;
      overflow: hidden;
      contain: strict;
    }

    .themeFxLayer span {
      position: absolute;
      display: block;
      pointer-events: none;
      will-change: transform, opacity;
    }

    body.vibe-snow {
      --theme-bg-1:#06111f;
      --theme-bg-2:#102a43;
      --theme-surface:rgba(240,249,255,.105);
      --theme-line:rgba(226,246,255,.22);
      --theme-line-2:rgba(255,255,255,.38);
      --theme-text:#f7fcff;
      --theme-muted:rgba(247,252,255,.72);
      --theme-a:#bae6fd;
      --theme-b:#e0f2fe;
      --theme-c:#ffffff;
      --theme-good:#dbeafe;
      --theme-radius:28px;
      --theme-radius-lg:50px;
      --theme-shadow:0 30px 96px rgba(0,28,56,.48);
      --theme-card:radial-gradient(680px circle at 16% 0%,rgba(255,255,255,.18),transparent 48%),radial-gradient(620px circle at 100% 30%,rgba(186,230,253,.16),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.12),rgba(224,242,254,.04));
      --theme-btn:linear-gradient(135deg,#38bdf8 0%,#bae6fd 52%,#ffffff 128%);
      --theme-title:linear-gradient(90deg,#fff 0%,#e0f2fe 26%,#7dd3fc 54%,#fff 82%,#fff 100%);
      --theme-pattern-opacity:.30;
      --theme-card-filter:blur(28px) saturate(1.10);
    }

    body.vibe-rain {
      --theme-bg-1:#030712;
      --theme-bg-2:#111827;
      --theme-surface:rgba(147,197,253,.076);
      --theme-line:rgba(147,197,253,.16);
      --theme-line-2:rgba(191,219,254,.28);
      --theme-text:#f3f8ff;
      --theme-muted:rgba(243,248,255,.66);
      --theme-a:#60a5fa;
      --theme-b:#38bdf8;
      --theme-c:#94a3b8;
      --theme-good:#93c5fd;
      --theme-radius:18px;
      --theme-radius-lg:28px;
      --theme-shadow:0 30px 100px rgba(0,0,0,.64);
      --theme-card:linear-gradient(180deg,rgba(147,197,253,.095),rgba(15,23,42,.56)),radial-gradient(650px circle at 18% 0%,rgba(56,189,248,.12),transparent 48%);
      --theme-btn:linear-gradient(135deg,#1d4ed8 0%,#60a5fa 54%,#38bdf8 120%);
      --theme-title:linear-gradient(90deg,#fff 0%,#bfdbfe 28%,#60a5fa 56%,#38bdf8 82%,#fff 100%);
      --theme-pattern-opacity:.18;
      --theme-card-filter:blur(15px) contrast(1.08);
    }

    body.vibe-galaxy {
      --theme-bg-1:#030014;
      --theme-bg-2:#12052e;
      --theme-surface:rgba(168,85,247,.086);
      --theme-line:rgba(216,180,254,.18);
      --theme-line-2:rgba(244,114,182,.30);
      --theme-text:#fff8ff;
      --theme-muted:rgba(255,248,255,.68);
      --theme-a:#7c3aed;
      --theme-b:#ec4899;
      --theme-c:#22d3ee;
      --theme-good:#c084fc;
      --theme-radius:34px;
      --theme-radius-lg:62px;
      --theme-shadow:0 30px 104px rgba(15,0,36,.62);
      --theme-card:radial-gradient(720px circle at 16% 0%,rgba(124,58,237,.24),transparent 48%),radial-gradient(640px circle at 100% 25%,rgba(236,72,153,.14),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.10),rgba(124,58,237,.035));
      --theme-btn:linear-gradient(135deg,#7c3aed 0%,#ec4899 56%,#22d3ee 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#ddd6fe 26%,#ec4899 52%,#22d3ee 80%,#fff 100%);
      --theme-pattern-opacity:.28;
      --theme-card-filter:blur(24px) saturate(1.34);
    }

    body.vibe-fireflies {
      --theme-bg-1:#050f08;
      --theme-bg-2:#13240e;
      --theme-surface:rgba(254,240,138,.076);
      --theme-line:rgba(254,240,138,.16);
      --theme-line-2:rgba(190,242,100,.30);
      --theme-text:#ffffef;
      --theme-muted:rgba(255,255,239,.68);
      --theme-a:#84cc16;
      --theme-b:#facc15;
      --theme-c:#fde68a;
      --theme-good:#bef264;
      --theme-radius:30px;
      --theme-radius-lg:54px;
      --theme-shadow:0 28px 96px rgba(0,30,9,.54);
      --theme-card:radial-gradient(650px circle at 12% 0%,rgba(132,204,22,.16),transparent 48%),radial-gradient(520px circle at 100% 20%,rgba(250,204,21,.11),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.09),rgba(132,204,22,.035));
      --theme-btn:linear-gradient(135deg,#3f6212 0%,#84cc16 50%,#facc15 126%);
      --theme-title:linear-gradient(90deg,#fff 0%,#ecfccb 28%,#84cc16 54%,#facc15 80%,#fff 100%);
      --theme-pattern-opacity:.22;
      --theme-card-filter:blur(20px) saturate(1.18);
    }

    body.vibe-christmas {
      --theme-bg-1:#07120d;
      --theme-bg-2:#1a2714;
      --theme-surface:rgba(254,226,226,.080);
      --theme-line:rgba(254,226,226,.17);
      --theme-line-2:rgba(255,255,255,.30);
      --theme-text:#fffaf5;
      --theme-muted:rgba(255,250,245,.68);
      --theme-a:#dc2626;
      --theme-b:#16a34a;
      --theme-c:#fbbf24;
      --theme-good:#bbf7d0;
      --theme-radius:26px;
      --theme-radius-lg:46px;
      --theme-shadow:0 30px 100px rgba(20,0,0,.54);
      --theme-card:radial-gradient(650px circle at 12% 0%,rgba(220,38,38,.16),transparent 48%),radial-gradient(520px circle at 100% 20%,rgba(22,163,74,.14),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.10),rgba(220,38,38,.034));
      --theme-btn:linear-gradient(135deg,#b91c1c 0%,#16a34a 58%,#fbbf24 128%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fee2e2 26%,#dc2626 48%,#16a34a 72%,#fff 100%);
      --theme-pattern-opacity:.30;
      --theme-card-filter:blur(22px) saturate(1.24);
    }

    body.vibe-blossom {
      --theme-bg-1:#160914;
      --theme-bg-2:#331426;
      --theme-surface:rgba(251,207,232,.090);
      --theme-line:rgba(251,207,232,.19);
      --theme-line-2:rgba(255,228,230,.32);
      --theme-text:#fff7fb;
      --theme-muted:rgba(255,247,251,.70);
      --theme-a:#f472b6;
      --theme-b:#fb7185;
      --theme-c:#fecdd3;
      --theme-good:#fbcfe8;
      --theme-radius:38px;
      --theme-radius-lg:68px;
      --theme-shadow:0 28px 96px rgba(52,9,34,.52);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(244,114,182,.20),transparent 48%),radial-gradient(540px circle at 100% 20%,rgba(251,113,133,.14),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.11),rgba(244,114,182,.035));
      --theme-btn:linear-gradient(135deg,#f472b6 0%,#fb7185 58%,#fecdd3 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fce7f3 28%,#f472b6 54%,#fb7185 78%,#fff 100%);
      --theme-pattern-opacity:.30;
      --theme-card-filter:blur(24px) saturate(1.20);
    }

    body.vibe-snow,
    body.vibe-rain,
    body.vibe-galaxy,
    body.vibe-fireflies,
    body.vibe-christmas,
    body.vibe-blossom {
      color:var(--theme-text)!important;
      background:
        radial-gradient(1120px circle at 10% -10%,color-mix(in srgb,var(--theme-a) 38%,transparent),transparent 45%),
        radial-gradient(900px circle at 96% 8%,color-mix(in srgb,var(--theme-b) 25%,transparent),transparent 42%),
        radial-gradient(780px circle at 50% 108%,color-mix(in srgb,var(--theme-c) 18%,transparent),transparent 52%),
        linear-gradient(180deg,var(--theme-bg-1),var(--theme-bg-2) 46%,var(--theme-bg-1))!important;
    }

    body.vibe-snow .header,body.vibe-snow .mobileAppTop,
    body.vibe-rain .header,body.vibe-rain .mobileAppTop,
    body.vibe-galaxy .header,body.vibe-galaxy .mobileAppTop,
    body.vibe-fireflies .header,body.vibe-fireflies .mobileAppTop,
    body.vibe-christmas .header,body.vibe-christmas .mobileAppTop,
    body.vibe-blossom .header,body.vibe-blossom .mobileAppTop {
      background:color-mix(in srgb,var(--theme-bg-1) 84%,transparent)!important;
      border-bottom-color:var(--theme-line)!important;
      box-shadow:0 22px 72px rgba(0,0,0,.28),0 0 42px color-mix(in srgb,var(--theme-a) 12%,transparent)!important;
    }

    body.vibe-snow .glass,body.vibe-snow .soft,body.vibe-snow .card,body.vibe-snow .formBox,body.vibe-snow .hubCard,body.vibe-snow .final,body.vibe-snow .device,body.vibe-snow .screen,body.vibe-snow .estimateResult,
    body.vibe-rain .glass,body.vibe-rain .soft,body.vibe-rain .card,body.vibe-rain .formBox,body.vibe-rain .hubCard,body.vibe-rain .final,body.vibe-rain .device,body.vibe-rain .screen,body.vibe-rain .estimateResult,
    body.vibe-galaxy .glass,body.vibe-galaxy .soft,body.vibe-galaxy .card,body.vibe-galaxy .formBox,body.vibe-galaxy .hubCard,body.vibe-galaxy .final,body.vibe-galaxy .device,body.vibe-galaxy .screen,body.vibe-galaxy .estimateResult,
    body.vibe-fireflies .glass,body.vibe-fireflies .soft,body.vibe-fireflies .card,body.vibe-fireflies .formBox,body.vibe-fireflies .hubCard,body.vibe-fireflies .final,body.vibe-fireflies .device,body.vibe-fireflies .screen,body.vibe-fireflies .estimateResult,
    body.vibe-christmas .glass,body.vibe-christmas .soft,body.vibe-christmas .card,body.vibe-christmas .formBox,body.vibe-christmas .hubCard,body.vibe-christmas .final,body.vibe-christmas .device,body.vibe-christmas .screen,body.vibe-christmas .estimateResult,
    body.vibe-blossom .glass,body.vibe-blossom .soft,body.vibe-blossom .card,body.vibe-blossom .formBox,body.vibe-blossom .hubCard,body.vibe-blossom .final,body.vibe-blossom .device,body.vibe-blossom .screen,body.vibe-blossom .estimateResult {
      background:var(--theme-card)!important;
      border-color:var(--theme-line)!important;
      border-radius:var(--theme-radius)!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.09),var(--theme-shadow),0 0 74px color-mix(in srgb,var(--theme-a) 18%,transparent)!important;
      backdrop-filter:var(--theme-card-filter)!important;
      -webkit-backdrop-filter:var(--theme-card-filter)!important;
    }

    body.vibe-snow .primary,body.vibe-rain .primary,body.vibe-galaxy .primary,body.vibe-fireflies .primary,body.vibe-christmas .primary,body.vibe-blossom .primary {
      background:var(--theme-btn)!important;
      box-shadow:0 20px 68px color-mix(in srgb,var(--theme-a) 34%,transparent),inset 0 1px 0 rgba(255,255,255,.28)!important;
    }

    body.vibe-snow .shine,body.vibe-rain .shine,body.vibe-galaxy .shine,body.vibe-fireflies .shine,body.vibe-christmas .shine,body.vibe-blossom .shine {
      background:var(--theme-title)!important;
      background-size:240% auto!important;
      -webkit-background-clip:text!important;
      background-clip:text!important;
      color:transparent!important;
    }

    body.vibe-snow .ghost,body.vibe-snow .chip,body.vibe-rain .ghost,body.vibe-rain .chip,body.vibe-galaxy .ghost,body.vibe-galaxy .chip,body.vibe-fireflies .ghost,body.vibe-fireflies .chip,body.vibe-christmas .ghost,body.vibe-christmas .chip,body.vibe-blossom .ghost,body.vibe-blossom .chip {
      background:var(--theme-surface)!important;
      border-color:var(--theme-line)!important;
      color:var(--theme-muted)!important;
    }

    body.vibe-snow .sectionTitle::after{background:linear-gradient(90deg,transparent,#bae6fd,#fff,#7dd3fc,transparent)!important;box-shadow:0 0 36px rgba(186,230,253,.30)!important}
    body.vibe-rain .sectionTitle::after{background:linear-gradient(90deg,transparent,#60a5fa,#38bdf8,#94a3b8,transparent)!important;box-shadow:0 0 34px rgba(96,165,250,.26)!important}
    body.vibe-galaxy .sectionTitle::after{background:linear-gradient(90deg,transparent,#7c3aed,#ec4899,#22d3ee,transparent)!important;box-shadow:0 0 40px rgba(236,72,153,.26)!important}
    body.vibe-fireflies .sectionTitle::after{background:linear-gradient(90deg,transparent,#84cc16,#facc15,#fde68a,transparent)!important;box-shadow:0 0 36px rgba(250,204,21,.26)!important}
    body.vibe-christmas .sectionTitle::after{background:linear-gradient(90deg,transparent,#dc2626,#16a34a,#fbbf24,transparent)!important;box-shadow:0 0 36px rgba(220,38,38,.24)!important}
    body.vibe-blossom .sectionTitle::after{background:linear-gradient(90deg,transparent,#f472b6,#fb7185,#fecdd3,transparent)!important;box-shadow:0 0 36px rgba(244,114,182,.26)!important}

    body.vibe-snow .logoIcon,body.vibe-snow .appIcon,body.vibe-snow .requestIcon{background:linear-gradient(135deg,#fff,#e0f2fe,#bae6fd)!important}
    body.vibe-rain .logoIcon,body.vibe-rain .appIcon,body.vibe-rain .requestIcon{background:linear-gradient(135deg,#fff,#bfdbfe,#60a5fa)!important}
    body.vibe-galaxy .logoIcon,body.vibe-galaxy .appIcon,body.vibe-galaxy .requestIcon{background:linear-gradient(135deg,#fff,#ddd6fe,#ec4899)!important}
    body.vibe-fireflies .logoIcon,body.vibe-fireflies .appIcon,body.vibe-fireflies .requestIcon{background:linear-gradient(135deg,#fff,#ecfccb,#facc15)!important}
    body.vibe-christmas .logoIcon,body.vibe-christmas .appIcon,body.vibe-christmas .requestIcon{background:linear-gradient(135deg,#fff,#fee2e2,#bbf7d0)!important}
    body.vibe-blossom .logoIcon,body.vibe-blossom .appIcon,body.vibe-blossom .requestIcon{background:linear-gradient(135deg,#fff,#fce7f3,#fecdd3)!important}

    body.vibe-snow .v20-showcase,body.vibe-rain .v20-showcase,body.vibe-galaxy .v20-showcase,body.vibe-fireflies .v20-showcase,body.vibe-christmas .v20-showcase,body.vibe-blossom .v20-showcase {
      background:var(--theme-card)!important;
      border-color:var(--theme-line)!important;
      border-radius:var(--theme-radius-lg)!important;
      box-shadow:var(--theme-shadow),0 0 90px color-mix(in srgb,var(--theme-a) 18%,transparent)!important;
    }

    .themeFxLayer[data-effect="snow"] .fxParticle {
      width: var(--s, 6px);
      height: var(--s, 6px);
      left: var(--x, 50%);
      top: -8vh;
      border-radius: 999px;
      background: rgba(255,255,255,.92);
      box-shadow: 0 0 16px rgba(255,255,255,.45);
      opacity: var(--o, .8);
      animation: fxSnowFall var(--d, 10s) linear infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes fxSnowFall {
      0% { transform: translate3d(0,-8vh,0); }
      100% { transform: translate3d(var(--drift, 24px),112vh,0); }
    }

    .themeFxLayer[data-effect="rain"] .fxParticle {
      width: 1.5px;
      height: var(--h, 54px);
      left: var(--x, 50%);
      top: -15vh;
      border-radius: 999px;
      background: linear-gradient(180deg, transparent, rgba(191,219,254,.82));
      opacity: var(--o, .6);
      transform: rotate(12deg);
      animation: fxRainFall var(--d, 1.2s) linear infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes fxRainFall {
      to { transform: translate3d(-80px,120vh,0) rotate(12deg); }
    }

    .themeFxLayer[data-effect="galaxy"] .fxParticle {
      width: var(--s, 3px);
      height: var(--s, 3px);
      left: var(--x, 50%);
      top: var(--y, 50%);
      border-radius: 999px;
      background: rgba(255,255,255,.92);
      box-shadow: 0 0 18px color-mix(in srgb, var(--theme-c, #22d3ee) 60%, white);
      opacity: var(--o, .7);
      animation: fxStarTwinkle var(--d, 3s) ease-in-out infinite;
      animation-delay: var(--delay, 0s);
    }

    .themeFxLayer[data-effect="galaxy"] .fxParticle:nth-child(9n) {
      width: 82px;
      height: 2px;
      border-radius: 999px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.85), transparent);
      animation: fxComet 7s linear infinite;
    }

    @keyframes fxStarTwinkle {
      0%,100% { opacity: .18; transform: scale(.9); }
      50% { opacity: 1; transform: scale(1.45); }
    }

    @keyframes fxComet {
      0% { transform: translate3d(-20vw,-10vh,0) rotate(-22deg); opacity:0; }
      12% { opacity:.9; }
      35%,100% { transform: translate3d(120vw,70vh,0) rotate(-22deg); opacity:0; }
    }

    .themeFxLayer[data-effect="fireflies"] .fxParticle {
      width: var(--s, 7px);
      height: var(--s, 7px);
      left: var(--x, 50%);
      top: var(--y, 50%);
      border-radius: 999px;
      background: #facc15;
      box-shadow: 0 0 22px #facc15, 0 0 54px rgba(250,204,21,.42);
      opacity: .75;
      animation: fxFirefly var(--d, 8s) ease-in-out infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes fxFirefly {
      0%,100% { transform: translate3d(0,0,0) scale(.75); opacity:.25; }
      35% { transform: translate3d(var(--drift, 28px),-36px,0) scale(1.2); opacity:1; }
      70% { transform: translate3d(calc(var(--drift, 28px) * -1),24px,0) scale(.9); opacity:.55; }
    }

    .themeFxLayer[data-effect="christmas"] .fxParticle {
      width: var(--s, 10px);
      height: var(--s, 10px);
      left: var(--x, 50%);
      top: var(--y, 16%);
      border-radius: 999px;
      background: var(--c, #fbbf24);
      box-shadow: 0 0 18px var(--c, #fbbf24), 0 0 42px color-mix(in srgb, var(--c, #fbbf24) 55%, transparent);
      animation: fxHolidayLight var(--d, 2.2s) ease-in-out infinite;
      animation-delay: var(--delay, 0s);
    }

    .themeFxLayer[data-effect="christmas"] .fxParticle:nth-child(n+26) {
      top: -8vh;
      background: rgba(255,255,255,.9);
      animation: fxSnowFall var(--d, 11s) linear infinite;
    }

    @keyframes fxHolidayLight {
      0%,100% { opacity:.28; transform: scale(.82); }
      50% { opacity:1; transform: scale(1.25); }
    }

    .themeFxLayer[data-effect="blossom"] .fxParticle {
      width: var(--s, 13px);
      height: calc(var(--s, 13px) * .72);
      left: var(--x, 50%);
      top: -10vh;
      border-radius: 999px 999px 999px 0;
      background: rgba(251,207,232,.92);
      box-shadow: 0 0 16px rgba(251,207,232,.28);
      opacity: var(--o, .75);
      transform: rotate(30deg);
      animation: fxPetalFall var(--d, 11s) linear infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes fxPetalFall {
      0% { transform: translate3d(0,-10vh,0) rotate(0deg); }
      100% { transform: translate3d(var(--drift, 70px),112vh,0) rotate(720deg); }
    }

    body.v22-reduced-sensory .themeFxLayer { display:none!important; }

    @media (prefers-reduced-motion: reduce) {
      .themeFxLayer { display:none!important; }
    }

    @media(max-width:720px){
      .themeFxLayer[data-effect="rain"] .fxParticle:nth-child(n+38),
      .themeFxLayer[data-effect="snow"] .fxParticle:nth-child(n+34),
      .themeFxLayer[data-effect="galaxy"] .fxParticle:nth-child(n+40),
      .themeFxLayer[data-effect="fireflies"] .fxParticle:nth-child(n+24),
      .themeFxLayer[data-effect="christmas"] .fxParticle:nth-child(n+36),
      .themeFxLayer[data-effect="blossom"] .fxParticle:nth-child(n+30) {
        display:none;
      }
    }


    /* ============================================================
       v31 Categorized Theme Gallery + More Effect Themes
       ============================================================ */

    .themeGalleryPanel {
      max-height: min(620px, 68svh);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }

    .themeGallery {
      display: grid;
      gap: 12px;
    }

    .themeCategory {
      padding: 12px;
      border-radius: 22px;
      background:
        radial-gradient(420px circle at 0% 0%, color-mix(in srgb, var(--theme-a, #7c5cff) 10%, transparent), transparent 48%),
        rgba(255,255,255,.040);
      border: 1px solid rgba(255,255,255,.075);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
    }

    .themeCategoryHead {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 10px;
      padding: 10px;
      border-radius: 18px;
      background: rgba(0,0,0,.13);
      border: 1px solid rgba(255,255,255,.06);
    }

    .themeCategoryHead strong {
      display: block;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 18px;
      line-height: 1;
      letter-spacing: -.045em;
    }

    .themeCategoryHead span {
      display: block;
      max-width: 230px;
      color: rgba(255,255,255,.44);
      font-size: 11px;
      line-height: 1.35;
      font-weight: 750;
      text-align: right;
    }

    .themeCategoryGrid {
      max-height: none;
      overflow: visible;
      padding-right: 0;
    }

    .themeCategoryGrid .sensoryOption {
      min-height: 86px;
    }

    .themeCategoryGrid .sensoryOption span {
      min-height: 26px;
    }

    .themeIdea {
      display: block;
      margin-top: 6px;
      color: rgba(255,255,255,.40);
      font-size: 10px;
      line-height: 1.25;
      font-weight: 800;
    }

    body.vibe-fog {
      --theme-bg-1:#07111a;
      --theme-bg-2:#17212b;
      --theme-surface:rgba(226,232,240,.078);
      --theme-line:rgba(226,232,240,.16);
      --theme-line-2:rgba(248,250,252,.28);
      --theme-text:#f8fafc;
      --theme-muted:rgba(248,250,252,.66);
      --theme-a:#94a3b8;
      --theme-b:#cbd5e1;
      --theme-c:#e2e8f0;
      --theme-good:#cbd5e1;
      --theme-radius:32px;
      --theme-radius-lg:58px;
      --theme-shadow:0 30px 100px rgba(0,0,0,.54);
      --theme-card:radial-gradient(760px circle at 16% 0%,rgba(226,232,240,.14),transparent 48%),linear-gradient(180deg,rgba(255,255,255,.095),rgba(148,163,184,.038));
      --theme-btn:linear-gradient(135deg,#64748b 0%,#cbd5e1 58%,#f8fafc 126%);
      --theme-title:linear-gradient(90deg,#fff 0%,#e2e8f0 30%,#94a3b8 58%,#fff 82%,#fff 100%);
      --theme-pattern-opacity:.14;
      --theme-card-filter:blur(32px) saturate(1.02);
    }

    body.vibe-desert {
      --theme-bg-1:#160b05;
      --theme-bg-2:#3a200c;
      --theme-surface:rgba(253,186,116,.080);
      --theme-line:rgba(253,186,116,.18);
      --theme-line-2:rgba(254,215,170,.32);
      --theme-text:#fff7ed;
      --theme-muted:rgba(255,247,237,.68);
      --theme-a:#f97316;
      --theme-b:#facc15;
      --theme-c:#fed7aa;
      --theme-good:#fdba74;
      --theme-radius:20px;
      --theme-radius-lg:34px;
      --theme-shadow:0 30px 96px rgba(44,18,3,.58);
      --theme-card:radial-gradient(680px circle at 18% 0%,rgba(249,115,22,.18),transparent 48%),radial-gradient(600px circle at 100% 20%,rgba(250,204,21,.12),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.09),rgba(249,115,22,.035));
      --theme-btn:linear-gradient(135deg,#c2410c 0%,#f97316 52%,#facc15 125%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fed7aa 28%,#f97316 56%,#facc15 82%,#fff 100%);
      --theme-pattern-opacity:.26;
      --theme-card-filter:blur(16px) saturate(1.18);
    }

    body.vibe-meteor {
      --theme-bg-1:#02000d;
      --theme-bg-2:#0b1026;
      --theme-surface:rgba(96,165,250,.072);
      --theme-line:rgba(147,197,253,.16);
      --theme-line-2:rgba(248,250,252,.28);
      --theme-text:#f8fbff;
      --theme-muted:rgba(248,251,255,.66);
      --theme-a:#3b82f6;
      --theme-b:#f97316;
      --theme-c:#ffffff;
      --theme-good:#93c5fd;
      --theme-radius:18px;
      --theme-radius-lg:30px;
      --theme-shadow:0 30px 104px rgba(0,0,0,.66);
      --theme-card:radial-gradient(720px circle at 16% 0%,rgba(59,130,246,.18),transparent 48%),radial-gradient(640px circle at 100% 20%,rgba(249,115,22,.10),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.08),rgba(15,23,42,.48));
      --theme-btn:linear-gradient(135deg,#1d4ed8 0%,#3b82f6 52%,#f97316 124%);
      --theme-title:linear-gradient(90deg,#fff 0%,#bfdbfe 28%,#3b82f6 54%,#f97316 78%,#fff 100%);
      --theme-pattern-opacity:.20;
      --theme-card-filter:blur(12px) contrast(1.16);
    }

    body.vibe-autumn {
      --theme-bg-1:#130b04;
      --theme-bg-2:#2b1708;
      --theme-surface:rgba(251,146,60,.080);
      --theme-line:rgba(251,146,60,.18);
      --theme-line-2:rgba(253,186,116,.30);
      --theme-text:#fff7ed;
      --theme-muted:rgba(255,247,237,.68);
      --theme-a:#ea580c;
      --theme-b:#b45309;
      --theme-c:#f59e0b;
      --theme-good:#fdba74;
      --theme-radius:26px;
      --theme-radius-lg:46px;
      --theme-shadow:0 30px 96px rgba(45,18,3,.58);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(234,88,12,.18),transparent 48%),radial-gradient(520px circle at 100% 20%,rgba(245,158,11,.12),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.09),rgba(234,88,12,.034));
      --theme-btn:linear-gradient(135deg,#9a3412 0%,#ea580c 56%,#f59e0b 125%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fed7aa 28%,#ea580c 56%,#f59e0b 80%,#fff 100%);
      --theme-pattern-opacity:.25;
      --theme-card-filter:blur(18px) saturate(1.14);
    }

    body.vibe-bubbles {
      --theme-bg-1:#03131a;
      --theme-bg-2:#083344;
      --theme-surface:rgba(103,232,249,.088);
      --theme-line:rgba(103,232,249,.20);
      --theme-line-2:rgba(224,242,254,.34);
      --theme-text:#f0fdff;
      --theme-muted:rgba(240,253,255,.70);
      --theme-a:#06b6d4;
      --theme-b:#67e8f9;
      --theme-c:#d9f99d;
      --theme-good:#a7f3d0;
      --theme-radius:42px;
      --theme-radius-lg:72px;
      --theme-shadow:0 28px 96px rgba(0,49,64,.50);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(103,232,249,.18),transparent 48%),radial-gradient(540px circle at 100% 20%,rgba(217,249,157,.10),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.12),rgba(103,232,249,.034));
      --theme-btn:linear-gradient(135deg,#0891b2 0%,#67e8f9 58%,#d9f99d 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#cffafe 28%,#06b6d4 54%,#d9f99d 80%,#fff 100%);
      --theme-pattern-opacity:.28;
      --theme-card-filter:blur(26px) saturate(1.22);
    }

    body.vibe-confetti {
      --theme-bg-1:#12051f;
      --theme-bg-2:#2e1065;
      --theme-surface:rgba(255,255,255,.10);
      --theme-line:rgba(255,255,255,.18);
      --theme-line-2:rgba(255,255,255,.34);
      --theme-text:#fff7ff;
      --theme-muted:rgba(255,247,255,.70);
      --theme-a:#ec4899;
      --theme-b:#8b5cf6;
      --theme-c:#facc15;
      --theme-good:#22c55e;
      --theme-radius:34px;
      --theme-radius-lg:64px;
      --theme-shadow:0 28px 96px rgba(46,10,80,.54);
      --theme-card:radial-gradient(600px circle at 18% 0%,rgba(236,72,153,.22),transparent 48%),radial-gradient(560px circle at 96% 22%,rgba(250,204,21,.16),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.045));
      --theme-btn:linear-gradient(135deg,#ec4899 0%,#8b5cf6 52%,#facc15 126%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fbcfe8 24%,#ec4899 48%,#8b5cf6 72%,#fff 100%);
      --theme-pattern-opacity:.34;
      --theme-card-filter:blur(24px) saturate(1.38);
    }

    body.vibe-laser {
      --theme-bg-1:#02030a;
      --theme-bg-2:#09011f;
      --theme-surface:rgba(0,255,255,.070);
      --theme-line:rgba(0,255,255,.20);
      --theme-line-2:rgba(255,0,200,.30);
      --theme-text:#f8ffff;
      --theme-muted:rgba(248,255,255,.66);
      --theme-a:#00f5ff;
      --theme-b:#ff00c8;
      --theme-c:#39ff14;
      --theme-good:#39ff14;
      --theme-radius:8px;
      --theme-radius-lg:12px;
      --theme-shadow:0 30px 104px rgba(0,0,0,.70);
      --theme-card:linear-gradient(180deg,rgba(0,245,255,.09),rgba(255,0,200,.035)),radial-gradient(650px circle at 18% 0%,rgba(57,255,20,.08),transparent 48%);
      --theme-btn:linear-gradient(135deg,#00f5ff 0%,#ff00c8 56%,#39ff14 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#00f5ff 30%,#ff00c8 58%,#39ff14 82%,#fff 100%);
      --theme-pattern-opacity:.42;
      --theme-card-filter:blur(8px) contrast(1.25) saturate(1.5);
    }

    body.vibe-matrix {
      --theme-bg-1:#000704;
      --theme-bg-2:#00150a;
      --theme-surface:rgba(34,197,94,.060);
      --theme-line:rgba(34,197,94,.18);
      --theme-line-2:rgba(187,247,208,.30);
      --theme-text:#f0fff4;
      --theme-muted:rgba(240,255,244,.62);
      --theme-a:#22c55e;
      --theme-b:#16a34a;
      --theme-c:#bbf7d0;
      --theme-good:#4ade80;
      --theme-radius:6px;
      --theme-radius-lg:10px;
      --theme-shadow:0 30px 104px rgba(0,0,0,.72);
      --theme-card:linear-gradient(180deg,rgba(34,197,94,.08),rgba(0,0,0,.46));
      --theme-btn:linear-gradient(135deg,#14532d 0%,#22c55e 70%,#bbf7d0 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#bbf7d0 30%,#22c55e 58%,#16a34a 82%,#fff 100%);
      --theme-pattern-opacity:.34;
      --theme-card-filter:blur(6px) contrast(1.26);
    }

    body.vibe-arcade {
      --theme-bg-1:#10021f;
      --theme-bg-2:#250a3d;
      --theme-surface:rgba(255,255,255,.090);
      --theme-line:rgba(244,114,182,.18);
      --theme-line-2:rgba(56,189,248,.30);
      --theme-text:#fff7ff;
      --theme-muted:rgba(255,247,255,.68);
      --theme-a:#f472b6;
      --theme-b:#38bdf8;
      --theme-c:#facc15;
      --theme-good:#a3e635;
      --theme-radius:14px;
      --theme-radius-lg:22px;
      --theme-shadow:0 28px 96px rgba(40,8,70,.56);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(244,114,182,.18),transparent 48%),radial-gradient(540px circle at 100% 20%,rgba(56,189,248,.14),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.10),rgba(244,114,182,.034));
      --theme-btn:linear-gradient(135deg,#f472b6 0%,#38bdf8 58%,#facc15 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#f9a8d4 28%,#38bdf8 54%,#facc15 80%,#fff 100%);
      --theme-pattern-opacity:.38;
      --theme-card-filter:blur(12px) saturate(1.34);
    }

    body.vibe-valentine {
      --theme-bg-1:#190511;
      --theme-bg-2:#3a0d22;
      --theme-surface:rgba(251,207,232,.090);
      --theme-line:rgba(251,207,232,.19);
      --theme-line-2:rgba(255,228,230,.32);
      --theme-text:#fff7fb;
      --theme-muted:rgba(255,247,251,.70);
      --theme-a:#ec4899;
      --theme-b:#fb7185;
      --theme-c:#fecdd3;
      --theme-good:#fbcfe8;
      --theme-radius:42px;
      --theme-radius-lg:74px;
      --theme-shadow:0 28px 96px rgba(52,9,34,.54);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(236,72,153,.22),transparent 48%),radial-gradient(540px circle at 100% 20%,rgba(251,113,133,.15),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.12),rgba(236,72,153,.035));
      --theme-btn:linear-gradient(135deg,#ec4899 0%,#fb7185 58%,#fecdd3 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fce7f3 28%,#ec4899 54%,#fb7185 78%,#fff 100%);
      --theme-pattern-opacity:.30;
      --theme-card-filter:blur(24px) saturate(1.22);
    }

    body.vibe-halloween {
      --theme-bg-1:#0c0502;
      --theme-bg-2:#1f1005;
      --theme-surface:rgba(251,146,60,.080);
      --theme-line:rgba(251,146,60,.18);
      --theme-line-2:rgba(168,85,247,.30);
      --theme-text:#fff7ed;
      --theme-muted:rgba(255,247,237,.68);
      --theme-a:#f97316;
      --theme-b:#7c3aed;
      --theme-c:#facc15;
      --theme-good:#fdba74;
      --theme-radius:18px;
      --theme-radius-lg:30px;
      --theme-shadow:0 30px 100px rgba(0,0,0,.66);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(249,115,22,.18),transparent 48%),radial-gradient(540px circle at 100% 20%,rgba(124,58,237,.12),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.09),rgba(249,115,22,.034));
      --theme-btn:linear-gradient(135deg,#f97316 0%,#7c3aed 58%,#facc15 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fed7aa 28%,#f97316 54%,#7c3aed 78%,#fff 100%);
      --theme-pattern-opacity:.26;
      --theme-card-filter:blur(14px) contrast(1.14);
    }

    body.vibe-patriotic {
      --theme-bg-1:#020617;
      --theme-bg-2:#111827;
      --theme-surface:rgba(239,246,255,.076);
      --theme-line:rgba(191,219,254,.18);
      --theme-line-2:rgba(254,226,226,.30);
      --theme-text:#f8fbff;
      --theme-muted:rgba(248,251,255,.68);
      --theme-a:#2563eb;
      --theme-b:#dc2626;
      --theme-c:#ffffff;
      --theme-good:#93c5fd;
      --theme-radius:18px;
      --theme-radius-lg:30px;
      --theme-shadow:0 30px 100px rgba(0,0,0,.64);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(37,99,235,.17),transparent 48%),radial-gradient(540px circle at 100% 20%,rgba(220,38,38,.10),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.09),rgba(37,99,235,.034));
      --theme-btn:linear-gradient(135deg,#2563eb 0%,#ffffff 52%,#dc2626 120%);
      --theme-title:linear-gradient(90deg,#fff 0%,#bfdbfe 28%,#2563eb 48%,#dc2626 76%,#fff 100%);
      --theme-pattern-opacity:.24;
      --theme-card-filter:blur(16px) saturate(1.10);
    }

    body.vibe-birthday {
      --theme-bg-1:#14051f;
      --theme-bg-2:#2e1065;
      --theme-surface:rgba(255,255,255,.10);
      --theme-line:rgba(255,255,255,.18);
      --theme-line-2:rgba(255,255,255,.34);
      --theme-text:#fff7ff;
      --theme-muted:rgba(255,247,255,.70);
      --theme-a:#f472b6;
      --theme-b:#a78bfa;
      --theme-c:#facc15;
      --theme-good:#22c55e;
      --theme-radius:36px;
      --theme-radius-lg:68px;
      --theme-shadow:0 28px 96px rgba(46,10,80,.54);
      --theme-card:radial-gradient(600px circle at 18% 0%,rgba(244,114,182,.22),transparent 48%),radial-gradient(560px circle at 96% 22%,rgba(250,204,21,.16),transparent 50%),linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.045));
      --theme-btn:linear-gradient(135deg,#f472b6 0%,#a78bfa 52%,#facc15 126%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fbcfe8 24%,#f472b6 48%,#a78bfa 72%,#fff 100%);
      --theme-pattern-opacity:.34;
      --theme-card-filter:blur(24px) saturate(1.38);
    }

    body.vibe-summer {
      --theme-bg-1:#06121b;
      --theme-bg-2:#12304a;
      --theme-surface:rgba(253,186,116,.084);
      --theme-line:rgba(253,186,116,.18);
      --theme-line-2:rgba(125,211,252,.30);
      --theme-text:#fffaf0;
      --theme-muted:rgba(255,250,240,.70);
      --theme-a:#f59e0b;
      --theme-b:#38bdf8;
      --theme-c:#fde68a;
      --theme-good:#7dd3fc;
      --theme-radius:34px;
      --theme-radius-lg:62px;
      --theme-shadow:0 28px 96px rgba(0,36,65,.50);
      --theme-card:radial-gradient(650px circle at 15% 0%,rgba(245,158,11,.17),transparent 48%),radial-gradient(540px circle at 100% 20%,rgba(56,189,248,.14),transparent 52%),linear-gradient(180deg,rgba(255,255,255,.11),rgba(245,158,11,.034));
      --theme-btn:linear-gradient(135deg,#f59e0b 0%,#38bdf8 58%,#fde68a 130%);
      --theme-title:linear-gradient(90deg,#fff 0%,#fde68a 28%,#f59e0b 54%,#38bdf8 78%,#fff 100%);
      --theme-pattern-opacity:.30;
      --theme-card-filter:blur(22px) saturate(1.20);
    }

    body.vibe-fog,body.vibe-desert,body.vibe-meteor,body.vibe-autumn,body.vibe-bubbles,body.vibe-confetti,body.vibe-laser,body.vibe-matrix,body.vibe-arcade,body.vibe-valentine,body.vibe-halloween,body.vibe-patriotic,body.vibe-birthday,body.vibe-summer {
      color:var(--theme-text)!important;
      background:
        radial-gradient(1120px circle at 10% -10%,color-mix(in srgb,var(--theme-a) 38%,transparent),transparent 45%),
        radial-gradient(900px circle at 96% 8%,color-mix(in srgb,var(--theme-b) 25%,transparent),transparent 42%),
        radial-gradient(780px circle at 50% 108%,color-mix(in srgb,var(--theme-c) 18%,transparent),transparent 52%),
        linear-gradient(180deg,var(--theme-bg-1),var(--theme-bg-2) 46%,var(--theme-bg-1))!important;
    }

    body.vibe-fog .header,body.vibe-desert .header,body.vibe-meteor .header,body.vibe-autumn .header,body.vibe-bubbles .header,body.vibe-confetti .header,body.vibe-laser .header,body.vibe-matrix .header,body.vibe-arcade .header,body.vibe-valentine .header,body.vibe-halloween .header,body.vibe-patriotic .header,body.vibe-birthday .header,body.vibe-summer .header,
    body.vibe-fog .mobileAppTop,body.vibe-desert .mobileAppTop,body.vibe-meteor .mobileAppTop,body.vibe-autumn .mobileAppTop,body.vibe-bubbles .mobileAppTop,body.vibe-confetti .mobileAppTop,body.vibe-laser .mobileAppTop,body.vibe-matrix .mobileAppTop,body.vibe-arcade .mobileAppTop,body.vibe-valentine .mobileAppTop,body.vibe-halloween .mobileAppTop,body.vibe-patriotic .mobileAppTop,body.vibe-birthday .mobileAppTop,body.vibe-summer .mobileAppTop {
      background:color-mix(in srgb,var(--theme-bg-1) 84%,transparent)!important;
      border-bottom-color:var(--theme-line)!important;
      box-shadow:0 22px 72px rgba(0,0,0,.28),0 0 42px color-mix(in srgb,var(--theme-a) 12%,transparent)!important;
    }

    body.vibe-fog .glass,body.vibe-fog .soft,body.vibe-fog .card,body.vibe-fog .formBox,body.vibe-fog .hubCard,body.vibe-fog .final,body.vibe-fog .device,body.vibe-fog .screen,body.vibe-fog .estimateResult,
    body.vibe-desert .glass,body.vibe-desert .soft,body.vibe-desert .card,body.vibe-desert .formBox,body.vibe-desert .hubCard,body.vibe-desert .final,body.vibe-desert .device,body.vibe-desert .screen,body.vibe-desert .estimateResult,
    body.vibe-meteor .glass,body.vibe-meteor .soft,body.vibe-meteor .card,body.vibe-meteor .formBox,body.vibe-meteor .hubCard,body.vibe-meteor .final,body.vibe-meteor .device,body.vibe-meteor .screen,body.vibe-meteor .estimateResult,
    body.vibe-autumn .glass,body.vibe-autumn .soft,body.vibe-autumn .card,body.vibe-autumn .formBox,body.vibe-autumn .hubCard,body.vibe-autumn .final,body.vibe-autumn .device,body.vibe-autumn .screen,body.vibe-autumn .estimateResult,
    body.vibe-bubbles .glass,body.vibe-bubbles .soft,body.vibe-bubbles .card,body.vibe-bubbles .formBox,body.vibe-bubbles .hubCard,body.vibe-bubbles .final,body.vibe-bubbles .device,body.vibe-bubbles .screen,body.vibe-bubbles .estimateResult,
    body.vibe-confetti .glass,body.vibe-confetti .soft,body.vibe-confetti .card,body.vibe-confetti .formBox,body.vibe-confetti .hubCard,body.vibe-confetti .final,body.vibe-confetti .device,body.vibe-confetti .screen,body.vibe-confetti .estimateResult,
    body.vibe-laser .glass,body.vibe-laser .soft,body.vibe-laser .card,body.vibe-laser .formBox,body.vibe-laser .hubCard,body.vibe-laser .final,body.vibe-laser .device,body.vibe-laser .screen,body.vibe-laser .estimateResult,
    body.vibe-matrix .glass,body.vibe-matrix .soft,body.vibe-matrix .card,body.vibe-matrix .formBox,body.vibe-matrix .hubCard,body.vibe-matrix .final,body.vibe-matrix .device,body.vibe-matrix .screen,body.vibe-matrix .estimateResult,
    body.vibe-arcade .glass,body.vibe-arcade .soft,body.vibe-arcade .card,body.vibe-arcade .formBox,body.vibe-arcade .hubCard,body.vibe-arcade .final,body.vibe-arcade .device,body.vibe-arcade .screen,body.vibe-arcade .estimateResult,
    body.vibe-valentine .glass,body.vibe-valentine .soft,body.vibe-valentine .card,body.vibe-valentine .formBox,body.vibe-valentine .hubCard,body.vibe-valentine .final,body.vibe-valentine .device,body.vibe-valentine .screen,body.vibe-valentine .estimateResult,
    body.vibe-halloween .glass,body.vibe-halloween .soft,body.vibe-halloween .card,body.vibe-halloween .formBox,body.vibe-halloween .hubCard,body.vibe-halloween .final,body.vibe-halloween .device,body.vibe-halloween .screen,body.vibe-halloween .estimateResult,
    body.vibe-patriotic .glass,body.vibe-patriotic .soft,body.vibe-patriotic .card,body.vibe-patriotic .formBox,body.vibe-patriotic .hubCard,body.vibe-patriotic .final,body.vibe-patriotic .device,body.vibe-patriotic .screen,body.vibe-patriotic .estimateResult,
    body.vibe-birthday .glass,body.vibe-birthday .soft,body.vibe-birthday .card,body.vibe-birthday .formBox,body.vibe-birthday .hubCard,body.vibe-birthday .final,body.vibe-birthday .device,body.vibe-birthday .screen,body.vibe-birthday .estimateResult,
    body.vibe-summer .glass,body.vibe-summer .soft,body.vibe-summer .card,body.vibe-summer .formBox,body.vibe-summer .hubCard,body.vibe-summer .final,body.vibe-summer .device,body.vibe-summer .screen,body.vibe-summer .estimateResult {
      background:var(--theme-card)!important;
      border-color:var(--theme-line)!important;
      border-radius:var(--theme-radius)!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.09),var(--theme-shadow),0 0 74px color-mix(in srgb,var(--theme-a) 18%,transparent)!important;
      backdrop-filter:var(--theme-card-filter)!important;
      -webkit-backdrop-filter:var(--theme-card-filter)!important;
    }

    body.vibe-fog .primary,body.vibe-desert .primary,body.vibe-meteor .primary,body.vibe-autumn .primary,body.vibe-bubbles .primary,body.vibe-confetti .primary,body.vibe-laser .primary,body.vibe-matrix .primary,body.vibe-arcade .primary,body.vibe-valentine .primary,body.vibe-halloween .primary,body.vibe-patriotic .primary,body.vibe-birthday .primary,body.vibe-summer .primary {
      background:var(--theme-btn)!important;
      box-shadow:0 20px 68px color-mix(in srgb,var(--theme-a) 34%,transparent),inset 0 1px 0 rgba(255,255,255,.28)!important;
    }

    body.vibe-fog .shine,body.vibe-desert .shine,body.vibe-meteor .shine,body.vibe-autumn .shine,body.vibe-bubbles .shine,body.vibe-confetti .shine,body.vibe-laser .shine,body.vibe-matrix .shine,body.vibe-arcade .shine,body.vibe-valentine .shine,body.vibe-halloween .shine,body.vibe-patriotic .shine,body.vibe-birthday .shine,body.vibe-summer .shine {
      background:var(--theme-title)!important;
      background-size:240% auto!important;
      -webkit-background-clip:text!important;
      background-clip:text!important;
      color:transparent!important;
    }

    body.vibe-fog .ghost,body.vibe-fog .chip,body.vibe-desert .ghost,body.vibe-desert .chip,body.vibe-meteor .ghost,body.vibe-meteor .chip,body.vibe-autumn .ghost,body.vibe-autumn .chip,body.vibe-bubbles .ghost,body.vibe-bubbles .chip,body.vibe-confetti .ghost,body.vibe-confetti .chip,body.vibe-laser .ghost,body.vibe-laser .chip,body.vibe-matrix .ghost,body.vibe-matrix .chip,body.vibe-arcade .ghost,body.vibe-arcade .chip,body.vibe-valentine .ghost,body.vibe-valentine .chip,body.vibe-halloween .ghost,body.vibe-halloween .chip,body.vibe-patriotic .ghost,body.vibe-patriotic .chip,body.vibe-birthday .ghost,body.vibe-birthday .chip,body.vibe-summer .ghost,body.vibe-summer .chip {
      background:var(--theme-surface)!important;
      border-color:var(--theme-line)!important;
      color:var(--theme-muted)!important;
    }

    .themeFxLayer[data-effect="fog"] .fxParticle {
      width: var(--s, 300px);
      height: calc(var(--s, 300px) * .38);
      left: var(--x, 0%);
      top: var(--y, 50%);
      border-radius: 999px;
      background: radial-gradient(ellipse, rgba(255,255,255,.16), transparent 70%);
      filter: blur(18px);
      opacity: var(--o, .4);
      animation: fxFogDrift var(--d, 18s) ease-in-out infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes fxFogDrift {
      0%,100% { transform: translate3d(-12vw,0,0) scale(1); }
      50% { transform: translate3d(18vw,-18px,0) scale(1.12); }
    }

    .themeFxLayer[data-effect="desert"] .fxParticle,
    .themeFxLayer[data-effect="autumn"] .fxParticle,
    .themeFxLayer[data-effect="confetti"] .fxParticle,
    .themeFxLayer[data-effect="birthday"] .fxParticle,
    .themeFxLayer[data-effect="patriotic"] .fxParticle {
      width: var(--s, 10px);
      height: calc(var(--s, 10px) * 1.35);
      left: var(--x, 50%);
      top: -10vh;
      border-radius: 4px;
      background: var(--c, #facc15);
      opacity: var(--o, .75);
      animation: fxPieceFall var(--d, 9s) linear infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes fxPieceFall {
      0% { transform: translate3d(0,-10vh,0) rotate(0deg); }
      100% { transform: translate3d(var(--drift, 80px),112vh,0) rotate(760deg); }
    }

    .themeFxLayer[data-effect="bubbles"] .fxParticle {
      width: var(--s, 18px);
      height: var(--s, 18px);
      left: var(--x, 50%);
      bottom: -12vh;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.46);
      background: radial-gradient(circle at 30% 25%, rgba(255,255,255,.55), rgba(255,255,255,.08) 32%, transparent 72%);
      opacity: var(--o, .55);
      animation: fxBubbleRise var(--d, 12s) ease-in infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes fxBubbleRise {
      0% { transform: translate3d(0,12vh,0) scale(.6); opacity:0; }
      16% { opacity:var(--o, .55); }
      100% { transform: translate3d(var(--drift, 40px),-112vh,0) scale(1.12); opacity:0; }
    }

    .themeFxLayer[data-effect="laser"] .fxParticle {
      width: 120vw;
      height: 2px;
      left: -10vw;
      top: var(--y, 50%);
      background: linear-gradient(90deg, transparent, var(--c, #00f5ff), transparent);
      box-shadow: 0 0 18px var(--c, #00f5ff);
      opacity: var(--o, .75);
      animation: fxLaserScan var(--d, 4s) ease-in-out infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes fxLaserScan {
      0%,100% { transform: translateY(-18px) scaleX(.72); opacity:.08; }
      50% { transform: translateY(18px) scaleX(1); opacity:.9; }
    }

    .themeFxLayer[data-effect="matrix"] .fxParticle {
      width: 2px;
      height: var(--h, 120px);
      left: var(--x, 50%);
      top: -20vh;
      background: linear-gradient(180deg, rgba(187,247,208,.95), rgba(34,197,94,.30), transparent);
      box-shadow: 0 0 14px rgba(34,197,94,.6);
      opacity: var(--o, .8);
      animation: fxMatrixRain var(--d, 2.4s) linear infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes fxMatrixRain {
      to { transform: translate3d(0,130vh,0); }
    }

    .themeFxLayer[data-effect="arcade"] .fxParticle {
      width: var(--s, 8px);
      height: var(--s, 8px);
      left: var(--x, 50%);
      top: var(--y, 50%);
      border-radius: 2px;
      background: var(--c, #f472b6);
      box-shadow: 0 0 18px var(--c, #f472b6);
      opacity: var(--o, .8);
      animation: fxArcadePop var(--d, 3.8s) steps(4) infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes fxArcadePop {
      0%,100% { transform: translate3d(0,0,0) scale(.7); opacity:.2; }
      50% { transform: translate3d(var(--drift, 28px),-30px,0) scale(1.25); opacity:1; }
    }

    .themeFxLayer[data-effect="valentine"] .fxParticle,
    .themeFxLayer[data-effect="halloween"] .fxParticle,
    .themeFxLayer[data-effect="summer"] .fxParticle,
    .themeFxLayer[data-effect="meteor"] .fxParticle {
      width: var(--s, 18px);
      height: var(--s, 18px);
      left: var(--x, 50%);
      top: -10vh;
      display: grid;
      place-items: center;
      color: var(--c, #fff);
      font-size: var(--s, 18px);
      animation: fxEmojiFall var(--d, 10s) linear infinite;
      animation-delay: var(--delay, 0s);
    }

    .themeFxLayer[data-effect="valentine"] .fxParticle::before { content: "❤"; }
    .themeFxLayer[data-effect="halloween"] .fxParticle::before { content: "✦"; }
    .themeFxLayer[data-effect="summer"] .fxParticle::before { content: "☀"; }
    .themeFxLayer[data-effect="meteor"] .fxParticle::before { content: "✦"; }

    @keyframes fxEmojiFall {
      0% { transform: translate3d(0,-10vh,0) rotate(0deg); opacity:0; }
      12% { opacity:var(--o, .85); }
      100% { transform: translate3d(var(--drift, 80px),112vh,0) rotate(360deg); opacity:0; }
    }

    @media(max-width:720px){
      .themeGalleryPanel{max-height:64svh}
      .themeCategoryHead{display:block}
      .themeCategoryHead span{text-align:left;max-width:none}
      .themeFxLayer[data-effect] .fxParticle:nth-child(n+34){display:none}
      .themeFxLayer[data-effect="rain"] .fxParticle:nth-child(n+42),.themeFxLayer[data-effect="matrix"] .fxParticle:nth-child(n+42){display:none}
    }


    /* ============================================================
       v32 Morphism Studio
       A second design layer that can stack with any theme.
       ============================================================ */

    .morphismPanel {
      margin-top: 12px;
      padding: 12px;
      border-radius: 22px;
      background:
        radial-gradient(380px circle at 0% 0%, color-mix(in srgb, var(--theme-a, #7c5cff) 13%, transparent), transparent 48%),
        rgba(255,255,255,.045);
      border: 1px solid rgba(255,255,255,.085);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.055);
    }

    .morphismPanelHead {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      padding: 10px;
      border-radius: 18px;
      background: rgba(0,0,0,.13);
      border: 1px solid rgba(255,255,255,.06);
    }

    .morphismPanelHead strong {
      display: block;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 18px;
      line-height: 1;
      letter-spacing: -.045em;
    }

    .morphismPanelHead span {
      display: block;
      max-width: 230px;
      color: rgba(255,255,255,.44);
      font-size: 11px;
      line-height: 1.35;
      font-weight: 750;
      text-align: right;
    }

    .morphismGrid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 9px;
    }

    .morphismOption {
      position: relative;
      overflow: hidden;
      min-height: 72px;
      padding: 12px;
      border: 0;
      border-radius: 18px;
      color: white;
      text-align: left;
      background: rgba(255,255,255,.062);
      border: 1px solid rgba(255,255,255,.095);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
    }

    .morphismOption::after {
      content: "";
      position: absolute;
      right: -28px;
      top: -28px;
      width: 76px;
      height: 76px;
      border-radius: 28px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 26%, transparent), color-mix(in srgb, var(--theme-c, #35d7ff) 16%, transparent));
      transform: rotate(18deg);
      opacity: .42;
      pointer-events: none;
    }

    .morphismOption b {
      position: relative;
      z-index: 2;
      display: block;
      font-size: 19px;
      line-height: 1;
    }

    .morphismOption strong {
      position: relative;
      z-index: 2;
      display: block;
      margin-top: 9px;
      font-size: 12px;
      font-weight: 950;
    }

    .morphismOption span {
      position: relative;
      z-index: 2;
      display: block;
      margin-top: 3px;
      color: rgba(255,255,255,.44);
      font-size: 10.5px;
      line-height: 1.25;
      font-weight: 750;
    }

    .morphismOption.active {
      background: linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 35%, rgba(255,255,255,.06)), color-mix(in srgb, var(--theme-c, #35d7ff) 14%, rgba(255,255,255,.04)));
      border-color: rgba(255,255,255,.20);
      box-shadow: 0 14px 44px color-mix(in srgb, var(--theme-a, #7c5cff) 18%, transparent), inset 0 1px 0 rgba(255,255,255,.12);
    }

    .morphBlobLayer {
      position: fixed;
      inset: 0;
      z-index: -3;
      pointer-events: none;
      overflow: hidden;
      contain: strict;
      opacity: 0;
      transition: opacity .24s ease;
    }

    .morphBlobLayer span {
      position: absolute;
      display: block;
      width: var(--s, 280px);
      height: var(--s, 280px);
      left: var(--x, 10%);
      top: var(--y, 10%);
      border-radius: 42% 58% 62% 38% / 42% 36% 64% 58%;
      background: radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--theme-c, #35d7ff) 34%, white), color-mix(in srgb, var(--theme-a, #7c5cff) 24%, transparent) 40%, transparent 72%);
      filter: blur(var(--blur, 34px));
      opacity: var(--o, .24);
      animation: morphBlobFloat var(--d, 16s) ease-in-out infinite;
      animation-delay: var(--delay, 0s);
    }

    @keyframes morphBlobFloat {
      0%, 100% {
        transform: translate3d(0, 0, 0) rotate(0deg) scale(1);
        border-radius: 42% 58% 62% 38% / 42% 36% 64% 58%;
      }
      33% {
        transform: translate3d(34px, -28px, 0) rotate(16deg) scale(1.08);
        border-radius: 62% 38% 44% 56% / 54% 48% 52% 46%;
      }
      66% {
        transform: translate3d(-24px, 32px, 0) rotate(-12deg) scale(.96);
        border-radius: 48% 52% 36% 64% / 62% 42% 58% 38%;
      }
    }

    body.morph-glass .glass,
    body.morph-glass .soft,
    body.morph-glass .card,
    body.morph-glass .formBox,
    body.morph-glass .hubCard,
    body.morph-glass .final,
    body.morph-glass .device,
    body.morph-glass .screen,
    body.morph-glass .estimateResult,
    body.morph-glass .opsPanel,
    body.morph-glass .opsJobCard,
    body.morph-glass .hqJob,
    body.morph-glass .hqHeroCard,
    body.morph-glass .hqNextCard {
      background:
        radial-gradient(700px circle at 20% 0%, rgba(255,255,255,.16), transparent 48%),
        linear-gradient(135deg, rgba(255,255,255,.15), rgba(255,255,255,.045)) !important;
      border-color: rgba(255,255,255,.22) !important;
      backdrop-filter: blur(34px) saturate(1.35) !important;
      -webkit-backdrop-filter: blur(34px) saturate(1.35) !important;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.18),
        inset 0 -1px 0 rgba(255,255,255,.05),
        0 30px 100px rgba(0,0,0,.36),
        0 0 70px color-mix(in srgb, var(--theme-a, #7c5cff) 15%, transparent) !important;
    }

    body.morph-liquid .morphBlobLayer,
    body.morph-holo .morphBlobLayer {
      opacity: 1;
    }

    body.morph-liquid .card,
    body.morph-liquid .hubCard,
    body.morph-liquid .formBox,
    body.morph-liquid .final,
    body.morph-liquid .v20-showcase,
    body.morph-liquid .personalHero,
    body.morph-liquid .opsPanel,
    body.morph-liquid .hqHeroCard,
    body.morph-liquid .hqNextCard {
      border-radius: 42px 58px 48px 36px / 38px 46px 60px 44px !important;
      background:
        radial-gradient(700px circle at 18% 0%, color-mix(in srgb, var(--theme-c, #35d7ff) 18%, transparent), transparent 46%),
        radial-gradient(600px circle at 90% 20%, color-mix(in srgb, var(--theme-a, #7c5cff) 18%, transparent), transparent 48%),
        linear-gradient(135deg, rgba(255,255,255,.12), rgba(255,255,255,.04)) !important;
      animation: liquidCardMorph 9s ease-in-out infinite;
    }

    @keyframes liquidCardMorph {
      0%,100% { border-radius: 42px 58px 48px 36px / 38px 46px 60px 44px; }
      50% { border-radius: 58px 38px 42px 54px / 52px 36px 50px 44px; }
    }

    body.morph-neo .card,
    body.morph-neo .hubCard,
    body.morph-neo .formBox,
    body.morph-neo .final,
    body.morph-neo .opsPanel,
    body.morph-neo .hqHeroCard,
    body.morph-neo .hqNextCard,
    body.morph-neo .hqJob {
      background: color-mix(in srgb, var(--theme-bg-2, #090f1e) 82%, rgba(255,255,255,.12)) !important;
      border-color: rgba(255,255,255,.06) !important;
      box-shadow:
        14px 14px 34px rgba(0,0,0,.38),
        -10px -10px 26px rgba(255,255,255,.045),
        inset 1px 1px 0 rgba(255,255,255,.06) !important;
      backdrop-filter: blur(10px) !important;
      -webkit-backdrop-filter: blur(10px) !important;
    }

    body.morph-neo .btn,
    body.morph-neo .chip,
    body.morph-neo .sensoryMiniButton,
    body.morph-neo .audioSmallBtn {
      box-shadow:
        8px 8px 20px rgba(0,0,0,.28),
        -6px -6px 16px rgba(255,255,255,.045),
        inset 1px 1px 0 rgba(255,255,255,.07) !important;
    }

    body.morph-clay .card,
    body.morph-clay .hubCard,
    body.morph-clay .formBox,
    body.morph-clay .final,
    body.morph-clay .opsPanel,
    body.morph-clay .hqHeroCard,
    body.morph-clay .hqNextCard,
    body.morph-clay .hqJob {
      border-radius: 34px !important;
      background:
        radial-gradient(280px circle at 28% 18%, rgba(255,255,255,.22), transparent 34%),
        linear-gradient(145deg, color-mix(in srgb, var(--theme-a, #7c5cff) 18%, rgba(255,255,255,.11)), color-mix(in srgb, var(--theme-b, #ff4fd8) 14%, rgba(255,255,255,.045))) !important;
      border: 1px solid rgba(255,255,255,.12) !important;
      box-shadow:
        0 24px 0 color-mix(in srgb, var(--theme-a, #7c5cff) 9%, rgba(0,0,0,.12)),
        0 34px 80px rgba(0,0,0,.32),
        inset 0 1px 0 rgba(255,255,255,.18) !important;
    }

    body.morph-crystal .card,
    body.morph-crystal .hubCard,
    body.morph-crystal .formBox,
    body.morph-crystal .final,
    body.morph-crystal .opsPanel,
    body.morph-crystal .hqHeroCard,
    body.morph-crystal .hqNextCard,
    body.morph-crystal .hqJob {
      clip-path: polygon(0 14px, 14px 0, calc(100% - 22px) 0, 100% 22px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 20px 100%, 0 calc(100% - 20px));
      border-radius: 0 !important;
      background:
        linear-gradient(135deg, rgba(255,255,255,.18), rgba(255,255,255,.04) 42%, rgba(255,255,255,.12) 43%, rgba(255,255,255,.035) 100%) !important;
      border-color: rgba(255,255,255,.24) !important;
      backdrop-filter: blur(28px) saturate(1.25) contrast(1.04) !important;
      -webkit-backdrop-filter: blur(28px) saturate(1.25) contrast(1.04) !important;
    }

    body.morph-holo .card,
    body.morph-holo .hubCard,
    body.morph-holo .formBox,
    body.morph-holo .final,
    body.morph-holo .opsPanel,
    body.morph-holo .hqHeroCard,
    body.morph-holo .hqNextCard,
    body.morph-holo .hqJob {
      position: relative;
      overflow: hidden;
      background:
        linear-gradient(135deg, rgba(255,255,255,.12), rgba(255,255,255,.035)),
        conic-gradient(from 160deg at 50% 50%, color-mix(in srgb, var(--theme-a, #7c5cff) 18%, transparent), color-mix(in srgb, var(--theme-c, #35d7ff) 16%, transparent), rgba(255,255,255,.08), color-mix(in srgb, var(--theme-b, #ff4fd8) 14%, transparent), color-mix(in srgb, var(--theme-a, #7c5cff) 18%, transparent)) !important;
      border-color: rgba(255,255,255,.22) !important;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.20),
        0 28px 92px rgba(0,0,0,.36),
        0 0 90px color-mix(in srgb, var(--theme-c, #35d7ff) 16%, transparent) !important;
    }

    body.morph-soft .card,
    body.morph-soft .hubCard,
    body.morph-soft .formBox,
    body.morph-soft .final,
    body.morph-soft .opsPanel,
    body.morph-soft .hqHeroCard,
    body.morph-soft .hqNextCard,
    body.morph-soft .hqJob {
      border-radius: 36px !important;
      background:
        radial-gradient(620px circle at 15% 0%, rgba(255,255,255,.11), transparent 48%),
        linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.035)) !important;
      box-shadow:
        0 18px 54px rgba(0,0,0,.24),
        0 8px 24px color-mix(in srgb, var(--theme-a, #7c5cff) 10%, transparent),
        inset 0 1px 0 rgba(255,255,255,.10) !important;
      transform: translateZ(0);
    }

    body.morph-glass .primary,
    body.morph-liquid .primary,
    body.morph-holo .primary {
      box-shadow:
        0 22px 70px color-mix(in srgb, var(--theme-a, #7c5cff) 38%, transparent),
        0 8px 28px color-mix(in srgb, var(--theme-c, #35d7ff) 18%, transparent),
        inset 0 1px 0 rgba(255,255,255,.30) !important;
    }

    @media(max-width:720px) {
      .morphismPanelHead {
        display: block;
      }

      .morphismPanelHead span {
        max-width: none;
        text-align: left;
      }

      .morphismGrid {
        grid-template-columns: 1fr;
      }

      body.morph-liquid .card,
      body.morph-liquid .hubCard,
      body.morph-liquid .formBox,
      body.morph-liquid .final,
      body.morph-liquid .v20-showcase,
      body.morph-liquid .personalHero,
      body.morph-liquid .opsPanel,
      body.morph-liquid .hqHeroCard,
      body.morph-liquid .hqNextCard {
        animation: none;
        border-radius: 30px !important;
      }

      body.morph-crystal .card,
      body.morph-crystal .hubCard,
      body.morph-crystal .formBox,
      body.morph-crystal .final,
      body.morph-crystal .opsPanel,
      body.morph-crystal .hqHeroCard,
      body.morph-crystal .hqNextCard,
      body.morph-crystal .hqJob {
        clip-path: none;
        border-radius: 22px !important;
      }
    }

    body.v22-reduced-sensory .morphBlobLayer {
      display: none !important;
    }

    @media (prefers-reduced-motion: reduce) {
      .morphBlobLayer span,
      body.morph-liquid .card,
      body.morph-liquid .hubCard,
      body.morph-liquid .formBox,
      body.morph-liquid .final,
      body.morph-liquid .v20-showcase,
      body.morph-liquid .personalHero,
      body.morph-liquid .opsPanel,
      body.morph-liquid .hqHeroCard,
      body.morph-liquid .hqNextCard {
        animation: none !important;
      }
    }


    /* ============================================================
       v33 Direct Morph Button
       Makes Morphism Studio visible without opening Theme Studio.
       ============================================================ */

    .morphDock {
      position: fixed;
      left: 132px;
      bottom: 18px;
      z-index: 1702;
      display: grid;
      gap: 10px;
      pointer-events: none;
    }

    .morphButton {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      min-height: 54px;
      padding: 14px 18px;
      border: 0;
      border-radius: 22px;
      color: white;
      background:
        radial-gradient(170px circle at 20% 0%, rgba(255,255,255,.18), transparent 45%),
        linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 82%, #111), color-mix(in srgb, var(--theme-c, #35d7ff) 60%, #111));
      box-shadow:
        0 20px 64px color-mix(in srgb, var(--theme-a, #7c5cff) 22%, transparent),
        0 12px 42px rgba(0,0,0,.25),
        inset 0 1px 0 rgba(255,255,255,.18);
      font-size: 14px;
      font-weight: 950;
      letter-spacing: -.02em;
    }

    .morphButton span {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 10px;
      background: rgba(255,255,255,.15);
    }

    .morphDockPanel {
      display: none;
      width: min(380px, calc(100vw - 28px));
      max-height: min(620px, 72svh);
      overflow-y: auto;
      padding: 15px;
      border-radius: 26px;
      background:
        radial-gradient(440px circle at 0% 0%, color-mix(in srgb, var(--theme-a, #7c5cff) 18%, transparent), transparent 48%),
        radial-gradient(440px circle at 100% 0%, color-mix(in srgb, var(--theme-c, #35d7ff) 14%, transparent), transparent 48%),
        rgba(7,10,18,.92);
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 26px 86px rgba(0,0,0,.48), inset 0 1px 0 rgba(255,255,255,.09);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      pointer-events: auto;
    }

    .morphDock.open .morphDockPanel {
      display: block;
      animation: sensoryPanelIn .18s ease both;
    }

    .morphDockTitle {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .morphDockTitle strong {
      display: block;
      font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 23px;
      line-height: .95;
      letter-spacing: -.05em;
    }

    .morphDockTitle span {
      display: block;
      margin-top: 4px;
      color: rgba(255,255,255,.48);
      font-size: 12px;
      line-height: 1.35;
      font-weight: 800;
    }

    .morphDockHint {
      margin-top: 12px;
      padding: 11px;
      border-radius: 18px;
      color: rgba(255,255,255,.48);
      background: rgba(255,255,255,.045);
      border: 1px solid rgba(255,255,255,.075);
      font-size: 11px;
      line-height: 1.42;
      font-weight: 760;
    }

    .morphDock .morphismGrid {
      grid-template-columns: repeat(2, 1fr);
    }

    .morphDock .morphismOption {
      min-height: 82px;
    }

    body.hqFullscreenMode .morphDock {
      display: none !important;
    }

    @media (max-width: 720px) {
      .morphDock {
        left: auto;
        right: 12px;
        bottom: calc(146px + var(--safe-bottom));
      }

      .morphButton {
        min-height: 48px;
        padding: 12px 14px;
        border-radius: 18px;
      }

      .morphDockPanel {
        width: min(380px, calc(100vw - 24px));
        max-height: 64svh;
      }

      .morphDock .morphismGrid {
        grid-template-columns: 1fr;
      }
    }


    /* ============================================================
       v34 Morphism Fix
       Cleaner button, farther placement, independent-looking morph states.
       ============================================================ */

    .morphDock {
      left: 18px !important;
      bottom: 92px !important;
      z-index: 1750 !important;
      justify-items: start !important;
    }

    .morphButton {
      min-height: 46px !important;
      padding: 10px 14px !important;
      border-radius: 16px !important;
      gap: 8px !important;
      background:
        linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,.055)) !important;
      border: 1px solid rgba(255,255,255,.14) !important;
      box-shadow:
        0 14px 44px rgba(0,0,0,.32),
        0 0 34px color-mix(in srgb, var(--theme-a, #7c5cff) 16%, transparent),
        inset 0 1px 0 rgba(255,255,255,.12) !important;
      backdrop-filter: blur(18px) !important;
      -webkit-backdrop-filter: blur(18px) !important;
      font-size: 13px !important;
      letter-spacing: -.01em !important;
    }

    .morphButton span {
      width: 23px !important;
      height: 23px !important;
      border-radius: 8px !important;
      background:
        radial-gradient(circle at 30% 20%, rgba(255,255,255,.32), transparent 38%),
        color-mix(in srgb, var(--theme-a, #7c5cff) 34%, rgba(255,255,255,.10)) !important;
      font-size: 13px !important;
    }

    .morphButton:hover {
      transform: translateY(-1px);
      border-color: rgba(255,255,255,.22) !important;
    }

    .morphDock.open .morphButton {
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 42%, rgba(255,255,255,.10)), color-mix(in srgb, var(--theme-c, #35d7ff) 20%, rgba(255,255,255,.08))) !important;
      border-color: rgba(255,255,255,.22) !important;
    }

    .morphDockPanel {
      width: min(420px, calc(100vw - 28px)) !important;
      border-radius: 24px !important;
      padding: 14px !important;
      background:
        radial-gradient(440px circle at 0% 0%, color-mix(in srgb, var(--theme-a, #7c5cff) 15%, transparent), transparent 48%),
        rgba(7,10,18,.94) !important;
    }

    .morphDockTitle strong {
      font-size: 22px !important;
    }

    .morphStatus {
      margin-bottom: 12px;
      padding: 12px;
      border-radius: 18px;
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 16%, transparent), rgba(255,255,255,.045));
      border: 1px solid rgba(255,255,255,.09);
      color: rgba(255,255,255,.72);
      font-size: 12px;
      line-height: 1.4;
      font-weight: 850;
    }

    .morphStatus strong {
      color: white;
      font-weight: 950;
    }

    .morphDock .morphismOption {
      min-height: 86px !important;
      border-radius: 18px !important;
      transition: transform .16s ease, border-color .16s ease, background .16s ease;
    }

    .morphDock .morphismOption:hover {
      transform: translateY(-1px);
      border-color: rgba(255,255,255,.18);
    }

    .morphDock .morphismOption.active {
      outline: 2px solid color-mix(in srgb, var(--theme-c, #35d7ff) 65%, white);
      outline-offset: -2px;
    }

    body.morph-glass .v20-showcase,
    body.morph-glass .v20-big-panel,
    body.morph-glass .v20-route-card,
    body.morph-glass .v20-floating-tile,
    body.morph-glass .v20-homepage-strip,
    body.morph-glass .requestCard,
    body.morph-glass .todayCard,
    body.morph-glass .bookingCard,
    body.morph-glass .opsTop,
    body.morph-glass .opsStat,
    body.morph-glass .opsPanel,
    body.morph-glass .opsJobCard,
    body.morph-glass .hqTopbar,
    body.morph-glass .hqStat,
    body.morph-glass .hqColumn,
    body.morph-glass .hqJob {
      background:
        radial-gradient(720px circle at 12% 0%, rgba(255,255,255,.18), transparent 48%),
        linear-gradient(135deg, rgba(255,255,255,.16), rgba(255,255,255,.045)) !important;
      border-color: rgba(255,255,255,.24) !important;
      backdrop-filter: blur(34px) saturate(1.35) !important;
      -webkit-backdrop-filter: blur(34px) saturate(1.35) !important;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.20),
        0 30px 100px rgba(0,0,0,.34),
        0 0 80px color-mix(in srgb, var(--theme-c, #35d7ff) 14%, transparent) !important;
    }

    body.morph-liquid .v20-showcase,
    body.morph-liquid .v20-big-panel,
    body.morph-liquid .v20-route-card,
    body.morph-liquid .v20-floating-tile,
    body.morph-liquid .v20-homepage-strip,
    body.morph-liquid .requestCard,
    body.morph-liquid .todayCard,
    body.morph-liquid .bookingCard,
    body.morph-liquid .opsTop,
    body.morph-liquid .opsStat,
    body.morph-liquid .opsPanel,
    body.morph-liquid .opsJobCard,
    body.morph-liquid .hqTopbar,
    body.morph-liquid .hqStat,
    body.morph-liquid .hqColumn,
    body.morph-liquid .hqJob {
      border-radius: 42px 58px 48px 36px / 38px 46px 60px 44px !important;
      background:
        radial-gradient(760px circle at 18% 0%, color-mix(in srgb, var(--theme-c, #35d7ff) 20%, transparent), transparent 48%),
        radial-gradient(680px circle at 88% 16%, color-mix(in srgb, var(--theme-a, #7c5cff) 20%, transparent), transparent 50%),
        linear-gradient(135deg, rgba(255,255,255,.13), rgba(255,255,255,.04)) !important;
      animation: liquidCardMorph 8s ease-in-out infinite !important;
    }

    body.morph-neo .v20-showcase,
    body.morph-neo .v20-big-panel,
    body.morph-neo .v20-route-card,
    body.morph-neo .v20-floating-tile,
    body.morph-neo .v20-homepage-strip,
    body.morph-neo .requestCard,
    body.morph-neo .todayCard,
    body.morph-neo .bookingCard,
    body.morph-neo .opsTop,
    body.morph-neo .opsStat,
    body.morph-neo .opsPanel,
    body.morph-neo .opsJobCard,
    body.morph-neo .hqTopbar,
    body.morph-neo .hqStat,
    body.morph-neo .hqColumn,
    body.morph-neo .hqJob {
      background: color-mix(in srgb, var(--theme-bg-2, #090f1e) 78%, rgba(255,255,255,.12)) !important;
      border-color: rgba(255,255,255,.055) !important;
      box-shadow:
        14px 14px 34px rgba(0,0,0,.38),
        -10px -10px 26px rgba(255,255,255,.045),
        inset 1px 1px 0 rgba(255,255,255,.07) !important;
    }

    body.morph-clay .v20-showcase,
    body.morph-clay .v20-big-panel,
    body.morph-clay .v20-route-card,
    body.morph-clay .v20-floating-tile,
    body.morph-clay .v20-homepage-strip,
    body.morph-clay .requestCard,
    body.morph-clay .todayCard,
    body.morph-clay .bookingCard,
    body.morph-clay .opsTop,
    body.morph-clay .opsStat,
    body.morph-clay .opsPanel,
    body.morph-clay .opsJobCard,
    body.morph-clay .hqTopbar,
    body.morph-clay .hqStat,
    body.morph-clay .hqColumn,
    body.morph-clay .hqJob {
      border-radius: 34px !important;
      background:
        radial-gradient(300px circle at 28% 18%, rgba(255,255,255,.24), transparent 35%),
        linear-gradient(145deg, color-mix(in srgb, var(--theme-a, #7c5cff) 20%, rgba(255,255,255,.12)), color-mix(in srgb, var(--theme-b, #ff4fd8) 15%, rgba(255,255,255,.045))) !important;
      border: 1px solid rgba(255,255,255,.13) !important;
      box-shadow:
        0 18px 0 color-mix(in srgb, var(--theme-a, #7c5cff) 10%, rgba(0,0,0,.13)),
        0 34px 84px rgba(0,0,0,.34),
        inset 0 1px 0 rgba(255,255,255,.20) !important;
    }

    body.morph-crystal .v20-showcase,
    body.morph-crystal .v20-big-panel,
    body.morph-crystal .v20-route-card,
    body.morph-crystal .v20-floating-tile,
    body.morph-crystal .v20-homepage-strip,
    body.morph-crystal .requestCard,
    body.morph-crystal .todayCard,
    body.morph-crystal .bookingCard,
    body.morph-crystal .opsTop,
    body.morph-crystal .opsStat,
    body.morph-crystal .opsPanel,
    body.morph-crystal .opsJobCard,
    body.morph-crystal .hqTopbar,
    body.morph-crystal .hqStat,
    body.morph-crystal .hqColumn,
    body.morph-crystal .hqJob {
      clip-path: polygon(0 16px, 16px 0, calc(100% - 24px) 0, 100% 24px, 100% calc(100% - 16px), calc(100% - 16px) 100%, 22px 100%, 0 calc(100% - 22px)) !important;
      border-radius: 0 !important;
      background:
        linear-gradient(135deg, rgba(255,255,255,.20), rgba(255,255,255,.04) 42%, rgba(255,255,255,.14) 43%, rgba(255,255,255,.035) 100%) !important;
      border-color: rgba(255,255,255,.25) !important;
    }

    body.morph-holo .v20-showcase,
    body.morph-holo .v20-big-panel,
    body.morph-holo .v20-route-card,
    body.morph-holo .v20-floating-tile,
    body.morph-holo .v20-homepage-strip,
    body.morph-holo .requestCard,
    body.morph-holo .todayCard,
    body.morph-holo .bookingCard,
    body.morph-holo .opsTop,
    body.morph-holo .opsStat,
    body.morph-holo .opsPanel,
    body.morph-holo .opsJobCard,
    body.morph-holo .hqTopbar,
    body.morph-holo .hqStat,
    body.morph-holo .hqColumn,
    body.morph-holo .hqJob {
      background:
        linear-gradient(135deg, rgba(255,255,255,.13), rgba(255,255,255,.04)),
        conic-gradient(from 160deg at 50% 50%, color-mix(in srgb, var(--theme-a, #7c5cff) 20%, transparent), color-mix(in srgb, var(--theme-c, #35d7ff) 18%, transparent), rgba(255,255,255,.10), color-mix(in srgb, var(--theme-b, #ff4fd8) 16%, transparent), color-mix(in srgb, var(--theme-a, #7c5cff) 20%, transparent)) !important;
      border-color: rgba(255,255,255,.24) !important;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.22),
        0 30px 100px rgba(0,0,0,.34),
        0 0 95px color-mix(in srgb, var(--theme-c, #35d7ff) 20%, transparent) !important;
    }

    body.morph-soft .v20-showcase,
    body.morph-soft .v20-big-panel,
    body.morph-soft .v20-route-card,
    body.morph-soft .v20-floating-tile,
    body.morph-soft .v20-homepage-strip,
    body.morph-soft .requestCard,
    body.morph-soft .todayCard,
    body.morph-soft .bookingCard,
    body.morph-soft .opsTop,
    body.morph-soft .opsStat,
    body.morph-soft .opsPanel,
    body.morph-soft .opsJobCard,
    body.morph-soft .hqTopbar,
    body.morph-soft .hqStat,
    body.morph-soft .hqColumn,
    body.morph-soft .hqJob {
      border-radius: 38px !important;
      background:
        radial-gradient(620px circle at 15% 0%, rgba(255,255,255,.12), transparent 48%),
        linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.04)) !important;
      box-shadow:
        0 16px 45px rgba(0,0,0,.22),
        0 8px 24px color-mix(in srgb, var(--theme-a, #7c5cff) 11%, transparent),
        inset 0 1px 0 rgba(255,255,255,.12) !important;
    }

    @media(max-width:720px) {
      .morphDock {
        left: 12px !important;
        right: auto !important;
        bottom: calc(146px + var(--safe-bottom)) !important;
      }

      .morphButton {
        min-height: 44px !important;
        padding: 10px 12px !important;
        border-radius: 15px !important;
        font-size: 12px !important;
      }

      .morphDockPanel {
        width: min(390px, calc(100vw - 24px)) !important;
        max-height: 62svh !important;
      }
    }


    /* ============================================================
       v35 Morph Button Working Patch
       Makes Morph obvious and independently clickable.
       ============================================================ */

    .morphDock {
      left: auto !important;
      right: 18px !important;
      bottom: 92px !important;
      z-index: 2600 !important;
    }

    .morphButton {
      min-height: 48px !important;
      padding: 11px 15px !important;
      border-radius: 999px !important;
      color: #fff !important;
      background:
        radial-gradient(140px circle at 18% 0%, rgba(255,255,255,.22), transparent 45%),
        linear-gradient(135deg, rgba(17,24,39,.86), color-mix(in srgb, var(--theme-a, #7c5cff) 38%, rgba(17,24,39,.84))) !important;
      border: 1px solid rgba(255,255,255,.18) !important;
      box-shadow:
        0 18px 58px rgba(0,0,0,.40),
        0 0 46px color-mix(in srgb, var(--theme-a, #7c5cff) 22%, transparent),
        inset 0 1px 0 rgba(255,255,255,.16) !important;
      backdrop-filter: blur(20px) saturate(1.16) !important;
      -webkit-backdrop-filter: blur(20px) saturate(1.16) !important;
      pointer-events: auto !important;
    }

    .morphButton::after {
      content: "Style";
      display: inline-grid;
      place-items: center;
      min-height: 22px;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(255,255,255,.12);
      color: rgba(255,255,255,.72);
      font-size: 10px;
      font-weight: 950;
      margin-left: 2px;
    }

    .morphDockPanel {
      pointer-events: auto !important;
      transform-origin: bottom right;
      right: 0;
      left: auto;
    }

    .morphDock.open .morphButton {
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 65%, #111827), color-mix(in srgb, var(--theme-c, #35d7ff) 42%, #111827)) !important;
      border-color: rgba(255,255,255,.28) !important;
      box-shadow:
        0 20px 72px rgba(0,0,0,.42),
        0 0 68px color-mix(in srgb, var(--theme-c, #35d7ff) 30%, transparent),
        inset 0 1px 0 rgba(255,255,255,.22) !important;
    }

    .morphDock .morphismOption.active {
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 42%, rgba(255,255,255,.08)), color-mix(in srgb, var(--theme-c, #35d7ff) 22%, rgba(255,255,255,.05))) !important;
      border-color: rgba(255,255,255,.32) !important;
      outline: 2px solid color-mix(in srgb, var(--theme-c, #35d7ff) 68%, white) !important;
      outline-offset: -2px !important;
      box-shadow:
        0 16px 48px color-mix(in srgb, var(--theme-a, #7c5cff) 22%, transparent),
        inset 0 1px 0 rgba(255,255,255,.16) !important;
    }

    body.morph-glass .morphismTestTarget,
    body.morph-liquid .morphismTestTarget,
    body.morph-neo .morphismTestTarget,
    body.morph-clay .morphismTestTarget,
    body.morph-crystal .morphismTestTarget,
    body.morph-holo .morphismTestTarget,
    body.morph-soft .morphismTestTarget {
      outline: 2px solid color-mix(in srgb, var(--theme-c, #35d7ff) 50%, transparent);
    }

    @media(max-width:720px) {
      .morphDock {
        right: 12px !important;
        left: auto !important;
        bottom: calc(154px + var(--safe-bottom)) !important;
      }

      .morphButton::after {
        display: none;
      }

      .morphDockPanel {
        width: min(390px, calc(100vw - 24px)) !important;
        max-height: 66svh !important;
      }
    }


    /* ============================================================
       v36 Morph Button Final Fix
       Prevents double-toggle and forces panel visible when open.
       ============================================================ */

    #morphDock {
      pointer-events: none !important;
    }

    #morphDock #morphButton,
    #morphDock .morphDockPanel {
      pointer-events: auto !important;
    }

    #morphDock .morphDockPanel {
      display: none !important;
      opacity: 0;
      transform: translateY(8px) scale(.98);
      transition: opacity .16s ease, transform .16s ease;
    }

    #morphDock.open .morphDockPanel {
      display: block !important;
      opacity: 1 !important;
      transform: translateY(0) scale(1) !important;
    }

    #morphButton {
      cursor: pointer !important;
      user-select: none !important;
      -webkit-tap-highlight-color: transparent;
    }

    #morphButton:active {
      transform: scale(.97);
    }

    #morphDebugToast {
      position: fixed;
      right: 18px;
      bottom: 154px;
      z-index: 4000;
      max-width: min(320px, calc(100vw - 24px));
      padding: 11px 13px;
      border-radius: 999px;
      color: white;
      background: rgba(7,10,18,.90);
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 18px 60px rgba(0,0,0,.35);
      font-size: 12px;
      font-weight: 850;
      opacity: 0;
      transform: translateY(8px);
      pointer-events: none;
      transition: opacity .16s ease, transform .16s ease;
    }

    #morphDebugToast.show {
      opacity: 1;
      transform: translateY(0);
    }

    @media(max-width:720px) {
      #morphDebugToast {
        right: 12px;
        bottom: calc(210px + var(--safe-bottom));
      }
    }


    /* ============================================================
       v38 Visible Morph Studio + 3D Morphs
       ============================================================ */

    .morphNavButton {
      font: inherit;
      color: inherit;
      cursor: pointer;
      min-height: 34px;
      padding: 8px 11px !important;
      border-radius: 999px !important;
      background: rgba(255,255,255,.075) !important;
      border: 1px solid rgba(255,255,255,.12) !important;
    }

    .morphMobileButton {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: white;
      border: 0;
      background: transparent;
      padding: 16px 18px;
      font: inherit;
      cursor: pointer;
      text-align: left;
    }

    #morphDock {
      position: fixed !important;
      right: 18px !important;
      left: auto !important;
      bottom: 92px !important;
      z-index: 99999 !important;
      display: grid !important;
      pointer-events: none !important;
    }

    #morphButton {
      display: inline-flex !important;
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
      cursor: pointer !important;
      min-height: 52px !important;
      padding: 12px 18px !important;
      border-radius: 999px !important;
      border: 1px solid rgba(255,255,255,.22) !important;
      color: white !important;
      background:
        radial-gradient(160px circle at 20% 0%, rgba(255,255,255,.22), transparent 45%),
        linear-gradient(135deg, color-mix(in srgb, var(--theme-a, #7c5cff) 52%, #10131f), color-mix(in srgb, var(--theme-c, #35d7ff) 38%, #10131f)) !important;
      box-shadow:
        0 20px 70px rgba(0,0,0,.45),
        0 0 60px color-mix(in srgb, var(--theme-a, #7c5cff) 28%, transparent),
        inset 0 1px 0 rgba(255,255,255,.20) !important;
      backdrop-filter: blur(22px) saturate(1.2) !important;
      -webkit-backdrop-filter: blur(22px) saturate(1.2) !important;
    }

    #morphButton::after {
      content: "Studio";
      display: inline-grid;
      place-items: center;
      margin-left: 4px;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(255,255,255,.14);
      color: rgba(255,255,255,.78);
      font-size: 10px;
      font-weight: 950;
    }

    #morphDock .morphDockPanel {
      display: none !important;
      opacity: 0;
      transform: translateY(8px) scale(.98);
      transform-origin: bottom right;
      transition: opacity .16s ease, transform .16s ease;
      pointer-events: auto !important;
      width: min(470px, calc(100vw - 28px)) !important;
      max-height: min(720px, 76svh) !important;
    }

    #morphDock.open .morphDockPanel {
      display: block !important;
      opacity: 1 !important;
      transform: translateY(0) scale(1) !important;
    }

    #morphDock .morphismGrid {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 9px !important;
    }

    #morphDock .morphismOption {
      min-height: 92px !important;
    }

    @keyframes morphFloatBob {
      0%,100% { transform: translateY(-8px) translateZ(0); }
      50% { transform: translateY(-13px) translateZ(0); }
    }

    body[class*="morph-"] .v20-showcase,
    body[class*="morph-"] .v20-big-panel,
    body[class*="morph-"] .v20-route-card,
    body[class*="morph-"] .v20-floating-tile,
    body[class*="morph-"] .v20-homepage-strip,
    body[class*="morph-"] .requestCard,
    body[class*="morph-"] .todayCard,
    body[class*="morph-"] .bookingCard,
    body[class*="morph-"] .opsTop,
    body[class*="morph-"] .opsStat,
    body[class*="morph-"] .opsPanel,
    body[class*="morph-"] .opsJobCard,
    body[class*="morph-"] .hqTopbar,
    body[class*="morph-"] .hqStat,
    body[class*="morph-"] .hqColumn,
    body[class*="morph-"] .hqJob,
    body[class*="morph-"] .card,
    body[class*="morph-"] .hubCard,
    body[class*="morph-"] .formBox,
    body[class*="morph-"] .final,
    body[class*="morph-"] .personalHero {
      transition: transform .28s ease, box-shadow .28s ease, border-color .28s ease, background .28s ease, border-radius .28s ease;
      transform-style: preserve-3d;
      will-change: transform;
    }

    body.morph-three-d .v20-showcase,
    body.morph-three-d .v20-big-panel,
    body.morph-three-d .v20-route-card,
    body.morph-three-d .v20-floating-tile,
    body.morph-three-d .v20-homepage-strip,
    body.morph-three-d .requestCard,
    body.morph-three-d .todayCard,
    body.morph-three-d .bookingCard,
    body.morph-three-d .opsTop,
    body.morph-three-d .opsStat,
    body.morph-three-d .opsPanel,
    body.morph-three-d .opsJobCard,
    body.morph-three-d .hqTopbar,
    body.morph-three-d .hqStat,
    body.morph-three-d .hqColumn,
    body.morph-three-d .hqJob,
    body.morph-three-d .card,
    body.morph-three-d .hubCard,
    body.morph-three-d .formBox,
    body.morph-three-d .final,
    body.morph-three-d .personalHero {
      transform: perspective(1300px) translateY(-10px) rotateX(8deg) !important;
      border-color: rgba(255,255,255,.18) !important;
      box-shadow: 0 16px 0 rgba(255,255,255,.04), 0 42px 110px rgba(0,0,0,.40), 0 10px 34px color-mix(in srgb, var(--theme-a, #7c5cff) 20%, transparent) !important;
    }

    body.morph-three-d-glass .morphBlobLayer { opacity: 1; }

    body.morph-three-d-glass .v20-showcase,
    body.morph-three-d-glass .v20-big-panel,
    body.morph-three-d-glass .v20-route-card,
    body.morph-three-d-glass .v20-floating-tile,
    body.morph-three-d-glass .v20-homepage-strip,
    body.morph-three-d-glass .requestCard,
    body.morph-three-d-glass .todayCard,
    body.morph-three-d-glass .bookingCard,
    body.morph-three-d-glass .opsTop,
    body.morph-three-d-glass .opsStat,
    body.morph-three-d-glass .opsPanel,
    body.morph-three-d-glass .opsJobCard,
    body.morph-three-d-glass .hqTopbar,
    body.morph-three-d-glass .hqStat,
    body.morph-three-d-glass .hqColumn,
    body.morph-three-d-glass .hqJob,
    body.morph-three-d-glass .card,
    body.morph-three-d-glass .hubCard,
    body.morph-three-d-glass .formBox,
    body.morph-three-d-glass .final,
    body.morph-three-d-glass .personalHero {
      transform: perspective(1400px) translateY(-12px) rotateX(9deg) rotateY(-2deg) !important;
      background: radial-gradient(680px circle at 14% 0%, rgba(255,255,255,.22), transparent 44%), linear-gradient(135deg, rgba(255,255,255,.17), rgba(255,255,255,.045)) !important;
      border-color: rgba(255,255,255,.24) !important;
      backdrop-filter: blur(34px) saturate(1.25) !important;
      -webkit-backdrop-filter: blur(34px) saturate(1.25) !important;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 18px 0 rgba(255,255,255,.05), 0 46px 118px rgba(0,0,0,.42), 0 0 86px color-mix(in srgb, var(--theme-c, #35d7ff) 20%, transparent) !important;
    }

    body.morph-isometric .card,
    body.morph-isometric .hubCard,
    body.morph-isometric .formBox,
    body.morph-isometric .v20-showcase,
    body.morph-isometric .opsPanel,
    body.morph-isometric .hqJob {
      transform: perspective(1500px) rotateX(14deg) rotateY(-18deg) translateY(-8px) !important;
      box-shadow: 28px 28px 70px rgba(0,0,0,.34), 0 0 64px color-mix(in srgb, var(--theme-a, #7c5cff) 14%, transparent) !important;
    }

    body.morph-layered .card,
    body.morph-layered .hubCard,
    body.morph-layered .formBox,
    body.morph-layered .v20-showcase,
    body.morph-layered .opsPanel,
    body.morph-layered .hqJob {
      transform: translateY(-4px) !important;
      box-shadow: 0 2px 0 rgba(255,255,255,.10), 0 10px 0 color-mix(in srgb, var(--theme-a, #7c5cff) 12%, rgba(0,0,0,.10)), 0 20px 0 color-mix(in srgb, var(--theme-c, #35d7ff) 8%, rgba(0,0,0,.08)), 0 42px 96px rgba(0,0,0,.36) !important;
    }

    body.morph-pressed .card,
    body.morph-pressed .hubCard,
    body.morph-pressed .formBox,
    body.morph-pressed .v20-showcase,
    body.morph-pressed .opsPanel,
    body.morph-pressed .hqJob {
      transform: translateY(1px) !important;
      background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.02)) !important;
      box-shadow: inset 0 8px 18px rgba(0,0,0,.30), inset 0 -2px 8px rgba(255,255,255,.06), 0 16px 48px rgba(0,0,0,.28) !important;
    }

    body.morph-prism .card,
    body.morph-prism .hubCard,
    body.morph-prism .formBox,
    body.morph-prism .v20-showcase,
    body.morph-prism .opsPanel,
    body.morph-prism .hqJob {
      background: linear-gradient(135deg, rgba(255,255,255,.14), rgba(255,255,255,.04)), conic-gradient(from 180deg at 50% 50%, color-mix(in srgb, var(--theme-a, #7c5cff) 18%, transparent), color-mix(in srgb, var(--theme-c, #35d7ff) 18%, transparent), color-mix(in srgb, var(--theme-b, #ff4fd8) 18%, transparent), color-mix(in srgb, var(--theme-a, #7c5cff) 18%, transparent)) !important;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.18), 0 30px 100px rgba(0,0,0,.36), 0 0 100px color-mix(in srgb, var(--theme-c, #35d7ff) 18%, transparent) !important;
    }

    body.morph-floating .card,
    body.morph-floating .hubCard,
    body.morph-floating .formBox,
    body.morph-floating .v20-showcase,
    body.morph-floating .opsPanel,
    body.morph-floating .hqJob {
      transform: translateY(-8px) !important;
      animation: morphFloatBob 6.8s ease-in-out infinite;
      box-shadow: 0 24px 80px rgba(0,0,0,.30), 0 0 56px color-mix(in srgb, var(--theme-a, #7c5cff) 16%, transparent) !important;
    }

    body.morph-frame .card,
    body.morph-frame .hubCard,
    body.morph-frame .formBox,
    body.morph-frame .v20-showcase,
    body.morph-frame .opsPanel,
    body.morph-frame .hqJob {
      background: rgba(255,255,255,.015) !important;
      border: 1.5px solid color-mix(in srgb, var(--theme-c, #35d7ff) 44%, rgba(255,255,255,.18)) !important;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--theme-a, #7c5cff) 26%, transparent), 0 22px 56px rgba(0,0,0,.24) !important;
    }

    @media(max-width:720px) {
      #morphDock {
        right: 12px !important;
        bottom: calc(158px + var(--safe-bottom)) !important;
      }

      #morphDock .morphismGrid {
        grid-template-columns: 1fr !important;
      }

      #morphButton::after {
        display: none;
      }

      body.morph-three-d .card,
      body.morph-three-d .hubCard,
      body.morph-three-d .formBox,
      body.morph-three-d .v20-showcase,
      body.morph-three-d-glass .card,
      body.morph-three-d-glass .hubCard,
      body.morph-three-d-glass .formBox,
      body.morph-three-d-glass .v20-showcase,
      body.morph-isometric .card,
      body.morph-isometric .hubCard,
      body.morph-isometric .formBox,
      body.morph-isometric .v20-showcase {
        transform: translateY(-3px) !important;
      }

      body.morph-floating .card,
      body.morph-floating .hubCard,
      body.morph-floating .formBox,
      body.morph-floating .v20-showcase {
        animation: none !important;
      }
    }

  </style>
</head>
<body class="${mobileClass}" data-device-mode="${escapeHtml(deviceMode)}" data-customer-name="${customer ? escapeHtml((customer.name || "").split(" ")[0]) : ""}">
  <div class="orb one"></div><div class="orb two"></div><div class="orb three"></div><div id="progress" class="progress"></div>
  <div class="v19-premium-field" aria-hidden="true"></div>
  <div class="v19-orb one" aria-hidden="true"></div>
  <div class="v19-orb two" aria-hidden="true"></div>
  <div class="v19-orb three" aria-hidden="true"></div>
  <div class="v19-dust" aria-hidden="true">
    <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
  </div>
  <div class="v19-floating-icons" aria-hidden="true">
    <span>🛒</span><span>🏠</span><span>🥶</span><span>📦</span><span>✨</span><span>🧺</span>
  </div>
  <div class="safeGlowLayer" aria-hidden="true"></div>
  <div class="safeFloatDecor" aria-hidden="true"><span>🛒</span><span>🏠</span><span>🥶</span><span>📦</span></div>
  <div class="mobileAppTop">
    <div class="mobileAppTopInner">
      <a class="appBrand" href="/">
        <span class="appIcon">🛒</span>
        <span class="appBrandText"><strong>${escapeHtml(SERVICE_NAME)}</strong><span id="mobileAppSub">${customer ? `Hey ${escapeHtml((customer.name || "there").split(" ")[0])} · Home Hub` : "Home help, fast"}</span></span>
      </a>
      <div class="appTopActions">
        <a class="appCircleBtn" href="/account" aria-label="Account">👤</a>
        <a class="appCircleBtn" href="tel:${BUSINESS_PHONE}" aria-label="Call">📞</a>
      </div>
    </div>
  </div>
  ${body}
  <div id="installBanner" class="installBanner">
    <div class="installBannerRow">
      <div class="installBannerIcon">📲</div>
      <div class="installBannerText"><strong>Add Dropcart to your phone</strong><span>Open it like an app from your home screen.</span></div>
    </div>
    <div class="installBannerBtns">
      <button id="installBtn" class="btn primary" type="button">Install</button>
      <button id="installDismiss" class="btn ghost" type="button">Not now</button>
    </div>
  </div>
  <div id="quickSheet" class="mobileQuickSheet" aria-hidden="true">
    <div class="quickSheetPanel">
      <div class="quickHandle"></div>
      <h3 class="display" style="font-size:28px;letter-spacing:-.05em;margin-bottom:6px">Quick actions</h3>
      <p style="color:rgba(255,255,255,.55);font-size:14px;line-height:1.5;margin-bottom:14px">Book, call, text, or open your Home Hub.</p>
      <div class="quickGrid">
        <a class="btn primary" href="/#contact">Book unload</a>
        <a class="btn ghost" href="tel:${BUSINESS_PHONE}">Call</a>
        <a class="btn ghost" href="sms:${BUSINESS_PHONE}?body=Hey%20Dropcart%2C%20I%20need%20a%20grocery%20unload.">Text</a>
        <a class="btn ghost" href="/account">Home Hub</a>
      </div>
      <button id="quickClose" class="btn ghost" style="margin-top:10px;width:100%" type="button">Close</button>
    </div>
  </div>
  <nav class="appBottomNav" aria-label="Mobile app navigation">
    <a href="/" data-tab="home"><span>🏠</span>Home</a>
    <a href="/#estimate" data-tab="estimate"><span>💸</span>Estimate</a>
    <button id="quickOpen" type="button"><span>➕</span>Book</button>
    <a href="/account" data-tab="account"><span>👤</span>Hub</a>
  </nav>
  
  <div id="audioDock" class="audioDock" aria-live="polite">
    <div class="audioDockPanel">
      <div class="audioDockTitle">
        <div>
          <strong>Dropcart Sound</strong>
          <span>Original ambient loop + soft UI sounds</span>
        </div>
        <button id="audioClose" class="audioSmallBtn" type="button" aria-label="Close audio panel">✕</button>
      </div>

      <div class="audioNowPlaying">
        <div class="audioBars" aria-hidden="true">
          <i></i><i></i><i></i><i></i>
        </div>
        <div class="audioNowText">
          <strong id="audioTrackName">Soft Night Grocery Run</strong>
          <span id="audioTrackDesc">A calm synth loop generated in-browser.</span>
        </div>
      </div>

      <div class="audioControls">
        <button id="audioPlayPause" class="audioSmallBtn active" type="button">Play music</button>
        <button id="audioSfxToggle" class="audioSmallBtn active" type="button">SFX on</button>
        <button id="audioMoodCalm" class="audioSmallBtn active" type="button">Calm</button>
        <button id="audioMoodEnergy" class="audioSmallBtn" type="button">Energy</button>
      </div>

      <div class="audioRangeWrap">
        <div class="audioRangeTop">
          <span>Volume</span>
          <span id="audioVolumeLabel">35%</span>
        </div>
        <input id="audioVolume" class="audioRange" type="range" min="0" max="100" value="35" />
      </div>

      <p class="audioHint">
        Browsers block autoplay, so music starts only after tapping play. No copyrighted audio files are used.
      </p>
    </div>

    <button id="audioMainButton" class="audioMainButton" type="button">
      <span>♪</span>
      Sound
    </button>
  </div>

  
  <div id="v22ConfettiLayer" class="v22-confetti-layer" aria-hidden="true"></div>
  <div id="v22SenseToast" class="v22-sense-toast" aria-live="polite"></div>

  
  
  <script>
    window.openMorphStudio = function(){
      if (window.DropcartMorph && window.DropcartMorph.open) {
        window.DropcartMorph.open();
        return false;
      }
      var dock = document.getElementById('morphDock');
      if (dock) dock.classList.add('open');
      return false;
    };
  </script>

  <div id="morphDebugToast"></div>

  <div id="morphDock" class="morphDock">
    <div class="morphDockPanel">
      <div class="morphDockTitle">
        <div>
          <strong>Morphism Studio</strong>
          <span>Choose the shape/depth style. This stacks with any theme.</span>
        </div>
        <button id="morphClose" class="sensoryMiniButton" type="button" aria-label="Close morphism panel">✕</button>
      </div>

      <div id="morphStatus" class="morphStatus"><strong>Current:</strong> Regular theme style</div>

      <div class="morphismGrid">
        <button class="morphismOption" data-morph="none" data-morph-label="Regular theme style" type="button" onclick="window.DropcartMorph?.set?.('none'); return false;"><b>◎</b><strong>None</strong><span>Regular theme style</span></button>
        <button class="morphismOption" data-morph="glass" data-morph-label="Glassmorphism active" type="button" onclick="window.DropcartMorph?.set?.('glass'); return false;"><b>🪟</b><strong>Glass</strong><span>Ultra-blur glassmorphism</span></button>
        <button class="morphismOption" data-morph="liquid" data-morph-label="Liquid morphism active" type="button" onclick="window.DropcartMorph?.set?.('liquid'); return false;"><b>💧</b><strong>Liquid</strong><span>Organic liquid card shapes</span></button>
        <button class="morphismOption" data-morph="neo" data-morph-label="Neumorphism active" type="button" onclick="window.DropcartMorph?.set?.('neo'); return false;"><b>◓</b><strong>Neo</strong><span>Soft raised neumorphism</span></button>
        <button class="morphismOption" data-morph="clay" data-morph-label="Claymorphism active" type="button" onclick="window.DropcartMorph?.set?.('clay'); return false;"><b>🧱</b><strong>Clay</strong><span>Chunky claymorphism depth</span></button>
        <button class="morphismOption" data-morph="crystal" data-morph-label="Crystal morphism active" type="button" onclick="window.DropcartMorph?.set?.('crystal'); return false;"><b>◇</b><strong>Crystal</strong><span>Sharp glass/facet style</span></button>
        <button class="morphismOption" data-morph="holo" data-morph-label="Holographic morphism active" type="button" onclick="window.DropcartMorph?.set?.('holo'); return false;"><b>🌈</b><strong>Holo</strong><span>Holographic glow layer</span></button>
        <button class="morphismOption" data-morph="soft" data-morph-label="Soft depth active" type="button" onclick="window.DropcartMorph?.set?.('soft'); return false;"><b>☁️</b><strong>Soft</strong><span>Softer rounded depth</span></button>
        <button class="morphismOption" data-morph="three-d" data-morph-label="3D Lift active" type="button" onclick="window.DropcartMorph?.set?.('three-d'); return false;"><b>🧊</b><strong>3D Lift</strong><span>Lifted cards with cinematic depth</span></button>
        <button class="morphismOption" data-morph="three-d-glass" data-morph-label="3D Glass active" type="button" onclick="window.DropcartMorph?.set?.('three-d-glass'); return false;"><b>🔮</b><strong>3D Glass</strong><span>Layered glass with deep shadows</span></button>
        <button class="morphismOption" data-morph="isometric" data-morph-label="Isometric morph active" type="button" onclick="window.DropcartMorph?.set?.('isometric'); return false;"><b>📐</b><strong>Isometric</strong><span>Angled dashboard perspective</span></button>
        <button class="morphismOption" data-morph="layered" data-morph-label="Layered morph active" type="button" onclick="window.DropcartMorph?.set?.('layered'); return false;"><b>🗂️</b><strong>Layered</strong><span>Stacked panel edges and depth</span></button>
        <button class="morphismOption" data-morph="pressed" data-morph-label="Pressed morph active" type="button" onclick="window.DropcartMorph?.set?.('pressed'); return false;"><b>🫧</b><strong>Pressed</strong><span>Inset pressed-in control surfaces</span></button>
        <button class="morphismOption" data-morph="prism" data-morph-label="Prism morph active" type="button" onclick="window.DropcartMorph?.set?.('prism'); return false;"><b>💠</b><strong>Prism</strong><span>Iridescent gem depth</span></button>
        <button class="morphismOption" data-morph="floating" data-morph-label="Floating morph active" type="button" onclick="window.DropcartMorph?.set?.('floating'); return false;"><b>🎈</b><strong>Floating</strong><span>Bobbing cards with airy spacing</span></button>
        <button class="morphismOption" data-morph="frame" data-morph-label="Frame morph active" type="button" onclick="window.DropcartMorph?.set?.('frame'); return false;"><b>🧿</b><strong>Frame</strong><span>Clean wireframe outline style</span></button>
      </div>
      </div>

      <p class="morphDockHint">
        This is separate from themes. Try Snow + 3D Glass, Galaxy + Prism, or Luxury + Isometric.
      </p>
    </div>

    <button id="morphButton" class="morphButton" type="button">
      <span>◇</span>
      Morph
    </button>
  </div>

  <script>
    window.DropcartMorph = (function(){
      const morphClasses = ['morph-glass','morph-liquid','morph-neo','morph-clay','morph-crystal','morph-holo','morph-soft','morph-three-d','morph-three-d-glass','morph-isometric','morph-layered','morph-pressed','morph-prism','morph-floating','morph-frame'];
      const labels = {
        none: 'Regular theme style',
        glass: 'Glassmorphism active',
        liquid: 'Liquid morphism active',
        neo: 'Neumorphism active',
        clay: 'Claymorphism active',
        crystal: 'Crystal morphism active',
        holo: 'Holographic morphism active',
        soft: 'Soft depth active',
        'three-d': '3D Lift active',
        'three-d-glass': '3D Glass active',
        isometric: 'Isometric morph active',
        layered: 'Layered morph active',
        pressed: 'Pressed morph active',
        prism: 'Prism morph active',
        floating: 'Floating morph active',
        frame: 'Frame morph active'
      };

      function byId(id) {
        return document.getElementById(id);
      }

      function getMorph(){
        return localStorage.getItem('dropcartMorphism') || 'none';
      }

      function toast(message) {
        const el = byId('morphDebugToast');
        if (!el) return;
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(function(){ el.classList.remove('show'); }, 1200);
      }

      function apply(morph){
        const next = morph || getMorph();
        if (!document.body) return;

        document.body.classList.remove.apply(document.body.classList, morphClasses);

        if (next && next !== 'none') {
          document.body.classList.add('morph-' + next);
        }

        document.querySelectorAll('.morphismOption[data-morph]').forEach(function(btn){
          btn.classList.toggle('active', btn.dataset.morph === next);
        });

        const status = byId('morphStatus');
        if (status) status.innerHTML = '<strong>Current:</strong> ' + (labels[next] || next);

        const button = byId('morphButton');
        if (button) {
          button.setAttribute('data-current-morph', next);
          button.title = labels[next] || next;
        }
      }

      function open(){
        const dock = byId('morphDock');
        if (!dock) {
          toast('Morph panel missing');
          return;
        }
        dock.classList.add('open');
        apply();
      }

      function close(){
        const dock = byId('morphDock');
        if (dock) dock.classList.remove('open');
      }

      function toggle(){
        const dock = byId('morphDock');
        if (!dock) {
          toast('Morph panel missing');
          return;
        }
        dock.classList.toggle('open');
        apply();
      }

      function set(morph){
        const next = morph || 'none';
        localStorage.setItem('dropcartMorphism', next);
        apply(next);
        open();
        toast(labels[next] || next);
        try { if (navigator.vibrate) navigator.vibrate(10); } catch(e) {}
      }

      function bind(){
        const dock = byId('morphDock');
        const button = byId('morphButton');
        const closeBtn = byId('morphClose');

        if (button && !button.dataset.morphBound) {
          button.dataset.morphBound = 'true';
          button.addEventListener('click', function(e){
            e.preventDefault();
            e.stopPropagation();
            toggle();
          }, false);
        }

        if (closeBtn && !closeBtn.dataset.morphBound) {
          closeBtn.dataset.morphBound = 'true';
          closeBtn.addEventListener('click', function(e){
            e.preventDefault();
            e.stopPropagation();
            close();
          }, false);
        }

        document.querySelectorAll('.morphismOption[data-morph]').forEach(function(btn){
          if (btn.dataset.morphBound) return;
          btn.dataset.morphBound = 'true';
          btn.addEventListener('click', function(e){
            e.preventDefault();
            e.stopPropagation();
            set(btn.dataset.morph || 'none');
          }, false);
        });

        // Close only when clicking outside the Morph panel/button.
        document.addEventListener('click', function(e){
          if (!dock || !dock.classList.contains('open')) return;
          if (dock.contains(e.target)) return;
          close();
        }, false);

        apply();
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind, { once: true });
      } else {
        bind();
      }

      apply();

      return { get: getMorph, set, apply, open, close, toggle, bind };
    })();
  </script>



  <div id="sensoryDock" class="sensoryDock">
    <div class="sensoryPanel">
      <div class="sensoryTitle">
        <div>
          <strong>Theme Studio</strong>
          <span>Change the entire site design, effects, haptics, and voice.</span>
        </div>
        <button id="sensoryClose" class="sensoryMiniButton" type="button" aria-label="Close sensory panel">✕</button>
      </div>

      <div class="themeStudioHeader">
        <div>
          <strong>Featured themes</strong>
          <span>Pick one fast, or open the full theme library.</span>
        </div>
        <button id="moreThemesToggle" class="themeMoreButton" type="button" aria-expanded="false">
          <span>+</span>
          More
        </button>
      </div>

      <div class="sensoryGrid themePrimaryGrid">
        <button class="sensoryOption" data-vibe="twilight" type="button"><b>🌌</b><strong>Twilight</strong><span>Purple, blue, premium glow</span></button>
        <button class="sensoryOption" data-vibe="ocean" type="button"><b>🌊</b><strong>Ocean</strong><span>Cool blue and calm energy</span></button>
        <button class="sensoryOption" data-vibe="fresh" type="button"><b>🍃</b><strong>Fresh</strong><span>Green, clean, grocery-day feel</span></button>
        <button class="sensoryOption" data-vibe="night" type="button"><b>🌙</b><strong>Night</strong><span>Darker low-light mode</span></button>
      </div>

      <div id="moreThemesPanel" class="moreThemesPanel themeGalleryPanel" hidden>
        <div class="moreThemesLabel">
          <strong>Theme Gallery</strong>
          <span>Grouped by what they change: premium looks, weather effects, nature effects, seasonal moments, and playful energy.</span>
        </div>

        <div class="themeGallery">
          <section class="themeCategory">
            <div class="themeCategoryHead">
              <strong>Premium looks</strong>
              <span>Full-site style changes without heavy particle effects.</span>
            </div>
            <div class="sensoryGrid themeCategoryGrid">
              <button class="sensoryOption premiumTheme" data-vibe="luxury" type="button"><b>💎</b><strong>Luxury</strong><span>Black/gold concierge look</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="sunset" type="button"><b>🌅</b><strong>Sunset</strong><span>Warm pink-orange glow</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="ice" type="button"><b>🧊</b><strong>Ice</strong><span>Frozen clean glass style</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="mono" type="button"><b>◼</b><strong>Mono</strong><span>Sharp black/white mode</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="royal" type="button"><b>👑</b><strong>Royal</strong><span>Deep violet and silver</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="espresso" type="button"><b>☕</b><strong>Espresso</strong><span>Coffee, cream, classy local feel</span></button>
            </div>
          </section>

          <section class="themeCategory">
            <div class="themeCategoryHead">
              <strong>Weather + atmosphere</strong>
              <span>These add environmental motion like snow, rain, fog, sand, and sparks.</span>
            </div>
            <div class="sensoryGrid themeCategoryGrid">
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="snow" type="button"><b>❄️</b><strong>Snow</strong><span>Falling snow + frosty glass</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="rain" type="button"><b>🌧️</b><strong>Rain</strong><span>Rain streaks + moody UI</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="fog" type="button"><b>🌫️</b><strong>Fog</strong><span>Slow fog layers + soft focus</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="desert" type="button"><b>🏜️</b><strong>Desert</strong><span>Sand drift + heat shimmer</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="storm" type="button"><b>⛈️</b><strong>Storm</strong><span>Lightning-style focused ops</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="meteor" type="button"><b>☄️</b><strong>Meteor</strong><span>Shooting streaks + space energy</span></button>
            </div>
          </section>

          <section class="themeCategory">
            <div class="themeCategoryHead">
              <strong>Nature + calm</strong>
              <span>Soft motion for a friendly local service feel.</span>
            </div>
            <div class="sensoryGrid themeCategoryGrid">
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="fireflies" type="button"><b>✨</b><strong>Fireflies</strong><span>Warm floating lights</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="blossom" type="button"><b>🌸</b><strong>Blossom</strong><span>Falling spring petals</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="autumn" type="button"><b>🍂</b><strong>Autumn</strong><span>Falling leaves + amber cards</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="lavender" type="button"><b>🪻</b><strong>Lavender</strong><span>Calm purple and friendly</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="mint" type="button"><b>🌿</b><strong>Mint</strong><span>Clean mint grocery aesthetic</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="cozy" type="button"><b>🧺</b><strong>Cozy</strong><span>Warm home comfort</span></button>
            </div>
          </section>

          <section class="themeCategory">
            <div class="themeCategoryHead">
              <strong>Fun + playful</strong>
              <span>More personality for social posts, promos, and younger customers.</span>
            </div>
            <div class="sensoryGrid themeCategoryGrid">
              <button class="sensoryOption premiumTheme" data-vibe="candy" type="button"><b>🍬</b><strong>Candy</strong><span>Bright social-media look</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="citrus" type="button"><b>🍋</b><strong>Citrus</strong><span>Lemon-lime energy</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="bubbles" type="button"><b>🫧</b><strong>Bubbles</strong><span>Rising bubbles + fresh shine</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="confetti" type="button"><b>🎉</b><strong>Confetti</strong><span>Celebration pieces drifting down</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="peach" type="button"><b>🍑</b><strong>Peach</strong><span>Friendly peach social vibe</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="market" type="button"><b>🥕</b><strong>Market</strong><span>Local farm stand colors</span></button>
            </div>
          </section>

          <section class="themeCategory">
            <div class="themeCategoryHead">
              <strong>High-energy / tech</strong>
              <span>Animated, futuristic looks for the HQ and dispatch side.</span>
            </div>
            <div class="sensoryGrid themeCategoryGrid">
              <button class="sensoryOption premiumTheme" data-vibe="cyber" type="button"><b>🧬</b><strong>Cyber</strong><span>Electric dispatch style</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="laser" type="button"><b>🔦</b><strong>Laser</strong><span>Neon scan lines + tech glow</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="matrix" type="button"><b>⌨️</b><strong>Matrix</strong><span>Digital rain + dark ops UI</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="arcade" type="button"><b>🕹️</b><strong>Arcade</strong><span>Pixel sparks + playful neon</span></button>
              <button class="sensoryOption premiumTheme" data-vibe="aurora" type="button"><b>🟣</b><strong>Aurora</strong><span>Northern lights glow</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="galaxy" type="button"><b>🌌</b><strong>Galaxy</strong><span>Stars + cosmic glow</span></button>
            </div>
          </section>

          <section class="themeCategory">
            <div class="themeCategoryHead">
              <strong>Seasonal / promo</strong>
              <span>Great for limited-time promos, holidays, and special events.</span>
            </div>
            <div class="sensoryGrid themeCategoryGrid">
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="christmas" type="button"><b>🎄</b><strong>Christmas</strong><span>Holiday lights + snow</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="valentine" type="button"><b>💘</b><strong>Valentine</strong><span>Floating hearts + pink glow</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="halloween" type="button"><b>🎃</b><strong>Halloween</strong><span>Pumpkin glow + spooky particles</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="patriotic" type="button"><b>🇺🇸</b><strong>Patriotic</strong><span>Red/white/blue spark trails</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="birthday" type="button"><b>🎂</b><strong>Birthday</strong><span>Balloons + party colors</span></button>
              <button class="sensoryOption premiumTheme effectTheme" data-vibe="summer" type="button"><b>☀️</b><strong>Summer</strong><span>Sun rays + beachy glow</span></button>
            </div>
          </section>
        </div>
      </div>

      <div class="sensoryActions">
        <button id="hapticsToggle" class="sensoryMiniButton" type="button">Haptics</button>
        <button id="voiceGreeting" class="sensoryMiniButton" type="button">Voice greet</button>
        <button id="celebrateButton" class="sensoryMiniButton" type="button">Celebrate</button>
        <button id="reduceSensoryToggle" class="sensoryMiniButton" type="button">Calm mode</button>
      </div>

      <p class="sensoryHint">
        Haptics work on supported Android phones. Voice uses your browser’s built-in speech feature.
      </p>
    </div>

    <button id="sensoryButton" class="sensoryButton" type="button">
      <span>✦</span>
      Theme
    </button>
  </div>

  
    <div id="morphBlobLayer" class="morphBlobLayer" aria-hidden="true">
    <span style="--x:4%;--y:12%;--s:360px;--d:18s;--delay:-2s;--o:.24"></span>
    <span style="--x:64%;--y:8%;--s:300px;--d:16s;--delay:-8s;--o:.20"></span>
    <span style="--x:22%;--y:62%;--s:420px;--d:22s;--delay:-11s;--o:.18"></span>
    <span style="--x:72%;--y:58%;--s:340px;--d:20s;--delay:-5s;--o:.20"></span>
  </div>

  <div id="themeFxLayer" class="themeFxLayer" aria-hidden="true"></div>

  <div id="toast" class="toast"></div>
  <script>
    const $ = (s, r=document) => r.querySelector(s);
    const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
    
    (function detectMobileFallback(){
      const params = new URLSearchParams(window.location.search);
      const forced = params.get('view');
      if (forced === 'desktop') return;
      const mobileByScreen = window.matchMedia('(max-width: 720px)').matches;
      const mobileByTouch = navigator.maxTouchPoints > 1 && window.innerWidth <= 900;
      if ((forced === 'mobile' || mobileByScreen || mobileByTouch) && document.body) {
        document.documentElement.classList.remove('is-desktop-device');
        document.documentElement.classList.add('is-mobile-device');
        document.body.classList.remove('is-desktop-device');
        document.body.classList.add('is-mobile-device');
        document.body.dataset.deviceMode = 'mobile';
      }
    })();

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

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(() => {});
      });
    }

    let deferredInstallPrompt = null;
    const installBanner = $('#installBanner');
    const installBtn = $('#installBtn');
    const installDismiss = $('#installDismiss');
    const installDismissed = localStorage.getItem('dropcartInstallDismissed') === 'yes';

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (installBanner && !installDismissed && window.matchMedia('(max-width:720px)').matches) {
        setTimeout(() => installBanner.classList.add('show'), 1200);
      }
    });

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) {
          showToast('Use your browser menu and choose Add to Home Screen.');
          return;
        }
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice.catch(() => {});
        deferredInstallPrompt = null;
        installBanner?.classList.remove('show');
      });
    }

    if (installDismiss) {
      installDismiss.addEventListener('click', () => {
        localStorage.setItem('dropcartInstallDismissed', 'yes');
        installBanner?.classList.remove('show');
      });
    }

    const quickOpen = $('#quickOpen');
    const quickClose = $('#quickClose');
    const quickSheet = $('#quickSheet');
    if (quickOpen && quickSheet) {
      quickOpen.addEventListener('click', () => {
        quickSheet.classList.add('show');
        quickSheet.setAttribute('aria-hidden', 'false');
      });
    }
    if (quickClose && quickSheet) {
      quickClose.addEventListener('click', () => {
        quickSheet.classList.remove('show');
        quickSheet.setAttribute('aria-hidden', 'true');
      });
      quickSheet.addEventListener('click', (event) => {
        if (event.target === quickSheet) {
          quickSheet.classList.remove('show');
          quickSheet.setAttribute('aria-hidden', 'true');
        }
      });
    }

    
    function setMobileActiveTab(){
      const pathNow = window.location.pathname;
      const hashNow = window.location.hash;
      $$('.appBottomNav [data-tab]').forEach(link => link.classList.remove('active'));
      $$('.appBottomNav [data-tab]').forEach(link => {
        const tab = link.getAttribute('data-tab');
        if ((tab === 'home' && pathNow === '/' && !hashNow) ||
            (tab === 'account' && pathNow.startsWith('/account')) ||
            (tab === 'estimate' && hashNow === '#estimate')) {
          link.classList.add('active');
        }
      });
      const sub = $('#mobileAppSub');
      if(sub && document.body?.dataset?.deviceMode === 'mobile'){
        if(pathNow.startsWith('/account')) sub.textContent = sub.textContent.includes('Hey') ? sub.textContent : 'Your Home Hub';
        else if(hashNow === '#estimate') sub.textContent = 'Quick estimate';
        else if(pathNow.startsWith('/login')) sub.textContent = 'Welcome back';
        else if(pathNow.startsWith('/signup')) sub.textContent = 'Create your account';
      }
    }
    setMobileActiveTab();
    window.addEventListener('hashchange', setMobileActiveTab);



    $$('.appBottomNav a,.appBottomNav button,.quickGrid .btn').forEach(el => {
      el.addEventListener('click', () => {
        if (navigator.vibrate && document.body?.dataset?.deviceMode === 'mobile') navigator.vibrate(8);
      });
    });


    function closeMobileOverlays(){
      const qs = $('#quickSheet');
      if(qs && !qs.classList.contains('show')){
        qs.setAttribute('aria-hidden','true');
      }
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    closeMobileOverlays();
    window.addEventListener('pageshow', closeMobileOverlays);


    // v19 safe visual class enhancer
    (function applyV19VisualClasses(){
      const premiumTargets = $$('.card,.hubCard,.formBox,.final,.device,.screen,.estimateResult');
      premiumTargets.forEach((el, index) => {
        if (!el.classList.contains('v19-premium-border') && index % 3 === 0) {
          el.classList.add('v19-premium-border');
        }
        const depthClass = 'v19-depth-card-' + ((index % 120) + 1);
        if (index % 5 === 0 && !el.classList.contains(depthClass)) {
          el.classList.add(depthClass);
        }
        const glowClass = 'v19-glow-accent-' + ((index % 120) + 1);
        if (index % 7 === 0 && !el.classList.contains(glowClass)) {
          el.classList.add(glowClass);
        }
      });
    })();

    // v19 safe tap feedback: class only, no DOM mutation
    $$('.btn').forEach((btn) => {
      btn.addEventListener('pointerdown', () => {
        btn.classList.add('is-pressing');
      }, { passive: true });
      btn.addEventListener('pointerup', () => {
        btn.classList.remove('is-pressing');
      }, { passive: true });
      btn.addEventListener('pointerleave', () => {
        btn.classList.remove('is-pressing');
      }, { passive: true });
    });


    // v21 Original in-browser music + UI sound effects
    (function initDropcartAudio(){
      const dock = $('#audioDock');
      const mainButton = $('#audioMainButton');
      const closeButton = $('#audioClose');
      const playPause = $('#audioPlayPause');
      const sfxToggle = $('#audioSfxToggle');
      const volume = $('#audioVolume');
      const volumeLabel = $('#audioVolumeLabel');
      const calmButton = $('#audioMoodCalm');
      const energyButton = $('#audioMoodEnergy');
      const trackName = $('#audioTrackName');
      const trackDesc = $('#audioTrackDesc');

      if (!dock || !mainButton || !playPause || !volume) return;

      let audioCtx = null;
      let master = null;
      let musicGain = null;
      let sfxGain = null;
      let delay = null;
      let feedback = null;
      let filter = null;
      let playing = false;
      let sfxOn = localStorage.getItem('dropcartSfx') !== 'off';
      let mood = localStorage.getItem('dropcartMood') || 'calm';
      let timerIds = [];
      let currentStep = 0;

      const calmPattern = [
        { note: 261.63, bass: 130.81 },
        { note: 329.63, bass: 164.81 },
        { note: 392.00, bass: 196.00 },
        { note: 293.66, bass: 146.83 },
        { note: 349.23, bass: 174.61 },
        { note: 440.00, bass: 220.00 },
        { note: 392.00, bass: 196.00 },
        { note: 329.63, bass: 164.81 }
      ];

      const energyPattern = [
        { note: 392.00, bass: 196.00 },
        { note: 493.88, bass: 246.94 },
        { note: 587.33, bass: 293.66 },
        { note: 523.25, bass: 261.63 },
        { note: 659.25, bass: 329.63 },
        { note: 587.33, bass: 293.66 },
        { note: 493.88, bass: 246.94 },
        { note: 440.00, bass: 220.00 }
      ];

      function getVolume(){
        return Math.max(0, Math.min(1, Number(volume.value || 35) / 100));
      }

      function setButtons(){
        dock.classList.toggle('playing', playing);
        document.body.classList.toggle('audio-sfx-on', sfxOn);
        playPause.textContent = playing ? 'Pause music' : 'Play music';
        sfxToggle.textContent = sfxOn ? 'SFX on' : 'SFX off';
        sfxToggle.classList.toggle('active', sfxOn);
        calmButton?.classList.toggle('active', mood === 'calm');
        energyButton?.classList.toggle('active', mood === 'energy');
        if (trackName && trackDesc) {
          if (mood === 'energy') {
            trackName.textContent = 'Bright Delivery Pulse';
            trackDesc.textContent = 'A light upbeat synth loop generated in-browser.';
          } else {
            trackName.textContent = 'Soft Night Grocery Run';
            trackDesc.textContent = 'A calm synth loop generated in-browser.';
          }
        }
      }

      function setupAudio(){
        if (audioCtx) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
          showToast('Audio is not supported on this browser.');
          return;
        }

        audioCtx = new Ctx();
        master = audioCtx.createGain();
        musicGain = audioCtx.createGain();
        sfxGain = audioCtx.createGain();
        filter = audioCtx.createBiquadFilter();
        delay = audioCtx.createDelay();
        feedback = audioCtx.createGain();

        master.gain.value = getVolume();
        musicGain.gain.value = 0.0;
        sfxGain.gain.value = sfxOn ? 0.23 : 0.0;

        filter.type = 'lowpass';
        filter.frequency.value = mood === 'energy' ? 1300 : 900;
        filter.Q.value = 0.8;

        delay.delayTime.value = mood === 'energy' ? 0.18 : 0.28;
        feedback.gain.value = mood === 'energy' ? 0.16 : 0.22;

        musicGain.connect(filter);
        filter.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(master);
        filter.connect(master);
        sfxGain.connect(master);
        master.connect(audioCtx.destination);
      }

      function clearTimers(){
        timerIds.forEach((id) => clearTimeout(id));
        timerIds = [];
      }

      function playTone(freq, start, duration, gainValue, type, destination, detune = 0){
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, start);
        osc.detune.setValueAtTime(detune, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), start + 0.035);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        osc.connect(gain);
        gain.connect(destination || musicGain);

        osc.start(start);
        osc.stop(start + duration + 0.04);
      }

      function playNoise(start, duration, gainValue){
        if (!audioCtx) return;
        const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }

        const noise = audioCtx.createBufferSource();
        const gain = audioCtx.createGain();
        const bp = audioCtx.createBiquadFilter();

        bp.type = 'bandpass';
        bp.frequency.value = mood === 'energy' ? 2200 : 1400;
        bp.Q.value = 2.4;

        gain.gain.setValueAtTime(gainValue, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        noise.buffer = buffer;
        noise.connect(bp);
        bp.connect(gain);
        gain.connect(musicGain);
        noise.start(start);
        noise.stop(start + duration);
      }

      function scheduleStep(){
        if (!playing || !audioCtx) return;
        const pattern = mood === 'energy' ? energyPattern : calmPattern;
        const item = pattern[currentStep % pattern.length];
        const now = audioCtx.currentTime + 0.04;
        const tempo = mood === 'energy' ? 720 : 980;
        const dur = mood === 'energy' ? 0.36 : 0.58;

        playTone(item.bass, now, dur + 0.2, mood === 'energy' ? 0.040 : 0.032, 'sine', musicGain);
        playTone(item.note, now + 0.02, dur, mood === 'energy' ? 0.030 : 0.022, 'triangle', musicGain, -3);
        playTone(item.note * 1.5, now + 0.08, dur * 0.75, mood === 'energy' ? 0.014 : 0.010, 'sine', musicGain, 4);

        if (mood === 'energy' || currentStep % 2 === 0) {
          playNoise(now + 0.01, 0.055, mood === 'energy' ? 0.010 : 0.006);
        }

        currentStep++;
        timerIds.push(setTimeout(scheduleStep, tempo));
      }

      async function startMusic(){
        setupAudio();
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        playing = true;
        clearTimers();
        musicGain.gain.cancelScheduledValues(audioCtx.currentTime);
        musicGain.gain.setValueAtTime(musicGain.gain.value || 0.0001, audioCtx.currentTime);
        musicGain.gain.linearRampToValueAtTime(0.78, audioCtx.currentTime + 0.35);
        currentStep = 0;
        scheduleStep();
        setButtons();
        localStorage.setItem('dropcartMusic', 'on');
        sfx('open');
      }

      function stopMusic(){
        if (!audioCtx || !musicGain) {
          playing = false;
          setButtons();
          return;
        }

        playing = false;
        clearTimers();
        musicGain.gain.cancelScheduledValues(audioCtx.currentTime);
        musicGain.gain.setValueAtTime(musicGain.gain.value, audioCtx.currentTime);
        musicGain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
        setButtons();
        localStorage.setItem('dropcartMusic', 'off');
      }

      function sfx(kind){
        if (!sfxOn) return;
        setupAudio();
        if (!audioCtx || !sfxGain) return;
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

        const now = audioCtx.currentTime + 0.01;
        if (kind === 'success') {
          playTone(523.25, now, 0.13, 0.10, 'sine', sfxGain);
          playTone(659.25, now + 0.08, 0.16, 0.08, 'triangle', sfxGain);
          playTone(783.99, now + 0.16, 0.20, 0.06, 'sine', sfxGain);
        } else if (kind === 'open') {
          playTone(392.00, now, 0.10, 0.08, 'triangle', sfxGain);
          playTone(587.33, now + 0.06, 0.13, 0.05, 'sine', sfxGain);
        } else if (kind === 'toggle') {
          playTone(440.00, now, 0.08, 0.06, 'sine', sfxGain);
        } else {
          playTone(660.00, now, 0.045, 0.035, 'sine', sfxGain);
        }
      }

      mainButton.addEventListener('click', async () => {
        dock.classList.toggle('open');
        sfx('open');
      });

      closeButton?.addEventListener('click', () => {
        dock.classList.remove('open');
        sfx('toggle');
      });

      playPause.addEventListener('click', async () => {
        if (playing) stopMusic();
        else await startMusic();
      });

      sfxToggle.addEventListener('click', () => {
        sfxOn = !sfxOn;
        localStorage.setItem('dropcartSfx', sfxOn ? 'on' : 'off');
        if (sfxGain) sfxGain.gain.value = sfxOn ? 0.23 : 0.0;
        setButtons();
        if (sfxOn) sfx('success');
      });

      calmButton?.addEventListener('click', () => {
        mood = 'calm';
        localStorage.setItem('dropcartMood', mood);
        if (filter) filter.frequency.value = 900;
        if (delay) delay.delayTime.value = 0.28;
        if (feedback) feedback.gain.value = 0.22;
        currentStep = 0;
        setButtons();
        sfx('toggle');
      });

      energyButton?.addEventListener('click', () => {
        mood = 'energy';
        localStorage.setItem('dropcartMood', mood);
        if (filter) filter.frequency.value = 1300;
        if (delay) delay.delayTime.value = 0.18;
        if (feedback) feedback.gain.value = 0.16;
        currentStep = 0;
        setButtons();
        sfx('success');
      });

      volume.addEventListener('input', () => {
        const pct = Math.round(getVolume() * 100);
        if (volumeLabel) volumeLabel.textContent = pct + '%';
        if (master) master.gain.value = getVolume();
        localStorage.setItem('dropcartVolume', String(pct));
      });

      const savedVolume = localStorage.getItem('dropcartVolume');
      if (savedVolume !== null) {
        volume.value = savedVolume;
      }
      if (volumeLabel) volumeLabel.textContent = Math.round(getVolume() * 100) + '%';

      setButtons();

      // Soft UI sounds for important actions only
      $$('.btn,.audioSmallBtn,.appBottomNav a,.appBottomNav button').forEach((el) => {
        el.addEventListener('click', () => {
          if (!el.closest('#audioDock')) sfx('tap');
        });
      });

      $$('#requestForm, #estimateForm, .bookingForm').forEach((form) => {
        form.addEventListener('submit', () => sfx('success'));
      });
    })();


    // v22 sensory features: haptics, mood themes, voice greeting, celebration
    (function initSensoryLayer(){
      const dock = $('#sensoryDock');
      const openBtn = $('#sensoryButton');
      const closeBtn = $('#sensoryClose');
      const hapticsBtn = $('#hapticsToggle');
      const voiceBtn = $('#voiceGreeting');
      const celebrateBtn = $('#celebrateButton');
      const calmBtn = $('#reduceSensoryToggle');
      const confettiLayer = $('#v22ConfettiLayer');
      const senseToast = $('#v22SenseToast');

      if (!dock || !openBtn) return;

      let vibe = localStorage.getItem('dropcartVibe') || 'twilight';
      let haptics = localStorage.getItem('dropcartHaptics') === 'on';
      let reducedSensory = localStorage.getItem('dropcartReducedSensory') === 'on';

      let morphism = localStorage.getItem('dropcartMorphism') || 'none';
      const morphClasses = ['morph-glass','morph-liquid','morph-neo','morph-clay','morph-crystal','morph-holo','morph-soft','morph-three-d','morph-three-d-glass','morph-isometric','morph-layered','morph-pressed','morph-prism','morph-floating','morph-frame'];

      function applyMorphism(){
        document.body.classList.remove(...morphClasses);
        if (morphism && morphism !== 'none') {
          document.body.classList.add('morph-' + morphism);
        }

        $$('.morphismOption[data-morph]').forEach(function(btn){
          btn.classList.toggle('active', btn.dataset.morph === morphism);
        });
      }

      $$('.morphismOption[data-morph]').forEach(function(btn){
        btn.addEventListener('click', function(){
          morphism = btn.dataset.morph || 'none';
          localStorage.setItem('dropcartMorphism', morphism);
          applyMorphism();
          vibrate(10);
          sensoryToast(morphism === 'none' ? 'Morphism disabled' : btn.querySelector('strong').textContent + ' morphism active');
        });
      });


      function sensoryToast(message){
        if (!senseToast) return;
        senseToast.textContent = message;
        senseToast.classList.add('show');
        clearTimeout(sensoryToast.timer);
        sensoryToast.timer = setTimeout(function(){
          senseToast.classList.remove('show');
        }, 1800);
      }

      function vibrate(pattern){
        if (!haptics || !navigator.vibrate) return;
        try { navigator.vibrate(pattern); } catch (err) {}
      }


      function renderThemeEffects(){
        const layer = $('#themeFxLayer');
        if (!layer) return;

        const effectThemes = {
          snow: { count: 58, effect: 'snow' },
          rain: { count: 76, effect: 'rain' },
          galaxy: { count: 70, effect: 'galaxy' },
          fireflies: { count: 34, effect: 'fireflies' },
          christmas: { count: 64, effect: 'christmas' },
          blossom: { count: 52, effect: 'blossom' },
          fog: { count: 18, effect: 'fog' },
          desert: { count: 54, effect: 'desert' },
          meteor: { count: 38, effect: 'meteor' },
          autumn: { count: 52, effect: 'autumn' },
          bubbles: { count: 48, effect: 'bubbles' },
          confetti: { count: 72, effect: 'confetti' },
          laser: { count: 18, effect: 'laser' },
          matrix: { count: 78, effect: 'matrix' },
          arcade: { count: 54, effect: 'arcade' },
          valentine: { count: 46, effect: 'valentine' },
          halloween: { count: 46, effect: 'halloween' },
          patriotic: { count: 58, effect: 'patriotic' },
          birthday: { count: 58, effect: 'birthday' },
          summer: { count: 42, effect: 'summer' }
        };

        const config = effectThemes[vibe];
        layer.innerHTML = '';

        if (!config || reducedSensory) {
          layer.removeAttribute('data-effect');
          return;
        }

        layer.dataset.effect = config.effect;
        const holidayColors = ['#dc2626', '#16a34a', '#fbbf24', '#ffffff', '#38bdf8'];
        const effectPalettes = {
          christmas: holidayColors,
          desert: ['#f97316', '#facc15', '#fed7aa', '#c2410c'],
          autumn: ['#ea580c', '#b45309', '#f59e0b', '#92400e'],
          confetti: ['#ec4899', '#8b5cf6', '#facc15', '#22c55e', '#38bdf8'],
          birthday: ['#f472b6', '#a78bfa', '#facc15', '#22c55e', '#38bdf8'],
          patriotic: ['#2563eb', '#ffffff', '#dc2626'],
          laser: ['#00f5ff', '#ff00c8', '#39ff14'],
          arcade: ['#f472b6', '#38bdf8', '#facc15', '#a3e635'],
          valentine: ['#ec4899', '#fb7185', '#fecdd3'],
          halloween: ['#f97316', '#7c3aed', '#facc15'],
          summer: ['#f59e0b', '#38bdf8', '#fde68a'],
          meteor: ['#ffffff', '#3b82f6', '#f97316']
        };

        for (let i = 0; i < config.count; i++) {
          const particle = document.createElement('span');
          particle.className = 'fxParticle';
          const x = Math.round(Math.random() * 100);
          const y = Math.round(Math.random() * 100);
          const size =
            config.effect === 'rain' ? 2 :
            config.effect === 'fog' ? Math.round(220 + Math.random() * 420) :
            config.effect === 'matrix' ? 2 :
            config.effect === 'laser' ? 2 :
            config.effect === 'bubbles' ? Math.round(10 + Math.random() * 26) :
            config.effect === 'valentine' || config.effect === 'halloween' || config.effect === 'summer' || config.effect === 'meteor' ? Math.round(13 + Math.random() * 16) :
            Math.round(3 + Math.random() * (config.effect === 'blossom' ? 14 : 9));
          const duration =
            config.effect === 'rain' ? (0.75 + Math.random() * 0.9) :
            config.effect === 'matrix' ? (1.8 + Math.random() * 2.3) :
            config.effect === 'laser' ? (2.4 + Math.random() * 3.4) :
            config.effect === 'galaxy' ? (2 + Math.random() * 4) :
            config.effect === 'fireflies' ? (5 + Math.random() * 8) :
            config.effect === 'fog' ? (14 + Math.random() * 18) :
            config.effect === 'bubbles' ? (8 + Math.random() * 11) :
            config.effect === 'christmas' ? (1.3 + Math.random() * 3.8) :
            (7 + Math.random() * 10);

          particle.style.setProperty('--x', x + '%');
          particle.style.setProperty('--y', y + '%');
          particle.style.setProperty('--s', size + 'px');
          particle.style.setProperty('--h', Math.round(34 + Math.random() * 70) + 'px');
          particle.style.setProperty('--d', duration.toFixed(2) + 's');
          particle.style.setProperty('--delay', (-Math.random() * duration).toFixed(2) + 's');
          particle.style.setProperty('--o', (0.25 + Math.random() * 0.75).toFixed(2));
          particle.style.setProperty('--drift', Math.round(-90 + Math.random() * 180) + 'px');

          if (effectPalettes[config.effect]) {
            const palette = effectPalettes[config.effect];
            particle.style.setProperty('--c', palette[i % palette.length]);
          }

          layer.appendChild(particle);
        }
      }

      function applyState(){
        document.body.classList.remove('vibe-twilight','vibe-ocean','vibe-fresh','vibe-night','vibe-luxury','vibe-sunset','vibe-ice','vibe-market','vibe-mono','vibe-candy','vibe-aurora','vibe-espresso','vibe-citrus','vibe-lavender','vibe-cyber','vibe-cozy','vibe-mint','vibe-royal','vibe-peach','vibe-storm','vibe-snow','vibe-rain','vibe-galaxy','vibe-fireflies','vibe-christmas','vibe-blossom','vibe-fog','vibe-desert','vibe-meteor','vibe-autumn','vibe-bubbles','vibe-confetti','vibe-laser','vibe-matrix','vibe-arcade','vibe-valentine','vibe-halloween','vibe-patriotic','vibe-birthday','vibe-summer');
        document.body.classList.add('vibe-' + vibe);
        document.body.classList.toggle('v22-haptics-on', haptics);
        document.body.classList.toggle('v22-reduced-sensory', reducedSensory);
        renderThemeEffects();
        applyMorphism();

        $$('.sensoryOption[data-vibe]').forEach(function(btn){
          btn.classList.toggle('active', btn.dataset.vibe === vibe);
        });

        if (hapticsBtn) hapticsBtn.classList.toggle('active', haptics);
        if (calmBtn) calmBtn.classList.toggle('active', reducedSensory);
        if (hapticsBtn) hapticsBtn.textContent = haptics ? 'Haptics on' : 'Haptics off';
        if (calmBtn) calmBtn.textContent = reducedSensory ? 'Motion calm' : 'Calm mode';
      }

      function celebrate(){
        if (!confettiLayer || reducedSensory) {
          sensoryToast('Request moment marked ✨');
          return;
        }

        confettiLayer.innerHTML = '';
        const colors = ['#7c5cff', '#ff4fd8', '#35d7ff', '#49e6a5', '#fff8ef'];
        for (let i = 0; i < 42; i++) {
          const piece = document.createElement('span');
          piece.className = 'v22-confetti';
          piece.style.left = Math.random() * 100 + 'vw';
          piece.style.background = colors[i % colors.length];
          piece.style.setProperty('--x', (Math.random() * 160 - 80) + 'px');
          piece.style.animationDelay = (Math.random() * 160) + 'ms';
          confettiLayer.appendChild(piece);
        }

        document.body.classList.add('v22-celebrate');
        vibrate([18, 40, 28]);
        sensoryToast('Groceries handled energy ✨');

        setTimeout(function(){
          document.body.classList.remove('v22-celebrate');
          confettiLayer.innerHTML = '';
        }, 1700);
      }

      function voiceGreeting(){
        if (!('speechSynthesis' in window)) {
          sensoryToast('Voice is not supported on this browser.');
          return;
        }

        window.speechSynthesis.cancel();
        const name = document.body && document.body.dataset ? document.body.dataset.customerName : '';
        const message = name
          ? 'Welcome back ' + name + '. Your Dropcart Home Hub is ready.'
          : 'Welcome to Dropcart. Grocery unloading made easy.';

        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 0.96;
        utterance.pitch = 1.02;
        utterance.volume = 0.88;
        window.speechSynthesis.speak(utterance);
        vibrate(18);
        sensoryToast('Voice greeting playing');
      }

      openBtn.addEventListener('click', function(){
        dock.classList.toggle('open');
        vibrate(12);
      });

      if (closeBtn) {
        closeBtn.addEventListener('click', function(){
          dock.classList.remove('open');
          vibrate(8);
        });
      }

      $$('.sensoryOption[data-vibe]').forEach(function(btn){
        btn.addEventListener('click', function(){
          vibe = btn.dataset.vibe;
          localStorage.setItem('dropcartVibe', vibe);
          applyState();
          vibrate(14);
          const label = btn.querySelector('strong') ? btn.querySelector('strong').textContent : 'Mood';
          sensoryToast(label + ' mode active');
        });
      });

      if (hapticsBtn) {
        hapticsBtn.addEventListener('click', function(){
          haptics = !haptics;
          localStorage.setItem('dropcartHaptics', haptics ? 'on' : 'off');
          applyState();
          if (haptics && navigator.vibrate) navigator.vibrate([16, 35, 16]);
          sensoryToast(haptics ? 'Haptics enabled' : 'Haptics disabled');
        });
      }

      if (calmBtn) {
        calmBtn.addEventListener('click', function(){
          reducedSensory = !reducedSensory;
          localStorage.setItem('dropcartReducedSensory', reducedSensory ? 'on' : 'off');
          applyState();
          vibrate(10);
          sensoryToast(reducedSensory ? 'Calmer motion enabled' : 'Full sensory mode enabled');
        });
      }

      if (voiceBtn) voiceBtn.addEventListener('click', voiceGreeting);
      if (celebrateBtn) celebrateBtn.addEventListener('click', celebrate);

      $$('.btn,.sensoryOption,.audioSmallBtn,.audioMainButton,.appBottomNav a,.appBottomNav button').forEach(function(el){
        el.addEventListener('click', function(){
          vibrate(8);
        }, { passive: true });
      });

      $$('#requestForm, #estimateForm, .bookingForm').forEach(function(form){
        form.addEventListener('submit', function(){
          vibrate([18, 30, 18]);
          celebrate();
        });
      });

      $$('.requestCard,.todayCard,.hubCard').forEach(function(el, index){
        if (index < 5) el.classList.add('v22-breathe');
      });

      applyState();
    })();


    // v26 employee dashboard search/filter
    (function initOpsFilters(){
      const search = $('#opsSearch');
      const filter = $('#opsStatusFilter');
      const cards = $$('.opsJobCard');
      if (!cards.length || (!search && !filter)) return;

      function applyFilters(){
        const q = (search?.value || '').trim().toLowerCase();
        const status = filter?.value || 'all';

        cards.forEach((card) => {
          const matchesSearch = !q || (card.dataset.search || '').includes(q);
          const matchesStatus = status === 'all' || card.dataset.status === status;
          card.classList.toggle('opsHide', !(matchesSearch && matchesStatus));
        });
      }

      search?.addEventListener('input', applyFilters);
      filter?.addEventListener('change', applyFilters);
    })();


    // v28 HQ dispatch filters, clock, kiosk mode, auto-refresh
    (function initHQDispatchDevice(){
      const search = $('#hqSearch');
      const filter = $('#hqFilter');
      const cards = $$('.hqJob');
      const columns = $$('.hqColumn');
      const clock = $('#hqClock');
      const refreshToggle = $('#hqRefreshToggle');
      const fullscreen = $('#hqFullscreen');
      if (!search && !filter && !clock && !refreshToggle && !fullscreen) return;

      function tickClock(){ if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
      tickClock();
      setInterval(tickClock, 10000);

      function applyHQFilters(){
        const q = (search?.value || '').trim().toLowerCase();
        const status = filter?.value || 'all';
        cards.forEach((card) => {
          const matchesSearch = !q || (card.dataset.search || '').includes(q);
          const matchesStatus = status === 'all' || card.dataset.status === status;
          card.classList.toggle('hqHidden', !(matchesSearch && matchesStatus));
        });
        columns.forEach((column) => column.classList.toggle('hqHidden', status !== 'all' && column.dataset.column !== status));
      }
      search?.addEventListener('input', applyHQFilters);
      filter?.addEventListener('change', applyHQFilters);

      let autoRefresh = localStorage.getItem('dropcartHQAutoRefresh') !== 'off';
      let refreshTimer = null;
      function setRefreshButton(){
        if (!refreshToggle) return;
        refreshToggle.textContent = autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off';
        refreshToggle.classList.toggle('primary', autoRefresh);
        refreshToggle.classList.toggle('ghost', !autoRefresh);
      }
      function scheduleRefresh(){
        clearInterval(refreshTimer);
        if (!autoRefresh) return;
        refreshTimer = setInterval(() => {
          const active = document.activeElement;
          const typing = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
          if (!typing && window.location.pathname === '/hq') window.location.reload();
        }, 45000);
      }
      refreshToggle?.addEventListener('click', () => {
        autoRefresh = !autoRefresh;
        localStorage.setItem('dropcartHQAutoRefresh', autoRefresh ? 'on' : 'off');
        setRefreshButton();
        scheduleRefresh();
      });
      fullscreen?.addEventListener('click', async () => {
        document.body.classList.toggle('hqFullscreenMode');
        if (document.fullscreenElement) {
          await document.exitFullscreen().catch(() => {});
          fullscreen.textContent = 'Kiosk mode';
          return;
        }
        await document.documentElement.requestFullscreen?.().catch(() => {});
        fullscreen.textContent = document.fullscreenElement ? 'Exit kiosk' : 'Kiosk mode';
      });
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
          document.body.classList.remove('hqFullscreenMode');
          if (fullscreen) fullscreen.textContent = 'Kiosk mode';
        }
      });
      setRefreshButton();
      scheduleRefresh();
      applyHQFilters();
    })();


    // v29 expandable theme library
    (function initMoreThemesToggle(){
      const toggle = $('#moreThemesToggle');
      const panel = $('#moreThemesPanel');
      if (!toggle || !panel) return;

      function setOpen(open){
        panel.hidden = !open;
        panel.classList.toggle('show', open);
        toggle.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.innerHTML = open ? '<span>+</span>Less' : '<span>+</span>More';
        localStorage.setItem('dropcartMoreThemesOpen', open ? 'on' : 'off');
      }

      const savedOpen = localStorage.getItem('dropcartMoreThemesOpen') === 'on';
      setOpen(savedOpen);

      toggle.addEventListener('click', function(){
        setOpen(panel.hidden);
      });

      $$('.moreThemesGrid .sensoryOption[data-vibe]').forEach(function(btn){
        btn.addEventListener('click', function(){
          setOpen(false);
        });
      });
    })();

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
    : `<a class="btn ghost" href="/login">Login</a><a class="btn ghost" href="/signup">Sign up</a>`;
  const employeeLink = employee ? `<a class="navLink" href="/employee">Employee</a>` : ``;
  return `<header class="header">
    <div class="container nav">
      <a class="logo" href="/#top" aria-label="${escapeHtml(SERVICE_NAME)} home"><span class="logoIcon" aria-hidden="true"><svg width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="M3 4h2l1.1 5.7M7.4 15h9.9L21 7H6.1" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 20.2h.01M17 20.2h.01" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/></svg></span><span><span class="logoTitle">${escapeHtml(SERVICE_NAME)}</span><span class="logoSub">${escapeHtml(CITY)} grocery unloading</span></span></a>
      <nav class="desktopNav" aria-label="Main navigation"><a class="navLink" href="/#how">How it works</a><a class="navLink" href="/#pricing">Pricing</a><a class="navLink" href="/#estimate">Estimate</a><a class="navLink" href="/#area">Area</a><button class="navLink morphNavButton" type="button" onclick="return window.openMorphStudio?.();">Morph</button>${customerLinks}${employeeLink}<a class="btn primary" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call now</a></nav>
      <button id="menuBtn" class="btn ghost menuBtn" aria-label="Open menu" aria-expanded="false"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/></svg></button>
    </div>
    <div id="mobileMenu" class="mobileMenu container"><div class="mobilePanel glass"><a href="/#how">How it works <span>→</span></a><a href="/#pricing">Pricing <span>→</span></a><a href="/#estimate">Estimate <span>→</span></a><a href="/#area">Service area <span>→</span></a><button class="morphMobileButton" type="button" onclick="return window.openMorphStudio?.();">Morph Studio <span>◇</span></button>${customer ? `<a href="/account">Account <span>→</span></a><form method="post" action="/logout">${csrfField(req)}<button type="submit">Logout <span>→</span></button></form>` : `<a href="/login">Customer login <span>→</span></a><a href="/signup">Create account <span>→</span></a>`}${employee ? `<a href="/employee">Employee <span>→</span></a>` : ``}<div class="mobileActions"><a class="btn ghost" href="/#contact">Book</a><a class="btn primary" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call now</a></div></div></div>
  </header>`;
}
function footer(req) {
  return `<footer class="footer"><div class="container foot"><div><div class="footTitle">${escapeHtml(SERVICE_NAME)}</div><div class="footCopy">© ${new Date().getFullYear()} ${escapeHtml(SERVICE_NAME)}. ${escapeHtml(CITY)}, ${escapeHtml(STATE)}. Grocery unloading made simple.</div></div><div class="footLinks"><a href="/#pricing">Pricing</a><a href="/#area">Area</a><a href="/#contact">Contact</a><a href="/login" class="btn ghost">Login</a><a href="/signup">Sign up</a></div></div></footer>`;
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
  const statusClass = String(b.status || "new").replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const statusOptions = VALID_STATUSES.map((status) => `<option value="${status}" ${status === b.status ? "selected" : ""}>${status}</option>`).join("");
  const notes = String(b.notes || "");
  const tags = [];
  if (b.customerId) tags.push("customer");
  else tags.push("guest");
  if ((b.estimate?.stairs || 0) > 0) tags.push("stairs");
  if ((b.estimate?.heavy || 0) > 0) tags.push("heavy items");
  if ((b.estimate?.urgency || 0) > 0 || /asap|rush|today/i.test(notes + " " + (b.timeWindow || ""))) tags.push("time-sensitive");
  if (/gate|code/i.test(notes)) tags.push("gate/code");
  if (/dog|cat|pet/i.test(notes)) tags.push("pets");
  if (/cold|frozen|fridge|freezer/i.test(notes)) tags.push("cold items");
  if ((b.area?.status || "") === "outside") tags.push("verify area");
  const tagHtml = tags.slice(0, 7).map((tag) => `<span class="opsTag">${escapeHtml(tag)}</span>`).join("");
  const smsConfirm = encodeURIComponent(`Hey, this is ${SERVICE_NAME}. I saw your grocery unload request and wanted to confirm the details.`);
  const smsOnWay = encodeURIComponent(`Hey, this is ${SERVICE_NAME}. I am on the way for your grocery unload.`);
  const searchable = `${b.name || ""} ${b.phone || ""} ${b.email || ""} ${b.address || ""} ${b.zip || ""} ${b.status || ""} ${notes}`.toLowerCase();

  return `<article class="opsJobCard ops-status-${escapeHtml(statusClass)}" data-status="${escapeHtml(b.status || "")}" data-search="${escapeHtml(searchable)}">
    <div class="opsJobInner">
      <div class="opsJobTop">
        <div>
          <span class="badge ${color}">${escapeHtml(b.status)}</span>
          <h3 class="opsJobName">${escapeHtml(b.name)}</h3>
          <p class="opsJobContact">${escapeHtml(b.phone)}${b.email ? " · " + escapeHtml(b.email) : ""}</p>
          <div class="opsTagRow">${tagHtml}</div>
        </div>
        <div class="opsJobId">${escapeHtml(b.id)}<br>${escapeHtml(created)}<br>Updated ${escapeHtml(updated)}</div>
      </div>

      <div class="bookingMeta">
        <div class="metaBox"><span>Address</span><strong>${escapeHtml(b.address)}</strong></div>
        <div class="metaBox"><span>ZIP / Area</span><strong>${escapeHtml(b.zip || "—")} · ${escapeHtml(b.area?.status || "unknown")}</strong></div>
        <div class="metaBox"><span>Preferred</span><strong>${escapeHtml(b.date || "Any day")} · ${escapeHtml(b.timeWindow || "Flexible")}</strong></div>
        <div class="metaBox"><span>Estimate</span><strong>${money(b.estimate?.price)} · ${escapeHtml(String(b.estimate?.minutes || "?"))}m</strong></div>
        <div class="metaBox"><span>Bags</span><strong>${escapeHtml(String(b.estimate?.bags || "—"))}</strong></div>
        <div class="metaBox"><span>Stairs</span><strong>${escapeHtml(String(b.estimate?.stairs || "—"))}</strong></div>
        <div class="metaBox"><span>Heavy</span><strong>${escapeHtml(String(b.estimate?.heavy || "—"))}</strong></div>
        <div class="metaBox"><span>Source</span><strong>${escapeHtml(b.source || "website")}</strong></div>
      </div>

      <div class="opsNotes">${escapeHtml(b.notes || "No notes yet. Confirm cold items, water cases, pantry items, garage items, stairs, and gate codes.")}</div>

      <div class="opsActions">
        <form method="post" action="/employee/bookings/${encodeURIComponent(b.id)}/status">
          ${csrfField(req)}
          <select name="status">${statusOptions}</select>
          <button class="btn primary" type="submit">Update</button>
        </form>
        <a class="btn ghost" href="tel:${escapeHtml(b.phone)}">Call</a>
        <a class="btn ghost" href="sms:${escapeHtml(b.phone)}?body=${smsConfirm}">Confirm text</a>
        <a class="btn ghost" href="sms:${escapeHtml(b.phone)}?body=${smsOnWay}">On my way</a>
        <form method="post" action="/employee/bookings/${encodeURIComponent(b.id)}/delete" onsubmit="return confirm('Delete this booking?')">
          ${csrfField(req)}
          <button class="btn danger" type="submit">Delete</button>
        </form>
      </div>
    </div>
  </article>`;
}

function homePage(req) {
  const customer = currentCustomer(req);
  const analytics = getAnalytics();
  const bookings = readBookings();
  const pending = bookings.filter((b) => ["new", "contacted", "confirmed"].includes(b.status)).length;
  const body = `${header(req)}<main id="top"><section class="container hero"><div class="reveal"><span class="chip"><span class="dot"></span>${escapeHtml(CITY)}, ${escapeHtml(STATE)} · Local grocery unloading</span><h1 class="heroTitle">You got the groceries. <span class="shine">We do the lifting.</span></h1><p class="heroDesc">${escapeHtml(SERVICE_NAME)} unloads your car, carries everything inside, and places groceries in the kitchen, fridge, pantry, garage, or wherever you need them. Create an account to save your requests, track your unloads, and make future grocery trips easier.</p><div class="heroActions"><a href="tel:${escapeHtml(BUSINESS_PHONE)}" class="btn primary">Call ${escapeHtml(DISPLAY_PHONE)}</a><a href="${customer ? "/account" : "/signup"}" class="btn ghost">${customer ? "Open my account" : "Create customer account"}</a><a href="#estimate" class="btn ghost">Get estimate</a></div><p class="heroNote">Book online or call when you are heading home from the store.</p>
        <div class="v20-hero-badge-row">
          <span class="v20-mini-badge">🧊 Cold items first</span>
          <span class="v20-mini-badge">💪 Heavy cases handled</span>
          <span class="v20-mini-badge">🏠 Kitchen · pantry · garage</span>
        </div>
        <div class="v20-hero-art" aria-hidden="true"></div>
        <div class="stats"><div class="stat soft reveal d1"><div class="statNum">$29+</div><div class="statLab">starting price</div></div><div class="stat soft reveal d2"><div class="statNum">${escapeHtml(String(readCustomers().length))}</div><div class="statLab">customer accounts</div></div><div class="stat soft reveal d3"><div class="statNum">${escapeHtml(String(pending))}</div><div class="statLab">active requests</div></div><div class="stat soft reveal d3"><div class="statNum">${escapeHtml(String(analytics.bookings))}</div><div class="statLab">bookings submitted</div></div></div></div><div class="reveal d2"><div class="deviceShell"><div id="heroDevice" class="device glass"><div class="screen"><div class="phoneBar"></div><div class="requestTop"><div><div class="kicker">Unload request</div><div class="requestTitle">Car to kitchen</div></div><div class="available"><span class="dot"></span>Open</div></div><div class="requestCard"><div class="requestRow"><div class="requestIcon">🛒</div><div class="requestInfo"><h3>Quick grocery help</h3><p>Tell us what you have, where it goes, and when you need help.</p></div></div><div class="miniGrid"><div class="mini"><div class="miniLabel">Estimated price</div><div class="miniValue">$<span id="livePrice">29</span></div></div><div class="mini"><div class="miniLabel">Estimated time</div><div class="miniValue"><span id="liveTime">45</span>m</div></div></div></div><div class="taskGrid"><div class="task"><div class="taskEmoji">🚗</div><div class="taskText">Car</div></div><div class="task"><div class="taskEmoji">🥶</div><div class="taskText">Cold items</div></div><div class="task"><div class="taskEmoji">🏠</div><div class="taskText">Home</div></div></div><div class="ready"><div><h4>Need help today?</h4><p>Send a request and we will follow up.</p></div><a class="btn primary" href="${customer ? "/account" : "/login"}">${customer ? "Account" : "Login"}</a></div></div></div></div></div></section>

  <section class="container section v20-cinematic-section">
    <div class="v20-showcase reveal">
      <div class="v20-showcase-grid">
        <article class="v20-big-panel">
          <span class="v20-panel-label">Before Dropcart</span>
          <h2 class="v20-panel-title">The grocery run is done… but the lifting is not.</h2>
          <p class="v20-panel-copy">That last part is always the worst: hot car, melting cold items, water cases, stairs, and way too many bags.</p>
          <ul class="v20-before-list">
            <li><span>✕</span> 10 trips from the car</li>
            <li><span>✕</span> Water cases and heavy bulk items</li>
            <li><span>✕</span> Frozen food sitting out too long</li>
          </ul>
        </article>

        <div class="v20-center-stack">
          <div class="v20-route-card">
            <div class="v20-route-icon">🛒</div>
            <strong>Car → Kitchen</strong>
            <small>simple local grocery unloading</small>
          </div>
          <div class="v20-floating-tile-grid">
            <div class="v20-floating-tile"><b>🥶</b><strong>Cold-first flow</strong><span>Fridge and freezer items can go in first.</span></div>
            <div class="v20-floating-tile"><b>📲</b><strong>Easy request</strong><span>Book online or call when heading home.</span></div>
            <div class="v20-floating-tile"><b>🏡</b><strong>Home profile</strong><span>Save your usual address and notes.</span></div>
            <div class="v20-floating-tile"><b>⚡</b><strong>Fast rebook</strong><span>Use your customer portal next time.</span></div>
          </div>
        </div>

        <article class="v20-big-panel">
          <span class="v20-panel-label">After Dropcart</span>
          <h2 class="v20-panel-title">You walk inside. The groceries follow.</h2>
          <p class="v20-panel-copy">We help move the bags where they belong so the grocery run actually feels finished.</p>
          <ul class="v20-after-list">
            <li><span>✓</span> Groceries brought inside</li>
            <li><span>✓</span> Cold items handled first</li>
            <li><span>✓</span> Pantry, fridge, garage, or kitchen</li>
          </ul>
        </article>
      </div>
    </div>

    <div class="v20-homepage-strip reveal d1">
      <div class="v20-strip-track">
        <div class="v20-strip-item"><b>01</b><span>Shop like normal</span></div>
        <div class="v20-strip-item"><b>02</b><span>Request help before heading home</span></div>
        <div class="v20-strip-item"><b>03</b><span>Confirm the estimate and unload details</span></div>
        <div class="v20-strip-item"><b>04</b><span>Relax while the bags come inside</span></div>
      </div>
    </div>
  </section>

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
        <article id="quick-book" class="hubCard bookingStudio">
          <div class="bookingStudioTop">
            <div>
              <span class="chip">Book from your Home Hub</span>
              <h2 class="hubCardTitle">Request a grocery unload.</h2>
              <p class="hubMuted">Book directly from your customer portal. Use your saved home details or type a different address for this unload.</p>
            </div>
            <div class="bookingPulse">
              <b>2 min</b>
              <span>quick request</span>
            </div>
          </div>
          <form class="personalForm bookingForm" method="post" action="/account/quick-book">${csrfField(req)}
            <div class="field"><label>Address</label><input name="address" value="${escapeHtml(savedAddress)}" placeholder="Where should we unload?" required /></div>
            <div class="field"><label>ZIP</label><input name="zip" value="${escapeHtml(savedZip)}" placeholder="34450" /></div>
            <div class="field"><label>Bags</label><input name="bags" type="number" min="1" max="120" value="12" /></div>
            <div class="field"><label>Stairs</label><select name="stairs"><option value="0">0 flights</option><option value="1">1 flight</option><option value="2">2 flights</option><option value="3">3+ flights</option></select></div>
            <div class="field"><label>Heavy items</label><select name="heavy"><option value="0">None</option><option value="1">A few cases</option><option value="2">Lots of heavy stuff</option><option value="3">Very heavy / bulk</option></select></div>
            <div class="field"><label>Placement</label><select name="placement"><option value="1">Fridge + pantry</option><option value="0">Kitchen only</option><option value="2">Full sorting help</option><option value="3">Full setup / organize</option></select></div>
            <div class="field"><label>Timing</label><select name="urgency"><option value="0">Flexible</option><option value="1">Today</option><option value="2">Rush / ASAP</option></select></div>
            <div class="field"><label>Distance</label><select name="distance"><option value="0">Inside Inverness</option><option value="1">Near edge</option><option value="2">Outside core area</option></select></div>
            <div class="field"><label>Preferred date</label><input name="date" type="date" /></div>
            <div class="field"><label>Time window</label><select name="timeWindow">${["ASAP / flexible", "8:00 AM – 10:00 AM", "10:30 AM – 12:30 PM", "1:00 PM – 3:00 PM", "3:30 PM – 5:30 PM", "6:00 PM – 8:00 PM"].map((window) => `<option ${favoriteWindow === window ? "selected" : ""}>${escapeHtml(window)}</option>`).join("")}</select></div>
            <div class="field full"><label>Unload notes</label><textarea name="notes" placeholder="Gate code, cold items, garage, pantry, pets, stairs, etc.">${escapeHtml(defaultNotes)}</textarea></div>
            <label class="saveDefaultBox full"><input name="saveAsDefault" type="checkbox" ${savedAddress ? "" : "checked"} /> <span>Save these details as my home profile for faster booking next time</span></label>
            <button class="btn primary full" type="submit">Book this unload</button>
          </form>
          <div class="portalTinyGrid">
            <div class="tinyPerk"><b>🧊</b><span>Cold items first</span></div>
            <div class="tinyPerk"><b>🏠</b><span>Saved home friendly</span></div>
            <div class="tinyPerk"><b>📲</b><span>Text updates ready</span></div>
          </div>
        </article>

        <article class="hubCard">
          <span class="chip">Home concierge</span>
          <h2 class="hubCardTitle">Make every unload feel smoother.</h2>
          <div class="portalFeatureGrid">
            <div class="portalFeature"><b>📝</b><strong>House notes</strong><span>Save gate codes, stairs, pets, and where frozen items go.</span></div>
            <div class="portalFeature"><b>⚡</b><strong>One-tap repeat</strong><span>Use the booking form above with your saved address already filled in.</span></div>
            <div class="portalFeature"><b>🎁</b><strong>Pantry Points</strong><span>Earn points from completed unloads and future referrals.</span></div>
            <div class="portalFeature"><b>📦</b><strong>Unload style</strong><span>Track if you usually want kitchen-only, pantry sorting, or full setup.</span></div>
          </div>
        </article>

        <article class="hubCard">
          <span class="chip">Grocery day planner</span>
          <h2 class="hubCardTitle">Your usual grocery rhythm.</h2>
          <div class="comfortStrip">
            <div class="comfort"><span>Favorite window</span><strong>${escapeHtml(favoriteWindow)}</strong></div>
            <div class="comfort"><span>Default ZIP</span><strong>${savedZip ? escapeHtml(savedZip) : "Add one"}</strong></div>
            <div class="comfort"><span>Points</span><strong>${escapeHtml(String(points))}</strong></div>
          </div>
          <p class="hubMuted" style="margin-top:14px">Tip: save your normal unload notes once, then use the booking form above whenever you are leaving the store.</p>
        </article>

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
  const todayIso = new Date().toISOString().slice(0, 10);
  const activeStatuses = ["new", "contacted", "confirmed"];
  const todayBookings = bookings.filter((b) => b.date === todayIso || String(b.createdAt || "").slice(0, 10) === todayIso);
  const activeBookings = bookings.filter((b) => activeStatuses.includes(b.status));
  const completed = bookings.filter((b) => b.status === "completed");
  const estimatedRevenue = bookings.reduce((sum, b) => sum + (Number(b.estimate?.price) || 0), 0);
  const todayRevenue = todayBookings.reduce((sum, b) => sum + (Number(b.estimate?.price) || 0), 0);
  const statusCounts = VALID_STATUSES.reduce((acc, status) => { acc[status] = bookings.filter((b) => b.status === status).length; return acc; }, {});
  const completionRate = bookings.length ? Math.round((completed.length / bookings.length) * 100) : 0;
  const nextJob = activeBookings[0] || bookings[0];
  const cards = bookings.map((b) => employeeBookingCard(req, b)).join("");

  const statusBoard = VALID_STATUSES.map((status) => {
    const items = bookings.filter((b) => b.status === status).slice(0, 3);
    const itemHtml = items.map((b) => `<div class="opsMiniJob"><b>${escapeHtml(b.name)}</b><span>${escapeHtml(b.timeWindow || "Flexible")} · ${money(b.estimate?.price)} · ${escapeHtml(b.zip || "no ZIP")}</span></div>`).join("");
    return `<div class="opsColumn">
      <div class="opsColumnHead"><strong>${escapeHtml(status)}</strong><span class="opsCount">${statusCounts[status] || 0}</span></div>
      ${itemHtml || `<div class="opsEmptyMini">Nothing here.</div>`}
    </div>`;
  }).join("");

  const body = `${header(req)}
  <main class="container employeeOps">
    <div class="opsShell">
      <section class="opsTop">
        <div class="opsIdentity">
          <div class="opsMark">🛒</div>
          <div>
            <span class="opsKicker"><span class="opsLiveDot"></span>Employee Operations HQ</span>
            <h1 class="opsTitle">Clean shift dashboard.</h1>
            <p class="opsSub">Manage grocery unload requests, contact customers, track statuses, and keep the service feeling smooth without the clutter.</p>
          </div>
        </div>
        <div class="opsTopActions">
          <a class="btn primary" href="#jobs">View jobs</a><a class="btn ghost" href="/hq">HQ Device</a>
          <a class="btn ghost" href="/employee/customers">Customers</a>
          <a class="btn ghost" href="/employee/export">Export</a>
          <form method="post" action="/employee/logout">${csrfField(req)}<button class="btn ghost" type="submit">Logout</button></form>
        </div>
      </section>

      <section class="opsStats">
        <div class="opsStat"><div class="opsStatLabel">Total requests</div><div class="opsStatValue">${bookings.length}</div><div class="opsStatNote">All bookings received.</div></div>
        <div class="opsStat"><div class="opsStatLabel">Active</div><div class="opsStatValue">${activeBookings.length}</div><div class="opsStatNote">New, contacted, confirmed.</div></div>
        <div class="opsStat"><div class="opsStatLabel">Today value</div><div class="opsStatValue">${money(todayRevenue)}</div><div class="opsStatNote">${todayBookings.length} touched today.</div></div>
        <div class="opsStat"><div class="opsStatLabel">Completion</div><div class="opsStatValue">${completionRate}%</div><div class="opsStatNote">${completed.length} completed · ${customers.length} customers.</div></div>
      </section>

      <section class="opsMainGrid">
        <aside class="opsPanel">
          <div class="opsPanelHead">
            <div>
              <h2 class="opsPanelTitle">Shift brief</h2>
              <p class="opsPanelText">Keep it simple, clear, and respectful.</p>
            </div>
            <span class="opsMiniPill">${escapeHtml(new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))}</span>
          </div>

          <div class="opsBriefList">
            <div class="opsBriefItem"><div class="opsBriefIcon">🧊</div><div><strong>Ask about cold items</strong><span>Fridge and freezer items should be handled first if requested.</span></div></div>
            <div class="opsBriefItem"><div class="opsBriefIcon">📍</div><div><strong>Confirm location</strong><span>Address, ZIP, stairs, gate code, and where bags should go.</span></div></div>
            <div class="opsBriefItem"><div class="opsBriefIcon">💪</div><div><strong>Watch heavy items</strong><span>Water cases, bulk items, and stairs are the main reason people book.</span></div></div>
          </div>

          <div class="opsFocusCard">
            <strong>${nextJob ? escapeHtml(nextJob.name) : "No active job"}</strong>
            <span>${nextJob ? `${escapeHtml(nextJob.timeWindow || "Flexible")} · ${money(nextJob.estimate?.price)} · ${escapeHtml(nextJob.address || "address pending")}` : "New requests will show up here first."}</span>
          </div>
        </aside>

        <section class="opsPanel">
          <div class="opsPanelHead">
            <div>
              <h2 class="opsPanelTitle">Status board</h2>
              <p class="opsPanelText">A quick glance at where requests are sitting.</p>
            </div>
            <span class="opsMiniPill">${activeBookings.length} active</span>
          </div>
          <div class="opsBoard">${statusBoard}</div>
        </section>
      </section>

      <section id="jobs" class="opsJobsHead">
        <h2>Booking requests</h2>
        <p>Use search and filters to find requests fast. Each card has contact shortcuts, job details, notes, tags, and status controls.</p>
        <div class="opsToolbar">
          <input id="opsSearch" class="opsSearch" type="search" placeholder="Search name, phone, address, ZIP, notes..." />
          <select id="opsStatusFilter" class="opsFilter">
            <option value="all">All statuses</option>
            ${VALID_STATUSES.map((status) => `<option value="${status}">${status}</option>`).join("")}
          </select>
          <span class="opsMiniPill">${money(estimatedRevenue)} total estimated</span>
        </div>
      </section>

      <section id="opsJobsList" class="bookingGrid">${bookings.length ? cards : `<div class="empty glass">No bookings yet.</div>`}</section>
    </div>
  </main>
  ${footer(req)}`;
  return pageShell({ req, title: `${SERVICE_NAME} — Employee Operations HQ`, body });
}


function hqJobCard(req, b) {
  const statusClass = String(b.status || "new").replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const notes = String(b.notes || "");
  const tags = [];
  if (b.customerId) tags.push("customer"); else tags.push("guest");
  if ((b.estimate?.stairs || 0) > 0) tags.push("stairs");
  if ((b.estimate?.heavy || 0) > 0) tags.push("heavy");
  if ((b.estimate?.urgency || 0) > 0 || /asap|rush|today/i.test(notes + " " + (b.timeWindow || ""))) tags.push("rush");
  if (/gate|code/i.test(notes)) tags.push("gate/code");
  if (/dog|cat|pet/i.test(notes)) tags.push("pets");
  if (/cold|frozen|fridge|freezer/i.test(notes)) tags.push("cold");
  if ((b.area?.status || "") === "outside") tags.push("verify area");
  const tagHtml = tags.slice(0, 6).map((tag) => `<span class="hqTag">${escapeHtml(tag)}</span>`).join("");
  const smsConfirm = encodeURIComponent(`Hey, this is ${SERVICE_NAME}. I saw your grocery unload request and wanted to confirm the details.`);
  const smsOnWay = encodeURIComponent(`Hey, this is ${SERVICE_NAME}. I am on the way for your grocery unload.`);
  const searchable = `${b.name || ""} ${b.phone || ""} ${b.email || ""} ${b.address || ""} ${b.zip || ""} ${b.status || ""} ${notes}`.toLowerCase();
  const shortAddress = b.address ? String(b.address).slice(0, 70) : "Address pending";
  const statusButtons = ["contacted", "confirmed", "completed", "cancelled"].map((status) => `
    <form method="post" action="/hq/bookings/${encodeURIComponent(b.id)}/status">
      ${csrfField(req)}
      <input type="hidden" name="status" value="${status}" />
      <button type="submit">${escapeHtml(status)}</button>
    </form>
  `).join("");

  return `<article class="hqJob hq-status-${escapeHtml(statusClass)}" data-status="${escapeHtml(b.status || "")}" data-search="${escapeHtml(searchable)}">
    <div class="hqJobTop"><div><span class="badge ${statusColor(b.status)}">${escapeHtml(b.status)}</span><div class="hqJobName">${escapeHtml(b.name)}</div></div><div class="hqJobMeta">${escapeHtml(b.id)}<br>${money(b.estimate?.price)} · ${escapeHtml(String(b.estimate?.minutes || "?"))}m</div></div>
    <div class="hqJobLine">📍 ${escapeHtml(shortAddress)}${b.zip ? " · " + escapeHtml(b.zip) : ""}</div>
    <div class="hqJobLine">🕒 ${escapeHtml(b.date || "Any day")} · ${escapeHtml(b.timeWindow || "Flexible")}</div>
    <div class="hqJobLine">📞 ${escapeHtml(b.phone)}${b.email ? " · " + escapeHtml(b.email) : ""}</div>
    <div class="hqTagRow">${tagHtml}</div>
    <div class="hqJobNotes">${escapeHtml(b.notes || "No notes. Confirm cold items, stairs, water cases, and placement.")}</div>
    <div class="hqQuickActions"><a class="btn ghost" href="tel:${escapeHtml(b.phone)}">Call</a><a class="btn ghost" href="sms:${escapeHtml(b.phone)}?body=${smsConfirm}">Confirm</a><a class="btn ghost" href="sms:${escapeHtml(b.phone)}?body=${smsOnWay}">On way</a><a class="btn ghost" href="/employee#jobs">Full view</a></div>
    <div class="hqStatusButtons">${statusButtons}</div>
  </article>`;
}

function hqPage(req) {
  const bookings = readBookings().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const customers = readCustomers();
  const todayIso = new Date().toISOString().slice(0, 10);
  const activeStatuses = ["new", "contacted", "confirmed"];
  const hqStatuses = ["new", "contacted", "confirmed", "completed"];
  const activeBookings = bookings.filter((b) => activeStatuses.includes(b.status));
  const todayBookings = bookings.filter((b) => b.date === todayIso || String(b.createdAt || "").slice(0, 10) === todayIso);
  const completedToday = todayBookings.filter((b) => b.status === "completed");
  const nextJob = activeBookings[0] || bookings[0];
  const todayValue = todayBookings.reduce((sum, b) => sum + (Number(b.estimate?.price) || 0), 0);
  const statusCounts = hqStatuses.reduce((acc, status) => { acc[status] = bookings.filter((b) => b.status === status).length; return acc; }, {});

  const columns = hqStatuses.map((status) => {
    const items = bookings.filter((b) => b.status === status).slice(0, status === "completed" ? 8 : 20);
    return `<section class="hqColumn" data-column="${escapeHtml(status)}"><div class="hqColumnHead"><strong>${escapeHtml(status)}</strong><span class="hqCount">${items.length}</span></div>${items.length ? items.map((b) => hqJobCard(req, b)).join("") : `<div class="hqEmpty">No ${escapeHtml(status)} jobs.</div>`}</section>`;
  }).join("");

  const body = `${header(req)}
  <main class="container hqDevicePage"><div class="hqDeviceShell">
    <section class="hqTopbar"><div class="hqBrand"><div class="hqBrandIcon">📱</div><div class="hqBrandText"><strong>HQ Dispatch Device</strong><span>Touch-first operations screen for the shop, office, or headquarters.</span></div></div><div class="hqTopActions"><span class="hqPill"><span class="hqLiveDot"></span>Live queue</span><span class="hqPill" id="hqClock">${escapeHtml(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</span><button class="btn ghost" id="hqFullscreen" type="button">Kiosk mode</button><a class="btn ghost" href="/employee">Employee HQ</a></div></section>
    <section class="hqHero"><div class="hqHeroCard"><span class="hqKicker">HQ station</span><h1 class="hqTitle">One device to <span>run the whole queue.</span></h1><p class="hqSub">Set this on a phone, tablet, or office screen. Employees can see new requests, call/text customers, update statuses, and keep every grocery unload moving.</p><div class="hqActionRow"><a class="btn primary" href="#hqBoard">Open queue</a><a class="btn ghost" href="/employee/customers">Customers</a><a class="btn ghost" href="/employee/export">Export</a></div></div><aside class="hqNextCard"><div class="hqNextTop"><div><div class="hqKicker">Next focus</div><h2 class="hqNextTitle">Front of queue</h2></div><span class="hqPill">${activeBookings.length} active</span></div><div class="hqNextName">${nextJob ? escapeHtml(nextJob.name) : "No active job"}</div><div class="hqNextDetails">${nextJob ? `${escapeHtml(nextJob.timeWindow || "Flexible")} · ${money(nextJob.estimate?.price)}<br>${escapeHtml(nextJob.address || "Address pending")}` : "New requests will appear here when the page refreshes."}</div></aside></section>
    <section class="hqStatGrid"><div class="hqStat"><span>New</span><strong>${statusCounts.new || 0}</strong><small>Needs first contact.</small></div><div class="hqStat"><span>Active</span><strong>${activeBookings.length}</strong><small>New, contacted, confirmed.</small></div><div class="hqStat"><span>Today</span><strong>${todayBookings.length}</strong><small>${money(todayValue)} estimated value.</small></div><div class="hqStat"><span>Complete</span><strong>${completedToday.length}</strong><small>${customers.length} customer accounts.</small></div></section>
    <section class="hqControls"><input id="hqSearch" class="hqSearch" type="search" placeholder="Search customer, phone, address, ZIP, notes..." /><select id="hqFilter" class="hqSelect"><option value="all">All statuses</option>${hqStatuses.map((status) => `<option value="${status}">${status}</option>`).join("")}</select><button id="hqRefreshToggle" class="btn ghost" type="button">Auto-refresh on</button></section>
    <section id="hqBoard" class="hqBoard">${columns}</section>
  </div></main>${footer(req)}`;
  return pageShell({ req, title: `${SERVICE_NAME} — HQ Dispatch Device`, body });
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
  const address = cleanText(req.body.address || customer.defaultAddress, 180);
  const zip = digitsOnly(req.body.zip || customer.defaultZip).slice(0, 5);

  if (!address) return res.status(400).send("Add an address so we know where to unload.");

  const date = cleanText(req.body.date, 40);
  const timeWindow = cleanText(req.body.timeWindow || customer.favoriteWindow, 80);
  const requestNotes = cleanText(req.body.notes, 900);
  const notes = requestNotes || cleanText(customer.deliveryNotes, 900);
  const estimate = calculateEstimate(req.body);
  const area = checkServiceArea({ zip, address });
  const bookings = readBookings();

  if (req.body.saveAsDefault === "on") {
    const customers = readCustomers();
    const savedCustomer = customers.find((c) => c.id === customer.id);
    if (savedCustomer) {
      savedCustomer.defaultAddress = address;
      savedCustomer.defaultZip = zip;
      savedCustomer.favoriteWindow = timeWindow || savedCustomer.favoriteWindow || "ASAP / flexible";
      savedCustomer.deliveryNotes = notes || savedCustomer.deliveryNotes || "";
      savedCustomer.updatedAt = new Date().toISOString();
      saveCustomers(customers);
    }
  }

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
  res.redirect("/account#history");
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


// HQ dispatch device routes
app.get("/hq", requireEmployee, (req, res) => res.send(hqPage(req)));
app.get("/employee/hq", requireEmployee, (req, res) => res.send(hqPage(req)));
app.get("/api/hq/ping", requireEmployee, (req, res) => res.json({ ok: true, route: "hq", time: new Date().toISOString() }));

app.post("/hq/bookings/:id/status", requireEmployee, verifyCsrf, (req, res) => {
  const status = cleanText(req.body.status, 40);
  if (!VALID_STATUSES.includes(status)) return res.status(400).send("Invalid status");
  const bookings = readBookings();
  const booking = bookings.find((item) => item.id === req.params.id);
  if (!booking) return res.status(404).send("Booking not found");
  booking.status = status;
  booking.updatedAt = new Date().toISOString();
  saveBookings(bookings);
  res.redirect("/hq#hqBoard");
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
  console.log(`HQ dispatch device: http://localhost:${PORT}/hq`);
});
