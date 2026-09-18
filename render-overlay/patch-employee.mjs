import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const runtime = join(root, ".runtime");
const appDir = join(runtime, "app", "employee");
const loginDir = join(runtime, "app", "employee", "login");
const scriptsDir = join(runtime, "scripts");
mkdirSync(appDir, { recursive: true });
mkdirSync(loginDir, { recursive: true });
mkdirSync(scriptsDir, { recursive: true });

copyFileSync(join(root, "render-overlay", "employee-page.tsx"), join(appDir, "page.tsx"));
copyFileSync(join(root, "render-overlay", "employee-login-page.tsx"), join(loginDir, "page.tsx"));
copyFileSync(join(root, "render-overlay", "employee.css"), join(appDir, "employee.css"));
copyFileSync(join(root, "render-overlay", "employee-routes.mjs"), join(scriptsDir, "employee-routes.mjs"));

const bookingStorePath = join(runtime, "lib", "booking-store.ts");
let bookingStore = readFileSync(bookingStorePath, "utf8");

if (!bookingStore.includes("syncBookingToPostgres")) {
  const helper = `
async function syncBookingToPostgres(data: BookingData, reference: string, status: string, now: number) {
  if (!process.env.DATABASE_URL) return;
  try {
    const runtimeGlobal = globalThis as typeof globalThis & { __dropcartPgPool?: import("pg").Pool };
    if (!runtimeGlobal.__dropcartPgPool) {
      const { Pool } = await import("pg");
      runtimeGlobal.__dropcartPgPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    }
    const pool = runtimeGlobal.__dropcartPgPool;
    await pool.query(\`CREATE TABLE IF NOT EXISTS dropcart_bookings (
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )\`);
    await pool.query(
      \`INSERT INTO dropcart_bookings
        (id, reference, created_at, arrival_at, eta_minutes, status, customer_name, phone, address, city, state, zip, grocery_load, stairs, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       ON CONFLICT (id) DO UPDATE SET
         reference=EXCLUDED.reference, arrival_at=EXCLUDED.arrival_at, eta_minutes=EXCLUDED.eta_minutes,
         status=EXCLUDED.status, customer_name=EXCLUDED.customer_name, phone=EXCLUDED.phone,
         address=EXCLUDED.address, city=EXCLUDED.city, state=EXCLUDED.state, zip=EXCLUDED.zip,
         grocery_load=EXCLUDED.grocery_load, stairs=EXCLUDED.stairs, notes=EXCLUDED.notes, updated_at=NOW()\`,
      [data.requestId, reference, now, now + data.eta * 60000, data.eta, status, data.name, data.phone, data.address, data.city, "FL", data.zip, data.load, data.stairs, data.notes],
    );
  } catch (error) {
    console.error("[employee] booking mirror failed", error);
  }
}
`;

  bookingStore = bookingStore.replace("export async function saveBooking", helper + "\nexport async function saveBooking");
  bookingStore = bookingStore.replace("if(!row)throw new BookingError(\"You’ve sent several requests recently. Please wait a few minutes before trying again.\",429);return receipt(row)",
    "if(!row)throw new BookingError(\"You’ve sent several requests recently. Please wait a few minutes before trying again.\",429);await syncBookingToPostgres(data,row.reference,row.status,now);return receipt(row)");
  writeFileSync(bookingStorePath, bookingStore);
}


const authPagePath = join(runtime, "components", "auth-page.tsx");
let authPage = readFileSync(authPagePath, "utf8");
if (!authPage.includes("Employee access</strong>")) {
  const employeeLoginSection = `
            {!signup && (
              <a
                href="/employee/login"
                className="mt-3 flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-[#dfe8e1] bg-[#f7faf7] px-4 py-3 no-underline transition hover:-translate-y-px hover:border-[#c9dbcd] hover:bg-[#f2f7f2]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e4f1e6] text-[#155b36]">
                    <ShieldCheck size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-xs font-semibold text-[#203026]">Employee access</strong>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">Sign in to the staff portal</span>
                  </span>
                </span>
                <ArrowRight size={16} className="shrink-0 text-[#698171]" aria-hidden="true" />
              </a>
            )}
`;
  const authSwitchEnd = `            </div>

            <div className="auth-secure-line">`;
  if (!authPage.includes(authSwitchEnd)) throw new Error("Could not find auth mode switch insertion point.");
  authPage = authPage.replace(authSwitchEnd, `            </div>
${employeeLoginSection}
            <div className="auth-secure-line">`);
  writeFileSync(authPagePath, authPage);
}

const serverPath = join(scriptsDir, "render-express.mjs");
let server = readFileSync(serverPath, "utf8");
if (!server.includes("employee-routes.mjs")) {
  server = 'import { installEmployeeRoutes } from "./employee-routes.mjs";\n' + server;
  const marker = "app.listen(";
  if (!server.includes(marker)) throw new Error("render-express.mjs does not contain app.listen()");
  server = server.replace(marker, "installEmployeeRoutes(app);\n\n" + marker);
  writeFileSync(serverPath, server);
}
console.log("Installed Dropcart employee portal.");
