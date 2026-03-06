/**
 * BakeFlow - Product Detail Module
 * Handles product detail sheet for GrabFood/Uber Eats style add-to-cart UX
 */

// State for product detail sheet
let currentProductSheet = {
    product: null,
    quantity: 1,
    note: '',
    editingCartItemId: null // For editing existing cart items
};

function getProductAvailableStock(product) {
    const stockInfo = window.stockStatus && window.stockStatus[product.id];
    if (stockInfo && Number.isFinite(stockInfo.available_stock)) return stockInfo.available_stock;
    if (Number.isFinite(product.stock)) return product.stock;
    return null;
}

function isProductOutOfStock(product) {
    const stockInfo = window.stockStatus && window.stockStatus[product.id];
    if (stockInfo && stockInfo.status === 'out_of_stock') return true;
    if (product.availability_status === 'sold_out') return true;
    if (Number.isFinite(product.stock) && product.stock <= 0) return true;
    return false;
}

function getEffectiveUnitPriceForProduct(product) {
    if (!product) return 0;
    const promo = typeof window.getBestPromotionForProduct === 'function'
        ? window.getBestPromotionForProduct(product.id)
        : null;
    if (promo && promo.type === 'PERCENT_OFF' && promo.percent > 0 && promo.percent <= 100) {
        return product.price * (1 - (promo.percent / 100));
    }
    return product.price;
}

function formatMoneyKs(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'Ks 0.00';
    return `Ks ${num.toFixed(2)}`;
}

function renderProductSheetPrice(product) {
    const promo = typeof window.getBestPromotionForProduct === 'function'
        ? window.getBestPromotionForProduct(product.id)
        : null;
    if (promo && promo.type === 'PERCENT_OFF' && promo.percent > 0 && promo.percent <= 100) {
        const discounted = product.price * (1 - (promo.percent / 100));
        return `<div class="p-price-wrap"><div class="p-price p-price--promo">${formatMoneyKs(discounted)}</div><div class="p-price-old">${formatMoneyKs(product.price)}</div></div>`;
    }
    return formatMoneyKs(product.price);
}

/**
 * Open product detail sheet
 * @param {number} productId - Product ID
 * @param {string|null} editCartItemId - If editing existing cart item
 */
function openProductDetail(productId, editCartItemId = null) {
    const product = window.products?.find(p => p.id == productId);
    if (!product) {
        showToast('Product not found');
        return;
    }
    
    const remainingStock = window.getRemainingStockForProduct?.(product.id, { excludeCartItemId: editCartItemId }) ?? getProductAvailableStock(product);
    if (isProductOutOfStock(product) || (remainingStock !== null && remainingStock <= 0)) {
        showToast('This item is sold out');
        return;
    }
    
    // Reset or load state
    currentProductSheet.product = product;
    currentProductSheet.editingCartItemId = editCartItemId;
    
    if (editCartItemId) {
        // Editing existing cart item
        const cartItem = window.getCartItem?.(editCartItemId);
        if (cartItem) {
            currentProductSheet.quantity = cartItem.qty;
            currentProductSheet.note = cartItem.note || '';
        }
    } else {
        // New item - start with qty 1
        currentProductSheet.quantity = 1;
        currentProductSheet.note = '';
    }

    if (remainingStock !== null) {
        if (remainingStock <= 0) {
            currentProductSheet.quantity = 0;
        } else if (currentProductSheet.quantity > remainingStock) {
            currentProductSheet.quantity = remainingStock;
        }
    }
    
    // Populate sheet UI
    const img = product.image_url || 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&h=200&fit=crop';
    document.getElementById('productSheetImage').src = img;
    document.getElementById('productSheetName').textContent = product.name;
    document.getElementById('productSheetDesc').textContent = product.description || '';
    document.getElementById('productSheetPrice').innerHTML = renderProductSheetPrice(product);
    document.getElementById('productItemNote').value = currentProductSheet.note;
    document.getElementById('productSheetQty').textContent = currentProductSheet.quantity;
    
    // Update button text for edit mode
    const addBtn = document.getElementById('productSheetAddBtn');
    const addBtnText = addBtn.querySelector('.product-add-btn-text');
    if (editCartItemId) {
        addBtnText.textContent = 'Update cart';
    } else {
        addBtnText.textContent = 'Add to cart';
    }
    
    // Update total price
    updateProductSheetTotal();
    
    // Update minus button state
    updateProductSheetButtons();
    
    // Open the sheet
    openSheet('productDetailSheet');
}

/**
 * Close product detail sheet
 */
function closeProductDetail() {
    closeSheets();
    currentProductSheet = {
        product: null,
        quantity: 1,
        note: '',
        editingCartItemId: null
    };
}

/**
 * Increase quantity in product sheet
 */
function increaseProductSheetQty() {
    const availableStock = currentProductSheet.product
        ? window.getRemainingStockForProduct?.(currentProductSheet.product.id, { excludeCartItemId: currentProductSheet.editingCartItemId })
        : null;
    if (availableStock !== null && currentProductSheet.quantity >= availableStock) {
        updateProductSheetButtons();
        return;
    }
    if (currentProductSheet.quantity < 99) {
        currentProductSheet.quantity++;
        document.getElementById('productSheetQty').textContent = currentProductSheet.quantity;
        updateProductSheetTotal();
        updateProductSheetButtons();
        
        // Micro-interaction
        const btn = document.getElementById('productSheetIncBtn');
        btn.style.transform = 'scale(0.9)';
        setTimeout(() => btn.style.transform = '', 100);
    }
}

/**
 * Decrease quantity in product sheet
 */
function decreaseProductSheetQty() {
    if (currentProductSheet.quantity > 1) {
        currentProductSheet.quantity--;
        document.getElementById('productSheetQty').textContent = currentProductSheet.quantity;
        updateProductSheetTotal();
        updateProductSheetButtons();
        
        // Micro-interaction
        const btn = document.getElementById('productSheetDecBtn');
        btn.style.transform = 'scale(0.9)';
        setTimeout(() => btn.style.transform = '', 100);
    }
}

/**
 * Update total price display
 */
function updateProductSheetTotal() {
    if (!currentProductSheet.product) return;
    const unit = getEffectiveUnitPriceForProduct(currentProductSheet.product);
    const total = unit * currentProductSheet.quantity;
    document.getElementById('productSheetTotalPrice').textContent = formatMoneyKs(total);
}

/**
 * Update button states (disable minus at qty 1)
 */
function updateProductSheetButtons() {
    const decBtn = document.getElementById('productSheetDecBtn');
    const incBtn = document.getElementById('productSheetIncBtn');
    const addBtn = document.getElementById('productSheetAddBtn');
    const stockHint = document.getElementById('productSheetStockHint');
    const availableStock = currentProductSheet.product
        ? window.getRemainingStockForProduct?.(currentProductSheet.product.id, { excludeCartItemId: currentProductSheet.editingCartItemId })
        : getProductAvailableStock(currentProductSheet.product || {});
    const outOfStock = currentProductSheet.product ? isProductOutOfStock(currentProductSheet.product) : false;
    if (decBtn) decBtn.disabled = currentProductSheet.quantity <= 1;
    if (incBtn) incBtn.disabled = outOfStock || (availableStock !== null && currentProductSheet.quantity >= availableStock);
    if (addBtn) addBtn.disabled = outOfStock || currentProductSheet.quantity <= 0 || (availableStock !== null && currentProductSheet.quantity > availableStock);
    if (stockHint) {
        if (outOfStock || (availableStock !== null && availableStock <= 0)) {
            stockHint.textContent = 'Out of stock';
            stockHint.style.display = 'block';
        } else {
            stockHint.textContent = '';
            stockHint.style.display = 'none';
        }
    }
}

/**
 * Append note suggestion to input
 */
function appendProductNote(note) {
    const input = document.getElementById('productItemNote');
    const current = input.value.trim();
    if (current) {
        // Check if note already exists
        if (!current.toLowerCase().includes(note.toLowerCase())) {
            input.value = current + ', ' + note;
        }
    } else {
        input.value = note;
    }
    currentProductSheet.note = input.value;
    
    // Visual feedback
    input.style.borderColor = 'var(--primary)';
    setTimeout(() => input.style.borderColor = '', 200);
}

/**
 * Confirm add to cart from product detail sheet
 */
function confirmAddToCart() {
    if (!currentProductSheet.product) return;

    const availableStock = getProductAvailableStock(currentProductSheet.product);
    if (isProductOutOfStock(currentProductSheet.product) || (availableStock !== null && availableStock <= 0)) {
        showToast('This item is out of stock');
        updateProductSheetButtons();
        return;
    }
    if (availableStock !== null && currentProductSheet.quantity > availableStock) {
        currentProductSheet.quantity = availableStock;
        document.getElementById('productSheetQty').textContent = currentProductSheet.quantity;
        updateProductSheetTotal();
        updateProductSheetButtons();
        return;
    }
    
    const note = document.getElementById('productItemNote').value.trim();
    currentProductSheet.note = note;
    
    if (currentProductSheet.editingCartItemId) {
        // Update existing cart item
        window.updateCartItem(
            currentProductSheet.editingCartItemId,
            currentProductSheet.quantity,
            currentProductSheet.note
        );
        showToast('Cart updated', 'success');
    } else {
        // Add new item to cart
        window.addToCartWithNote(
            currentProductSheet.product.id,
            currentProductSheet.quantity,
            currentProductSheet.note
        );
        showToast(`Added ${currentProductSheet.quantity}× ${currentProductSheet.product.name}`, 'success');
    }
    
    closeProductDetail();
}

/**
 * Quick add to cart (no sheet, for products without customization)
 */
function quickAddToCart(productId) {
    const product = window.products?.find(p => p.id == productId);
    if (!product) return;
    
    const availableStock = getProductAvailableStock(product);
    if (isProductOutOfStock(product) || (availableStock !== null && availableStock <= 0)) {
        showToast('This item is sold out');
        return;
    }
    
    // Add directly to cart with qty 1, no note
    window.addToCartWithNote(productId, 1, '');
    
    // Visual feedback on the card
    const card = document.querySelector(`[data-product-id="${productId}"]`);
    if (card) {
        card.classList.add('in-cart');
        card.style.transform = 'scale(0.98)';
        setTimeout(() => card.style.transform = '', 150);
    }
}

/**
 * Open cart items sheet to view/edit all items
 */
function openCartItemsSheet() {
    renderCartItemsList();
    openSheet('cartItemsSheet');
}

/**
 * Render cart items list in the sheet
 */
function renderCartItemsList() {
    const container = document.getElementById('cartItemsList');
    const cartItems = window.getCartItems?.() || [];
    
    if (!cartItems.length) {
        container.innerHTML = `
            <div class="cart-empty">
                <div class="cart-empty-icon">
                    <i data-lucide="shopping-bag"></i>
                </div>
                <div class="cart-empty-text">Your cart is empty</div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const checkoutLines = Array.isArray(window.currentCheckout?.lineItems) ? window.currentCheckout.lineItems : [];
    const checkoutByClientLineId = new Map();
    const checkoutByProductId = new Map();
    const checkoutUsed = new Set();
    checkoutLines.forEach(li => {
        if (!li) return;
        const clientLineId = li.clientLineId != null ? String(li.clientLineId) : '';
        if (clientLineId) checkoutByClientLineId.set(clientLineId, li);

        const pid = Number(li.productId);
        if (!Number.isFinite(pid)) return;
        if (!checkoutByProductId.has(pid)) checkoutByProductId.set(pid, []);
        checkoutByProductId.get(pid).push(li);
    });

    const getCheckoutLineForCartItem = (item) => {
        const id = item?.id != null ? String(item.id) : '';
        if (id && checkoutByClientLineId.has(id)) return checkoutByClientLineId.get(id);

        const pid = Number(item?.productId);
        if (!Number.isFinite(pid)) return null;
        const options = checkoutByProductId.get(pid) || [];
        for (const li of options) {
            if (!checkoutUsed.has(li)) {
                checkoutUsed.add(li);
                return li;
            }
        }
        return null;
    };

    const renderCheckoutDiscountTags = (li) => {
        const discounts = Array.isArray(li?.discounts) ? li.discounts : [];
        const tags = [];

        for (const d of discounts) {
            if (!d) continue;
            const discountType = String(d.discountType || '').toUpperCase();
            const qty = Number(d.qty || 0);
            const percent = Number(d.percent || d.discountPercent || 0);
            const fixedPrice = Number(d.fixedPrice || 0);

            if (discountType === 'FREE') {
                const qtyText = qty > 0 ? ` ×${qty}` : '';
                tags.push(`<div class="cart-item-promo-tag cart-item-promo-tag--free">FREE${qtyText}</div>`);
                continue;
            }
            if (discountType === 'PERCENT_OFF') {
                const pct = percent > 0 ? `${percent.toFixed(0)}% OFF` : 'Discount';
                const qtyText = qty > 0 ? ` ×${qty}` : '';
                tags.push(`<div class="cart-item-promo-tag cart-item-promo-tag--percent">${escapeHtml(`${pct}${qtyText}`)}</div>`);
                continue;
            }
            if (discountType === 'FIXED_PRICE') {
                const base = fixedPrice > 0 ? `Ks ${fixedPrice.toFixed(2)}` : 'Deal';
                const qtyText = qty > 0 ? ` ×${qty}` : '';
                tags.push(`<div class="cart-item-promo-tag cart-item-promo-tag--percent">${escapeHtml(`${base}${qtyText}`)}</div>`);
            }
        }

        return tags.join('');
    };

    const discount = Number(window.currentCheckout?.discount || 0);
    const appliedPromos = Array.isArray(window.currentCheckout?.appliedPromotions) && window.currentCheckout.appliedPromotions.length > 0
        ? window.currentCheckout.appliedPromotions
        : (window.currentCheckout?.appliedPromotion ? [window.currentCheckout.appliedPromotion] : []);
    const hasAnyApplied = appliedPromos.length > 0 && discount > 0;

    const appliedPercentPromo = appliedPromos.find(p => p && p.type === 'PERCENT_OFF') || null;
    const appliedBogoPromo = appliedPromos.find(p => p && p.type === 'BUY_X_GET_Y') || null;

    const appliedPercent = appliedPercentPromo ? Number(appliedPercentPromo.percent || 0) : 0;
    const appliedEligibleIds = Array.isArray(appliedPercentPromo?.selectedProductIds) ? appliedPercentPromo.selectedProductIds.map(Number) : [];
    const appliedAll = appliedPercentPromo?.appliesToAllProducts === true || appliedEligibleIds.length === 0;
    const appliedEligibleSet = new Set(appliedEligibleIds.filter(n => Number.isFinite(n)));

    const appliedPromoFull = appliedBogoPromo && typeof window.getPromotionById === 'function'
        ? window.getPromotionById(appliedBogoPromo.id)
        : null;
    const appliedRules = appliedPromoFull && typeof window.parsePromotionRules === 'function'
        ? window.parsePromotionRules(appliedPromoFull.rules)
        : {};
    const appliedBuyQty = appliedBogoPromo
        ? (Number(appliedBogoPromo.buyQty ?? appliedPromoFull?.buyQty ?? appliedRules.buyQty) || 0)
        : 0;
    const appliedGetQty = appliedBogoPromo
        ? (Number(appliedBogoPromo.getQty ?? appliedPromoFull?.getQty ?? appliedRules.getQty) || 0)
        : 0;
    const appliedDiscountType = appliedBogoPromo
        ? String(appliedBogoPromo.discountType ?? appliedPromoFull?.discountType ?? appliedRules.discountType ?? 'FREE').toUpperCase()
        : '';
    const appliedDiscountPercent = appliedBogoPromo
        ? (Number(appliedBogoPromo.discountPercent ?? appliedPromoFull?.discountPercent ?? appliedRules.discountPercent) || 0)
        : 0;
    const appliedFixedPrice = appliedBogoPromo
        ? (Number(appliedBogoPromo.fixedPrice ?? appliedPromoFull?.fixedPrice ?? appliedRules.fixedPrice) || 0)
        : 0;
    const appliedBuyProductIds = appliedBogoPromo
        ? (Array.isArray(appliedBogoPromo.buyProductIds) && appliedBogoPromo.buyProductIds.length > 0
            ? appliedBogoPromo.buyProductIds.map(Number)
            : (Array.isArray(appliedPromoFull?.buyProductIds) && appliedPromoFull.buyProductIds.length > 0
                ? appliedPromoFull.buyProductIds.map(Number)
                : (Array.isArray(appliedRules.buyProductIds) ? appliedRules.buyProductIds.map(Number) : [])))
        : [];
    const appliedGetProductIds = appliedBogoPromo
        ? (Array.isArray(appliedBogoPromo.getProductIds) && appliedBogoPromo.getProductIds.length > 0
            ? appliedBogoPromo.getProductIds.map(Number)
            : (Array.isArray(appliedPromoFull?.getProductIds) && appliedPromoFull.getProductIds.length > 0
                ? appliedPromoFull.getProductIds.map(Number)
                : (Array.isArray(appliedRules.getProductIds) ? appliedRules.getProductIds.map(Number) : [])))
        : [];

    const appliedEligibleProductId = Number(appliedBogoPromo?.eligibleProductId || 0) || 0;
    const appliedHasBuyGetIds = !!appliedBogoPromo && (appliedBuyProductIds.length > 0 || appliedGetProductIds.length > 0);

    const appliedBuySet = new Set(appliedBuyProductIds.filter(n => Number.isFinite(n)));
    const appliedGetSetRaw = new Set(appliedGetProductIds.filter(n => Number.isFinite(n)));
    const appliedOverlapIds = [...appliedGetSetRaw].filter(id => appliedBuySet.has(id));
    const appliedAllGetInBuy = appliedOverlapIds.length > 0 && appliedOverlapIds.length === appliedGetSetRaw.size;
    const appliedIsSameItemBogo = !!appliedBogoPromo
        && appliedBuyQty > 0
        && appliedGetQty > 0
        && (appliedEligibleProductId > 0 || (appliedHasBuyGetIds && appliedAllGetInBuy));
    const appliedSameItemEligibleSet = new Set(
        appliedIsSameItemBogo
            ? (appliedEligibleProductId > 0 ? [appliedEligibleProductId] : appliedOverlapIds)
            : []
    );

    const appliedGetSet = appliedIsSameItemBogo
        ? appliedGetSetRaw
        : new Set([...appliedGetSetRaw].filter(id => !appliedBuySet.has(id)));
    const appliedHasNewBuyGet = appliedHasBuyGetIds && !appliedIsSameItemBogo;
    const firstAppliedBuyName = appliedBuySet.size === 1
        ? (window.products?.find(p => Number(p.id) === Number([...appliedBuySet][0]))?.name || '')
        : '';
    const firstAppliedGetName = appliedGetSet.size === 1
        ? (window.products?.find(p => Number(p.id) === Number([...appliedGetSet][0]))?.name || '')
        : '';
    const appliedGroupSize = appliedBuyQty + appliedGetQty;
    const appliedBogoProductIds = appliedBogoPromo
        ? (Array.isArray(appliedBogoPromo.selectedProductIds) ? appliedBogoPromo.selectedProductIds.map(Number) : [])
        : [];
    const appliedBogoSet = new Set(appliedBogoProductIds.filter(n => Number.isFinite(n)));

    const showBogoProgress = !appliedBogoPromo;

    const bogoPromos = showBogoProgress && typeof window.getActivePromotions === 'function'
        ? window.getActivePromotions().filter(p => p && p.type === 'BUY_X_GET_Y')
        : [];
    const appliesToProduct = typeof window.promotionAppliesToProduct === 'function'
        ? window.promotionAppliesToProduct
        : () => true;

    function getBestBogoForProduct(productId) {
        const applicable = bogoPromos
            .filter(p => appliesToProduct(p, productId))
            .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
        const promo = applicable[0];
        if (!promo) return null;
        const rules = typeof window.parsePromotionRules === 'function' ? window.parsePromotionRules(promo.rules) : {};
        const hasNewBuyGetConfig =
            (Array.isArray(promo.buyProductIds) && promo.buyProductIds.length > 0) ||
            (Array.isArray(promo.getProductIds) && promo.getProductIds.length > 0) ||
            (Array.isArray(rules.buyProductIds) && rules.buyProductIds.length > 0) ||
            (Array.isArray(rules.getProductIds) && rules.getProductIds.length > 0);
        if (hasNewBuyGetConfig) return null;
        const buyQty = Number(promo.buyQty ?? rules.buyQty) || 0;
        const getQty = Number(promo.getQty ?? rules.getQty) || 0;
        if (!buyQty || !getQty) return null;
        return { id: promo.id, buyQty, getQty };
    }

    const qtyByProduct = new Map();
    cartItems.forEach(it => {
        const pid = Number(it.productId);
        if (!Number.isFinite(pid)) return;
        qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + Number(it.qty || 0));
    });

    const unitPriceByProduct = new Map();
    qtyByProduct.forEach((_, pid) => {
        const product = window.getProductById
            ? window.getProductById(pid)
            : window.products?.find(p => Number(p.id) === Number(pid));
        unitPriceByProduct.set(pid, Number(product?.price || 0));
    });

    const bxgyDiscountAllocation = new Map();
    let bxgyBuyCount = 0;
    let bxgyGetCount = 0;
    let bxgyDiscountTotalQty = 0;
    let bxgyMaxDiscountQty = 0;

    if (hasAnyApplied && !!appliedBogoPromo && appliedHasNewBuyGet && appliedBuyQty > 0 && appliedGetQty > 0) {
        const buySet = appliedBuySet;
        const getSet = appliedGetSet;
        qtyByProduct.forEach((qty, pid) => {
            if (buySet.size === 0 || buySet.has(pid)) bxgyBuyCount += Number(qty || 0);
            if (getSet.size === 0 || getSet.has(pid)) bxgyGetCount += Number(qty || 0);
        });

        const sets = Math.floor(bxgyBuyCount / appliedBuyQty);
        bxgyMaxDiscountQty = sets * appliedGetQty;
        bxgyDiscountTotalQty = Math.min(bxgyGetCount, bxgyMaxDiscountQty);

        const savingsPerUnitForPid = (pid) => {
            const unitPrice = Number(unitPriceByProduct.get(pid) || 0);
            if (unitPrice <= 0) return 0;
            if (appliedDiscountType === 'PERCENT_OFF') {
                if (appliedDiscountPercent <= 0 || appliedDiscountPercent > 100) return 0;
                return unitPrice * (appliedDiscountPercent / 100);
            }
            if (appliedDiscountType === 'FIXED_PRICE') {
                const savings = unitPrice - appliedFixedPrice;
                return savings > 0 ? savings : 0;
            }
            return unitPrice;
        };

        const getLines = [];
        qtyByProduct.forEach((qty, pid) => {
            if (getSet.size > 0 && !getSet.has(pid)) return;
            const savings = savingsPerUnitForPid(pid);
            if (savings <= 0) return;
            getLines.push({ pid, qty: Number(qty || 0), savingsPerUnit: savings });
        });
        getLines.sort((a, b) => b.savingsPerUnit - a.savingsPerUnit);

        let remaining = bxgyDiscountTotalQty;
        for (const line of getLines) {
            if (remaining <= 0) break;
            const use = Math.min(line.qty, remaining);
            if (use > 0) {
                bxgyDiscountAllocation.set(line.pid, use);
                remaining -= use;
            }
        }
    }

    const resolveProduct = (pid, item) => {
        const found = window.getProductById
            ? window.getProductById(pid)
            : (window.products?.find(p => p.id == pid) || null);
        if (found) return found;
        const note = String(item?.note || '');
        const cakeLine = note.split('\n').map(l => l.trim()).find(l => /^cake:\s*/i.test(l));
        const name = cakeLine ? cakeLine.replace(/^cake:\s*/i, '').trim() : 'Custom Cake';
        return {
            id: pid,
            name: name || 'Custom Cake',
            price: 0,
            image_url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&h=200&fit=crop'
        };
    };

    const groups = [];
    const groupMap = new Map();
    cartItems.forEach(it => {
        const pid = Number(it.productId);
        if (!Number.isFinite(pid)) return;
        if (!groupMap.has(pid)) {
            const product = resolveProduct(pid, it);
            const entry = { productId: pid, product, items: [], totalQty: 0 };
            groupMap.set(pid, entry);
            groups.push(entry);
        }
        const g = groupMap.get(pid);
        g.items.push(it);
        g.totalQty += Number(it.qty || 0);
    });

    container.innerHTML = groups.map(group => {
        const product = group.product;
        const img = product.image_url || 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&h=200&fit=crop';
        const unitPrice = Number(product.price || 0);

        const isPercentAppliedToProduct = hasAnyApplied && !!appliedPercentPromo
            && appliedPercent > 0
            && (appliedAll || appliedEligibleSet.has(Number(group.productId)));

        const isLegacyBogoAppliedToProduct = hasAnyApplied && !!appliedBogoPromo && !appliedHasNewBuyGet && !appliedIsSameItemBogo
            && appliedBuyQty > 0
            && appliedGetQty > 0
            && appliedGroupSize > 0
            && (appliedBogoSet.size === 0 || appliedBogoSet.has(Number(group.productId)));

        const isSameItemBogoAppliedToProduct = hasAnyApplied && !!appliedBogoPromo && appliedIsSameItemBogo
            && appliedBuyQty > 0
            && appliedGetQty > 0
            && appliedGroupSize > 0
            && appliedSameItemEligibleSet.has(Number(group.productId));

        const isBogoAppliedToProduct = isLegacyBogoAppliedToProduct || isSameItemBogoAppliedToProduct;

        const freeTotal = isBogoAppliedToProduct
            ? (Math.floor(group.totalQty / appliedGroupSize) * appliedGetQty)
            : 0;
        const remainder = isBogoAppliedToProduct ? (group.totalQty % appliedGroupSize) : 0;

        const bestBogo = showBogoProgress ? getBestBogoForProduct(group.productId) : null;
        const bestBogoGroupSize = bestBogo ? (bestBogo.buyQty + bestBogo.getQty) : 0;
        const bestBogoFree = bestBogo && bestBogoGroupSize > 0 ? (Math.floor(group.totalQty / bestBogoGroupSize) * bestBogo.getQty) : 0;
        const bestBogoRemainder = bestBogo && bestBogoGroupSize > 0 ? (group.totalQty % bestBogoGroupSize) : 0;

        let groupPromoLine = '';
        if (isBogoAppliedToProduct && group.totalQty > 0 && freeTotal === 0 && group.totalQty < appliedGroupSize) {
            groupPromoLine = `Add ${appliedGroupSize - group.totalQty} more to get ${appliedGetQty} free`;
        } else if (isBogoAppliedToProduct && freeTotal > 0) {
            groupPromoLine = `Buy ${appliedBuyQty} Get ${appliedGetQty} applied: ${freeTotal} item${freeTotal === 1 ? '' : 's'} free`;
            if (remainder > 0) {
                groupPromoLine += ` · Add ${appliedGroupSize - remainder} more for ${appliedGetQty} more`;
            }
        } else if (hasAnyApplied && !!appliedBogoPromo && appliedHasNewBuyGet) {
            const pid = Number(group.productId);
            const discountedForGroup = Number(bxgyDiscountAllocation.get(pid) || 0);
            const isBuyGroup = appliedBuySet.size === 0 || appliedBuySet.has(pid);
            const isGetGroup = appliedGetSet.size === 0 || appliedGetSet.has(pid);

            if (isBuyGroup && !isGetGroup) {
                const getLabel = firstAppliedGetName ? firstAppliedGetName : 'free item';
                const getQtyText = appliedGetQty === 1 ? '' : `${appliedGetQty}× `;
                groupPromoLine = `Buy ${appliedBuyQty} → Get ${getQtyText}${getLabel} FREE`;
            } else if (isGetGroup) {
                const buyLabel = firstAppliedBuyName ? firstAppliedBuyName : 'qualifying item';
                groupPromoLine = `Free with ${buyLabel}`;
                if (discountedForGroup > 0 && appliedDiscountType !== 'FREE') {
                    if (appliedDiscountType === 'PERCENT_OFF') {
                        groupPromoLine += ` · ${discountedForGroup} at ${appliedDiscountPercent.toFixed(0)}% off`;
                    } else if (appliedDiscountType === 'FIXED_PRICE') {
                        groupPromoLine += ` · ${discountedForGroup} at Ks ${appliedFixedPrice.toFixed(2)}`;
                    }
                } else if (discountedForGroup > 0 && appliedDiscountType === 'FREE') {
                    const itemsLabel = discountedForGroup === 1 ? 'item' : 'items';
                    groupPromoLine += ` · ${discountedForGroup} ${itemsLabel} free`;
                }
            }
        } else if (showBogoProgress && bestBogo && group.totalQty > 0 && bestBogoFree === 0 && group.totalQty < bestBogoGroupSize) {
            groupPromoLine = `Add ${bestBogoGroupSize - group.totalQty} more to get ${bestBogo.getQty} free`;
        }

        let freeRemaining = freeTotal;
        let bxgyRemaining = hasAnyApplied && !!appliedBogoPromo && appliedHasNewBuyGet
            ? Number(bxgyDiscountAllocation.get(Number(group.productId)) || 0)
            : 0;
        return group.items.map((item, idx) => {
            const qty = Number(item.qty || 0);
            const oldTotal = unitPrice * qty;

            let priceHtml = `<div class="cart-item-price">Ks ${oldTotal.toFixed(2)}</div>`;
            let promoTagsHtml = '';

            const checkoutLine = getCheckoutLineForCartItem(item);
            if (checkoutLine) {
                const lineSubtotal = Number(checkoutLine.lineSubtotal ?? (Number(checkoutLine.qty || 0) * Number(checkoutLine.unitPrice || 0)));
                const lineTotal = Number(checkoutLine.lineTotal ?? lineSubtotal);
                const hasDiscount = Number(checkoutLine.lineDiscountTotal || 0) > 0 && lineTotal < lineSubtotal;

                if (hasDiscount) {
                    priceHtml = `
                        <div class="cart-item-price-wrap">
                            <div class="cart-item-price cart-item-price--promo">Ks ${lineTotal.toFixed(2)}</div>
                            <div class="cart-item-price-old">Ks ${lineSubtotal.toFixed(2)}</div>
                        </div>
                    `;
                } else {
                    priceHtml = `<div class="cart-item-price">Ks ${(Number.isFinite(lineTotal) ? lineTotal : oldTotal).toFixed(2)}</div>`;
                }

                promoTagsHtml = renderCheckoutDiscountTags(checkoutLine);
            } else if (isPercentAppliedToProduct) {
                const newTotal = oldTotal * (1 - (appliedPercent / 100));
                priceHtml = `
                    <div class="cart-item-price-wrap">
                        <div class="cart-item-price cart-item-price--promo">Ks ${newTotal.toFixed(2)}</div>
                        <div class="cart-item-price-old">Ks ${oldTotal.toFixed(2)}</div>
                    </div>
                `;
                promoTagsHtml = `<div class="cart-item-promo-tag cart-item-promo-tag--percent">${appliedPercent.toFixed(0)}% OFF</div>`;
            } else if (isBogoAppliedToProduct && freeRemaining > 0) {
                const freeForItem = Math.min(qty, freeRemaining);
                freeRemaining -= freeForItem;
                const paidQty = qty - freeForItem;
                const newTotal = unitPrice * paidQty;

                priceHtml = `
                    <div class="cart-item-price-wrap">
                        <div class="cart-item-price cart-item-price--promo">Ks ${newTotal.toFixed(2)}</div>
                        <div class="cart-item-price-old">Ks ${oldTotal.toFixed(2)}</div>
                    </div>
                `;
                promoTagsHtml = `<div class="cart-item-promo-tag cart-item-promo-tag--free">FREE ×${freeForItem}</div>`;
            } else if (bxgyRemaining > 0) {
                const discountedForItem = Math.min(qty, bxgyRemaining);
                bxgyRemaining -= discountedForItem;

                let newTotal = oldTotal;
                let tag = '';
                let tagClass = 'cart-item-promo-tag--free';
                if (appliedDiscountType === 'PERCENT_OFF') {
                    const savingsPerUnit = unitPrice * (appliedDiscountPercent / 100);
                    newTotal = oldTotal - (savingsPerUnit * discountedForItem);
                    tag = `${appliedDiscountPercent.toFixed(0)}% OFF ×${discountedForItem}`;
                    tagClass = 'cart-item-promo-tag--percent';
                } else if (appliedDiscountType === 'FIXED_PRICE') {
                    newTotal = (unitPrice * (qty - discountedForItem)) + (appliedFixedPrice * discountedForItem);
                    tag = `Ks ${appliedFixedPrice.toFixed(2)} ×${discountedForItem}`;
                } else {
                    newTotal = unitPrice * (qty - discountedForItem);
                    tag = `FREE ×${discountedForItem}`;
                }

                if (newTotal < 0) newTotal = 0;

                priceHtml = `
                    <div class="cart-item-price-wrap">
                        <div class="cart-item-price cart-item-price--promo">Ks ${newTotal.toFixed(2)}</div>
                        <div class="cart-item-price-old">Ks ${oldTotal.toFixed(2)}</div>
                    </div>
                `;
                promoTagsHtml = `<div class="cart-item-promo-tag ${tagClass}">${escapeHtml(tag)}</div>`;
            }

            const promoLineHtml = idx === 0 && groupPromoLine
                ? `<div class="cart-item-promo-hint">${escapeHtml(groupPromoLine)}</div>`
                : '';

            const noteHtml = item.note
                ? `<div class="cart-item-note"><i>📝</i> ${escapeHtml(item.note)}</div>`
                : '';

            return `
                <div class="cart-item" data-cart-item-id="${item.id}">
                    <img class="cart-item-image" src="${img}" alt="${escapeHtml(product.name)}">
                    <div class="cart-item-info">
                        <div class="cart-item-name">${escapeHtml(product.name)}</div>
                        ${noteHtml}
                        ${promoTagsHtml}
                        ${promoLineHtml}
                        ${priceHtml}
                    </div>
                    <div class="cart-item-actions">
                        <div class="cart-item-qty">
                            <button class="cart-item-qty-btn dec" onclick="updateCartItemQty('${item.id}', -1)">−</button>
                            <span class="cart-item-qty-num">${qty}</span>
                            <button class="cart-item-qty-btn inc" onclick="updateCartItemQty('${item.id}', 1)">+</button>
                        </div>
                        <button class="cart-item-edit" onclick="editCartItem('${item.id}')">Edit note</button>
                    </div>
                    <button class="cart-item-remove" onclick="removeCartItemFromSheet('${item.id}')" title="Remove">
                        <i data-lucide="x"></i>
                    </button>
                </div>
            `;
        }).join('');
    }).join('');
    
    if (window.lucide) window.lucide.createIcons();
}

/**
 * Update cart item quantity from cart sheet
 */
function updateCartItemQty(cartItemId, delta) {
    const item = window.getCartItem?.(cartItemId);
    if (!item) return;
    
    const newQty = item.qty + delta;
    if (newQty <= 0) {
        removeCartItemFromSheet(cartItemId);
    } else {
        window.updateCartItem(cartItemId, newQty, item.note);
        renderCartItemsList();
    }
}

/**
 * Edit cart item (open product detail with edit mode)
 */
function editCartItem(cartItemId) {
    const item = window.getCartItem?.(cartItemId);
    if (!item) return;
    
    closeSheets();
    setTimeout(() => {
        openProductDetail(item.productId, cartItemId);
    }, 200);
}

/**
 * Remove cart item
 */
function removeCartItemFromSheet(cartItemId) {
    window.removeCartItem?.(cartItemId);
    renderCartItemsList();
    
    const cartItems = window.getCartItems?.() || [];
    if (cartItems.length === 0) {
        closeSheets();
    }
}

// Export functions
window.openProductDetail = openProductDetail;
window.closeProductDetail = closeProductDetail;
window.increaseProductSheetQty = increaseProductSheetQty;
window.decreaseProductSheetQty = decreaseProductSheetQty;
window.appendProductNote = appendProductNote;
window.confirmAddToCart = confirmAddToCart;
window.quickAddToCart = quickAddToCart;
window.openCartItemsSheet = openCartItemsSheet;
window.renderCartItemsList = renderCartItemsList;
window.updateCartItemQty = updateCartItemQty;
window.editCartItem = editCartItem;
window.removeCartItemFromSheet = removeCartItemFromSheet;
