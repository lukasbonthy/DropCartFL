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
mkdirSync(join(runtime, "public"), { recursive: true });

writeFileSync(
  join(runtime, "public", "employee-alert-sw.js"),
  `self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.includes("/employee"));
      if (existing) return existing.focus();
      return clients.openWindow("/employee");
    }),
  );
});\n`,
);

copyFileSync(join(root, "render-overlay", "employee-page.tsx"), join(appDir, "page.tsx"));
copyFileSync(join(root, "render-overlay", "employee-login-page.tsx"), join(loginDir, "page.tsx"));
copyFileSync(join(root, "render-overlay", "employee.css"), join(appDir, "employee.css"));
copyFileSync(join(root, "render-overlay", "employee-routes.mjs"), join(scriptsDir, "employee-routes.mjs"));
copyFileSync(join(root, "render-overlay", "dropcart-notifications.ts"), join(runtime, "lib", "dropcart-notifications.ts"));

const bookingFormPath = join(runtime, "components", "booking-form.tsx");
let bookingForm = readFileSync(bookingFormPath, "utf8");
bookingForm = bookingForm.replace(
  "You can contact me about this unload. I understand my booking needs team confirmation.",
  "You can text or call me about this unload. I understand my booking needs team confirmation.",
);
writeFileSync(bookingFormPath, bookingForm);

const bookingStorePath = join(runtime, "lib", "booking-store.ts");
let bookingStore = readFileSync(bookingStorePath, "utf8");

if (!bookingStore.includes("syncBookingToPostgresAndNotify")) {
  if (!bookingStore.includes('from "./dropcart-notifications"')) {
    bookingStore =
      'import { syncBookingToPostgresAndNotify } from "./dropcart-notifications";\n' +
      bookingStore;
  }

  bookingStore = bookingStore.replace(
    'if(!row)throw new BookingError("You’ve sent several requests recently. Please wait a few minutes before trying again.",429);return receipt(row)',
    'if(!row)throw new BookingError("You’ve sent several requests recently. Please wait a few minutes before trying again.",429);await syncBookingToPostgresAndNotify(data,row.reference,row.status,now);return receipt(row)',
  );
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
}
server = server.replace(/\n?installEmployeeRoutes\(app\);\n?/g, "\n");
const employeeRouteMarkers = [
  'app.post("/api/auth/signup"',
  "app.post('/api/auth/signup'",
  'app.post("/api/auth/login"',
  "app.post('/api/auth/login'",
];
const routeMarker = employeeRouteMarkers.find((candidate) => server.includes(candidate));
if (!routeMarker) throw new Error("Could not find the auth route insertion point in render-express.mjs");
server = server.replace(routeMarker, "installEmployeeRoutes(app);\n\n" + routeMarker);
writeFileSync(serverPath, server);
console.log("Installed Dropcart employee portal.");
