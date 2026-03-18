/**
 * BakeFlow - Saved Places Module
 * Location bookmarking
 */

function getPlaces() {
    const key = `saved_places_${getUserId()}`;
    return JSON.parse(localStorage.getItem(key) || '[]');
}

function setPlaces(list) {
    const key = `saved_places_${getUserId()}`;
    localStorage.setItem(key, JSON.stringify(list));
}

const TOWNSHIP_OPTIONS = [
    'Kyimyindaing',
    'Ahlon',
    'Sanchaung',
    'Kamayut',
    'Lanmadaw',
    'Hlaing',
    'Mayangon',
    'Twante',
    'Kyauktada',
    'Bahan',
    'Latha',
    'Pabedan',
    'Dagon'
];

function guessTownshipFromAddress(text) {
    const v = String(text || '').toLowerCase();
    if (!v) return '';
    const hit = TOWNSHIP_OPTIONS.find(t => v.includes(t.toLowerCase()));
    return hit || '';
}

function buildStructuredAddressForSave() {
    const building = document.getElementById('customerBuilding')?.value.trim() || '';
    const road = document.getElementById('customerRoad')?.value.trim() || '';
    const township = document.getElementById('customerTownship')?.value.trim() || '';
    const legacy = document.getElementById('customerAddress')?.value.trim() || '';
    return ([building, road, township].filter(Boolean).join(', ') || legacy).trim();
}

function applyStructuredAddressToForm(address) {
    const full = String(address || '').trim();
    const legacyEl = document.getElementById('customerAddress');
    if (legacyEl) legacyEl.value = full;

    const buildingEl = document.getElementById('customerBuilding');
    const roadEl = document.getElementById('customerRoad');
    const townshipEl = document.getElementById('customerTownship');

    const guessTownship = guessTownshipFromAddress(full);
    if (townshipEl) {
        if (guessTownship) townshipEl.value = guessTownship;
        else if (!String(townshipEl.value || '').trim()) townshipEl.value = '';
    }

    const parts = full.split(',').map(p => p.trim()).filter(Boolean);
    const filtered = guessTownship
        ? parts.filter(p => p.toLowerCase() !== guessTownship.toLowerCase())
        : parts;

    if (filtered.length >= 2) {
        if (buildingEl) buildingEl.value = filtered[0];
        if (roadEl) roadEl.value = filtered.slice(1).join(', ');
        return;
    }

    if (filtered.length === 1) {
        if (buildingEl) buildingEl.value = '';
        if (roadEl) roadEl.value = filtered[0];
        return;
    }

    if (roadEl && !String(roadEl.value || '').trim()) roadEl.value = full;
}

function renderPlaces() {
    const list = getPlaces();
    const wrap = document.getElementById('placesList');
    if (!wrap) return;
    
    if (!list.length) {
        wrap.innerHTML = `
            <div class="empty-reorder" style="padding:16px;">
                <div class="empty-reorder-icon" style="width:40px;height:40px;">
                    <i data-lucide="map-pin"></i>
                </div>
                <div class="empty-reorder-title">No saved places yet</div>
                <div class="empty-reorder-desc">Save your delivery address for quick access.</div>
            </div>`;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
        return;
    }
    
    wrap.innerHTML = list.map((p, i) => {
        const addr = escapeHtml(p.address || '');
        const name = escapeHtml(p.name || 'Saved place');
        return `
            <div class="p-card" style="padding:12px; align-items:flex-start;">
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:700; color:var(--gray-800); font-size:14px; display:flex; align-items:center; gap:6px;">
                        <i data-lucide="map-pin" style="width:14px;height:14px;color:var(--primary);"></i> ${name}
                    </div>
                    <div style="color:var(--gray-500); font-size:12px; margin-top:4px; line-height:1.4;">${addr || '—'}</div>
                    ${p.directions ? `<div style="color:var(--gray-400); font-size:11px; margin-top:4px;">📝 ${escapeHtml(p.directions)}</div>` : ''}
                </div>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <button class="reorder-btn primary" style="height:36px; padding:0 12px;" onclick="applyPlace(${i})">
                        <i data-lucide="check" style="width:14px;height:14px;"></i> Use
                    </button>
                    <button class="reorder-btn secondary" style="height:36px; padding:0 12px;" onclick="deletePlace(${i})">
                        <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

function renderPlacesBar() {
    const list = getPlaces();
    const bar = document.getElementById('savedPlacesBar');
    const chips = document.getElementById('savedPlacesChips');
    if (!bar || !chips) return;
    
    if (!list.length) { bar.style.display = 'none'; return; }
    
    bar.style.display = 'block';
    chips.innerHTML = list.slice(0, 6).map((p, i) => `
        <button class="mini-btn" style="white-space:nowrap;" onclick="quickUsePlace(${i})">
            <i data-lucide="map-pin"></i>
            <span>${escapeHtml(p.name || 'Place')}</span>
        </button>
    `).join('');
    
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

window.quickUsePlace = function(i) {
    const list = getPlaces();
    const p = list[i];
    if (!p) return;

    openDeliveryForm();
    selectDeliveryType('delivery');
    document.getElementById('addressGroup').style.display = 'block';
    applyStructuredAddressToForm(p.address || '');

    const dirEl = document.getElementById('deliveryDirections');
    if (dirEl) dirEl.value = p.directions || '';
    
    const geo = p.geo || null;
    if (geo && typeof geo.lat === 'number' && typeof geo.lon === 'number') {
        showMap(geo.lat, geo.lon);
        activateTab('map');
    } else {
        activateTab('dir');
    }
    showToast('Place loaded', 'success');
};

window.applyPlace = function(i) {
    const list = getPlaces();
    const p = list[i];
    if (!p) return;

    selectDeliveryType('delivery');
    document.getElementById('addressGroup').style.display = 'block';
    applyStructuredAddressToForm(p.address || '');

    const dirEl = document.getElementById('deliveryDirections');
    if (dirEl) dirEl.value = p.directions || '';
    
    const geo = p.geo || null;
    if (geo && typeof geo.lat === 'number' && typeof geo.lon === 'number') {
        showMap(geo.lat, geo.lon);
    }
    closeSheets();
    showToast('Place applied', 'success');
};

window.deletePlace = function(i) {
    const list = getPlaces();
    list.splice(i, 1);
    setPlaces(list);
    renderPlaces();
    renderPlacesBar();
    showToast('Deleted');
};

function initPlacesSheet() {
    const openPlacesBtn = document.getElementById('openPlacesBtn');
    if (openPlacesBtn) {
        openPlacesBtn.addEventListener('click', () => {
            const nameEl = document.getElementById('placeName');
            const countEl = document.getElementById('placeCount');
            if (nameEl) nameEl.value = '';
            if (countEl) countEl.textContent = '0/30';
            renderPlaces();
            openSheet('placesSheet');
        });
    }
    
    const managePlacesBtn = document.getElementById('managePlacesBtn');
    if (managePlacesBtn) {
        managePlacesBtn.addEventListener('click', () => {
            const nameEl = document.getElementById('placeName');
            const countEl = document.getElementById('placeCount');
            if (nameEl) nameEl.value = '';
            if (countEl) countEl.textContent = '0/30';
            renderPlaces();
            openSheet('placesSheet');
        });
    }
    
    const placeNameEl = document.getElementById('placeName');
    if (placeNameEl) {
        placeNameEl.addEventListener('input', (e) => {
            const v = e.target.value || '';
            const c = document.getElementById('placeCount');
            if (c) c.textContent = `${v.length}/30`;
        });
    }
    
    const placeCloseBtn = document.getElementById('placeCloseBtn');
    if (placeCloseBtn) placeCloseBtn.addEventListener('click', closeSheets);
    
    const placeSaveBtn = document.getElementById('placeSaveBtn');
    if (placeSaveBtn) {
        placeSaveBtn.addEventListener('click', () => {
            const address = buildStructuredAddressForSave();
            const directions = (document.getElementById('deliveryDirections')?.value || '').trim();
            const name = (document.getElementById('placeName')?.value || '').trim();

            if (!address) { showToast('Enter road and township first'); return; }
            if (!name) { showToast('Name your place'); return; }

            const legacyEl = document.getElementById('customerAddress');
            if (legacyEl) legacyEl.value = address;
            
            const list = getPlaces();
            const exists = list.some(p => 
                p &&
                typeof p.name === 'string' &&
                typeof p.address === 'string' &&
                p.name.trim().toLowerCase() === name.toLowerCase() &&
                p.address.trim().toLowerCase() === address.toLowerCase()
            );
            if (exists) {
                showToast('Place already saved');
                return;
            }
            list.unshift({ 
                name, 
                address, 
                directions, 
                geo: window.getGeo() || null, 
                created_at: new Date().toISOString() 
            });
            setPlaces(list.slice(0, 20));
            renderPlaces();
            renderPlacesBar();
            showToast('Place saved', 'success');
        });
    }
}

// Export
window.renderPlacesBar = renderPlacesBar;
window.initPlacesSheet = initPlacesSheet;
