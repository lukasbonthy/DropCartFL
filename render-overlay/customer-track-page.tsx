"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  KeyRound,
  MapPin,
  MessageCircle,
  Navigation,
  RefreshCw,
  Send,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import "./tracking.css";

type Message = {
  id: number;
  senderRole: "customer" | "employee";
  senderLabel: string;
  body: string;
  createdAt: number;
};

type TrackingPayload = {
  booking: {
    id: string;
    reference: string;
    status: string;
    assignmentStatus: string | null;
    arrivalAt: number;
    etaMinutes: number;
    customerName: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    codeWord: string;
    assigned: boolean;
  };
  driverLocation: null | {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    heading: number | null;
    speed: number | null;
    updatedAt: number | null;
  };
  messages: Message[];
};

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function statusCopy(status: string | null, assigned: boolean) {
  if (status === "completed") return "Unload complete";
  if (status === "arrived") return "Your driver has arrived";
  if (status === "en_route") return "Your driver is on the way";
  if (status === "accepted" || assigned) return "Driver assigned";
  return "Waiting for a driver";
}

function mapUrl(latitude: number, longitude: number) {
  const lonSpan = 0.012;
  const latSpan = 0.009;
  const left = longitude - lonSpan;
  const right = longitude + lonSpan;
  const top = latitude + latSpan;
  const bottom = latitude - latSpan;
  return (
    "https://www.openstreetmap.org/export/embed.html?bbox=" +
    encodeURIComponent([left, bottom, right, top].join(",")) +
    "&layer=mapnik&marker=" +
    encodeURIComponent(latitude + "," + longitude)
  );
}

export default function TrackBookingPage() {
  const [reference, setReference] = useState("");
  const [token, setToken] = useState("");
  const [data, setData] = useState<TrackingPayload | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const messageEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = String(params.get("ref") || "").trim().toUpperCase();
    setReference(ref);
    if (ref) setToken(localStorage.getItem("dropcart-access-" + ref) || "");
  }, []);

  async function load(showSpinner = false) {
    if (!reference || !token) return;
    if (showSpinner) setRefreshing(true);

    try {
      const response = await fetch(
        "/api/customer/bookings/" +
          encodeURIComponent(reference) +
          "?token=" +
          encodeURIComponent(token),
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "We couldn't load your booking.");
      setData(body);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't load your booking.");
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!reference || !token) return;
    void load(true);
    const poll = window.setInterval(() => void load(false), 5000);
    return () => window.clearInterval(poll);
  }, [reference, token]);

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: "nearest" });
  }, [data?.messages.length]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const body = message.trim();
    if (!body || !reference || !token || sending) return;

    setSending(true);
    setError("");
    try {
      const response = await fetch(
        "/api/customer/bookings/" + encodeURIComponent(reference) + "/messages",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, body }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "We couldn't send your message.");
      setMessage("");
      await load(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't send your message.");
    } finally {
      setSending(false);
    }
  }

  const driverLocation = data?.driverLocation || null;
  const locationAge = driverLocation?.updatedAt ? Date.now() - driverLocation.updatedAt : Infinity;
  const locationFresh = locationAge < 60000;
  const embeddedMap = useMemo(
    () =>
      driverLocation
        ? mapUrl(driverLocation.latitude, driverLocation.longitude)
        : "",
    [driverLocation?.latitude, driverLocation?.longitude],
  );

  if (!reference) {
    return (
      <main className="track-page">
        <section className="track-shell track-state-card">
          <a href="/" className="track-back"><ArrowLeft size={16} /> Back to Dropcart</a>
          <div className="track-state-icon"><MapPin size={24} /></div>
          <h1>Open your secure tracking link.</h1>
          <p>Your tracking page is created after you send an unload request.</p>
        </section>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="track-page">
        <section className="track-shell track-state-card">
          <a href="/" className="track-back"><ArrowLeft size={16} /> Back to Dropcart</a>
          <div className="track-state-icon"><ShieldCheck size={24} /></div>
          <h1>This booking is protected.</h1>
          <p>
            Open tracking from the same browser where you booked. Dropcart keeps a private access key on that device so strangers cannot track your driver or read your messages.
          </p>
          <strong className="track-reference">{reference}</strong>
        </section>
      </main>
    );
  }

  return (
    <main className="track-page">
      <div className="track-shell">
        <header className="track-topbar">
          <a href="/" className="track-brand">
            <span><ShoppingBag size={17} /></span>
            <strong>dropcart</strong>
          </a>
          <button type="button" className="track-refresh" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            Refresh
          </button>
        </header>

        {error && <div className="track-error" role="alert">{error}</div>}

        {!data ? (
          <section className="track-state-card">
            <div className="track-state-icon"><Clock3 size={24} /></div>
            <h1>Loading your unload…</h1>
            <p>Connecting to your private tracking page.</p>
          </section>
        ) : (
          <>
            <section className="track-hero">
              <div>
                <p className="track-eyebrow">{data.booking.reference}</p>
                <h1>{statusCopy(data.booking.assignmentStatus, data.booking.assigned)}</h1>
                <p>
                  {data.booking.address}, {data.booking.city}, {data.booking.state} {data.booking.zip}
                </p>
              </div>
              <span className={"track-status " + (data.booking.assignmentStatus || "pending")}>
                <i />
                {data.booking.assignmentStatus === "completed" ? "Complete" : data.booking.assigned ? "Live booking" : "Pending"}
              </span>
            </section>

            <section className="track-grid">
              <article className="track-map-card">
                <div className="track-section-heading">
                  <div>
                    <p className="track-eyebrow">Driver tracking</p>
                    <h2>{driverLocation ? "Live driver location" : "Location will appear here"}</h2>
                  </div>
                  {driverLocation && (
                    <span className={locationFresh ? "track-live" : "track-stale"}>
                      <i /> {locationFresh ? "Live" : "Last known"}
                    </span>
                  )}
                </div>

                {driverLocation ? (
                  <>
                    <div className="track-map-frame">
                      <iframe
                        title="Dropcart driver live location"
                        src={embeddedMap}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                      <div className="track-map-badge">
                        <Navigation size={15} />
                        <span>
                          Updated {driverLocation.updatedAt ? timeLabel(driverLocation.updatedAt) : "recently"}
                          {driverLocation.accuracy ? " · ±" + Math.round(driverLocation.accuracy) + " m" : ""}
                        </span>
                      </div>
                    </div>
                    <p className="track-map-note">
                      Your driver controls when live location sharing is on. Location sharing ends when the unload is completed.
                    </p>
                  </>
                ) : (
                  <div className="track-map-empty">
                    <MapPin size={26} />
                    <strong>
                      {data.booking.assigned ? "Your driver hasn't started location sharing yet." : "A driver hasn't been assigned yet."}
                    </strong>
                    <p>Once they start their route and enable tracking, their position will update here automatically.</p>
                  </div>
                )}
              </article>

              <aside className="track-side">
                <article className="track-info-card">
                  <div className="track-info-icon"><Clock3 size={17} /></div>
                  <div>
                    <span>Requested arrival</span>
                    <strong>{timeLabel(data.booking.arrivalAt)}</strong>
                  </div>
                </article>

                <article className="track-safety-card">
                  <div className="track-safety-title">
                    <span><KeyRound size={17} /></span>
                    <div>
                      <p className="track-eyebrow">Driver verification</p>
                      <h2>Safety code word</h2>
                    </div>
                  </div>

                  {data.booking.codeWord ? (
                    <>
                      <div className="track-code-word">{data.booking.codeWord}</div>
                      <p>
                        Before opening the door, ask the Dropcart driver to tell you this word. The assigned driver sees it only after claiming your unload.
                      </p>
                    </>
                  ) : (
                    <p>You did not add a code word to this booking.</p>
                  )}
                </article>
              </aside>
            </section>

            <section className="track-chat-card">
              <div className="track-section-heading">
                <div>
                  <p className="track-eyebrow">Direct messages</p>
                  <h2>Message your driver</h2>
                </div>
                <MessageCircle size={20} />
              </div>

              <div className="track-messages" aria-live="polite">
                {data.messages.length === 0 ? (
                  <div className="track-message-empty">
                    <MessageCircle size={22} />
                    <strong>No messages yet.</strong>
                    <p>Use this chat for parking notes, gate instructions, or quick updates.</p>
                  </div>
                ) : (
                  data.messages.map((item) => (
                    <div
                      key={item.id}
                      className={"track-message " + (item.senderRole === "customer" ? "mine" : "driver")}
                    >
                      <div>
                        <strong>{item.senderRole === "customer" ? "You" : "Your driver"}</strong>
                        <time>{timeLabel(item.createdAt)}</time>
                      </div>
                      <p>{item.body}</p>
                    </div>
                  ))
                )}
                <div ref={messageEnd} />
              </div>

              <form className="track-compose" onSubmit={sendMessage}>
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={data.booking.assigned ? "Message your driver…" : "Leave a message for the driver who claims this…"}
                  maxLength={1000}
                  aria-label="Message your Dropcart driver"
                />
                <button type="submit" disabled={!message.trim() || sending}>
                  <Send size={17} />
                  {sending ? "Sending…" : "Send"}
                </button>
              </form>

              <div className="track-security-note">
                <CheckCircle2 size={15} />
                <span>Messages and tracking are tied to this secure booking access key.</span>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
