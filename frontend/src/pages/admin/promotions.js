import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Sidebar from '../../components/Sidebar';
import TopNavbar from '../../components/TopNavbar';
import { useTranslation } from '../../utils/i18n';
import { toMyanmarNumber } from '../../utils/formatCurrency';
import { formatDate } from '../../utils/formatDate';

export default function PromotionsPage() {
  const API_BASE = (() => {
    const fromEnv = process.env.NEXT_PUBLIC_API_BASE;
    if (fromEnv) return fromEnv;
    return 'https://bakeflow.onrender.com';
  })();

  const buildAuthHeaders = useCallback((extra = {}) => {
    if (typeof window === 'undefined') return { ...extra };
    let tok = '';
    try {
      tok = localStorage.getItem('bakeflow_admin_token') || '';
    } catch {
      tok = '';
    }
    const headers = { ...extra };
    if (tok) headers.Authorization = `Bearer ${tok}`;
    return headers;
  }, []);
  const [promotions, setPromotions] = useState([]);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [buyProductSearch, setBuyProductSearch] = useState('');
  const [getProductSearch, setGetProductSearch] = useState('');
  const [applyToAllProducts, setApplyToAllProducts] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });
  const [showForm, setShowForm] = useState(false);
  const [editingPromo, setEditingPromo] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'PERCENT_OFF',
    rules: { percent: 20, productIds: [] },
    active: true,
    start_at: '',
    end_at: '',
    priority: 0
  });
  const { t, lang, mounted } = useTranslation();

  const pad2 = (n) => String(n).padStart(2, '0');

  const toDateTimeLocalValue = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const toUtcIsoFromLocalValue = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  };

  const coerceProductsArray = (data) => {
    if (Array.isArray(data?.products)) return data.products;
    if (Array.isArray(data?.data?.products)) return data.data.products;
    if (Array.isArray(data)) return data;
    return [];
  };

  const fetchProducts = useCallback(async () => {
    try {
      setProductsLoading(true);
      setProductsError(null);
      const params = new URLSearchParams({
        limit: '100',
        sort_by: 'name',
        sort_dir: 'ASC'
      });
      const res = await fetch(`${API_BASE}/api/products?${params.toString()}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      const list = coerceProductsArray(data);
      if (list.length === 0 && data && typeof data === 'object' && !Array.isArray(data) && !('products' in data)) {
        throw new Error('Unexpected products response');
      }
      setProducts(list);
    } catch (e) {
      console.error(e);
      setProducts([]);
      setProductsError('Failed to load products');
    } finally {
      setProductsLoading(false);
    }
  }, [API_BASE]);

  const fetchPromotions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/admin/promotions`, {
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setPromotions(data.promotions || []);
      setError(null);
    } catch (e) {
      console.error(e);
      setError(t('failedToLoadPromotions'));
    } finally {
      setLoading(false);
    }
  }, [API_BASE, buildAuthHeaders, t]);

  useEffect(() => {
    if (mounted) {
      fetchProducts();
      fetchPromotions();
    }
  }, [fetchProducts, fetchPromotions, mounted]);

  useEffect(() => {
    if (mounted && showForm && !productsLoading && products.length === 0) {
      fetchProducts();
    }
  }, [showForm, productsLoading, products.length, fetchProducts, mounted]);

  const showNotification = (message, type) => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: '', type: '' }), 5000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (formData.type === 'PERCENT_OFF') {
        if (!applyToAllProducts && (!formData.rules.productIds || formData.rules.productIds.length === 0)) {
          showNotification(t('selectProductWarning'), 'warning');
          return;
        }
      }
      if (formData.type === 'BUY_1_GET_1') {
        const productIds = Array.isArray(formData.rules.productIds) ? formData.rules.productIds : [];
        if (productIds.length === 0) {
          showNotification(t('selectBogoWarning'), 'warning');
          return;
        }
      }
      if (formData.type === 'BUY_X_GET_Y') {
        const buyProductIds = Array.isArray(formData.rules.buyProductIds) ? formData.rules.buyProductIds : [];
        const getProductIds = Array.isArray(formData.rules.getProductIds) ? formData.rules.getProductIds : [];
        if (buyProductIds.length === 0) {
          showNotification(t('selectBuyWarning'), 'warning');
          return;
        }
        if (getProductIds.length === 0) {
          showNotification(t('selectGetWarning'), 'warning');
          return;
        }

        let buyQty = Number(formData.rules.buyQty) || 0;
        let getQty = Number(formData.rules.getQty) || 0;
        const autoBuyQty = buyProductIds.length || 0;
        const autoGetQty = getProductIds.length || 0;
        if (buyQty <= 0) buyQty = autoBuyQty;
        if (getQty <= 0) getQty = autoGetQty;
        if (buyQty === 1 && getQty === 1 && (buyProductIds.length > 1 || getProductIds.length > 1)) {
          buyQty = autoBuyQty || buyQty;
          getQty = autoGetQty || getQty;
        }
        if (buyQty <= 0 || getQty <= 0) {
          showNotification(t('qtyWarning'), 'warning');
          return;
        }

        const discountType = String(formData.rules.discountType || 'FREE').toUpperCase();
        if (discountType === 'PERCENT_OFF') {
          const discountPercent = Number(formData.rules.discountPercent) || 0;
          if (discountPercent <= 0 || discountPercent > 100) {
            showNotification(t('percentWarning'), 'warning');
            return;
          }
        }
        if (discountType === 'FIXED_PRICE') {
          const fixedPrice = Number(formData.rules.fixedPrice);
          if (!Number.isFinite(fixedPrice) || fixedPrice < 0) {
            showNotification(t('priceWarning'), 'warning');
            return;
          }
        }
      }

      const url = editingPromo
        ? `${API_BASE}/api/admin/promotions/${editingPromo.id}`
        : `${API_BASE}/api/admin/promotions`;
      const method = editingPromo ? 'PUT' : 'POST';

      let payloadType = formData.type;
      let payloadRules = formData.rules;
      if (formData.type === 'BUY_1_GET_1') {
        payloadType = 'BUY_X_GET_Y';
        const productIds = Array.isArray(formData.rules.productIds) ? formData.rules.productIds.map(Number).filter(Number.isFinite) : [];
        payloadRules = {
          buyQty: 1,
          getQty: 1,
          discountType: 'FREE',
          productIds
        };
      } else if (formData.type === 'BUY_X_GET_Y') {
        const buyProductIds = Array.isArray(formData.rules.buyProductIds) ? formData.rules.buyProductIds : [];
        const getProductIds = Array.isArray(formData.rules.getProductIds) ? formData.rules.getProductIds : [];
        let buyQty = Number(formData.rules.buyQty) || 0;
        let getQty = Number(formData.rules.getQty) || 0;
        const autoBuyQty = buyProductIds.length || 0;
        const autoGetQty = getProductIds.length || 0;
        if (buyQty <= 0) buyQty = autoBuyQty;
        if (getQty <= 0) getQty = autoGetQty;
        if (buyQty === 1 && getQty === 1 && (buyProductIds.length > 1 || getProductIds.length > 1)) {
          buyQty = autoBuyQty || buyQty;
          getQty = autoGetQty || getQty;
        }
        payloadRules = {
          ...formData.rules,
          buyQty,
          getQty
        };
      }

      const res = await fetch(url, {
        method,
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...formData,
          type: payloadType,
          start_at: toUtcIsoFromLocalValue(formData.start_at),
          end_at: toUtcIsoFromLocalValue(formData.end_at),
          rules: payloadRules
        })
      });

      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();

      if (data.success) {
        showNotification(editingPromo ? t('promotionUpdated') : t('promotionCreated'), 'success');
        setShowForm(false);
        setEditingPromo(null);
        setApplyToAllProducts(true);
        setProductSearch('');
        setBuyProductSearch('');
        setGetProductSearch('');
        resetForm();
        fetchPromotions();
      } else {
        showNotification(t('failedToSave'), 'danger');
      }
    } catch (e) {
      console.error(e);
      showNotification(t('errorSaving'), 'danger');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'PERCENT_OFF',
      rules: { percent: 20, productIds: [] },
      active: true,
      start_at: '',
      end_at: '',
      priority: 0
    });
    setApplyToAllProducts(true);
    setProductSearch('');
    setBuyProductSearch('');
    setGetProductSearch('');
  };

  const handleEdit = (promo) => {
    const parsedRules = typeof promo.rules === 'string' ? JSON.parse(promo.rules) : promo.rules;
    const legacyProductIds = Array.isArray(parsedRules?.productIds) ? parsedRules.productIds.map(Number) : [];
    const buyProductIds = Array.isArray(parsedRules?.buyProductIds) ? parsedRules.buyProductIds.map(Number) : [];
    const getProductIds = Array.isArray(parsedRules?.getProductIds) ? parsedRules.getProductIds.map(Number) : [];
    const isBogo =
      promo.type === 'BUY_X_GET_Y' &&
      (Number(parsedRules?.buyQty) || 0) === 1 &&
      (Number(parsedRules?.getQty) || 0) === 1 &&
      buyProductIds.length === 0 &&
      getProductIds.length === 0 &&
      legacyProductIds.length > 0 &&
      String(parsedRules?.discountType || 'FREE').toUpperCase() === 'FREE';
    const normalizedBuyProductIds = promo.type === 'BUY_X_GET_Y' && buyProductIds.length === 0 && getProductIds.length === 0
      ? legacyProductIds
      : buyProductIds;
    const normalizedGetProductIds = promo.type === 'BUY_X_GET_Y' && buyProductIds.length === 0 && getProductIds.length === 0
      ? legacyProductIds
      : getProductIds;
    setEditingPromo(promo);
    setFormData({
      name: promo.name,
      type: isBogo ? 'BUY_1_GET_1' : promo.type,
      rules: {
        ...(parsedRules || {}),
        productIds: legacyProductIds,
        buyProductIds: isBogo ? [] : normalizedBuyProductIds,
        getProductIds: isBogo ? [] : normalizedGetProductIds,
        discountType: String(parsedRules?.discountType || 'FREE').toUpperCase(),
        discountPercent: Number(parsedRules?.discountPercent) || 0,
        fixedPrice: Number(parsedRules?.fixedPrice) || 0
      },
      active: promo.active,
      start_at: toDateTimeLocalValue(promo.start_at),
      end_at: toDateTimeLocalValue(promo.end_at),
      priority: promo.priority
    });
    setApplyToAllProducts(promo.type !== 'PERCENT_OFF' ? true : !(legacyProductIds && legacyProductIds.length > 0));
    setProductSearch('');
    setBuyProductSearch('');
    setGetProductSearch('');
    setShowForm(true);
  };

  const openDeleteModal = (promo) => {
    setDeleteTarget(promo);
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    if (deleteLoading) return;
    setDeleteModalOpen(false);
    setDeleteTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/promotions/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      if (data.success) {
        showNotification(t('promotionDeleted'), 'success');
        fetchPromotions();
        closeDeleteModal();
      } else {
        showNotification(t('failedToDelete'), 'danger');
      }
    } catch (e) {
      console.error(e);
      showNotification(t('errorDeleting'), 'danger');
    } finally {
      setDeleteLoading(false);
    }
  };

  const toggleActive = async (id, currentActive) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/promotions/${id}/toggle`, {
        method: 'PATCH',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ active: !currentActive }),
      });

      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      if (data.success) {
        const msg = !currentActive ? t('promotionEnabled') : t('promotionDisabled');
        showNotification(msg || `Promotion ${!currentActive ? 'enabled' : 'disabled'}`, 'success');
        fetchPromotions();
      }
    } catch (e) {
      showNotification(t('errorUpdating'), 'danger');
    }
  };

  const formatRules = (promo) => {
    const rules = typeof promo.rules === 'string' ? JSON.parse(promo.rules) : promo.rules;
    const num = (n) => lang === 'my' ? toMyanmarNumber(n) : n;

    if (promo.type === 'PERCENT_OFF') {
      const productText = rules.productIds && rules.productIds.length > 0
        ? t('productsCountText').replace('{count}', num(rules.productIds.length))
        : t('allProductsText');
      return t('percentRules').replace('{percent}', num(rules.percent)).replace('{productText}', productText);
    } else if (promo.type === 'BUY_X_GET_Y') {
      const buyQty = Number(promo.buyQty ?? promo.buy_qty ?? rules.buyQty ?? rules.buy_qty) || 0;
      const getQty = Number(promo.getQty ?? promo.get_qty ?? rules.getQty ?? rules.get_qty) || 0;
      const discountType = String(rules.discountType || 'FREE').toUpperCase();
      if (discountType === 'PERCENT_OFF') {
        return t('buyGetPercentRules')
          .replace('{buy}', num(buyQty))
          .replace('{get}', num(getQty))
          .replace('{percent}', num(Number(rules.discountPercent || 0).toFixed(0)));
      }
      if (discountType === 'FIXED_PRICE') {
        const price = lang === 'my' ? `${toMyanmarNumber(rules.fixedPrice)} Ks` : `$${rules.fixedPrice}`;
        return t('buyGetFixedRules')
          .replace('{buy}', num(buyQty))
          .replace('{get}', num(getQty))
          .replace('{price}', price);
      }
      return t('buyGetFreeRules')
        .replace('{buy}', num(buyQty))
        .replace('{get}', num(getQty));
    }
    return 'N/A';
  };

  const getBuyGetIdsFromPromo = (promo) => {
    if (!promo || promo.type !== 'BUY_X_GET_Y') return { buyIds: [], getIds: [] };
    let rules = promo.rules;
    if (typeof rules === 'string') {
      try {
        rules = JSON.parse(rules);
      } catch (e) {
        rules = {};
      }
    }
    const legacyProductIds = Array.isArray(rules?.productIds) ? rules.productIds.map(Number) : [];
    let buyIds = Array.isArray(rules?.buyProductIds) ? rules.buyProductIds.map(Number) : [];
    let getIds = Array.isArray(rules?.getProductIds) ? rules.getProductIds.map(Number) : [];
    if (buyIds.length === 0 && getIds.length === 0 && legacyProductIds.length > 0) {
      buyIds = legacyProductIds;
      getIds = legacyProductIds;
    }
    return {
      buyIds: buyIds.filter(Number.isFinite),
      getIds: getIds.filter(Number.isFinite)
    };
  };

  const isPromotionActiveNow = (promo) => {
    if (!promo?.active) return false;
    const now = new Date();
    const start = promo.start_at ? new Date(promo.start_at) : null;
    const end = promo.end_at ? new Date(promo.end_at) : null;
    const startOk = !!start && !Number.isNaN(start.getTime());
    const endOk = !!end && !Number.isNaN(end.getTime());
    if (startOk && now < start) return false;
    if (endOk && now > end) return false;
    return true;
  };

  const getStatusMeta = (promo) => {
    if (!promo.active) return { label: t('disabledShort'), badgeClass: 'bg-secondary' };
    const now = new Date();
    const start = promo.start_at ? new Date(promo.start_at) : null;
    const end = promo.end_at ? new Date(promo.end_at) : null;
    const startOk = !!start && !Number.isNaN(start.getTime());
    const endOk = !!end && !Number.isNaN(end.getTime());

    if (startOk && now < start) return { label: t('scheduled'), badgeClass: 'bg-info' };
    if (endOk && now > end) return { label: t('expired'), badgeClass: 'bg-secondary' };
    return { label: t('activeShort'), badgeClass: 'bg-success' };
  };

  const filteredProducts = products.filter(p => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return true;
    const name = (p.name || '').toLowerCase();
    const category = (p.category || '').toLowerCase();
    return name.includes(q) || category.includes(q);
  });

  const filteredBuyProducts = products.filter(p => {
    const q = buyProductSearch.trim().toLowerCase();
    if (!q) return true;
    const name = (p.name || '').toLowerCase();
    const category = (p.category || '').toLowerCase();
    return name.includes(q) || category.includes(q);
  });

  const filteredGetProducts = products.filter(p => {
    const q = getProductSearch.trim().toLowerCase();
    if (!q) return true;
    const name = (p.name || '').toLowerCase();
    const category = (p.category || '').toLowerCase();
    return name.includes(q) || category.includes(q);
  });

  const blockedPromotionProductIds = (() => {
    const blocked = new Set();
    promotions.forEach(promo => {
      if (!promo || promo.type !== 'BUY_X_GET_Y') return;
      if (!isPromotionActiveNow(promo)) return;
      if (editingPromo && promo.id === editingPromo.id) return;
      const { buyIds, getIds } = getBuyGetIdsFromPromo(promo);
      buyIds.forEach(id => blocked.add(id));
      getIds.forEach(id => blocked.add(id));
    });
    return blocked;
  })();

  const toggleProductId = (id) => {
    const pid = Number(id);
    const current = Array.isArray(formData.rules.productIds) ? formData.rules.productIds : [];
    const has = current.includes(pid);
    const next = has ? current.filter(x => x !== pid) : [...current, pid];
    setFormData({ ...formData, rules: { ...formData.rules, productIds: next } });
  };

  const selectAllFiltered = () => {
    const ids = filteredProducts.map(p => Number(p.id)).filter(Boolean);
    setFormData({ ...formData, rules: { ...formData.rules, productIds: Array.from(new Set(ids)) } });
  };

  const clearSelectedProducts = () => {
    setFormData({ ...formData, rules: { ...formData.rules, productIds: [] } });
  };

  const getBlockedRuleIds = (key) => {
    const otherKey = key === 'buyProductIds' ? 'getProductIds' : 'buyProductIds';
    const other = Array.isArray(formData.rules[otherKey]) ? formData.rules[otherKey] : [];
    const blocked = new Set(other.map(Number).filter(Number.isFinite));
    for (const id of blockedPromotionProductIds) {
      blocked.add(id);
    }
    return blocked;
  };

  const toggleRuleIds = (key, id) => {
    const pid = Number(id);
    if (!Number.isFinite(pid)) return;
    const blocked = getBlockedRuleIds(key);
    if (blocked.has(pid)) return;
    const current = Array.isArray(formData.rules[key]) ? formData.rules[key] : [];
    const has = current.includes(pid);
    const next = has ? current.filter(x => x !== pid) : [...current, pid];
    setFormData({ ...formData, rules: { ...formData.rules, [key]: next } });
  };

  const selectAllFilteredRuleIds = (key, list) => {
    const blocked = getBlockedRuleIds(key);
    const ids = list.map(p => Number(p.id)).filter(id => Number.isFinite(id) && !blocked.has(id));
    setFormData({ ...formData, rules: { ...formData.rules, [key]: Array.from(new Set(ids)) } });
  };

  const clearRuleIds = (key) => {
    setFormData({ ...formData, rules: { ...formData.rules, [key]: [] } });
  };

  if (!mounted) return null;

  return (
    <>
      <Head>
        <title>{t('promotions')} | BakeFlow Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet" />
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js" defer></script>
      </Head>
      <div className="d-flex vh-100 overflow-hidden bg-soft">
        <Sidebar open={sidebarOpen} toggle={() => setSidebarOpen(o => !o)} />
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <TopNavbar
            toggleSidebar={() => setSidebarOpen(o => !o)}
            pageTitle={t('promotions')}
            pageSubtitle={t('managePromotions')}
          />
          <div className="flex-grow-1 overflow-auto">
            <div className="container-fluid px-4 py-4">
              {notification.show && (
                <div className={`alert alert-${notification.type} alert-dismissible fade show`} role="alert">
                  {notification.message}
                  <button type="button" className="btn-close" onClick={() => setNotification({ show: false })} aria-label="Close"></button>
                </div>
              )}

              <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                  <h2 className="mb-0 fw-bold">{t('promotions')}</h2>
                  <p className="text-muted mb-0">{t('managePromotions')}</p>
                </div>
                <button className="btn btn-primary d-flex align-items-center gap-2" onClick={() => { resetForm(); setEditingPromo(null); setShowForm(true); }}>
                  <i className="bi bi-plus-circle"></i>{t('newPromotion')}
                </button>
              </div>

              {showForm && (
                <div className="card shadow-sm border-0 mb-4">
                  <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center">
                    <h5 className="mb-0 fw-bold">{editingPromo ? t('editPromotion') : t('createPromotion')}</h5>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => { setShowForm(false); setEditingPromo(null); resetForm(); }}>
                      <i className="bi bi-x"></i>
                    </button>
                  </div>
                  <div className="card-body">
                    <form onSubmit={handleSubmit}>
                      <div className="row mb-3">
                        <div className="col-md-6">
                          <label className="form-label">{t('promotionName')}</label>
                          <input
                            type="text"
                            className="form-control"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="e.g. Summer Special"
                            required
                          />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">{t('promotionType')}</label>
                          <select
                            className="form-select"
                            value={formData.type}
                            onChange={(e) => {
                              const newType = e.target.value;
                              const currentProductIds = Array.isArray(formData.rules.productIds) ? formData.rules.productIds : [];
                              const currentBuyIds = Array.isArray(formData.rules.buyProductIds) ? formData.rules.buyProductIds : [];
                              const currentGetIds = Array.isArray(formData.rules.getProductIds) ? formData.rules.getProductIds : [];
                              setFormData({
                                ...formData,
                                type: newType,
                                rules: newType === 'PERCENT_OFF'
                                  ? { percent: 20, productIds: currentProductIds }
                                  : newType === 'BUY_1_GET_1'
                                    ? {
                                      buyQty: 1,
                                      getQty: 1,
                                      discountType: 'FREE',
                                      productIds: currentProductIds,
                                      buyProductIds: [],
                                      getProductIds: [],
                                      discountPercent: 20,
                                      fixedPrice: 0
                                    }
                                    : {
                                      buyQty: 1,
                                      getQty: 1,
                                      buyProductIds: currentBuyIds.length ? currentBuyIds : [],
                                      getProductIds: currentGetIds.length ? currentGetIds : [],
                                      discountType: 'FREE',
                                      discountPercent: 20,
                                      fixedPrice: 0,
                                      productIds: []
                                    }
                              });
                            }}
                            required
                          >
                            <option value="PERCENT_OFF">{t('percentOff')}</option>
                            <option value="BUY_1_GET_1">{t('bogoTitle')}</option>
                            <option value="BUY_X_GET_Y">{t('buyXGetY')}</option>
                          </select>
                        </div>
                      </div>

                      {productsError && (
                        <div className="alert alert-warning d-flex justify-content-between align-items-center py-2">
                          <div>{productsError}</div>
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={fetchProducts} disabled={productsLoading}>
                            Reload
                          </button>
                        </div>
                      )}

                      {formData.type === 'PERCENT_OFF' && (
                        <div className="row mb-3">
                          <div className="col-md-6">
                            <label className="form-label">{t('discountPercent')} (%)</label>
                            <input
                              type="number"
                              className="form-control"
                              min="1"
                              max="100"
                              value={formData.rules.percent || 0}
                              onChange={(e) => setFormData({
                                ...formData,
                                rules: { ...formData.rules, percent: parseInt(e.target.value) }
                              })}
                              required
                            />
                          </div>
                        </div>
                      )}

                      {formData.type === 'BUY_X_GET_Y' && (
                        <>
                          <div className="row mb-2">
                            <div className="col-md-6">
                              <label className="form-label">{t('buyQuantity')}</label>
                              <input
                                type="number"
                                className="form-control"
                                min="1"
                                value={formData.rules.buyQty || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  rules: { ...formData.rules, buyQty: parseInt(e.target.value) }
                                })}
                                required
                              />
                              <div className="form-text text-muted">
                                {t('buyItemsFromList').replace('{qty}', lang === 'my' ? toMyanmarNumber(formData.rules.buyQty || 1) : (formData.rules.buyQty || 1))}
                              </div>
                            </div>
                            <div className="col-md-6">
                              <label className="form-label">{t('getQuantity')}</label>
                              <input
                                type="number"
                                className="form-control"
                                min="1"
                                value={formData.rules.getQty || 1}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  rules: { ...formData.rules, getQty: parseInt(e.target.value) }
                                })}
                                required
                              />
                            </div>
                          </div>

                          <div className="row mb-3">
                            <div className="col-md-6">
                              <label className="form-label">{t('discountType')}</label>
                              <select
                                className="form-select"
                                value={String(formData.rules.discountType || 'FREE').toUpperCase()}
                                onChange={(e) => setFormData({
                                  ...formData,
                                  rules: { ...formData.rules, discountType: e.target.value }
                                })}
                                required
                              >
                                <option value="FREE">{t('free')}</option>
                                <option value="PERCENT_OFF">% {t('percentOff')}</option>
                                <option value="FIXED_PRICE">{t('fixedPrice')}</option>
                              </select>
                            </div>
                            {String(formData.rules.discountType || 'FREE').toUpperCase() === 'PERCENT_OFF' && (
                              <div className="col-md-6">
                                <label className="form-label">{t('discountPercent')}</label>
                                <input
                                  type="number"
                                  className="form-control"
                                  min="1"
                                  max="100"
                                  value={Number(formData.rules.discountPercent || 0)}
                                  onChange={(e) => setFormData({
                                    ...formData,
                                    rules: { ...formData.rules, discountPercent: parseInt(e.target.value) }
                                  })}
                                  required
                                />
                              </div>
                            )}
                            {String(formData.rules.discountType || 'FREE').toUpperCase() === 'FIXED_PRICE' && (
                              <div className="col-md-6">
                                <label className="form-label">{t('fixedPrice')}</label>
                                <div className="input-group">
                                  <span className="input-group-text">Ks</span>
                                  <input
                                    type="number"
                                    className="form-control"
                                    min="0"
                                    step="1"
                                    value={Number(formData.rules.fixedPrice || 0)}
                                    onChange={(e) => setFormData({
                                      ...formData,
                                      rules: { ...formData.rules, fixedPrice: parseFloat(e.target.value) }
                                    })}
                                    required
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      {formData.type === 'PERCENT_OFF' && (
                        <div className="mb-3">
                          <div className="d-flex justify-content-between align-items-center">
                            <label className="form-label mb-0">{t('applyToProducts')}</label>
                            {!applyToAllProducts && (
                              <div className="d-flex gap-2">
                                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={selectAllFiltered} disabled={productsLoading || filteredProducts.length === 0}>
                                  {t('selectAll')}
                                </button>
                                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearSelectedProducts}>
                                  {t('clear')}
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="form-check mt-2">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked={applyToAllProducts}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setApplyToAllProducts(checked);
                                if (checked) {
                                  setFormData({ ...formData, rules: { ...formData.rules, productIds: [] } });
                                }
                              }}
                              id="applyAllProductsCheck"
                            />
                            <label className="form-check-label" htmlFor="applyAllProductsCheck">
                              {t('allProducts')}
                            </label>
                          </div>

                          {!applyToAllProducts && (
                            <div className="mt-3">
                              <input
                                className="form-control"
                                placeholder={t('searchProductsPlaceholder')}
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                              />
                              <div className="border rounded mt-2 p-2" style={{ maxHeight: 240, overflow: 'auto' }}>
                                {productsLoading ? (
                                  <div className="text-muted">{t('loadingProducts')}</div>
                                ) : filteredProducts.length === 0 ? (
                                  <div className="text-muted">{t('noProductsFound')}</div>
                                ) : (
                                  filteredProducts.map(p => {
                                    const pid = Number(p.id);
                                    const selected = (formData.rules.productIds || []).includes(pid);
                                    return (
                                      <div className="form-check" key={p.id}>
                                        <input
                                          className="form-check-input"
                                          type="checkbox"
                                          checked={selected}
                                          onChange={() => toggleProductId(pid)}
                                          id={`productCheck_${p.id}`}
                                        />
                                        <label className="form-check-label" htmlFor={`productCheck_${p.id}`}>
                                          {p.name} {p.status ? <span className="text-muted">({p.status})</span> : null}
                                        </label>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                              <div className="form-text">
                                {t('selectedCount').replace('{count}', lang === 'my' ? toMyanmarNumber((formData.rules.productIds || []).length) : (formData.rules.productIds || []).length)}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {formData.type === 'BUY_1_GET_1' && (
                        <div className="mb-3">
                          <div className="d-flex justify-content-between align-items-center">
                            <label className="form-label mb-0">{t('bogoProductsLabel')}</label>
                            <div className="d-flex gap-2">
                              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={selectAllFiltered} disabled={productsLoading || filteredProducts.length === 0}>
                                {t('selectAll')}
                              </button>
                              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearSelectedProducts}>
                                {t('clear')}
                              </button>
                            </div>
                          </div>
                          <input
                            className="form-control mt-2"
                            placeholder={t('searchProductsPlaceholder')}
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                          />
                          <div className="border rounded mt-2 p-2" style={{ maxHeight: 240, overflow: 'auto' }}>
                            {productsLoading ? (
                              <div className="text-muted">{t('loadingProducts')}</div>
                            ) : filteredProducts.length === 0 ? (
                              <div className="text-muted">{t('noProductsFound')}</div>
                            ) : (
                              filteredProducts.map(p => {
                                const pid = Number(p.id);
                                const selected = (formData.rules.productIds || []).includes(pid);
                                return (
                                  <div className="form-check" key={`bogo_${p.id}`}>
                                    <input
                                      className="form-check-input"
                                      type="checkbox"
                                      checked={selected}
                                      onChange={() => toggleProductId(pid)}
                                      id={`bogoProductCheck_${p.id}`}
                                    />
                                    <label className="form-check-label" htmlFor={`bogoProductCheck_${p.id}`}>
                                      {p.name} {p.status ? <span className="text-muted">({p.status})</span> : null}
                                    </label>
                                  </div>
                                );
                              })
                            )}
                          </div>
                          <div className="form-text">
                            {t('selectedCount').replace('{count}', lang === 'my' ? toMyanmarNumber((formData.rules.productIds || []).length) : (formData.rules.productIds || []).length)}
                          </div>
                        </div>
                      )}

                      {formData.type === 'BUY_X_GET_Y' && (
                        <div className="mb-3">
                          <div className="row g-3">
                            <div className="col-md-6">
                              <div className="d-flex justify-content-between align-items-center">
                                <label className="form-label mb-0">{t('buyProductsLabel')}</label>
                                <div className="d-flex gap-2">
                                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => selectAllFilteredRuleIds('buyProductIds', filteredBuyProducts)} disabled={productsLoading || filteredBuyProducts.length === 0}>
                                    {t('selectAll')}
                                  </button>
                                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => clearRuleIds('buyProductIds')}>
                                    {t('clear')}
                                  </button>
                                </div>
                              </div>
                              <input
                                className="form-control mt-2"
                                placeholder={t('searchProductsPlaceholder')}
                                value={buyProductSearch}
                                onChange={(e) => setBuyProductSearch(e.target.value)}
                              />
                              <div className="border rounded mt-2 p-2" style={{ maxHeight: 240, overflow: 'auto' }}>
                                {productsLoading ? (
                                  <div className="text-muted">{t('loadingProducts')}</div>
                                ) : filteredBuyProducts.length === 0 ? (
                                  <div className="text-muted">{t('noProductsFound')}</div>
                                ) : (
                                  filteredBuyProducts.map(p => {
                                    const pid = Number(p.id);
                                    const selected = (formData.rules.buyProductIds || []).includes(pid);
                                    const blockedByOther = (formData.rules.getProductIds || []).includes(pid);
                                    const blockedByPromo = blockedPromotionProductIds.has(pid);
                                    const disabled = blockedByOther || (blockedByPromo && !selected);
                                    const disabledTitle = blockedByOther
                                      ? t('alreadyInGetList')
                                      : blockedByPromo ? t('alreadyInAnotherPromo') : '';
                                    return (
                                      <div className={`form-check${disabled ? ' opacity-50' : ''}`} key={`buy_${p.id}`} title={disabledTitle}>
                                        <input
                                          className="form-check-input"
                                          type="checkbox"
                                          checked={selected}
                                          disabled={disabled}
                                          onChange={() => toggleRuleIds('buyProductIds', pid)}
                                          id={`buyProductCheck_${p.id}`}
                                        />
                                        <label className={`form-check-label${disabled ? ' text-muted' : ''}`} htmlFor={`buyProductCheck_${p.id}`} title={disabledTitle}>
                                          {p.name} {p.status ? <span className="text-muted">({p.status})</span> : null}
                                        </label>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                              <div className="form-text">
                                {t('selectedCount').replace('{count}', lang === 'my' ? toMyanmarNumber((formData.rules.buyProductIds || []).length) : (formData.rules.buyProductIds || []).length)}. {t('buyGetSharedCount')}
                              </div>
                            </div>

                            <div className="col-md-6">
                              <div className="d-flex justify-content-between align-items-center">
                                <label className="form-label mb-0">{t('getProductsLabel')}</label>
                                <div className="d-flex gap-2">
                                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => selectAllFilteredRuleIds('getProductIds', filteredGetProducts)} disabled={productsLoading || filteredGetProducts.length === 0}>
                                    {t('selectAll')}
                                  </button>
                                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => clearRuleIds('getProductIds')}>
                                    {t('clear')}
                                  </button>
                                </div>
                              </div>
                              <input
                                className="form-control mt-2"
                                placeholder={t('searchProductsPlaceholder')}
                                value={getProductSearch}
                                onChange={(e) => setGetProductSearch(e.target.value)}
                              />
                              <div className="border rounded mt-2 p-2" style={{ maxHeight: 240, overflow: 'auto' }}>
                                {productsLoading ? (
                                  <div className="text-muted">{t('loadingProducts')}</div>
                                ) : filteredGetProducts.length === 0 ? (
                                  <div className="text-muted">{t('noProductsFound')}</div>
                                ) : (
                                  filteredGetProducts.map(p => {
                                    const pid = Number(p.id);
                                    const selected = (formData.rules.getProductIds || []).includes(pid);
                                    const blockedByOther = (formData.rules.buyProductIds || []).includes(pid);
                                    const blockedByPromo = blockedPromotionProductIds.has(pid);
                                    const disabled = blockedByOther || (blockedByPromo && !selected);
                                    const disabledTitle = blockedByOther
                                      ? t('alreadyInBuyList')
                                      : blockedByPromo ? t('alreadyInAnotherPromo') : '';
                                    return (
                                      <div className={`form-check${disabled ? ' opacity-50' : ''}`} key={`get_${p.id}`} title={disabledTitle}>
                                        <input
                                          className="form-check-input"
                                          type="checkbox"
                                          checked={selected}
                                          disabled={disabled}
                                          onChange={() => toggleRuleIds('getProductIds', pid)}
                                          id={`getProductCheck_${p.id}`}
                                        />
                                        <label className={`form-check-label${disabled ? ' text-muted' : ''}`} htmlFor={`getProductCheck_${p.id}`} title={disabledTitle}>
                                          {p.name} {p.status ? <span className="text-muted">({p.status})</span> : null}
                                        </label>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                              <div className="form-text">
                                {t('selectedCount').replace('{count}', lang === 'my' ? toMyanmarNumber((formData.rules.getProductIds || []).length) : (formData.rules.getProductIds || []).length)}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="row mb-3">
                        <div className="col-md-4">
                          <label className="form-label">{t('startDate')}</label>
                          <input
                            type="datetime-local"
                            className="form-control"
                            value={formData.start_at}
                            onChange={(e) => setFormData({ ...formData, start_at: e.target.value })}
                            required
                          />
                        </div>
                        <div className="col-md-4">
                          <label className="form-label">{t('endDate')}</label>
                          <input
                            type="datetime-local"
                            className="form-control"
                            value={formData.end_at}
                            onChange={(e) => setFormData({ ...formData, end_at: e.target.value })}
                            required
                          />
                        </div>
                        <div className="col-md-4">
                          <label className="form-label">{t('promotionPriority')}</label>
                          <input
                            type="number"
                            className="form-control"
                            value={formData.priority}
                            onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                            required
                          />
                          <small className="text-muted">{t('priorityHelp')}</small>
                        </div>
                      </div>

                      <div className="mb-3">
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={formData.active}
                            onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                            id="activeCheck"
                          />
                          <label className="form-check-label" htmlFor="activeCheck">
                            {t('enabled')}
                          </label>
                        </div>
                      </div>

                      <div className="d-flex gap-2">
                        <button type="submit" className="btn btn-primary d-flex align-items-center gap-2">
                          <i className={`bi bi-${editingPromo ? 'check-circle' : 'plus-circle'}`}></i>
                          {editingPromo ? t('updatePromotion') : t('createPromotion')}
                        </button>
                        <button type="button" className="btn btn-outline-secondary" onClick={() => { setShowForm(false); setEditingPromo(null); resetForm(); }}>
                          {t('cancel')}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">{t('loading')}...</span>
                  </div>
                  <p className="mt-2 text-muted">{t('loadingPromotions')}...</p>
                </div>
              ) : error ? (
                <div className="alert alert-danger">{error}</div>
              ) : promotions.length === 0 ? (
                <div className="card shadow-sm border-0">
                  <div className="card-body text-center py-5">
                    <i className="bi bi-tag fs-1 text-muted mb-3 d-block"></i>
                    <p className="text-muted mb-0">{t('noPromotionsYet')}</p>
                  </div>
                </div>
              ) : (
                <div className="card shadow-sm border-0">
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table table-hover align-middle mb-0">
                        <thead className="bg-light">
                          <tr>
                            <th className="px-4 py-3">{t('promotionName')}</th>
                            <th className="py-3">{t('promotionType')}</th>
                            <th className="py-3">{t('rules')}</th>
                            <th className="py-3">{t('status')}</th>
                            <th className="py-3">{t('dates')}</th>
                            <th className="py-3 text-center">{t('promotionPriority')}</th>
                            <th className="px-4 py-3 text-end">{t('actions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {promotions.map(promo => (
                            <tr key={promo.id}>
                              <td className="px-4"><strong>{promo.name}</strong></td>
                              <td>
                                {(() => {
                                  if (promo.type === 'PERCENT_OFF') {
                                    return <span className="badge bg-primary-soft text-primary">{t('percentOff')}</span>;
                                  }
                                  const rules = typeof promo.rules === 'string' ? JSON.parse(promo.rules) : promo.rules;
                                  const legacyProductIds = Array.isArray(rules?.productIds) ? rules.productIds : [];
                                  const buyIds = Array.isArray(rules?.buyProductIds) ? rules.buyProductIds : [];
                                  const getIds = Array.isArray(rules?.getProductIds) ? rules.getProductIds : [];
                                  const isBogo =
                                    (Number(rules?.buyQty) || 0) === 1 &&
                                    (Number(rules?.getQty) || 0) === 1 &&
                                    buyIds.length === 0 &&
                                    getIds.length === 0 &&
                                    legacyProductIds.length > 0 &&
                                    String(rules?.discountType || 'FREE').toUpperCase() === 'FREE';
                                  return <span className="badge bg-success-soft text-success">{isBogo ? t('bogoTitle') : t('buyXGetY')}</span>;
                                })()}
                              </td>
                              <td>{formatRules(promo)}</td>
                              <td>
                                {(() => {
                                  const s = getStatusMeta(promo);
                                  return <span className={`badge ${s.badgeClass}`}>{s.label}</span>;
                                })()}
                              </td>
                              <td>
                                <div className="d-flex flex-column">
                                  <small className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('startDate')}</small>
                                  <div className="mb-1">{formatDate(promo.start_at, lang)}</div>
                                  <small className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('endDate')}</small>
                                  <div>{formatDate(promo.end_at, lang)}</div>
                                </div>
                              </td>
                              <td className="text-center">
                                <span className="badge bg-light text-dark border">
                                  {lang === 'my' ? toMyanmarNumber(promo.priority) : promo.priority}
                                </span>
                              </td>
                              <td className="px-4 text-end">
                                <div className="d-flex gap-2 justify-content-end">
                                  <button
                                    className="btn btn-sm btn-outline-primary"
                                    onClick={() => handleEdit(promo)}
                                    title={t('editTitle')}
                                  >
                                    <i className="bi bi-pencil"></i>
                                  </button>
                                  <button
                                    className={`btn btn-sm ${promo.active ? 'btn-outline-warning' : 'btn-outline-success'}`}
                                    onClick={() => toggleActive(promo.id, promo.active)}
                                    title={promo.active ? t('hideTitle') : t('showTitle')}
                                  >
                                    <i className={`bi bi-${promo.active ? 'pause' : 'play'}-circle`}></i>
                                  </button>
                                  <button
                                    className="btn btn-sm btn-outline-danger"
                                    onClick={() => openDeleteModal(promo)}
                                    title={t('deleteTitle')}
                                  >
                                    <i className="bi bi-trash"></i>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {deleteModalOpen && (
        <>
          <div className="modal fade show" style={{ display: 'block' }} tabIndex="-1" role="dialog" aria-modal="true">
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content border-0 shadow">
                <div className="modal-header border-0 pb-0">
                  <h5 className="modal-title fw-bold">{t('deletePromotionConfirm')}</h5>
                  <button type="button" className="btn-close" onClick={closeDeleteModal} aria-label="Close"></button>
                </div>
                <div className="modal-body py-4">
                  <div className="text-muted">
                    {t('deletePermanently').replace('{name}', deleteTarget?.name || t('promotions'))}
                  </div>
                </div>
                <div className="modal-footer border-0 pt-0">
                  <button type="button" className="btn btn-light px-4" onClick={closeDeleteModal} disabled={deleteLoading}>
                    {t('cancel')}
                  </button>
                  <button type="button" className="btn btn-danger px-4" onClick={handleDelete} disabled={deleteLoading}>
                    {deleteLoading ? `${t('deleting')}...` : t('delete')}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}
    </>
  );
}
