import { useState, useEffect, useMemo, useRef } from 'react';
import Head from 'next/head';
import Sidebar from '../../components/Sidebar';
import TopNavbar from '../../components/TopNavbar';
import SummaryCards from '../../components/SummaryCards';
import RecentOrdersTable from '../../components/RecentOrdersTable';
import PopularItems from '../../components/PopularItems';
import SalesChart from '../../components/SalesChart';
import NotificationPreviewCard from '../../components/NotificationPreviewCard';
import { useTranslation } from '../../utils/i18n';
import { formatCurrency } from '../../utils/formatCurrency';
import { useNotifications } from '../../contexts/NotificationContext';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewCard, setPreviewCard] = useState(null);
  const { notifications, unreadCount, hasUnread, addNotifications, markAsRead, markAllRead, clearAll } = useNotifications();
  const seenOrdersRef = useRef(new Set());
  const initializedRef = useRef(false);

  // Load seen orders from localStorage on mount
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
  const updateSeenOrders = (orderIds) => {
    orderIds.forEach(id => seenOrdersRef.current.add(id));
    const ids = Array.from(seenOrdersRef.current);
    localStorage.setItem('bakeflow_seen_orders', JSON.stringify(ids));
  };

  const fetchOrders = async () => {
    try {
      setError(null);
      const res = await fetch('http://localhost:8080/api/admin/orders');
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
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, []);

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

  const popularItems = useMemo(() => {
    const counts = {};
    orders.forEach(o => (o.items || []).forEach(it => {
      counts[it.product] = (counts[it.product] || 0) + it.quantity;
    }));
    return Object.entries(counts)
      .sort((a,b) => b[1]-a[1])
      .slice(0,5)
      .map(([name,count]) => ({ name, count }));
  }, [orders]);

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
              <div id="recent-orders">
                <RecentOrdersTable orders={orders} loading={loading} error={error} />
              </div>
              <PopularItems items={popularItems} loading={loading} />
              <SalesChart data={dailySales} loading={loading} />
              {!loading && (
                <div className="mt-2 text-muted small">Revenue (last 7 days total): {formatCurrency(dailySales.reduce((s,d)=>s+d.total,0))}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
