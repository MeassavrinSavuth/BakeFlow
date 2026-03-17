/**
 * BakeFlow - Delivery Form Module
 * Address, location, and delivery management
 */

let deliveryType = null;
let geo = null;
let map = null;
let marker = null;
let phoneInputInitialized = false;

// ========== Delivery Form ==========
function openDeliveryForm() {
    document.querySelectorAll('.section').forEach(s => {
        if (!s.classList.contains('delivery-form')) {
            s.style.display = 'none';
        }
    });
    document.getElementById('savedPlacesBar').style.display = 'none';
    document.getElementById('recurringList').style.display = 'none';
    
    document.getElementById('deliveryForm').classList.add('active');
    document.getElementById('cartBar').style.display = 'none';
    document.getElementById('orderBar').style.display = 'block';

    // Update button text for pending custom cake orders
    const placeBtn = document.getElementById('placeOrderBtn');
    if (placeBtn && window.__pendingPreorder) {
        placeBtn.innerHTML = '<i data-lucide="check-circle"></i><span>Place Custom Cake Order</span>';
    } else if (placeBtn) {
        placeBtn.innerHTML = '<i data-lucide="check-circle"></i><span>Place Order</span>';
    }

    // Clear any stale error banners (e.g. "cart is empty" from regular flow)
    const errBanner = document.getElementById('errorBanner');
    if (errBanner) errBanner.style.display = 'none';

    adjustSafePadding();
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    if (window.ensurePaymentMethodDefault) window.ensurePaymentMethodDefault();
    updatePhoneUi();
}

function backToCart() {
    document.getElementById('deliveryForm').classList.remove('active');
    document.querySelectorAll('.section').forEach(s => s.style.display = '');
    document.getElementById('cartBar').style.display = 'block';
    document.getElementById('orderBar').style.display = 'none';
    window.__pendingPreorder = null; // clear pending custom cake if user goes back
    renderSavedOrders();
    renderPlacesBar();
    renderRecurringOrders();
    adjustSafePadding();
}

function selectDeliveryType(type) {
    deliveryType = type;
    document.querySelectorAll('.radio-option').forEach(opt => {
        opt.classList.remove('selected');
        opt.setAttribute('aria-checked', 'false');
    });
    const sel = document.querySelector(`[data-type="${type}"]`);
    sel.classList.add('selected');
    sel.setAttribute('aria-checked', 'true');
    
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
    if (!navigator.geolocation) { 
        showError('Location is not available on this device'); 
        return; 
    }
    
    try {
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { 
                enableHighAccuracy: true, 
                timeout: 10000, 
                maximumAge: 0 
            });
        });
        const { latitude: lat, longitude: lon } = pos.coords;
        const address = await reverseGeocode(lat, lon);
        document.getElementById('customerAddress').value = address;
        selectDeliveryType('delivery');
        document.getElementById('addressGroup').style.display = 'block';
        geo = { lat, lon, address };
        showMap(lat, lon);
        activateTab('map');
        showToast('Location found', 'success');
    } catch(e) {
        showError('Unable to get location. Check permissions.');
    }
}

async function reverseGeocode(lat, lon) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const j = await res.json();
    return j.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

async function findOnMap() {
    const q = document.getElementById('customerAddress').value.trim();
    if (!q) { 
        showError('Enter an address to find on map'); 
        return; 
    }
    
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        const list = await res.json();
        if (!list || !list.length) { 
            showError('Address not found'); 
            return; 
        }
        const { lat, lon, display_name } = list[0];
        const latNum = parseFloat(lat), lonNum = parseFloat(lon);
        document.getElementById('customerAddress').value = display_name;
        geo = { lat: latNum, lon: lonNum, address: display_name };
        selectDeliveryType('delivery');
        document.getElementById('addressGroup').style.display = 'block';
        showMap(latNum, lonNum);
        activateTab('map');
    } catch(e) { 
        showError('Search failed. Try again.'); 
    }
}

function showMap(lat, lon) {
    const el = document.getElementById('map');
    if (!el || !window.L) return;
    
    if (!map) {
        map = L.map('map', { zoomControl: false }).setView([lat, lon], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
            attribution: '© OpenStreetMap' 
        }).addTo(map);
        marker = L.marker([lat, lon], { draggable: true }).addTo(map);
        marker.on('dragend', async () => {
            const p = marker.getLatLng();
            const address = await reverseGeocode(p.lat, p.lng);
            document.getElementById('customerAddress').value = address;
            geo = { lat: p.lat, lon: p.lng, address };
        });
    } else {
        map.setView([lat, lon], 16);
        if (marker) { 
            marker.setLatLng([lat, lon]); 
        } else { 
            marker = L.marker([lat, lon], { draggable: true }).addTo(map); 
        }
    }
}

function activateTab(which) {
    const tabMap = document.getElementById('tabMap');
    const tabDir = document.getElementById('tabDirections');
    const mapEl = document.getElementById('map');
    const dirEl = document.getElementById('deliveryDirections');
    if (!tabMap || !tabDir || !mapEl || !dirEl) return;
    
    if (which === 'map') {
        tabMap.classList.add('active'); 
        tabDir.classList.remove('active');
        mapEl.style.display = 'block'; 
        dirEl.style.display = 'none';
        if (map) setTimeout(() => map.invalidateSize(), 100);
    } else {
        tabDir.classList.add('active'); 
        tabMap.classList.remove('active');
        mapEl.style.display = 'none'; 
        dirEl.style.display = 'block';
    }
}

function setupMapTabs() {
    initPhoneInput();
    const hasLeaflet = !!window.L;
    activateTab(hasLeaflet ? 'map' : 'dir');
    
    const tabMap = document.getElementById('tabMap');
    const tabDir = document.getElementById('tabDirections');
    if (tabMap) tabMap.addEventListener('click', () => activateTab('map'));
    if (tabDir) tabDir.addEventListener('click', () => activateTab('dir'));
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

function updatePhoneUi() {
    const phoneEl = document.getElementById('customerPhone');
    const errEl = document.getElementById('customerPhoneError');
    const placeBtn = document.getElementById('placeOrderBtn');
    if (!phoneEl || !placeBtn) return;

    const raw = phoneEl.value || '';
    const normalized = normalizeMyanmarPhoneE164(raw);
    const isValid = !!normalized;

    placeBtn.disabled = !isValid;

    if (errEl) {
        if (raw.trim() && !isValid) {
            errEl.textContent = 'Enter 09xxxxxxxxx or +959xxxxxxxxx';
            errEl.style.display = 'block';
        } else {
            errEl.textContent = '';
            errEl.style.display = 'none';
        }
    }

    if (raw.trim() && !isValid) {
        phoneEl.classList.add('invalid');
    } else {
        phoneEl.classList.remove('invalid');
    }
}

function initPhoneInput() {
    if (phoneInputInitialized) return;
    phoneInputInitialized = true;
    const phoneEl = document.getElementById('customerPhone');
    if (!phoneEl) return;
    phoneEl.setAttribute('inputmode', 'numeric');
    phoneEl.addEventListener('input', () => {
        phoneEl.value = sanitizeMyanmarPhoneInput(phoneEl.value);
        updatePhoneUi();
    });
    phoneEl.addEventListener('blur', () => {
        const normalized = normalizeMyanmarPhoneE164(phoneEl.value);
        if (normalized) {
            phoneEl.value = normalized;
        }
        updatePhoneUi();
    });
    updatePhoneUi();
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
    b.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = msg;
    b.appendChild(text);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'error-banner-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.innerHTML = '\u2715';
    closeBtn.onclick = () => { b.style.display = 'none'; };
    b.appendChild(closeBtn);
    b.style.display = 'block';
    clearTimeout(window._errorBannerTimer);
    window._errorBannerTimer = setTimeout(() => { b.style.display = 'none'; }, 8000);
}

function getDeliveryType() { return deliveryType; }
function getGeo() { return geo; }

// Export
window.openDeliveryForm = openDeliveryForm;
window.backToCart = backToCart;
window.selectDeliveryType = selectDeliveryType;
window.useMyLocation = useMyLocation;
window.findOnMap = findOnMap;
window.appendNote = appendNote;
window.showError = showError;
window.setupMapTabs = setupMapTabs;
window.getDeliveryType = getDeliveryType;
window.getGeo = getGeo;
