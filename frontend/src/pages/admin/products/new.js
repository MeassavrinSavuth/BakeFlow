import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import Sidebar from '../../../components/Sidebar';
import TopNavbar from '../../../components/TopNavbar';
import { useNotifications } from '../../../contexts/NotificationContext';

export default function NewProductPage() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://bakeflow.onrender.com';
  const { notifications, unreadCount, hasUnread, markAsRead, markAllRead, clearAll } = useNotifications();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('cakes');
  const [tagsInput, setTagsInput] = useState('');
  const [tagsList, setTagsList] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [status, setStatus] = useState('active');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const getAdminToken = () => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem('bakeflow_admin_token') || '';
    } catch {
      return '';
    }
  };

  const buildAuthHeaders = (extra = {}) => {
    const tok = getAdminToken();
    const headers = { ...extra };
    if (tok) headers.Authorization = `Bearer ${tok}`;
    return headers;
  };

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/products/tags`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          const list = Array.isArray(data.tags) ? data.tags : [];
          const set = new Set(list.map((t) => normalizeTag(t)).filter(Boolean));
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

  function onFileChange(e) {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (f) setPreviewUrl(URL.createObjectURL(f));
    else setPreviewUrl('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage('');

    if (!name || !category || !price || !stock) {
      setMessage('Please fill all required fields.');
      return;
    }

    let imageUrl = '';
    try {
      if (file) {
        setUploading(true);
        const form = new FormData();
        form.append('file', file);
        form.append('folder', 'bakeflow/products');
        const up = await fetch(`${API_BASE}/api/uploads/cloudinary`, { method: 'POST', body: form });
        const data = await up.json();
        if (!up.ok) throw new Error(data?.error || 'Upload failed');
        imageUrl = data.url;
      }
    } catch (err) {
      setMessage(`Upload error: ${err.message}`);
      setUploading(false);
      return;
    }
    setUploading(false);

    try {
      setCreating(true);
      const tagsArray = Array.from(
        new Set([...tagsList, ...parseTagsFromText(tagsInput)].map((t) => normalizeTag(t)).filter(Boolean))
      ).slice(0, 20);
      const res = await fetch(`${API_BASE}/api/products`, {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name,
          description,
          category,
          tags: tagsArray,
          price: parseFloat(price),
          stock: parseInt(stock, 10),
          image_url: imageUrl,
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Create product failed');
      setMessage('✅ Product created successfully!');
      setName('');
      setDescription('');
      setCategory('cakes');
      setTagsInput('');
      setTagsList([]);
      setPrice('');
      setStock('');
      setStatus('active');
      setFile(null);
      setPreviewUrl('');
    } catch (err) {
      setMessage(`Create error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  }

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
        <title>Add Product - BakeFlow Admin</title>
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
            pageTitle={'Order Management'}
            pageSubtitle={'Create a new product'}
          />

          <div className="flex-grow-1 overflow-auto">
            <div className="container-xl py-4">
              <div className="d-flex align-items-center gap-3 mb-3">
                <Link href="/admin/products" className="btn btn-light border rounded-circle" style={{ width: 36, height: 36 }}>
                  <i className="bi bi-arrow-left"></i>
                </Link>
                <h1 className="h4 mb-0 fw-semibold">Add Product</h1>
              </div>

              <div className="row g-4">
                {/* Left: Product form */}
                <div className="col-12 col-lg-8">
                  <div className="card shadow-sm border-light rounded-3">
                    <div className="card-body p-4">
                      <form onSubmit={handleSubmit}>
                        <div className="mb-3">
                          <label className="form-label fw-semibold">Product Name *</label>
                          <input type="text" className="form-control" value={name} onChange={(e) => setName(e.target.value)} required />
                        </div>

                        <div className="mb-3">
                          <label className="form-label fw-semibold">Description</label>
                          <textarea className="form-control" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your product..." />
                        </div>

                        <div className="row g-3">
                          <div className="col-12 col-md-6">
                            <label className="form-label fw-semibold">Category *</label>
                            <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)} required>
                              <option value="cakes">Cakes</option>
                              <option value="cupcakes">Cupcakes</option>
                              <option value="muffins">Muffins</option>
                              <option value="tarts">Tarts</option>
                              <option value="cookies">Cookies</option>
                              <option value="bread">Bread</option>
                              <option value="coffee">Coffee</option>
                              <option value="pastries">Pastries</option>
                            </select>
                          </div>
                          <div className="col-6 col-md-3">
                            <label className="form-label fw-semibold">Price (Ks) *</label>
                            <input type="number" className="form-control" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
                          </div>
                          <div className="col-6 col-md-3">
                            <label className="form-label fw-semibold">Stock Quantity *</label>
                            <input type="number" className="form-control" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} required />
                          </div>
                        </div>

                        <div className="mb-3 mt-3">
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

                        <div className="mb-3">
                          <label className="form-label fw-semibold">Image</label>
                          <input type="file" accept="image/*" className="form-control" onChange={onFileChange} />
                          {previewUrl && (
                            <div className="mt-3" style={{ maxWidth: 280 }}>
                              <Image src={previewUrl} alt="preview" width={280} height={280} className="img-fluid rounded" style={{ height: 'auto' }} unoptimized />
                            </div>
                          )}
                        </div>

                        <div className="d-flex gap-2">
                          <button type="submit" className="btn btn-primary" disabled={uploading || creating}>
                            {uploading ? 'Uploading…' : creating ? 'Saving…' : 'Create Product'}
                          </button>
                          <Link href="/admin/products" className="btn btn-light border">Cancel</Link>
                        </div>
                      </form>
                    </div>
                  </div>
                  {message && (
                    <div className="alert alert-info mt-3">{message}</div>
                  )}
                </div>

                {/* Right: Status */}
                <div className="col-12 col-lg-4">
                  <div className="card shadow-sm border-light rounded-3">
                    <div className="card-body p-4">
                      <div className="mb-3">
                        <label className="form-label fw-semibold">Status</label>
                        <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                          <option value="active">Active (Published)</option>
                          <option value="archived">Hidden</option>
                        </select>
                      </div>
                      <button className="btn btn-primary w-100" onClick={(e) => handleSubmit(e)} disabled={uploading || creating}>
                        {uploading ? 'Uploading…' : creating ? 'Saving…' : 'Create Product'}
                      </button>
                      <Link href="/admin/products" className="btn btn-light border w-100 mt-2">Cancel</Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
