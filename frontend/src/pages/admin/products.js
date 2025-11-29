import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Sidebar from '../../components/Sidebar';
import TopNavbar from '../../components/TopNavbar';
import { useNotifications } from '../../contexts/NotificationContext';
import { useTranslation } from '../../utils/i18n';
import { formatCurrency } from '../../utils/formatCurrency';

export default function ProductsPage() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filter, setFilter] = useState({ category: '', status: '', search: '' });
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });
  const { notifications, unreadCount, hasUnread, markAsRead, markAllRead, clearAll } = useNotifications();

  const [lastError, setLastError] = useState('');

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter.category) params.append('category', filter.category);
      if (filter.status) params.append('status', filter.status);
      if (filter.search) params.append('search', filter.search);
      const res = await fetch(`${API_BASE}/api/products?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }
      const data = await res.json();
      console.debug('Products API response:', data);
      
      if (data.products) {
        setProducts(data.products);
      } else {
        setProducts([]);
      }
      setLastError('');
    } catch (e) {
      console.error(e);
      setError('Failed to load products');
      setLastError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const { t } = useTranslation();

  useEffect(() => {
    fetchProducts();
  }, [filter]);

  const deleteProduct = async (id) => {
    if (!confirm('Are you sure you want to archive this product?')) return;

    try {
      const res = await fetch(`${API_BASE}/api/products/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }
      const data = await res.json();
      
      if (data.success) {
        showNotification('Product archived successfully', 'success');
        fetchProducts();
      } else {
        showNotification('Failed to archive product', 'danger');
      }
    } catch (e) {
      showNotification('Error archiving product', 'danger');
    }
  };

  const updateStatus = async (id, newStatus) => {
    try {
      const res = await fetch(`${API_BASE}/api/products/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }
      const data = await res.json();
      
      if (data.success) {
        showNotification(`Product ${newStatus === 'active' ? 'published' : 'updated'}`, 'success');
        fetchProducts();
      } else {
        showNotification('Failed to update status', 'danger');
      }
    } catch (e) {
      showNotification('Error updating status', 'danger');
    }
  };

  const showNotification = (message, type) => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: '', type: '' }), 5000);
  };

  const getStatusBadge = (status) => {
    const badges = {
      draft: 'bg-secondary',
      active: 'bg-success',
      inactive: 'bg-warning',
      archived: 'bg-danger'
    };
    return badges[status] || 'bg-secondary';
  };

  const getStockBadge = (product) => {
    if (product.out_of_stock) return <span className="badge bg-danger">Out of Stock</span>;
    if (product.low_stock) return <span className="badge bg-warning">Low Stock</span>;
    return <span className="badge bg-success">In Stock</span>;
  };

  return (
    <>
      <Head>
        <title>Products - BakeFlow Admin</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet" />
      </Head>

      <div className="d-flex vh-100 overflow-hidden" style={{background: '#f7f7f9'}}>
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
            <div className="container-fluid px-4 py-4">
              
              {/* Notification Toast */}
              {notification.show && (
                <div className={`alert alert-${notification.type} alert-dismissible fade show position-fixed top-0 end-0 m-4`} style={{zIndex: 9999}} role="alert">
                  <strong>{notification.message}</strong>
                  <button type="button" className="btn-close" onClick={() => setNotification({show: false, message: '', type: ''})}></button>
                </div>
              )}

              {/* KPI Summary Row */}
              <div className="row g-4 mb-4">
                <div className="col-lg-3 col-md-6">
                  <div className="card shadow-sm rounded-4 border-0 p-3">
                    <div className="d-flex align-items-center gap-3">
                      <div className="rounded-3 bg-light d-flex align-items-center justify-content-center" style={{width:40,height:40}}>
                        <i className="bi bi-box"></i>
                      </div>
                      <div>
                          <div className="h4 mb-0">{products.length}</div>
                          <div className="text-muted small">{t('totalProducts')}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-lg-3 col-md-6">
                  <div className="card shadow-sm rounded-4 border-0 p-3">
                    <div className="d-flex align-items-center gap-3">
                      <div className="rounded-3 bg-light d-flex align-items-center justify-content-center" style={{width:40,height:40}}>
                        <i className="bi bi-check-circle"></i>
                      </div>
                      <div>
                        <div className="h4 mb-0">{products.filter(p=>p.status==='active').length}</div>
                        <div className="text-muted small">{t('activeProducts')}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-lg-3 col-md-6">
                  <div className="card shadow-sm rounded-4 border-0 p-3">
                    <div className="d-flex align-items-center gap-3">
                      <div className="rounded-3 bg-light d-flex align-items-center justify-content-center" style={{width:40,height:40}}>
                        <i className="bi bi-exclamation-triangle"></i>
                      </div>
                      <div>
                        <div className="h4 mb-0">{products.filter(p=>p.low_stock||p.out_of_stock).length}</div>
                        <div className="text-muted small">{t('lowStockItems')}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-lg-3 col-md-6">
                  <div className="card shadow-sm rounded-4 border-0 p-3">
                    <div className="d-flex align-items-center gap-3">
                      <div className="rounded-3 bg-light d-flex align-items-center justify-content-center" style={{width:40,height:40}}>
                        <i className="bi bi-eye"></i>
                      </div>
                      <div>
                        <div className="h4 mb-0">{products.reduce((sum,p)=>sum+(p.views||0),0)}</div>
                        <div className="text-muted small">{t('totalViews')}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Main Products Card */}
              <div className="card shadow-sm rounded-4 border-0 mb-3">
                <div className="card-body">
                  {/* Smart Toolbar */}
                  <div className="bg-light p-3 rounded mb-3">
                    <div className="row g-3 align-items-center">
                      <div className="col-12 col-md-4">
                        <div className="input-group">
                          <span className="input-group-text bg-white"><i className="bi bi-search"></i></span>
                          <input
                            type="text"
                            className="form-control"
                            placeholder={t('searchProducts')}
                            value={filter.search}
                            onChange={(e) => setFilter({...filter, search: e.target.value})}
                          />
                        </div>
                      </div>
                      <div className="col-6 col-md-3">
                        <select 
                          className="form-select"
                          value={filter.category}
                          onChange={(e) => setFilter({...filter, category: e.target.value})}
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
                          className="form-select"
                          value={filter.status}
                          onChange={(e) => setFilter({...filter, status: e.target.value})}
                        >
                          <option value="">{t('allStatus')}</option>
                          <option value="draft">Draft</option>
                          <option value="active">{t('activeLabel')}</option>
                          <option value="inactive">Inactive</option>
                          <option value="archived">{t('hiddenLabel')}</option>
                        </select>
                      </div>
                      <div className="col-12 col-md-2 d-flex justify-content-md-end gap-2">
                        <Link href="/admin/products/new">
                          <button className="btn btn-primary"><i className="bi bi-plus-lg me-2"></i>{t('addProduct')}</button>
                        </Link>
                        <button className="btn btn-outline-secondary" onClick={() => setFilter({ category: '', status: '', search: '' })}>{t('clear')}</button>
                        <button className="btn btn-outline-secondary">{t('exportCSV')}</button>
                      </div>
                    </div>
                  </div>

                  {/* Modern Data Grid */}
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
                      <table className="table align-middle mb-0" style={{borderCollapse: 'separate'}}>
                        <thead className="table-light" style={{position: 'sticky', top: 0, zIndex: 1}}>
                          <tr>
                            <th>{t('productColumn')}</th>
                            <th>{t('priceColumn')}</th>
                            <th>{t('stockColumn')}</th>
                            <th>{t('performanceColumn')}</th>
                            <th>{t('statusColumn')}</th>
                            <th>{t('actionsColumn')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map((product) => (
                            <tr key={product.id} className="">
                              <td>
                                <div className="d-flex align-items-center gap-3">
                                  <div style={{width: 56, height: 56, borderRadius: 14, overflow: 'hidden', background: '#f0f0f0'}}>
                                  {product.image_url ? (
                                        <img src={product.image_url} alt={product.name} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
                                  ) : (
                                        <div className="d-flex align-items-center justify-content-center h-100">
                                          <i className="bi bi-image text-muted"></i>
                                        </div>
                                  )}
                                </div>
                                  <div>
                                    <div className="fw-semibold mb-1 d-flex align-items-center gap-2">
                                      {product.name}
                                        <span className="badge bg-secondary">{product.category}</span>
                                    </div>
                                    <div className="text-muted small d-none d-md-block" style={{maxWidth: 420}}>
                                      {product.description?.substring(0, 80)}{product.description && product.description.length > 80 ? '…' : ''}
                                    </div>
                                  </div>
                                </div>
                              </td>
                                    <td>{formatCurrency(product.price)}</td>
                              <td>
                                <div className="d-flex flex-column">
                                  <span className="fw-semibold">{product.stock}</span>
                                  <span className="mt-2">
                                    {product.out_of_stock ? (
                                      <span className="badge rounded-pill bg-danger d-inline-flex align-items-center gap-2"><span className="rounded-circle bg-white" style={{width:8,height:8,opacity:.7}}></span> {t('outOfStock')}</span>
                                    ) : product.low_stock ? (
                                      <span className="badge rounded-pill bg-warning d-inline-flex align-items-center gap-2"><span className="rounded-circle bg-white" style={{width:8,height:8,opacity:.7}}></span> {t('lowStock')}</span>
                                    ) : (
                                      <span className="badge rounded-pill bg-success d-inline-flex align-items-center gap-2"><span className="rounded-circle bg-white" style={{width:8,height:8,opacity:.7}}></span> {t('goodStock')}</span>
                                    )}
                                  </span>
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
                                <span className={`badge rounded-pill ${product.status === 'active' ? 'bg-success' : 'bg-secondary'}`}>
                                  {product.status === 'active' ? t('activeLabel') : t('hiddenLabel')}
                                </span>
                              </td>
                              <td>
                                <div className="btn-group btn-group-sm">
                                  <Link href={`/admin/products/${product.id}`}>
                                    <button className="btn btn-outline-secondary" title={t('editTitle')}>
                                      <i className="bi bi-pencil"></i>
                                    </button>
                                  </Link>
                                  {product.status === 'active' ? (
                                    <button 
                                      className="btn btn-outline-warning"
                                      onClick={() => updateStatus(product.id, 'inactive')}
                                      title={t('hideTitle')}
                                    >
                                      <i className="bi bi-eye-slash"></i>
                                    </button>
                                  ) : (
                                    <button 
                                      className="btn btn-outline-warning"
                                      onClick={() => updateStatus(product.id, 'active')}
                                      title={t('showTitle')}
                                    >
                                      <i className="bi bi-eye"></i>
                                    </button>
                                  )}
                                  <button 
                                    className="btn btn-outline-danger"
                                    onClick={() => deleteProduct(product.id)}
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
                  )}
                </div>
              </div>
              {/* Removed legacy duplicate table/card rendering to avoid double list */}

              
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
