import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const runtime = join(root, ".runtime");
const appDir = join(runtime, "app", "employee");
const loginDir = join(runtime, "app", "employee", "login");
const trackDir = join(runtime, "app", "track");
const scriptsDir = join(runtime, "scripts");
mkdirSync(appDir, { recursive: true });
mkdirSync(loginDir, { recursive: true });
mkdirSync(trackDir, { recursive: true });
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
copyFileSync(join(root, "render-overlay", "customer-track-page.tsx"), join(trackDir, "page.tsx"));
copyFileSync(join(root, "render-overlay", "customer-track.css"), join(trackDir, "tracking.css"));

const bookingDataPath = join(runtime, "lib", "booking-data.ts");
let bookingData = readFileSync(bookingDataPath, "utf8");
if (!bookingData.includes("codeWord:z.")) {
  bookingData = bookingData.replace(
    'notes:z.string().trim().max(1000,"Please keep notes under 1,000 characters."),',
    'notes:z.string().trim().max(1000,"Please keep notes under 1,000 characters."),\n codeWord:z.string().trim().max(40,"Keep the code word under 40 characters.").default(""),',
  );
  bookingData = bookingData.replace(
    'export const detailsSchema=bookingSchema.pick({name:true,phone:true,load:true,stairs:true,notes:true});',
    'export const detailsSchema=bookingSchema.pick({name:true,phone:true,load:true,stairs:true,notes:true,codeWord:true});',
  );
}
if (!bookingData.includes("accessToken:z.string().uuid()")) {
  bookingData = bookingData.replace(
    'export const receiptSchema=z.object({reference:z.string().regex(/^DC-[A-F0-9]{10}$/),status:z.string(),arrivalAt:z.number()});',
    'export const receiptSchema=z.object({reference:z.string().regex(/^DC-[A-F0-9]{10}$/),status:z.string(),arrivalAt:z.number(),accessToken:z.string().uuid()});',
  );
}
writeFileSync(bookingDataPath, bookingData);

const bookingFormPath = join(runtime, "components", "booking-form.tsx");
let bookingForm = readFileSync(bookingFormPath, "utf8");

bookingForm = bookingForm.replace(
  "You can contact me about this unload. I understand my booking needs team confirmation.",
  "You can text or call me about this unload. I understand my booking needs team confirmation.",
);

if (!bookingForm.includes("codeWord:string")) {
  bookingForm = bookingForm.replace(
    'type Draft = { address:string; city:string; zip:string; eta:number; load:GroceryLoad; name:string; phone:string; stairs:boolean; notes:string; consent:boolean; website:string };',
    'type Draft = { address:string; city:string; zip:string; eta:number; load:GroceryLoad; name:string; phone:string; stairs:boolean; notes:string; codeWord:string; consent:boolean; website:string };',
  );
  bookingForm = bookingForm.replace(
    'const initial:Draft={address:"",city:"Inverness",zip:"",eta:30,load:"medium",name:"",phone:"",stairs:false,notes:"",consent:false,website:""};',
    'const initial:Draft={address:"",city:"Inverness",zip:"",eta:30,load:"medium",name:"",phone:"",stairs:false,notes:"",codeWord:"",consent:false,website:""};',
  );
  bookingForm = bookingForm.replace(
    'type Receipt={reference:string; status:string; arrivalAt:number};',
    'type Receipt={reference:string; status:string; arrivalAt:number; accessToken:string};',
  );

  const notesBlock = '<div><label className="form-label" htmlFor="notes">Anything we should know? <span className="font-normal text-muted-foreground">(optional)</span></label><textarea id="notes" name="notes" value={draft.notes} onChange={e=>field("notes",e.target.value)} maxLength={1000} placeholder="Water cases, parking, where to put your bags…" rows={2} className="form-textarea w-full resize-y rounded-xl border border-input bg-[#f9fbf8] px-4 py-3 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"/>{errorFor("notes")}</div>';
  const codeBlock = '<div><label className="form-label" htmlFor="codeWord">Safety code word <span className="font-normal text-muted-foreground">(optional)</span></label><Input {...inputProps("codeWord")} placeholder="Example: Pineapple" maxLength={40}/><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Only you and the assigned Dropcart driver will see this. Ask the driver to say it before you let them in.</p>{errorFor("codeWord")}</div>';
  if (bookingForm.includes(notesBlock)) bookingForm = bookingForm.replace(notesBlock, notesBlock + codeBlock);

  bookingForm = bookingForm.replace(
    '{draft.notes&&<div><dt className="mb-1 text-muted-foreground">Notes</dt><dd className="break-words">{draft.notes}</dd></div>}',
    '{draft.notes&&<div><dt className="mb-1 text-muted-foreground">Notes</dt><dd className="break-words">{draft.notes}</dd></div>}{draft.codeWord&&<div><dt className="mb-1 text-muted-foreground">Safety code word</dt><dd className="break-words font-semibold">{draft.codeWord}</dd></div>}',
  );
}

if (!bookingForm.includes('localStorage.setItem("dropcart-access-"')) {
  bookingForm = bookingForm.replace(
    'setReceipt(confirmed.data);requestAnimationFrame(()=>document.getElementById("confirmation-title")?.focus());',
    'localStorage.setItem("dropcart-access-"+confirmed.data.reference,confirmed.data.accessToken);setReceipt(confirmed.data);requestAnimationFrame(()=>document.getElementById("confirmation-title")?.focus());',
  );
}

if (!bookingForm.includes('/track?ref=')) {
  const receiptNote = '<p className="text-sm leading-relaxed text-muted-foreground">Keep this reference for your records. No payment has been taken and no helper has been dispatched.</p>';
  const trackingLink = '<div className="mt-5 flex flex-col gap-2 sm:flex-row"><a className="submit-button inline-flex min-h-12 items-center justify-center rounded-xl px-5 no-underline" href={"/track?ref="+encodeURIComponent(receipt.reference)}>Track driver & message <ArrowRight className="ml-2"/></a></div>';
  if (bookingForm.includes(receiptNote)) bookingForm = bookingForm.replace(receiptNote, receiptNote + trackingLink);
}
writeFileSync(bookingFormPath, bookingForm);

const bookingStorePath = join(runtime, "lib", "booking-store.ts");
let bookingStore = readFileSync(bookingStorePath, "utf8");

if (!bookingStore.includes("accessToken:data.requestId")) {
  bookingStore = bookingStore.replace(
    'return{reference:row.reference,status:row.status,arrivalAt:row.arrival_at}',
    'return{reference:row.reference,status:row.status,arrivalAt:row.arrival_at,accessToken:data.requestId}',
  );
}

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
}
writeFileSync(bookingStorePath, bookingStore);

const authPagePath = join(runtime, "components", "auth-page.tsx");
let authPage = readFileSync(authPagePath, "utf8");
if (!authPage.includes('href="/employee/login"')) {
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
console.log("Installed Dropcart employee portal, customer tracking, chat, and verification.");
