/**
 * BakeFlow - Cart Module
 * Cart state management and UI updates
 * Supports multiple instances of same product with different notes
 */

// Legacy cart format for backward compatibility: { productId: qty }
let cart = {};

// New cart format with notes support
// Array of: { id: string, productId: number, qty: number, note: string }
let cartItems = [];

let pendingSchedule = null;

// Generate unique cart item ID
function generateCartItemId() {
    return 'ci_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function extractPreorderExtraFromNote(note) {
    if (!note) return 0;
    const lines = String(note).split('\n').map(line => line.trim()).filter(Boolean);
    let extra = null;
    let breakdownTotal = 0;
    lines.forEach((line) => {
        const extraMatch = line.match(/^extra(?:\s+price)?:\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i);
        if (extraMatch) {
            const parsed = Number(extraMatch[1]);
            if (Number.isFinite(parsed)) extra = parsed;
            return;
        }
        const sizeMatch = line.match(/^size price:\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i);
        if (sizeMatch) {
            const parsed = Number(sizeMatch[1]);
            if (Number.isFinite(parsed)) breakdownTotal += parsed;
            return;
        }
        const layerMatch = line.match(/^layer price:\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i);
        if (layerMatch) {
            const parsed = Number(layerMatch[1]);
            if (Number.isFinite(parsed)) breakdownTotal += parsed;
            return;
        }
        const creamMatch = line.match(/^cream price:\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i);
        if (creamMatch) {
            const parsed = Number(creamMatch[1]);
            if (Number.isFinite(parsed)) breakdownTotal += parsed;
        }
    });
    if (extra !== null) return extra;
    return breakdownTotal;
}

/**
 * Add item to cart with note (new approach)
 * If note is empty and item already exists without note, increment qty
 * Otherwise create new cart item entry
 */
function getProductById(productId) {
    const pid = Number(productId);
    if (!Number.isFinite(pid)) return null;
    const main = window.products?.find(p => Number(p.id) === pid);
    if (main) return main;
    const preorderList = window.preorderSettings?.products || [];
    const preorder = preorderList.find(p => Number(p.id) === pid);
    if (preorder) return preorder;
    const snapshotItem = cartItems.find(item => Number(item.productId) === pid && item.productSnapshot);
    return snapshotItem?.productSnapshot || null;
}

function addToCartWithNote(productId, qty, note) {
    const product = getProductById(productId);
    if (product && product.availability_status === 'sold_out') {
        showToast('This item is sold out');
        return;
    }

    // Enforce stock before mutating cart
    const remainingBefore = window.getRemainingStockForProduct ? window.getRemainingStockForProduct(productId) : null;
    if (Number.isFinite(remainingBefore) && remainingBefore <= 0) {
        showToast('This item is out of stock');
        return;
    }
    if (Number.isFinite(remainingBefore) && qty > remainingBefore) {
        showToast(`Only ${remainingBefore} left for this item`);
        return;
    }
    
    // Check if same product with same note already exists
    const existingItem = cartItems.find(item => 
        item.productId == productId && 
        (item.note || '') === (note || '')
    );
    
    if (existingItem) {
        // Increment existing item
        existingItem.qty += qty;
        if (product && !existingItem.productSnapshot) {
            existingItem.productSnapshot = {
                id: product.id,
                name: product.name || '',
                price: Number(product.price || 0),
                image_url: product.image_url || '',
                availability_status: product.availability_status || ''
            };
        }
    } else {
        // Add new cart item
        cartItems.push({
            id: generateCartItemId(),
            productId: parseInt(productId),
            qty: qty,
            note: note || '',
            productSnapshot: product ? {
                id: product.id,
                name: product.name || '',
                price: Number(product.price || 0),
                image_url: product.image_url || '',
                availability_status: product.availability_status || ''
            } : null
        });
    }

    // Sync legacy cart format
    syncLegacyCart();
    updateCart();
    markProductCardInCart(productId);
}

/**
 * Update existing cart item
 */
function updateCartItem(cartItemId, newQty, newNote) {
    const item = cartItems.find(i => i.id === cartItemId);
    if (!item) return;
    
    if (newQty <= 0) {
        removeCartItemById(cartItemId);
        return;
    }
    
    item.qty = newQty;
    item.note = newNote || '';
    
    syncLegacyCart();
    updateCart();
}

/**
 * Get cart item by ID
 */
function getCartItem(cartItemId) {
    return cartItems.find(i => i.id === cartItemId);
}

/**
 * Get all cart items
 */
function getCartItems() {
    return [...cartItems];
}

/**
 * Remove cart item by ID
 */
function removeCartItemById(cartItemId) {
    const idx = cartItems.findIndex(i => i.id === cartItemId);
    if (idx !== -1) {
        const item = cartItems[idx];
        cartItems.splice(idx, 1);
        syncLegacyCart();
        updateCart();
        
        // Check if product still in cart
        const stillInCart = cartItems.some(i => i.productId === item.productId);
        if (!stillInCart) {
            unmarkProductCard(item.productId);
        }
    }
}

/**
 * Sync legacy cart format from cartItems
 */
function syncLegacyCart() {
    cart = {};
    cartItems.forEach(item => {
        if (!cart[item.productId]) {
            cart[item.productId] = 0;
        }
        cart[item.productId] += item.qty;
    });
}

/**
 * Mark product card as in-cart
 */
function markProductCardInCart(productId) {
    const card = document.querySelector(`[data-product-id="${productId}"]`);
    if (card) {
        card.classList.add('in-cart');
    }
}

/**
 * Unmark product card
 */
function unmarkProductCard(productId) {
    const card = document.querySelector(`[data-product-id="${productId}"]`);
    if (card) {
        card.classList.remove('in-cart');
    }
}

// Legacy function - now opens product detail for customization
function increaseQty(productId) {
    // Check if product is sold out before adding
    const product = window.products?.find(p => p.id == productId);
    if (product && product.availability_status === 'sold_out') {
        showToast('This item is sold out');
        return;
    }
    
    const remaining = window.getRemainingStockForProduct ? window.getRemainingStockForProduct(productId) : null;
    if (Number.isFinite(remaining) && remaining <= 0) {
        showToast('This item is out of stock');
        return;
    }

    // Open product detail sheet for customization
    if (window.openProductDetail) {
        window.openProductDetail(productId);
        return;
    }
    
    // Fallback to direct add if product-detail module not loaded
    addToCartWithNote(productId, 1, '');
}

// Legacy function - decrease by finding item without note first
function decreaseQty(productId) {
    // Find items for this product, prefer items without notes
    const itemsForProduct = cartItems.filter(i => i.productId == productId);
    if (itemsForProduct.length === 0) return;
    
    // Sort: items without notes first
    itemsForProduct.sort((a, b) => {
        if (!a.note && b.note) return -1;
        if (a.note && !b.note) return 1;
        return 0;
    });
    
    const item = itemsForProduct[0];
    if (item.qty > 1) {
        item.qty--;
    } else {
        removeCartItemById(item.id);
    }
    
    // Add micro-interaction
    const btn = document.getElementById(`dec-${productId}`);
    if (btn) {
        btn.style.transform = 'scale(0.9)';
        setTimeout(() => btn.style.transform = '', 100);
    }
    
    syncLegacyCart();
    updateCart();
}

function updateCart() {
    let total = 0;
    let itemCount = 0;

    // Update product card displays using legacy cart
    if (window.products) {
        window.products.forEach(p => {
            const qty = cart[p.id] || 0;
            const qtyEl = document.getElementById(`qty-${p.id}`);
            const decEl = document.getElementById(`dec-${p.id}`);
            if (qtyEl) qtyEl.textContent = qty;
            if (decEl) decEl.disabled = qty === 0;
            
            // Update in-cart status
            const card = document.querySelector(`[data-product-id="${p.id}"]`);
            if (card) {
                if (qty > 0) {
                    card.classList.add('in-cart');
                } else {
                    card.classList.remove('in-cart');
                }
            }

            // Disable plus button when cart qty hits remaining stock
            const incEl = document.querySelector(`[onclick*="handleAddClick"].qty-btn.plus[onclick*="${p.id}"]`) || document.querySelector(`.qty-btn.plus[data-product-id="${p.id}"]`);
            const remaining = window.getRemainingStockForProduct ? window.getRemainingStockForProduct(p.id) : null;
            if (incEl) {
                incEl.disabled = Number.isFinite(remaining) ? remaining <= 0 : false;
            }
        });
    }

    // Calculate totals from cartItems (more accurate with notes)
    cartItems.forEach(item => {
        const product = getProductById(item.productId);
        if (product) {
            const extra = extractPreorderExtraFromNote(item.note);
            const unitPrice = Number(product.price) + extra;
            total += (unitPrice * item.qty);
            itemCount += item.qty;
        } else {
            itemCount += item.qty;
        }
    });

    const checkoutItems = cartItems
        .map(item => {
            const product = getProductById(item.productId);
            if (!product) return null;
            const extra = extractPreorderExtraFromNote(item.note);
            return {
                clientLineId: String(item.id || ''),
                productId: Number(item.productId),
                qty: Number(item.qty),
                unitPrice: Number(product.price) + extra
            };
        })
        .filter(Boolean);

    const barItemsEl = document.getElementById('barItems');
    const barSubtotalEl = document.getElementById('barSubtotal');
    const barDiscountEl = document.getElementById('barDiscount');
    const barDiscountRowEl = document.getElementById('barDiscountRow');
    const barDeliveryFeeRowEl = document.getElementById('barDeliveryFeeRow');
    const barDeliveryFeeEl = document.getElementById('barDeliveryFee');
    const barTotalEl = document.getElementById('barTotal');
    const barCheckoutEl = document.getElementById('barCheckout');
    const barSavingsEl = document.getElementById('barSavings');
    
    if (barItemsEl) barItemsEl.textContent = itemCount;
    if (barSubtotalEl) barSubtotalEl.textContent = `Ks ${total.toFixed(2)}`;
    if (barDiscountEl) barDiscountEl.textContent = `-Ks ${(0).toFixed(2)}`;
    if (barDiscountRowEl) barDiscountRowEl.style.display = 'none';
    if (barDeliveryFeeRowEl) barDeliveryFeeRowEl.style.display = 'none';
    if (barDeliveryFeeEl) barDeliveryFeeEl.textContent = `Ks ${(0).toFixed(2)}`;
    if (barTotalEl) barTotalEl.textContent = `Ks ${total.toFixed(2)}`;
    if (barCheckoutEl) barCheckoutEl.textContent = `Checkout • Ks ${total.toFixed(2)}`;
    if (barCheckoutEl) barCheckoutEl.disabled = itemCount === 0;

    const placeBtn = document.getElementById('placeOrderBtn');
    const placeSpan = placeBtn ? placeBtn.querySelector('span') : null;
    if (placeSpan) {
        const base = window.__pendingPreorder ? 'Place Custom Cake Order' : 'Place Order';
        placeSpan.textContent = base;
    }

    if (itemCount > 0 && typeof window.calculateCheckoutWithPromotions === 'function') {
        const deliveryType = (window.getDeliveryType ? window.getDeliveryType() : '') || '';
        const township = document.getElementById('customerTownship')?.value.trim() || '';
        const legacyAddress = document.getElementById('customerAddress')?.value.trim() || '';
        const feeAddress = township || legacyAddress;

        window.calculateCheckoutWithPromotions(checkoutItems, { deliveryType, address: feeAddress })
            .then(checkout => {
                const discount = Number(checkout?.discount || 0);
                const subtotalRaw = Number(checkout?.subtotal);
                const totalRaw = Number(checkout?.total);
                const lineItems = Array.isArray(checkout?.lineItems) ? checkout.lineItems : [];
                const hasLineItems = lineItems.length > 0;
                const hasNonZero = (Number.isFinite(totalRaw) && totalRaw > 0)
                    || (Number.isFinite(subtotalRaw) && subtotalRaw > 0)
                    || discount > 0;
                const useCheckout = hasNonZero && (hasLineItems || total === 0);
                const appliedPromos = Array.isArray(checkout?.appliedPromotions) && checkout.appliedPromotions.length > 0
                    ? checkout.appliedPromotions
                    : (checkout?.appliedPromotion ? [checkout.appliedPromotion] : []);
                const hasPromo = appliedPromos.length > 0 && discount > 0;

                if (useCheckout) {
                    window.currentCheckout = checkout;
                    const subtotal = Number.isFinite(subtotalRaw) ? subtotalRaw : total;
                    const deliveryFee = Number(checkout?.delivery_fee || checkout?.deliveryFee || 0);
                    const finalTotal = Number.isFinite(totalRaw) ? totalRaw : (subtotal - discount + deliveryFee);

                    if (barSubtotalEl) barSubtotalEl.textContent = `Ks ${subtotal.toFixed(2)}`;
                    if (barDiscountEl) barDiscountEl.textContent = `-Ks ${discount.toFixed(2)}`;
                    if (barDiscountRowEl) barDiscountRowEl.style.display = hasPromo ? 'flex' : 'none';

                    const isDelivery = String(deliveryType || '').toLowerCase() === 'delivery';
                    if (barDeliveryFeeRowEl) barDeliveryFeeRowEl.style.display = isDelivery ? 'flex' : 'none';
                    if (barDeliveryFeeEl) barDeliveryFeeEl.textContent = `Ks ${Number(deliveryFee).toFixed(2)}`;

                    if (barTotalEl) barTotalEl.textContent = `Ks ${Number(finalTotal).toFixed(2)}`;
                    if (barCheckoutEl) barCheckoutEl.textContent = `Checkout • Ks ${Number(finalTotal).toFixed(2)}`;
                    if (barSavingsEl) {
                        barSavingsEl.style.display = 'none';
                        barSavingsEl.textContent = '';
                    }

                    const placeBtn = document.getElementById('placeOrderBtn');
                    const placeSpan = placeBtn ? placeBtn.querySelector('span') : null;
                    if (placeSpan) {
                        const base = window.__pendingPreorder ? 'Place Custom Cake Order' : 'Place Order';
                        placeSpan.textContent = `${base} • Ks ${Number(finalTotal).toFixed(2)}`;
                    }

                    if (pendingSchedule && barTotalEl) {
                        barTotalEl.textContent = `Ks ${Number(finalTotal).toFixed(2)}`;
                    }
                    return;
                }

                window.currentCheckout = null;
                if (barSubtotalEl) barSubtotalEl.textContent = `Ks ${total.toFixed(2)}`;
                if (barDiscountEl) barDiscountEl.textContent = `-Ks ${(0).toFixed(2)}`;
                if (barDiscountRowEl) barDiscountRowEl.style.display = 'none';
                if (barDeliveryFeeRowEl) barDeliveryFeeRowEl.style.display = 'none';
                if (barDeliveryFeeEl) barDeliveryFeeEl.textContent = `Ks ${(0).toFixed(2)}`;
                if (barTotalEl) barTotalEl.textContent = `Ks ${total.toFixed(2)}`;
                if (barCheckoutEl) barCheckoutEl.textContent = `Checkout • Ks ${total.toFixed(2)}`;
                if (barSavingsEl) {
                    barSavingsEl.style.display = 'none';
                    barSavingsEl.textContent = '';
                }
                if (pendingSchedule && barTotalEl) {
                    barTotalEl.textContent = `Ks ${total.toFixed(2)}`;
                }
            })
            .catch(() => {
                if (barSubtotalEl) barSubtotalEl.textContent = `Ks ${total.toFixed(2)}`;
                if (barDiscountEl) barDiscountEl.textContent = `-Ks ${(0).toFixed(2)}`;
                if (barDiscountRowEl) barDiscountRowEl.style.display = 'none';
                if (barTotalEl) barTotalEl.textContent = `Ks ${total.toFixed(2)}`;
                if (barCheckoutEl) barCheckoutEl.textContent = `Checkout • Ks ${total.toFixed(2)}`;
                if (barSavingsEl) {
                    barSavingsEl.style.display = 'none';
                    barSavingsEl.innerHTML = '';
                }
                if (pendingSchedule && barTotalEl) {
                    const when = `${pendingSchedule.date} ${pendingSchedule.time}`;
                    barTotalEl.textContent = `Ks ${total.toFixed(2)}`;
                }
            });
    } else {
        window.currentCheckout = null;
        if (barSubtotalEl) barSubtotalEl.textContent = `Ks ${total.toFixed(2)}`;
        if (barDiscountEl) barDiscountEl.textContent = `-Ks ${(0).toFixed(2)}`;
        if (barDiscountRowEl) barDiscountRowEl.style.display = 'none';
        if (barTotalEl) barTotalEl.textContent = `Ks ${total.toFixed(2)}`;
        if (barCheckoutEl) barCheckoutEl.textContent = `Checkout • Ks ${total.toFixed(2)}`;
        if (barSavingsEl) {
            barSavingsEl.style.display = 'none';
            barSavingsEl.innerHTML = '';
        }
        if (pendingSchedule && barTotalEl) {
            const when = `${pendingSchedule.date} ${pendingSchedule.time}`;
            barTotalEl.textContent = `Ks ${total.toFixed(2)}`;
        }
    }
    
    adjustSafePadding();
    if (typeof window.renderPromotionBanner === 'function') {
        window.renderPromotionBanner();
    }
    
    // Update cart items sheet if open
    if (window.renderCartItemsList && document.querySelector('#cartItemsSheet.active')) {
        window.renderCartItemsList();
    }

    // Update order type badge
    updateOrderTypeBadge();
}

/**
 * Detect the order type from cart contents and schedule
 * Returns: 'regular', 'custom', or 'scheduled'
 */
function detectOrderType() {
    // Check if any cart item has "Custom Cake" in its note (product-based detection)
    const hasCustomItem = cartItems.some(item => {
        const note = String(item.note || '').toLowerCase();
        return note.startsWith('custom cake') || note.startsWith('preorder');
    });
    if (hasCustomItem) return 'custom';

    // Check if a schedule is pending
    if (pendingSchedule && pendingSchedule.date && pendingSchedule.time) {
        return 'scheduled';
    }

    return 'regular';
}

/**
 * Update the order type badge in the cart bar
 */
function updateOrderTypeBadge() {
    const badge = document.getElementById('orderTypeBadge');
    if (!badge) return;

    const itemCount = cartItems.reduce((sum, item) => sum + item.qty, 0);
    if (itemCount === 0) {
        badge.style.display = 'none';
        return;
    }

    const orderType = detectOrderType();
    badge.style.display = 'flex';

    switch (orderType) {
        case 'custom':
            badge.className = 'order-type-badge badge-custom';
            badge.innerHTML = '🎂 Custom Cake Order — <em>Made to order</em>';
            break;
        case 'scheduled':
            badge.className = 'order-type-badge badge-scheduled badge-interactive';
            const schedDate = pendingSchedule ? pendingSchedule.date : '';
            const schedTime = pendingSchedule ? pendingSchedule.time : '';
            let whenText = '';
            if (schedDate && schedTime) {
                const dt = new Date(`${schedDate}T${schedTime}:00`);
                if (!isNaN(dt.getTime())) {
                    whenText = dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                } else {
                    whenText = `${schedDate} ${schedTime}`;
                }
            }
            badge.innerHTML = `
                <span class="badge-edit-area" title="Tap to change">
                    ⏰ Scheduled: <strong>${whenText || 'Not set'}</strong>
                    <span class="badge-edit-hint">(tap to change)</span>
                </span>
                <button class="badge-clear-btn" title="Remove schedule" aria-label="Remove schedule">✕ Clear</button>
            `;
            // Wire up edit (tap badge text to reopen schedule sheet)
            const editArea = badge.querySelector('.badge-edit-area');
            if (editArea) {
                editArea.onclick = (e) => {
                    e.stopPropagation();
                    const dateEl = document.getElementById('scheduleDate');
                    const timeEl = document.getElementById('scheduleTime');
                    if (dateEl) { dateEl.min = ''; dateEl.max = ''; dateEl.value = schedDate || ''; }
                    if (timeEl) timeEl.value = schedTime || '';
                    if (typeof openSheet === 'function') openSheet('scheduleSheet');
                };
            }
            // Wire up clear (X button removes schedule)
            const clearBtn = badge.querySelector('.badge-clear-btn');
            if (clearBtn) {
                clearBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (window.setPendingSchedule) window.setPendingSchedule(null);
                    const userId = typeof getUserId === 'function' ? getUserId() : '';
                    if (userId) localStorage.removeItem(`pending_schedule_${userId}`);
                    window.updateCart();
                    if (window.showToast) window.showToast('Schedule removed', 'success');
                };
            }
            break;
        default:
            badge.className = 'order-type-badge badge-regular';
            badge.innerHTML = '🛒 Regular Order — <em>Ready today</em>';
            break;
    }
}

window.detectOrderType = detectOrderType;

function getCart() {
    return cart;
}

function setCart(newCart) {
    cart = newCart;
    // Convert legacy cart to cartItems format
    cartItems = [];
    Object.keys(cart).forEach(productId => {
        const qty = cart[productId];
        if (qty > 0) {
            cartItems.push({
                id: generateCartItemId(),
                productId: parseInt(productId),
                qty: qty,
                note: ''
            });
        }
    });
}

function getPendingSchedule() {
    return pendingSchedule;
}

function setPendingSchedule(schedule) {
    pendingSchedule = schedule;
}

function clearCart() {
    console.log('clearCart called, cart:', cart);
    if (cartItems.length === 0 && Object.keys(cart).length === 0) {
        showToast('Cart is already empty');
        return;
    }
    cart = {};
    cartItems = [];
    updateCart();
    showToast('Cart cleared', 'success');
}

/**
 * Get cart items formatted for order submission
 * Returns array with product info, notes, and images
 */
function getCartItemsForOrder() {
    return cartItems.map(item => {
        const product = getProductById(item.productId);
        const extra = extractPreorderExtraFromNote(item.note);
        return {
            product_id: item.productId,
            name: product?.name || '',
            qty: item.qty,
            price: (Number(product?.price || 0) + extra),
            note: item.note || '',
            image_url: product?.image_url || ''
        };
    });
}

/**
 * Check if any cart item has a note
 */
function cartHasNotes() {
    return cartItems.some(item => item.note && item.note.trim());
}

// Export
window.increaseQty = increaseQty;
window.decreaseQty = decreaseQty;
window.updateCart = updateCart;
window.getCart = getCart;
window.setCart = setCart;
window.getPendingSchedule = getPendingSchedule;
window.setPendingSchedule = setPendingSchedule;
window.clearCart = clearCart;
window.addToCartWithNote = addToCartWithNote;
window.updateCartItem = updateCartItem;
window.getCartItem = getCartItem;
window.getCartItems = getCartItems;
window.removeCartItem = removeCartItemById;
window.getCartItemsForOrder = getCartItemsForOrder;
window.cartHasNotes = cartHasNotes;
window.getProductById = getProductById;
