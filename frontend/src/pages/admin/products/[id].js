import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Image from 'next/image';
import Sidebar from '../../../components/Sidebar';
import TopNavbar from '../../../components/TopNavbar';
import { useNotifications } from '../../../contexts/NotificationContext';

export default function ProductFormPage() {
  const router = useRouter();
  const { id } = router.query;
  const isEdit = id && id !== 'new';
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://bakeflow.onrender.com';

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });
  const { notifications, unreadCount, hasUnread, markAsRead, markAllRead, clearAll } = useNotifications();

  const [form, setForm] = useState({
    name: '',
    description: '',
    category: 'Cakes',
    price: '',
    stock: '',
    image_url: '',
    status: 'draft'
  });

  const [tagsInput, setTagsInput] = useState('');
  const [tagsList, setTagsList] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [tagsOpen, setTagsOpen] = useState(false);

  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  const [errors, setErrors] = useState({});
  const [preorderSettings, setPreorderSettings] = useState({
    enabled: true,
    start_date: '',
    end_date: '',
    sizes: [],
    layers: [],
    creams: [],
    size_prices: {},
    layer_prices: {},
    cream_prices: {}
  });
  const [preorderInputs, setPreorderInputs] = useState({
    size: '',
    sizePrice: '',
    layer: '',
    layerPrice: '',
    cream: '',
    creamPrice: ''
  });
  const [preorderLoading, setPreorderLoading] = useState(false);
  const [preorderSaving, setPreorderSaving] = useState(false);
  const [preorderErrors, setPreorderErrors] = useState({});
  const isCake = (form.category || '').trim().toLowerCase() === 'cakes';

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

  const showNotification = useCallback((message, type) => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: '', type: '' }), 5000);
  }, []);

  const fetchProduct = useCallback(async () => {
    if (!isEdit || !id) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/products/${id}`);
      const data = await res.json();
      if (data.product) {
        const rawPrice = data.product.price;
        const rawStock = data.product.stock;
        setForm({
          name: data.product.name || '',
          description: data.product.description || '',
          category: data.product.category || 'Cakes',
          price: (rawPrice === 0 || rawPrice) ? String(rawPrice) : '',
          stock: (rawStock === 0 || rawStock) ? String(rawStock) : '',
          image_url: data.product.image_url || '',
          status: data.product.status || 'draft'
        });
        setTagsList(Array.isArray(data.product.tags) ? data.product.tags : []);
        setTagsInput('');
        if (data.product.image_url) {
          setPreviewUrl(data.product.image_url);
        } else {
          setPreviewUrl('');
        }
      }
    } catch (e) {
      showNotification('Failed to load product', 'danger');
    } finally {
      setLoading(false);
    }
  }, [API_BASE, id, isEdit, showNotification]);

  const fetchPreorderSettings = useCallback(async () => {
    if (!isEdit || !id) return;
    setPreorderLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/products/${id}/preorder-settings`, {
        headers: buildAuthHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        setPreorderSettings({
          enabled: data.enabled !== false,
          start_date: data.start_date || '',
          end_date: data.end_date || '',
          sizes: Array.isArray(data.sizes) ? data.sizes : [],
          layers: Array.isArray(data.layers) ? data.layers : [],
          creams: Array.isArray(data.creams) ? data.creams : [],
          size_prices: data.size_prices && typeof data.size_prices === 'object' ? data.size_prices : {},
          layer_prices: data.layer_prices && typeof data.layer_prices === 'object' ? data.layer_prices : {},
          cream_prices: data.cream_prices && typeof data.cream_prices === 'object' ? data.cream_prices : {}
        });
      } else {
        showNotification(data.error || 'Failed to load preorder settings', 'danger');
      }
    } catch (e) {
      showNotification('Failed to load preorder settings', 'danger');
    } finally {
      setPreorderLoading(false);
    }
  }, [API_BASE, buildAuthHeaders, id, isEdit, showNotification]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  useEffect(() => {
    fetchPreorderSettings();
  }, [fetchPreorderSettings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/products/tags`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          const norm = (value) => {
            const v = String(value || '').trim().toLowerCase();
            if (!v) return '';
            return v.length > 32 ? v.slice(0, 32) : v;
          };
          const list = Array.isArray(data.tags) ? data.tags : [];
          const set = new Set(list.map((t) => norm(t)).filter(Boolean));
          setAvailableTags(Array.from(set).sort((a, b) => a.localeCompare(b)));
        }
      } catch {
        if (!cancelled) setAvailableTags([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [API_BASE]);

  const normalizeTag = (value) => {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return '';
    return v.length > 32 ? v.slice(0, 32) : v;
  };

  const parseTagsFromText = (text) => {
    return String(text || '')
      .split(',')
      .map((t) => normalizeTag(t))
      .filter(Boolean);
  };

  const addTagsFromText = (text) => {
    const incoming = parseTagsFromText(text);
    if (!incoming.length) return;
    setAvailableTags((prev) => {
      const set = new Set(prev.map((t) => normalizeTag(t)));
      incoming.forEach((t) => set.add(t));
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    });
    setTagsList((prev) => {
      const existing = new Set(prev.map((t) => normalizeTag(t)));
      const next = [...prev];
      for (const t of incoming) {
        if (!existing.has(t)) {
          next.push(t);
          existing.add(t);
        }
        if (next.length >= 20) break;
      }
      return next;
    });
  };

  const removeTag = (tag) => {
    const target = normalizeTag(tag);
    setTagsList((prev) => prev.filter((t) => normalizeTag(t) !== target));
  };

  const normalizeOption = (value) => String(value || '').trim();
  const parseExtraPrice = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return 0;
    return num < 0 ? 0 : num;
  };

  const addPreorderOption = (listKey, inputKey, priceInputKey) => {
    const nextValue = normalizeOption(preorderInputs[inputKey]);
    if (!nextValue) return;
    setPreorderSettings((prev) => {
      const existing = prev[listKey] || [];
      const hasValue = existing.some((v) => normalizeOption(v).toLowerCase() === nextValue.toLowerCase());
      if (hasValue) return prev;
      const next = { ...prev, [listKey]: [...existing, nextValue] };
      if (priceInputKey) {
        const priceKey = listKey === 'sizes' ? 'size_prices' : listKey === 'layers' ? 'layer_prices' : 'cream_prices';
        const price = parseExtraPrice(preorderInputs[priceInputKey]);
        next[priceKey] = { ...(prev[priceKey] || {}), [nextValue]: price };
      }
      return next;
    });
    setPreorderInputs((prev) => ({ ...prev, [inputKey]: '', ...(priceInputKey ? { [priceInputKey]: '' } : {}) }));
  };

  const removePreorderOption = (listKey, value) => {
    const target = normalizeOption(value);
    setPreorderSettings((prev) => ({
      ...prev,
      [listKey]: (prev[listKey] || []).filter((v) => normalizeOption(v) !== target),
      ...(listKey === 'sizes' || listKey === 'layers' || listKey === 'creams'
        ? {
          [listKey === 'sizes' ? 'size_prices' : listKey === 'layers' ? 'layer_prices' : 'cream_prices']:
            Object.fromEntries(Object.entries(prev[listKey === 'sizes' ? 'size_prices' : listKey === 'layers' ? 'layer_prices' : 'cream_prices'] || {}).filter(([k]) => normalizeOption(k) !== target))
        }
        : {})
    }));
  };

  const savePreorderSettings = async () => {
    if (!isEdit || !id) return;
    if (!isCake) {
      showNotification('Preorder settings are only available for cakes', 'danger');
      return false;
    }
    setPreorderSaving(true);
    setPreorderErrors({});
    try {
      if (preorderSettings.start_date && preorderSettings.end_date) {
        const start = new Date(preorderSettings.start_date);
        const end = new Date(preorderSettings.end_date);
        if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end < start) {
          setPreorderErrors({ end_date: 'End date must be after start date' });
          setPreorderSaving(false);
          return false;
        }
      }
      const res = await fetch(`${API_BASE}/api/admin/products/${id}/preorder-settings`, {
        method: 'PUT',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          enabled: preorderSettings.enabled,
          start_date: preorderSettings.start_date || '',
          end_date: preorderSettings.end_date || '',
          sizes: preorderSettings.sizes || [],
          layers: preorderSettings.layers || [],
          creams: preorderSettings.creams || [],
          size_prices: preorderSettings.size_prices || {},
          layer_prices: preorderSettings.layer_prices || {},
          cream_prices: preorderSettings.cream_prices || {}
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showNotification('Preorder settings saved', 'success');
        setPreorderSettings({
          enabled: data.enabled !== false,
          start_date: data.start_date || '',
          end_date: data.end_date || '',
          sizes: Array.isArray(data.sizes) ? data.sizes : [],
          layers: Array.isArray(data.layers) ? data.layers : [],
          creams: Array.isArray(data.creams) ? data.creams : [],
          size_prices: data.size_prices && typeof data.size_prices === 'object' ? data.size_prices : {},
          layer_prices: data.layer_prices && typeof data.layer_prices === 'object' ? data.layer_prices : {},
          cream_prices: data.cream_prices && typeof data.cream_prices === 'object' ? data.cream_prices : {}
        });
        return true;
      } else {
        showNotification(data.error || 'Failed to save preorder settings', 'danger');
        return false;
      }
    } catch (e) {
      showNotification('Failed to save preorder settings', 'danger');
      return false;
    } finally {
      setPreorderSaving(false);
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!form.name.trim()) newErrors.name = 'Product name is required';
    if (form.name.length > 255) newErrors.name = 'Name must be less than 255 characters';
    if (!form.category) newErrors.category = 'Category is required';
    if (!form.price || parseFloat(form.price) < 0) newErrors.price = 'Valid price is required';
    if (!form.stock || parseInt(form.stock) < 0) newErrors.stock = 'Valid stock quantity is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const saveProduct = async ({ redirect = true, silent = false } = {}) => {
    if (!validate()) {
      showNotification('Please fix the errors', 'danger');
      return false;
    }

    setSaving(true);
    try {
      const url = isEdit
        ? `${API_BASE}/api/products/${id}`
        : `${API_BASE}/api/products`;

      const method = isEdit ? 'PUT' : 'POST';

      let imageUrl = form.image_url || '';
      if (file) {
        try {
          setUploading(true);
          const formData = new FormData();
          formData.append('file', file);
          formData.append('folder', 'bakeflow/products');
          const up = await fetch(`${API_BASE}/api/uploads/cloudinary`, { method: 'POST', body: formData });
          const upData = await up.json();
          if (!up.ok) throw new Error(upData?.error || 'Upload failed');
          imageUrl = upData.url;
        } catch (err) {
          showNotification(`Image upload failed: ${err.message}`, 'danger');
          setUploading(false);
          setSaving(false);
          return false;
        }
        setUploading(false);
      }

      const priceValue = Number(form.price);
      const stockValue = Number.parseInt(String(form.stock), 10);
      const res = await fetch(url, {
        method,
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...form,
          image_url: imageUrl,
          tags: Array.from(
            new Set([...tagsList, ...parseTagsFromText(tagsInput)].map((t) => normalizeTag(t)).filter(Boolean))
          ).slice(0, 20),
          price: Number.isFinite(priceValue) ? priceValue : 0,
          stock: Number.isFinite(stockValue) ? stockValue : 0
        })
      });

      const data = await res.json();

      if (data.success) {
        if (typeof window !== 'undefined') {
          try {
            const cacheKey = 'bf_admin_products_cache';
            const cached = JSON.parse(localStorage.getItem(cacheKey) || '[]');
            if (Array.isArray(cached) && cached.length) {
              const next = cached.map((p) => {
                if (Number(p?.id) !== Number(id)) return p;
                return {
                  ...p,
                  ...data.product,
                  status: data.product?.status || form.status || p.status,
                  price: (data.product?.price === 0 || data.product?.price) ? data.product.price : p.price,
                  stock: (data.product?.stock === 0 || data.product?.stock) ? data.product.stock : p.stock,
                };
              });
              localStorage.setItem(cacheKey, JSON.stringify(next));
            }
          } catch {
          }
        }
        if (!silent) {
          showNotification(
            isEdit ? 'Product updated successfully' : 'Product created successfully',
            'success'
          );
        }
        if (redirect) {
          setTimeout(() => router.push('/admin/products'), 1500);
        }
        return true;
      }
      showNotification(data.error || 'Failed to save product', 'danger');
      return false;
    } catch (e) {
      showNotification('Error saving product', 'danger');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await saveProduct({ redirect: true });
  };

  const handleSaveAll = async () => {
    if (!isEdit) {
      await saveProduct({ redirect: true });
      return;
    }
    const productSaved = await saveProduct({ redirect: false, silent: true });
    if (!productSaved) return;
    let preorderSaved = true;
    if (isCake) {
      preorderSaved = await savePreorderSettings();
    }
    if (preorderSaved) {
      showNotification('Product and preorder settings saved', 'success');
      setTimeout(() => router.push('/admin/products'), 1500);
    }
  };

  const selectedTagSet = new Set(tagsList.map((t) => normalizeTag(t)));
  const availableTagSet = new Set(availableTags.map((t) => normalizeTag(t)));
  const normalizedTagsInput = normalizeTag(tagsInput);
  const tagSuggestions = normalizedTagsInput
    ? availableTags
      .filter((t) => {
        const v = normalizeTag(t);
        return v && !selectedTagSet.has(v) && v.includes(normalizedTagsInput);
      })
      .slice(0, 8)
    : availableTags
      .filter((t) => {
        const v = normalizeTag(t);
        return v && !selectedTagSet.has(v);
      })
      .slice(0, 12);
  const canCreateTag = normalizedTagsInput
    && !selectedTagSet.has(normalizedTagsInput)
    && !availableTagSet.has(normalizedTagsInput);

  return (
    <>
      <Head>
        <title>{`${isEdit ? 'Edit Product' : 'Add New Product'} - BakeFlow Admin`}</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet" />
      </Head>

      <div className="d-flex vh-100 overflow-hidden bg-light">
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
          />

          <div className="flex-grow-1 overflow-auto">
            <div className="container-fluid px-4 py-4">

              {/* Notification Toast */}
              {notification.show && (
                <div className={`alert alert-${notification.type} alert-dismissible fade show position-fixed top-0 end-0 m-4`} style={{ zIndex: 9999 }} role="alert">
                  <strong>{notification.message}</strong>
                  <button type="button" className="btn-close" onClick={() => setNotification({ show: false, message: '', type: '' })}></button>
                </div>
              )}

              {/* Header */}
              <div className="mb-4">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <Link href="/admin/products">
                    <button className="btn btn-sm btn-outline-secondary">
                      <i className="bi bi-arrow-left"></i>
                    </button>
                  </Link>
                  <h1 className="h3 fw-bold mb-0">{isEdit ? 'Edit Product' : 'Add New Product'}</h1>
                </div>
                <p className="text-muted mb-0">Fill in the product details below</p>
              </div>

              {loading ? (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                </div>
              ) : (
                <form id="product-form" onSubmit={handleSubmit}>
                  <div className="row g-4">
                    <div className="col-xl-7">
                      <div className="card shadow-sm border-0 mb-4">
                        <div className="card-body p-4">
                          <div className="d-flex align-items-center justify-content-between mb-4">
                            <h5 className="mb-0 fw-bold">Product Details</h5>
                          </div>

                          <div className="mb-4">
                            <label className="form-label fw-semibold">Product Name *</label>
                            <input
                              type="text"
                              className={`form-control ${errors.name ? 'is-invalid' : ''}`}
                              value={form.name}
                              onChange={(e) => setForm({ ...form, name: e.target.value })}
                              placeholder="e.g., Chocolate Fudge Cake"
                            />
                            {errors.name && <div className="invalid-feedback">{errors.name}</div>}
                          </div>

                          <div className="mb-4">
                            <label className="form-label fw-semibold">Price (Ks) *</label>
                            <input
                              type="number"
                              step="0.01"
                              className={`form-control ${errors.price ? 'is-invalid' : ''}`}
                              value={form.price}
                              onChange={(e) => setForm({ ...form, price: e.target.value })}
                              placeholder="0.00"
                            />
                            {errors.price && <div className="invalid-feedback">{errors.price}</div>}
                          </div>

                          <div className="mb-4">
                            <label className="form-label fw-semibold">Stock Quantity *</label>
                            <input
                              type="number"
                              className={`form-control ${errors.stock ? 'is-invalid' : ''}`}
                              value={form.stock}
                              onChange={(e) => setForm({ ...form, stock: e.target.value })}
                              placeholder="0"
                            />
                            {errors.stock && <div className="invalid-feedback">{errors.stock}</div>}
                          </div>

                          <div className="mb-4">
                            <label className="form-label fw-semibold">Image Upload</label>
                            <input
                              type="file"
                              accept="image/*"
                              className="form-control"
                              onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                setFile(f);
                                if (f) setPreviewUrl(URL.createObjectURL(f));
                                else setPreviewUrl(form.image_url || '');
                              }}
                            />
                            <div className="mt-3 border rounded-4 bg-white p-3 d-flex align-items-center justify-content-center" style={{ minHeight: 240 }}>
                              {previewUrl ? (
                                <Image
                                  src={previewUrl}
                                  alt="Preview"
                                  width={260}
                                  height={260}
                                  style={{ maxWidth: 260, maxHeight: 260, borderRadius: 12, height: 'auto' }}
                                  unoptimized
                                />
                              ) : (
                                <div className="text-muted small">No image selected</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="card shadow-sm border-0">
                        <div className="card-body p-4">
                          <h6 className="fw-semibold mb-3">Additional Details</h6>

                          <div className="mb-4">
                            <label className="form-label fw-semibold">Description</label>
                            <textarea
                              className="form-control"
                              rows="4"
                              value={form.description}
                              onChange={(e) => setForm({ ...form, description: e.target.value })}
                              placeholder="Describe your product..."
                            ></textarea>
                          </div>

                          <div className="mb-4">
                            <label className="form-label fw-semibold">Category *</label>
                            <select
                              className={`form-select ${errors.category ? 'is-invalid' : ''}`}
                              value={form.category}
                              onChange={(e) => setForm({ ...form, category: e.target.value })}
                            >
                              <option value="Cakes">Cakes</option>
                              <option value="Cupcakes">Cupcakes</option>
                              <option value="Muffins">Muffins</option>
                              <option value="Tarts">Tarts</option>
                              <option value="Cookies">Cookies</option>
                              <option value="Pastries">Pastries</option>
                              <option value="Breads">Breads</option>
                            </select>
                            {errors.category && <div className="invalid-feedback">{errors.category}</div>}
                          </div>

                          <div className="mb-4">
                            <label className="form-label fw-semibold">Tags</label>
                            {tagsList.length > 0 && (
                              <div className="d-flex flex-wrap gap-2 mb-2">
                                {tagsList.map((t) => (
                                  <span key={t} className="badge text-bg-secondary d-inline-flex align-items-center gap-2 px-3 py-2">
                                    <span>{t}</span>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-link p-0 text-white text-decoration-none"
                                      aria-label={`Remove tag ${t}`}
                                      onClick={() => removeTag(t)}
                                      style={{ lineHeight: 1 }}
                                    >
                                      <i className="bi bi-x-lg"></i>
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="position-relative">
                              <input
                                type="text"
                                className="form-control"
                                value={tagsInput}
                                onChange={(e) => setTagsInput(e.target.value)}
                                onFocus={() => setTagsOpen(true)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ',') {
                                    e.preventDefault();
                                    addTagsFromText(tagsInput);
                                    setTagsInput('');
                                  } else if (e.key === 'Backspace' && !tagsInput && tagsList.length > 0) {
                                    removeTag(tagsList[tagsList.length - 1]);
                                  }
                                }}
                                onBlur={() => {
                                  if (tagsInput.includes(',')) {
                                    addTagsFromText(tagsInput);
                                    setTagsInput('');
                                  }
                                  setTimeout(() => setTagsOpen(false), 120);
                                }}
                                placeholder="Type a tag and press Enter (or use commas)"
                                autoComplete="off"
                              />
                              {tagsOpen && (canCreateTag || tagSuggestions.length > 0) && (
                                <div className="position-absolute start-0 end-0 mt-1 bg-white border rounded shadow-sm" style={{ zIndex: 1000 }}>
                                  <div className="list-group list-group-flush" style={{ maxHeight: 240, overflowY: 'auto' }}>
                                    {canCreateTag && (
                                      <button
                                        type="button"
                                        className="list-group-item list-group-item-action"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          addTagsFromText(normalizedTagsInput);
                                          setTagsInput('');
                                        }}
                                      >
                                        Add &quot;{normalizedTagsInput}&quot;
                                      </button>
                                    )}
                                    {tagSuggestions.map((t) => (
                                      <button
                                        key={t}
                                        type="button"
                                        className="list-group-item list-group-item-action"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          addTagsFromText(t);
                                          setTagsInput('');
                                        }}
                                      >
                                        {t}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                        </div>
                      </div>
                    </div>

                    <div className="col-xl-5">
                      {isEdit && isCake && (
                        <div className="card shadow-sm border-0 bg-light">
                          <div className="card-body p-4">
                            <div className="d-flex align-items-center justify-content-between mb-2">
                              <h5 className="mb-0 fw-bold">Preorder Customization (Optional)</h5>
                              <div className="form-check form-switch m-0">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={!!preorderSettings.enabled}
                                  onChange={(e) => setPreorderSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
                                  disabled={preorderLoading || preorderSaving}
                                />
                              </div>
                            </div>
                            <div className="text-muted small mb-4">Configure customization options and pricing for this product.</div>

                            {preorderSettings.enabled && (
                              <div className="d-flex flex-column gap-3">
                                <div className="card border-0 shadow-sm">
                                  <div className="card-body">
                                    <div className="fw-semibold mb-2">Preorder Period</div>
                                    <div className="row g-2">
                                      <div className="col-6">
                                        <label className="form-label small fw-semibold">Start date</label>
                                        <input
                                          type="date"
                                          className="form-control"
                                          value={preorderSettings.start_date}
                                          onChange={(e) => setPreorderSettings((prev) => ({ ...prev, start_date: e.target.value }))}
                                          disabled={preorderLoading || preorderSaving}
                                        />
                                      </div>
                                      <div className="col-6">
                                        <label className="form-label small fw-semibold">End date</label>
                                        <input
                                          type="date"
                                          className={`form-control ${preorderErrors.end_date ? 'is-invalid' : ''}`}
                                          value={preorderSettings.end_date}
                                          onChange={(e) => setPreorderSettings((prev) => ({ ...prev, end_date: e.target.value }))}
                                          disabled={preorderLoading || preorderSaving}
                                        />
                                        {preorderErrors.end_date && <div className="invalid-feedback">{preorderErrors.end_date}</div>}
                                      </div>
                                    </div>
                                    <div className="text-muted small mt-2">Customers can only place preorders within this date range.</div>
                                  </div>
                                </div>

                                <div className="card border-0 shadow-sm">
                                  <div className="card-body">
                                    <div className="fw-semibold mb-2">Cake Sizes (Extra Price)</div>
                                    <div className="table-responsive">
                                      <table className="table table-sm align-middle">
                                        <thead className="table-light">
                                          <tr>
                                            <th>Size</th>
                                            <th>Extra Price</th>
                                            <th className="text-end">Actions</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {preorderSettings.sizes.map((item) => (
                                            <tr key={`size-row-${item}`}>
                                              <td>{item}</td>
                                              <td>{Number(preorderSettings.size_prices?.[item] ?? 0).toFixed(2)}</td>
                                              <td className="text-end">
                                                <button
                                                  type="button"
                                                  className="btn btn-sm btn-outline-danger"
                                                  onClick={() => removePreorderOption('sizes', item)}
                                                  disabled={preorderLoading || preorderSaving}
                                                >
                                                  <i className="bi bi-trash"></i>
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                          {!preorderSettings.sizes.length && (
                                            <tr>
                                              <td colSpan={3} className="text-muted small">No sizes added</td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                    <div className="row g-2 align-items-end">
                                      <div className="col-12 col-md-5">
                                        <label className="form-label small fw-semibold">Size</label>
                                        <input
                                          type="text"
                                          className="form-control"
                                          value={preorderInputs.size}
                                          onChange={(e) => setPreorderInputs((prev) => ({ ...prev, size: e.target.value }))}
                                          placeholder='e.g., 12"'
                                          disabled={preorderLoading || preorderSaving}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              addPreorderOption('sizes', 'size', 'sizePrice');
                                            }
                                          }}
                                        />
                                      </div>
                                      <div className="col-12 col-md-4">
                                        <label className="form-label small fw-semibold">Extra Price</label>
                                        <input
                                          type="number"
                                          className="form-control"
                                          value={preorderInputs.sizePrice}
                                          onChange={(e) => setPreorderInputs((prev) => ({ ...prev, sizePrice: e.target.value }))}
                                          placeholder="e.g., 30"
                                          min="0"
                                          step="0.01"
                                          disabled={preorderLoading || preorderSaving}
                                        />
                                      </div>
                                      <div className="col-12 col-md-3 d-grid">
                                        <button
                                          type="button"
                                          className="btn btn-outline-secondary"
                                          onClick={() => addPreorderOption('sizes', 'size', 'sizePrice')}
                                          disabled={preorderLoading || preorderSaving}
                                        >
                                          Add Size
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <div className="card border-0 shadow-sm">
                                  <div className="card-body">
                                    <div className="fw-semibold mb-2">Cake Layers (Extra Price)</div>
                                    <div className="table-responsive">
                                      <table className="table table-sm align-middle">
                                        <thead className="table-light">
                                          <tr>
                                            <th>Layers</th>
                                            <th>Extra Price</th>
                                            <th className="text-end">Actions</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {preorderSettings.layers.map((item) => (
                                            <tr key={`layer-row-${item}`}>
                                              <td>{item}</td>
                                              <td>{Number(preorderSettings.layer_prices?.[item] ?? 0).toFixed(2)}</td>
                                              <td className="text-end">
                                                <button
                                                  type="button"
                                                  className="btn btn-sm btn-outline-danger"
                                                  onClick={() => removePreorderOption('layers', item)}
                                                  disabled={preorderLoading || preorderSaving}
                                                >
                                                  <i className="bi bi-trash"></i>
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                          {!preorderSettings.layers.length && (
                                            <tr>
                                              <td colSpan={3} className="text-muted small">No layers added</td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                    <div className="row g-2 align-items-end">
                                      <div className="col-12 col-md-5">
                                        <label className="form-label small fw-semibold">Layers</label>
                                        <input
                                          type="text"
                                          className="form-control"
                                          value={preorderInputs.layer}
                                          onChange={(e) => setPreorderInputs((prev) => ({ ...prev, layer: e.target.value }))}
                                          placeholder="e.g., 4 layers"
                                          disabled={preorderLoading || preorderSaving}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              addPreorderOption('layers', 'layer', 'layerPrice');
                                            }
                                          }}
                                        />
                                      </div>
                                      <div className="col-12 col-md-4">
                                        <label className="form-label small fw-semibold">Extra Price</label>
                                        <input
                                          type="number"
                                          className="form-control"
                                          value={preorderInputs.layerPrice}
                                          onChange={(e) => setPreorderInputs((prev) => ({ ...prev, layerPrice: e.target.value }))}
                                          placeholder="e.g., 15"
                                          min="0"
                                          step="0.01"
                                          disabled={preorderLoading || preorderSaving}
                                        />
                                      </div>
                                      <div className="col-12 col-md-3 d-grid">
                                        <button
                                          type="button"
                                          className="btn btn-outline-secondary"
                                          onClick={() => addPreorderOption('layers', 'layer', 'layerPrice')}
                                          disabled={preorderLoading || preorderSaving}
                                        >
                                          Add Layer
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <div className="card border-0 shadow-sm">
                                  <div className="card-body">
                                    <div className="fw-semibold mb-2">Cream / Frosting (Extra Price)</div>
                                    <div className="table-responsive">
                                      <table className="table table-sm align-middle">
                                        <thead className="table-light">
                                          <tr>
                                            <th>Cream Type</th>
                                            <th>Extra Price</th>
                                            <th className="text-end">Actions</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {preorderSettings.creams.map((item) => (
                                            <tr key={`cream-row-${item}`}>
                                              <td>{item}</td>
                                              <td>{Number(preorderSettings.cream_prices?.[item] ?? 0).toFixed(2)}</td>
                                              <td className="text-end">
                                                <button
                                                  type="button"
                                                  className="btn btn-sm btn-outline-danger"
                                                  onClick={() => removePreorderOption('creams', item)}
                                                  disabled={preorderLoading || preorderSaving}
                                                >
                                                  <i className="bi bi-trash"></i>
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                          {!preorderSettings.creams.length && (
                                            <tr>
                                              <td colSpan={3} className="text-muted small">No cream types added</td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                    <div className="row g-2 align-items-end">
                                      <div className="col-12 col-md-5">
                                        <label className="form-label small fw-semibold">Cream name</label>
                                        <input
                                          type="text"
                                          className="form-control"
                                          value={preorderInputs.cream}
                                          onChange={(e) => setPreorderInputs((prev) => ({ ...prev, cream: e.target.value }))}
                                          placeholder="e.g., Fresh cream"
                                          disabled={preorderLoading || preorderSaving}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              addPreorderOption('creams', 'cream', 'creamPrice');
                                            }
                                          }}
                                        />
                                      </div>
                                      <div className="col-12 col-md-4">
                                        <label className="form-label small fw-semibold">Extra Price</label>
                                        <input
                                          type="number"
                                          className="form-control"
                                          value={preorderInputs.creamPrice}
                                          onChange={(e) => setPreorderInputs((prev) => ({ ...prev, creamPrice: e.target.value }))}
                                          placeholder="e.g., 5"
                                          min="0"
                                          step="0.01"
                                          disabled={preorderLoading || preorderSaving}
                                        />
                                      </div>
                                      <div className="col-12 col-md-3 d-grid">
                                        <button
                                          type="button"
                                          className="btn btn-outline-secondary"
                                          onClick={() => addPreorderOption('creams', 'cream', 'creamPrice')}
                                          disabled={preorderLoading || preorderSaving}
                                        >
                                          Add Cream
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="d-flex flex-column flex-md-row justify-content-end gap-2 mt-4">
                    <Link href="/admin/products">
                      <button type="button" className="btn btn-outline-secondary">
                        Cancel
                      </button>
                    </Link>
                    <button
                      type="button"
                      className="btn btn-primary btn-lg px-5"
                      onClick={handleSaveAll}
                      disabled={saving || preorderSaving || uploading}
                    >
                      {saving || preorderSaving || uploading ? 'Saving...' : 'Save Product & Preorder Settings'}
                    </button>
                  </div>

                  {/* Stock Alert */}
                  {form.stock && parseInt(form.stock) < 10 && (
                    <div className="alert alert-warning mt-4">
                      <i className="bi bi-exclamation-triangle me-2"></i>
                      <strong>Low Stock!</strong> Consider restocking soon.
                    </div>
                  )}

                  {form.stock && parseInt(form.stock) === 0 && (
                    <div className="alert alert-danger mt-3">
                      <i className="bi bi-x-circle me-2"></i>
                      <strong>Out of Stock!</strong> This product is unavailable.
                    </div>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
