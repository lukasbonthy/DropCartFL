/*
  Dropcart Node.js + Express App
  --------------------------------
  How to run:

  1. Create a new folder called dropcart
  2. Put this file inside as server.js
  3. Open terminal in that folder
  4. Run:
       npm init -y
       npm install express
       node server.js
  5. Open:
       http://localhost:3000

  Optional:
  - Admin bookings page:
       http://localhost:3000/admin?pin=1234
  - Change ADMIN_PIN below before launching.
*/

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const BUSINESS_PHONE = process.env.BUSINESS_PHONE || "+13525551234";
const DISPLAY_PHONE = process.env.DISPLAY_PHONE || "(352) 555-1234";
const BUSINESS_EMAIL = process.env.BUSINESS_EMAIL || "hello@dropcart.example";
const DATA_DIR = path.join(__dirname, "data");
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(BOOKINGS_FILE)) fs.writeFileSync(BOOKINGS_FILE, "[]", "utf8");
}

function readBookings() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(BOOKINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveBookings(bookings) {
  ensureDataFile();
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), "utf8");
}

function cleanText(value, max = 500) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function calculateEstimate(input = {}) {
  const bags = Math.max(1, Math.min(80, Number(input.bags) || 1));
  const stairs = Math.max(0, Math.min(4, Number(input.stairs) || 0));
  const heavy = Math.max(0, Math.min(3, Number(input.heavy) || 0));
  const placement = Math.max(0, Math.min(3, Number(input.placement) || 0));

  let price = 29;
  let minutes = 30;

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

  price = Math.min(115, price);
  minutes = Math.min(110, minutes);

  return {
    bags,
    stairs,
    heavy,
    placement,
    price,
    minutes,
    label: `$${price} · about ${minutes} minutes`,
  };
}

function layout({ title = "Dropcart", body = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="Dropcart is a local Inverness, FL grocery unloading service. Call, book, and we unload your groceries from car to kitchen." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg:#070a12;
      --bg2:#0b1020;
      --panel:rgba(255,255,255,.075);
      --panel2:rgba(255,255,255,.115);
      --border:rgba(255,255,255,.13);
      --border2:rgba(255,255,255,.22);
      --text:#f8fafc;
      --muted:rgba(248,250,252,.66);
      --muted2:rgba(248,250,252,.45);
      --purple:#7c5cff;
      --pink:#ff4fd8;
      --cyan:#35d7ff;
      --green:#49e6a5;
      --amber:#ffd166;
      --red:#ff6b6b;
      --shadow:0 28px 90px rgba(0,0,0,.42);
      --glow:0 22px 75px rgba(124,92,255,.34);
      --safe-bottom:env(safe-area-inset-bottom,0px);
    }
    *{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
    body{
      min-height:100vh;
      font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      color:var(--text);
      background:
        radial-gradient(950px circle at 10% -10%,rgba(124,92,255,.38),transparent 45%),
        radial-gradient(850px circle at 96% 8%,rgba(255,79,216,.24),transparent 42%),
        radial-gradient(700px circle at 50% 106%,rgba(53,215,255,.17),transparent 50%),
        linear-gradient(180deg,var(--bg) 0%,var(--bg2) 45%,var(--bg) 100%);
      overflow-x:hidden;
    }
    body:before{
      content:"";position:fixed;inset:0;z-index:-4;pointer-events:none;
      background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
      background-size:70px 70px;
      mask-image:radial-gradient(circle at 50% 0%,black,transparent 72%);
    }
    body:after{
      content:"";position:fixed;inset:0;z-index:999;opacity:.075;pointer-events:none;mix-blend-mode:overlay;
      background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='.7'/%3E%3C/svg%3E");
    }
    a{color:inherit;text-decoration:none}
    button,input,textarea,select{font:inherit}
    button{cursor:pointer}
    .container{width:min(1240px,calc(100% - 32px));margin-inline:auto}
    .font-display{font-family:"Space Grotesk",Inter,system-ui,sans-serif}
    .orb{position:fixed;z-index:-3;pointer-events:none;border-radius:999px;filter:blur(54px);opacity:.28;animation:orbFloat 18s ease-in-out infinite}
    .orb.one{top:-120px;left:-140px;width:430px;height:430px;background:var(--purple)}
    .orb.two{top:22%;right:-160px;width:450px;height:450px;background:var(--pink);animation-delay:-7s}
    .orb.three{bottom:-170px;left:32%;width:380px;height:380px;background:var(--cyan);animation-delay:-11s}
    @keyframes orbFloat{0%,100%{transform:translate3d(0,0,0) scale(1)}33%{transform:translate3d(38px,-24px,0) scale(1.07)}66%{transform:translate3d(-28px,30px,0) scale(.96)}}
    .progress{position:fixed;top:0;left:0;z-index:1500;height:4px;width:100%;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,var(--purple),var(--pink),var(--cyan));box-shadow:0 0 24px rgba(255,79,216,.62)}
    .glass{background:linear-gradient(180deg,rgba(255,255,255,.095),rgba(255,255,255,.04));border:1px solid var(--border);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),var(--shadow);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}
    .soft{background:rgba(255,255,255,.058);border:1px solid rgba(255,255,255,.105);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
    .chip{display:inline-flex;align-items:center;gap:9px;min-height:32px;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.76);font-size:12px;font-weight:850;letter-spacing:-.01em;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 16px 45px rgba(0,0,0,.22)}
    .dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 22px rgba(73,230,165,.82)}
    .btn{position:relative;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:13px 20px;border:0;border-radius:18px;font-weight:900;font-size:14px;letter-spacing:-.02em;transition:transform .18s ease,filter .18s ease,background .18s ease,border-color .18s ease;overflow:hidden;user-select:none;white-space:nowrap}
    .btn:before{content:"";position:absolute;inset:0;z-index:-1;opacity:0;background:linear-gradient(115deg,transparent 0%,rgba(255,255,255,.2) 45%,transparent 60%);transform:translateX(-120%);transition:opacity .16s ease}
    .btn:hover:before{opacity:1;animation:sweep .9s ease}.btn:active{transform:scale(.965)}
    @keyframes sweep{to{transform:translateX(120%)}}
    .primary{color:white;background:linear-gradient(135deg,var(--purple) 0%,var(--pink) 55%,var(--cyan) 130%);box-shadow:0 22px 70px rgba(124,92,255,.34),inset 0 1px 0 rgba(255,255,255,.22)}
    .primary:hover{transform:translateY(-1px);filter:saturate(1.15) brightness(1.08)}
    .ghost{color:white;background:rgba(255,255,255,.068);border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 16px 48px rgba(0,0,0,.22)}
    .ghost:hover{background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.2)}
    .shine{background:linear-gradient(90deg,#fff 0%,#c9c0ff 22%,#ff7be8 50%,#68e4ff 78%,#fff 100%);background-size:240% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:textShine 8s ease-in-out infinite;text-shadow:0 0 38px rgba(124,92,255,.16)}
    @keyframes textShine{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
    .header{position:sticky;top:0;z-index:1000;border-bottom:1px solid rgba(255,255,255,.1);background:rgba(7,10,18,.72);backdrop-filter:blur(22px) saturate(1.3);-webkit-backdrop-filter:blur(22px) saturate(1.3)}
    .nav{display:flex;align-items:center;justify-content:space-between;min-height:72px}.logo{display:inline-flex;align-items:center;gap:12px}.logoIcon{position:relative;display:grid;place-items:center;width:43px;height:43px;border-radius:17px;color:#070a12;background:white;box-shadow:0 20px 60px rgba(124,92,255,.35)}
    .logoIcon:after{content:"";position:absolute;inset:-9px;z-index:-1;border-radius:24px;background:var(--purple);filter:blur(18px);opacity:.55}.logoTitle{display:block;font-family:"Space Grotesk",Inter,sans-serif;font-size:22px;line-height:1;font-weight:800;letter-spacing:-.045em}.logoSub{display:block;margin-top:2px;font-size:11px;font-weight:800;color:rgba(255,255,255,.45)}
    .desktopNav{display:flex;align-items:center;gap:5px}.navLink{padding:11px 13px;border-radius:14px;color:rgba(255,255,255,.66);font-size:14px;font-weight:800;transition:background .18s ease,color .18s ease}.navLink:hover{color:white;background:rgba(255,255,255,.07)}.menuBtn{display:none;width:48px;height:48px;padding:0}.mobileMenu{display:none;padding-bottom:14px}.mobileMenu.open{display:block;animation:mobileDrop .23s ease both}@keyframes mobileDrop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}.mobilePanel{padding:12px;border-radius:24px}.mobilePanel a{display:flex;align-items:center;justify-content:space-between;padding:14px;border-radius:16px;color:rgba(255,255,255,.74);font-weight:850}.mobilePanel a:hover{background:rgba(255,255,255,.07);color:white}.mobileActions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
    .hero{position:relative;display:grid;grid-template-columns:1.05fr .95fr;align-items:center;gap:48px;min-height:calc(100svh - 72px);padding:64px 0 54px}.hero:before{content:"";position:absolute;top:7%;left:50%;width:58vw;height:58vw;min-width:520px;min-height:520px;max-width:900px;max-height:900px;transform:translateX(-50%);z-index:-1;border-radius:50%;background:radial-gradient(circle at 40% 30%,rgba(124,92,255,.26),transparent 46%),radial-gradient(circle at 60% 55%,rgba(255,79,216,.14),transparent 52%);filter:blur(20px)}
    .heroCopy{max-width:760px}.heroTitle{margin-top:20px;font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(58px,8vw,118px);font-weight:800;letter-spacing:-.078em;line-height:.84;text-wrap:balance}.heroDesc{max-width:670px;margin-top:24px;color:var(--muted);font-size:20px;line-height:1.72}.heroActions{display:flex;flex-wrap:wrap;align-items:center;gap:13px;margin-top:28px}.heroNote{margin-top:14px;color:rgba(255,255,255,.42);font-size:13px;font-weight:700}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:720px;margin-top:30px}.stat{padding:18px;border-radius:24px}.statNum{font-family:"Space Grotesk",Inter,sans-serif;font-size:27px;line-height:1;font-weight:800;letter-spacing:-.05em}.statLab{margin-top:7px;color:rgba(255,255,255,.47);font-size:12px;font-weight:800}
    .visual{position:relative}.deviceShell{position:relative;width:min(100%,510px);margin-left:auto;border-radius:42px}.deviceShell:before{content:"";position:absolute;inset:-3px;z-index:-2;border-radius:inherit;background:conic-gradient(from 180deg,rgba(124,92,255,.86),rgba(255,79,216,.65),rgba(53,215,255,.55),rgba(124,92,255,.86));filter:blur(18px);opacity:.86;animation:auraSpin 9s linear infinite}@keyframes auraSpin{to{transform:rotate(360deg)}}.device{padding:18px;border-radius:42px}.screen{position:relative;overflow:hidden;padding:20px;border-radius:32px;background:radial-gradient(520px circle at var(--mx,50%) var(--my,20%),rgba(255,255,255,.13),transparent 48%),linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.1)}.screen:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 0%,rgba(255,255,255,.14) 40%,transparent 58%);transform:translateX(-130%)}.screen:hover:after{animation:sweep 1.1s ease}.phoneBar{width:78px;height:6px;margin:0 auto 20px;border-radius:999px;background:rgba(255,255,255,.14)}
    .requestTop{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.kicker{color:rgba(255,255,255,.42);font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.requestTitle{margin-top:4px;font-family:"Space Grotesk",Inter,sans-serif;font-size:29px;font-weight:800;letter-spacing:-.055em}.available{display:inline-flex;align-items:center;gap:8px;padding:9px 11px;border-radius:999px;color:var(--green);background:rgba(73,230,165,.13);border:1px solid rgba(73,230,165,.2);font-size:12px;font-weight:900}.requestCard{margin-top:20px;padding:18px;border-radius:26px;border:1px solid rgba(255,255,255,.105);background:rgba(0,0,0,.23)}.requestRow{display:flex;align-items:flex-start;gap:14px}.requestIcon{display:grid;place-items:center;flex-shrink:0;width:50px;height:50px;border-radius:20px;color:#070a12;background:white;box-shadow:0 18px 50px rgba(255,255,255,.12)}.requestInfo h3{font-size:17px;font-weight:900;letter-spacing:-.025em}.requestInfo p{margin-top:5px;color:rgba(255,255,255,.56);font-size:14px;line-height:1.6}.miniGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:18px}.mini{padding:15px;border-radius:22px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1)}.miniLabel{color:rgba(255,255,255,.48);font-size:12px;font-weight:800}.miniValue{margin-top:5px;font-family:"Space Grotesk",Inter,sans-serif;font-size:28px;line-height:1;font-weight:800;letter-spacing:-.06em}.taskGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-top:16px}.task{padding:14px 10px;border-radius:20px;text-align:center;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.075)}.taskEmoji{font-size:23px;line-height:1}.taskText{margin-top:8px;color:rgba(255,255,255,.56);font-size:12px;font-weight:900}.ready{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:14px;border-radius:22px;background:rgba(124,92,255,.12);border:1px solid rgba(124,92,255,.22)}.ready h4{font-size:14px;font-weight:900}.ready p{margin-top:3px;color:rgba(255,255,255,.47);font-size:12px;font-weight:700}
    .floatPill{position:absolute;z-index:4;display:inline-flex;align-items:center;gap:8px;padding:13px 16px;border-radius:22px;font-size:13px;font-weight:900;background:rgba(255,255,255,.11);border:1px solid rgba(255,255,255,.14);box-shadow:var(--shadow);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);animation:floaty 4.6s ease-in-out infinite}.pillTop{top:-20px;right:-18px}.pillBottom{bottom:-20px;left:-18px;animation-delay:-1.7s}@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
    .section{padding:86px 0}.sectionHeader{max-width:800px;margin:0 auto 42px;text-align:center}.sectionTitle{margin-top:16px;font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(38px,5vw,64px);line-height:.95;font-weight:800;letter-spacing:-.066em;text-wrap:balance}.sectionSub{max-width:700px;margin:18px auto 0;color:var(--muted);font-size:18px;line-height:1.68}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:15px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.card{position:relative;overflow:hidden;padding:24px;border-radius:28px;transition:transform .22s ease,border-color .22s ease,background .22s ease}.card:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(500px circle at 20% 0%,rgba(255,255,255,.08),transparent 44%);opacity:.75}.card>*{position:relative;z-index:1}.card:hover{transform:translateY(-4px);border-color:var(--border2);background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.052))}.icon{display:grid;place-items:center;width:48px;height:48px;border-radius:20px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.1);font-size:23px}.card h3{margin-top:18px;font-family:"Space Grotesk",Inter,sans-serif;font-size:22px;line-height:1.1;font-weight:800;letter-spacing:-.045em}.card p{margin-top:10px;color:rgba(255,255,255,.58);font-size:14px;line-height:1.65}.stepNum{display:grid;place-items:center;width:44px;height:44px;border-radius:18px;color:#070a12;background:white;font-family:"Space Grotesk",Inter,sans-serif;font-size:20px;font-weight:900;box-shadow:0 16px 40px rgba(255,255,255,.12)}
    .pricing{display:grid;grid-template-columns:.82fr 1.18fr;gap:36px;align-items:end}.priceCards{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.popular{background:radial-gradient(540px circle at 20% 0%,rgba(124,92,255,.22),transparent 42%),linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.045));border-color:rgba(255,255,255,.2)}.priceTop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.priceName{margin:0;font-family:"Space Grotesk",Inter,sans-serif;font-size:29px;font-weight:800;letter-spacing:-.055em}.priceDesc{margin-top:5px;color:rgba(255,255,255,.52);font-size:14px;line-height:1.55}.priceMain{display:flex;align-items:flex-end;gap:8px;margin-top:28px}.priceAmount{font-family:"Space Grotesk",Inter,sans-serif;font-size:70px;line-height:.85;font-weight:800;letter-spacing:-.09em}.priceUnit{padding-bottom:7px;color:rgba(255,255,255,.48);font-size:15px;font-weight:800}.checks{display:grid;gap:12px;margin-top:28px;list-style:none}.checks li{display:flex;align-items:flex-start;gap:10px;color:rgba(255,255,255,.7);font-size:14px;line-height:1.45;font-weight:650}.check{color:var(--green);font-weight:900}.fine{margin-top:12px;color:rgba(255,255,255,.4);font-size:12px;line-height:1.5}
    .twoCol{display:grid;grid-template-columns:.86fr 1.14fr;gap:32px;align-items:start}.tip{display:flex;align-items:flex-start;gap:13px;margin-top:24px;padding:18px;border-radius:25px}.tipIcon{display:grid;place-items:center;width:42px;height:42px;flex-shrink:0;border-radius:18px;color:var(--green);background:rgba(73,230,165,.14);border:1px solid rgba(73,230,165,.2);font-weight:900}.tip p{color:rgba(255,255,255,.58);font-size:14px;line-height:1.65}.formBox{padding:26px;border-radius:38px}.formGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.field label{display:block;margin-bottom:8px;color:rgba(255,255,255,.45);font-size:11px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.field input,.field select,.field textarea{width:100%;min-height:49px;padding:13px 15px;color:white;background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.115);border-radius:18px;outline:none;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}.field textarea{min-height:105px;resize:vertical}.field input::placeholder,.field textarea::placeholder{color:rgba(255,255,255,.36)}.field input:focus,.field select:focus,.field textarea:focus{border-color:rgba(255,255,255,.26);background:rgba(255,255,255,.09);box-shadow:0 0 0 4px rgba(124,92,255,.19)}.full{grid-column:1/-1}.estimateResult{margin-top:18px;padding:22px;border-radius:27px;background:rgba(0,0,0,.27);border:1px solid rgba(255,255,255,.105)}.estimateRow{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}.estimateLabel{color:rgba(255,255,255,.4);font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.estimatePrice{margin-top:4px;font-family:"Space Grotesk",Inter,sans-serif;font-size:72px;line-height:.88;font-weight:800;letter-spacing:-.09em}.estimateSide{color:rgba(255,255,255,.53);font-size:14px;line-height:1.6;text-align:right}.formActions{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.status{min-height:24px;margin-top:13px;font-size:14px;font-weight:800}.success{color:var(--green)}.error{color:var(--amber)}
    .area{display:grid;grid-template-columns:1fr 1fr;gap:18px}.areaList{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:24px;list-style:none}.areaList li{padding:15px;border-radius:18px;color:rgba(255,255,255,.7);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);font-size:14px;font-weight:800}.map{position:relative;display:flex;flex-direction:column;justify-content:space-between;min-height:376px;padding:24px;border-radius:28px;border:1px solid rgba(255,255,255,.105);background:radial-gradient(circle at 24% 18%,rgba(124,92,255,.3),transparent 35%),radial-gradient(circle at 80% 70%,rgba(53,215,255,.22),transparent 38%),linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.025))}.rings{position:relative;display:grid;place-items:center;width:220px;height:220px;margin:18px auto;border-radius:50%;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.095)}.rings:before,.rings:after{content:"";position:absolute;border-radius:50%;border:1px solid rgba(255,255,255,.14)}.rings:before{width:158px;height:158px;border-color:rgba(124,92,255,.5)}.rings:after{width:98px;height:98px;border-color:rgba(53,215,255,.46)}.pin{z-index:2;display:grid;place-items:center;width:58px;height:58px;border-radius:50%;color:#070a12;background:white;box-shadow:0 22px 65px rgba(255,255,255,.13),0 0 50px rgba(124,92,255,.45);font-size:25px}.faq{display:grid;gap:12px;max-width:860px;margin:0 auto}details.card{padding:0}summary{display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:76px;padding:22px 24px;cursor:pointer;list-style:none;font-weight:900;letter-spacing:-.02em}summary::-webkit-details-marker{display:none}.plus{display:grid;place-items:center;width:31px;height:31px;flex-shrink:0;border-radius:12px;color:white;background:rgba(255,255,255,.08);transition:transform .18s ease}details[open] .plus{transform:rotate(45deg)}details.card p{padding:0 24px 24px;margin:0;color:rgba(255,255,255,.58);line-height:1.65}.final{padding:42px;border-radius:44px;overflow:hidden;background:radial-gradient(800px circle at 12% 0%,rgba(124,92,255,.22),transparent 42%),radial-gradient(800px circle at 90% 20%,rgba(255,79,216,.16),transparent 44%),linear-gradient(180deg,rgba(255,255,255,.11),rgba(255,255,255,.045))}.finalGrid{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:center}.finalTitle{max-width:820px;margin-top:14px;font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(42px,5vw,78px);line-height:.88;font-weight:800;letter-spacing:-.075em}.finalText{max-width:650px;margin-top:18px;color:rgba(255,255,255,.62);font-size:18px;line-height:1.65}.finalActions{display:grid;gap:12px;min-width:220px}
    .footer{padding:28px 0 calc(28px + var(--safe-bottom));border-top:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.22)}.foot{display:flex;align-items:center;justify-content:space-between;gap:22px}.footTitle{font-family:"Space Grotesk",Inter,sans-serif;font-size:20px;font-weight:800;letter-spacing:-.045em}.footCopy{margin-top:4px;color:rgba(255,255,255,.42);font-size:12px;font-weight:700}.footLinks{display:flex;align-items:center;gap:18px;color:rgba(255,255,255,.48);font-size:13px;font-weight:800}.footLinks a:hover{color:white}.mobileSticky{display:none}.reveal{opacity:0;transform:translateY(20px);transition:opacity .72s cubic-bezier(.22,1,.36,1),transform .72s cubic-bezier(.22,1,.36,1)}.reveal.show{opacity:1;transform:translateY(0)}.d1{transition-delay:.08s}.d2{transition-delay:.16s}.d3{transition-delay:.24s}.toast{position:fixed;right:18px;bottom:18px;z-index:1600;display:none;max-width:360px;padding:16px 18px;border-radius:22px;background:rgba(7,10,18,.86);border:1px solid rgba(255,255,255,.14);box-shadow:var(--shadow);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);color:rgba(255,255,255,.78);font-size:14px;line-height:1.5;font-weight:750}.toast.show{display:block;animation:toastIn .26s ease both}@keyframes toastIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
    .adminTitle{font-family:"Space Grotesk",Inter,sans-serif;font-size:clamp(42px,6vw,82px);line-height:.9;font-weight:800;letter-spacing:-.07em}.adminTable{width:100%;border-collapse:collapse;overflow:hidden}.adminTable th,.adminTable td{padding:14px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:top;font-size:14px}.adminTable th{color:rgba(255,255,255,.5);font-size:11px;text-transform:uppercase;letter-spacing:.14em}.badge{display:inline-flex;align-items:center;padding:7px 10px;border-radius:999px;background:rgba(73,230,165,.13);border:1px solid rgba(73,230,165,.18);color:var(--green);font-size:12px;font-weight:900}.empty{padding:48px;text-align:center;color:rgba(255,255,255,.56)}
    @media (max-width:1050px){.desktopNav{display:none}.menuBtn{display:inline-flex}.hero{grid-template-columns:1fr;min-height:auto;padding-top:48px}.deviceShell{margin-inline:auto}.pricing,.twoCol,.area{grid-template-columns:1fr}.pricingCopy{max-width:760px}}
    @media (max-width:820px){.grid4,.grid3{grid-template-columns:repeat(2,1fr)}.priceCards{grid-template-columns:1fr}.finalGrid{grid-template-columns:1fr}.finalActions{grid-template-columns:repeat(2,1fr)}}
    @media (max-width:620px){.container{width:min(100% - 26px,1240px)}.nav{min-height:66px}.logoIcon{width:40px;height:40px;border-radius:16px}.logoTitle{font-size:20px}.logoSub{display:none}.hero{padding:34px 0;gap:34px}.heroTitle{font-size:clamp(51px,16vw,74px);letter-spacing:-.069em}.heroDesc{font-size:16px;line-height:1.7}.heroActions{display:grid;grid-template-columns:1fr}.btn{width:100%}.stats,.miniGrid,.taskGrid,.formGrid,.formActions,.areaList,.mobileActions{grid-template-columns:1fr}.available,.floatPill{display:none}.section{padding:64px 0}.sectionHeader{margin-bottom:28px}.grid4,.grid3{grid-template-columns:1fr}.card,.formBox,.final{border-radius:26px;padding:20px}.estimateRow{align-items:flex-start;flex-direction:column}.estimateSide{text-align:left}.estimatePrice,.priceAmount{font-size:58px}.finalActions{grid-template-columns:1fr}.foot{flex-direction:column;text-align:center}.footLinks{justify-content:center;flex-wrap:wrap}.mobileSticky{position:fixed;left:12px;right:12px;bottom:calc(12px + var(--safe-bottom));z-index:1200;display:grid;grid-template-columns:1fr 1fr;gap:10px}.mobileSticky .btn{min-height:50px}.toast{left:12px;right:12px;bottom:calc(82px + var(--safe-bottom));max-width:none}.adminTable{display:block;overflow:auto;white-space:nowrap}}
    @media (prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.reveal{opacity:1;transform:none}}
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
    const bags=$('#bags'), stairs=$('#stairs'), heavy=$('#heavy'), placement=$('#placement');
    async function updateEstimate(){ if(!bags||!stairs||!heavy||!placement)return; const params=new URLSearchParams({bags:bags.value,stairs:stairs.value,heavy:heavy.value,placement:placement.value}); try{ const res=await fetch('/api/estimate?'+params.toString()); const data=await res.json(); ['estimatePrice','livePrice'].forEach(id=>{ const el=$('#'+id); if(el)el.textContent=data.price; }); ['estimateTime','liveTime'].forEach(id=>{ const el=$('#'+id); if(el)el.textContent=data.minutes; }); const sms=$('#smsLink'); if(sms){ sms.href='sms:${BUSINESS_PHONE}?body='+encodeURIComponent('Hey Dropcart, I need a grocery unload. Estimate: $'+data.price+', about '+data.minutes+' minutes. Bags: '+data.bags+', stairs: '+data.stairs+', heavy: '+data.heavy+', placement: '+data.placement+'.'); } }catch(err){ console.error(err); } }
    [bags,stairs,heavy,placement].forEach(el=>{ if(el){ el.addEventListener('input',updateEstimate); el.addEventListener('change',updateEstimate); } }); updateEstimate();
    const form=$('#requestForm');
    if(form){ form.addEventListener('submit',async e=>{ e.preventDefault(); const status=$('#formStatus'); const data=Object.fromEntries(new FormData(form).entries()); data.bags=bags?.value||'12'; data.stairs=stairs?.value||'0'; data.heavy=heavy?.value||'0'; data.placement=placement?.value||'0'; try{ const res=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); const out=await res.json(); if(!res.ok) throw new Error(out.message||'Something went wrong'); status.textContent='Request saved! Booking ID: '+out.booking.id+'. Check /admin?pin=1234 to view it.'; status.className='status success'; showToast('Booking request saved.'); form.reset(); }catch(err){ status.textContent=err.message; status.className='status error'; showToast(err.message); } }); }
  </script>
</body>
</html>`;
}

function header() {
  return `<header class="header">
    <div class="container nav">
      <a class="logo" href="/#top" aria-label="Dropcart home">
        <span class="logoIcon" aria-hidden="true">
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="M3 4h2l1.1 5.7M7.4 15h9.9L21 7H6.1" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 20.2h.01M17 20.2h.01" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/></svg>
        </span>
        <span><span class="logoTitle">Dropcart</span><span class="logoSub">Inverness grocery unloading</span></span>
      </a>
      <nav class="desktopNav" aria-label="Main navigation">
        <a class="navLink" href="/#how">How it works</a>
        <a class="navLink" href="/#pricing">Pricing</a>
        <a class="navLink" href="/#estimate">Estimate</a>
        <a class="navLink" href="/#area">Area</a>
        <a class="navLink" href="/#faq">FAQ</a>
        <a class="btn ghost" href="/#contact">Book</a>
        <a class="btn primary" href="tel:${BUSINESS_PHONE}">Call now</a>
      </nav>
      <button id="menuBtn" class="btn ghost menuBtn" aria-label="Open menu" aria-expanded="false">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div id="mobileMenu" class="mobileMenu container">
      <div class="mobilePanel glass">
        <a href="/#how">How it works <span>→</span></a>
        <a href="/#pricing">Pricing <span>→</span></a>
        <a href="/#estimate">Estimate <span>→</span></a>
        <a href="/#area">Service area <span>→</span></a>
        <a href="/#faq">FAQ <span>→</span></a>
        <div class="mobileActions"><a class="btn ghost" href="/#contact">Book</a><a class="btn primary" href="tel:${BUSINESS_PHONE}">Call now</a></div>
      </div>
    </div>
  </header>`;
}

function footer() {
  return `<footer class="footer">
    <div class="container foot">
      <div><div class="footTitle">Dropcart</div><div class="footCopy">© ${new Date().getFullYear()} Dropcart. Inverness, FL. Node.js demo app.</div></div>
      <div class="footLinks"><a href="/#pricing">Pricing</a><a href="/#area">Area</a><a href="/#faq">FAQ</a><a href="/#contact">Contact</a><a href="/admin?pin=${ADMIN_PIN}">Admin</a></div>
    </div>
  </footer>`;
}

function homePage() {
  const body = `${header()}
  <main id="top">
    <section class="container hero">
      <div class="heroCopy reveal">
        <span class="chip"><span class="dot"></span>Inverness, FL only · Powered by Node.js</span>
        <h1 class="heroTitle">You got the groceries. <span class="shine">We do the lifting.</span></h1>
        <p class="heroDesc">Dropcart unloads your car, carries everything inside, and places groceries in the kitchen, fridge, pantry, garage, or wherever you need them. This version has a real Express backend, live estimate API, and saved booking requests.</p>
        <div class="heroActions"><a href="tel:${BUSINESS_PHONE}" class="btn primary">Call ${DISPLAY_PHONE}</a><a href="#estimate" class="btn ghost">Get a quick estimate</a></div>
        <p class="heroNote">Before launching, replace the phone number, email, admin PIN, and service details.</p>
        <div class="stats">
          <div class="stat soft reveal d1"><div class="statNum">$29+</div><div class="statLab">starting unload price</div></div>
          <div class="stat soft reveal d2"><div class="statNum">API</div><div class="statLab">live estimate endpoint</div></div>
          <div class="stat soft reveal d3"><div class="statNum">Saved</div><div class="statLab">booking requests stored</div></div>
        </div>
      </div>
      <div class="visual reveal d2">
        <div class="deviceShell">
          <div id="heroDevice" class="device glass">
            <div class="screen">
              <div class="phoneBar"></div>
              <div class="requestTop"><div><div class="kicker">Live request</div><div class="requestTitle">Grocery unload</div></div><div class="available"><span class="dot"></span>Available</div></div>
              <div class="requestCard">
                <div class="requestRow"><div class="requestIcon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 6h16l-2 12H6L4 6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6a4 4 0 0 1 8 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></div><div class="requestInfo"><h3>Car → kitchen</h3><p>Unload bags, carry cold items first, and place everything where you point.</p></div></div>
                <div class="miniGrid"><div class="mini"><div class="miniLabel">Estimated price</div><div class="miniValue">$<span id="livePrice">29</span></div></div><div class="mini"><div class="miniLabel">Estimated time</div><div class="miniValue"><span id="liveTime">45</span>m</div></div></div>
              </div>
              <div class="taskGrid"><div class="task"><div class="taskEmoji">🛒</div><div class="taskText">Unload</div></div><div class="task"><div class="taskEmoji">🥶</div><div class="taskText">Cold first</div></div><div class="task"><div class="taskEmoji">💾</div><div class="taskText">Saved</div></div></div>
              <div class="ready"><div><h4>Backend included</h4><p>Bookings save into data/bookings.json.</p></div><a class="btn primary" href="/admin?pin=${ADMIN_PIN}">Admin</a></div>
            </div>
          </div>
          <div class="floatPill pillTop">✨ Express server</div><div class="floatPill pillBottom">🧊 Live pricing API</div>
        </div>
      </div>
    </section>

    <section class="container section">
      <div class="grid4">
        <article class="card glass reveal"><div class="icon">🚗</div><h3>From your car</h3><p>Unload trunks, backseats, pickup beds, or grocery delivery drop-offs.</p></article>
        <article class="card glass reveal d1"><div class="icon">🏡</div><h3>Into your home</h3><p>Kitchen, fridge, pantry, garage, apartment, porch, or wherever needed.</p></article>
        <article class="card glass reveal d2"><div class="icon">⚙️</div><h3>Real backend</h3><p>The booking form posts to Express instead of pretending to work.</p></article>
        <article class="card glass reveal d3"><div class="icon">📋</div><h3>Admin page</h3><p>View submitted requests from a private admin URL with a simple PIN.</p></article>
      </div>
    </section>

    <section id="how" class="container section">
      <div class="sectionHeader reveal"><span class="chip">Simple process</span><h2 class="sectionTitle">Call. Estimate. Save the request.</h2><p class="sectionSub">This is now closer to a real service app, not just a pretty page.</p></div>
      <div class="grid4">
        <article class="card glass reveal"><div class="stepNum">1</div><h3>Customer estimates</h3><p>The estimator sends values to /api/estimate and updates pricing live.</p></article>
        <article class="card glass reveal d1"><div class="stepNum">2</div><h3>Customer books</h3><p>The request form posts name, phone, address, notes, and estimate data.</p></article>
        <article class="card glass reveal d2"><div class="stepNum">3</div><h3>Server saves it</h3><p>Express validates the request and stores it in data/bookings.json.</p></article>
        <article class="card glass reveal d3"><div class="stepNum">4</div><h3>You follow up</h3><p>Open the admin page, call/text the customer, and confirm the unload.</p></article>
      </div>
    </section>

    <section id="pricing" class="container section">
      <div class="pricing">
        <div class="pricingCopy reveal"><span class="chip">Pricing</span><h2 class="sectionTitle">Clear prices that make sense.</h2><p class="sectionSub" style="margin-left:0;text-align:left;">The backend uses the same logic as the frontend display, so your estimate is consistent.</p></div>
        <div class="priceCards">
          <article class="card glass popular reveal d1"><div class="priceTop"><div><h3 class="priceName">Quick unload</h3><p class="priceDesc">For normal weekly grocery trips.</p></div><span class="chip">Best start</span></div><div class="priceMain"><span class="priceAmount">$29</span><span class="priceUnit">starting</span></div><ul class="checks"><li><span class="check">✓</span>Up to 45 minutes on-site</li><li><span class="check">✓</span>Car-to-kitchen unload</li><li><span class="check">✓</span>Cold items first if requested</li><li><span class="check">✓</span>Up to 2 flights of stairs</li></ul><a class="btn primary" style="margin-top:26px;width:100%" href="#contact">Book quick unload</a><p class="fine">Extra bags, stairs, heavy items, and sorting can raise the estimate.</p></article>
          <article class="card glass reveal d2"><div class="priceTop"><div><h3 class="priceName">Family plan</h3><p class="priceDesc">For frequent shoppers.</p></div><span class="chip">Save</span></div><div class="priceMain"><span class="priceAmount">$79</span><span class="priceUnit">/mo</span></div><ul class="checks"><li><span class="check">✓</span>4 unloads per month</li><li><span class="check">✓</span>Priority response window</li><li><span class="check">✓</span>1 unused unload rolls over</li><li><span class="check">✓</span>Good for families or seniors</li></ul><a class="btn ghost" style="margin-top:26px;width:100%" href="#contact">Ask about plan</a><p class="fine">This plan is a demo. Confirm the business model before selling it.</p></article>
        </div>
      </div>
    </section>

    <section id="estimate" class="container section">
      <div class="twoCol">
        <div class="reveal"><span class="chip">Live estimator</span><h2 class="sectionTitle">This estimate comes from Node.js.</h2><p class="sectionSub" style="margin-left:0;text-align:left;">Changing the fields calls /api/estimate, then updates the price, time, phone mockup, and text-message link.</p><div class="tip soft"><div class="tipIcon">✓</div><p>For a real launch, connect this with SMS, email alerts, or a database like SQLite. This simple version saves to JSON so it is easy to understand.</p></div></div>
        <form id="estimateForm" class="formBox glass reveal d1">
          <div class="formGrid">
            <div class="field"><label for="bags">Grocery bags</label><input id="bags" type="number" min="1" max="80" value="12" /></div>
            <div class="field"><label for="stairs">Flights of stairs</label><select id="stairs"><option value="0">0 flights</option><option value="1">1 flight</option><option value="2">2 flights</option><option value="3">3+ flights</option></select></div>
            <div class="field"><label for="heavy">Heavy items</label><select id="heavy"><option value="0">None</option><option value="1">A few cases</option><option value="2">Lots of heavy stuff</option></select></div>
            <div class="field"><label for="placement">Placement</label><select id="placement"><option value="0">Kitchen only</option><option value="1">Fridge + pantry</option><option value="2">Full sorting help</option></select></div>
          </div>
          <div class="estimateResult"><div class="estimateRow"><div><div class="estimateLabel">Estimated total</div><div class="estimatePrice">$<span id="estimatePrice">29</span></div></div><div class="estimateSide"><div><span id="estimateTime">45</span> minute estimate</div><div>Final price confirmed by call</div></div></div></div>
          <div class="formActions"><a class="btn primary" href="tel:${BUSINESS_PHONE}">Call to book</a><a id="smsLink" class="btn ghost" href="sms:${BUSINESS_PHONE}?body=Hey%20Dropcart%2C%20I%20need%20a%20grocery%20unload.">Text request</a></div>
        </form>
      </div>
    </section>

    <section id="area" class="container section">
      <div class="area">
        <article class="card glass reveal" style="min-height:420px"><span class="chip">Service area</span><h2 class="sectionTitle">Built for Inverness first.</h2><p class="sectionSub" style="margin-left:0;text-align:left;">Starting local keeps the service realistic. Serve a small area well, then expand once people actually use it.</p><ul class="areaList"><li>Downtown Inverness</li><li>Nearby neighborhoods</li><li>Apartments</li><li>Senior households</li></ul></article>
        <article class="card glass reveal d1" style="min-height:420px"><div class="map"><div><span class="chip">Map preview</span><h3 style="margin-top:18px;font-family:'Space Grotesk';font-size:38px;line-height:.95;letter-spacing:-.06em;">Inverness radius</h3><p style="margin-top:12px;max-width:410px;color:rgba(255,255,255,.58);line-height:1.65;font-size:14px;">Replace this fake map with a real Google Map or service-area image later.</p></div><div class="rings"><div class="pin">📍</div></div><a class="btn primary" href="tel:${BUSINESS_PHONE}">Check my address</a></div></article>
      </div>
    </section>

    <section class="container section">
      <div class="sectionHeader reveal"><span class="chip">Who it helps</span><h2 class="sectionTitle">Perfect for days when groceries feel like too much.</h2></div>
      <div class="grid3"><article class="card glass reveal"><div class="icon">👵</div><h3>Seniors</h3><p>Helpful for people who struggle with heavy bags, water cases, or stairs.</p></article><article class="card glass reveal d1"><div class="icon">👨‍👩‍👧</div><h3>Families</h3><p>Great after a huge Publix, Walmart, Aldi, Costco, or Sam’s Club run.</p></article><article class="card glass reveal d2"><div class="icon">😮‍💨</div><h3>Tired days</h3><p>For the days when ten car trips sounds absolutely terrible.</p></article></div>
    </section>

    <section id="faq" class="container section">
      <div class="sectionHeader reveal"><span class="chip">FAQ</span><h2 class="sectionTitle">Quick answers.</h2></div>
      <div class="faq">
        <details class="card glass reveal"><summary>Do you buy the groceries too?<span class="plus">+</span></summary><p>No. Dropcart is focused on unloading and carrying groceries after they are already bought or delivered.</p></details>
        <details class="card glass reveal d1"><summary>Where do bookings go?<span class="plus">+</span></summary><p>This Node.js version saves requests in data/bookings.json and shows them on /admin?pin=${ADMIN_PIN}.</p></details>
        <details class="card glass reveal d2"><summary>Is this production ready?<span class="plus">+</span></summary><p>It is a strong prototype. Before real launch, add a real database, private admin login, SMS/email notifications, and legal terms.</p></details>
        <details class="card glass reveal d3"><summary>Can you put groceries away?<span class="plus">+</span></summary><p>Yes. The idea is cold items first, then pantry/garage/kitchen placement as requested.</p></details>
      </div>
    </section>

    <section id="contact" class="container section">
      <div class="twoCol">
        <article class="card glass reveal"><span class="chip">Book now</span><h2 class="sectionTitle">Send a real request to the server.</h2><p class="sectionSub" style="margin-left:0;text-align:left;">This form posts to /api/bookings. The server validates it, adds an estimate, and stores it.</p><div style="display:grid;gap:10px;margin-top:26px"><a class="soft" style="padding:14px;border-radius:20px;color:rgba(255,255,255,.66);font-weight:800" href="tel:${BUSINESS_PHONE}">📞 ${DISPLAY_PHONE}</a><a class="soft" style="padding:14px;border-radius:20px;color:rgba(255,255,255,.66);font-weight:800" href="mailto:${BUSINESS_EMAIL}">✉️ ${BUSINESS_EMAIL}</a><div class="soft" style="padding:14px;border-radius:20px;color:rgba(255,255,255,.66);font-weight:800">📍 Inverness, Florida</div></div></article>
        <form id="requestForm" class="formBox glass reveal d1">
          <div class="formGrid">
            <div class="field"><label for="name">Name</label><input id="name" name="name" placeholder="Your name" required /></div>
            <div class="field"><label for="phone">Phone</label><input id="phone" name="phone" placeholder="(352) 555-1234" required /></div>
            <div class="field full"><label for="address">Address</label><input id="address" name="address" placeholder="Street, apartment, or neighborhood" required /></div>
            <div class="field full"><label for="time">Preferred time</label><input id="time" name="time" type="datetime-local" /></div>
            <div class="field full"><label for="notes">Notes</label><textarea id="notes" name="notes" placeholder="Bags? Stairs? Cold items? Gate code?"></textarea></div>
          </div>
          <button class="btn primary" style="margin-top:18px;width:100%" type="submit">Send request to Node.js</button>
          <div id="formStatus" class="status" aria-live="polite"></div>
        </form>
      </div>
    </section>

    <section class="container section" style="padding-top:30px"><div class="final glass reveal"><div class="finalGrid"><div><span class="chip">Ready to launch?</span><h2 class="finalTitle">Static page upgraded into a real app.</h2><p class="finalText">You now have a landing page, API endpoint, booking endpoint, and admin viewer in one Node.js file.</p></div><div class="finalActions"><a href="tel:${BUSINESS_PHONE}" class="btn primary">Call Dropcart</a><a href="/admin?pin=${ADMIN_PIN}" class="btn ghost">View admin</a></div></div></div></section>
  </main>
  ${footer()}
  <div class="mobileSticky"><a class="btn ghost" href="#estimate">Estimate</a><a class="btn primary" href="tel:${BUSINESS_PHONE}">Call now</a></div>`;

  return layout({ title: "Dropcart — Node.js Grocery Unloading App", body });
}

function adminPage(pin) {
  if (pin !== ADMIN_PIN) {
    return layout({
      title: "Dropcart Admin Locked",
      body: `${header()}<main class="container section"><div class="glass" style="padding:42px;border-radius:38px"><span class="chip">Admin locked</span><h1 class="adminTitle" style="margin-top:18px">Wrong or missing PIN.</h1><p class="sectionSub" style="margin-left:0;text-align:left">Use <strong>/admin?pin=1234</strong> for the demo, or set ADMIN_PIN in your environment.</p><a class="btn primary" style="margin-top:24px" href="/">Back home</a></div></main>${footer()}`,
    });
  }

  const bookings = readBookings().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const rows = bookings.map((b) => `
    <tr>
      <td><span class="badge">${escapeHtml(b.status)}</span><br><small>${escapeHtml(b.id)}</small></td>
      <td><strong>${escapeHtml(b.name)}</strong><br>${escapeHtml(b.phone)}</td>
      <td>${escapeHtml(b.address)}<br><small>${escapeHtml(b.time || "No preferred time")}</small></td>
      <td>$${escapeHtml(b.estimate.price)}<br><small>${escapeHtml(b.estimate.minutes)} minutes</small></td>
      <td>${escapeHtml(b.notes || "—")}</td>
      <td>${escapeHtml(new Date(b.createdAt).toLocaleString())}</td>
    </tr>`).join("");

  return layout({
    title: "Dropcart Admin — Bookings",
    body: `${header()}<main class="container section"><div class="reveal show"><span class="chip">Admin</span><h1 class="adminTitle" style="margin-top:18px">Booking requests</h1><p class="sectionSub" style="margin-left:0;text-align:left">Saved from the Node.js booking form. Data file: <strong>data/bookings.json</strong>.</p><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a class="btn primary" href="/">Back home</a><a class="btn ghost" href="/api/bookings?pin=${encodeURIComponent(ADMIN_PIN)}">View JSON</a></div></div><section class="glass" style="margin-top:28px;border-radius:32px;overflow:hidden">${bookings.length ? `<table class="adminTable"><thead><tr><th>Status</th><th>Customer</th><th>Address / Time</th><th>Estimate</th><th>Notes</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">No bookings yet. Submit the form on the homepage first.</div>`}</section></main>${footer()}`,
  });
}

app.get("/", (req, res) => {
  res.send(homePage());
});

app.get("/api/estimate", (req, res) => {
  res.json(calculateEstimate(req.query));
});

app.post("/api/bookings", (req, res) => {
  const name = cleanText(req.body.name, 80);
  const phone = cleanText(req.body.phone, 40);
  const address = cleanText(req.body.address, 180);
  const time = cleanText(req.body.time, 80);
  const notes = cleanText(req.body.notes, 700);

  if (!name || !phone || !address) {
    return res.status(400).json({
      ok: false,
      message: "Please fill out name, phone, and address.",
    });
  }

  const estimate = calculateEstimate(req.body);
  const bookings = readBookings();

  const booking = {
    id: `DC-${Date.now().toString(36).toUpperCase()}`,
    status: "new",
    name,
    phone,
    address,
    time,
    notes,
    estimate,
    createdAt: new Date().toISOString(),
  };

  bookings.push(booking);
  saveBookings(bookings);

  res.status(201).json({
    ok: true,
    message: "Booking request saved.",
    booking,
  });
});

app.get("/api/bookings", (req, res) => {
  if (req.query.pin !== ADMIN_PIN) {
    return res.status(401).json({ ok: false, message: "Unauthorized. Add ?pin=YOUR_PIN." });
  }

  res.json({ ok: true, bookings: readBookings() });
});

app.get("/admin", (req, res) => {
  res.send(adminPage(req.query.pin));
});

app.use((req, res) => {
  res.status(404).send(layout({
    title: "Dropcart — Not Found",
    body: `${header()}<main class="container section"><div class="glass" style="padding:42px;border-radius:38px"><span class="chip">404</span><h1 class="adminTitle" style="margin-top:18px">Page not found.</h1><p class="sectionSub" style="margin-left:0;text-align:left">That route does not exist.</p><a class="btn primary" style="margin-top:24px" href="/">Back home</a></div></main>${footer()}`,
  }));
});

ensureDataFile();
app.listen(PORT, () => {
  console.log(`Dropcart running at http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin?pin=${ADMIN_PIN}`);
});
