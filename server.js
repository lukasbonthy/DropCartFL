
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

  <div id="sensoryDock" class="sensoryDock">
    <div class="sensoryPanel">
      <div class="sensoryTitle">
        <div>
          <strong>Sensory Mode</strong>
          <span>Haptics, voice, mood lighting, and celebration effects.</span>
        </div>
        <button id="sensoryClose" class="sensoryMiniButton" type="button" aria-label="Close sensory panel">✕</button>
      </div>

      <div class="sensoryGrid">
        <button class="sensoryOption" data-vibe="twilight" type="button"><b>🌌</b><strong>Twilight</strong><span>Purple, blue, premium glow</span></button>
        <button class="sensoryOption" data-vibe="ocean" type="button"><b>🌊</b><strong>Ocean</strong><span>Cool blue and calm energy</span></button>
        <button class="sensoryOption" data-vibe="fresh" type="button"><b>🍃</b><strong>Fresh</strong><span>Green, clean, grocery-day feel</span></button>
        <button class="sensoryOption" data-vibe="night" type="button"><b>🌙</b><strong>Night</strong><span>Darker low-light mode</span></button>
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
      Vibe
    </button>
  </div>

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

      function applyState(){
        document.body.classList.remove('vibe-twilight','vibe-ocean','vibe-fresh','vibe-night');
        document.body.classList.add('vibe-' + vibe);
        document.body.classList.toggle('v22-haptics-on', haptics);
        document.body.classList.toggle('v22-reduced-sensory', reducedSensory);

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
      <nav class="desktopNav" aria-label="Main navigation"><a class="navLink" href="/#how">How it works</a><a class="navLink" href="/#pricing">Pricing</a><a class="navLink" href="/#estimate">Estimate</a><a class="navLink" href="/#area">Area</a>${customerLinks}${employeeLink}<a class="btn primary" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call now</a></nav>
      <button id="menuBtn" class="btn ghost menuBtn" aria-label="Open menu" aria-expanded="false"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/></svg></button>
    </div>
    <div id="mobileMenu" class="mobileMenu container"><div class="mobilePanel glass"><a href="/#how">How it works <span>→</span></a><a href="/#pricing">Pricing <span>→</span></a><a href="/#estimate">Estimate <span>→</span></a><a href="/#area">Service area <span>→</span></a>${customer ? `<a href="/account">Account <span>→</span></a><form method="post" action="/logout">${csrfField(req)}<button type="submit">Logout <span>→</span></button></form>` : `<a href="/login">Customer login <span>→</span></a><a href="/signup">Create account <span>→</span></a>`}${employee ? `<a href="/employee">Employee <span>→</span></a>` : ``}<div class="mobileActions"><a class="btn ghost" href="/#contact">Book</a><a class="btn primary" href="tel:${escapeHtml(BUSINESS_PHONE)}">Call now</a></div></div></div>
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
  const statusOptions = VALID_STATUSES.map((status) => `<option value="${status}" ${status === b.status ? "selected" : ""}>${status}</option>`).join("");
  return `<article class="bookingCard glass"><div class="bookingTop"><div><span class="badge ${color}">${escapeHtml(b.status)}</span><h3 class="display" style="margin-top:12px;font-size:30px;letter-spacing:-.05em">${escapeHtml(b.name)}</h3><p style="color:rgba(255,255,255,.58);line-height:1.6;margin-top:6px">${escapeHtml(b.phone)}${b.email ? " · " + escapeHtml(b.email) : ""}${b.customerId ? " · customer account" : " · guest"}</p></div><div style="text-align:right;color:rgba(255,255,255,.45);font-size:12px;font-weight:800">${escapeHtml(b.id)}<br>${escapeHtml(created)}</div></div><div class="bookingMeta"><div class="metaBox"><span>Address</span><strong>${escapeHtml(b.address)}</strong></div><div class="metaBox"><span>ZIP / Area</span><strong>${escapeHtml(b.zip || "—")} · ${escapeHtml(b.area?.status || "unknown")}</strong></div><div class="metaBox"><span>Preferred</span><strong>${escapeHtml(b.date || "Any day")} · ${escapeHtml(b.timeWindow || "Flexible")}</strong></div><div class="metaBox"><span>Estimate</span><strong>${money(b.estimate?.price)} · ${escapeHtml(String(b.estimate?.minutes || "?"))}m</strong></div><div class="metaBox"><span>Bags</span><strong>${escapeHtml(String(b.estimate?.bags || "—"))}</strong></div><div class="metaBox"><span>Stairs</span><strong>${escapeHtml(String(b.estimate?.stairs || "—"))}</strong></div><div class="metaBox"><span>Heavy</span><strong>${escapeHtml(String(b.estimate?.heavy || "—"))}</strong></div><div class="metaBox"><span>Updated</span><strong>${escapeHtml(updated)}</strong></div></div><p style="margin-top:14px;color:rgba(255,255,255,.6);line-height:1.65">${escapeHtml(b.notes || "No notes.")}</p><div class="adminActions"><form method="post" action="/employee/bookings/${encodeURIComponent(b.id)}/status">${csrfField(req)}<select name="status">${statusOptions}</select><button class="btn primary" type="submit">Update</button></form><form method="post" action="/employee/bookings/${encodeURIComponent(b.id)}/delete" onsubmit="return confirm('Delete this booking?')">${csrfField(req)}<button class="btn danger" type="submit">Delete</button></form><a class="btn ghost" href="tel:${escapeHtml(b.phone)}">Call</a><a class="btn ghost" href="sms:${escapeHtml(b.phone)}?body=${encodeURIComponent("Hey, this is Dropcart. I saw your grocery unload request and wanted to confirm the details.")}">Text</a></div></article>`;
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
