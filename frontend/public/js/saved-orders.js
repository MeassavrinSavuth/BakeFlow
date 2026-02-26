/**
 * BakeFlow - Saved Orders Module
 * Saved orders rendering and management
 */

function updateTopDividerVisibility() {
    const sectionDivider = document.getElementById('sectionDivider');
    if (!sectionDivider) return;

    const reorderSection = document.getElementById('reorderSection');
    const savedSummary = document.getElementById('savedSummarySection');

    const recentVisible = !!(reorderSection && reorderSection.style.display !== 'none');
    const savedVisible = !!(savedSummary && savedSummary.style.display !== 'none');
    sectionDivider.style.display = recentVisible || savedVisible ? 'block' : 'none';
}

function isRecentOrdersExpanded() {
    return !!window.__bfRecentOrdersExpanded;
}

function setRecentOrdersExpanded(v) {
    window.__bfRecentOrdersExpanded = !!v;
}

function getToken() {
    return (window.getWebviewToken && window.getWebviewToken()) || new URLSearchParams(window.location.search).get('t') || '';
}

function getSavedOrdersCache() {
    return Array.isArray(window.__bfSavedOrdersCache) ? window.__bfSavedOrdersCache : null;
}

function setSavedOrdersCache(list) {
    window.__bfSavedOrdersCache = Array.isArray(list) ? list : [];
}

function getRecentOrdersCache() {
    return Array.isArray(window.__bfRecentOrdersCache) ? window.__bfRecentOrdersCache : null;
}

function setRecentOrdersCache(list) {
    window.__bfRecentOrdersCache = Array.isArray(list) ? list : [];
}

async function fetchJSON(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
    }
    return await res.json();
}

function findProductIdByName(name) {
    const n = (name || '').trim().toLowerCase();
    if (!n || !Array.isArray(window.products)) return null;
    const p = window.products.find(px => (px.name || '').trim().toLowerCase() === n);
    return p ? p.id : null;
}

function normalizeRecentOrdersFromAPI(apiOrders) {
    const orders = Array.isArray(apiOrders) ? apiOrders : [];
    return orders.map(o => {
        const items = Array.isArray(o.items) ? o.items : [];
        const normalizedItems = items.map(it => {
            const name = it.product || it.name || '';
            const qty = Number(it.quantity != null ? it.quantity : it.qty);
            const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
            const price = Number(it.price);
            const pid = it.product_id != null ? Number(it.product_id) : findProductIdByName(name);

            const prod = pid != null && Array.isArray(window.products)
                ? window.products.find(p => p.id == pid)
                : null;

            return {
                id: Number.isFinite(pid) ? pid : null,
                product_id: Number.isFinite(pid) ? pid : null,
                qty: q,
                name: prod && prod.name ? prod.name : name,
                price: Number.isFinite(price) && price >= 0 ? price : (prod ? Number(prod.price) || 0 : 0),
                image: (it.image_url || it.image || '') || (prod && prod.image_url ? prod.image_url : '')
            };
        });

        const ts = o.created_at ? new Date(o.created_at).getTime() : 0;
        return {
            order_id: o.id,
            timestamp: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
            total_amount: Number(o.total_amount),
            total_items: Number(o.total_items),
            items: normalizedItems
        };
    });
}

function normalizeSavedOrdersFromAPI(apiSavedOrders) {
    const orders = Array.isArray(apiSavedOrders) ? apiSavedOrders : [];
    return orders.map(so => {
        const items = Array.isArray(so.items) ? so.items : [];
        const normalizedItems = items.map(it => {
            const pid = it.product_id != null ? it.product_id : (it.id != null ? it.id : null);
            const name = it.name || '';
            const qty = Number(it.qty);
            const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
            const price = Number(it.price);

            const prod = pid != null && Array.isArray(window.products)
                ? window.products.find(p => p.id == pid)
                : null;

            return {
                id: pid,
                qty: q,
                name: prod && prod.name ? prod.name : name,
                price: Number.isFinite(price) && price >= 0 ? price : (prod ? Number(prod.price) || 0 : 0),
                image: it.image_url || (prod && prod.image_url ? prod.image_url : '')
            };
        }).filter(it => it.id != null);

        return {
            id: so.id,
            name: so.name || 'Saved order',
            note: so.note || '',
            tags: Array.isArray(so.tags) ? so.tags : [],
            timestamp: so.updated_at ? new Date(so.updated_at).getTime() : Date.now(),
            created_at: so.created_at || new Date().toISOString(),
            items: normalizedItems
        };
    });
}

async function renderRecentOrders() {
    const tok = getToken();
    let list = null;

    if (tok) {
        try {
            const data = await fetchJSON(`/api/me/recent-orders?t=${encodeURIComponent(tok)}&limit=10`);
            list = normalizeRecentOrdersFromAPI(data.orders);
            setRecentOrdersCache(list);
        } catch (e) {
            console.log('Failed to load recent orders from API, falling back:', e);
        }
    }

    if (!Array.isArray(list)) {
        const userId = getUserId();
        const key = `recent_orders_${userId}`;
        list = JSON.parse(localStorage.getItem(key) || '[]');
        setRecentOrdersCache(list);
    }

    const reorderSection = document.getElementById('reorderSection');
    const reorderGrid = document.getElementById('reorderGrid');
    const toggleBtn = document.getElementById('toggleRecentOrdersBtn');

    if (!reorderSection || !reorderGrid) return;

    if (!Array.isArray(list) || list.length === 0) {
        reorderSection.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'none';
        updateTopDividerVisibility();
        return;
    }

    reorderSection.style.display = 'block';

    const visibleCount = 1;
    if (toggleBtn) toggleBtn.style.display = 'none';

    const displayList = list.map((o, index) => ({ ...o, __index: index })).filter(o => {
        const items = Array.isArray(o.items) ? o.items : [];
        const itemCount = items.reduce((s, it) => s + (it.qty || 1), 0);
        const totalItems = Number(o.total_items);
        const totalAmount = Number(o.total_amount);
        const hasItems = itemCount > 0 || (Number.isFinite(totalItems) && totalItems > 0);
        const hasTotal = Number.isFinite(totalAmount) && totalAmount > 0;
        return hasItems && hasTotal;
    });

    if (displayList.length === 0) {
        reorderSection.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'none';
        updateTopDividerVisibility();
        return;
    }

    const slicedList = displayList.slice(0, visibleCount);
    reorderGrid.innerHTML = slicedList.map((o, idx) => {
        const items = Array.isArray(o.items) ? o.items : [];
        const itemCount = items.reduce((s, it) => s + (it.qty || 1), 0);
        const total = items.reduce((s, it) => {
            const price = typeof it.price === 'number' && !isNaN(it.price) ? it.price : 0;
            return s + (price * (it.qty || 1));
        }, 0);
        const totalAmount = Number(o.total_amount);
        const totalItems = Number(o.total_items);
        const displayTotal = Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : total;
        const displayItemCount = itemCount > 0 ? itemCount : (Number.isFinite(totalItems) ? totalItems : 0);
        const lastOrdered = o.timestamp ? timeAgo(o.timestamp) : 'Recently';

        let thumbsHtml = '';
        const thumbItems = items.slice(0, 3);
        if (thumbItems.length === 0) {
            thumbsHtml = `<img src="https://placehold.co/80x80/f5f3ef/888?text=🧁" alt="" class="reorder-thumb">`;
        } else {
            thumbItems.forEach(it => {
                const imgSrc = it.image || 'https://placehold.co/80x80/f5f3ef/888?text=🧁';
                thumbsHtml += `<img src="${escapeHtml(imgSrc)}" alt="" class="reorder-thumb" onerror="this.src='https://placehold.co/80x80/f5f3ef/888?text=🧁'">`;
            });
            if (items.length > 3) {
                thumbsHtml += `<div class="reorder-thumb-more">+${items.length - 3}</div>`;
            }
        }

        const title = o.order_id ? `Order #${escapeHtml(String(o.order_id))}` : 'Recent order';

        const sourceIndex = Number.isFinite(o.__index) ? o.__index : idx;
        return `
        <div class="reorder-card" onclick="applyRecentOrder(${sourceIndex})">
            <div class="reorder-thumbs">${thumbsHtml}</div>
            <div class="reorder-content">
                <div class="reorder-name">${title}</div>
                <div class="reorder-meta">
                    <span class="reorder-meta-item"><i data-lucide="package"></i> ${displayItemCount} items</span>
                    <span class="reorder-meta-item"><i data-lucide="clock"></i> ${escapeHtml(lastOrdered)}</span>
                </div>
                <div class="reorder-price">Ks ${displayTotal.toFixed(2)}</div>
            </div>
            <div class="reorder-actions" onclick="event.stopPropagation();">
                <button class="reorder-btn primary" onclick="applyRecentOrder(${sourceIndex})">
                    <i data-lucide="shopping-cart"></i> Order
                </button>
            </div>
        </div>`;
    }).join('');

    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    updateTopDividerVisibility();
}

async function renderSavedOrders() {
    const tok = getToken();
    let list = null;

    if (tok) {
        try {
            const data = await fetchJSON(`/api/me/saved-orders?t=${encodeURIComponent(tok)}`);
            list = normalizeSavedOrdersFromAPI(data.saved_orders);
            setSavedOrdersCache(list);
        } catch (e) {
            console.log('Failed to load saved orders from API, falling back:', e);
        }
    }

    if (!Array.isArray(list)) {
        const userId = getUserId();
        const key = `saved_orders_${userId}`;
        list = JSON.parse(localStorage.getItem(key) || '[]');
        setSavedOrdersCache(list);
    }
    
    const savedSummary = document.getElementById('savedSummarySection');
    const savedCount = document.getElementById('savedCount');

    if (!list.length) { 
        if (savedSummary) savedSummary.style.display = 'none';
        updateTopDividerVisibility();
        return; 
    }

    if (savedCount) savedCount.textContent = list.length;
    if (savedSummary) savedSummary.style.display = 'block';
    updateTopDividerVisibility();
}

window.applySavedOrder = function(idx) {
    const userId = getUserId();
    const key = `saved_orders_${userId}`;
    const list = getSavedOrdersCache() || (() => {
        return JSON.parse(localStorage.getItem(key) || '[]');
    })();

    const o = list[idx];
    if (!o) return;
    
    const newCart = {};
    const unavailableItems = [];
    const products = window.products || [];
    
    o.items.forEach(it => {
        const p = products.find(px => px.id == it.id);
        if (p) {
            newCart[it.id] = it.qty;
        } else {
            unavailableItems.push(it.name || `Item #${it.id}`);
        }
    });
    
    window.setCart(newCart);
    window.updateCart();
    
    // Increment order count for "usual" tracking
    o.orderCount = (o.orderCount || 0) + 1;
    o.timestamp = Date.now();
    localStorage.setItem(key, JSON.stringify(list));
    
    if (unavailableItems.length > 0) {
        const itemNames = unavailableItems.slice(0, 3).join(', ');
        const more = unavailableItems.length > 3 ? ` and ${unavailableItems.length - 3} more` : '';
        showToast(`Some items unavailable: ${itemNames}${more}`, 'warning');
    } else {
        showToast('✓ Order loaded', 'success');
    }
};

window.applyRecentOrder = function(idx) {
    const list = getRecentOrdersCache() || (() => {
        const userId = getUserId();
        const key = `recent_orders_${userId}`;
        return JSON.parse(localStorage.getItem(key) || '[]');
    })();

    const o = list[idx];
    if (!o || !Array.isArray(o.items)) return;

    const newCart = {};
    const unavailableItems = [];
    const products = window.products || [];
    
    o.items.forEach(it => {
        const id = it.id || it.product_id;
        if (id != null) {
            const p = products.find(px => px.id == id);
            if (p) {
                newCart[id] = it.qty || 1;
            } else {
                unavailableItems.push(it.name || `Item #${id}`);
            }
        }
    });

    window.setCart(newCart);
    window.updateCart();
    
    if (unavailableItems.length > 0) {
        const itemNames = unavailableItems.slice(0, 3).join(', ');
        const more = unavailableItems.length > 3 ? ` and ${unavailableItems.length - 3} more` : '';
        showToast(`Some items unavailable: ${itemNames}${more}`, 'warning');
    } else {
        showToast('✓ Order loaded', 'success');
    }
};

function initSaveSheet() {
    document.getElementById('barSave').addEventListener('click', () => {
        document.getElementById('saveName').value = '';
        document.getElementById('saveNote').value = '';
        document.getElementById('saveCount').textContent = '0/40';
        document.querySelectorAll('.tag-chip').forEach(c => {
            c.classList.remove('selected');
            const input = c.querySelector('input[type="checkbox"]');
            if (input) input.checked = false;
        });
        openSheet('saveSheet');
    });
    
    document.getElementById('saveName').addEventListener('input', (e) => {
        const v = e.target.value || '';
        document.getElementById('saveCount').textContent = `${v.length}/40`;
    });
    
    const tagChipsWrap = document.querySelector('#saveSheet .tag-chips') || document.querySelector('.tag-chips');
    if (tagChipsWrap) {
        tagChipsWrap.addEventListener('click', (e) => {
            const chip = e.target.closest('.tag-chip');
            if (!chip || !tagChipsWrap.contains(chip)) return;
            e.preventDefault();
            e.stopPropagation();
            chip.classList.toggle('selected');
            const input = chip.querySelector('input[type="checkbox"]');
            if (input) input.checked = chip.classList.contains('selected');
        });
    }
    
    document.getElementById('viewSavedOrdersLink').addEventListener('click', (e) => {
        e.preventDefault();
        goToSavedOrders();
    });
    
    document.getElementById('saveCancel').addEventListener('click', closeSheets);
    
    document.getElementById('saveConfirm').addEventListener('click', () => {
        const name = document.getElementById('saveName').value.trim();
        const note = document.getElementById('saveNote').value.trim();
        const cart = window.getCart();
        const items = Object.keys(cart).map(id => {
            const p = window.products.find(px => px.id == id);
            return { 
                id: parseInt(id), 
                qty: cart[id], 
                price: p ? p.price : 0,
                name: p ? p.name : '',
                image: p ? p.image_url : ''
            };
        });
        
        if (items.length === 0) { showToast('Cart is empty'); return; }
        if (!name) { showToast('Enter a name'); return; }
        
        const tags = [];
        document.querySelectorAll('.tag-chip.selected').forEach(c => tags.push(c.dataset.tag));
        
        const tok = getToken();

        const saveViaLocalStorage = () => {
            const userId = getUserId();
            const payload = { name, note, tags, items, timestamp: Date.now(), created_at: new Date().toISOString(), orderCount: 0 };
            const key = `saved_orders_${userId}`;
            const current = JSON.parse(localStorage.getItem(key) || '[]');
            current.unshift(payload);
            localStorage.setItem(key, JSON.stringify(current));
            setSavedOrdersCache(current);
        };

        const saveViaAPI = async () => {
            const apiItems = items.map(it => ({
                product_id: it.id,
                name: it.name,
                qty: it.qty,
                price: it.price,
                image_url: it.image
            }));
            const body = { id: 0, name, note, tags, items: apiItems };

            const data = await fetchJSON(`/api/me/saved-orders?t=${encodeURIComponent(tok)}` , {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            // Refresh list (server is source of truth)
            try {
                const listData = await fetchJSON(`/api/me/saved-orders?t=${encodeURIComponent(tok)}`);
                const list = normalizeSavedOrdersFromAPI(listData.saved_orders);
                setSavedOrdersCache(list);
            } catch (e) {
                // If refresh fails, still show success; fallback will happen on next render.
            }

            return data;
        };

        (async () => {
            try {
                if (tok) {
                    await saveViaAPI();
                } else {
                    saveViaLocalStorage();
                }

                await renderSavedOrders();
                closeSheets();
                showToast(tok ? '✓ Order saved' : '✓ Saved on this device', 'success');
            } catch (e) {
                console.log('Failed to save via API, falling back:', e);
                try {
                    saveViaLocalStorage();
                    await renderSavedOrders();
                    closeSheets();
                    showToast('✓ Saved on this device', 'success');
                } catch (e2) {
                    showToast('Failed to save order');
                }
            }
        })();
    });
}

// Export
window.renderSavedOrders = renderSavedOrders;
window.initSaveSheet = initSaveSheet;
window.renderRecentOrders = renderRecentOrders;
