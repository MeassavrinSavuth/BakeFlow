/**
 * BakeFlow - Products Module
 * Product loading and rendering with GrabFood/Uber Eats style UX
 */

window.products = [];
window.stockStatus = {}; // Real-time stock status cache
window.productFilters = {
    search: '',
    category: 'all',
    tag: 'all',
    subTag: 'all'
};
window.productsLoadError = '';

// Remaining stock helper (per-user, subtracts items already in cart)
function getRemainingStockForProduct(productId, opts = {}) {
    const product = window.products?.find(p => p.id == productId);
    if (!product) return null;

    const stockInfo = window.stockStatus && window.stockStatus[product.id];
    let available = null;
    if (stockInfo && Number.isFinite(stockInfo.available_stock)) {
        available = stockInfo.available_stock;
    } else if (Number.isFinite(product.stock)) {
        available = product.stock;
    }
    if (!Number.isFinite(available)) return null;

    // Subtract what's already in the cart; when editing a cart item we can exclude its qty
    const cartObj = (typeof window.getCart === 'function') ? window.getCart() : {};
    let inCart = Number(cartObj[product.id] || 0);
    if (opts.excludeCartItemId && typeof window.getCartItem === 'function') {
        const editingItem = window.getCartItem(opts.excludeCartItemId);
        if (editingItem && editingItem.productId == product.id) {
            inCart = Math.max(0, inCart - Number(editingItem.qty || 0));
        }
    }

    const remaining = available - inCart;
    return remaining < 0 ? 0 : remaining;
}
window.getRemainingStockForProduct = getRemainingStockForProduct;

// Category definitions with icons
const CATEGORIES = [
    { id: 'all', name: 'All', icon: 'grid-2x2' },
    { id: 'cakes', name: 'Cakes', icon: 'cake' },
    { id: 'pastries', name: 'Pastries', icon: 'croissant' },
    { id: 'bread', name: 'Bread', icon: 'sandwich' },
    { id: 'drinks', name: 'Drinks', icon: 'coffee' },
    { id: 'other', name: 'Other', icon: 'cookie' }
];

// Map product names to categories (basic heuristic)
function getCategoryForProduct(product) {
    const name = (product.name || '').toLowerCase();
    const desc = (product.description || '').toLowerCase();
    const combined = name + ' ' + desc;
    
    if (combined.includes('cake') || combined.includes('cheesecake') || combined.includes('tiramisu')) {
        return 'cakes';
    }
    if (combined.includes('pastry') || combined.includes('croissant') || combined.includes('danish') || 
        combined.includes('muffin') || combined.includes('donut') || combined.includes('éclair') ||
        combined.includes('tart') || combined.includes('pie')) {
        return 'pastries';
    }
    if (combined.includes('bread') || combined.includes('baguette') || combined.includes('loaf') ||
        combined.includes('roll') || combined.includes('sourdough')) {
        return 'bread';
    }
    if (combined.includes('coffee') || combined.includes('latte') || combined.includes('tea') ||
        combined.includes('drink') || combined.includes('juice') || combined.includes('smoothie')) {
        return 'drinks';
    }
    return 'other';
}

// Get product rating - now uses real data from API
function getProductRating(product) {
    // Real ratings come from API (avg_rating, rating_count)
    const rating = product.avg_rating || 0;
    const reviews = product.rating_count || 0;
    return { rating: Math.min(rating, 5.0), reviews };
}

/**
 * Fetch real-time stock status for products
 */
async function fetchStockStatus(productIds) {
    if (!productIds || productIds.length === 0) return;
    
    try {
        const res = await fetch('/api/stock/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_ids: productIds })
        });
        const data = await res.json();
        
        if (data.products) {
            data.products.forEach(p => {
                window.stockStatus[p.product_id] = p;
            });
        }
    } catch (e) {
        console.log('Failed to fetch stock status', e);
    }
}

async function loadProducts() {
    window.productsLoadError = '';
    // Show skeleton loaders while fetching
    const productsEl = document.getElementById('products');
    if (productsEl) {
        productsEl.innerHTML = Array.from({ length: 4 }, () => `
            <div class="product-skeleton">
                <div class="skeleton-thumb"></div>
                <div class="skeleton-info">
                    <div class="skeleton-line short"></div>
                    <div class="skeleton-line"></div>
                    <div class="skeleton-line shorter"></div>
                </div>
                <div class="skeleton-price"></div>
            </div>
        `).join('');
    }
    try {
        const res = await fetch('/api/products?limit=50&sort_by=created_at&sort_dir=DESC&status=active');
        if (!res.ok) {
            throw new Error(`Failed to load products (${res.status})`);
        }
        const data = await res.json();
        const list = Array.isArray(data.products) ? data.products : [];
        window.products = list.map(p => {
            const product = {
                id: p.id,
                name: p.name,
                emoji: '',
                price: Number(p.price) || 0,
                created_at: p.created_at,
                image_url: p.image_url || '',
                description: p.description || '',
                availability_status: p.availability_status || 'available',
                stock: Number.isFinite(p.stock) ? p.stock : null,
                has_customization: true,
                tags: Array.isArray(p.tags) ? p.tags : [],
                avg_rating: p.avg_rating || 0,
                rating_count: p.rating_count || 0
            };
            // Add category and rating
            product.category = getCategoryForProduct(product);
            const ratingData = getProductRating(product);
            product.rating = ratingData.rating;
            product.reviewCount = ratingData.reviews;
            return product;
        });
        window.products.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        // Fetch real-time stock status for all products
        const productIds = window.products.map(p => p.id);
        await fetchStockStatus(productIds);
        
    } catch (e) {
        console.log('❌ Failed to load products', e);
        window.products = [];
        window.productsLoadError = 'Unable to load the menu right now. Please try again.';
        if (typeof showError === 'function') {
            showError(window.productsLoadError);
        }
    }
    return window.products;
}

function getSelectedPreorderOption(name) {
    const selected = document.querySelector(`input[name="${name}"]:checked`);
    return selected ? String(selected.value || '').trim() : '';
}

function syncPreorderOptionChips(name) {
    document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
        const chip = input.closest('.preorder-option-chip');
        if (!chip) return;
        chip.classList.toggle('selected', !!input.checked);
    });
}

const fallbackPreorderOptions = {
    sizes: ['6 inch', '8 inch', '10 inch'],
    layers: ['1 layer', '2 layers', '3 layers'],
    creams: ['Buttercream', 'Fresh cream', 'Cream cheese', 'Chocolate ganache']
};

function renderPreorderOptionChips(containerId, name, values) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const prev = getSelectedPreorderOption(name);
    const list = Array.isArray(values) ? values : [];
    container.innerHTML = '';
    list.forEach((value) => {
        const label = document.createElement('label');
        label.className = name === 'preorderCream'
            ? 'preorder-option-chip preorder-option-chip--nowrap'
            : 'preorder-option-chip';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = value;
        if (prev && prev === value) input.checked = true;
        input.addEventListener('change', () => {
            syncPreorderOptionChips(name);
            updatePreorderPriceSummary();
        });
        label.appendChild(input);
        const span = document.createElement('span');
        span.textContent = value.replace(' inch', '"');
        label.appendChild(span);
        container.appendChild(label);
    });
    syncPreorderOptionChips(name);
}

function getTodayDateKey() {
    const d = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
}

function getPreorderPeriodText(settings) {
    const start = settings?.start_date || '';
    const end = settings?.end_date || '';
    if (start && end) return `Available ${formatDateShort(start)} – ${formatDateShort(end)}`;
    if (start) return `Available from ${formatDateShort(start)}`;
    if (end) return `Available until ${formatDateShort(end)}`;
    return 'Available now';
}
window.getPreorderPeriodText = getPreorderPeriodText;

function isPreorderWindowEnded(settings) {
    const end = settings?.end_date || '';
    if (!end) return false;
    return end < getTodayDateKey();
}

function isPreorderWindowActive(settings) {
    if (!settings) return true;
    const today = getTodayDateKey();
    const start = settings.start_date || '';
    const end = settings.end_date || '';
    if (start && today < start) return false;
    if (end && today > end) return false;
    return true;
}

function applyPreorderDateRange(settings) {
    const dateEl = document.getElementById('preorderDate');
    if (!dateEl) return;
    const start = settings?.start_date || '';
    const end = settings?.end_date || '';
    const today = getTodayDateKey();
    // Preorders must be for a future date (at least tomorrow)
    const tomorrow = (() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        const pad = (v) => String(v).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })();
    // Minimum date: the later of tomorrow or the admin start_date
    const effectiveMin = start && start > tomorrow ? start : tomorrow;
    dateEl.setAttribute('min', effectiveMin);
    // If admin set an end_date, cap there; otherwise remove the max entirely
    if (end && end >= effectiveMin) {
        dateEl.setAttribute('max', end);
    } else {
        dateEl.removeAttribute('max');
    }
    if (isPreorderWindowEnded(settings)) {
        dateEl.value = '';
        return;
    }
    if (!dateEl.value || dateEl.value < effectiveMin || (end && end >= effectiveMin && dateEl.value > end)) {
        dateEl.value = effectiveMin;
    }
}

function updatePreorderOptionsUI(settings, fallback) {
    const opts = settings || {};
    const ended = isPreorderWindowEnded(opts);
    const sizes = Array.isArray(opts.sizes) && opts.sizes.length ? opts.sizes : (fallback?.sizes || []);
    const layers = Array.isArray(opts.layers) && opts.layers.length ? opts.layers : (fallback?.layers || []);
    const creams = Array.isArray(opts.creams) && opts.creams.length ? opts.creams : (fallback?.creams || []);
    renderPreorderOptionChips('preorderSizeOptions', 'preorderSize', sizes);
    renderPreorderOptionChips('preorderLayerOptions', 'preorderLayer', layers);
    renderPreorderOptionChips('preorderCreamOptions', 'preorderCream', creams);
    applyPreorderDateRange(opts);
    window.currentPreorderSettings = { ...opts, enabled: opts.enabled !== false && !ended };
    updatePreorderPriceSummary();
    const noticeEl = document.getElementById('customCakeNoticeText');
    if (noticeEl) {
        const periodText = getPreorderPeriodText(opts);
        noticeEl.innerHTML = `Order window: <strong>${periodText}</strong>. Choose your options below.`;
    }
}

async function updatePreorderOptionsForProduct(productId) {
    if (!productId) {
        updatePreorderOptionsUI({}, fallbackPreorderOptions);
        return;
    }
    if (!window.preorderProductSettingsCache) {
        window.preorderProductSettingsCache = {};
    }
    if (window.preorderProductSettingsCache[productId]) {
        updatePreorderOptionsUI(window.preorderProductSettingsCache[productId], fallbackPreorderOptions);
        return;
    }
    try {
        const baseUrl = window.location.origin || '';
        const res = await fetch(`${baseUrl}/api/preorder-products/${productId}/settings`);
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        window.preorderProductSettingsCache[productId] = data || {};
        updatePreorderOptionsUI(data || {}, fallbackPreorderOptions);
    } catch (e) {
        updatePreorderOptionsUI({}, fallbackPreorderOptions);
    }
}

async function filterPreorderProductsByDate(products) {
    const list = Array.isArray(products) ? products : [];
    if (!list.length) return list;
    if (!window.preorderProductSettingsCache) {
        window.preorderProductSettingsCache = {};
    }
    const baseUrl = window.location.origin || '';
    const settingsList = await Promise.all(list.map(async (product) => {
        const id = product?.id;
        if (!id) return null;
        if (window.preorderProductSettingsCache[id]) {
            return window.preorderProductSettingsCache[id];
        }
        try {
            const res = await fetch(`${baseUrl}/api/preorder-products/${id}/settings`);
            if (!res.ok) return null;
            const data = await res.json();
            window.preorderProductSettingsCache[id] = data || {};
            return data || {};
        } catch (e) {
            return null;
        }
    }));
    return list.filter((product, idx) => {
        const settings = settingsList[idx];
        return isPreorderWindowActive(settings);
    });
}

function getSelectedPreorderProduct(products) {
    const list = Array.isArray(products) ? products : (window.preorderSettings?.products || []);
    const selectedId = window.selectedPreorderProductId;
    if (!selectedId) return null;
    return list.find((p) => String(p.id) === String(selectedId)) || null;
}

function updatePreorderProductSelection() {
    const listEl = document.getElementById('preorderProductList');
    if (!listEl) return;
    const selectedId = window.selectedPreorderProductId;
    listEl.querySelectorAll('.preorder-product-card').forEach((card) => {
        const cardId = card.dataset.productId;
        const isSelected = !!selectedId && String(cardId) === String(selectedId);
        card.classList.toggle('selected', isSelected);
        card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
}

function selectPreorderProduct(productId) {
    if (!productId) return;
    window.selectedPreorderProductId = productId;
    updatePreorderProductSelection();
    updatePreorderOptionsForProduct(productId);
    updatePreorderPriceSummary();
}

function formatPendingSchedule(sched) {
    if (!sched || !sched.date || !sched.time) return 'Not selected';
    const when = new Date(`${sched.date}T${sched.time}:00`);
    if (Number.isNaN(when.getTime())) return `${sched.date} ${sched.time}`;
    return when.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function refreshPreorderScheduleDisplay() {
    const dateEl = document.getElementById('preorderDate');
    const timeEl = document.getElementById('preorderTime');
    if (!dateEl) return;
    const sched = window.getPendingSchedule ? window.getPendingSchedule() : null;
    if (sched && sched.date) dateEl.value = sched.date;
    if (sched && sched.time && timeEl) timeEl.value = sched.time;
}

// ─── Custom Cake Cart (multi-cake support) ──────────────────
window.customCakeCart = [];

function addCakeToCart() {
    const size = getSelectedPreorderOption('preorderSize');
    const layers = getSelectedPreorderOption('preorderLayer');
    const cream = getSelectedPreorderOption('preorderCream');
    const message = (document.getElementById('preorderMessage')?.value || '').trim();
    const notes = (document.getElementById('preorderNotes')?.value || '').trim();
    const product = getSelectedPreorderProduct();

    if (!product) { window.showToast && window.showToast('Pick a cake first'); return; }
    if (!size) { window.showToast && window.showToast('Pick a size'); return; }
    if (!layers) { window.showToast && window.showToast('Pick layers'); return; }
    if (!cream) { window.showToast && window.showToast('Pick a cream type'); return; }

    const priceData = getPreorderPriceData();

    window.customCakeCart.push({
        id: Date.now(),
        product, size, layers, cream, message, notes,
        price: priceData.total,
        sizeExtra: priceData.sizeExtra,
        layerExtra: priceData.layerExtra,
        creamExtra: priceData.creamExtra,
    });

    // Reset form for next cake
    const msgEl = document.getElementById('preorderMessage');
    if (msgEl) msgEl.value = '';
    const notesEl = document.getElementById('preorderNotes');
    if (notesEl) notesEl.value = '';
    document.querySelectorAll('input[name="preorderSize"]').forEach(r => r.checked = false);
    document.querySelectorAll('input[name="preorderLayer"]').forEach(r => r.checked = false);
    document.querySelectorAll('input[name="preorderCream"]').forEach(r => r.checked = false);
    syncPreorderOptionChips('preorderSize');
    syncPreorderOptionChips('preorderLayer');
    syncPreorderOptionChips('preorderCream');
    updatePreorderPriceSummary();

    renderCustomCakeCart();
    window.showToast && window.showToast(`${product.name} added!`, 'success');
}

function removeCakeFromCart(cakeId) {
    window.customCakeCart = window.customCakeCart.filter(c => c.id !== cakeId);
    renderCustomCakeCart();
}

function getCustomCakeCartTotal() {
    return window.customCakeCart.reduce((sum, c) => sum + (c.price || 0), 0);
}

function renderCustomCakeCart() {
    const section = document.getElementById('customCakeCartSection');
    const scheduleSection = document.getElementById('customCakeScheduleSection');
    const submitBtn = document.getElementById('preorderSubmitBtn');
    const listEl = document.getElementById('customCakeCartList');
    const countEl = document.getElementById('customCakeCartCount');
    const totalEl = document.getElementById('customCakeCartTotal');
    const addBtnText = document.getElementById('preorderAddCakeText');
    const cart = window.customCakeCart;

    if (!section || !listEl) return;

    // Update "Add" button label based on cart state
    if (addBtnText) {
        addBtnText.textContent = cart.length > 0 ? '+ Add another cake' : 'Add to cart';
    }

    if (cart.length === 0) {
        section.style.display = 'none';
        if (scheduleSection) scheduleSection.style.display = 'none';
        if (submitBtn) submitBtn.style.display = 'none';
        return;
    }

    section.style.display = '';
    if (scheduleSection) scheduleSection.style.display = '';
    if (submitBtn) submitBtn.style.display = '';
    if (countEl) countEl.textContent = `${cart.length} cake${cart.length > 1 ? 's' : ''}`;
    if (totalEl) totalEl.textContent = `Ks ${getCustomCakeCartTotal().toFixed(2)}`;

    const submitText = document.getElementById('preorderSubmitText');
    if (submitText) {
        submitText.textContent = `Order ${cart.length} Cake${cart.length > 1 ? 's' : ''} — Ks ${getCustomCakeCartTotal().toFixed(2)}`;
    }

    listEl.innerHTML = '';
    cart.forEach(cake => {
        const card = document.createElement('div');
        card.className = 'preorder-cart-card';

        const img = document.createElement('img');
        img.className = 'preorder-cart-card-img';
        img.src = cake.product?.image_url || 'https://images.unsplash.com/photo-1603532648955-039310d9ed75?w=80&h=80&fit=crop';
        img.alt = cake.product?.name || 'Cake';

        const info = document.createElement('div');
        info.className = 'preorder-cart-card-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'preorder-cart-card-name';
        nameEl.textContent = `${cake.product?.name || 'Custom Cake'} — ${cake.size}`;
        const metaEl = document.createElement('div');
        metaEl.className = 'preorder-cart-card-meta';
        metaEl.textContent = `${cake.layers} · ${cake.cream}`;
        info.appendChild(nameEl);
        info.appendChild(metaEl);

        const priceEl = document.createElement('div');
        priceEl.className = 'preorder-cart-card-price';
        priceEl.textContent = `Ks ${cake.price.toFixed(2)}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'preorder-cart-card-remove';
        removeBtn.innerHTML = '&#x2715;';
        removeBtn.title = 'Remove';
        removeBtn.onclick = () => removeCakeFromCart(cake.id);

        card.appendChild(img);
        card.appendChild(info);
        card.appendChild(priceEl);
        card.appendChild(removeBtn);
        listEl.appendChild(card);
    });
}

function openPreorderSheet() {
    if (typeof openSheet === 'function') {
        openSheet('preorderSheet');
    }
    syncPreorderOptionChips('preorderSize');
    syncPreorderOptionChips('preorderLayer');
    syncPreorderOptionChips('preorderCream');
    refreshPreorderScheduleDisplay();
    updatePreorderOptionsForProduct(window.selectedPreorderProductId);
    updatePreorderPriceSummary();
    renderCustomCakeCart();

    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

function formatPreorderPrice(value) {
    const num = Number(value || 0);
    return `Ks ${num.toFixed(2)}`;
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

function formatPreorderOptionLabel(label, value) {
    if (!value) return `${label} (—)`;
    const display = String(value).replace(' inch', '"');
    return `${label} (${display})`;
}

function getPreorderPriceData() {
    const product = getSelectedPreorderProduct();
    const basePrice = Number(product?.price) || 0;
    const size = getSelectedPreorderOption('preorderSize');
    const layers = getSelectedPreorderOption('preorderLayer');
    const cream = getSelectedPreorderOption('preorderCream');
    const settings = window.currentPreorderSettings || {};
    const sizeExtra = resolvePreorderOptionPrice(settings, 'size_prices', size);
    const layerExtra = resolvePreorderOptionPrice(settings, 'layer_prices', layers);
    const creamExtra = resolvePreorderOptionPrice(settings, 'cream_prices', cream);
    const total = basePrice + sizeExtra + layerExtra + creamExtra;
    return {
        product,
        basePrice,
        size,
        layers,
        cream,
        sizeExtra,
        layerExtra,
        creamExtra,
        total
    };
}

function updatePreorderPriceSummary() {
    const data = getPreorderPriceData();
    const addBtnText = document.getElementById('preorderAddCakeText');
    const cart = window.customCakeCart || [];
    const total = Number.isFinite(data.total) ? data.total : 0;
    if (addBtnText) {
        const label = cart.length > 0 ? '+ Add another cake' : 'Add to cart';
        addBtnText.textContent = total > 0 ? `${label} — ${formatPreorderPrice(total)}` : label;
    }
}

window.updatePreorderPriceSummary = updatePreorderPriceSummary;

function updatePreorderAdCopy(products) {
    const titleEl = document.getElementById('preorderAdTitle');
    const subtitleEl = document.getElementById('preorderAdSubtitle');
    if (!subtitleEl) return;
    const count = Array.isArray(products) ? products.length : 0;
    if (count > 0) {
        subtitleEl.textContent = `${count} cakes available · Customize & order`;
        if (titleEl) titleEl.textContent = '🎂 Custom Cakes';
        return;
    }
    subtitleEl.textContent = 'Design your cake · Made to order';
    if (titleEl) titleEl.textContent = '🎂 Custom Cakes';
}

function renderPreorderProductList(products) {
    const listEl = document.getElementById('preorderProductList');
    if (!listEl) return;
    const countEl = document.getElementById('preorderProductCount');
    const list = Array.isArray(products) ? products : [];
    if (countEl) countEl.textContent = list.length ? `${list.length} items` : '';
    listEl.innerHTML = '';
    if (window.selectedPreorderProductId && !list.some((p) => String(p.id) === String(window.selectedPreorderProductId))) {
        window.selectedPreorderProductId = null;
    }
    if (!window.selectedPreorderProductId && list.length) {
        window.selectedPreorderProductId = list[0].id;
    }
    if (!list.length) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'preorder-product-empty';
        emptyEl.textContent = 'No custom cakes available yet';
        listEl.appendChild(emptyEl);
        return;
    }
    list.forEach((product) => {
        const card = document.createElement('div');
        card.className = 'preorder-product-card';
        card.dataset.productId = String(product.id || '');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        const img = document.createElement('img');
        img.className = 'preorder-product-thumb';
        img.alt = product.name || 'Cake';
        img.loading = 'lazy';
        img.src = product.image_url || 'https://images.unsplash.com/photo-1603532648955-039310d9ed75?w=220&h=220&fit=crop';
        const info = document.createElement('div');
        info.className = 'preorder-product-info';
        const name = document.createElement('div');
        name.className = 'preorder-product-name';
        name.textContent = product.name || 'Cake';
        const meta = document.createElement('div');
        meta.className = 'preorder-product-meta';
        meta.textContent = product.category || '';
        info.appendChild(name);
        info.appendChild(meta);
        const price = document.createElement('div');
        price.className = 'preorder-product-price';
        price.textContent = formatPreorderPrice(product.price);
        card.appendChild(img);
        card.appendChild(info);
        card.appendChild(price);
        card.addEventListener('click', () => {
            selectPreorderProduct(product.id);
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectPreorderProduct(product.id);
            }
        });
        listEl.appendChild(card);
    });
    updatePreorderProductSelection();
    updatePreorderOptionsForProduct(window.selectedPreorderProductId);
}

async function loadPreorderSettings(ad, isHidden) {
    try {
        const baseUrl = window.location.origin || '';
        const res = await fetch(`${baseUrl}/api/preorder-settings`);
        if (!res.ok) return;
        const data = await res.json();
        const enabled = !!data.enabled;
        let products = Array.isArray(data.products) ? data.products : [];
        const updatedAt = data.updated_at || data.updatedAt || '';
        let hidden = isHidden;
        if (updatedAt) {
            let prev = '';
            try {
                prev = localStorage.getItem('bf_preorder_settings_updated_at') || '';
            } catch (e) {}
            if (String(updatedAt) !== prev) {
                try {
                    localStorage.setItem('bf_preorder_settings_updated_at', String(updatedAt));
                    localStorage.removeItem('bf_hide_preorder_ad');
                } catch (e) {}
                hidden = false;
            }
        }
        products = await filterPreorderProductsByDate(products);
        window.preorderSettings = { enabled, products };
        renderPreorderProductList(products);
        updatePreorderAdCopy(products);
        if (!enabled) {
            ad.style.display = 'none';
            if (typeof window.adjustSafePadding === 'function') window.adjustSafePadding();
            return;
        }
        ad.style.display = hidden ? 'none' : '';
        if (typeof window.adjustSafePadding === 'function') window.adjustSafePadding();
    } catch (e) {}
}

function initPreorderUI() {
    const ad = document.getElementById('preorderAd');
    if (!ad) return;

    let isHidden = false;
    try {
        isHidden = localStorage.getItem('bf_hide_preorder_ad') === '1';
    } catch (e) {}

    ad.style.display = isHidden ? 'none' : '';

    const closeBtn = document.getElementById('preorderAdClose');
    if (closeBtn && closeBtn.dataset.wired !== '1') {
        closeBtn.dataset.wired = '1';
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                localStorage.setItem('bf_hide_preorder_ad', '1');
            } catch (err) {}
            ad.style.display = 'none';
            if (typeof window.adjustSafePadding === 'function') window.adjustSafePadding();
        });
    }

    const openEl = document.getElementById('preorderAdOpen');
    if (openEl && openEl.dataset.wired !== '1') {
        openEl.dataset.wired = '1';
        openEl.addEventListener('click', () => openPreorderSheet());
        openEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') openPreorderSheet();
        });
    }

    const cta = document.getElementById('preorderCustomizeBtn');
    if (cta && cta.dataset.wired !== '1') {
        cta.dataset.wired = '1';
        cta.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openPreorderSheet();
        });
    }

    const cancelBtn = document.getElementById('preorderCancel');
    if (cancelBtn && cancelBtn.dataset.wired !== '1') {
        cancelBtn.dataset.wired = '1';
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.customCakeCart = [];
            if (typeof closeSheets === 'function') closeSheets();
        });
    }

    // "Add Cake" button — adds configured cake to the cart
    const addCakeBtn = document.getElementById('preorderAddCakeBtn');
    if (addCakeBtn && addCakeBtn.dataset.wired !== '1') {
        addCakeBtn.dataset.wired = '1';
        addCakeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            addCakeToCart();
        });
    }

    // "Order Custom Cakes" submit button — validates date/time then sends to delivery form
    const submitBtn = document.getElementById('preorderSubmitBtn');
    if (submitBtn && submitBtn.dataset.wired !== '1') {
        submitBtn.dataset.wired = '1';
        submitBtn.addEventListener('click', async (e) => {
            e.preventDefault();

            if (window.customCakeCart.length === 0) {
                window.showToast && window.showToast('Add at least one cake first');
                return;
            }

            // Read date & time
            const preorderDate = document.getElementById('preorderDate')?.value || '';
            const preorderTime = document.getElementById('preorderTime')?.value || '';
            if (!preorderDate || !preorderTime) {
                window.showToast && window.showToast('Select pick up date & time');
                return;
            }
            const todayKey = getTodayDateKey();
            if (preorderDate <= todayKey) {
                window.showToast && window.showToast('Custom cakes need at least 1 day. Pick a future date.');
                return;
            }
            const [hh] = preorderTime.split(':').map(Number);
            if (hh < 8 || hh >= 20) {
                window.showToast && window.showToast('Pick a time between 8 AM – 8 PM');
                return;
            }

            if (window.currentPreorderSettings && window.currentPreorderSettings.enabled === false) {
                window.showToast && window.showToast('Preorder is unavailable');
                return;
            }
            if (window.currentPreorderSettings && isPreorderWindowEnded(window.currentPreorderSettings)) {
                window.showToast && window.showToast('Preorder window has ended');
                return;
            }
            if (window.currentPreorderSettings) {
                const start = window.currentPreorderSettings.start_date || '';
                const end = window.currentPreorderSettings.end_date || '';
                if ((start && preorderDate < start) || (end && preorderDate > end)) {
                    window.showToast && window.showToast('Pick a date within the available window');
                    return;
                }
            }

            // Save all cakes as pending preorder
            window.__pendingPreorder = {
                cakes: window.customCakeCart.slice(),
                scheduleDate: preorderDate,
                scheduleTime: preorderTime
            };

            window.customCakeCart = [];
            if (typeof closeSheets === 'function') closeSheets();
            if (typeof window.openDeliveryForm === 'function') window.openDeliveryForm();
            window.showToast && window.showToast('Now fill in your delivery details', 'info');
        });
    }
    ['preorderSize', 'preorderLayer', 'preorderCream'].forEach((name) => {
        document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
            if (input.dataset.wired === '1') return;
            input.dataset.wired = '1';
            input.addEventListener('change', () => {
                syncPreorderOptionChips(name);
                updatePreorderPriceSummary();
            });
        });
    });

    const scheduleConfirm = document.getElementById('scheduleConfirm');
    if (scheduleConfirm && scheduleConfirm.dataset.preorderWired !== '1') {
        scheduleConfirm.dataset.preorderWired = '1';
        scheduleConfirm.addEventListener('click', () => {
            setTimeout(() => refreshPreorderScheduleDisplay(), 0);
        });
    }

    refreshPreorderScheduleDisplay();
    syncPreorderOptionChips('preorderSize');
    syncPreorderOptionChips('preorderLayer');
    syncPreorderOptionChips('preorderCream');
    updatePreorderPriceSummary();
    renderPreorderProductList([]);
    updatePreorderAdCopy([]);
    loadPreorderSettings(ad, isHidden);
}

/**
 * Get filtered products based on current search and category
 */
function getFilteredProducts() {
    let filtered = [...window.products];
    
    // Filter out sold out items
    filtered = filtered.filter(p => {
        const stockInfo = window.stockStatus && window.stockStatus[p.id];
        const isOutOfStock = stockInfo ? stockInfo.status === 'out_of_stock' : false;
        const status = p.availability_status || 'available';
        const isSoldOut = status === 'sold_out' || isOutOfStock;
        return !isSoldOut;
    });
    
    // Filter by category
    if (window.productFilters.category && window.productFilters.category !== 'all') {
        filtered = filtered.filter(p => p.category === window.productFilters.category);
    }

    if (window.productFilters.tag && window.productFilters.tag !== 'all') {
        const target = window.productFilters.tag;
        filtered = filtered.filter(p => Array.isArray(p.tags) && p.tags.includes(target));
    }
    
    if (window.productFilters.subTag && window.productFilters.subTag !== 'all') {
        const target = window.productFilters.subTag;
        filtered = filtered.filter(p => Array.isArray(p.tags) && p.tags.includes(target));
    }
    
    // Filter by search
    if (window.productFilters.search) {
        const search = window.productFilters.search.toLowerCase().trim();
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(search) ||
            (p.description && p.description.toLowerCase().includes(search))
        );
    }
    
    return filtered;
}

/**
 * Generate star rating HTML
 */
function renderStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalf = rating % 1 >= 0.5;
    let html = '<div class="p-rating-stars">';
    
    for (let i = 0; i < 5; i++) {
        if (i < fullStars) {
            html += '<svg class="p-rating-star" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
        } else if (i === fullStars && hasHalf) {
            html += '<svg class="p-rating-star" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
        } else {
            html += '<svg class="p-rating-star empty" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
        }
    }
    html += '</div>';
    return html;
}

function normalizeRatingSummary(data) {
    const summary = data && data.summary ? data.summary : data;
    const avg = Number(summary && (summary.avg_rating ?? summary.avgRating) ? (summary.avg_rating ?? summary.avgRating) : 0);
    const count = Number(summary && (summary.rating_count ?? summary.ratingCount) ? (summary.rating_count ?? summary.ratingCount) : 0);
    const safeAvg = Number.isFinite(avg) ? avg : 0;
    const safeCount = Number.isFinite(count) ? count : 0;
    return { avg: Math.max(0, safeAvg), count: Math.max(0, safeCount) };
}

function getReviewCandidates(limit) {
    const list = Array.isArray(window.products) ? window.products : [];
    const withReviews = list
        .map(p => ({
            product: p,
            count: Number(p.reviewCount ?? p.rating_count ?? 0)
        }))
        .filter(p => Number.isFinite(p.count) && p.count > 0)
        .sort((a, b) => b.count - a.count)
        .map(p => p.product);
    return withReviews.slice(0, limit);
}

async function fetchProductReviews(productId) {
    try {
        const res = await fetch(`/api/products/${productId}/ratings`);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function loadLatestReviews() {
    const section = document.getElementById('reviewsSection');
    const summaryEl = document.getElementById('reviewsSummary');
    const listEl = document.getElementById('reviewsList');
    if (!section || !summaryEl || !listEl) return;

    listEl.innerHTML = '<div class="reviews-loading">Loading reviews...</div>';
    summaryEl.innerHTML = '';

    const candidates = getReviewCandidates(6);
    if (!candidates.length) {
        listEl.innerHTML = '<div class="reviews-empty">No reviews yet</div>';
        return;
    }

    const results = await Promise.all(candidates.map(async product => ({
        product,
        data: await fetchProductReviews(product.id)
    })));

    const groups = [];

    results.forEach(({ product, data }) => {
        if (!data) return;
        const summary = normalizeRatingSummary(data);
        const ratings = Array.isArray(data.ratings) ? data.ratings : [];
        if (summary.count === 0 && ratings.length === 0) return;
        const sortedRatings = ratings
            .filter(rating => rating && rating.created_at)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 3);
        groups.push({ product, summary, ratings: sortedRatings });
    });

    if (!groups.length) {
        listEl.innerHTML = '<div class="reviews-empty">No recent reviews yet</div>';
        return;
    }

    listEl.innerHTML = groups.map(({ product, summary, ratings }) => {
        const img = product.image_url && product.image_url.length > 0
            ? product.image_url
            : 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&h=200&fit=crop';
        return `
            <div class="review-group">
                <div class="review-group-header">
                    <img class="review-group-thumb" src="${img}" alt="${escapeHtml(product.name)}" loading="lazy" />
                    <div class="review-group-info">
                        <div class="review-group-name">${escapeHtml(product.name)}</div>
                        <div class="review-group-summary">
                            <div class="review-group-score">${summary.avg.toFixed(1)}</div>
                            <div class="review-group-meta">
                                <div class="review-group-stars">${renderStars(summary.avg)}</div>
                                <div class="review-group-count">${summary.count} review${summary.count === 1 ? '' : 's'}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="review-entry-list">
                    ${ratings.map(rating => {
                        const createdAt = rating.created_at ? new Date(rating.created_at).getTime() : Date.now();
                        const when = window.timeAgo ? window.timeAgo(createdAt) : new Date(createdAt).toLocaleDateString();
                        const comment = rating.comment ? escapeHtml(rating.comment) : 'No written review yet';
                        const emptyClass = rating.comment ? '' : ' review-entry-text--empty';
                        const stars = Number(rating.stars || 0);
                        return `
                            <div class="review-entry">
                                <div class="review-entry-head">
                                    <div class="review-entry-stars">${renderStars(stars)}</div>
                                    <div class="review-entry-time">${when}</div>
                                </div>
                                <div class="review-entry-text${emptyClass}">${comment}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Render category tabs
 */
function renderCategoryTabs() {
    const container = document.getElementById('categoryTabs');
    if (!container) return;
    
    // Count products per category
    const counts = { all: window.products.length };
    CATEGORIES.forEach(cat => {
        if (cat.id !== 'all') {
            counts[cat.id] = window.products.filter(p => p.category === cat.id).length;
        }
    });
    
    // Only show categories that have products
    const visibleCategories = CATEGORIES.filter(cat => counts[cat.id] > 0);
    
    container.innerHTML = visibleCategories.map(cat => `
        <button class="category-tab${window.productFilters.category === cat.id ? ' active' : ''}" 
                data-category="${cat.id}" onclick="handleCategoryClick('${cat.id}')">
            <i data-lucide="${cat.icon}"></i>
            <span>${cat.name}</span>
            ${cat.id !== 'all' ? `<span class="category-tab-count">${counts[cat.id]}</span>` : ''}
        </button>
    `).join('');
    
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    renderTagChips();
}

/**
 * Handle category tab click
 */
function handleCategoryClick(categoryId) {
    window.productFilters.category = categoryId;
    window.productFilters.tag = 'all';
    window.productFilters.subTag = 'all';
    renderCategoryTabs();
    renderTagChips();
    renderProducts();
}

/**
 * Handle search input
 */
function handleSearchInput(value) {
    window.productFilters.search = value;
    renderProducts();
    
    // Toggle clear button visibility
    const clearBtn = document.querySelector('.products-search-clear');
    if (clearBtn) {
        clearBtn.style.display = value ? 'flex' : 'none';
    }
}

/**
 * Clear all filters
 */
function clearFilters() {
    window.productFilters.search = '';
    window.productFilters.category = 'all';
    window.productFilters.tag = 'all';
    window.productFilters.subTag = 'all';
    
    const searchInput = document.getElementById('productSearch');
    if (searchInput) searchInput.value = '';
    
    renderCategoryTabs();
    renderTagChips();
    renderSubTagChips();
    renderProducts();
}

function handleTagClick(tag) {
    window.productFilters.tag = tag;
    window.productFilters.subTag = 'all';
    renderTagChips();
    renderSubTagChips();
    renderProducts();
}

function handleSubTagClick(tag) {
    window.productFilters.subTag = tag;
    renderSubTagChips();
    renderProducts();
}

function formatTagLabel(tag) {
    const words = String(tag || '')
        .replace(/[-_]+/g, ' ')
        .trim()
        .split(/\s+/g)
        .filter(Boolean);
    if (!words.length) return '';
    return words
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function escapeAttr(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getTagsForCurrentCategory() {
    const category = window.productFilters.category;
    const items = category && category !== 'all'
        ? window.products.filter(p => p.category === category)
        : window.products;
    const set = new Set();
    items.forEach(p => {
        if (!Array.isArray(p.tags)) return;
        p.tags.forEach(t => {
            if (typeof t === 'string' && t.trim()) set.add(t.trim());
        });
    });
    return Array.from(set)
        .filter(t => {
            if (!t.includes('-')) return true;
            const parent = t.split('-')[0];
            return !parent || !set.has(parent);
        })
        .sort((a, b) => a.localeCompare(b));
}

function getSubTagsForMainTag(mainTag) {
    if (!mainTag || mainTag === 'all') return [];
    const items = window.products.filter(p => Array.isArray(p.tags) && p.tags.includes(mainTag));
    const prefix = `${mainTag}-`;
    const set = new Set();
    items.forEach(p => {
        p.tags.forEach(t => {
            if (typeof t !== 'string') return;
            const v = t.trim();
            if (!v || v === mainTag) return;
            if (!v.startsWith(prefix) || v.length <= prefix.length) return;
            set.add(v);
        });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function renderTagChips() {
    const el = document.getElementById('productTagChips');
    if (!el) return;

    const tags = getTagsForCurrentCategory();
    if (!tags.length) {
        el.style.display = 'none';
        const sub = document.getElementById('productSubTagChips');
        if (sub) sub.style.display = 'none';
        return;
    }

    el.style.display = 'flex';
    el.innerHTML = [
        `<button type="button" class="tag-chip${window.productFilters.tag === 'all' ? ' selected' : ''}" data-tag="all" onclick="handleTagClick(this.getAttribute('data-tag'))"><i data-lucide="list-filter"></i>All</button>`,
        ...tags.map(t => {
            const label = escapeHtml(formatTagLabel(t) || t);
            const selected = window.productFilters.tag === t ? ' selected' : '';
            return `<button type="button" class="tag-chip${selected}" data-tag="${escapeAttr(t)}" onclick="handleTagClick(this.getAttribute('data-tag'))"><i data-lucide="tag"></i>${label}</button>`;
        })
    ].join('');

    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    renderSubTagChips();
}

function renderSubTagChips() {
    const el = document.getElementById('productSubTagChips');
    if (!el) return;

    const main = window.productFilters.tag;
    const tags = getSubTagsForMainTag(main);
    if (!main || main === 'all' || !tags.length) {
        el.style.display = 'none';
        return;
    }

    el.style.display = 'flex';
    const prefix = `${main}-`;
    const mainLabel = escapeHtml(formatTagLabel(main) || main);
    el.innerHTML = [
        `<button type="button" class="tag-chip${window.productFilters.subTag === 'all' ? ' selected' : ''}" data-tag="all" onclick="handleSubTagClick(this.getAttribute('data-tag'))"><i data-lucide="layers"></i>All ${mainLabel} Types</button>`,
        ...tags.map(t => {
            const child = t.startsWith(prefix) ? t.slice(prefix.length) : t;
            const label = escapeHtml(formatTagLabel(child) || child || t);
            const selected = window.productFilters.subTag === t ? ' selected' : '';
            return `<button type="button" class="tag-chip${selected}" data-tag="${escapeAttr(t)}" onclick="handleSubTagClick(this.getAttribute('data-tag'))"><i data-lucide="tag"></i>${label}</button>`;
        })
    ].join('');

    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

function getBogoPromotionForProduct(productId) {
    const promos = typeof window.getActivePromotions === 'function' ? window.getActivePromotions() : [];
    const applies = typeof window.promotionAppliesToProduct === 'function'
        ? window.promotionAppliesToProduct
        : () => true;

    const applicable = promos
        .filter(p => p && p.type === 'BUY_X_GET_Y' && applies(p, productId))
        .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));

    const pid = Number(productId);
    const promo = applicable.find(p => {
        const buyIds = Array.isArray(p.buyProductIds) ? p.buyProductIds.map(Number).filter(Number.isFinite) : [];
        const getIds = Array.isArray(p.getProductIds) ? p.getProductIds.map(Number).filter(Number.isFinite) : [];
        return buyIds.includes(pid) && getIds.includes(pid);
    });
    if (!promo) return null;

    let rules = {};
    if (typeof window.parsePromotionRules === 'function') {
        rules = window.parsePromotionRules(promo.rules);
    } else if (promo.rules) {
        try {
            rules = typeof promo.rules === 'string' ? (JSON.parse(promo.rules) || {}) : promo.rules;
        } catch {
            rules = {};
        }
    }

    const buyQty = Number(promo.buyQty ?? rules.buyQty) || 0;
    const getQty = Number(promo.getQty ?? rules.getQty) || 0;
    if (!buyQty || !getQty) return null;

    return { id: promo.id, buyQty, getQty };
}

function getCheckoutLineSummaryForProduct(productId) {
    const lines = Array.isArray(window.currentCheckout?.lineItems) ? window.currentCheckout.lineItems : [];
    const pid = Number(productId);
    if (!Number.isFinite(pid) || lines.length === 0) return null;
    let paidQty = 0;
    let freeQty = 0;
    let lineTotal = 0;
    let lineSubtotal = 0;
    for (const li of lines) {
        if (!li || Number(li.productId) !== pid) continue;
        const qty = Number(li.qty || 0);
        const free = Number(li.freeQty || 0);
        let paid = Number(li.paidQty ?? (qty - free));
        if (!Number.isFinite(paid)) paid = 0;
        paidQty += paid;
        freeQty += free;
        const rawSubtotal = li.lineSubtotal ?? (qty * Number(li.unitPrice || 0));
        let subtotal = Number(rawSubtotal);
        if (!Number.isFinite(subtotal)) subtotal = 0;
        const rawTotal = li.lineTotal ?? subtotal;
        let total = Number(rawTotal);
        if (!Number.isFinite(total)) total = 0;
        lineSubtotal += subtotal;
        lineTotal += total;
    }
    if (paidQty === 0 && freeQty === 0) return null;
    return { paidQty, freeQty, lineTotal, lineSubtotal };
}

function renderProducts() {
    const container = document.getElementById('products');
    const countEl = document.getElementById('productsCount');
    const filterInfoEl = document.getElementById('productsFilterInfo');
    
    const filtered = getFilteredProducts();
    const isFiltering = window.productFilters.search
        || window.productFilters.category !== 'all'
        || window.productFilters.tag !== 'all'
        || window.productFilters.subTag !== 'all';
    
    // Update count
    if (countEl) {
        countEl.textContent = `${filtered.length} item${filtered.length !== 1 ? 's' : ''}`;
    }
    
    // Show/hide filter info
    if (filterInfoEl) {
        if (isFiltering && filtered.length > 0) {
            filterInfoEl.style.display = 'flex';
            filterInfoEl.innerHTML = `
                <span>Showing <strong>${filtered.length}</strong> of ${window.products.length} items</span>
                <button class="products-filter-clear" onclick="clearFilters()">Clear filters</button>
            `;
        } else {
            filterInfoEl.style.display = 'none';
        }
    }
    
    // Empty state - no products at all
    if (!window.products.length) {
        const emptyTitle = window.productsLoadError ? 'Menu unavailable' : 'No products yet';
        const emptyDesc = window.productsLoadError ? 'Please check your connection and try again.' : 'Check back soon for fresh treats!';
        container.innerHTML = `
            <div class="products-empty">
                <div class="products-empty-icon">
                    <i data-lucide="cake"></i>
                </div>
                <div class="products-empty-title">${emptyTitle}</div>
                <div class="products-empty-desc">${emptyDesc}</div>
            </div>
        `;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
        return;
    }
    
    // No results state - filtered to nothing
    if (filtered.length === 0) {
        const searchTerm = window.productFilters.search;
        container.innerHTML = `
            <div class="products-no-results">
                <div class="products-no-results-icon">
                    <i data-lucide="search-x"></i>
                </div>
                <div class="products-no-results-title">No items found</div>
                <div class="products-no-results-desc">
                    ${searchTerm ? `We couldn't find anything matching "${escapeHtml(searchTerm)}"` : 'Try a different category'}
                </div>
                <button class="products-no-results-btn" onclick="clearFilters()">
                    <i data-lucide="rotate-ccw"></i>
                    Show all items
                </button>
            </div>
        `;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
        return;
    }
    
    // Render filtered products
    container.innerHTML = filtered.map(p => {
        const img = p.image_url && p.image_url.length > 0 
            ? p.image_url 
            : `https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&h=200&fit=crop`;
        const cart = window.getCart ? window.getCart() : {};
        const inCart = cart[p.id] > 0;
        
        // Check real-time stock status
        const stockInfo = window.stockStatus[p.id];
        const availableStock = stockInfo ? stockInfo.available_stock : p.stock;
        const isOutOfStock = stockInfo ? stockInfo.status === 'out_of_stock' : false;
        const isLowStock = stockInfo ? stockInfo.status === 'low_stock' : false;
        
        // Determine product status (real-time stock takes priority)
        const status = isOutOfStock ? 'sold_out' : (p.availability_status || 'available');
        const isSoldOut = status === 'sold_out' || isOutOfStock;
        const isLimited = status === 'limited' || isLowStock;
        
        // Status badge HTML - prioritize real-time stock info
        let statusBadge = '';
        if (isSoldOut) {
            statusBadge = '<div class="p-status p-status--sold-out"><i data-lucide="x-circle"></i>Sold out</div>';
        } else if (isLowStock && stockInfo) {
            statusBadge = `<div class="p-status p-status--limited"><i data-lucide="alert-circle"></i>Only ${availableStock} left</div>`;
        } else if (isLimited) {
            statusBadge = '<div class="p-status p-status--limited"><i data-lucide="clock"></i>Limited availability</div>';
        }
        
        // Rating HTML
        const ratingHtml = p.rating ? `
            <div class="p-rating">
                ${renderStars(p.rating)}
                <span class="p-rating-value">${p.rating.toFixed(1)}</span>
                <span class="p-rating-count">(${p.reviewCount})</span>
            </div>
        ` : '';

        const promo = !isSoldOut && typeof window.getBestPromotionForProduct === 'function'
            ? window.getBestPromotionForProduct(p.id)
            : null;
        const promoBadge = promo ? promo.badgeText : null;
        const promoBadgeVariant = promo ? promo.badgeVariant : null;
        const promoText = promo ? promo.promoText : null;
        const hasPercentPromo = promo && promo.type === 'PERCENT_OFF' && promo.percent > 0 && promo.percent <= 100;
        const discountedPrice = hasPercentPromo ? (p.price * (1 - (promo.percent / 100))) : null;
        const checkoutSummary = getCheckoutLineSummaryForProduct(p.id);
        const isFreeApplied = promo && promo.type === 'BUY_X_GET_Y'
            && checkoutSummary
            && checkoutSummary.freeQty > 0
            && (checkoutSummary.paidQty === 0 || checkoutSummary.lineTotal === 0);

        const qtyInCart = cart[p.id] || 0;
        const bogoPromo = !isSoldOut ? getBogoPromotionForProduct(p.id) : null;
        let bogoHint = '';
        if (bogoPromo && qtyInCart > 0) {
            const groupSize = bogoPromo.buyQty + bogoPromo.getQty;
            const freeItems = Math.floor(qtyInCart / groupSize) * bogoPromo.getQty;
            const remainder = qtyInCart % groupSize;
            if (qtyInCart < groupSize) {
                bogoHint = `Add ${groupSize - qtyInCart} more to get ${bogoPromo.getQty} free`;
            } else if (freeItems > 0 && remainder === 0) {
                bogoHint = `Buy ${bogoPromo.buyQty} Get ${bogoPromo.getQty} applied: ${freeItems} FREE`;
            } else if (freeItems > 0) {
                bogoHint = `Buy ${bogoPromo.buyQty} Get ${bogoPromo.getQty} applied: ${freeItems} FREE · Add ${groupSize - remainder} more for ${bogoPromo.getQty} more`;
            }
        }
        
        // Card classes
        const cardClasses = ['p-card'];
        if (inCart) cardClasses.push('in-cart');
        if (isSoldOut) cardClasses.push('p-card--sold-out');
        if (isLimited || isLowStock) cardClasses.push('p-card--limited');
        if (promo) cardClasses.push('p-card--promo');
        
        return `
        <div class="${cardClasses.join(' ')}" data-product-id="${p.id}" onclick="handleProductCardClick(event, ${p.id})">
            <div class="p-thumb-wrap">
                <img class="p-thumb" src="${img}" alt="${escapeHtml(p.name)}" loading="lazy" />
                ${isSoldOut ? '<div class="p-thumb-overlay"></div>' : ''}
                ${promoBadge ? `<div class="product-promotion-badge${promoBadgeVariant ? ` product-promotion-badge--${escapeHtml(promoBadgeVariant)}` : ''}">${escapeHtml(promoBadge)}</div>` : ''}
            </div>
            <div class="p-info">
                <div class="p-name">${escapeHtml(p.name)}</div>
                ${statusBadge}
                ${!statusBadge ? ratingHtml : ''}
                ${p.description ? `<div class="p-desc">${escapeHtml(p.description)}</div>` : ''}
                ${promoText ? `<div class="p-promo-sub">${escapeHtml(promoText)}</div>` : ''}
            </div>
            <div class="p-cta">
                ${isSoldOut ? `<div class="p-price">—</div>` : (
                    isFreeApplied
                        ? `<div class="p-price-wrap">
                             <div class="p-price p-price--promo">Ks 0.00</div>
                             <div class="p-price-old">Ks ${p.price.toFixed(2)}</div>
                           </div>`
                        : hasPercentPromo
                        ? `<div class="p-price-wrap">
                             <div class="p-price p-price--promo">Ks ${discountedPrice.toFixed(2)}</div>
                             <div class="p-price-old">Ks ${p.price.toFixed(2)}</div>
                           </div>`
                        : `<div class="p-price">Ks ${p.price.toFixed(2)}</div>`
                )}
                ${bogoHint ? `<div class="p-promo-hint">${escapeHtml(bogoHint)}</div>` : ''}
                <div class="qty-controls${isSoldOut ? ' qty-controls--disabled' : ''}">
                    <button class="qty-btn minus" onclick="handleDecreaseClick(event, ${p.id})" id="dec-${p.id}" ${!inCart || isSoldOut ? 'disabled' : ''}>−</button>
                    <div class="qty-display" id="qty-${p.id}">${cart[p.id] || 0}</div>
                    <button class="qty-btn plus" onclick="handleAddClick(event, ${p.id})" data-product-id="${p.id}" ${isSoldOut ? 'disabled' : ''}>+</button>
                </div>
            </div>
        </div>`;
    }).join('');
    
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

/**
 * Handle click on product card (not on buttons)
 * Opens product detail sheet for editing/viewing
 */
function handleProductCardClick(event, productId) {
    // Don't trigger if clicking on buttons or qty controls
    if (event.target.closest('.qty-btn') || event.target.closest('.qty-controls')) {
        return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    const product = window.products?.find(p => p.id == productId);
    if (!product) return;
    
    if (product.availability_status === 'sold_out') {
        showToast('This item is sold out');
        return;
    }
    
    // Open product detail sheet
    if (window.openProductDetail) {
        window.openProductDetail(productId);
    }
}

/**
 * Handle add button click
 * Opens product detail sheet for customization
 */
function handleAddClick(event, productId) {
    event.preventDefault();
    event.stopPropagation(); // Prevent card click
    
    const product = window.products?.find(p => p.id == productId);
    if (!product) return;
    
    if (product.availability_status === 'sold_out') {
        showToast('This item is sold out');
        return;
    }
    
    // Add micro-interaction
    const btn = event.currentTarget;
    btn.style.transform = 'scale(0.9)';
    setTimeout(() => btn.style.transform = '', 100);
    
    // Open product detail sheet for customization
    if (window.openProductDetail) {
        window.openProductDetail(productId);
    } else {
        // Fallback to direct add
        window.addToCartWithNote ? window.addToCartWithNote(productId, 1, '') : window.increaseQty(productId);
    }
}

/**
 * Handle decrease button click
 */
function handleDecreaseClick(event, productId) {
    event.preventDefault();
    event.stopPropagation(); // Prevent card click
    window.decreaseQty(productId);
}

// Export
window.loadProducts = loadProducts;
window.renderProducts = renderProducts;
window.renderCategoryTabs = renderCategoryTabs;
window.handleProductCardClick = handleProductCardClick;
window.handleAddClick = handleAddClick;
window.handleDecreaseClick = handleDecreaseClick;
window.handleCategoryClick = handleCategoryClick;
window.handleSearchInput = handleSearchInput;
window.clearFilters = clearFilters;
window.fetchStockStatus = fetchStockStatus;
window.CATEGORIES = CATEGORIES;
window.loadLatestReviews = loadLatestReviews;
window.initPreorderUI = initPreorderUI;
