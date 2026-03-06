import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Sidebar from '../../components/Sidebar';
import TopNavbar from '../../components/TopNavbar';
import SummaryCards from '../../components/SummaryCards';
import Link from 'next/link';
import Image from 'next/image';
import SalesChart from '../../components/SalesChart';
import NotificationPreviewCard from '../../components/NotificationPreviewCard';
import { useTranslation } from '../../utils/i18n';
import { formatCurrency } from '../../utils/formatCurrency';
import { statusColor } from '../../utils/statusColor';
import { useNotifications } from '../../contexts/NotificationContext';

export default function AdminDashboard() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://bakeflow.onrender.com';
  const router = useRouter();

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

  const { t } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewCard, setPreviewCard] = useState(null);
  const { notifications, unreadCount, hasUnread, addNotifications, markAsRead, markAllRead, clearAll } = useNotifications();
  const seenOrdersRef = useRef(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let tok = '';
    try {
      tok = localStorage.getItem('bakeflow_admin_token') || '';
    } catch {
      tok = '';
    }
    if (!tok) {
      const target = router.asPath || '/admin';
      router.replace(`/admin/login?redirect=${encodeURIComponent(target)}`);
    }
  }, [router]);

  useEffect(() => {
    const stored = localStorage.getItem('bakeflow_seen_orders');
    if (stored) {
      try {
        const ids = JSON.parse(stored);
        seenOrdersRef.current = new Set(ids);
        console.log('📥 Loaded', ids.length, 'seen order IDs from localStorage');
      } catch (e) {
        console.error('Failed to load seen orders:', e);
      }
    }
  }, []);

  // Save seen orders to localStorage whenever it changes
  const updateSeenOrders = useCallback((orderIds) => {
    orderIds.forEach(id => seenOrdersRef.current.add(id));
    const ids = Array.from(seenOrdersRef.current);
    localStorage.setItem('bakeflow_seen_orders', JSON.stringify(ids));
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${API_BASE}/api/admin/orders`, {
        headers: buildAuthHeaders(),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.details || data.error);
        setOrders([]);
      } else {
        const incoming = data.orders || [];
        setOrders(incoming);
        
        // Detect new orders (after initial load) and push to notifications
        if (initializedRef.current) {
          const newOnes = [];
          for (const o of incoming) {
            if (!seenOrdersRef.current.has(o.id) && (o.status === 'pending')) {
              const items = Array.isArray(o.items) ? o.items : [];
              const first = items[0] || null;
              const cake = first ? `${first.product}${items.length > 1 ? ` + ${items.length - 1} more` : ''}` : `${o.total_items || 0} item(s)`;
              newOnes.push({ 
                id: o.id, 
                customer: o.customer_name || 'Customer', 
                cake, 
                time: new Date(o.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
                timestamp: Date.now(),
                isRead: false
              });
            }
          }
          if (newOnes.length) {
            // Only add notifications if there are actually new orders
            console.log('📢 Detected', newOnes.length, 'new orders');
            addNotifications(newOnes);
            // Show preview card with all new orders
            setPreviewCard({ orders: newOnes, count: newOnes.length });
            setTimeout(() => setPreviewCard(null), 6000);
          }
        }
        // Update seen set and save to localStorage
        const allOrderIds = incoming.map(o => o.id);
        updateSeenOrders(allOrderIds);
        
        if (!initializedRef.current) {
          initializedRef.current = true;
        }
      }
    } catch (e) {
      console.error(e);
      setError('Cannot connect to backend. Make sure Go server is running.');
    } finally {
      setLoading(false);
    }
  }, [API_BASE, addNotifications, updateSeenOrders, buildAuthHeaders]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const stats = useMemo(() => {
    const pending = orders.filter(o => o.status === 'pending').length;
    const completed = orders.filter(o => o.status === 'delivered').length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    return {
      totalOrders: orders.length,
      totalRevenue,
      pendingOrders: pending,
      completedOrders: completed,
    }; 
  }, [orders]);

  const soldCounts = useMemo(() => {
    const map = new Map();
    orders.forEach(o => {
      if (String(o.status).toLowerCase() !== 'delivered') return;
      (o.items || []).forEach(it => {
        const key = it.product_id || `name:${String(it.product || '').trim().toLowerCase()}`;
        const qty = Number(it.quantity || 0) || 0;
        map.set(key, (map.get(key) || 0) + qty);
      });
    });
    return map;
  }, [orders]);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const fetchProducts = useCallback(async () => {
    try {
      let hadCache = false;
      try {
        const cached = JSON.parse(localStorage.getItem('bf_admin_products_cache') || '[]');
        if (Array.isArray(cached) && cached.length) {
          setProducts(cached);
          setProductsLoading(false);
          hadCache = true;
        }
      } catch {}
      if (!hadCache) setProductsLoading(true);
      const res = await fetch(`${API_BASE}/api/products`);
      const data = await res.json();
      setProducts(Array.isArray(data.products) ? data.products : []);
      try {
        localStorage.setItem('bf_admin_products_cache', JSON.stringify(Array.isArray(data.products) ? data.products : []));
      } catch {}
    } catch {
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, [API_BASE]);
  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const [salesItems, setSalesItems] = useState([]);
  useEffect(() => {
    const fetchSales = async () => {
      try {
        let hadCache = false;
        try {
          const cached = JSON.parse(localStorage.getItem('bf_admin_product_sales_cache') || '[]');
          if (Array.isArray(cached) && cached.length) {
            setSalesItems(cached);
            hadCache = true;
          }
        } catch {}
        const res = await fetch(`${API_BASE}/api/admin/product-sales?limit=16`, { headers: buildAuthHeaders() });
        const data = await res.json();
        if (res.ok && Array.isArray(data.items)) {
          setSalesItems(data.items);
          try {
            localStorage.setItem('bf_admin_product_sales_cache', JSON.stringify(data.items));
          } catch {}
        } else {
          if (!hadCache) setSalesItems([]);
        }
      } catch {
        try {
          const cached = JSON.parse(localStorage.getItem('bf_admin_product_sales_cache') || '[]');
          setSalesItems(Array.isArray(cached) ? cached : []);
        } catch {
          setSalesItems([]);
        }
      }
    };
    fetchSales();
  }, [API_BASE, buildAuthHeaders]);
  const dailySales = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      const d = new Date(o.created_at).toISOString().slice(0,10);
      map[d] = (map[d] || 0) + (o.total_amount || 0);
    });
    return Object.entries(map)
      .sort((a,b) => a[0].localeCompare(b[0]))
      .slice(-7)
      .map(([date,total]) => ({ date, total }));
  }, [orders]);
  const recentOrders = useMemo(() => {
    return [...orders]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);
  }, [orders]);
  const topProducts = useMemo(() => {
    const ranked = products.map(p => {
      const byId = salesItems.find(it => it.product_id === p.id)?.sold;
      const byName = salesItems.find(it => String(it.name || '').trim().toLowerCase() === String(p.name || '').trim().toLowerCase())?.sold;
      const byDelivered = soldCounts.get(p.id) ?? soldCounts.get(`name:${String(p.name || '').trim().toLowerCase()}`);
      const totalSold = (byId ?? byName ?? byDelivered ?? 0);
      return { product: p, totalSold };
    });
    return ranked.sort((a, b) => b.totalSold - a.totalSold).slice(0, 4);
  }, [products, salesItems, soldCounts]);

  return (
    <>
      <Head>
        <title>BakeFlow Admin - Dashboard</title>
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
            notifications={notifications}
            unreadCount={unreadCount}
            hasUnread={hasUnread}
            onBellClick={() => {
              const el = document.getElementById('recent-orders');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            onMarkAllRead={markAllRead}
            onClearAll={clearAll}
            onNotificationClick={(id) => {
              markAsRead(id);
              const el = document.getElementById('recent-orders');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            pageTitle={t('dashboard')}
            pageSubtitle={t('summaryAndRecent')}
          />
          <div className="flex-grow-1 overflow-auto">
            {/* Preview card notification */}
            <NotificationPreviewCard
              key={previewCard?.orders?.[0]?.id || previewCard?.id || 'preview-none'}
              notification={previewCard}
              onClose={() => setPreviewCard(null)}
              onView={(id) => {
                markAsRead(id);
                const el = document.getElementById('recent-orders');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
            <div className="container-fluid px-4 py-4">
              <SummaryCards stats={stats} loading={loading} />
              <div className="row g-4 mb-4">
                <div className="col-12 col-lg-8">
                  <div className="h-100">
                    <SalesChart data={dailySales} loading={loading} />
                    {!loading && (
                      <div className="mt-2 text-muted small">
                        Revenue (last 7 days total): {formatCurrency(dailySales.reduce((s,d)=>s+d.total,0))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="col-12 col-lg-4">
                  <div id="recent-orders" className="card border-0 shadow-sm h-100">
                    <div className="card-body d-flex flex-column">
                      <div className="d-flex align-items-center justify-content-between mb-3">
                        <h5 className="card-title mb-0"><i className="bi bi-clock-history me-2"></i>{t('recentOrders')}</h5>
                      </div>
                      {error && <div className="alert alert-danger mb-3">{error}</div>}
                      {loading && (
                        <div className="table-loading">
                          {[...Array(5)].map((_,i) => <div key={i} className="skeleton skeleton-row mb-2" />)}
                        </div>
                      )}
                      {!loading && (
                        <div className="table-responsive">
                          <table className="table table-sm align-middle mb-0">
                            <thead className="table-light">
                              <tr>
                                <th>{t('orderID')}</th>
                                <th>{t('customer')}</th>
                                <th>{t('status')}</th>
                                <th className="text-end">{t('total')}</th>
                                <th className="text-end">{t('action')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {recentOrders.map(order => (
                                <tr key={order.id}>
                                  <td className="fw-semibold">#{order.id}</td>
                                  <td>{order.customer_name}</td>
                                  <td><span className={`badge bg-${statusColor(order.status)} px-2 py-1`}>{order.status}</span></td>
                                  <td className="text-end">{formatCurrency(order.total_amount)}</td>
                                  <td className="text-end">
                                    <Link href="/admin/orders" className="btn btn-sm btn-outline-secondary">
                                      View Details
                                    </Link>
                                  </td>
                                </tr>
                              ))}
                              {recentOrders.length === 0 && !error && (
                                <tr><td colSpan={5} className="text-center text-muted py-4">{t('noOrdersYet')}</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div className="mt-auto pt-3 d-flex justify-content-end">
                        <Link href="/admin/orders" className="btn btn-sm btn-outline-primary">
                          View All Orders
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="card border-0 shadow-sm">
                <div className="card-body">
                  <div className="d-flex align-items-center justify-content-between mb-3">
                    <h5 className="card-title mb-0">Top Selling Products</h5>
                  </div>
                  {productsLoading && (
                    <div className="row g-3">
                      {[1,2,3,4].map(i => <div key={i} className="col-6 col-md-3"><div className="card h-100 skeleton" /></div>)}
                    </div>
                  )}
                  {!productsLoading && topProducts.length === 0 && <div className="text-muted">{t('noProductsYet')}</div>}
                  {!productsLoading && topProducts.length > 0 && (
                    <div className="row g-3">
                      {topProducts.map(({ product, totalSold }) => {
                        const img = product.image_url || 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=200&h=200&fit=crop';
                        return (
                          <div key={product.id} className="col-6 col-md-3">
                            <div className="card h-100 border-0 shadow-sm">
                              <div className="d-flex gap-3 p-3 align-items-center">
                                <div className="rounded overflow-hidden flex-shrink-0" style={{ width: 64, height: 64 }}>
                                  <Image
                                    src={img}
                                    alt={product.name}
                                    width={64}
                                    height={64}
                                    style={{ objectFit: 'cover' }}
                                  />
                                </div>
                                <div className="flex-grow-1">
                                  <div className="fw-semibold text-truncate">{product.name}</div>
                                  <div className="d-flex align-items-center gap-2 mt-1">
                                    <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle">{product.category}</span>
                                    <span className="badge bg-accent text-dark border">{totalSold} sold</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-3 d-flex justify-content-end">
                    <Link href="/admin/products" className="btn btn-sm btn-outline-primary">
                      View All Products
                    </Link>
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
