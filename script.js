/* =========================================================
   NAVRAM — script.js
   ---------------------------------------------------------
   SECURITY NOTES (read before wiring real endpoints):
   1. This file NEVER stores or transmits any payment
      credential (card, UPI PIN, CVV). Payment happens
      entirely on Cashfree/PhonePe's own hosted page.
   2. All values shown from the backend (order status, etc.)
      are inserted using textContent, never innerHTML, so a
      malicious value returned by a compromised or spoofed
      endpoint cannot execute script in the browser (XSS).
   3. Client-side validation here is a UX convenience only.
      It is NOT a substitute for server-side validation.
      The Lambda functions MUST re-validate everything
      (phone format, quantity bounds, address length, pincode)
      because any request can be forged with curl/Postman —
      never trust that requests came from this page.
   4. Placeholder endpoint constants below are intentionally
      empty. The site will clearly warn in the UI and console
      if they are not filled in, instead of silently failing
      or pointing at a guessed URL.
   ========================================================= */

(function () {
  'use strict';

  // ===================================================================
  // CONFIG — fill these in once your backend + BSP/gateway are ready.
  // See README.md for full setup instructions.
  // ===================================================================
  const CONFIG = {
    // Your API Gateway endpoint that creates an order + returns a
    // payment-gateway redirect URL. Example:
    // "https://abc123.execute-api.ap-south-1.amazonaws.com/prod/create-order"
    ORDER_ENDPOINT: '',

    // Your API Gateway endpoint for order status lookups. Example:
    // "https://abc123.execute-api.ap-south-1.amazonaws.com/prod/order-status"
    ORDER_STATUS_ENDPOINT: '',

    // WhatsApp number in international format, digits only, no + or spaces.
    WHATSAPP_NUMBER: '919058935275',

    // Price per 1L bottle in INR (whole rupees). Used only to SHOW an
    // estimated total to the customer before checkout. The real,
    // authoritative price MUST be set and enforced server-side in the
    // Lambda that creates the payment session — never trust a price
    // sent from the browser.
    PRICE_PER_BOTTLE_INR: 349,

    // Default WhatsApp prefilled message
    // NOTE: Online ordering is currently disabled ("Coming Soon" phase),
    // so this message asks about availability/launch rather than placing
    // an order. Update this once ordering goes live.
    WHATSAPP_MESSAGE: "Hi Navram! I saw your website — when will online ordering for the Cold-Pressed Mustard Oil be available?"
  };

  const ENDPOINTS_CONFIGURED = Boolean(CONFIG.ORDER_ENDPOINT && CONFIG.ORDER_STATUS_ENDPOINT);
  if (!ENDPOINTS_CONFIGURED) {
    console.warn(
      '[Navram] ORDER_ENDPOINT / ORDER_STATUS_ENDPOINT are not set in script.js. ' +
      'Order submission and tracking are disabled until you configure them. See README.md.'
    );
  }

  // ===================================================================
  // Utilities
  // ===================================================================
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function buildWhatsAppLink(customText) {
    const text = encodeURIComponent(customText || CONFIG.WHATSAPP_MESSAGE);
    return 'https://wa.me/' + encodeURIComponent(CONFIG.WHATSAPP_NUMBER) + '?text=' + text;
  }

  function formatINR(amount) {
    return '\u20B9\u00A0' + amount.toLocaleString('en-IN');
  }

  // Basic client-side sanity checks (backend must re-validate independently)
  const PHONE_RE = /^[6-9]\d{9}$/;      // Indian mobile numbers
  const PINCODE_RE = /^\d{6}$/;
  const ORDERID_RE = /^[A-Za-z0-9\-]{4,40}$/;

  function setFieldError(inputEl, message) {
    const errEl = document.getElementById('err-' + inputEl.id);
    if (errEl) errEl.textContent = message || '';
    inputEl.setAttribute('data-touched', 'true');
    inputEl.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  // ===================================================================
  // Year in footer
  // ===================================================================
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // ===================================================================
  // WhatsApp links (wired safely, no innerHTML)
  // ===================================================================
  ['heroWhatsapp', 'orderWhatsapp', 'finalWhatsapp', 'bannerWhatsapp'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('href', buildWhatsAppLink());
  });

  // ===================================================================
  // Sticky header mobile nav toggle
  // ===================================================================
  const header = document.getElementById('site-header');
  const navToggle = document.getElementById('navToggle');
  if (navToggle && header) {
    navToggle.addEventListener('click', function () {
      const isOpen = header.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    qsa('.mobile-nav a').forEach(function (a) {
      a.addEventListener('click', function () {
        header.classList.remove('nav-open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ===================================================================
  // Scroll fade-up animations
  // ===================================================================
  const fadeEls = qsa('.fade-up');
  if ('IntersectionObserver' in window && fadeEls.length) {
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    fadeEls.forEach(function (el) { io.observe(el); });
  } else {
    fadeEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  // ===================================================================
  // Accordion (FAQ)
  // ===================================================================
  qsa('.accordion__trigger').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      const isOpen = btn.getAttribute('aria-expanded') === 'true';

      // Close all others (single-open accordion) — purely cosmetic, not security relevant
      qsa('.accordion__trigger').forEach(function (other) {
        if (other !== btn) {
          other.setAttribute('aria-expanded', 'false');
          const otherPanel = document.getElementById(other.getAttribute('aria-controls'));
          if (otherPanel) otherPanel.style.maxHeight = null;
        }
      });

      btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      if (panel) panel.style.maxHeight = isOpen ? null : (panel.scrollHeight + 20) + 'px';
    });
  });

  // ===================================================================
  // Quantity stepper + live estimated total
  // ===================================================================
  const qtyInput = document.getElementById('ofQty');
  const qtyMinus = document.getElementById('qtyMinus');
  const qtyPlus = document.getElementById('qtyPlus');
  const totalValueEl = document.getElementById('orderTotalValue');
  const QTY_MIN = 1;
  const QTY_MAX = 20;

  function clampQty(val) {
    let n = parseInt(val, 10);
    if (isNaN(n)) n = QTY_MIN;
    return Math.min(QTY_MAX, Math.max(QTY_MIN, n));
  }

  function updateTotal() {
    if (!qtyInput || !totalValueEl) return;
    const qty = clampQty(qtyInput.value);
    const total = qty * CONFIG.PRICE_PER_BOTTLE_INR;
    totalValueEl.textContent = formatINR(total) + ' (est.)';
  }

  if (qtyInput) {
    qtyInput.addEventListener('input', function () {
      updateTotal();
    });
    qtyInput.addEventListener('blur', function () {
      qtyInput.value = clampQty(qtyInput.value);
      updateTotal();
    });
    if (qtyMinus) qtyMinus.addEventListener('click', function () {
      qtyInput.value = clampQty(parseInt(qtyInput.value, 10) - 1);
      updateTotal();
    });
    if (qtyPlus) qtyPlus.addEventListener('click', function () {
      qtyInput.value = clampQty(parseInt(qtyInput.value, 10) + 1);
      updateTotal();
    });
    updateTotal();
  }

  // ===================================================================
  // Order Form submission
  // ===================================================================
  const orderForm = document.getElementById('orderForm');
  const orderStatusEl = document.getElementById('orderFormStatus');
  const orderSubmitBtn = document.getElementById('orderSubmitBtn');

  function validateOrderForm(data) {
    let valid = true;

    const nameEl = document.getElementById('ofName');
    if (!data.name || data.name.trim().length < 2) {
      setFieldError(nameEl, 'Please enter your full name.');
      valid = false;
    } else {
      setFieldError(nameEl, '');
    }

    const phoneEl = document.getElementById('ofPhone');
    if (!PHONE_RE.test(data.phone)) {
      setFieldError(phoneEl, 'Enter a valid 10-digit mobile number.');
      valid = false;
    } else {
      setFieldError(phoneEl, '');
    }

    const addressEl = document.getElementById('ofAddress');
    if (!data.address || data.address.trim().length < 10) {
      setFieldError(addressEl, 'Please enter a complete delivery address.');
      valid = false;
    } else {
      setFieldError(addressEl, '');
    }

    const pincodeEl = document.getElementById('ofPincode');
    if (!PINCODE_RE.test(data.pincode)) {
      setFieldError(pincodeEl, 'Enter a valid 6-digit pincode.');
      valid = false;
    } else {
      setFieldError(pincodeEl, '');
    }

    if (data.quantity < QTY_MIN || data.quantity > QTY_MAX) {
      valid = false;
    }

    return valid;
  }

  function setOrderStatus(message, type) {
    if (!orderStatusEl) return;
    orderStatusEl.textContent = message;
    orderStatusEl.classList.remove('is-error', 'is-success');
    if (type) orderStatusEl.classList.add(type);
  }

  function setSubmitLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle('is-loading', loading);
  }

  if (orderForm) {
    orderForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      setOrderStatus('', null);

      const formData = new FormData(orderForm);
      const data = {
        name: (formData.get('name') || '').toString().trim(),
        phone: (formData.get('phone') || '').toString().trim(),
        address: (formData.get('address') || '').toString().trim(),
        pincode: (formData.get('pincode') || '').toString().trim(),
        quantity: clampQty(formData.get('quantity'))
      };

      if (!validateOrderForm(data)) {
        setOrderStatus('Please fix the highlighted fields above.', 'is-error');
        return;
      }

      if (!ENDPOINTS_CONFIGURED) {
        setOrderStatus(
          'Online ordering isn\u2019t connected yet \u2014 please use "Order on WhatsApp" instead, or check back soon.',
          'is-error'
        );
        return;
      }

      setSubmitLoading(orderSubmitBtn, true);
      setOrderStatus('Creating your order\u2026', null);

      try {
        // NOTE: We intentionally do NOT send a client-computed price/amount
        // as the source of truth. We send quantity; the Lambda backend must
        // look up the authoritative unit price itself and compute the
        // amount server-side before creating the payment session. This
        // prevents a tampered client from ordering at an arbitrary price.
        const response = await fetch(CONFIG.ORDER_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            phone: data.phone,
            address: data.address,
            pincode: data.pincode,
            quantity: data.quantity
          })
        });

        if (!response.ok) {
          throw new Error('Server responded with status ' + response.status);
        }

        const result = await response.json();

        // Expected shape from backend: { orderId: "ORD-XXXXX", paymentUrl: "https://..." }
        if (result && result.paymentUrl) {
          setOrderStatus('Redirecting you to secure payment\u2026', 'is-success');
          // Only ever redirect to an https URL returned by our own backend.
          if (/^https:\/\//i.test(result.paymentUrl)) {
            window.location.href = result.paymentUrl;
          } else {
            throw new Error('Received an unexpected payment URL from the server.');
          }
        } else {
          throw new Error('No payment URL returned by the server.');
        }
      } catch (err) {
        console.error('[Navram] Order submission failed:', err);
        setOrderStatus(
          'Something went wrong placing your order. Please try again, or order on WhatsApp instead.',
          'is-error'
        );
      } finally {
        setSubmitLoading(orderSubmitBtn, false);
      }
    });

    // Clear field errors as the user types
    ['ofName', 'ofPhone', 'ofAddress', 'ofPincode'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', function () { setFieldError(el, ''); });
    });
  }

  // ===================================================================
  // Track Order
  // ===================================================================
  const trackForm = document.getElementById('trackForm');
  const trackResultEl = document.getElementById('trackResult');
  const trackSubmitBtn = document.getElementById('trackSubmitBtn');

  const STATUS_LABELS = {
    pending_payment: { label: 'Pending Payment', cls: 'status-pill--pending' },
    paid: { label: 'Paid \u2014 Preparing Your Order', cls: 'status-pill--paid' },
    confirmed: { label: 'Confirmed', cls: 'status-pill--confirmed' },
    shipped: { label: 'Shipped', cls: 'status-pill--confirmed' },
    delivered: { label: 'Delivered', cls: 'status-pill--paid' },
    failed: { label: 'Payment Failed', cls: 'status-pill--failed' },
    cancelled: { label: 'Cancelled', cls: 'status-pill--failed' }
  };

  function renderTrackResult(order) {
    trackResultEl.textContent = ''; // clear safely
    trackResultEl.classList.remove('is-error');

    const card = document.createElement('div');
    card.className = 'status-card';

    const statusKey = (order.status || '').toLowerCase();
    const statusInfo = STATUS_LABELS[statusKey] || { label: order.status || 'Unknown', cls: 'status-pill--pending' };

    const pill = document.createElement('span');
    pill.className = 'status-pill ' + statusInfo.cls;
    pill.textContent = statusInfo.label; // textContent only — never innerHTML
    card.appendChild(pill);

    const idLine = document.createElement('p');
    idLine.style.margin = '4px 0';
    const idLabel = document.createElement('strong');
    idLabel.textContent = 'Order ID: ';
    idLine.appendChild(idLabel);
    idLine.appendChild(document.createTextNode(order.orderId || '\u2014'));
    card.appendChild(idLine);

    if (order.quantity) {
      const qtyLine = document.createElement('p');
      qtyLine.style.margin = '4px 0';
      qtyLine.style.fontSize = '0.9rem';
      qtyLine.style.color = 'var(--ink-soft)';
      qtyLine.textContent = 'Quantity: ' + order.quantity + ' bottle(s)';
      card.appendChild(qtyLine);
    }

    if (order.updatedAt) {
      const timeLine = document.createElement('p');
      timeLine.style.margin = '4px 0';
      timeLine.style.fontSize = '0.85rem';
      timeLine.style.color = 'var(--ink-soft)';
      timeLine.textContent = 'Last updated: ' + order.updatedAt;
      card.appendChild(timeLine);
    }

    trackResultEl.appendChild(card);
  }

  if (trackForm) {
    trackForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      trackResultEl.textContent = '';
      trackResultEl.classList.remove('is-error');

      const formData = new FormData(trackForm);
      const orderId = (formData.get('orderId') || '').toString().trim();
      const phone = (formData.get('phone') || '').toString().trim();

      let valid = true;
      const orderIdEl = document.getElementById('trkOrderId');
      const phoneEl = document.getElementById('trkPhone');

      if (!ORDERID_RE.test(orderId)) {
        setFieldError(orderIdEl, 'Enter the Order ID exactly as you received it.');
        valid = false;
      } else {
        setFieldError(orderIdEl, '');
      }

      if (!PHONE_RE.test(phone)) {
        setFieldError(phoneEl, 'Enter the 10-digit number used while ordering.');
        valid = false;
      } else {
        setFieldError(phoneEl, '');
      }

      if (!valid) return;

      if (!ENDPOINTS_CONFIGURED) {
        trackResultEl.textContent = 'Order tracking isn\u2019t connected yet. Please message us on WhatsApp with your Order ID instead.';
        trackResultEl.classList.add('is-error');
        return;
      }

      setSubmitLoading(trackSubmitBtn, true);

      try {
        const url = CONFIG.ORDER_STATUS_ENDPOINT
          + '?id=' + encodeURIComponent(orderId)
          + '&phone=' + encodeURIComponent(phone);

        const response = await fetch(url, { method: 'GET' });

        if (response.status === 404) {
          trackResultEl.textContent = 'We couldn\u2019t find an order with that ID and phone number. Please double-check and try again.';
          trackResultEl.classList.add('is-error');
          return;
        }
        if (!response.ok) {
          throw new Error('Server responded with status ' + response.status);
        }

        const order = await response.json();
        renderTrackResult(order);
      } catch (err) {
        console.error('[Navram] Order tracking failed:', err);
        trackResultEl.textContent = 'Something went wrong checking your order. Please try again in a moment.';
        trackResultEl.classList.add('is-error');
      } finally {
        setSubmitLoading(trackSubmitBtn, false);
      }
    });

    ['trkOrderId', 'trkPhone'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', function () { setFieldError(el, ''); });
    });
  }

  // ===================================================================
  // Terms / Privacy modal (static content, safe innerHTML from our own
  // trusted constant strings only — never from user or network input)
  // ===================================================================
  const MODAL_CONTENT = {
    privacy: {
      title: 'Privacy Policy',
      body: '<p>We collect only what\u2019s needed to fulfil your order: name, phone number, delivery address, and pincode. This information is used solely to process your order, arrange delivery, and send you order updates via WhatsApp/SMS.</p>' +
        '<p>We do not sell or share your personal information with third parties, except the payment gateway (Cashfree/PhonePe) strictly to process your payment, and delivery partners strictly to deliver your order.</p>' +
        '<p>We never see, store, or have access to your card number, UPI PIN, or net-banking credentials \u2014 these are handled entirely on our payment partner\u2019s secure page.</p>' +
        '<p>For any privacy questions or data deletion requests, contact us on WhatsApp.</p>'
    },
    terms: {
      title: 'Terms of Service',
      body: '<p>By placing an order with Navram, you confirm the delivery details you provide are accurate. Orders are confirmed only after successful payment verification.</p>' +
        '<p>Prices shown are inclusive of applicable taxes unless stated otherwise. Delivery timelines are estimates and may vary by location.</p>' +
        '<p>Since this is a consumable food product, we can only accept returns or replacements for damaged, leaking, or quality-affected bottles, reported within 48 hours of delivery with photo proof, sent via WhatsApp.</p>' +
        '<p>For any order disputes, please reach out to us on WhatsApp and we\u2019ll do our best to resolve it quickly.</p>'
    }
  };

  const modalOverlay = document.getElementById('modalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');
  let lastFocusedEl = null;

  function openModal(key) {
    const content = MODAL_CONTENT[key];
    if (!content || !modalOverlay) return;
    lastFocusedEl = document.activeElement;
    modalTitle.textContent = content.title;
    modalBody.innerHTML = content.body; // trusted constant string defined above only
    modalOverlay.classList.add('is-open');
    modalClose.focus();
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!modalOverlay) return;
    modalOverlay.classList.remove('is-open');
    document.body.style.overflow = '';
    if (lastFocusedEl) lastFocusedEl.focus();
  }

  qsa('[data-modal]').forEach(function (trigger) {
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      openModal(trigger.getAttribute('data-modal'));
    });
  });
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalOverlay) {
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) closeModal();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalOverlay && modalOverlay.classList.contains('is-open')) {
      closeModal();
    }
  });

})();
