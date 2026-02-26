import { useState, useEffect, useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import Sidebar from '../../components/Sidebar';
import TopNavbar from '../../components/TopNavbar';
import { useNotifications } from '../../contexts/NotificationContext';
import { useTranslation } from '../../utils/i18n';
import { formatCurrency } from '../../utils/formatCurrency';

export default function ProductsPage() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://bakeflow.onrender.com';
  const PRODUCT_CACHE_KEY = 'bf_admin_products_cache';
  const PREORDER_CACHE_KEY = 'bf_admin_preorder_settings_cache';
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filter, setFilter] = useState({ category: '', status: '', search: '' });
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });
  const [stockStatus, setStockStatus] = useState({});
  const [preorderSettings, setPreorderSettings] = useState({ enabled: true, product_ids: [] });
  const [preorderCategoryFilter, setPreorderCategoryFilter] = useState('all');
  const [preorderLoading, setPreorderLoading] = useState(true);
  const [preorderSaving, setPreorderSaving] = useState(false);
  const { notifications, unreadCount, hasUnread, markAsRead, markAllRead, clearAll } = useNotifications();
  const { t } = useTranslation();

  const getAdminToken = useCallback(() => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem('bakeflow_admin_token') || '';
    } catch {
      return '';
    }
  }, []);

  const buildAuthHeaders = useCallback((extra = {}) => {
    const tok = getAdminToken();
    const headers = { ...extra };
    if (tok) headers.Authorization = `Bearer ${tok}`;
    return headers;
  }, [getAdminToken]);

  const fetchStockStatus = useCallback(async (productIds) => {
    if (!productIds.length) {
      setStockStatus({});
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/stock/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: productIds }),
      });
      if (!res.ok) throw new Error(`Stock API error ${res.status}`);
      const data = await res.json();
      const next = {};
      (data.products || []).forEach(item => {
        next[item.product_id] = item;
      });
      setStockStatus(next);
    } catch (e) {
      console.error(e);
      setStockStatus({});
    }
  }, [API_BASE]);

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter.category) params.append('category', filter.category);
      if (filter.status) params.append('status', filter.status);
      if (filter.search) params.append('search', filter.search);
      const res = await fetch(`${API_BASE}/api/products?${params.toString()}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      const nextProducts = data.products || [];
      setProducts(nextProducts);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(nextProducts));
        } catch {}
      }
      await fetchStockStatus(nextProducts.map(product => product.id));
      setError(null);
    } catch (e) {
      console.error(e);
      let usedCache = false;
      if (typeof window !== 'undefined') {
        try {
          const cached = JSON.parse(localStorage.getItem(PRODUCT_CACHE_KEY) || '[]');
          if (Array.isArray(cached) && cached.length) {
            setProducts(cached);
            fetchStockStatus(cached.map(product => product.id));
            usedCache = true;
          }
        } catch {}
      }
      setError(usedCache ? null : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [API_BASE, fetchStockStatus, filter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const cached = JSON.parse(localStorage.getItem(PRODUCT_CACHE_KEY) || '[]');
      if (Array.isArray(cached) && cached.length) {
        setProducts(cached);
        fetchStockStatus(cached.map(product => product.id));
      }
    } catch {}
  }, [fetchStockStatus]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const fetchPreorderSettings = useCallback(async () => {
    try {
      setPreorderLoading(true);
      const res = await fetch(`${API_BASE}/api/admin/preorder-settings`, {
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      const nextSettings = {
        enabled: !!data.enabled,
        product_ids: Array.isArray(data.product_ids) ? data.product_ids : [],
      };
      setPreorderSettings(nextSettings);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(PREORDER_CACHE_KEY, JSON.stringify(nextSettings));
        } catch {}
      }
    } catch {
      let usedCache = false;
      if (typeof window !== 'undefined') {
        try {
          const cached = JSON.parse(localStorage.getItem(PREORDER_CACHE_KEY) || 'null');
          if (cached && typeof cached === 'object') {
            setPreorderSettings({
              enabled: cached.enabled !== false,
              product_ids: Array.isArray(cached.product_ids) ? cached.product_ids : [],
            });
            usedCache = true;
          }
        } catch {}
      }
      if (!usedCache) setPreorderSettings({ enabled: true, product_ids: [] });
    } finally {
      setPreorderLoading(false);
    }
  }, [API_BASE, buildAuthHeaders]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const cached = JSON.parse(localStorage.getItem(PREORDER_CACHE_KEY) || 'null');
      if (cached && typeof cached === 'object') {
        setPreorderSettings({
          enabled: cached.enabled !== false,
          product_ids: Array.isArray(cached.product_ids) ? cached.product_ids : [],
        });
      }
    } catch {}
  }, []);

  useEffect(() => { fetchPreorderSettings(); }, [fetchPreorderSettings]);

  const showNotification = (message, type) => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: '', type: '' }), 5000);
  };

  const deleteProduct = async (id) => {
    if (!confirm('Are you sure you want to archive this product?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/products/${id}`, {
        method: 'DELETE',
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      if (data.success) { showNotification(t('archiveSuccess'), 'success'); fetchProducts(); }
      else showNotification(t('failedToArchive'), 'danger');
    } catch {
      showNotification(t('errorUpdating'), 'danger');
    }
  };

  const updateStatus = async (id, newStatus) => {
    try {
      const res = await fetch(`${API_BASE}/api/products/${id}/status`, {
        method: 'PATCH',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      if (data.success) { 
        showNotification(newStatus === 'active' ? t('productPublished') : t('productUpdated'), 'success'); 
        fetchProducts(); 
      }
      else showNotification(t('failedToUpdate'), 'danger');
    } catch {
      showNotification(t('errorUpdating'), 'danger');
    }
  };

  const adjustStock = async (id, adjustment) => {
    try {
      const res = await fetch(`${API_BASE}/api/products/${id}/stock`, {
        method: 'PATCH',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ adjustment }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      if (data.success) {
        showNotification(`${t('stockColumn')}: ${data.old_stock} → ${data.new_stock}`, 'success');
        fetchProducts();
      } else {
        showNotification(t('failedToUpdate'), 'danger');
      }
    } catch {
      showNotification(t('errorUpdating'), 'danger');
    }
  };

  const preorderSelectedSet = useMemo(() => {
    return new Set(preorderSettings.product_ids || []);
  }, [preorderSettings.product_ids]);

  const normalizeCategory = useCallback((value) => String(value || '').trim().toLowerCase(), []);

  const preorderSelectableProducts = useMemo(() => {
    return products.filter((product) => {
      const category = normalizeCategory(product.category);
      return category === 'cakes' && product.status === 'active';
    });
  }, [products, normalizeCategory]);

  const selectedPreorderProducts = useMemo(() => {
    return preorderSelectableProducts.filter((product) => preorderSelectedSet.has(product.id));
  }, [preorderSelectableProducts, preorderSelectedSet]);

  const availablePreorderProducts = useMemo(() => {
    return preorderSelectableProducts.filter((product) => !preorderSelectedSet.has(product.id));
  }, [preorderSelectableProducts, preorderSelectedSet]);

  const preorderCategoryOptions = ['all', 'cakes', 'cupcakes', 'muffins'];

  const filteredAvailablePreorderProducts = useMemo(() => {
    if (preorderCategoryFilter === 'all') return availablePreorderProducts;
    return availablePreorderProducts.filter((product) => normalizeCategory(product.category) === preorderCategoryFilter);
  }, [availablePreorderProducts, preorderCategoryFilter, normalizeCategory]);

  const filteredSelectedPreorderProducts = useMemo(() => {
    if (preorderCategoryFilter === 'all') return selectedPreorderProducts;
    return selectedPreorderProducts.filter((product) => normalizeCategory(product.category) === preorderCategoryFilter);
  }, [selectedPreorderProducts, preorderCategoryFilter, normalizeCategory]);

  const sanitizedPreorderSelection = useMemo(() => {
    return preorderSelectableProducts
      .filter((product) => preorderSelectedSet.has(product.id))
      .map((product) => product.id);
  }, [preorderSelectableProducts, preorderSelectedSet]);

  const preorderDisabled = !preorderSettings.enabled;

  const togglePreorderProduct = (id) => {
    setPreorderSettings((prev) => {
      const next = new Set(prev.product_ids || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, product_ids: Array.from(next) };
    });
  };

  const selectAllPreorder = () => {
    setPreorderSettings((prev) => {
      const next = new Set(prev.product_ids || []);
      preorderSelectableProducts.forEach((p) => next.add(p.id));
      return { ...prev, product_ids: Array.from(next) };
    });
  };

  const clearPreorderSelection = () => {
    setPreorderSettings((prev) => ({ ...prev, product_ids: [] }));
  };

  const savePreorderSettings = async () => {
    try {
      setPreorderSaving(true);
      const res = await fetch(`${API_BASE}/api/admin/preorder-settings`, {
        method: 'PUT',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          enabled: !!preorderSettings.enabled,
          product_ids: sanitizedPreorderSelection,
        }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      if (data.success) {
        const nextSettings = {
          enabled: !!data.enabled,
          product_ids: Array.isArray(data.product_ids) ? data.product_ids : [],
        };
        setPreorderSettings(nextSettings);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(PREORDER_CACHE_KEY, JSON.stringify(nextSettings));
          } catch {}
        }
        showNotification(t('productUpdated'), 'success');
      } else {
        showNotification(data.error || t('failedToUpdate'), 'danger');
      }
    } catch {
      showNotification(t('errorUpdating'), 'danger');
    } finally {
      setPreorderSaving(false);
    }
  };

  const getStatusBadge = (status) => {
    const m = {
      draft: 'bg-warning-subtle text-warning border border-warning-subtle',
      active: 'bg-success-subtle text-success border border-success-subtle',
      inactive: 'bg-secondary-subtle text-secondary border border-secondary-subtle',
      archived: 'bg-danger-subtle text-danger border border-danger-subtle'
    };
    return m[status] || 'bg-secondary-subtle text-secondary border border-secondary-subtle';
  };

  const lowStockCount = useMemo(() => {
    return products.filter(product => {
      const info = stockStatus[product.id];
      if (info) return info.status !== 'in_stock';
      if (product.out_of_stock || product.low_stock) return true;
      return ['limited', 'sold_out'].includes(product.availability_status);
    }).length;
  }, [products, stockStatus]);

  return (
    <>
      <Head>
        <title>Products - BakeFlow Admin</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet" />
      </Head>

      <div className="d-flex vh-100 overflow-hidden bg-light-subtle">
        <Sidebar open={sidebarOpen} toggle={() => setSidebarOpen(!sidebarOpen)} />

        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <TopNavbar
            toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            notifications={notifications}
            unreadCount={unreadCount}
            hasUnread={hasUnread}
            onMarkAllRead={markAllRead}
            onClearAll={clearAll}
            onNotificationClick={(id) => markAsRead(id)}
            pageTitle={t('productsTitle')}
            pageSubtitle={t('productInventory')}
          />

          <div className="flex-grow-1 overflow-auto">
            <div className="container-xl py-4">

              {notification.show && (
                <div className={`alert alert-${notification.type} alert-dismissible fade show position-fixed top-0 end-0 m-4`} style={{ zIndex: 9999 }} role="alert">
                  <strong>{notification.message}</strong>
                  <button type="button" className="btn-close" onClick={() => setNotification({ show: false, message: '', type: '' })}></button>
                </div>
              )}

              <div className="card shadow-sm mb-4">
                <div className="card-body">
                  <div className="mb-3">
                    <h5 className="mb-1 fw-semibold">{t('preorderTitle')}</h5>
                    <div className="text-muted small">{t('preorderSubtitle')}</div>
                  </div>
                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={selectAllPreorder}
                        disabled={preorderLoading || products.length === 0 || preorderDisabled}
                      >
                        {t('selectAllLoaded')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={clearPreorderSelection}
                        disabled={preorderLoading || preorderSettings.product_ids.length === 0 || preorderDisabled}
                      >
                        {t('clearSelection')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={savePreorderSettings}
                        disabled={preorderLoading || preorderSaving}
                      >
                        {preorderSaving ? t('updating') : t('saveBanner')}
                      </button>
                    </div>
                    <div className="form-check form-switch d-flex align-items-center gap-2">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="preorderEnabledToggle"
                        checked={!!preorderSettings.enabled}
                        onChange={(e) => setPreorderSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
                        disabled={preorderLoading}
                      />
                      <label className="form-check-label fw-semibold" htmlFor="preorderEnabledToggle">{t('enablePreorderDisplay')}</label>
                    </div>
                  </div>
                  <div className="position-relative">
                    {preorderDisabled && (
                      <div className="bg-secondary bg-opacity-10 rounded-3" style={{ position: 'absolute', inset: 0, zIndex: 2 }}></div>
                    )}
                    <div className={`row g-3 ${preorderDisabled ? 'opacity-50' : ''}`}>
                      <div className="col-12 col-lg-6">
                        <div className="d-flex align-items-center justify-content-between mb-2">
                          <div className="fw-semibold">{t('availableProductsLabel')}</div>
                          <span className="badge bg-light text-muted border">{filteredAvailablePreorderProducts.length}</span>
                        </div>
                        <div className="d-flex align-items-center gap-2 mb-2">
                          {preorderCategoryOptions.map((option) => {
                            const active = preorderCategoryFilter === option;
                            return (
                              <button
                                key={`preorder-filter-left-${option}`}
                                type="button"
                                className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
                                onClick={() => setPreorderCategoryFilter(option)}
                                disabled={preorderLoading || preorderDisabled}
                              >
                                {t(option === 'all' ? 'all' : option.toLowerCase()) || (option.charAt(0).toUpperCase() + option.slice(1))}
                              </button>
                            );
                          })}
                        </div>
                        <div className="d-flex flex-column gap-2">
                          {filteredAvailablePreorderProducts.map((product) => {
                            const statusLabel = product.status === 'active' ? t('activeLabel') : product.status === 'draft' ? t('draftLabel') : t('inactive');
                            return (
                              <div className="border rounded-3 p-3 d-flex align-items-center gap-3 bg-white" key={`preorder-available-${product.id}`}>
                                <input
                                  type="checkbox"
                                  className="form-check-input mt-0"
                                  style={{ width: 24, height: 24 }}
                                  checked={preorderSelectedSet.has(product.id)}
                                  onChange={() => togglePreorderProduct(product.id)}
                                  disabled={preorderLoading || preorderDisabled}
                                />
                                <div className="rounded-3 overflow-hidden bg-light" style={{ width: 64, height: 64 }}>
                                  {product.image_url ? (
                                    <Image src={product.image_url} alt={product.name} width={64} height={64} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  ) : (
                                    <div className="d-flex align-items-center justify-content-center h-100">
                                      <i className="bi bi-image text-muted"></i>
                                    </div>
                                  )}
                                </div>
                                <div className="flex-grow-1">
                                  <div className="fw-semibold d-flex align-items-center gap-2">
                                    {product.name}
                                    <span className="badge rounded-pill bg-secondary-subtle text-secondary border border-secondary-subtle">{product.category}</span>
                                  </div>
                                  <div className="text-muted small d-flex align-items-center gap-2">
                                    <span className={`badge rounded-pill ${getStatusBadge(product.status)}`}>{statusLabel}</span>
                                    <span>{formatCurrency(product.price || 0)}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {!filteredAvailablePreorderProducts.length && (
                            <div className="text-muted small">{t('allProductsInPreorder')}</div>
                          )}
                        </div>
                      </div>
                      <div className="col-12 col-lg-6">
                        <div className="d-flex align-items-center justify-content-between mb-2">
                          <div className="fw-semibold text-success">{t('selectedForPreorder')}</div>
                          <span className="badge bg-success-subtle text-success border border-success-subtle">{filteredSelectedPreorderProducts.length}</span>
                        </div>
                        <div className="d-flex align-items-center gap-2 mb-2">
                          {preorderCategoryOptions.map((option) => {
                            const active = preorderCategoryFilter === option;
                            return (
                              <button
                                key={`preorder-filter-right-${option}`}
                                type="button"
                                className={`btn btn-sm ${active ? 'btn-success' : 'btn-outline-secondary'}`}
                                onClick={() => setPreorderCategoryFilter(option)}
                                disabled={preorderLoading || preorderDisabled}
                              >
                                {t(option === 'all' ? 'all' : option.toLowerCase()) || (option.charAt(0).toUpperCase() + option.slice(1))}
                              </button>
                            );
                          })}
                        </div>
                        <div className="d-flex flex-column gap-2">
                          {filteredSelectedPreorderProducts.map((product) => {
                            const statusLabel = product.status === 'active' ? t('activeLabel') : product.status === 'draft' ? t('draftLabel') : t('inactive');
                            return (
                              <div className="border border-success border-2 rounded-3 p-3 d-flex align-items-center gap-3 bg-success-subtle" key={`preorder-selected-${product.id}`}>
                                <input
                                  type="checkbox"
                                  className="form-check-input mt-0"
                                  style={{ width: 24, height: 24 }}
                                  checked={preorderSelectedSet.has(product.id)}
                                  onChange={() => togglePreorderProduct(product.id)}
                                  disabled={preorderLoading || preorderDisabled}
                                />
                                <div className="rounded-3 overflow-hidden bg-light" style={{ width: 64, height: 64 }}>
                                  {product.image_url ? (
                                    <Image src={product.image_url} alt={product.name} width={64} height={64} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  ) : (
                                    <div className="d-flex align-items-center justify-content-center h-100">
                                      <i className="bi bi-image text-muted"></i>
                                    </div>
                                  )}
                                </div>
                                <div className="flex-grow-1">
                                  <div className="fw-semibold d-flex align-items-center gap-2">
                                    {product.name}
                                    <span className="badge rounded-pill bg-secondary-subtle text-secondary border border-secondary-subtle">{product.category}</span>
                                  </div>
                                  <div className="text-muted small d-flex align-items-center gap-2">
                                    <span className="badge rounded-pill bg-success text-white d-inline-flex align-items-center gap-1">
                                      <i className="bi bi-calendar-event"></i>
                                      {t('inPreorder')}
                                    </span>
                                    <span className={`badge rounded-pill ${getStatusBadge(product.status)}`}>{statusLabel}</span>
                                    <span>{formatCurrency(product.price || 0)}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {!filteredSelectedPreorderProducts.length && (
                            <div className="text-muted small">{t('noProductsSelected')}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="d-flex justify-content-end mt-3">
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      onClick={savePreorderSettings}
                      disabled={preorderLoading || preorderSaving}
                    >
                      {preorderSaving ? t('updating') : t('savePreorderSelection')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Page Header */}
              <div className="d-flex align-items-center justify-content-between mb-4">
                <div>
                  <h1 className="h3 mb-1 fw-semibold">{t('productsTitle')}</h1>
                  <p className="text-muted mb-0 small">{t('productInventory')}</p>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <button className="btn btn-outline-secondary d-none d-md-inline-flex">
                    <i className="bi bi-download me-2"></i>{t('exportCSV')}
                  </button>
                  <Link href="/admin/products/new">
                    <button className="btn btn-primary"><i className="bi bi-plus-lg me-2"></i>{t('addProduct')}</button>
                  </Link>
                </div>
              </div>

              {/* KPI Summary Cards */}
              <div className="row g-4 mb-4">
                {[
                  { icon: 'bi-box', label: t('totalProducts'), value: products.length },
                  { icon: 'bi-check-circle', label: t('activeProducts'), value: products.filter(p => p.status === 'active').length },
                  { icon: 'bi-exclamation-triangle', label: t('lowStockItems'), value: lowStockCount },
                  { icon: 'bi-eye', label: t('totalViews'), value: products.reduce((s, p) => s + (p.views || 0), 0) }
                ].map((c, idx) => (
                  <div className="col-lg-3 col-md-6" key={idx}>
                    <div className="card shadow-sm border-light rounded-3 h-100">
                      <div className="card-body p-4">
                        <div className="d-flex align-items-center gap-3">
                          <div className="rounded-3 d-inline-flex align-items-center justify-content-center bg-light text-secondary" style={{ width: 48, height: 48 }}>
                            <i className={`bi ${c.icon}`}></i>
                          </div>
                          <div>
                            <div className="fs-2 fw-semibold lh-1">{c.value}</div>
                            <div className="text-muted text-uppercase small mt-1">{c.label}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Filters & Actions Bar */}
              <div className="card shadow-sm border-light rounded-3 mb-3">
                <div className="card-body p-3 p-md-4">
                  <div className="bg-light p-3 rounded-3 mb-2">
                    <div className="row g-3">
                      {/* LEFT: Search & Filters */}
                      <div className="col-12 col-lg-8">
                        <div className="row g-3">
                          <div className="col-12 col-md-6">
                            <div className="input-group input-group-lg">
                              <span className="input-group-text bg-white border-end-0"><i className="bi bi-search"></i></span>
                              <input
                                type="text"
                                className="form-control border-start-0"
                                placeholder={t('searchProducts')}
                                value={filter.search}
                                onChange={(e) => setFilter({ ...filter, search: e.target.value })}
                              />
                            </div>
                          </div>
                          <div className="col-6 col-md-3">
                            <select
                              className="form-select form-select-lg"
                              value={filter.category}
                              onChange={(e) => setFilter({ ...filter, category: e.target.value })}
                            >
                              <option value="">{t('allCategories')}</option>
                              <option value="Cakes">Cakes</option>
                              <option value="Cupcakes">Cupcakes</option>
                              <option value="Muffins">Muffins</option>
                              <option value="Tarts">Tarts</option>
                              <option value="Cookies">Cookies</option>
                            </select>
                          </div>
                          <div className="col-6 col-md-3">
                            <select
                              className="form-select form-select-lg"
                              value={filter.status}
                              onChange={(e) => setFilter({ ...filter, status: e.target.value })}
                            >
                              <option value="">{t('allStatus')}</option>
                              <option value="draft">Draft</option>
                              <option value="active">{t('activeLabel')}</option>
                              <option value="inactive">Inactive</option>
                              <option value="archived">{t('hiddenLabel')}</option>
                            </select>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Products Table */}
                  {loading ? (
                    <div className="text-center py-5">
                      <div className="spinner-border text-primary" role="status">
                        <span className="visually-hidden">{t('loadingOrders')}</span>
                      </div>
                    </div>
                  ) : error ? (
                    <div className="alert alert-danger mb-0">{error}</div>
                  ) : products.length === 0 ? (
                    <div className="text-center py-5">
                      <i className="bi bi-box-seam fs-1 text-muted mb-3 d-block"></i>
                      <h5 className="text-muted">{t('noProductsYet')}</h5>
                      <p className="text-muted">{t('createYourFirstProduct')}</p>
                      <Link href="/admin/products/new">
                        <button className="btn btn-primary"><i className="bi bi-plus-lg me-2"></i>{t('createProduct')}</button>
                      </Link>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-hover align-middle mb-0">
                        <thead className="table-light sticky-top" style={{ top: 0, zIndex: 1 }}>
                          <tr>
                            <th className="text-uppercase text-muted small fw-semibold py-3">{t('productColumn')}</th>
                            <th className="text-uppercase text-muted small fw-semibold py-3">{t('priceColumn')}</th>
                            <th className="text-uppercase text-muted small fw-semibold py-3">{t('stockColumn')}</th>
                            <th className="text-uppercase text-muted small fw-semibold py-3">{t('performanceColumn')}</th>
                            <th className="text-uppercase text-muted small fw-semibold py-3">{t('statusColumn')}</th>
                            <th className="text-uppercase text-muted small fw-semibold text-end py-3">{t('actionsColumn')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map((product) => {
                            const info = stockStatus[product.id];
                            const availableStock = info?.available_stock ?? product.stock ?? 0;
                            const totalStock = info?.total_stock ?? product.stock ?? availableStock;
                            const reservedStock = info?.reserved_stock ?? Math.max(totalStock - availableStock, 0);
                            const isOutOfStock = info?.status === 'out_of_stock' || product.out_of_stock || product.availability_status === 'sold_out';
                            const isLowStock = info?.status === 'low_stock' || product.low_stock || product.availability_status === 'limited';
                            return (
                            <tr key={product.id}>
                              <td>
                                <div className="d-flex align-items-center gap-3">
                                  <div className="rounded-3 overflow-hidden bg-light" style={{ width: 64, height: 64 }}>
                                    {product.image_url ? (
                                      <Image src={product.image_url} alt={product.name} width={64} height={64} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                      <div className="d-flex align-items-center justify-content-center h-100">
                                        <i className="bi bi-image text-muted"></i>
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <div className="fw-semibold mb-1 d-flex align-items-center gap-2">
                                      {product.name}
                                      <span className="badge rounded-pill bg-secondary-subtle text-secondary border border-secondary-subtle">{product.category}</span>
                                    </div>
                                    <div className="text-muted small d-none d-md-block" style={{ maxWidth: 420 }}>
                                      {product.description?.substring(0, 80)}{product.description && product.description.length > 80 ? '…' : ''}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="fw-semibold">{formatCurrency(product.price)}</td>
                              <td>
                                <div className="d-flex flex-column">
                                  <div className="d-flex align-items-center gap-2">
                                    <button 
                                      className="btn btn-outline-secondary btn-sm rounded-circle p-0" 
                                      style={{ width: 24, height: 24, fontSize: 14 }}
                                      onClick={() => adjustStock(product.id, -1)}
                                      title="Decrease stock"
                                    >
                                      <i className="bi bi-dash"></i>
                                    </button>
                                    <span className="fw-semibold" style={{ minWidth: 30, textAlign: 'center' }}>{availableStock}</span>
                                    <button 
                                      className="btn btn-outline-secondary btn-sm rounded-circle p-0" 
                                      style={{ width: 24, height: 24, fontSize: 14 }}
                                      onClick={() => adjustStock(product.id, 1)}
                                      title="Increase stock"
                                    >
                                      <i className="bi bi-plus"></i>
                                    </button>
                                  </div>
                                  <span className="mt-2">
                                    {isOutOfStock ? (
                                      <span className="badge rounded-pill bg-danger-subtle text-danger border border-danger-subtle d-inline-flex align-items-center gap-2"><span className="rounded-circle bg-danger" style={{ width: 8, height: 8, opacity: .2 }}></span> {t('outOfStock')}</span>
                                    ) : isLowStock ? (
                                      <span className="badge rounded-pill bg-warning-subtle text-warning border border-warning-subtle d-inline-flex align-items-center gap-2"><span className="rounded-circle bg-warning" style={{ width: 8, height: 8, opacity: .2 }}></span> {t('lowStock')}</span>
                                    ) : (
                                      <span className="badge rounded-pill bg-success-subtle text-success border border-success-subtle d-inline-flex align-items-center gap-2"><span className="rounded-circle bg-success" style={{ width: 8, height: 8, opacity: .2 }}></span> {t('goodStock')}</span>
                                    )}
                                  </span>
                                  <span className="text-muted small">
                                    Available {availableStock} / {totalStock}{reservedStock > 0 ? ` • ${reservedStock} reserved` : ''}
                                  </span>
                                  {isLowStock && availableStock > 0 ? (
                                    <span className="text-muted small">Only {availableStock} left</span>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <div className="d-flex align-items-center gap-2">
                                  <i className="bi bi-eye"></i>
                                  <span className="fw-semibold">{product.views || 0}</span>
                                  <span className="text-muted small">0% today</span>
                                </div>
                              </td>
                              <td>
                                <span className={`badge rounded-pill ${getStatusBadge(product.status)}`}>
                                  {product.status === 'active' ? t('activeLabel') : product.status === 'draft' ? 'Draft' : t('hiddenLabel')}
                                </span>
                              </td>
                              <td>
                                <div className="d-flex justify-content-end gap-2">
                                  <Link href={`/admin/products/${product.id}`}>
                                    <button className="btn btn-light btn-sm rounded-circle border" style={{ width: 36, height: 36 }} title={t('editTitle')} data-bs-toggle="tooltip">
                                      <i className="bi bi-pencil"></i>
                                    </button>
                                  </Link>
                                  {product.status === 'active' ? (
                                    <button
                                      className="btn btn-light btn-sm rounded-circle border text-warning"
                                      style={{ width: 36, height: 36 }}
                                      onClick={() => updateStatus(product.id, 'inactive')}
                                      title={t('hideTitle')}
                                      data-bs-toggle="tooltip"
                                    >
                                      <i className="bi bi-eye-slash"></i>
                                    </button>
                                  ) : (
                                    <button
                                      className="btn btn-light btn-sm rounded-circle border text-warning"
                                      style={{ width: 36, height: 36 }}
                                      onClick={() => updateStatus(product.id, 'active')}
                                      title={t('showTitle')}
                                      data-bs-toggle="tooltip"
                                    >
                                      <i className="bi bi-eye"></i>
                                    </button>
                                  )}
                                  <button
                                    className="btn btn-light btn-sm rounded-circle border text-danger"
                                    style={{ width: 36, height: 36 }}
                                    onClick={() => deleteProduct(product.id)}
                                    title={t('deleteTitle')}
                                    data-bs-toggle="tooltip"
                                  >
                                    <i className="bi bi-trash"></i>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
