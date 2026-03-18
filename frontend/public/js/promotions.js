/**
 * Promotions Module
 * Handles fetching and displaying active promotions
 */

let activePromotions = [];
let activePromotion = null;
let activeBannerTitle = '';

function parsePromotionRules(rules) {
    if (!rules) return {};
    if (typeof rules === 'string') {
        try {
            return JSON.parse(rules) || {};
        } catch (e) {
            return {};
        }
    }
    return rules;
}

function getPromoPriority(promo) {
    return Number(promo?.priority) || 0;
}

function escapeHtmlSafe(v) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(v);
    return String(v ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getProductNameById(productId) {
    const pid = Number(productId);
    const products = Array.isArray(window.products) ? window.products : [];
    const found = products.find(p => Number(p?.id) === pid);
    if (found && typeof found.name === 'string' && found.name.trim().length > 0) return found.name.trim();
    return null;
}

function getBuyGetIdsForPromo(promo) {
    const rules = parsePromotionRules(promo?.rules);
    let buyProductIds = Array.isArray(promo?.buyProductIds) ? promo.buyProductIds.map(Number) : [];
    let getProductIds = Array.isArray(promo?.getProductIds) ? promo.getProductIds.map(Number) : [];

    if (buyProductIds.length === 0) {
        buyProductIds = Array.isArray(rules.buyProductIds) ? rules.buyProductIds.map(Number) : [];
    }
    if (getProductIds.length === 0) {
        getProductIds = Array.isArray(rules.getProductIds) ? rules.getProductIds.map(Number) : [];
    }

    if (promo?.type === 'BUY_X_GET_Y' && buyProductIds.length === 0 && getProductIds.length === 0) {
        const legacy = Array.isArray(rules.productIds) ? rules.productIds.map(Number) : [];
        buyProductIds = legacy;
        getProductIds = legacy;
    }

    return {
        buyProductIds: buyProductIds.filter(n => Number.isFinite(n)),
        getProductIds: getProductIds.filter(n => Number.isFinite(n))
    };
}

function getBuyGetQtyForPromo(promo, rulesOverride) {
    const rules = rulesOverride || parsePromotionRules(promo?.rules);
    const buyRaw = promo?.buyQty ?? promo?.buy_qty ?? rules?.buyQty ?? rules?.buy_qty;
    const getRaw = promo?.getQty ?? promo?.get_qty ?? rules?.getQty ?? rules?.get_qty;
    return {
        buyQty: Number(buyRaw) || 0,
        getQty: Number(getRaw) || 0
    };
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

function getPromoLabel(product, promo) {
    if (!promo || !product) return null;
    const pid = Number(product.id);
    const rules = parsePromotionRules(promo.rules);

    if (promo.type === 'PERCENT_OFF') {
        const percent = Number(promo.percent ?? rules.percent) || 0;
        if (percent > 0) return `${percent}% OFF`;
        return null;
    }

    if (promo.type === 'BUY_X_GET_Y') {
        const { buyQty, getQty } = getBuyGetQtyForPromo(promo, rules);
        if (!buyQty || !getQty) return null;

        const { buyProductIds, getProductIds } = getBuyGetIdsForPromo(promo);
        const isBuy = buyProductIds.includes(pid);
        const isGet = getProductIds.includes(pid);
        const isSameItem = isBuy && isGet;
        const summary = getCheckoutLineSummaryForProduct(pid);
        const isFreeApplied = summary && summary.freeQty > 0 && (summary.paidQty === 0 || summary.lineTotal === 0);

        if (isFreeApplied) return 'FREE';
        if (isSameItem) return `Buy ${buyQty} Get ${getQty}`;
        if (isBuy || isGet) return 'Promotion';
        return null;
    }

    return null;
}

function getBuyGetRewardText(promo, rules) {
    const discountType = String(rules.discountType || 'FREE').toUpperCase();
    if (discountType === 'PERCENT_OFF') {
        const percent = Number(rules.discountPercent) || 0;
        if (percent > 0) return `${Number(percent).toFixed(0)}% Off`;
        return 'Discount';
    }
    if (discountType === 'FIXED_PRICE') {
        const fixed = Number(rules.fixedPrice);
        if (Number.isFinite(fixed)) return `$${fixed.toFixed(2)}`;
        return 'Discount';
    }
    return 'Free';
}

function getPromoText(product, promo) {
    if (!promo || !product) return null;
    const pid = Number(product.id);
    const rules = parsePromotionRules(promo.rules);

    if (promo.type === 'BUY_X_GET_Y') {
        const { buyQty, getQty } = getBuyGetQtyForPromo(promo, rules);
        if (!buyQty || !getQty) return null;

        const { buyProductIds, getProductIds } = getBuyGetIdsForPromo(promo);
        const isBuy = buyProductIds.includes(pid);
        const isGet = getProductIds.includes(pid);
        const isSameItem = isBuy && isGet;
        const rewardText = getBuyGetRewardText(promo, rules);

        if (isSameItem) {
            if (buyQty === 1 && getQty === 1) return 'Buy 1 Get 1 Free';
            return `Buy ${buyQty} Get ${getQty} Free`;
        }

        if (isBuy || isGet) {
            const buyNames = buyProductIds.map(getProductNameById).filter(Boolean);
            const getNames = getProductIds.map(getProductNameById).filter(Boolean);
            const buyLabel = buyNames.length > 0 ? formatNameList(buyNames, 2) : 'selected items';
            const getLabel = getNames.length > 0 ? formatNameList(getNames, 2) : 'selected items';
            const buyQtyText = buyQty === 1 ? '' : `${buyQty}× `;
            const getQtyText = getQty === 1 ? '' : `${getQty}× `;
            return `Buy ${buyQtyText}${buyLabel} → Get ${getQtyText}${getLabel} (${rewardText})`;
        }
    }

    return null;
}

function promoAppliesToProduct(promo, productId) {
    if (!promo) return false;
    if (promo.appliesToAllProducts === true) return true;
    const pid = Number(productId);
    const rules = parsePromotionRules(promo.rules);

    if (promo.type === 'BUY_X_GET_Y') {
        const buyProductIds = Array.isArray(promo.buyProductIds) && promo.buyProductIds.length > 0
            ? promo.buyProductIds.map(Number)
            : (Array.isArray(rules.buyProductIds) ? rules.buyProductIds.map(Number) : []);
        const getProductIds = Array.isArray(promo.getProductIds) && promo.getProductIds.length > 0
            ? promo.getProductIds.map(Number)
            : (Array.isArray(rules.getProductIds) ? rules.getProductIds.map(Number) : []);

        const combined = [...buyProductIds, ...getProductIds].filter(n => Number.isFinite(n));
        if (combined.length > 0) return combined.includes(pid);
    }
    if (Array.isArray(promo.selectedProductIds) && promo.selectedProductIds.length > 0) {
        return promo.selectedProductIds.map(Number).includes(pid);
    }
    const productIds = Array.isArray(rules.productIds) ? rules.productIds.map(Number) : [];
    if (productIds.length === 0) return true;
    return productIds.includes(pid);
}

function getActivePromotionsList() {
    return (Array.isArray(activePromotions) ? activePromotions : [])
        .filter(p => p && p.active !== false);
}

function getPromoDisplayTitle(promo) {
    if (!promo) return '';
    const title = (promo.bannerTitle || promo.name || '').toString().trim();
    if (title) return title;
    if (promo.type === 'PERCENT_OFF') return 'Discount';
    if (promo.type === 'BUY_X_GET_Y') return 'BOGO Deal';
    return 'Deal';
}

function getPromoPercent(promo) {
    const rules = parsePromotionRules(promo?.rules);
    return Number(promo?.percent ?? rules.percent) || 0;
}

function formatNameList(names, maxItems = 2) {
    const clean = (Array.isArray(names) ? names : [])
        .map(s => String(s || '').trim())
        .filter(Boolean);
    if (clean.length <= maxItems) return clean.join(', ');
    return `${clean.slice(0, maxItems).join(', ')} +${clean.length - maxItems} more`;
}

function isBuyXGetXPromo(promo) {
    if (!promo || promo.type !== 'BUY_X_GET_Y') return false;
    const { buyProductIds, getProductIds } = getBuyGetIdsForPromo(promo);
    if (buyProductIds.length === 0 || getProductIds.length === 0) return false;
    if (buyProductIds.length === 1 && getProductIds.length === 1) {
        return Number(buyProductIds[0]) === Number(getProductIds[0]);
    }
    if (buyProductIds.length !== getProductIds.length) return false;
    const buySet = new Set(buyProductIds.map(Number));
    for (const id of getProductIds) {
        if (!buySet.has(Number(id))) return false;
    }
    return true;
}

function getPromoAppliesToText(promo) {
    if (!promo) return '';
    const rules = parsePromotionRules(promo.rules);

    if (promo.type === 'BUY_X_GET_Y') {
        const { buyProductIds, getProductIds } = getBuyGetIdsForPromo(promo);
        const buyNames = buyProductIds.map(getProductNameById).filter(Boolean);
        const getNames = getProductIds.map(getProductNameById).filter(Boolean);
        const buyText = buyNames.length > 0 ? formatNameList(buyNames, 2) : 'selected items';
        const getText = getNames.length > 0 ? formatNameList(getNames, 2) : 'selected items';
        return `Buy: ${buyText} · Get: ${getText}`;
    }

    const selected = Array.isArray(promo.selectedProductIds) ? promo.selectedProductIds.map(Number) : [];
    const productIds = selected.length > 0 ? selected : (Array.isArray(rules.productIds) ? rules.productIds.map(Number) : []);
    const finite = productIds.filter(Number.isFinite);
    if (promo.appliesToAllProducts === true || finite.length === 0) return 'All items';

    const names = finite.map(getProductNameById).filter(Boolean);
    if (names.length === 0) return `${finite.length} items`;
    return formatNameList(names, 3);
}

function getPromoShortDescription(promo) {
    if (!promo) return '';
    const rules = parsePromotionRules(promo.rules);

    if (promo.type === 'PERCENT_OFF') {
        const percent = getPromoPercent(promo);
        const selected = Array.isArray(promo.selectedProductIds) ? promo.selectedProductIds.map(Number) : [];
        const productIds = selected.length > 0 ? selected : (Array.isArray(rules.productIds) ? rules.productIds.map(Number) : []);
        const finite = productIds.filter(Number.isFinite);
        const scope = promo.appliesToAllProducts === true || finite.length === 0 ? 'storewide' : 'on selected items';
        return percent > 0 ? `Save ${Number(percent).toFixed(0)}% ${scope}` : `Discount ${scope}`;
    }

    if (promo.type === 'BUY_X_GET_Y') {
        const { buyQty, getQty } = getBuyGetQtyForPromo(promo, rules);
        const { buyProductIds, getProductIds } = getBuyGetIdsForPromo(promo);
        const buyName = buyProductIds.length === 1 ? (getProductNameById(buyProductIds[0]) || '') : '';
        const getName = getProductIds.length === 1 ? (getProductNameById(getProductIds[0]) || '') : '';
        const isSame = isBuyXGetXPromo(promo);
        const rewardText = getBuyGetRewardText(promo, rules);

        if (buyQty > 0 && getQty > 0) {
            if (isSame) return `Buy ${buyQty} Get ${getQty} Free`;
            const buyNames = buyProductIds.map(getProductNameById).filter(Boolean);
            const getNames = getProductIds.map(getProductNameById).filter(Boolean);
            const buyLabel = buyName || (buyNames.length > 0 ? formatNameList(buyNames, 2) : 'selected items');
            const getLabel = getName || (getNames.length > 0 ? formatNameList(getNames, 2) : 'selected items');
            const buyQtyText = buyQty === 1 ? '' : `${buyQty}× `;
            const getQtyText = getQty === 1 ? '' : `${getQty}× `;
            return `Buy ${buyQtyText}${buyLabel} → Get ${getQtyText}${getLabel} (${rewardText})`;
        }

        return isSame ? 'BOGO deal' : 'Free item deal';
    }

    return '';
}

function pickRelevantPromotion(promos) {
    const list = Array.isArray(promos) ? promos.filter(Boolean) : [];
    if (list.length === 0) return null;

    const cartItems = typeof window.getCartItems === 'function' ? window.getCartItems() : [];
    const cartProductIds = [...new Set((Array.isArray(cartItems) ? cartItems : [])
        .filter(it => Number(it?.qty || 0) > 0)
        .map(it => Number(it?.productId))
        .filter(Number.isFinite))];

    const byPriority = list.slice().sort((a, b) => getPromoPriority(b) - getPromoPriority(a));
    if (cartProductIds.length === 0) return byPriority[0] || null;

    let best = null;
    let bestScore = -Infinity;

    for (const promo of list) {
        let score = 0;
        for (const pid of cartProductIds) {
            if (promoAppliesToProduct(promo, pid)) score += 2;
        }

        if (promo.type === 'BUY_X_GET_Y') {
            const { buyProductIds } = getBuyGetIdsForPromo(promo);
            const buySet = new Set(buyProductIds);
            for (const pid of cartProductIds) {
                if (buySet.has(pid)) score += 3;
            }
        }

        score += getPromoPriority(promo) / 1000;

        if (score > bestScore) {
            bestScore = score;
            best = promo;
        }
    }

    if (bestScore <= 0) return byPriority[0] || null;
    return best;
}

function getBestPromotionForProduct(productId) {
    const promos = Array.isArray(activePromotions) ? activePromotions : (activePromotion ? [activePromotion] : []);
    const applicable = promos.filter(p => promoAppliesToProduct(p, productId));
    if (applicable.length === 0) return null;

    applicable.sort((a, b) => getPromoPriority(b) - getPromoPriority(a));
    const promo = applicable[0];

    const rules = parsePromotionRules(promo.rules);
    const percent = Number(promo.percent ?? rules.percent) || 0;
    const { buyQty, getQty } = getBuyGetQtyForPromo(promo, rules);

    if (promo.type === 'PERCENT_OFF' && percent) {
        return {
            id: promo.id,
            name: promo.name,
            type: promo.type,
            percent,
            badgeText: `${percent}% OFF`,
            badgeVariant: 'percent',
            promoText: null
        };
    }

    if (promo.type === 'BUY_X_GET_Y' && buyQty && getQty) {
        const pid = Number(productId);
        const { buyProductIds, getProductIds } = getBuyGetIdsForPromo(promo);
        const isBuy = buyProductIds.includes(pid);
        const isGet = getProductIds.includes(pid);
        const isSameItem = isBuy && isGet;

        const product = { id: pid, name: getProductNameById(pid) || '' };
        const badgeText = getPromoLabel(product, promo);
        const promoText = getPromoText(product, promo);

        return {
            id: promo.id,
            name: promo.name,
            type: promo.type,
            buyQty,
            getQty,
            buyProductIds,
            getProductIds,
            isBuy,
            isGet,
            isSameItem,
            badgeText,
            badgeVariant: isSameItem ? 'bogo' : (isBuy || isGet ? 'gift' : null),
            promoText
        };
    }

    return null;
}

/**
 * Load active promotions from backend
 */
async function loadPromotions() {
    try {
        const res = await fetch('/promotions/active');
        const data = await res.json();
        const promos = Array.isArray(data.promotions) ? data.promotions.filter(Boolean) : [];
        const sorted = promos.slice().sort((a, b) => getPromoPriority(b) - getPromoPriority(a));

        activePromotions = sorted;
        activePromotion = data.promotion || sorted[0] || null;

        const titles = sorted.map(p => p?.bannerTitle).filter(Boolean);
        activeBannerTitle = data.bannerTitle || (titles.length > 0 ? titles.join(' · ') : '');
        return activePromotions;
    } catch (e) {
        console.log('❌ Failed to load promotions', e);
        activePromotions = [];
        activePromotion = null;
        activeBannerTitle = '';
        return [];
    }
}

/**
 * Render promotion banner at the top of the page
 */
function renderPromotionBanner() {
    const bannerContainer = document.getElementById('promotionBanner');
    if (!bannerContainer) return;

    const promos = getActivePromotionsList();
    if (promos.length === 0) {
        bannerContainer.style.display = 'none';
        return;
    }

    const count = promos.length;
    const relevant = pickRelevantPromotion(promos);
    const highlight = relevant ? getPromoDisplayTitle(relevant) : '';
    const base = `🔥 Deals available (${count})`;
    const description = highlight ? `${base} · ${highlight}` : base;

    bannerContainer.innerHTML = `
        <div class="promotion-banner-content">
            <i data-lucide="tag"></i>
            <span class="promotion-text">${escapeHtmlSafe(description)}</span>
            <button class="promotion-view" onclick="openDealsSheet()" type="button">View deals</button>
            <button class="promotion-close" onclick="document.getElementById('promotionBanner').style.display='none'" type="button">
                <i data-lucide="x"></i>
            </button>
        </div>
    `;
    bannerContainer.style.display = 'block';

    if (window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons();
    }
}

function renderDealsSheet() {
    const listEl = document.getElementById('dealsList');
    const hintEl = document.getElementById('dealsSheetHint');
    if (!listEl) return;

    const promos = getActivePromotionsList().slice().sort((a, b) => getPromoPriority(b) - getPromoPriority(a));
    if (hintEl) hintEl.textContent = promos.length > 0 ? `${promos.length} active deals` : '';

    if (promos.length === 0) {
        listEl.innerHTML = `
            <div class="cart-empty">
                <div class="cart-empty-icon"><i data-lucide="tag"></i></div>
                <div class="cart-empty-text">No active deals</div>
            </div>
        `;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
        return;
    }

    listEl.innerHTML = promos.map(promo => {
        const title = getPromoDisplayTitle(promo);
        const appliesTo = getPromoAppliesToText(promo);
        const desc = getPromoShortDescription(promo);

        let tagText = 'Deal';
        let tagClass = 'cart-item-promo-tag';
        if (promo.type === 'PERCENT_OFF') {
            const percent = getPromoPercent(promo);
            tagText = percent > 0 ? `${Number(percent).toFixed(0)}% OFF` : 'Discount';
            tagClass += ' cart-item-promo-tag--percent';
        } else if (promo.type === 'BUY_X_GET_Y') {
            const { buyQty, getQty } = getBuyGetQtyForPromo(promo);
            const isSame = isBuyXGetXPromo(promo);
            tagText = buyQty && getQty && isSame ? `Buy ${buyQty} Get ${getQty}` : 'Promotion';
            tagClass += ' cart-item-promo-tag--free';
        }

        return `
            <div class="cart-item">
                <div class="cart-item-info">
                    <div class="cart-item-name">${escapeHtmlSafe(title)}</div>
                    <div class="${tagClass}">${escapeHtmlSafe(tagText)}</div>
                    ${appliesTo ? `<div class="cart-item-note">${escapeHtmlSafe(`Applies to: ${appliesTo}`)}</div>` : ''}
                    ${desc ? `<div class="cart-item-promo-hint">${escapeHtmlSafe(desc)}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

function openDealsSheet() {
    renderDealsSheet();
    if (typeof window.openSheet === 'function') {
        window.openSheet('dealsSheet');
    }
}

/**
 * Get promotion badge text for a product
 */
function getPromotionBadge(productId) {
    const best = getBestPromotionForProduct(productId);
    return best ? best.badgeText : null;
}

/**
 * Calculate checkout with promotions via backend API
 */
async function calculateCheckoutWithPromotions(cartItems, opts) {
    try {
        const deliveryType = String(opts?.deliveryType || '').trim();
        const address = String(opts?.address || '').trim();
        const res = await fetch('/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cartItems, delivery_type: deliveryType, address })
        });
        
        if (!res.ok) {
            throw new Error(`Checkout API error: ${res.status}`);
        }
        
        const data = await res.json();
        return data;
    } catch (e) {
        console.error('❌ Checkout calculation failed', e);
        // Fallback to simple calculation
        const subtotal = cartItems.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
        return {
            subtotal,
            discount: 0,
            delivery_fee: 0,
            total: subtotal,
            appliedPromotion: null,
            appliedPromotions: []
        };
    }
}

window.loadPromotions = loadPromotions;
window.renderPromotionBanner = renderPromotionBanner;
window.getPromotionBadge = getPromotionBadge;
window.getBestPromotionForProduct = getBestPromotionForProduct;
window.calculateCheckoutWithPromotions = calculateCheckoutWithPromotions;
window.openDealsSheet = openDealsSheet;
window.renderDealsSheet = renderDealsSheet;
window.getActivePromotions = function getActivePromotions() {
    return Array.isArray(activePromotions) ? [...activePromotions] : [];
};
window.getPromotionById = function getPromotionById(promotionId) {
    const id = Number(promotionId);
    if (!Number.isFinite(id)) return null;
    const promos = Array.isArray(activePromotions) ? activePromotions : [];
    return promos.find(p => Number(p?.id) === id) || null;
};
window.promotionAppliesToProduct = promoAppliesToProduct;
window.parsePromotionRules = parsePromotionRules;
window.getPromoLabel = getPromoLabel;
window.getPromoText = getPromoText;
