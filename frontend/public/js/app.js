/**
 * BakeFlow - Main Application
 * Initializes all modules and handles app startup
 */

async function init() {
    // Load products
    await loadProducts();
    
    // Load promotions
    if (typeof loadPromotions === 'function') {
        await loadPromotions();
        if (typeof renderPromotionBanner === 'function') {
            renderPromotionBanner();
        }
    }
    
    // Render UI
    renderTagChips();
    renderProducts();
    updateCart();
    await Promise.resolve(renderRecentOrders());
    await Promise.resolve(renderSavedOrders());
    if (typeof renderPlacesBar === 'function') {
        renderPlacesBar();
    }
    if (typeof renderRecurringOrders === 'function') {
        renderRecurringOrders();
    }

    if (typeof initPreorderUI === 'function') {
        initPreorderUI();
    }
    
    // Initialize Lucide icons
    if (window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons();
    }
    
    // Handle safe area padding
    adjustSafePadding();
    window.addEventListener('resize', adjustSafePadding);
    window.addEventListener('orientationchange', adjustSafePadding);

    // Handle pending reorder cart from Saved Orders page
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('user_id') || 'guest';
    const tok = (window.getWebviewToken && window.getWebviewToken()) || params.get('t') || '';

    const storedPsid = (() => {
        try { return localStorage.getItem('bf_psid') || ''; } catch (e) { return ''; }
    })();
    const storedUserId = (() => {
        try { return localStorage.getItem('bf_user_id') || ''; } catch (e) { return ''; }
    })();

    const pendingCartKeys = [
        tok ? `pending_reorder_t_${tok}` : '',
        `pending_reorder_${userId}`,
        storedPsid ? `pending_reorder_${storedPsid}` : '',
        storedUserId ? `pending_reorder_${storedUserId}` : '',
        'pending_reorder_guest',
        'pending_reorder_latest'
    ].filter(Boolean);

    let pendingCart = null;
    for (const key of pendingCartKeys) {
        const raw = localStorage.getItem(key);
        if (raw) {
            pendingCart = raw;
            break;
        }
    }
    
    // Load custom notes if available
    const notesKeys = [
        tok ? `pending_notes_t_${tok}` : '',
        `pending_notes_${userId}`,
        storedPsid ? `pending_notes_${storedPsid}` : '',
        storedUserId ? `pending_notes_${storedUserId}` : '',
        'pending_notes_guest',
        'pending_notes_latest'
    ].filter(Boolean);

    let pendingNotes = null;
    for (const key of notesKeys) {
        const raw = localStorage.getItem(key);
        if (raw) {
            pendingNotes = raw;
            break;
        }
    }
    let customNotes = {};
    if (pendingNotes) {
        try {
            customNotes = JSON.parse(pendingNotes);
        } catch(e) {}
        notesKeys.forEach(k => localStorage.removeItem(k));
    }
    
    let pendingCartApplied = false;

    if (pendingCart) {
        try {
            const items = JSON.parse(pendingCart);
            const newCart = {};
            const unavailableItems = [];
            const itemsWithNotes = [];

            const normalizeName = (v) => String(v || '')
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            const resolveProductFromPendingItem = (it) => {
                const directId = it && (it.id != null ? it.id : it.product_id);
                if (directId != null) {
                    const byId = window.products.find(px => px.id == directId);
                    if (byId) return byId;
                }

                const rawName = (it && (it.name || it.product)) ? String(it.name || it.product) : '';
                const normalized = rawName.trim().toLowerCase();
                if (!normalized) return null;

                let byName = window.products.find(px => (px.name || '').trim().toLowerCase() === normalized);
                if (byName) return byName;

                const compact = normalized.replace(/\s+/g, ' ');
                byName = window.products.find(px => ((px.name || '').trim().toLowerCase().replace(/\s+/g, ' ')) === compact);
                if (byName) return byName;

                const normalizedLoose = normalizeName(rawName);
                if (!normalizedLoose) return null;
                byName = window.products.find(px => normalizeName(px.name) === normalizedLoose);
                return byName || null;
            };
            
            items.forEach(it => {
                const p = resolveProductFromPendingItem(it);
                if (p) {
                    const qtyRaw = Number(it && (it.qty != null ? it.qty : it.quantity));
                    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
                    newCart[p.id] = (newCart[p.id] || 0) + qty;
                    // Check for custom notes from item or from notes storage
                    const note = it.note || customNotes[p.id] || customNotes[it.id] || '';
                    if (note) {
                        itemsWithNotes.push({ id: p.id, note });
                    }
                } else {
                    const fallbackId = it && (it.id != null ? it.id : it.product_id);
                    unavailableItems.push((it && (it.name || it.product)) || (fallbackId != null ? `Item #${fallbackId}` : 'Unknown item'));
                }
            });

            const matchedQty = Object.values(newCart).reduce((s, q) => s + Number(q || 0), 0);
            const sourceCount = Array.isArray(items) ? items.length : 0;

            if (matchedQty > 0) {
                setCart(newCart);
                pendingCartApplied = true;
            }
            
            // Store custom notes globally for order submission
            if (itemsWithNotes.length > 0) {
                window.cartItemNotes = {};
                itemsWithNotes.forEach(item => {
                    window.cartItemNotes[item.id] = item.note;
                });
            }

            if (pendingCartApplied) {
                updateCart();
                pendingCartKeys.forEach(k => localStorage.removeItem(k));
            } else {
                console.warn('[BakeFlow] Pending reorder found but no products matched', { sourceCount, items });
            }
            
            if (unavailableItems.length > 0) {
                const itemNames = unavailableItems.slice(0, 3).join(', ');
                const more = unavailableItems.length > 3 ? ` and ${unavailableItems.length - 3} more` : '';
                showToast(`Some items unavailable: ${itemNames}${more}`, 'warning');
            } else if (!pendingCartApplied && sourceCount > 0) {
                showToast('Reorder data found, but could not map items to current menu', 'warning');
            } else if (itemsWithNotes.length > 0) {
                showToast('✓ Order loaded with notes', 'success');
            } else {
                showToast('✓ Order loaded', 'success');
            }
        } catch(e) { 
            console.log('Failed to load pending cart', e); 
        }
    }

    // Restore pending schedule (if any)
    try {
        const scheduleKey = `pending_schedule_${getUserId()}`;
        const raw = localStorage.getItem(scheduleKey);
        if (raw) {
            const sched = JSON.parse(raw);
            if (sched && sched.date && sched.time) {
                const when = new Date(`${sched.date}T${sched.time}:00`);
                if (!Number.isNaN(when.getTime()) && when.getTime() > Date.now()) {
                    window.setPendingSchedule(sched);
                    window.updateCart();
                } else {
                    localStorage.removeItem(scheduleKey);
                }
            }
        }
    } catch (e) {
        // ignore
    }
    
    // Handle reorder flag from order details
    if (params.get('reorder') === '1' && !pendingCartApplied) {
        const key = `saved_orders_${userId}`;
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        if (list.length > 0) {
            const newCart = {};
            const unavailableItems = [];

            const normalizeName = (v) => String(v || '')
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            (list[0].items || []).forEach(it => {
                const directId = it && (it.id != null ? it.id : it.product_id);
                let p = directId != null ? window.products.find(px => px.id == directId) : null;
                if (!p) {
                    const target = normalizeName(it.name || it.product || '');
                    p = target ? window.products.find(px => normalizeName(px.name) === target) : null;
                }
                const id = p ? p.id : null;
                if (id) {
                    const qtyRaw = Number(it && (it.qty != null ? it.qty : it.quantity));
                    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
                    newCart[id] = (newCart[id] || 0) + qty;
                } else {
                    unavailableItems.push(it.name || 'Unknown item');
                }
            });

            const matchedQty = Object.values(newCart).reduce((s, q) => s + Number(q || 0), 0);
            if (matchedQty > 0) {
                setCart(newCart);
                updateCart();
            }
            
            if (unavailableItems.length > 0) {
                const itemNames = unavailableItems.slice(0, 3).join(', ');
                const more = unavailableItems.length > 3 ? ` and ${unavailableItems.length - 3} more` : '';
                showToast(`Some items unavailable: ${itemNames}${more}`, 'warning');
            } else if (matchedQty <= 0) {
                showToast('Could not restore reorder items. Please reorder manually once, then save again.', 'warning');
            } else {
                showToast('✓ Order loaded', 'success');
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

    // Initialize customer info management
    if (window.initCustomerInfoManagement) {
        window.initCustomerInfoManagement();
    }

    if (window.loadActiveOrder) {
        await Promise.resolve(window.loadActiveOrder());
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const navigateToSavedOrders = () => {
        if (typeof goToSavedOrders === 'function') {
            goToSavedOrders();
            return;
        }

        const qs = new URLSearchParams();
        const uid = (window.getUserId && window.getUserId()) || '';
        const tok = (window.getWebviewToken && window.getWebviewToken()) || new URLSearchParams(window.location.search).get('t') || '';
        if (uid && uid !== 'guest') qs.set('user_id', uid);
        if (tok) qs.set('t', tok);
        window.location.href = '/saved-orders.html' + (qs.toString() ? ('?' + qs.toString()) : '');
    };

    // Initialize all modules
    init();
    initSheetListeners();
    initSaveSheet();
    if (typeof initPlacesSheet === 'function') initPlacesSheet();
    if (typeof initScheduleSheet === 'function') initScheduleSheet();
    if (typeof initRecurringSheet === 'function') initRecurringSheet();

    // Clear inline validation errors on input
    document.addEventListener('input', e => {
        if (e.target.classList.contains('invalid')) {
            e.target.classList.remove('invalid');
            const errEl = document.getElementById(e.target.id + 'Error');
            if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
        }
    });
    
    // Wire checkout and back buttons
    document.getElementById('barCheckout').addEventListener('click', openDeliveryForm);
    document.getElementById('backToCartBtn').addEventListener('click', backToCart);
    document.getElementById('placeOrderBtn').addEventListener('click', submitOrder);
    
    const refreshReviewsBtn = document.getElementById('refreshReviewsBtn');
    if (refreshReviewsBtn) {
        refreshReviewsBtn.addEventListener('click', () => {
            const reviewsSection = document.getElementById('reviewsSection');
            const toggleReviewsBtn = document.getElementById('toggleReviewsBtn');
            if (reviewsSection && reviewsSection.classList.contains('reviews-collapsed')) {
                reviewsSection.classList.remove('reviews-collapsed');
                if (toggleReviewsBtn) toggleReviewsBtn.textContent = 'Hide';
                refreshReviewsBtn.style.display = '';
            }
            if (typeof loadLatestReviews === 'function') {
                reviewsSection && (reviewsSection.dataset.reviewsLoaded = '1');
                loadLatestReviews();
            }
        });
    }

    const toggleReviewsBtn = document.getElementById('toggleReviewsBtn');
    const reviewsSection = document.getElementById('reviewsSection');
    if (toggleReviewsBtn && reviewsSection) {
        if (!reviewsSection.classList.contains('reviews-collapsed')) {
            reviewsSection.classList.add('reviews-collapsed');
        }
        toggleReviewsBtn.textContent = 'Show';
        if (refreshReviewsBtn) refreshReviewsBtn.style.display = 'none';

        toggleReviewsBtn.addEventListener('click', () => {
            const isCollapsed = reviewsSection.classList.toggle('reviews-collapsed');
            toggleReviewsBtn.textContent = isCollapsed ? 'Show' : 'Hide';
            if (refreshReviewsBtn) refreshReviewsBtn.style.display = isCollapsed ? 'none' : '';
            if (!isCollapsed && typeof loadLatestReviews === 'function') {
                if (reviewsSection.dataset.reviewsLoaded !== '1') {
                    reviewsSection.dataset.reviewsLoaded = '1';
                    loadLatestReviews();
                }
            }
        });
    }
    
    // Wire clear cart button
    const clearBtn = document.getElementById('barClear');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            const currentCart = window.getCart ? window.getCart() : {};
            if (Object.keys(currentCart).length === 0) {
                showToast('Cart is already empty');
                return;
            }
            if (confirm('Clear all items from cart?')) {
                window.setCart({});
                window.updateCart();
                showToast('Cart cleared', 'success');
            }
        });
    }
    
    // Direct handler for Manage button
    const manageBtn = document.getElementById('manageSavedOrdersBtn');
    if (manageBtn) {
        manageBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            navigateToSavedOrders();
        });
    }
    
    // Event delegation backup
    document.addEventListener('click', (e) => {
        if (e.target.closest('#manageSavedOrdersBtn')) {
            e.preventDefault();
            navigateToSavedOrders();
        }
    });
});
