/**
 * BakeFlow - Saved Orders Module
 * Handles saved orders functionality (render, apply, save)
 */

function renderSavedOrders() {
    const userId = new URLSearchParams(window.location.search).get('user_id') || 'guest';
    const key = `saved_orders_${userId}`;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    
    const reorderSection = document.getElementById('reorderSection');
    const savedSummary = document.getElementById('savedSummarySection');
    const sectionDivider = document.getElementById('sectionDivider');
    const reorderGrid = document.getElementById('reorderGrid');
    const savedCount = document.getElementById('savedCount');

    if (!list.length) { 
        if (reorderSection) reorderSection.style.display = 'none'; 
        if (savedSummary) savedSummary.style.display = 'none';
        if (sectionDivider) sectionDivider.style.display = 'none';
        return; 
    }

    savedCount.textContent = list.length;
    
    if (reorderSection) reorderSection.style.display = 'block';
    if (savedSummary) savedSummary.style.display = 'block';
    if (sectionDivider) sectionDivider.style.display = 'block';
    
    const displayList = list.filter(o => {
        const items = o.items || [];
        const itemCount = items.reduce((s, it) => s + (it.qty || 1), 0);
        const total = items.reduce((s, it) => {
            let price = it.price;
            if (typeof price !== 'number' || isNaN(price)) {
                const prod = products.find(p => p.id == it.id || (p.name && p.name.toLowerCase() === (it.name || '').toLowerCase()));
                price = prod ? prod.price : 0;
            }
            return s + (price * (it.qty || 1));
        }, 0);
        return itemCount > 0 && total > 0;
    });

    reorderGrid.innerHTML = displayList.slice(0, 3).map((o, idx) => {
        const items = o.items || [];
        const itemCount = items.reduce((s, it) => s + (it.qty || 1), 0);
        const total = items.reduce((s, it) => {
            let price = it.price;
            if (typeof price !== 'number' || isNaN(price)) {
                const prod = products.find(p => p.id == it.id || (p.name && p.name.toLowerCase() === (it.name || '').toLowerCase()));
                price = prod ? prod.price : 0;
            }
            return s + (price * (it.qty || 1));
        }, 0);
        const lastOrdered = o.timestamp ? timeAgo(o.timestamp) : 'Recently';
        
        let thumbsHtml = '';
        const thumbItems = items.slice(0, 3);
        thumbItems.forEach(it => {
            const imgSrc = it.image || 'https://placehold.co/80x80/f1f1f1/888?text=🧁';
            thumbsHtml += `<img src="${escapeHtml(imgSrc)}" alt="" class="reorder-thumb" onerror="this.src='https://placehold.co/80x80/f1f1f1/888?text=🧁'">`;
        });
        if (items.length > 3) {
            thumbsHtml += `<div class="reorder-thumb-more">+${items.length - 3}</div>`;
        }
        
        return `
        <div class="reorder-card" onclick="applySavedOrder(${idx})">
            <div class="reorder-thumbs">${thumbsHtml}</div>
            <div class="reorder-content">
                <div class="reorder-name">${escapeHtml(o.name)}</div>
                <div class="reorder-meta">
                    <span class="reorder-meta-item"><i data-lucide="package"></i> ${itemCount} items</span>
                    <span class="reorder-meta-item"><i data-lucide="clock"></i> ${escapeHtml(lastOrdered)}</span>
                </div>
                <div class="reorder-price">Ks ${total.toFixed(2)}</div>
            </div>
            <div class="reorder-actions" onclick="event.stopPropagation();">
                <button class="reorder-btn primary" onclick="applySavedOrder(${idx})">
                    <i data-lucide="shopping-cart"></i> Order
                </button>
            </div>
        </div>`;
    }).join('');
    
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

window.applySavedOrder = function(idx) {
    const userId = new URLSearchParams(window.location.search).get('user_id') || 'guest';
    const key = `saved_orders_${userId}`;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    const o = list[idx];
    if (!o) return;
    
    cart = {};
    const unavailableItems = [];
    const productList = window.products || products || [];
    
    o.items.forEach(it => {
        const p = productList.find(px => px.id == it.id);
        if (p) {
            cart[it.id] = it.qty;
        } else {
            unavailableItems.push(it.name || `Item #${it.id}`);
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
        const userId = new URLSearchParams(window.location.search).get('user_id') || 'guest';
        window.location.href = `saved-orders.html?user_id=${encodeURIComponent(userId)}`;
    });
    
    document.getElementById('saveCancel').addEventListener('click', closeSheets);
    
    document.getElementById('saveConfirm').addEventListener('click', () => {
        const name = document.getElementById('saveName').value.trim();
        const note = document.getElementById('saveNote').value.trim();
        const items = Object.keys(cart).map(id => {
            const p = products.find(px => px.id == id);
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
        
        const userId = new URLSearchParams(window.location.search).get('user_id') || 'guest';
        const payload = { name, note, tags, items, timestamp: Date.now(), created_at: new Date().toISOString() };
        const key = `saved_orders_${userId}`;
        const current = JSON.parse(localStorage.getItem(key) || '[]');
        current.unshift(payload);
        localStorage.setItem(key, JSON.stringify(current));
        
        renderSavedOrders();
        closeSheets();
        showToast('✓ Order saved', 'success');
    });
}
