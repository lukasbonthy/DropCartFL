"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  MapPin,
  MessageCircle,
  Navigation,
  KeyRound,
  LocateFixed,
  PackageCheck,
  Phone,
  Power,
  RefreshCw,
  Route,
  Send,
  ShoppingBag,
  Sparkles,
  UserRound,
  WalletCards,
  Zap,
} from "lucide-react";
import "./employee.css";

type Job = {
  id: string;
  reference: string;
  arrivalAt: number;
  etaMinutes: number;
  status: string;
  customerName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  groceryLoad: string;
  stairs: boolean;
  notes: string;
  codeWord: string;
  assignmentStatus: string | null;
  earningsCents: number;
};

type Dashboard = {
  employee: { name: string; email: string };
  stats: { todayCents: number; completedToday: number; available: number; active: number };
  jobs: Job[];
  online: boolean;
};

type NotificationSettings = {
  phone: string;
  smsEnabled: boolean;
  callEnabled: boolean;
  providerConfigured: boolean;
};

type DriverMessage = {
  id: number;
  senderRole: "customer" | "employee";
  senderLabel: string;
  body: string;
  createdAt: number;
};

const money = (cents: number) => "$" + (cents / 100).toFixed(2);
const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);

const statusSteps = [
  { key: "accepted", label: "Claimed" },
  { key: "en_route", label: "On the way" },
  { key: "arrived", label: "Arrived" },
  { key: "completed", label: "Done" },
] as const;

function loadLabel(load: string) {
  if (load === "small") return "1–5 bags";
  if (load === "large") return "16+ bags";
  return "6–15 bags";
}

function directionsUrl(job: Job) {
  const destination = encodeURIComponent(
    [job.address, job.city, job.state, job.zip].filter(Boolean).join(", "),
  );
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving&dir_action=navigate`;
}

export default function EmployeePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState<"jobs" | "today">("jobs");
  const [changingShift, setChangingShift] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    phone: "",
    smsEnabled: true,
    callEnabled: true,
    providerConfigured: false,
  });
  const [notificationBusy, setNotificationBusy] = useState("");
  const [browserAlerts, setBrowserAlerts] = useState(false);
  const seenOpenJobs = useRef<Set<string> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const trackingWatch = useRef<number | null>(null);
  const lastLocationSent = useRef(0);
  const [driverMessages, setDriverMessages] = useState<DriverMessage[]>([]);
  const [driverMessage, setDriverMessage] = useState("");
  const [driverMessageBusy, setDriverMessageBusy] = useState(false);

  async function playUrgentChime() {
    try {
      const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      audioContext.current ||= new AudioCtor();
      if (audioContext.current.state === "suspended") await audioContext.current.resume();
      const context = audioContext.current;
      const now = context.currentTime;
      [0, 0.34, 0.68, 1.08].forEach((offset, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index % 2 === 0 ? 880 : 1175;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.24);
      });
    } catch {
      // The phone-call alert remains the reliable background fallback.
    }
  }

  async function showBrowserAlert(job: Job) {
    if (localStorage.getItem("dropcart-browser-alerts") !== "on") return;
    void playUrgentChime();
    if ("vibrate" in navigator) navigator.vibrate?.([220, 100, 220, 100, 420]);
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const title = "New Dropcart booking";
    const options: NotificationOptions = {
      body: `${job.reference} • ${loadLabel(job.groceryLoad)} • ${job.city}`,
      tag: "dropcart-" + job.id,
      requireInteraction: true,
    };

    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, options);
      } else {
        new Notification(title, options);
      }
    } catch {
      try { new Notification(title, options); } catch { /* mobile browsers may require a service worker */ }
    }
  }

  async function enableBrowserAlerts() {
    setNotificationBusy("browser");
    try {
      if ("serviceWorker" in navigator) {
        await navigator.serviceWorker.register("/employee-alert-sw.js");
      }
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      localStorage.setItem("dropcart-browser-alerts", "on");
      setBrowserAlerts(true);
      await playUrgentChime();
    } finally {
      setNotificationBusy("");
    }
  }

  async function loadNotificationSettings() {
    const response = await fetch("/api/employee/notification-settings", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as Partial<NotificationSettings>;
    if (response.ok) {
      setNotificationSettings({
        phone: String(body.phone || ""),
        smsEnabled: Boolean(body.smsEnabled),
        callEnabled: Boolean(body.callEnabled),
        providerConfigured: Boolean(body.providerConfigured),
      });
    }
  }

  async function saveNotificationSettings() {
    setNotificationBusy("save");
    setError("");
    try {
      const response = await fetch("/api/employee/notification-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationSettings),
      });
      const body = await response.json().catch(() => ({})) as Partial<NotificationSettings> & { error?: string };
      if (!response.ok) throw new Error(body?.error || "We couldn't save alert settings.");
      setNotificationSettings((current) => ({
        ...current,
        phone: String(body.phone || current.phone),
        providerConfigured: Boolean(body.providerConfigured),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't save alert settings.");
    } finally {
      setNotificationBusy("");
    }
  }

  async function testNotificationSettings() {
    setNotificationBusy("test");
    setError("");
    try {
      await saveNotificationSettings();
      const response = await fetch("/api/employee/notification-settings/test", { method: "POST" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body?.error || "We couldn't send the test alert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't send the test alert.");
    } finally {
      setNotificationBusy("");
    }
  }

  async function load() {
    const response = await fetch("/api/employee/dashboard", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as Dashboard & { error?: string };
    if (!response.ok) throw new Error(body?.error || "We couldn't load the employee dashboard.");

    const openJobs = (body.jobs || []).filter((job: Job) => job.assignmentStatus === null);
    const nextIds = new Set<string>(openJobs.map((job: Job) => job.id));
    if (seenOpenJobs.current) {
      const newJobs = openJobs.filter((job: Job) => !seenOpenJobs.current?.has(job.id));
      if (newJobs[0]) void showBrowserAlert(newJobs[0]);
    }
    seenOpenJobs.current = nextIds;
    setData(body);
  }

  useEffect(() => {
    setBrowserAlerts(localStorage.getItem("dropcart-browser-alerts") === "on");
    load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Unable to load dashboard."),
    );
    void loadNotificationSettings();

    const poll = window.setInterval(() => {
      load().catch(() => undefined);
    }, 10000);

    return () => window.clearInterval(poll);
  }, []);

  async function postDriverLocation(jobId: string, position: GeolocationPosition) {
    const now = Date.now();
    if (now - lastLocationSent.current < 4500) return;
    lastLocationSent.current = now;

    const response = await fetch("/api/employee/jobs/" + encodeURIComponent(jobId) + "/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body?.error || "We couldn't update live location.");
    }
  }

  function stopDriverTracking() {
    if (trackingWatch.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(trackingWatch.current);
    }
    trackingWatch.current = null;
    setTrackingEnabled(false);
    setTrackingError("");
  }

  async function startDriverTracking() {
    if (!activeJob) return;
    if (!("geolocation" in navigator)) {
      setTrackingError("This browser doesn't support live location.");
      return;
    }

    setTrackingError("");
    lastLocationSent.current = 0;

    trackingWatch.current = navigator.geolocation.watchPosition(
      (position) => {
        setTrackingEnabled(true);
        void postDriverLocation(activeJob.id, position).catch((caught) => {
          setTrackingError(caught instanceof Error ? caught.message : "Live location could not be updated.");
        });
      },
      (geoError) => {
        setTrackingEnabled(false);
        setTrackingError(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location permission is off. Allow Dropcart to use your location, then try again."
            : "We couldn't get your current location.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 },
    );
  }

  async function loadDriverMessages(jobId: string) {
    const response = await fetch("/api/employee/jobs/" + encodeURIComponent(jobId) + "/messages", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { messages?: DriverMessage[]; error?: string };
    if (!response.ok) throw new Error(body?.error || "We couldn't load customer messages.");
    setDriverMessages(Array.isArray(body.messages) ? body.messages : []);
  }

  async function sendDriverMessage() {
    if (!activeJob || !driverMessage.trim() || driverMessageBusy) return;
    setDriverMessageBusy(true);
    setError("");
    try {
      const response = await fetch("/api/employee/jobs/" + encodeURIComponent(activeJob.id) + "/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: driverMessage.trim() }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body?.error || "We couldn't send that message.");
      setDriverMessage("");
      await loadDriverMessages(activeJob.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't send that message.");
    } finally {
      setDriverMessageBusy(false);
    }
  }

  async function setOnline(online: boolean) {
    setChangingShift(true);
    setError("");
    try {
      const response = await fetch("/api/employee/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ online }),
      });
      const body = await response.json().catch(() => ({})) as { online?: boolean; error?: string };
      if (!response.ok) throw new Error(body?.error || "We couldn't update your shift.");
      setData((current) => current ? { ...current, online: Boolean(body.online) } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't update your shift.");
    } finally {
      setChangingShift(false);
    }
  }

  async function updateJob(
    id: string,
    action: "accept" | "en_route" | "arrived" | "completed",
  ) {
    setBusy(id + ":" + action);
    setError("");
    try {
      const response = await fetch(
        "/api/employee/jobs/" + encodeURIComponent(id) + "/" + action,
        { method: "POST" },
      );
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body?.error || "That update couldn't be saved.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That update couldn't be saved.");
    } finally {
      setBusy("");
    }
  }

  const activeJob = useMemo(
    () => data?.jobs.find((job) =>
      ["accepted", "en_route", "arrived"].includes(job.assignmentStatus || ""),
    ) || null,
    [data],
  );

  useEffect(() => {
    if (!activeJob) {
      setDriverMessages([]);
      if (trackingWatch.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(trackingWatch.current);
        trackingWatch.current = null;
      }
      setTrackingEnabled(false);
      return;
    }

    void loadDriverMessages(activeJob.id).catch(() => undefined);
    const messagePoll = window.setInterval(() => {
      void loadDriverMessages(activeJob.id).catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(messagePoll);
  }, [activeJob?.id]);

  useEffect(() => {
    return () => {
      if (trackingWatch.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(trackingWatch.current);
      }
    };
  }, []);

  const visibleJobs = useMemo(() => {
    if (!data) return [];
    if (tab === "jobs") {
      return data.jobs.filter((job) => job.assignmentStatus !== "completed");
    }
    return data.jobs.filter((job) => job.assignmentStatus === "completed");
  }, [data, tab]);

  if (error && !data) {
    return (
      <main className="employee-page">
        <div className="employee-shell employee-locked">
          <a className="employee-back" href="/"><ArrowLeft size={17} /> Back to Dropcart</a>
          <div className="employee-lock-icon"><PackageCheck size={28} /></div>
          <p className="employee-eyebrow">Employee portal</p>
          <h1>Employee access is required.</h1>
          <p>{error}</p>
          <a className="employee-primary" href="/employee/login">Employee sign in <ArrowUpRight size={17} /></a>
        </div>
      </main>
    );
  }

  const firstName = data?.employee.name?.split(" ")[0] || "there";

  return (
    <main className="employee-page">
      <div className="employee-shell">
        <header className="employee-topbar">
          <a className="employee-brand" href="/" aria-label="Dropcart home">
            <span className="employee-brand-mark"><ShoppingBag size={18} /></span>
            <span>dropcart</span>
          </a>

          <div className="employee-top-actions">
            <button
              className={`employee-icon-button ${browserAlerts ? "alerts-on" : ""}`}
              aria-label={browserAlerts ? "Browser booking alerts enabled" : "Enable browser booking alerts"}
              onClick={enableBrowserAlerts}
              type="button"
            >
              <Bell size={18} />
              <span className="employee-notification-dot" />
            </button>
            <a className="employee-profile" href="/account">
              <span className="employee-avatar">
                {data?.employee.name?.slice(0, 1).toUpperCase() || "D"}
              </span>
              <span className="employee-profile-copy">
                <strong>{data?.employee.name || "Employee"}</strong>
                <small>Employee</small>
              </span>
            </a>
          </div>
        </header>

        <section className="employee-hero">
          <div>
            <div className="employee-eyebrow"><Sparkles size={14} /> Employee workspace</div>
            <h1>Good morning, <span>{firstName}.</span></h1>
            <p>Everything you need for today's unloads, without the clutter.</p>
          </div>

          <button
            type="button"
            className={`employee-shift-toggle ${data?.online ? "online" : ""}`}
            onClick={() => setOnline(!data?.online)}
            disabled={changingShift}
            aria-pressed={Boolean(data?.online)}
          >
            <span className="employee-shift-icon"><Power size={19} /></span>
            <span>
              <strong>{data?.online ? "You're available" : "You're offline"}</strong>
              <small>{changingShift ? "Updating…" : data?.online ? "Ready for new unloads" : "Tap to start your shift"}</small>
            </span>
            <span className="employee-shift-dot" />
          </button>
        </section>

        <section className="employee-stat-grid" aria-label="Today's shift">
          <article className="employee-stat-card employee-stat-highlight">
            <span className="employee-stat-icon"><BriefcaseBusiness size={17} /></span>
            <div><strong>{data?.stats.available || 0}</strong><small>Open jobs</small></div>
          </article>
          <article className="employee-stat-card">
            <span className="employee-stat-icon"><Zap size={17} /></span>
            <div><strong>{data?.stats.active || 0}</strong><small>In progress</small></div>
          </article>
          <article className="employee-stat-card">
            <span className="employee-stat-icon"><Check size={17} /></span>
            <div><strong>{data?.stats.completedToday || 0}</strong><small>Completed</small></div>
          </article>
          <article className="employee-stat-card">
            <span className="employee-stat-icon"><WalletCards size={17} /></span>
            <div><strong>{money(data?.stats.todayCents || 0)}</strong><small>Job value today</small></div>
          </article>
        </section>

        <section className="employee-alert-card" aria-label="Urgent booking alerts">
          <div className="employee-alert-copy">
            <span className="employee-alert-icon"><Bell size={18} /></span>
            <div>
              <strong>Urgent booking alerts</strong>
              <p>Hear a browser chime while this dashboard is open, and let Dropcart ring or text your phone when a new booking arrives.</p>
            </div>
          </div>

          <div className="employee-alert-controls">
            <button
              type="button"
              className={`employee-secondary ${browserAlerts ? "is-on" : ""}`}
              onClick={enableBrowserAlerts}
              disabled={notificationBusy === "browser"}
            >
              <Bell size={16} />
              {browserAlerts ? "Browser sound on" : "Enable browser sound"}
            </button>

            <label className="employee-alert-phone">
              <span>Alert phone</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={notificationSettings.phone}
                onChange={(event) => setNotificationSettings((current) => ({ ...current, phone: event.target.value }))}
                placeholder="(352) 555-0123"
              />
            </label>

            <label className="employee-alert-check">
              <input
                type="checkbox"
                checked={notificationSettings.callEnabled}
                onChange={(event) => setNotificationSettings((current) => ({ ...current, callEnabled: event.target.checked }))}
              />
              <span>Ring my phone</span>
            </label>

            <label className="employee-alert-check">
              <input
                type="checkbox"
                checked={notificationSettings.smsEnabled}
                onChange={(event) => setNotificationSettings((current) => ({ ...current, smsEnabled: event.target.checked }))}
              />
              <span>Text me</span>
            </label>

            <button type="button" className="employee-primary" onClick={saveNotificationSettings} disabled={!!notificationBusy}>
              {notificationBusy === "save" ? "Saving…" : "Save alerts"}
            </button>
            <button type="button" className="employee-secondary" onClick={testNotificationSettings} disabled={!!notificationBusy}>
              {notificationBusy === "test" ? "Sending…" : "Test alert"}
            </button>
          </div>

          {!notificationSettings.providerConfigured && (
            <p className="employee-alert-provider-note">
              Phone ring/text alerts are built in but need the Twilio credentials connected on Render before they can send.
            </p>
          )}
        </section>

        {error && <div className="employee-error" role="alert">{error}</div>}

        {activeJob && (
          <section className="employee-active">
            <div className="employee-section-label">
              <div><span>Active now</span><strong>Your current unload</strong></div>
              <span className="employee-live"><i /> Live</span>
            </div>

            <article className="employee-active-card">
              <div className="employee-active-main">
                <div className="employee-active-heading">
                  <div>
                    <span className="employee-reference">{activeJob.reference}</span>
                    <h2>{activeJob.customerName}</h2>
                  </div>
                  <span className="employee-status-pill">{activeJob.assignmentStatus === "arrived" ? "At home" : activeJob.assignmentStatus === "en_route" ? "En route" : "Claimed"}</span>
                </div>

                <div className="employee-active-address">
                  <span className="employee-round-icon"><MapPin size={18} /></span>
                  <div><strong>{activeJob.address}</strong><small>{activeJob.city}, {activeJob.state} {activeJob.zip}</small></div>
                </div>

                <div className="employee-active-meta">
                  <span><Clock3 size={16} /><strong>{formatTime(activeJob.arrivalAt)}</strong><small>Arrival</small></span>
                  <span><ShoppingBag size={16} /><strong>{loadLabel(activeJob.groceryLoad)}</strong><small>{activeJob.stairs ? "Stairs included" : "No stairs"}</small></span>
                  <span><WalletCards size={16} /><strong>{money(activeJob.earningsCents)}</strong><small>Job value</small></span>
                </div>

                <div className="employee-stepper" aria-label="Job progress">
                  {statusSteps.map((step, index) => {
                    const currentIndex = statusSteps.findIndex((item) => item.key === activeJob.assignmentStatus);
                    const done = index < currentIndex;
                    const current = index === currentIndex;
                    return (
                      <div className={`employee-step ${done ? "done" : ""} ${current ? "current" : ""}`} key={step.key}>
                        <span>{done ? <Check size={12} /> : index + 1}</span>
                        <small>{step.label}</small>
                      </div>
                    );
                  })}
                </div>

                <div className="employee-active-actions">
                  {activeJob.assignmentStatus === "accepted" && (
                    <button className="employee-primary employee-primary-large" disabled={!!busy} onClick={() => updateJob(activeJob.id, "en_route")}>
                      {busy ? "Updating…" : "I'm on my way"} <Navigation size={18} />
                    </button>
                  )}
                  {activeJob.assignmentStatus === "en_route" && (
                    <button className="employee-primary employee-primary-large" disabled={!!busy} onClick={() => updateJob(activeJob.id, "arrived")}>
                      {busy ? "Updating…" : "I've arrived"} <Check size={18} />
                    </button>
                  )}
                  {activeJob.assignmentStatus === "arrived" && (
                    <button className="employee-primary employee-primary-large" disabled={!!busy} onClick={() => updateJob(activeJob.id, "completed")}>
                      {busy ? "Saving…" : "Mark unload complete"} <Check size={18} />
                    </button>
                  )}
                  <a className="employee-secondary employee-secondary-large" href={directionsUrl(activeJob)} target="_blank" rel="noreferrer">
                    <Route size={17} /> Directions <ExternalLink size={13} />
                  </a>
                  <a className="employee-secondary employee-secondary-large" href={"tel:" + activeJob.phone}>
                    <Phone size={17} /> Call
                  </a>
                  <button
                    type="button"
                    className={`employee-secondary employee-secondary-large ${trackingEnabled ? "employee-tracking-on" : ""}`}
                    onClick={trackingEnabled ? stopDriverTracking : startDriverTracking}
                  >
                    <LocateFixed size={17} /> {trackingEnabled ? "Stop live tracking" : "Share live location"}
                  </button>
                </div>

                {trackingError && <div className="employee-tracking-error" role="alert">{trackingError}</div>}

                {activeJob.codeWord && (
                  <div className="employee-safety-code">
                    <span><KeyRound size={18} /></span>
                    <div>
                      <small>Customer safety code</small>
                      <strong>{activeJob.codeWord}</strong>
                      <p>Say this exact code word when the customer asks. Do not send it in chat first.</p>
                    </div>
                  </div>
                )}

                <div className="employee-driver-chat">
                  <div className="employee-driver-chat-head">
                    <div>
                      <small>Direct messages</small>
                      <strong>Chat with {activeJob.customerName.split(" ")[0]}</strong>
                    </div>
                    <MessageCircle size={18} />
                  </div>

                  <div className="employee-driver-messages">
                    {driverMessages.length === 0 ? (
                      <div className="employee-driver-message-empty">No messages yet.</div>
                    ) : (
                      driverMessages.map((item) => (
                        <div key={item.id} className={`employee-driver-message ${item.senderRole === "employee" ? "mine" : "customer"}`}>
                          <div><strong>{item.senderRole === "employee" ? "You" : activeJob.customerName.split(" ")[0]}</strong><time>{formatTime(item.createdAt)}</time></div>
                          <p>{item.body}</p>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="employee-driver-compose">
                    <input
                      value={driverMessage}
                      onChange={(event) => setDriverMessage(event.target.value)}
                      maxLength={1000}
                      placeholder="Message the customer…"
                      aria-label="Message the customer"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void sendDriverMessage();
                        }
                      }}
                    />
                    <button type="button" onClick={() => void sendDriverMessage()} disabled={!driverMessage.trim() || driverMessageBusy}>
                      <Send size={16} /> {driverMessageBusy ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </section>
        )}

        <section className="employee-work" id="jobs">
          <div className="employee-section-heading">
            <div>
              <p className="employee-eyebrow">Your queue</p>
              <h2>{tab === "jobs" ? "Available unloads" : "Completed today"}</h2>
            </div>
            <button className="employee-refresh" onClick={() => load()} aria-label="Refresh jobs">
              <RefreshCw size={17} />
            </button>
          </div>

          <div className="employee-tabs" role="tablist">
            <button className={tab === "jobs" ? "active" : ""} onClick={() => setTab("jobs")} role="tab" aria-selected={tab === "jobs"}>
              Open <span>{data?.stats.available || 0}</span>
            </button>
            <button className={tab === "today" ? "active" : ""} onClick={() => setTab("today")} role="tab" aria-selected={tab === "today"}>
              Completed <span>{data?.stats.completedToday || 0}</span>
            </button>
          </div>

          {visibleJobs.length === 0 ? (
            <div className="employee-empty">
              <div className="employee-empty-art"><Check size={23} /></div>
              <h3>{tab === "jobs" ? "No new unloads right now." : "Nothing completed yet."}</h3>
              <p>{tab === "jobs" ? "Stay available and new requests will appear here as they're ready to claim." : "Completed unloads will collect here throughout your shift."}</p>
              {tab === "jobs" && !data?.online && (
                <button className="employee-primary employee-empty-button" onClick={() => setOnline(true)}>
                  <Power size={17} /> Go available
                </button>
              )}
            </div>
          ) : (
            <div className="employee-job-list">
              {visibleJobs.map((job) => {
                const isAvailable = job.assignmentStatus === null;
                return (
                  <article className={`employee-job-card ${job.assignmentStatus || "available"}`} key={job.id}>
                    <div className="employee-job-top">
                      <div>
                        <div className="employee-job-kicker">
                          <span className="employee-reference">{job.reference}</span>
                          {isAvailable && <span className="employee-new-badge"><i /> New</span>}
                        </div>
                        <h3>{job.customerName}</h3>
                      </div>
                      <strong className="employee-job-value">{money(job.earningsCents)}</strong>
                    </div>

                    <div className="employee-job-grid">
                      <div><span className="employee-mini-icon"><Clock3 size={15} /></span><span><strong>{formatTime(job.arrivalAt)}</strong><small>{job.etaMinutes} min away</small></span></div>
                      <div><span className="employee-mini-icon"><MapPin size={15} /></span><span><strong>{job.address}</strong><small>{job.city}, {job.state} {job.zip}</small></span></div>
                      <div><span className="employee-mini-icon"><ShoppingBag size={15} /></span><span><strong>{loadLabel(job.groceryLoad)}</strong><small>{job.stairs ? "Stairs included" : "No stairs"}</small></span></div>
                    </div>

                    {job.notes && (
                      <div className="employee-notes"><strong>Customer note</strong><p>{job.notes}</p></div>
                    )}

                    <div className="employee-job-actions">
                      {isAvailable && (
                        <button className="employee-primary" disabled={!!busy || !data?.online} onClick={() => updateJob(job.id, "accept")}>
                          {!data?.online ? "Go available to claim" : busy === job.id + ":accept" ? "Claiming…" : "Claim unload"} <ChevronRight size={17} />
                        </button>
                      )}
                      {job.assignmentStatus === "completed" && (
                        <span className="employee-complete"><Check size={16} /> Completed</span>
                      )}
                      {job.assignmentStatus !== "completed" && (
                        <a className="employee-secondary" href={directionsUrl(job)} target="_blank" rel="noreferrer">
                          <Navigation size={16} /> Directions
                        </a>
                      )}
                      <a className="employee-secondary" href={"tel:" + job.phone}><Phone size={16} /> Call</a>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="employee-bottom-summary" id="earnings">
          <div><span className="employee-eyebrow">Shift recap</span><h2>Keep it moving.</h2><p>{data?.stats.completedToday || 0} unload{data?.stats.completedToday === 1 ? "" : "s"} completed today.</p></div>
          <div className="employee-recap-number"><strong>{money(data?.stats.todayCents || 0)}</strong><span>total job value</span></div>
        </section>
      </div>

      <nav className="employee-mobile-nav" aria-label="Employee navigation">
        <a className="active" href="#top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><BriefcaseBusiness size={19} /><span>Home</span></a>
        <a href="#jobs"><CalendarDays size={19} /><span>Jobs</span></a>
        <button onClick={() => setOnline(!data?.online)}><Power size={19} /><span>Shift</span></button>
        <a href="/account"><UserRound size={19} /><span>Account</span></a>
      </nav>
    </main>
  );
}
