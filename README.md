# Navram — Cold-Pressed Mustard Oil Landing Site

A static, single-product landing site for **Navram Cold-Pressed Mustard Oil (Kachi Ghani)**, built for GitHub Pages. No login, no cart, no client-side payment handling — order status is tracked with an Order ID + phone number instead of an account.

> **⏳ "Coming Soon" mode (current state):** Ordering and payment are not live yet.
> The Order Form and Track Order sections are commented out of `index.html` and
> replaced with a "Coming Soon" notice + WhatsApp link. A "Coming Soon" banner
> runs across the top of every page. All disabled UI is preserved, not deleted:
> - The original Order Form + Track Order markup lives in
>   `order-section.html.disabled` (paste back into `index.html` when ready).
> - Nav links, hero CTA, and the Product Showcase CTA were changed to
>   non-interactive "Coming Soon" states — swap them back to `#order` /
>   `#track` links once the sections are restored.
> - No backend/config logic was removed from `script.js`; it's already
>   null-safe against missing form elements, so nothing breaks with the
>   sections disabled.
>
> To go live: restore the two sections from `order-section.html.disabled`,
> restore the nav/hero/product CTA links and labels, then follow the rest of
> this README to wire up `ORDER_ENDPOINT` / `ORDER_STATUS_ENDPOINT`.

```
navram-site/
├── index.html
├── style.css
├── script.js
├── assets/
│   └── img/
│       └── bottle-label.jpg
├── .github/workflows/static.yml   (optional GitHub Pages deploy workflow)
└── README.md
```

---

## 1. Quick start — deploy to GitHub Pages

1. Create a new GitHub repository (public or private with Pages enabled on your plan).
2. Push these files to the repo root (or to a `docs/` folder — your choice).
3. In the repo: **Settings → Pages → Source** → select the branch (e.g. `main`) and folder (`/root` or `/docs`).
4. Your site goes live at `https://<username>.github.io/<repo>/` within a minute or two.
5. Point your custom domain (GoDaddy) at it via a `CNAME` file + DNS records if you want `navram.in` instead of the default GitHub URL. GitHub's docs: Settings → Pages → Custom domain.

**Before going live**, open `script.js` and fill in the three placeholder constants at the top (`CONFIG` object) — see Section 3 below. Until they're filled in, the site works and looks complete, but the order form and order-tracking box will show a friendly "not connected yet" message instead of silently failing.

---

## 2. What's already wired up

| Feature | Status |
|---|---|
| Responsive layout, all sections from the brief | ✅ Done |
| "Order Now" → embedded order form | ✅ Done — needs `ORDER_ENDPOINT` |
| "Order on WhatsApp" buttons | ✅ Done — needs your WhatsApp number confirmed |
| "Track your order" (Order ID + phone) | ✅ Done — needs `ORDER_STATUS_ENDPOINT` |
| Client-side validation (name, phone, pincode, address, quantity) | ✅ Done |
| No secrets/keys/payment logic in client code | ✅ Confirmed — see Section 5 |
| Accessible forms, focus states, `prefers-reduced-motion` support | ✅ Done |

---

## 3. Configuring the backend endpoints

Open `script.js` and find the `CONFIG` object near the top:

```js
const CONFIG = {
  ORDER_ENDPOINT: '',            // <-- fill in your API Gateway "create order" URL
  ORDER_STATUS_ENDPOINT: '',     // <-- fill in your API Gateway "order status" URL
  WHATSAPP_NUMBER: '919058933275',
  PRICE_PER_BOTTLE_INR: 349,     // <-- display-only estimate, NOT the source of truth (see below)
  WHATSAPP_MESSAGE: "Hi Navram! I'd like to order a bottle of Cold-Pressed Mustard Oil (1 Ltr)."
};
```

### `ORDER_ENDPOINT` — expected contract

- **Request:** `POST` with JSON body `{ name, phone, address, pincode, quantity }`
- **Response (200):** `{ "orderId": "ORD-8F3K2", "paymentUrl": "https://payments.cashfree.com/..." }`
- The frontend **only redirects to `paymentUrl` if it starts with `https://`** — this is a deliberate safety check, so make sure your Lambda always returns a real HTTPS gateway URL.
- **Important:** compute the order amount **server-side** from `quantity × your authoritative unit price`. Never trust a price/amount field from the browser — the frontend intentionally does not send one, for exactly this reason.

### `ORDER_STATUS_ENDPOINT` — expected contract

- **Request:** `GET ?id=<orderId>&phone=<phone>`
- **Response (200):** `{ "orderId": "...", "status": "pending_payment" | "paid" | "confirmed" | "shipped" | "delivered" | "failed" | "cancelled", "quantity": 1, "updatedAt": "..." }`
- **Response (404)** if no matching order/phone pair exists.
- Requiring **both** order ID and phone (not just order ID) is what stops someone from guessing IDs and reading other customers' addresses/status. Keep that check on the server side, not just in the UI.

Both endpoints must have **CORS enabled** for your GitHub Pages origin (`Access-Control-Allow-Origin: https://<username>.github.io` or your custom domain), or the browser will block the requests.

---

## 4. WhatsApp Business API setup (the main pending piece)

You have two broad paths. Pick based on how fast you need to launch vs. how much you want to own the integration.

### Option A — Business Solution Provider (BSP) — recommended to start

BSPs give you an API + hosted number faster than going direct to Meta, at the cost of a small markup on per-conversation pricing.

**Recommended for a small single-product store:** **AiSensy** or **Gupshup** — both have simple onboarding and pay-as-you-go plans; **Twilio** is a solid alternative if you're already comfortable with their console.

General steps (similar across BSPs):

1. **Sign up** with the BSP (AiSensy / Gupshup / Twilio).
2. **Verify your business** — you'll need:
   - A registered business name (or GST/Udyam if you have one — helps approval but isn't always mandatory for small businesses)
   - A dedicated phone number **not currently active on regular WhatsApp or WhatsApp Business app** (numbers can't be used in both places at once — decide this early, it's the most common blocker)
   - Business website URL (this GitHub Pages site works) and a Facebook Business Manager account
3. **Submit for WhatsApp Business Platform approval** — via the BSP, which handles the Meta paperwork for you. Approval typically takes anywhere from a few hours to a few days.
4. **Create message templates** for anything you'll send outside a 24-hour customer-initiated window (e.g. "Your order ORD-8F3K2 has been confirmed!") — these need separate approval from Meta, usually fast (minutes to ~1 day).
5. **Get your API credentials** (API key/token + endpoint URL) from the BSP dashboard.
6. **Wire your Lambda** to call the BSP's send-message API after a webhook confirms payment (see the "How does our login-less system stay trustworthy" doc in this project for the full payment-confirmation flow this plugs into).
7. **Pricing:** BSPs bill per conversation (a 24-hour message window), with a small markup over Meta's own per-conversation rates. Check current rates on each BSP's pricing page before committing — these change and vary by country/category.

### Option B — Direct via Meta (WhatsApp Business Platform / Cloud API)

More control, no BSP markup, but more setup work and you handle infrastructure yourself.

1. Create a **Meta Business Account** at business.facebook.com if you don't have one.
2. Go to **Meta for Developers** → create an app → add the **WhatsApp** product.
3. Add and verify your **dedicated phone number** (same constraint as above — can't be double-registered on the regular WhatsApp apps).
4. Complete **Business Verification** in Meta Business Manager (identity documents, business proof) — required to move from test mode to sending messages to non-test numbers at scale.
5. Generate a **permanent access token** (System User token in Business Manager, not a temporary 24-hour token) for your Lambda to use.
6. Submit **message templates** for approval if you'll send business-initiated messages (order confirmations, shipping updates).
7. Call the **Cloud API** (`https://graph.facebook.com/v20.0/<phone-number-id>/messages` or current version — check Meta's docs for the latest) directly from your Lambda using the access token.
8. **Pricing:** Meta's own per-conversation rates apply, billed directly, no BSP markup — but you're responsible for uptime, retries, and template compliance yourself.

### Either way — what your Lambda needs

Regardless of path, your order-confirmation Lambda (triggered by the payment webhook — see the login-less trust doc) needs:

- The BSP/Meta **API endpoint + auth token**, stored as a **Lambda environment variable or AWS Secrets Manager secret** — never in this repo, never in client-side code.
- The customer's phone number (already collected on the order form) formatted correctly (usually `91XXXXXXXXXX`, no `+` or leading zero, but confirm your BSP's exact format).
- An **approved message template** if the message is sent outside a customer-initiated 24-hour window (which order confirmations usually are, since the customer's last message might have been on the order form, not WhatsApp itself).

---

## 5. Security review — confirmed before packaging

This was checked explicitly before this zip was finalized:

- ✅ **No API keys, tokens, or payment credentials anywhere in `index.html`, `style.css`, or `script.js`.** Grepped for `key`, `secret`, `token`, `password` — only unrelated UI copy matched.
- ✅ **No `innerHTML` is ever set from user input or network responses.** The only `innerHTML` usage in `script.js` is for the Terms/Privacy modal, and it only ever inserts fixed strings written directly in the source — never anything from a form field or an API response. Order status and all user-supplied text use `textContent`/`createTextNode`.
- ✅ **Payment amount is never trusted from the client.** The order form sends `quantity` only; the backend must compute and enforce the real price. `PRICE_PER_BOTTLE_INR` in `script.js` is display-only, for showing an estimate before checkout.
- ✅ **Payment redirect is restricted to `https://` URLs** returned by your own backend, closing off a malformed or spoofed response from redirecting to a non-HTTPS or script-based URL.
- ✅ **All `target="_blank"` links carry `rel="noopener"`** (WhatsApp/Instagram links), preventing the linked page from accessing `window.opener`.
- ✅ **Order tracking requires both Order ID and phone number**, matching the "login-less trust" design already agreed — this is enforced in the UI, but must also be enforced server-side (see Section 3) since anyone can call your API directly.
- ✅ **No plaintext form submission** — forms have no `action`/`method` attributes; all submission happens via `fetch()` in JS, so there's no risk of the browser doing a native form POST with sensitive fields in a URL or to the wrong place.
- ✅ **Client-side validation is explicitly documented as non-authoritative** — comments in `script.js` flag that the Lambda backend must independently re-validate phone format, pincode, address length, and quantity bounds, since any HTTP client (not just this website) can call your API directly.
- ⚠️ **CORS must be configured on your API Gateway** to only allow your actual site origin — this can't be done from the frontend and is called out in Section 3 so it isn't missed.
- ⚠️ **Webhook signature verification** (Cashfree/PhonePe → your Lambda) is a backend concern, not part of this static site, but is essential — see the "login-less trust" document already in this project for the full design.

Nothing in this deliverable stores, transmits, or logs card numbers, UPI PINs, CVVs, or OTPs — payment happens entirely on your gateway's hosted page, which is the architecture already agreed for this project.

---

## 6. Still to finalize (tracked from the wider project)

- [ ] Confirm Cashfree vs PhonePe for Business, and finish `ORDER_ENDPOINT` / webhook Lambda
- [ ] Confirm BSP choice (AiSensy / Gupshup / Twilio) or go direct via Meta, and get the dedicated WhatsApp number approved
- [ ] Finalize DynamoDB schema for orders (conditional writes to avoid the inventory race condition already flagged)
- [ ] Fill in `CONFIG.PRICE_PER_BOTTLE_INR` with the real price, and set the same price server-side as the source of truth
- [ ] Add real customer testimonials once available (current ones are placeholder copy)
- [ ] Decide on GoDaddy Domain Ownership Protection add-on (non-essential today given account-level 2FA; revisit if the domain becomes business-critical)

---

## 7. Local preview

No build step needed — it's a static site. Either:

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000`.
