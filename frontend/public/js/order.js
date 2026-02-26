/**
 * BakeFlow - Order Submission Module
 */

let isSubmitting = false; // Prevent double submissions
let isSubmittingPreorder = false;
let activeOrder = null;
let activeOrderEditable = false;

// ── Inline validation helpers ──
function clearFieldErrors() {
    document.querySelectorAll('.form-input.invalid').forEach(el => el.classList.remove('invalid'));
    document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; el.style.display = 'none'; });
}
function markFieldInvalid(fieldId, msg) {
    const el = document.getElementById(fieldId);
    if (el) el.classList.add('invalid');
    const errEl = document.getElementById(fieldId + 'Error');
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    else if (typeof showError === 'function') showError(msg);
}

// ── Promise-based confirm modal ──
function showConfirmModal(title, message) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'bf-modal-overlay active';
        overlay.innerHTML = `
            <div class="bf-modal" role="dialog" aria-modal="true" aria-labelledby="_cfm_title">
                <h3 class="bf-modal-title" id="_cfm_title">${title}</h3>
                <p class="bf-modal-body">${message}</p>
                <div class="bf-modal-actions">
                    <button class="bf-modal-btn bf-modal-btn-secondary" data-action="cancel">Cancel</button>
                    <button class="bf-modal-btn bf-modal-btn-primary" data-action="confirm">Continue</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => {
            const action = e.target.dataset.action;
            if (action === 'confirm' || action === 'cancel') {
                overlay.remove();
                resolve(action === 'confirm');
            }
        });
    });
}

function getAuthToken() {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get('t');
    if (tok) return tok;
    if (window.getWebviewToken) return window.getWebviewToken();
    return '';
}

function getResolvedUserId() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlUserId = urlParams.get('user_id') || '';
    let storedUserId = '';
    try {
        storedUserId = localStorage.getItem('bf_psid') || localStorage.getItem('bf_user_id') || '';
    } catch (e) { }
    const resolvedUserId = (storedUserId && storedUserId !== 'guest')
        ? storedUserId
        : ((urlUserId && urlUserId !== 'guest')
            ? urlUserId
            : (window.getUserId ? window.getUserId() : 'guest'));
    return resolvedUserId || 'guest';
}

function splitNamePhone(rawName) {
    const nameValue = String(rawName || '').trim();
    const match = nameValue.match(/^(.*)\((.*)\)\s*$/);
    if (!match) return { name: nameValue || '', phone: '' };
    return { name: match[1].trim() || nameValue, phone: match[2].trim() || '' };
}

function setEditLock(isLocked) {
    const nameEl = document.getElementById('customerName');
    const phoneEl = document.getElementById('customerPhone');
    const addressEl = document.getElementById('customerAddress');
    if (nameEl) nameEl.disabled = !!isLocked;
    if (phoneEl) phoneEl.disabled = !!isLocked;
    if (addressEl) addressEl.disabled = !!isLocked;
    document.querySelectorAll('.radio-option').forEach(opt => {
        opt.classList.toggle('disabled', !!isLocked);
    });
}

function applyActiveOrder(order) {
    const banner = document.getElementById('activeOrderBanner');
    if (!banner) return;
    // Hide the banner - we now use the choice dialog instead
    banner.style.display = 'none';

    if (!order || !order.id) {
        setEditLock(false);
        return;
    }

    const { name, phone } = splitNamePhone(order.customer_name);
    const nameEl = document.getElementById('customerName');
    const phoneEl = document.getElementById('customerPhone');
    const addressEl = document.getElementById('customerAddress');
    if (nameEl && name) nameEl.value = name;
    if (phoneEl && phone) phoneEl.value = phone;

    if (order.delivery_type && window.selectDeliveryType) {
        window.selectDeliveryType(order.delivery_type);
        if (order.delivery_type === 'delivery' && addressEl) {
            addressEl.value = order.address || '';
        }
        if (order.delivery_type !== 'delivery' && addressEl) {
            addressEl.value = '';
        }
    }

    setEditLock(!activeOrderEditable);
}

function getActiveOrderBlockMessage() {
    if (!activeOrder || !activeOrder.id || activeOrderEditable) return '';
    const status = String(activeOrder.status || '').trim().toLowerCase();
    // Scheduled orders are independent — they never block order now
    if (status === 'scheduled') return '';
    return 'You already have an active order that can’t be modified right now. Please wait until it completes.';
}

async function loadActiveOrder() {
    const tok = getAuthToken();
    if (!tok) return;
    try {
        const res = await fetch(`/api/me/active-order?t=${encodeURIComponent(tok)}`);
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!data || !data.order) return;
        activeOrder = data.order;
        activeOrderEditable = !!data.editable;
        applyActiveOrder(activeOrder);
    } catch (e) {
        console.log('Failed to load active order', e);
    }
}

function sanitizeMyanmarPhoneInput(raw) {
    const v = (raw || '').trim();
    const hasPlus = v.startsWith('+');
    const digits = v.replace(/\D/g, '');
    if (!digits) return hasPlus ? '+' : '';
    return hasPlus ? `+${digits}` : digits;
}

function normalizeMyanmarPhoneE164(raw) {
    const s = sanitizeMyanmarPhoneInput(raw);
    if (!s) return null;
    if (/^\+959\d{9}$/.test(s)) return s;
    if (/^09\d{9}$/.test(s)) return `+959${s.slice(2)}`;
    return null;
}

function isValidMyanmarPhone(raw) {
    return !!normalizeMyanmarPhoneE164(raw);
}

/**
 * Validate cart stock before checkout
 * Returns { valid: boolean, message: string, items: [...] }
 */
async function validateCartStock() {
    const items = window.getCartItemsForOrder ? window.getCartItemsForOrder() : [];
    if (items.length === 0) {
        return { valid: false, message: 'Your cart is empty', items: [] };
    }

    // Build validation request
    const cartForValidation = items.map(item => ({
        product_id: item.product_id,
        quantity: item.qty
    }));

    try {
        const res = await fetch('/api/stock/validate-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: cartForValidation })
        });
        const data = await res.json();
        return data;
    } catch (e) {
        console.error('Stock validation error:', e);
        // Allow order to proceed if validation fails (fail-open for better UX)
        return { valid: true, message: '', items: [] };
    }
}


async function submitOrder() {
    // Prevent double submission
    if (isSubmitting) {
        return;
    }

    const name = document.getElementById('customerName').value.trim();
    const phoneRaw = document.getElementById('customerPhone').value.trim();
    const address = document.getElementById('customerAddress').value.trim();
    const notes = document.getElementById('orderNotes').value.trim();
    const deliveryType = window.getDeliveryType();

    const focusDeliveryField = (id) => {
        if (typeof closeSheets === 'function') closeSheets();
        if (typeof openDeliveryForm === 'function') openDeliveryForm();
        const el = document.getElementById(id);
        if (el) el.focus();
    };

    // ── Inline validation with field highlighting ──
    clearFieldErrors();

    if (!name) {
        focusDeliveryField('customerName');
        markFieldInvalid('customerName', 'Please enter your name');
        return;
    }
    if (!phoneRaw) {
        focusDeliveryField('customerPhone');
        markFieldInvalid('customerPhone', 'Please enter your phone number');
        return;
    }
    const phone = normalizeMyanmarPhoneE164(phoneRaw);
    if (!phone || !isValidMyanmarPhone(phone)) {
        focusDeliveryField('customerPhone');
        markFieldInvalid('customerPhone', 'Enter 09xxxxxxxxx or +959xxxxxxxxx');
        return;
    }
    if (!deliveryType) {
        focusDeliveryField('customerName');
        showError('Please select Pick Up or Delivery');
        return;
    }
    if (deliveryType === 'delivery' && !address) {
        focusDeliveryField('customerAddress');
        markFieldInvalid('customerAddress', 'Please enter delivery address');
        return;
    }

    // ── If there's a pending custom cake preorder, submit it with the customer info ──
    if (window.__pendingPreorder) {
        const po = window.__pendingPreorder;
        window.__pendingPreorder = null; // clear so it doesn't fire twice

        // Show loading state on the Place Order button
        isSubmitting = true;
        const submitBtn = document.getElementById('placeOrderBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner"></span> Placing custom cake order...';
        }

        const sched = { type: deliveryType, date: po.scheduleDate, time: po.scheduleTime };

        if (window.submitPreorderDirect) {
            // Multi-cake format (new): po.cakes is an array
            if (po.cakes && po.cakes.length > 0) {
                await window.submitPreorderDirect({
                    cakes: po.cakes, schedule: sched,
                    customerName: name, customerPhone: phone,
                    deliveryType: deliveryType,
                    address: deliveryType === 'delivery' ? address : 'Pickup at store'
                });
            } else {
                // Legacy single-cake format
                await window.submitPreorderDirect({
                    flavor: po.flavor, size: po.size, layers: po.layers, cream: po.cream,
                    message: po.message, notes: po.notes, product: po.product, schedule: sched,
                    customerName: name, customerPhone: phone,
                    deliveryType: deliveryType,
                    address: deliveryType === 'delivery' ? address : 'Pickup at store'
                });
            }
        }
        isSubmitting = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="check-circle"></i><span>Place Order</span>';
        }
        return;
    }

    const blockMsg = getActiveOrderBlockMessage();
    if (blockMsg) {
        showError(blockMsg);
        return;
    }

    const phoneEl = document.getElementById('customerPhone');
    if (phoneEl && phoneEl.value.trim() !== phone) {
        phoneEl.value = phone;
    }

    if (activeOrder && activeOrder.id && activeOrderEditable) {
        const normalize = (v) => String(v || '').trim().toLowerCase();
        const activeParsed = splitNamePhone(activeOrder.customer_name);
        const activeName = normalize(activeParsed.name);
        const activePhone = normalizeMyanmarPhoneE164(activeParsed.phone) || normalize(activeParsed.phone);
        const nextPhone = normalizeMyanmarPhoneE164(phone) || normalize(phone);
        const activeType = normalize(activeOrder.delivery_type);
        const nextType = normalize(deliveryType);
        const activeAddress = normalize(activeOrder.delivery_type === 'delivery' ? activeOrder.address : 'pickup');
        const nextAddress = normalize(deliveryType === 'delivery' ? address : 'pickup');

        const nameChanged = normalize(name) !== activeName;
        const phoneChanged = nextPhone !== activePhone;
        const typeChanged = nextType !== activeType;
        const addressChanged = nextAddress !== activeAddress;

        if (nameChanged || phoneChanged || typeChanged || addressChanged) {
            const ok = await showConfirmModal(
                'Update Order Details?',
                `You already have an active order (#${activeOrder.id}). Updating your details will update that same order.`
            );
            if (!ok) {
                resetSubmitButton();
                return;
            }
        }
    }

    const urlParams = new URLSearchParams(window.location.search);
    const urlUserId = urlParams.get('user_id') || '';
    let storedUserId = '';
    try {
        storedUserId = localStorage.getItem('bf_psid') || localStorage.getItem('bf_user_id') || '';
    } catch (e) { }
    const resolvedUserId = (storedUserId && storedUserId !== 'guest')
        ? storedUserId
        : ((urlUserId && urlUserId !== 'guest')
            ? urlUserId
            : (window.getUserId ? window.getUserId() : 'guest'));
    let userId = resolvedUserId || 'guest';
    const tok = urlParams.get('t') || (window.getWebviewToken ? window.getWebviewToken() : '');
    if (tok && userId === 'guest') {
        userId = '';
    }
    if (!tok && (!userId || userId === 'guest')) {
        showError('Please open this order form from Messenger to receive confirmation.');
        return;
    }

    // Use new cart items with notes if available
    let items;
    if (window.getCartItemsForOrder) {
        items = window.getCartItemsForOrder();
    } else {
        // Fallback to legacy cart format
        const cart = window.getCart();
        items = Object.keys(cart).map(id => {
            const product = window.products.find(p => p.id == id);
            return {
                product_id: parseInt(id),
                name: product.name,
                qty: cart[id],
                price: product.price,
                note: ''
            };
        });
    }

    if (!items.length) { showError('Your cart is empty'); return; }

    // Disable button and show loading state
    isSubmitting = true;
    const submitBtn = document.getElementById('placeOrderBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> Checking availability...';
    }

    // Validate stock availability before submitting
    validateCartStock().then(validation => {
        if (!validation.valid) {
            // Build detailed error message
            const unavailableItems = validation.items?.filter(i => !i.is_available) || [];
            if (unavailableItems.length > 0) {
                const itemMessages = unavailableItems.map(i => {
                    const product = window.products.find(p => p.id == i.product_id);
                    const productName = product ? product.name : `Product #${i.product_id}`;
                    return `${productName}: ${i.message}`;
                });
                showError(`Some items are no longer available:\n${itemMessages.join('\n')}`);
            } else {
                showError(validation.message || 'Unable to validate cart');
            }
            resetSubmitButton();
            return;
        }

        // Stock validated, ask payment method then proceed
        if (submitBtn) {
            submitBtn.innerHTML = '<span class="spinner"></span> Placing order...';
        }
        (async () => {
            const method = await (window.choosePaymentMethod ? window.choosePaymentMethod() : choosePaymentMethodInline());
            if (!method) { resetSubmitButton(); return; }
            window.__preferredPayMethod = method;
            processOrderSubmission(name, phone, address, notes, deliveryType, userId, tok, items, method);
        })();
    }).catch(err => {
        console.error('Stock validation error:', err);
        // Proceed anyway on network failure (fail-open)
        if (submitBtn) {
            submitBtn.innerHTML = '<span class="spinner"></span> Placing order...';
        }
        (async () => {
            const method = await (window.choosePaymentMethod ? window.choosePaymentMethod() : choosePaymentMethodInline());
            if (!method) { resetSubmitButton(); return; }
            window.__preferredPayMethod = method;
            processOrderSubmission(name, phone, address, notes, deliveryType, userId, tok, items, method);
        })();
    });
}

function processOrderSubmission(name, phone, address, notes, deliveryType, userId, tok, items, paymentMethod) {

    // Combine all item notes into a formatted string for the order notes
    const itemNotesText = items
        .filter(item => item.note && item.note.trim())
        .map(item => `${item.name}: ${item.note}`)
        .join(' | ');

    // Combine global notes with item-specific notes
    let combinedNotes = notes;
    if (itemNotesText) {
        combinedNotes = combinedNotes
            ? `${notes}\n\n📝 Item notes: ${itemNotesText}`
            : `📝 Item notes: ${itemNotesText}`;
    }

    const orderData = {
        user_id: userId,
        items: items,
        channel: 'messenger',
        customer_name: name,
        customer_phone: phone,
        delivery_type: deliveryType,
        address: deliveryType === 'delivery' ? address : 'Pickup at store',
        notes: combinedNotes,
        schedule: null, // Regular "Order Now" never sends a schedule
        geo: window.getGeo(),
        delivery_directions: document.getElementById('deliveryDirections')?.value.trim() || ''
    };

    // Include promotion data if one was applied
    if (window.currentCheckout) {
        orderData.discount = window.currentCheckout.discount || 0;
        orderData.appliedPromotion = window.currentCheckout.appliedPromotion || null;
        console.log('💰 Applying promotion:', window.currentCheckout.appliedPromotion, 'Discount:', window.currentCheckout.discount);
    }

    console.log('📦 Sending order:', orderData);

    const endpoint = tok ? (`/api/chat/orders?t=${encodeURIComponent(tok)}`) : '/api/chat/orders';

    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
    })
        .then(async res => {
            const text = await res.text();
            let data = null;
            try {
                data = JSON.parse(text);
            } catch (e) {
                data = { success: false, message: text };
            }
            return { res, data };
        })
        .then(({ res, data }) => {
            console.log('📥 Response data:', JSON.stringify(data, null, 2));
            console.log('📥 data.action:', data?.action);

            // Check for order choice request FIRST (before success check)
            if (data && data.action === 'ask_user_choice') {
                console.log('✅ Showing choice dialog!');
                showOrderChoiceDialog(data, orderData, name, phone);
                resetSubmitButton();
                return;
            }

            if (res.ok && data && data.success) {
                try {
                    const userKey = `recent_orders_${getUserId()}`;
                    const existing = JSON.parse(localStorage.getItem(userKey) || '[]');

                    const itemsWithImages = (orderData.items || []).map(it => {
                        const prod = window.products.find(p => p.id == it.product_id);
                        return {
                            id: it.product_id,
                            qty: it.qty,
                            name: it.name,
                            price: it.price,
                            image: prod ? prod.image_url : ''
                        };
                    });

                    const entry = {
                        order_id: data.order_id,
                        timestamp: Date.now(),
                        items: itemsWithImages
                    };

                    const next = Array.isArray(existing) ? existing : [];
                    next.unshift(entry);
                    localStorage.setItem(userKey, JSON.stringify(next.slice(0, 10)));

                    if (window.renderRecentOrders) window.renderRecentOrders();
                } catch (e) {
                    console.log('Failed to persist recent order', e);
                }

                // Show order type specific toast
                const typeLabel = data.type_label || '';
                const toastMsg = typeLabel
                    ? `Order #${data.order_id} placed! ${typeLabel}`
                    : `Order #${data.order_id} placed!`;
                showToast(toastMsg, 'success');

                try {
                    const invoiceKey = `bf_invoice_${data.order_id}`;
                    const promotions = Array.isArray(window.currentCheckout?.appliedPromotions)
                        ? window.currentCheckout.appliedPromotions.map(p => ({
                            label: p.label || p.name || p.code || 'Promotion',
                            amount: p.amount ?? p.discount ?? p.value ?? null
                        }))
                        : (window.currentCheckout?.appliedPromotion ? [{ label: window.currentCheckout.appliedPromotion, amount: window.currentCheckout.discount ?? null }] : []);
                    const invoiceData = {
                        order_id: data.order_id,
                        created_at: new Date().toISOString(),
                        customer_name: name,
                        customer_phone: phone,
                        address: deliveryType === 'delivery' ? address : 'Pickup at store',
                        notes: combinedNotes,
                        delivery_type: deliveryType === 'pickup' ? 'Pick Up' : 'Delivery',
                        payment_status: paymentMethod === 'scan' ? 'Scan to pay' : 'Pay by cash',
                        subtotal: window.currentCheckout?.subtotal ?? data.subtotal ?? null,
                        discount: window.currentCheckout?.discount ?? data.discount ?? null,
                        delivery_fee: window.currentCheckout?.delivery_fee ?? data.delivery_fee ?? null,
                        total: window.currentCheckout?.total ?? data.total ?? data.total_amount ?? null,
                        promotions,
                        items: (orderData.items || []).map(it => ({
                            name: it.name,
                            qty: it.qty,
                            price: it.price,
                            line_total: Number(it.price) * Number(it.qty)
                        }))
                    };
                    localStorage.setItem(invoiceKey, JSON.stringify(invoiceData));
                } catch (e) {
                    console.log('Failed to store invoice', e);
                }

                const payParam = (paymentMethod || window.__preferredPayMethod) === 'scan' ? 'scan' : 'cash';
                window.location.href = `/order/${data.order_id}?pay=${encodeURIComponent(payParam)}`;
            } else {
                // Handle specific errors (like insufficient stock)
                if (data && data.error === 'insufficient_stock') {
                    showError(`Sorry, only ${data.available} ${data.product} available. Please reduce quantity.`);
                } else if (data && data.error === 'product_unavailable') {
                    showError(data.message || 'Product is no longer available');
                } else {
                    showError('Order failed: ' + (data && data.message ? data.message : 'Unknown error'));
                }
                resetSubmitButton();
            }
        })
        .catch(err => {
            console.error('❌ Error:', err);
            showError('Network error. Please try again.');
            resetSubmitButton();
        });
}

// Payment method chooser (inline modal)
function choosePaymentMethodInline() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.25)';
        overlay.style.backdropFilter = 'blur(2px)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '9999';
        const dialog = document.createElement('div');
        dialog.style.background = '#fff';
        dialog.style.borderRadius = '16px';
        dialog.style.boxShadow = '0 12px 40px rgba(0,0,0,0.15)';
        dialog.style.width = 'min(92vw, 420px)';
        dialog.style.padding = '20px';
        dialog.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <div style="width:36px;height:36px;border-radius:10px;background:#FFF4EA;display:flex;align-items:center;justify-content:center;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D8A35D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                </div>
                <div>
                    <div style="font-size:16px;font-weight:700;color:#1f2937">Choose Payment</div>
                    <div style="font-size:12px;color:#6b7280">Pay by Cash or Scan to pay</div>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">
                <button id="payScanBtn" style="padding:12px;border:1px solid #e6ded4;border-radius:12px;background:#f8f5f0;font-weight:700;cursor:pointer;">Scan to Pay</button>
                <button id="payCashBtn" style="padding:12px;border:1px solid #e6ded4;border-radius:12px;background:#fff;font-weight:700;cursor:pointer;">Pay by Cash</button>
                <button id="cancelPayBtn" style="padding:10px;border:none;border-radius:12px;background:#f3f4f6;color:#6b7280;font-weight:600;cursor:pointer;">Cancel</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        const cleanup = () => { try { document.body.removeChild(overlay); } catch(e){} };
        dialog.querySelector('#payScanBtn').addEventListener('click', () => { cleanup(); resolve('scan'); });
        dialog.querySelector('#payCashBtn').addEventListener('click', () => { cleanup(); resolve('cash'); });
        dialog.querySelector('#cancelPayBtn').addEventListener('click', () => { cleanup(); resolve(null); });
    });
}

function resetSubmitButton() {
    isSubmitting = false;
    const submitBtn = document.getElementById('placeOrderBtn');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Place Order';
    }
}

function resetPreorderSubmitButton() {
    isSubmittingPreorder = false;
    const btn = document.getElementById('preorderSubmitBtn');
    if (btn) {
        btn.disabled = false;
        if (typeof window.updatePreorderPriceSummary === 'function') {
            window.updatePreorderPriceSummary();
        } else {
            const textEl = document.getElementById('preorderSubmitText');
            if (textEl) textEl.textContent = 'Order Custom Cake';
        }
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    }
}

function resolveUserAndToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlUserId = urlParams.get('user_id') || '';
    let storedUserId = '';
    try {
        storedUserId = localStorage.getItem('bf_psid') || localStorage.getItem('bf_user_id') || '';
    } catch (e) { }
    const resolvedUserId = (storedUserId && storedUserId !== 'guest')
        ? storedUserId
        : ((urlUserId && urlUserId !== 'guest')
            ? urlUserId
            : (window.getUserId ? window.getUserId() : 'guest'));
    let userId = resolvedUserId || 'guest';
    const tok = urlParams.get('t') || (window.getWebviewToken ? window.getWebviewToken() : '');
    if (tok && userId === 'guest') {
        userId = '';
    }
    return { userId, tok };
}

function normalizePreorderKey(value) {
    return String(value || '').trim().toLowerCase();
}

function resolvePreorderOptionPrice(settings, key, value) {
    const map = settings && typeof settings === 'object' ? settings[key] : null;
    if (!map || typeof map !== 'object') return 0;
    const target = normalizePreorderKey(value);
    let matched = 0;
    Object.keys(map).forEach((name) => {
        if (normalizePreorderKey(name) === target) {
            const parsed = Number(map[name]);
            if (Number.isFinite(parsed)) matched = parsed;
        }
    });
    return matched;
}

function formatPreorderMoney(value) {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

// addPreorderToCart removed — custom cakes now submit as separate orders via submitPreorderDirect

async function submitPreorder(preorder) {
    if (isSubmittingPreorder) return;

    const draft = preorder || window.pendingPreorderDraft || {};
    window.pendingPreorderDraft = draft;

    const name = document.getElementById('customerName')?.value.trim() || '';
    const phoneRaw = document.getElementById('customerPhone')?.value.trim() || '';
    const address = document.getElementById('customerAddress')?.value.trim() || '';
    const deliveryType = window.getDeliveryType ? window.getDeliveryType() : '';

    // ── Inline validation with field highlighting ──
    clearFieldErrors();

    const focusField = (id) => {
        if (typeof closeSheets === 'function') closeSheets();
        if (typeof openDeliveryForm === 'function') openDeliveryForm();
        const el = document.getElementById(id);
        if (el) el.focus();
    };

    if (!name) {
        focusField('customerName');
        markFieldInvalid('customerName', 'Please enter your name');
        return;
    }
    if (!phoneRaw) {
        focusField('customerPhone');
        markFieldInvalid('customerPhone', 'Please enter your phone number');
        return;
    }
    const phone = normalizeMyanmarPhoneE164(phoneRaw);
    if (!phone || !isValidMyanmarPhone(phone)) {
        focusField('customerPhone');
        markFieldInvalid('customerPhone', 'Enter 09xxxxxxxxx or +959xxxxxxxxx');
        return;
    }
    if (!deliveryType) {
        focusField('customerName');
        showError('Please select Pick Up or Delivery');
        return;
    }
    if (deliveryType === 'delivery' && !address) {
        focusField('customerAddress');
        markFieldInvalid('customerAddress', 'Please enter delivery address');
        return;
    }

    const schedule = window.getPendingSchedule ? window.getPendingSchedule() : null;
    if (!schedule || !schedule.date || !schedule.time) {
        showError('Please select date & time in the custom cake form');
        return;
    }

    const { userId, tok } = resolveUserAndToken();
    if (!tok && (!userId || userId === 'guest')) {
        showError('Please open this order form from Messenger to receive confirmation.');
        return;
    }

    const flavor = String(draft?.flavor || '').trim();
    const size = String(draft?.size || '').trim();
    const cakeMessage = String(draft?.message || '').trim();
    const notes = String(draft?.notes || '').trim();
    const layers = String(draft?.layers || '').trim();
    const cream = String(draft?.cream || '').trim();
    const selectedProduct = draft?.product || null;
    const selectedName = String(selectedProduct?.name || '').trim();
    const selectedImage = String(selectedProduct?.image_url || '').trim();

    if (!flavor) { showError('Pick a flavor'); return; }
    if (!size) { showError('Pick a size'); return; }

    const parts = [
        selectedName ? `Cake: ${selectedName}` : '',
        `Flavor: ${flavor}`,
        `Size: ${size}`,
        layers ? `Layers: ${layers}` : '',
        cream ? `Cream: ${cream}` : '',
        cakeMessage ? `Cake message: ${cakeMessage}` : '',
        notes ? `Notes: ${notes}` : '',
        'Price: to be confirmed',
    ].filter(Boolean);
    const itemNote = parts.join('\n');

    const items = [{
        product_id: Number(selectedProduct?.id || 0),
        name: selectedName ? `${selectedName} — Custom (${size})` : `Custom Cake (${size})`,
        qty: 1,
        price: Number(selectedProduct?.price || 0),
        note: itemNote,
        image_url: selectedImage || 'https://images.unsplash.com/photo-1603532648955-039310d9ed75?w=400&h=200&fit=crop'
    }];

    const orderData = {
        user_id: userId,
        items,
        channel: 'messenger',
        customer_name: name,
        customer_phone: phone,
        delivery_type: deliveryType,
        address: deliveryType === 'delivery' ? address : 'Pickup at store',
        notes: `Custom cake order\n\n${itemNote}`,
        schedule,
        geo: window.getGeo ? window.getGeo() : null,
        delivery_directions: document.getElementById('deliveryDirections')?.value.trim() || ''
    };

    isSubmittingPreorder = true;
    const btn = document.getElementById('preorderSubmitBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Placing order...';
    }

    const endpoint = tok ? (`/api/chat/orders?t=${encodeURIComponent(tok)}`) : '/api/chat/orders';

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        });

        const text = await res.text();
        let data = null;
        try {
            data = JSON.parse(text);
        } catch (e) {
            data = { success: false, message: text };
        }

        if (data && data.action === 'existing_custom_order') {
            showCustomOrderChoiceDialog(data, orderData, name, phone);
            resetPreorderSubmitButton();
            return;
        }

        if (data && data.action === 'ask_user_choice') {
            showOrderChoiceDialog(data, orderData, name, phone);
            resetPreorderSubmitButton();
            return;
        }

        if (res.ok && data && data.success) {
            let whenLabel = '';
            try {
                const when = new Date(`${schedule.date}T${schedule.time}:00`);
                whenLabel = Number.isNaN(when.getTime())
                    ? `${schedule.date} ${schedule.time}`
                    : when.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            } catch (e) {
                whenLabel = `${schedule.date} ${schedule.time}`;
            }
            showToast(`Custom cake order #${data.order_id} placed! Ready by ${whenLabel}`, 'success');
            try {
                window.setPendingSchedule && window.setPendingSchedule(null);
                localStorage.removeItem(`pending_schedule_${getUserId()}`);
            } catch (e) { }
            if (typeof closeSheets === 'function') closeSheets();
            window.pendingPreorderDraft = null;

            window.location.href = `/order/${data.order_id}`;
            return;
        }

        if (data && data.error) {
            showToast(data.message || 'Order failed', 'error');
        } else {
            showToast('Order failed: ' + (data?.message || 'Unknown error'), 'error');
        }
        resetPreorderSubmitButton();
    } catch (err) {
        showToast('Network error. Please try again.', 'error');
        resetPreorderSubmitButton();
    }
}

function resetOrder() {
    window.setCart({});
    // Reset cart items array too
    if (window.cartItems) {
        window.cartItems.length = 0;
    }
    try {
        window.setPendingSchedule(null);
        localStorage.removeItem(`pending_schedule_${getUserId()}`);
    } catch (e) {
        // ignore
    }
    document.getElementById('customerName').value = '';
    document.getElementById('customerPhone').value = '';
    document.getElementById('customerAddress').value = '';
    document.getElementById('orderNotes').value = '';
    backToCart();
    window.updateCart();
    resetSubmitButton(); // Reset button for next order
}

// Export
window.submitOrder = submitOrder;
window.validateCartStock = validateCartStock;
window.loadActiveOrder = loadActiveOrder;
window.submitPreorder = submitPreorder;
window.submitPreorderDirect = submitPreorderDirect;

/**
 * Submit a custom cake preorder directly as its own separate order.
 * Called from the preorder sheet with all customer info included.
 */
async function submitPreorderDirect(opts) {
    if (isSubmittingPreorder) return;

    const name = opts.customerName || '';
    const phoneRaw = opts.customerPhone || '';
    const deliveryType = opts.deliveryType || 'pickup';
    const address = opts.address || (deliveryType === 'pickup' ? 'Pickup at store' : '');
    const schedule = opts.schedule || null;
    const phone = phoneRaw ? (normalizeMyanmarPhoneE164(phoneRaw) || phoneRaw) : '';

    if (!schedule || !schedule.date || !schedule.time) {
        showError('Please select date & time');
        return;
    }

    const { userId, tok } = resolveUserAndToken();
    const settings = window.currentPreorderSettings || {};

    // Build items from multi-cake cart or single legacy format
    let items = [];
    let totalPrice = 0;
    let allNotes = [];

    if (opts.cakes && opts.cakes.length > 0) {
        // Multi-cake format
        opts.cakes.forEach((cake, i) => {
            const selectedProduct = cake.product || null;
            const selectedName = String(selectedProduct?.name || '').trim();
            const selectedImage = String(selectedProduct?.image_url || '').trim();
            const cakePrice = Number(cake.price || 0);

            const parts = [
                selectedName ? `Cake: ${selectedName}` : '',
                `Flavor: ${cake.flavor}`,
                `Size: ${cake.size}`,
                cake.layers ? `Layers: ${cake.layers}` : '',
                cake.cream ? `Cream: ${cake.cream}` : '',
                cake.sizeExtra > 0 ? `Size +Ks ${cake.sizeExtra.toFixed(2)}` : '',
                cake.layerExtra > 0 ? `Layer +Ks ${cake.layerExtra.toFixed(2)}` : '',
                cake.creamExtra > 0 ? `Cream +Ks ${cake.creamExtra.toFixed(2)}` : '',
                cake.message ? `Cake message: ${cake.message}` : '',
                cake.notes ? `Notes: ${cake.notes}` : '',
            ].filter(Boolean);
            const itemNote = parts.join('\n');

            items.push({
                product_id: Number(selectedProduct?.id || 0),
                name: selectedName ? `${selectedName} — Custom (${cake.size})` : `Custom Cake (${cake.size})`,
                qty: 1,
                price: cakePrice,
                note: itemNote,
                image_url: selectedImage || 'https://images.unsplash.com/photo-1603532648955-039310d9ed75?w=400&h=200&fit=crop'
            });
            totalPrice += cakePrice;
            allNotes.push(`Cake ${i + 1}: ${selectedName || 'Custom'} — ${cake.flavor}, ${cake.size}`);
        });
    } else {
        // Legacy single-cake format
        const flavor = String(opts.flavor || '').trim();
        const size = String(opts.size || '').trim();
        const cakeMessage = String(opts.message || '').trim();
        const notes = String(opts.notes || '').trim();
        const layers = String(opts.layers || '').trim();
        const cream = String(opts.cream || '').trim();
        const selectedProduct = opts.product || null;
        const selectedName = String(selectedProduct?.name || '').trim();
        const selectedImage = String(selectedProduct?.image_url || '').trim();

        const sizePrice = resolvePreorderOptionPrice(settings, 'size_prices', size);
        const layerPrice = resolvePreorderOptionPrice(settings, 'layer_prices', layers);
        const creamPrice = resolvePreorderOptionPrice(settings, 'cream_prices', cream);
        const extra = [sizePrice, layerPrice, creamPrice].reduce((s, v) => s + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
        const basePrice = Number(selectedProduct?.price || 0);
        totalPrice = basePrice + extra;

        const parts = [
            selectedName ? `Cake: ${selectedName}` : '',
            `Flavor: ${flavor}`, `Size: ${size}`,
            layers ? `Layers: ${layers}` : '', cream ? `Cream: ${cream}` : '',
            sizePrice > 0 ? `Size price: Ks ${sizePrice.toFixed(2)}` : '',
            layerPrice > 0 ? `Layer price: Ks ${layerPrice.toFixed(2)}` : '',
            creamPrice > 0 ? `Cream price: Ks ${creamPrice.toFixed(2)}` : '',
            cakeMessage ? `Cake message: ${cakeMessage}` : '',
            notes ? `Notes: ${notes}` : '',
        ].filter(Boolean);
        const itemNote = parts.join('\n');

        items = [{
            product_id: Number(selectedProduct?.id || 0),
            name: selectedName ? `${selectedName} — Custom (${size})` : `Custom Cake (${size})`,
            qty: 1, price: totalPrice, note: itemNote,
            image_url: selectedImage || 'https://images.unsplash.com/photo-1603532648955-039310d9ed75?w=400&h=200&fit=crop'
        }];
        allNotes.push(itemNote);
    }

    const orderData = {
        user_id: userId,
        items,
        channel: 'messenger',
        order_type: 'custom',
        customer_name: name,
        customer_phone: phone,
        delivery_type: deliveryType,
        address: address,
        notes: `Custom cake order\n\n${allNotes.join('\n\n')}`,
        schedule,
    };

    isSubmittingPreorder = true;
    const btn = document.getElementById('preorderSubmitBtn');
    const btnText = document.getElementById('preorderSubmitText');
    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Placing order...';

    const endpoint = tok ? (`/api/chat/orders?t=${encodeURIComponent(tok)}`) : '/api/chat/orders';

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        });

        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch (e) { data = { success: false, message: text }; }

        if (data && data.action === 'ask_user_choice') {
            showOrderChoiceDialog(data, orderData, name, phone);
            resetPreorderSubmitButton();
            return;
        }

        if (data && data.action === 'existing_custom_order') {
            showCustomOrderChoiceDialog(data, orderData, name, phone);
            resetPreorderSubmitButton();
            return;
        }

        if (res.ok && data && data.success) {
            let whenLabel = '';
            try {
                const when = new Date(`${schedule.date}T${schedule.time}:00`);
                whenLabel = Number.isNaN(when.getTime())
                    ? `${schedule.date} ${schedule.time}`
                    : when.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            } catch (e) {
                whenLabel = `${schedule.date} ${schedule.time}`;
            }
            showToast(`Custom cake order #${data.order_id} placed! Ready by ${whenLabel}`, 'success');

            // Store invoice data for receipt page
            const invoiceData = {
                order_id: data.order_id,
                created_at: new Date().toISOString(),
                customer_name: name,
                customer_phone: phone,
                address: address,
                delivery_type: deliveryType === 'pickup' ? 'Pick Up' : 'Delivery',
                payment_status: 'Pay on delivery',
                subtotal: totalPrice,
                discount: 0,
                delivery_fee: 0,
                total: totalPrice,
                promotions: [],
                items: items.map(it => ({ name: it.name, qty: it.qty, price: it.price, line_total: it.price * it.qty }))
            };
            try {
                localStorage.setItem(`bf_invoice_${data.order_id}`, JSON.stringify(invoiceData));
            } catch (e) { }
            // Also store under a known key so the receipt page can always find it
            try {
                localStorage.setItem('bf_invoice_latest', JSON.stringify(invoiceData));
            } catch (e) { }

            if (typeof closeSheets === 'function') closeSheets();

            window.location.href = `/order/${data.order_id}`;
            return;
        }

        if (data && data.error) {
            showError(data.message || 'Order failed');
        } else {
            showError('Order failed: ' + (data?.message || 'Unknown error'));
        }
        resetPreorderSubmitButton();
    } catch (err) {
        showError('Network error. Please try again.');
        resetPreorderSubmitButton();
    } finally {
        isSubmittingPreorder = false;
    }
}

// ========== Custom Order Choice Dialog ==========
function showCustomOrderChoiceDialog(choiceData, orderData, name, phone) {
    console.log('🎨 Creating custom order choice dialog');

    const existing = document.getElementById('orderChoiceDialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'orderChoiceDialog';
    dialog.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.6); display: flex;
        align-items: center; justify-content: center;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: fadeIn 0.2s ease-out;
    `;

    if (!document.getElementById('orderChoiceAnimations')) {
        const style = document.createElement('style');
        style.id = 'orderChoiceAnimations';
        style.textContent = `
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        `;
        document.head.appendChild(style);
    }

    const existingOrderId = choiceData.order_id;
    const existingOrder = choiceData.order || {};

    const content = document.createElement('div');
    content.style.cssText = `
        background: white; border-radius: 12px; padding: 40px;
        max-width: 480px; width: 90%;
        box-shadow: 0 10px 50px rgba(0,0,0,0.25);
        text-align: center;
        animation: slideUp 0.3s ease-out;
    `;

    const title = document.createElement('h2');
    title.textContent = 'Existing Custom Order';
    title.style.cssText = `
        margin: 0 0 12px 0; font-size: 22px; font-weight: 700;
        color: #1a1a1a; letter-spacing: -0.5px;
    `;

    const msg = document.createElement('p');
    const orderLabel = existingOrderId ? `(#BF-${existingOrderId})` : '';
    const isAddBlocked = choiceData && choiceData.allow_add === false;
    const isUpdateBlocked = choiceData && choiceData.allow_update === false;
    const messageText = isAddBlocked && isUpdateBlocked
        ? `You already have a custom cake order ${orderLabel} being prepared. You can create a new order.`
        : `You already have a custom cake order ${orderLabel}. Add to it or create a new order.`;
    msg.textContent = messageText;
    msg.style.cssText = `
        margin: 0 0 24px 0; font-size: 15px; color: #555; line-height: 1.6;
    `;

    // Order info card (like the order list in the regular dialog)
    const orderList = document.createElement('div');
    orderList.style.cssText = `
        background: #f9f9f9; border-radius: 8px; margin-bottom: 24px;
    `;
    const orderItem = document.createElement('div');
    orderItem.style.cssText = `
        padding: 12px 16px; display: flex;
        justify-content: space-between; align-items: center;
        border-bottom: 1px solid #eee;
        transition: background 0.2s;
    `;
    orderItem.onmouseover = () => { orderItem.style.background = '#f0f0f0'; };
    orderItem.onmouseout = () => { orderItem.style.background = 'transparent'; };
    const orderInfo = document.createElement('div');
    const statusLabel = (existingOrder.status || 'pending').toUpperCase();
    orderInfo.textContent = `Order #BF-${existingOrderId} • ${existingOrder.items || 0} items • Ks ${Number(existingOrder.amount || 0).toFixed(2)} • ${statusLabel}`;
    orderInfo.style.cssText = `
        flex: 1; font-size: 14px; color: #333; font-weight: 500;
    `;
    const allowAdd = !(choiceData && choiceData.allow_add === false);
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Select';
    addBtn.style.cssText = `
        padding: 6px 12px;
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.2s;
    `;
    addBtn.onmouseover = () => { addBtn.style.background = '#45a049'; };
    addBtn.onmouseout = () => { addBtn.style.background = '#4CAF50'; };
    addBtn.onclick = () => {
        dialog.remove();
        sendCustomOrderChoice('add_to_existing', existingOrderId, orderData, name, phone);
    };
    orderItem.appendChild(orderInfo);
    if (allowAdd) {
        orderItem.appendChild(addBtn);
    }
    orderList.appendChild(orderItem);

    // Button group
    const buttonGroup = document.createElement('div');
    buttonGroup.style.cssText = `
        display: flex; gap: 12px; flex-wrap: wrap;
    `;

    const allowNew = !(choiceData && choiceData.allow_new === false);
    const newBtn = document.createElement('button');
    newBtn.textContent = 'Create New Order Instead';
    newBtn.style.cssText = `
        flex: 1; min-width: 200px; padding: 14px 24px;
        background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);
        color: white; border: none; border-radius: 8px;
        font-size: 15px; font-weight: 600; cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(33, 150, 243, 0.3);
    `;
    newBtn.onmouseover = () => { newBtn.style.boxShadow = '0 6px 20px rgba(33,150,243,0.4)'; newBtn.style.transform = 'translateY(-2px)'; };
    newBtn.onmouseout = () => { newBtn.style.boxShadow = '0 4px 12px rgba(33,150,243,0.3)'; newBtn.style.transform = 'translateY(0)'; };
    newBtn.onclick = () => {
        dialog.remove();
        sendCustomOrderChoice('new_order', existingOrderId, orderData, name, phone);
    };

    if (allowNew) {
        buttonGroup.appendChild(newBtn);
    }

    content.appendChild(title);
    content.appendChild(msg);
    content.appendChild(orderList);
    content.appendChild(buttonGroup);
    dialog.appendChild(content);

    document.body.appendChild(dialog);

    // Close on backdrop click
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            dialog.remove();
        }
    });
}

function sendCustomOrderChoice(choice, existingOrderID, orderData, name, phone) {
    console.log('📤 Sending custom order choice:', choice);

    const tok = getAuthToken();
    const userId = getResolvedUserId();

    const choiceRequest = {
        choice: choice,
        order_id: existingOrderID || 0,
        items: orderData.items,
        customer_name: name || orderData.customer_name || '',
        delivery_type: orderData.delivery_type || '',
        address: orderData.address || '',
        user_id: userId,
    };

    const tokenParam = tok ? `?t=${encodeURIComponent(tok)}` : '';
    const apiUrl = `/api/chat/orders/choice${tokenParam}`;

    // Show loading state
    showToast('Processing...', 'info');

    fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(choiceRequest)
    })
        .then(async res => {
            const text = await res.text();
            try { return JSON.parse(text); }
            catch (e) { return { success: false, message: text }; }
        })
        .then(data => {
            console.log('📥 Custom choice response:', data);
            if (data.success) {
                completeOrderSubmission(data, name, phone, orderData, window.__preferredPayMethod);
            } else {
                showError(data.message || 'Failed to process order');
                resetPreorderSubmitButton();
            }
        })
        .catch(err => {
            console.error('❌ Network error:', err);
            showError('Network error. Please try again.');
            resetPreorderSubmitButton();
        });
}

// ========== Order Choice Dialog ==========
function showOrderChoiceDialog(choiceData, orderData, name, phone) {
    console.log('🎨 Creating choice dialog');

    // Remove any existing dialog first
    const existing = document.getElementById('orderChoiceDialog');
    if (existing) {
        existing.remove();
    }

    // Create a modal dialog
    const dialog = document.createElement('div');
    dialog.id = 'orderChoiceDialog';
    dialog.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: fadeIn 0.2s ease-out;
    `;

    // Add animations if not already in document
    if (!document.getElementById('orderChoiceAnimations')) {
        const style = document.createElement('style');
        style.id = 'orderChoiceAnimations';
        style.textContent = `
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideUp {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 40px;
        max-width: 480px;
        width: 90%;
        box-shadow: 0 10px 50px rgba(0,0,0,0.25);
        text-align: center;
        animation: slideUp 0.3s ease-out;
    `;

    const title = document.createElement('h2');
    title.textContent = 'Active Orders';
    title.style.cssText = `
        margin: 0 0 12px 0;
        font-size: 22px;
        font-weight: 700;
        color: #1a1a1a;
        letter-spacing: -0.5px;
    `;

    const msg = document.createElement('p');
    const orderCount = choiceData.orders ? choiceData.orders.length : 1;
    const orderTypeLabel = choiceData.order_type === 'custom' ? 'custom cake' :
        choiceData.order_type === 'scheduled' ? 'scheduled' : '';
    msg.textContent = choiceData.block_new_order
        ? 'You already have a custom cake order. Select it to edit.'
        : `You have ${orderCount} active ${orderCount === 1 ? 'order' : 'orders'}. Add items to an existing order or start fresh?`;
    msg.style.cssText = `
        margin: 0 0 24px 0;
        font-size: 15px;
        color: #555;
        line-height: 1.6;
    `;

    // Create order selection list
    const orderList = document.createElement('div');
    orderList.style.cssText = `
        background: #f9f9f9;
        border-radius: 8px;
        margin-bottom: 24px;
        max-height: 300px;
        overflow-y: auto;
    `;

    if (choiceData.orders && choiceData.orders.length > 0) {
        choiceData.orders.forEach(order => {
            const orderItem = document.createElement('div');
            orderItem.style.cssText = `
                padding: 12px 16px;
                border-bottom: 1px solid #eee;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: pointer;
                transition: background 0.2s;
            `;
            orderItem.onmouseover = () => { orderItem.style.background = '#f0f0f0'; };
            orderItem.onmouseout = () => { orderItem.style.background = 'transparent'; };

            const orderInfo = document.createElement('div');
            orderInfo.textContent = order.summary;
            orderInfo.style.cssText = `
                flex: 1;
                font-size: 14px;
                color: #333;
                font-weight: 500;
            `;

            const selectBtn = document.createElement('button');
            selectBtn.textContent = 'Select';
            selectBtn.style.cssText = `
                padding: 6px 12px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 4px;
                font-size: 12px;
                cursor: pointer;
                transition: background 0.2s;
            `;
            selectBtn.onmouseover = () => { selectBtn.style.background = '#45a049'; };
            selectBtn.onmouseout = () => { selectBtn.style.background = '#4CAF50'; };
            selectBtn.onclick = () => {
                console.log('User chose order:', order.id);
                dialog.remove();
                sendOrderChoice('add_to_existing', order.id, orderData, name, phone);
            };

            orderItem.appendChild(orderInfo);
            orderItem.appendChild(selectBtn);
            orderList.appendChild(orderItem);
        });
    }

    const buttonGroup = document.createElement('div');
    buttonGroup.style.cssText = `
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
    `;

    if (!choiceData.block_new_order) {
        const addBtn = document.createElement('button');
        addBtn.textContent = 'Create New Order Instead';
        addBtn.style.cssText = `
            flex: 1;
            min-width: 200px;
            padding: 14px 24px;
            background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(33, 150, 243, 0.3);
        `;
        addBtn.onmouseover = () => {
            addBtn.style.boxShadow = '0 6px 20px rgba(33, 150, 243, 0.4)';
            addBtn.style.transform = 'translateY(-2px)';
        };
        addBtn.onmouseout = () => {
            addBtn.style.boxShadow = '0 4px 12px rgba(33, 150, 243, 0.3)';
            addBtn.style.transform = 'translateY(0)';
        };
        addBtn.onclick = () => {
            console.log('User chose: new order');
            dialog.remove();
            sendOrderChoice('new_order', null, orderData, name, phone);
        };

        buttonGroup.appendChild(addBtn);
    }

    content.appendChild(title);
    content.appendChild(msg);
    content.appendChild(orderList);
    content.appendChild(buttonGroup);
    dialog.appendChild(content);

    document.body.appendChild(dialog);
    console.log('✅ Dialog appended to body');
}

function sendOrderChoice(choice, existingOrderID, orderData, name, phone) {
    console.log('📤 Sending order choice:', choice);

    const tok = getAuthToken(); // Get the token using the same method
    const userId = getResolvedUserId(); // Get user_id for fallback auth

    const choiceRequest = {
        choice: choice,
        order_id: existingOrderID || 0,
        items: orderData.items,
        customer_name: name,
        delivery_type: orderData.delivery_type,
        address: orderData.address,
        user_id: userId  // Include user_id for fallback authentication
    };

    // Use relative URL with token parameter for ngrok compatibility
    const tokenParam = tok ? `?t=${encodeURIComponent(tok)}` : '';
    const apiUrl = `/api/chat/orders/choice${tokenParam}`;

    console.log('📤 API URL:', apiUrl);
    console.log('📤 Token present:', !!tok);
    console.log('📤 User ID:', userId);
    console.log('📤 Request body:', JSON.stringify(choiceRequest));

    fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(choiceRequest)
    })
        .then(async res => {
            console.log('📥 Response status:', res.status);
            const text = await res.text();
            console.log('📥 Response text:', text);
            try {
                return JSON.parse(text);
            } catch (e) {
                console.error('Failed to parse response:', e);
                return { success: false, message: text };
            }
        })
        .then(data => {
            console.log('📥 Choice response:', data);
            if (data.success) {
                completeOrderSubmission(data, name, phone, orderData);
            } else {
                alert('❌ Error: ' + (data.message || 'Failed to process order'));
                resetSubmitButton();
            }
        })
        .catch(err => {
            console.error('❌ Network error:', err);
            alert('❌ Network error: ' + err.message);
            resetSubmitButton();
        });
}

function completeOrderSubmission(data, name, phone, orderData, paymentMethod) {
    const orderId = data.orderID || data.order_id;
    const orderMsg = data.action === 'items_merged'
        ? `Items added to order #${orderId}!`
        : `Order #${orderId} placed successfully!`;

    showToast(orderMsg, 'success');

    // Store invoice data in localStorage for the receipt page
    try {
        const invoiceKey = `bf_invoice_${orderId}`;
        const deliveryType = data.delivery_type || orderData.delivery_type || '';
        const address = data.address || orderData.address || '';
        const invoiceData = {
            order_id: orderId,
            created_at: new Date().toISOString(),
            customer_name: data.customer_name || name || '',
            customer_phone: phone || '',
            address: deliveryType === 'pickup' ? 'Pickup at store' : address,
            delivery_type: deliveryType === 'pickup' ? 'Pick Up' : 'Delivery',
            payment_status: paymentMethod === 'scan' ? 'Scan to pay' : 'Pay by cash',
            subtotal: data.subtotal ?? null,
            discount: data.discount ?? null,
            delivery_fee: data.delivery_fee ?? null,
            total: data.total ?? data.total_amount ?? null,
            promotions: [],
            items: (data.items && data.items.length > 0 ? data.items : orderData.items || []).map(it => ({
                name: it.name,
                qty: it.qty || it.quantity,
                price: it.price,
                line_total: Number(it.line_total || it.price * (it.qty || it.quantity || 1))
            }))
        };
        localStorage.setItem(invoiceKey, JSON.stringify(invoiceData));
    } catch (e) {
        console.log('Failed to store invoice', e);
    }

    const payParam = (paymentMethod || window.__preferredPayMethod) === 'scan' ? 'scan' : 'cash';
    window.location.href = `/order/${orderId}?pay=${encodeURIComponent(payParam)}`;
}
