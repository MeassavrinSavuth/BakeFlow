/**
 * BakeFlow Order Form - Main Application Logic
 * Handles cart, products, delivery form, and order submission
 */

// ========== State Variables ==========
let products = [];
let cart = {};
let pendingSchedule = null;
let deliveryType = null;
let geo = null;
let map = null;
let marker = null;

// ========== Initialization ==========
async function init() {
    try {
        const res = await fetch('/api/products?limit=50&sort_by=created_at&sort_dir=DESC');
        const data = await res.json();
        const list = Array.isArray(data.products) ? data.products : [];
        products = list.map(p => ({
            id: p.id,
            name: p.name,
            emoji: '',
            price: Number(p.price) || 0,
            created_at: p.created_at,
            image_url: p.image_url || '',
            description: p.description || ''
        }));
        products.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (e) {
        console.log('❌ Failed to load products', e);
        products = [];
    }
    
    renderProducts();
    updateCart();
    renderSavedOrders();
    renderPlacesBar();
    renderRecurringOrders();
    
    if (window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons();
    }
    
    adjustSafePadding();
    window.addEventListener('resize', adjustSafePadding);
    window.addEventListener('orientationchange', adjustSafePadding);

    // Handle pending reorder cart from Saved Orders page
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('user_id') || 'guest';
    const pendingCartKey = `pending_reorder_${userId}`;
    const pendingCart = localStorage.getItem(pendingCartKey);
    
    if (pendingCart) {
        try {
            const items = JSON.parse(pendingCart);
            cart = {};
            const unavailableItems = [];
            items.forEach(it => {
                const p = products.find(px => px.id == it.id);
                if (p) {
                    cart[it.id] = it.qty;
                } else {
                    unavailableItems.push(it.name || `Item #${it.id}`);
                }
            });
            updateCart();
            localStorage.removeItem(pendingCartKey);
            
            if (unavailableItems.length > 0) {
                const itemNames = unavailableItems.slice(0, 3).join(', ');
                const more = unavailableItems.length > 3 ? ` and ${unavailableItems.length - 3} more` : '';
                showToast(`Some items unavailable: ${itemNames}${more}`);
            } else {
                showToast('✓ Order loaded');
            }
        } catch(e) { console.log('Failed to load pending cart', e); }
    }
    
    // Handle reorder flag from order details
    if (params.get('reorder') === '1' && !pendingCart) {
        const key = `saved_orders_${userId}`;
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        if (list.length > 0) {
            cart = {};
            const unavailableItems = [];
            (list[0].items || []).forEach(it => {
                const p = products.find(px => (px.name || '').toLowerCase() === (it.name || '').toLowerCase());
                const id = p ? p.id : null;
                if (id) {
                    cart[id] = it.qty;
                } else {
                    unavailableItems.push(it.name || 'Unknown item');
                }
            });
            updateCart();
            
            if (unavailableItems.length > 0) {
                const itemNames = unavailableItems.slice(0, 3).join(', ');
                const more = unavailableItems.length > 3 ? ` and ${unavailableItems.length - 3} more` : '';
                showToast(`Some items unavailable: ${itemNames}${more}`);
            } else {
                showToast('✓ Order loaded');
            }
        }
    }
    
    // Handle schedule flag
    if (params.get('schedule') === '1') {
        setTimeout(() => {
            const d = new Date();
            const dateEl = document.getElementById('scheduleDate');
            dateEl.min = '';
            dateEl.max = '';
            dateEl.value = d.toISOString().slice(0,10);
            document.getElementById('scheduleTime').value = '';
            openSheet('scheduleSheet');
        }, 300);
    }

    // Wire navigation links
    wireNavigationLinks(userId);
    
    // Setup map tabs
    setupMapTabs();
}

function wireNavigationLinks(userId) {
    const headerLink = document.getElementById('headerSavedOrdersLink');
    if (headerLink) {
        headerLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = `saved-orders.html?user_id=${encodeURIComponent(userId)}`;
        });
    }
    
    document.querySelectorAll('.viewAllSavedLink').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = `saved-orders.html?user_id=${encodeURIComponent(userId)}`;
        });
    });
}

function setupMapTabs() {
    const hasLeaflet = !!window.L;
    activateTab(hasLeaflet ? 'map' : 'dir');
    
    const tabMap = document.getElementById('tabMap');
    const tabDir = document.getElementById('tabDirections');
    if (tabMap) tabMap.addEventListener('click', () => activateTab('map'));
    if (tabDir) tabDir.addEventListener('click', () => activateTab('dir'));
}

// ========== Product Rendering ==========
function renderProducts() {
    const container = document.getElementById('products');
    const countEl = document.getElementById('productsCount');
    
    if (countEl) countEl.textContent = `${products.length} items`;
    
    container.innerHTML = products.map(p => {
        const img = p.image_url && p.image_url.length > 0 
            ? p.image_url 
            : `https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&h=200&fit=crop`;
        return `
        <div class="p-card">
            <img class="p-thumb" src="${img}" alt="${escapeHtml(p.name)}" />
            <div class="p-info">
                <div class="p-name">${escapeHtml(p.name)}</div>
                ${p.description ? `<div class="p-desc">${escapeHtml(p.description)}</div>` : ''}
            </div>
            <div class="p-cta">
                <div class="p-price">$${p.price.toFixed(2)}</div>
                <div class="qty-controls">
                    <button class="qty-btn minus" onclick="decreaseQty(${p.id})" id="dec-${p.id}" disabled>−</button>
                    <div class="qty-display" id="qty-${p.id}">0</div>
                    <button class="qty-btn plus" onclick="increaseQty(${p.id})">+</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ========== Cart Management ==========
function increaseQty(productId) {
    if (!cart[productId]) cart[productId] = 0;
    cart[productId]++;
    updateCart();
}

function decreaseQty(productId) {
    if (cart[productId] > 0) {
        cart[productId]--;
        if (cart[productId] === 0) delete cart[productId];
        updateCart();
    }
}

function clearCart() {
    console.log('clearCart called, cart:', cart);
    if (Object.keys(cart).length === 0) {
        showToast('Cart is already empty');
        return;
    }
    cart = {};
    updateCart();
    showToast('Cart cleared', 'success');
}

async function updateCart() {
    let itemCount = 0;

    products.forEach(p => {
        const qty = cart[p.id] || 0;
        const qtyEl = document.getElementById(`qty-${p.id}`);
        const decEl = document.getElementById(`dec-${p.id}`);
        if (qtyEl) qtyEl.textContent = qty;
        if (decEl) decEl.disabled = qty === 0;
    });

    // Build cart items for checkout calculation
    const cartItems = Object.keys(cart).map(id => {
        const product = products.find(p => p.id == id);
        const qty = cart[id];
        itemCount += qty;
        return {
            productId: parseInt(id),
            qty: qty,
            unitPrice: product.price
        };
    });

    const barItemsEl = document.getElementById('barItems');
    const barSubtotalEl = document.getElementById('barSubtotal');
    const barDiscountEl = document.getElementById('barDiscount');
    const barDiscountRowEl = document.getElementById('barDiscountRow');
    const barTotalEl = document.getElementById('barTotal');
    const barCheckoutEl = document.getElementById('barCheckout');
    
    if (barItemsEl) barItemsEl.textContent = itemCount;
    if (barCheckoutEl) barCheckoutEl.disabled = itemCount === 0;

    // Calculate total with promotions via backend
    if (itemCount > 0 && typeof calculateCheckoutWithPromotions === 'function') {
        try {
            const checkout = await calculateCheckoutWithPromotions(cartItems);
            const displayTotal = checkout.total.toFixed(2);
            const subtotal = Number(checkout.subtotal || checkout.total || 0);
            const discount = Number(checkout.discount || 0);
            const hasPromo = ((Array.isArray(checkout.appliedPromotions) && checkout.appliedPromotions.length > 0) || checkout.appliedPromotion) && discount > 0;
            
            if (barSubtotalEl) barSubtotalEl.textContent = `$${subtotal.toFixed(2)}`;
            if (barDiscountEl) barDiscountEl.textContent = `-$${discount.toFixed(2)}`;
            if (barDiscountRowEl) barDiscountRowEl.style.display = hasPromo ? 'flex' : 'none';
            if (barTotalEl) barTotalEl.textContent = `$${displayTotal}`;
            if (barCheckoutEl) barCheckoutEl.textContent = `Checkout • $${displayTotal}`;

            // Store checkout data for order submission
            window.currentCheckout = checkout;
        } catch (e) {
            console.error('Failed to calculate checkout:', e);
            // Fallback to simple calculation
            const total = cartItems.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
            if (barSubtotalEl) barSubtotalEl.textContent = `$${total.toFixed(2)}`;
            if (barDiscountEl) barDiscountEl.textContent = `-$${(0).toFixed(2)}`;
            if (barDiscountRowEl) barDiscountRowEl.style.display = 'none';
            if (barTotalEl) barTotalEl.textContent = `$${total.toFixed(2)}`;
            if (barCheckoutEl) barCheckoutEl.textContent = `Checkout • $${total.toFixed(2)}`;
        }
    } else {
        // Fallback if promotions.js not loaded
        const total = cartItems.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
        if (barSubtotalEl) barSubtotalEl.textContent = `$${total.toFixed(2)}`;
        if (barDiscountEl) barDiscountEl.textContent = `-$${(0).toFixed(2)}`;
        if (barDiscountRowEl) barDiscountRowEl.style.display = 'none';
        if (barTotalEl) barTotalEl.textContent = `$${total.toFixed(2)}`;
        if (barCheckoutEl) barCheckoutEl.textContent = `Checkout • $${total.toFixed(2)}`;
    }

    if (pendingSchedule && barTotalEl) {
        const when = `${pendingSchedule.date} ${pendingSchedule.time}`;
        const total = (window.currentCheckout?.total || cartItems.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0));
        barTotalEl.textContent = `$${Number(total).toFixed(2)}`;
    }
    
    adjustSafePadding();
}

// ========== Delivery Form ==========
function openDeliveryForm() {
    // Hide main content
    document.querySelectorAll('.section').forEach(s => {
        if (!s.classList.contains('delivery-form')) {
            s.style.display = 'none';
        }
    });
    document.getElementById('savedPlacesBar').style.display = 'none';
    document.getElementById('recurringList').style.display = 'none';
    
    // Show delivery form
    document.getElementById('deliveryForm').classList.add('active');
    document.getElementById('cartBar').style.display = 'none';
    document.getElementById('orderBar').style.display = 'block';
    adjustSafePadding();
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

function backToCart() {
    document.getElementById('deliveryForm').classList.remove('active');
    document.querySelectorAll('.section').forEach(s => s.style.display = '');
    document.getElementById('cartBar').style.display = 'block';
    document.getElementById('orderBar').style.display = 'none';
    renderSavedOrders();
    renderPlacesBar();
    renderRecurringOrders();
    adjustSafePadding();
}

function selectDeliveryType(type) {
    deliveryType = type;
    document.querySelectorAll('.radio-option').forEach(opt => opt.classList.remove('selected'));
    document.querySelector(`[data-type="${type}"]`).classList.add('selected');
    
    const addressGroup = document.getElementById('addressGroup');
    const addressInput = document.getElementById('customerAddress');
    if (type === 'delivery') {
        addressGroup.style.display = 'block';
        addressInput.required = true;
    } else {
        addressGroup.style.display = 'none';
        addressInput.required = false;
    }
}

// ========== Location & Map ==========
async function useMyLocation() {
    const err = showError;
    if (!navigator.geolocation) { err('Location is not available on this device'); return; }
    
    try {
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy:true, timeout:10000, maximumAge:0 });
        });
        const { latitude:lat, longitude:lon } = pos.coords;
        const address = await reverseGeocode(lat, lon);
        document.getElementById('customerAddress').value = address;
        selectDeliveryType('delivery');
        document.getElementById('addressGroup').style.display = 'block';
        geo = { lat, lon, address };
        showMap(lat, lon);
        activateTab('map');
    } catch(e) {
        err('Unable to get location. Check permissions.');
    }
}

async function reverseGeocode(lat, lon) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, { headers: { 'Accept':'application/json' } });
    const j = await res.json();
    return j.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

async function findOnMap() {
    const q = document.getElementById('customerAddress').value.trim();
    const err = showError;
    if (!q) { err('Enter an address to find on map'); return; }
    
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'Accept':'application/json' } });
        const list = await res.json();
        if (!list || !list.length) { err('Address not found'); return; }
        const { lat, lon, display_name } = list[0];
        const latNum = parseFloat(lat), lonNum = parseFloat(lon);
        document.getElementById('customerAddress').value = display_name;
        geo = { lat: latNum, lon: lonNum, address: display_name };
        selectDeliveryType('delivery');
        document.getElementById('addressGroup').style.display = 'block';
        showMap(latNum, lonNum);
        activateTab('map');
    } catch(e) { err('Search failed. Try again.'); }
}

function showMap(lat, lon) {
    const el = document.getElementById('map');
    if (!el) return;
    
    if (!map) {
        map = L.map('map', { zoomControl:false }).setView([lat, lon], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap' }).addTo(map);
        marker = L.marker([lat, lon], { draggable:true }).addTo(map);
        marker.on('dragend', async () => {
            const p = marker.getLatLng();
            const address = await reverseGeocode(p.lat, p.lng);
            document.getElementById('customerAddress').value = address;
            geo = { lat: p.lat, lon: p.lng, address };
        });
    } else {
        map.setView([lat, lon], 16);
        if (marker) { marker.setLatLng([lat, lon]); } 
        else { marker = L.marker([lat, lon], { draggable:true }).addTo(map); }
    }
}

function activateTab(which) {
    const tabMap = document.getElementById('tabMap');
    const tabDir = document.getElementById('tabDirections');
    const mapEl = document.getElementById('map');
    const dirEl = document.getElementById('deliveryDirections');
    if (!tabMap || !tabDir || !mapEl || !dirEl) return;
    
    if (which === 'map') {
        tabMap.classList.add('active'); tabDir.classList.remove('active');
        mapEl.style.display = 'block'; dirEl.style.display = 'none';
    } else {
        tabDir.classList.add('active'); tabMap.classList.remove('active');
        mapEl.style.display = 'none'; dirEl.style.display = 'block';
    }
}

// ========== UI Helpers ==========
function adjustSafePadding() {
    const cartBar = document.getElementById('cartBar');
    const orderBar = document.getElementById('orderBar');
    const h1 = cartBar && cartBar.style.display !== 'none' ? cartBar.offsetHeight : 0;
    const h2 = orderBar && orderBar.style.display !== 'none' ? orderBar.offsetHeight : 0;
    const h = Math.max(h1, h2);
    const pad = Math.max(h + 16, 120);
    document.documentElement.style.setProperty('--content-bottom-pad', pad + 'px');
}

function appendNote(text) {
    const el = document.getElementById('orderNotes');
    if (!el) return;
    const quickNotes = ['Leave at door', 'Call on arrival'];
    const current = (el.value || '')
        .split(/\s*·\s*/)
        .map(s => s.trim())
        .filter(Boolean);
    const withoutQuick = current.filter(s => !quickNotes.includes(s));
    const next = new Set(withoutQuick);
    if (quickNotes.includes(text)) {
        next.add(text);
    } else if (text) {
        next.add(text);
    }
    el.value = Array.from(next).join(' · ');
}

function showError(msg) {
    const b = document.getElementById('errorBanner');
    b.textContent = msg;
    b.style.display = 'block';
    setTimeout(() => { b.style.display = 'none'; }, 2500);
}

function getUserId() {
    return new URLSearchParams(window.location.search).get('user_id') || 'guest';
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    return new Date(timestamp).toLocaleDateString();
}

// ========== Order Submission ==========
async function submitOrder() {
    console.log('🔍 Submit order clicked');
    
    const name = document.getElementById('customerName').value.trim();
    const phone = document.getElementById('customerPhone').value.trim();
    const address = document.getElementById('customerAddress').value.trim();
    const notes = document.getElementById('orderNotes').value.trim();

    if (!name) { showError('Please enter your name'); return; }
    if (!phone) { showError('Please enter your phone number'); return; }
    if (!deliveryType) { showError('Please select delivery type'); return; }
    if (deliveryType === 'delivery' && !address) { showError('Please enter delivery address'); return; }

    try {
        const method = await (window.choosePaymentMethod ? window.choosePaymentMethod() : choosePaymentMethodInline());
        if (!method) {
            console.log('⚠️ Payment selection cancelled');
            return;
        }
        window.__preferredPayMethod = method;
    } catch (e) {
        console.log('Payment chooser failed, defaulting to cash', e);
        window.__preferredPayMethod = 'cash';
    }

    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('user_id');

    const items = Object.keys(cart).map(id => {
        const product = products.find(p => p.id == id);
        return {
            product_id: parseInt(id),
            name: product.name,
            qty: cart[id],
            price: product.price
        };
    });

    if (!items.length) { showError('Your cart is empty'); return; }

    const orderData = {
        user_id: userId,
        items: items,
        channel: 'messenger',
        customer_name: name,
        customer_phone: phone,
        delivery_type: deliveryType,
        address: deliveryType === 'delivery' ? address : 'Pickup at store',
        notes: notes,
        schedule: pendingSchedule || null,
        geo: geo,
        delivery_directions: document.getElementById('deliveryDirections')?.value.trim() || ''
    };

    // Include promotion data if one was applied
    if (window.currentCheckout) {
        orderData.discount = window.currentCheckout.discount || 0;
        orderData.appliedPromotion = window.currentCheckout.appliedPromotion || null;
        orderData.appliedPromotions = Array.isArray(window.currentCheckout.appliedPromotions) ? window.currentCheckout.appliedPromotions : [];
        console.log('💰 Applying promotion:', window.currentCheckout.appliedPromotion, 'Discount:', window.currentCheckout.discount);
    }

    console.log('📦 Sending order:', orderData);

    // Use relative URL so it works with both localhost and ngrok
    const apiUrl = '/api/chat/orders';
    
    fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
    })
    .then(res => {
        console.log('📥 Response status:', res.status);
        return res.json();
    })
    .then(data => {
        console.log('📥 Full response data:', JSON.stringify(data, null, 2));
        console.log('📥 data.action:', data.action);
        console.log('📥 data.success:', data.success);
        console.log('📥 data.existingOrderID:', data.existingOrderID);
        
        // Check if user needs to choose between adding to existing order or creating new
        // Check this FIRST before success, because ask_user_choice also has success: true
        if (data.action === 'ask_user_choice') {
            console.log('✅ Showing choice dialog!');
            showOrderChoiceDialog(data, orderData, name, phone);
        } else if (data.success) {
            console.log('✅ Order successful, completing submission');
            completeOrderSubmission(data, phone);
        } else {
            console.log('❌ Order failed:', data.message);
            alert('❌ Order failed: ' + (data.message || 'Unknown error'));
        }
    })
    .catch(err => {
        console.error('❌ Fetch error:', err);
        alert('❌ Network error. Check console for details.');
    });
}

// Expose functions globally
window.increaseQty = increaseQty;
window.decreaseQty = decreaseQty;
window.clearCart = clearCart;
window.selectDeliveryType = selectDeliveryType;
window.useMyLocation = useMyLocation;
window.findOnMap = findOnMap;
window.appendNote = appendNote;
window.backToCart = backToCart;

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
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 24px;
        max-width: 380px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        text-align: center;
    `;
    
    const title = document.createElement('h2');
    title.textContent = '🛒 Add to Existing Order?';
    title.style.cssText = 'margin: 0 0 8px 0; font-size: 18px; color: #333;';
    
    const msg = document.createElement('p');
    msg.textContent = 'You have an active order. Would you like to add these items to it or create a new one?';
    msg.style.cssText = 'margin: 0 0 16px 0; font-size: 14px; color: #666; line-height: 1.5;';
    
    const existing_order = document.createElement('div');
    existing_order.style.cssText = `
        background: #f5f5f5;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 16px;
        font-size: 13px;
        color: #555;
    `;
    existing_order.textContent = choiceData.existingOrderSummary || 'Existing Order';
    
    const buttonGroup = document.createElement('div');
    buttonGroup.style.cssText = 'display: flex; gap: 8px;';
    
    const addBtn = document.createElement('button');
    addBtn.textContent = '✅ Add to Existing';
    addBtn.style.cssText = `
        flex: 1;
        padding: 10px;
        border: none;
        border-radius: 6px;
        background: #4CAF50;
        color: white;
        font-weight: bold;
        cursor: pointer;
        font-size: 13px;
    `;
    addBtn.onclick = () => {
        console.log('User chose: add to existing');
        dialog.remove();
        sendOrderChoice('add_to_existing', choiceData.existingOrderID, orderData, name, phone);
    };
    
    const newBtn = document.createElement('button');
    newBtn.textContent = '🆕 New Order';
    newBtn.style.cssText = `
        flex: 1;
        padding: 10px;
        border: none;
        border-radius: 6px;
        background: #2196F3;
        color: white;
        font-weight: bold;
        cursor: pointer;
        font-size: 13px;
    `;
    newBtn.onclick = () => {
        console.log('User chose: new order');
        dialog.remove();
        sendOrderChoice('new_order', null, orderData, name, phone);
    };
    
    buttonGroup.appendChild(addBtn);
    buttonGroup.appendChild(newBtn);
    
    content.appendChild(title);
    content.appendChild(msg);
    content.appendChild(existing_order);
    content.appendChild(buttonGroup);
    dialog.appendChild(content);
    
    document.body.appendChild(dialog);
    console.log('✅ Dialog appended to body');
}

function sendOrderChoice(choice, existingOrderID, originalOrderData, name, phone) {
    console.log('📤 Sending order choice:', choice);
    
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('user_id') || 'guest';
    
    const choiceRequest = {
        choice: choice,
        order_id: existingOrderID || 0,
        items: originalOrderData.items,
        customer_name: name,
        delivery_type: originalOrderData.delivery_type,
        address: originalOrderData.address,
        user_id: userId  // Include user_id for fallback authentication
    };
    
    // Get token from URL if it exists
    const tok = urlParams.get('t') || '';
    const tokenParam = tok ? `?t=${encodeURIComponent(tok)}` : '';
    
    // Use relative URL so it works with both localhost and ngrok
    const apiUrl = `/api/chat/orders/choice${tokenParam}`;
    
    fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(choiceRequest)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            completeOrderSubmission(data, phone);
        } else {
            alert('❌ Error: ' + (data.message || 'Failed to process order'));
        }
    })
    .catch(err => {
        console.error('❌ Error:', err);
        alert('❌ Network error. Check console.');
    });
}

function completeOrderSubmission(data, phone) {
    const orderId = data.orderID || data.order_id;
    const orderMsg = data.action === 'items_merged' 
        ? `Items added to order #${orderId}!`
        : `Order #${orderId} placed successfully!`;
    
    showToast(orderMsg, 'success');

    // Store invoice data in localStorage for the receipt page
    try {
        const invoiceKey = `bf_invoice_${orderId}`;
        const dlvType = data.delivery_type || '';
        const payMethod = (window.__preferredPayMethod === 'scan') ? 'scan' : 'cash';
        const invoiceData = {
            order_id: orderId,
            created_at: new Date().toISOString(),
            customer_name: data.customer_name || '',
            customer_phone: phone || '',
            address: dlvType === 'pickup' ? 'Pickup at store' : (data.address || ''),
            delivery_type: dlvType === 'pickup' ? 'Pick Up' : 'Delivery',
            payment_status: payMethod === 'scan' ? 'Scan to pay' : 'Pay by cash',
            subtotal: data.subtotal ?? null,
            discount: data.discount ?? null,
            delivery_fee: data.delivery_fee ?? null,
            total: data.total ?? data.total_amount ?? null,
            promotions: [],
            items: [] // Items already on the order will be fetched by the receipt page
        };
        localStorage.setItem(invoiceKey, JSON.stringify(invoiceData));
    } catch (e) {
        console.log('Failed to store invoice', e);
    }

    const payParam = (window.__preferredPayMethod === 'scan') ? 'scan' : 'cash';
    window.location.href = `/order/${orderId}?pay=${encodeURIComponent(payParam)}`;
}

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
