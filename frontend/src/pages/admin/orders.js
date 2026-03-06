import { Fragment, useEffect, useState, useMemo, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import Sidebar from '../../components/Sidebar';
import TopNavbar from '../../components/TopNavbar';
import NotificationPreviewCard from '../../components/NotificationPreviewCard';
import { statusColor } from '../../utils/statusColor';
import { formatCurrency } from '../../utils/formatCurrency';
import { useNotifications } from '../../contexts/NotificationContext';
import { useTranslation } from '../../utils/i18n';

export default function OrdersPage() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://bakeflow.onrender.com';

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
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [updating, setUpdating] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [cancelModal, setCancelModal] = useState({ show: false, orderId: null });
  const [cashCollectModal, setCashCollectModal] = useState({ show: false, orderId: null });
  const [viewModal, setViewModal] = useState({ show: false, orderId: null });
  const [actionMenuId, setActionMenuId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });
  const [previewCard, setPreviewCard] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const [pageSize] = useState(50);
  const { notifications, unreadCount, hasUnread, markAsRead, markAllRead, clearAll, addNotifications } = useNotifications();
  const seenOrdersRef = useRef(new Set());
  const orderMetricsRef = useRef(new Map());
  const initializedRef = useRef(false);
  const { t } = useTranslation();

  // Load seen orders from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('bakeflow_seen_orders');
    if (stored) {
      try {
        const ids = JSON.parse(stored);
        seenOrdersRef.current = new Set(ids);
        console.log('📥 [Orders] Loaded', ids.length, 'seen order IDs from localStorage');
      } catch (e) {
        console.error('Failed to load seen orders:', e);
      }
    }
  }, [API_BASE]);

  // Save seen orders to localStorage whenever it changes
  const updateSeenOrders = useCallback((orderIds) => {
    orderIds.forEach(id => seenOrdersRef.current.add(id));
    const ids = Array.from(seenOrdersRef.current);
    localStorage.setItem('bakeflow_seen_orders', JSON.stringify(ids));
  }, []);

  const getOrderItems = useCallback((order) => {
    return Array.isArray(order?.items) ? order.items : [];
  }, []);

  const getOrderTotalItems = useCallback((order) => {
    const totalValue = Number(order?.total_items);
    if (Number.isFinite(totalValue) && totalValue > 0) return totalValue;
    const items = getOrderItems(order);
    if (!items.length) return 0;
    return items.reduce((sum, item) => sum + Number(item?.quantity ?? item?.qty ?? 0), 0);
  }, [getOrderItems]);

  const buildOrderNotification = useCallback((order, overrideText = '') => {
    const orderItems = getOrderItems(order);
    const first = orderItems[0] || null;
    const cake = overrideText || (first
      ? `${first.product}${orderItems.length > 1 ? ` + ${orderItems.length - 1} more` : ''}`
      : (order.cake_description || 'New Order'));
    return {
      id: order.id,
      customer: order.customer_name || 'Customer',
      cake,
      time: new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now(),
      isRead: false
    };
  }, [getOrderItems]);

  const fetchOrders = useCallback(async (page = currentPage) => {
    try {
      setError(null);
      const res = await fetch(`${API_BASE}/api/admin/orders?page=${page}&limit=${pageSize}`, {
        headers: buildAuthHeaders(),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.details || data.error);
        setOrders([]);
      } else {
        const incomingOrders = data.orders || [];
        setOrders(incomingOrders);
        setTotalPages(data.total_pages || 1);
        setTotalOrders(data.total || incomingOrders.length);

        // Detect new pending orders for notifications (only after initial load)
        if (initializedRef.current) {
          const newPendingOrders = incomingOrders.filter(order => {
            return (order.status === 'pending' || order.status === 'scheduled') && !seenOrdersRef.current.has(order.id);
          });
          const notifs = newPendingOrders.map(order => buildOrderNotification(order));

          const updatedNotifs = [];
          incomingOrders.forEach(order => {
            const orderId = order?.id;
            if (!orderId) return;
            if (order.status === 'delivered' || order.status === 'cancelled') return;
            const totalItems = getOrderTotalItems(order);
            const prev = orderMetricsRef.current.get(orderId);
            if (!prev) return;
            if (totalItems <= prev.totalItems) return;
            const delta = totalItems - prev.totalItems;
            const orderItems = getOrderItems(order);
            const first = orderItems[0] || null;
            let label = `Added ${delta} item${delta === 1 ? '' : 's'} to order`;
            if (first && first.product) {
              label = `Added ${delta} item${delta === 1 ? '' : 's'}: ${first.product}${orderItems.length > 1 ? ` + ${orderItems.length - 1} more` : ''}`;
            }
            updatedNotifs.push(buildOrderNotification(order, label));
          });

          const combinedNotifs = [...notifs, ...updatedNotifs];
          if (combinedNotifs.length > 0) {
            console.log('📢 [Orders] Detected', combinedNotifs.length, 'new notifications');
            addNotifications(combinedNotifs);
            setPreviewCard({ orders: combinedNotifs, count: combinedNotifs.length });
            setTimeout(() => setPreviewCard(null), 6000);
          }
        }

        incomingOrders.forEach(order => {
          const orderId = order?.id;
          if (!orderId) return;
          orderMetricsRef.current.set(orderId, { totalItems: getOrderTotalItems(order) });
        });

        // Update seen orders set and save to localStorage
        const allOrderIds = incomingOrders.map(o => o.id);
        updateSeenOrders(allOrderIds);

        if (!initializedRef.current) {
          initializedRef.current = true;
        }
      }
    } catch (e) {
      console.error(e);
      setError('Cannot connect to backend.');
    } finally {
      setLoading(false);
    }
  }, [API_BASE, currentPage, pageSize, addNotifications, updateSeenOrders, buildOrderNotification, getOrderItems, getOrderTotalItems, buildAuthHeaders]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 30000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  useEffect(() => {
    const handleClick = () => setActionMenuId(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Status update handler (no optimistic change until backend confirms)
  const updateOrderStatus = async (orderId, newStatus, cashCollected = false) => {
    // Prevent overlapping updates on same order and fast double-clicks
    if (updating === orderId) return;
    const prev = orders.find(o => o.id === orderId);
    if (!prev) return;
    const previousStatus = prev.status;

    // If marking as delivered and payment method is cash, ask for cash collection confirmation
    if (newStatus === 'delivered' && !cashCollected) {
      const isCashOrder = String(prev.payment_method || '').toLowerCase() === 'cash';
      const paymentStatus = String(prev.payment_status || '').toLowerCase();
      const alreadyPaid = paymentStatus === 'verified' || paymentStatus === 'confirmed' || paymentStatus === 'paid' || paymentStatus === 'collected';
      if (isCashOrder && !alreadyPaid) {
        setCashCollectModal({ show: true, orderId });
        return;
      }
    }

    setUpdating(orderId);

    try {
      const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}/status`, {
        method: 'PUT',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: newStatus, cash_collected: cashCollected })
      });
      const data = await res.json().catch(() => ({}));
      let errorDetails = '';
      if (!res.ok) {
        // If backend returned plain text via http.Error, capture it.
        const txt = await res.text().catch(() => '');
        errorDetails = (data && (data.error || data.message || data.details)) || txt || '';
      }

      if (res.ok && data.success) {
        // Update local UI only after backend success
        const updates = { status: newStatus };
        if (cashCollected) updates.payment_status = 'collected';
        setOrders(os => os.map(o => o.id === orderId ? { ...o, ...updates } : o));
        const baseMsg = cashCollected
          ? `✅ Order #${orderId} delivered — cash collected.`
          : `✅ Order #${orderId} updated to ${newStatus}.`;
        let notiMsg = '';
        if (data.notification_dispatched) notiMsg = ' (Customer notification queued)';
        if (data.duplicate) notiMsg = ' (No change)';
        setNotification({ show: true, message: baseMsg + notiMsg, type: 'success' });
        setTimeout(() => setNotification({ show: false, message: '', type: '' }), 5000);
      } else {
        // Keep previous status and show error
        setOrders(os => os.map(o => o.id === orderId ? { ...o, status: previousStatus } : o));
        setNotification({
          show: true,
          message: `❌ Failed to update order #${orderId}${errorDetails ? ' - ' + errorDetails : ''}`,
          type: 'danger'
        });
      }
    } catch (e) {
      console.error(e);
      // Keep previous status on network error
      setOrders(os => os.map(o => o.id === orderId ? { ...o, status: previousStatus } : o));
      setNotification({ show: true, message: '❌ Network error updating order', type: 'danger' });
    } finally {
      setUpdating(null);
    }
  };

  // Cancel order handler
  const cancelOrder = async (orderId, reason = '') => {
    if (cancelling === orderId) return;
    setCancelling(orderId);

    try {
      const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reason })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        // Update local UI
        setOrders(os => os.map(o => o.id === orderId ? { ...o, status: 'cancelled' } : o));
        const notiMsg = data.notification_dispatched ? ' (Customer notified via Messenger)' : '';
        setNotification({ show: true, message: `✅ Order #${orderId} cancelled.${notiMsg}`, type: 'warning' });
        setTimeout(() => setNotification({ show: false, message: '', type: '' }), 5000);
      } else {
        setNotification({
          show: true,
          message: `❌ Failed to cancel order #${orderId}${data.message ? ' - ' + data.message : ''}`,
          type: 'danger'
        });
      }
    } catch (e) {
      console.error(e);
      setNotification({ show: true, message: '❌ Network error cancelling order', type: 'danger' });
    } finally {
      setCancelling(null);
      setCancelModal({ show: false, orderId: null });
      setCancelReason('');
    }
  };

  const groupedOrders = useMemo(() => {
    const now = Date.now();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const yesterdayStartMs = todayStartMs - 86400000;
    const statusOrder = { pending: 0, pending_payment: 0, pending_verification: 0, preparing: 1, ready: 2, delivered: 3, cancelled: 4 };
    const dateFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

    const activeOrders = orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
    const deliveredOrders = orders.filter(o => o.status === 'delivered');
    const cancelledOrders = orders.filter(o => o.status === 'cancelled');
    const visibleOrders = filter === 'all'
      ? orders
      : filter === 'pending'
        ? activeOrders.filter(o => o.status === 'pending' || o.status === 'pending_payment' || o.status === 'scheduled')
        : filter === 'delivered'
          ? deliveredOrders
          : filter === 'cancelled'
            ? cancelledOrders
            : activeOrders.filter(o => o.status === filter);
    const paymentFiltered = paymentFilter === 'all'
      ? visibleOrders
      : visibleOrders.filter(o => String(o.payment_method || '').toLowerCase() === paymentFilter);

    const groupMap = new Map();
    const entries = paymentFiltered.map(order => {
      const createdAtMs = order.created_at ? new Date(order.created_at).getTime() : 0;
      const safeCreatedAtMs = Number.isFinite(createdAtMs) ? createdAtMs : 0;
      const dayStart = new Date(safeCreatedAtMs || now);
      dayStart.setHours(0, 0, 0, 0);
      const dayStartMs = dayStart.getTime();
      const statusKey = order.status === 'scheduled' ? 'pending' : order.status;
      return {
        order,
        createdAtMs: safeCreatedAtMs,
        dayStartMs,
        statusKey
      };
    }).filter(entry => {
      if (dateFilter === 'all' && !startDate && !endDate) return true;
      if (startDate || endDate) {
        const startMs = startDate ? new Date(startDate).getTime() : 0;
        const endMs = endDate ? new Date(endDate).getTime() + 86400000 : Date.now();
        return entry.createdAtMs >= startMs && entry.createdAtMs <= endMs;
      }
      if (dateFilter === 'today') return entry.dayStartMs === todayStartMs;
      if (dateFilter === 'yesterday') return entry.dayStartMs === yesterdayStartMs;
      if (dateFilter === 'older') return entry.dayStartMs < yesterdayStartMs;
      return true;
    });

    entries.sort((a, b) => {
      const statusDiff = (statusOrder[a.statusKey] ?? 99) - (statusOrder[b.statusKey] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      return b.createdAtMs - a.createdAtMs;
    });

    entries.forEach(entry => {
      const key = String(entry.dayStartMs);
      if (!groupMap.has(key)) {
        let label = new Date(entry.dayStartMs).toLocaleDateString(undefined, dateFormatOptions);
        if (entry.dayStartMs === todayStartMs) label = t('today') || 'Today';
        if (entry.dayStartMs === yesterdayStartMs) label = t('yesterday') || 'Yesterday';
        groupMap.set(key, { key, label, dayStartMs: entry.dayStartMs, orders: [] });
      }
      groupMap.get(key).orders.push(entry);
    });

    return Array.from(groupMap.values()).sort((a, b) => b.dayStartMs - a.dayStartMs);
  }, [orders, filter, paymentFilter, dateFilter, startDate, endDate, t]);

  const filteredCount = useMemo(() => {
    return groupedOrders.reduce((sum, group) => sum + group.orders.length, 0);
  }, [groupedOrders]);

  const filters = [
    { key: 'all', labelKey: 'all', icon: 'grid' },
    { key: 'pending', labelKey: 'pending', icon: 'hourglass' },
    { key: 'preparing', labelKey: 'preparing', icon: 'egg-fried' },
    { key: 'ready', labelKey: 'ready', icon: 'check-circle' },
    { key: 'delivered', labelKey: 'delivered', icon: 'check-all' },
    { key: 'cancelled', labelKey: 'cancelled', icon: 'x-circle' }
  ];
  const paymentFilters = [
    { key: 'all', label: 'All payments' },
    { key: 'scan', label: 'Scan' },
    { key: 'cash', label: 'Cash' }
  ];
  const dateFilters = [
    { key: 'all', label: `${t('all') || 'All'} ${t('dates') || 'dates'}` },
    { key: 'today', label: t('today') || 'Today' },
    { key: 'yesterday', label: t('yesterday') || 'Yesterday' },
    { key: 'older', label: t('older') || 'Older' }
  ];

  const handleExportExcel = useCallback(async () => {
    const now = new Date();
    const monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const formatDateKey = (date) => {
      const pad2 = (value) => String(value).padStart(2, '0');
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    };
    const parseOrderedItemsString = (value) => {
      if (!value) return [];
      const parts = String(value).split(/•|,/).map(part => part.trim()).filter(Boolean);
      return parts.map(part => {
        const match = part.match(/^(.*?)(?:×|x)\s*(\d+)\s*$/i);
        if (!match) return { product: part, quantity: 1, price: 0 };
        return { product: match[1].trim(), quantity: Number(match[2]), price: 0 };
      });
    };
    const normalizeName = (value) => String(value || '').trim().toLowerCase();
    const headers = [
      'Date', 'Active Sr No', 'Order ID', 'User ID', 'Customer', 'Phone',
      'Name', 'Op', 'In', 'Exp', 'FOC',
      'Shop Sold', 'Cl', 'MSP', 'Price', 'Amount',
      'Promotion Name', 'Promotion Discount'
    ];

    const ordersRows = [headers];
    const ordersByDay = new Map();
    const entries = [];
    const dailyLogsByKey = new Map();
    const dailyLogsByDate = new Map();
    let srNo = 1;
    let stockByName = new Map();
    let productsMap = new Map();
    let promotionNameMap = new Map();
    try {
      const monthStartKey = formatDateKey(monthDate);
      const monthEndDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      const monthEndKey = formatDateKey(monthEndDate);
      const logsRes = await fetch(`${API_BASE}/api/admin/daily-stock?start=${monthStartKey}&end=${monthEndKey}`, {
        headers: buildAuthHeaders()
      });
      const logsData = await logsRes.json().catch(() => ({}));
      const logs = Array.isArray(logsData.logs) ? logsData.logs : [];
      logs.forEach((logItem) => {
        // Normalize log_date to local YYYY-MM-DD to match how order dates are keyed
        const logDate = logItem.log_date ? new Date(logItem.log_date) : null;
        if (!logDate || Number.isNaN(logDate.getTime())) return;
        const dateKey = formatDateKey(logDate);
        if (!dateKey) return;
        const productId = logItem.product_id;
        if (productId) {
          dailyLogsByKey.set(`${dateKey}_${productId}`, logItem);
        }
        // Also key by name as fallback for items without product_id
        const logName = normalizeName(logItem.product_name || logItem.productName);
        if (logName) {
          dailyLogsByKey.set(`${dateKey}_name_${logName}`, logItem);
        }
        const list = dailyLogsByDate.get(dateKey) || [];
        list.push(logItem);
        dailyLogsByDate.set(dateKey, list);
      });

      // Fill gaps: carry forward closing stock as next day's opening stock
      // Group logs by product_id
      const logsByProduct = new Map();
      logs.forEach((logItem) => {
        if (!logItem.product_id) return;
        const pid = logItem.product_id;
        const arr = logsByProduct.get(pid) || [];
        arr.push(logItem);
        logsByProduct.set(pid, arr);
      });

      // For each product, walk through all days of the month and fill missing days
      for (const [pid, productLogs] of logsByProduct) {
        // Sort by date ascending
        productLogs.sort((a, b) => new Date(a.log_date) - new Date(b.log_date));
        const productName = productLogs[0]?.product_name || productLogs[0]?.productName || '';
        const pNameNorm = normalizeName(productName);

        for (let day = 1; day <= daysInMonth; day += 1) {
          const dateObj = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
          const dk = formatDateKey(dateObj);
          // Skip if a real log already exists for this date+product
          if (dailyLogsByKey.has(`${dk}_${pid}`)) continue;

          // Find the most recent prior day that has a log for this product
          let prevClosing = null;
          for (let prevDay = day - 1; prevDay >= 1; prevDay -= 1) {
            const prevDk = formatDateKey(new Date(monthDate.getFullYear(), monthDate.getMonth(), prevDay));
            const prevLog = dailyLogsByKey.get(`${prevDk}_${pid}`);
            if (prevLog) {
              const op = Number(prevLog.opening_stock) || 0;
              const si = Number(prevLog.stock_in) || 0;
              const exp = Number(prevLog.expired) || 0;
              const fc = Number(prevLog.foc) || 0;
              const sold = Number(prevLog.sold) || 0;
              prevClosing = op + si - exp - fc - sold;
              break;
            }
          }
          if (prevClosing === null) continue; // no prior data for this product

          // Create a synthetic log entry (carried forward)
          const syntheticLog = {
            product_id: pid,
            product_name: productName,
            opening_stock: prevClosing,
            stock_in: 0,
            expired: 0,
            foc: 0,
            sold: 0,
            _synthetic: true
          };
          dailyLogsByKey.set(`${dk}_${pid}`, syntheticLog);
          if (pNameNorm) {
            dailyLogsByKey.set(`${dk}_name_${pNameNorm}`, syntheticLog);
          }
          const dayList = dailyLogsByDate.get(dk) || [];
          dayList.push(syntheticLog);
          dailyLogsByDate.set(dk, dayList);
        }
      }
      const productsRes = await fetch(`${API_BASE}/api/products?include_stock=1&limit=1000`);
      const productsData = await productsRes.json().catch(() => ({}));
      const products = Array.isArray(productsData.products) ? productsData.products : [];
      stockByName = new Map(
        products.map(product => [
          normalizeName(product?.name),
          Number.isFinite(Number(product?.stock)) ? Number(product.stock) : 0
        ])
      );
      productsMap = new Map(
        products.map(product => [
          normalizeName(product?.name),
          product
        ])
      );
      // Fetch promotions for name lookup
      try {
        const promoRes = await fetch(`${API_BASE}/api/admin/promotions`, { headers: buildAuthHeaders() });
        const promoData = await promoRes.json().catch(() => ({}));
        const promos = Array.isArray(promoData.promotions) ? promoData.promotions : (Array.isArray(promoData) ? promoData : []);
        promos.forEach((p) => { if (p.id && p.name) promotionNameMap.set(p.id, p.name); });
      } catch (e) { /* promotions lookup optional */ }

      // Fetch ALL delivered orders (paginated)
      let allExportOrders = [];
      let exportPage = 1;
      const exportLimit = 500;
      while (true) {
        const res = await fetch(
          `${API_BASE}/api/admin/orders?order_status=delivered&limit=${exportLimit}&page=${exportPage}`,
          { headers: buildAuthHeaders() }
        );
        const data = await res.json().catch(() => ({}));
        const pageOrders = Array.isArray(data.orders) ? data.orders : [];
        allExportOrders = allExportOrders.concat(pageOrders);
        const totalPages = data.total_pages || 1;
        if (exportPage >= totalPages || pageOrders.length === 0) break;
        exportPage += 1;
      }

      allExportOrders.forEach((order) => {
        const createdAt = order?.created_at ? new Date(order.created_at) : null;
        if (!createdAt || Number.isNaN(createdAt.getTime())) return;
        if (createdAt < monthDate) return;
        const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
        if (createdAt > monthEnd) return;
        const dateKey = formatDateKey(createdAt);

        // Promotion info
        const promoId = order.promotion_id ?? null;
        const promoName = promoId ? (promotionNameMap.get(promoId) || '') : '';
        const orderDiscount = Number.isFinite(Number(order.discount)) ? Number(order.discount) : 0;

        const baseItems = Array.isArray(order.items) && order.items.length > 0
          ? order.items
          : parseOrderedItemsString(order.items_display || order.ordered_items || '');

        // Calculate total line value so we can distribute discount proportionally
        let orderLineTotal = 0;
        const parsedItems = [];
        baseItems.forEach((item) => {
          const productName = String(item.product || item.name || '').trim();
          if (!productName) return;
          const quantity = Number(item.quantity ?? item.qty ?? 0);
          const safeQty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
          if (!safeQty) return;
          const price = Number(item.price ?? item.unit_price ?? 0);
          const unitPrice = Number.isFinite(price) && price >= 0 ? price : 0;
          const lineTotal = safeQty * unitPrice;
          orderLineTotal += lineTotal;
          parsedItems.push({
            productName,
            productId: item.product_id || (productsMap.get(normalizeName(productName))?.id) || null,
            qty: safeQty,
            price: unitPrice,
            lineTotal
          });
        });

        // Distribute discount proportionally across items
        let discountRemaining = orderDiscount;
        parsedItems.forEach((item, idx) => {
          let itemDiscount = 0;
          if (orderDiscount > 0 && orderLineTotal > 0) {
            if (idx === parsedItems.length - 1) {
              itemDiscount = discountRemaining; // last item gets remainder
            } else {
              itemDiscount = Math.round((item.lineTotal / orderLineTotal) * orderDiscount * 100) / 100;
              discountRemaining -= itemDiscount;
            }
          }
          entries.push({
            dateKey,
            date: new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate()),
            orderId: order.id ?? '',
            userId: order.sender_id ?? order.user_id ?? '',
            customerName: order.customer_name ?? '',
            customerPhone: order.customer_phone ?? '',
            productName: item.productName,
            productId: item.productId,
            qty: item.qty,
            price: item.price,
            promotionName: promoName,
            promotionDiscount: itemDiscount
          });
        });
      });
      entries.forEach((entry) => {
        // Try product_id first, then fall back to product name
        let logItem = null;
        if (entry.productId) {
          logItem = dailyLogsByKey.get(`${entry.dateKey}_${entry.productId}`);
        }
        if (!logItem) {
          const nameKey = normalizeName(entry.productName);
          if (nameKey) logItem = dailyLogsByKey.get(`${entry.dateKey}_name_${nameKey}`);
        }
        const openingStock = Number.isFinite(Number(logItem?.opening_stock))
          ? Number(logItem.opening_stock)
          : 0;
        const stockIn = Number.isFinite(Number(logItem?.stock_in)) ? Number(logItem.stock_in) : 0;
        const expired = Number.isFinite(Number(logItem?.expired)) ? Number(logItem.expired) : 0;
        const foc = Number.isFinite(Number(logItem?.foc)) ? Number(logItem.foc) : 0;
        const rowIndex = ordersRows.length + 1;
        const row = new Array(headers.length).fill('');
        row[0] = entry.date;            // A: Date
        row[1] = srNo;                  // B: Sr No
        row[2] = entry.orderId;         // C: Order ID
        row[3] = entry.userId;          // D: User ID
        row[4] = entry.customerName;    // E: Customer
        row[5] = entry.customerPhone;   // F: Phone
        row[6] = entry.productName;     // G: Name
        row[7] = openingStock;          // H: Op
        row[8] = stockIn;              // I: In
        row[9] = expired;              // J: Exp
        row[10] = foc;                 // K: FOC
        row[11] = entry.qty;           // L: Shop Sold
        row[12] = { f: `H${rowIndex}+I${rowIndex}-J${rowIndex}-K${rowIndex}-L${rowIndex}` }; // M: Cl
        row[14] = entry.price;         // O: Price
        row[15] = { f: `L${rowIndex}*O${rowIndex}-R${rowIndex}` }; // P: Amount = qty*price - discount
        row[16] = entry.promotionName;  // Q: Promotion Name
        row[17] = entry.promotionDiscount || 0; // R: Promotion Discount
        ordersRows.push(row);
        const dayRows = ordersByDay.get(entry.dateKey) || [];
        dayRows.push({
          date: entry.date,
          orderId: entry.orderId,
          userId: entry.userId,
          customerName: entry.customerName,
          customerPhone: entry.customerPhone,
          name: entry.productName,
          productId: entry.productId,
          qty: entry.qty,
          price: entry.price,
          op: openingStock,
          stockIn,
          expired,
          foc,
          promotionName: entry.promotionName,
          promotionDiscount: entry.promotionDiscount
        });
        ordersByDay.set(entry.dateKey, dayRows);
        srNo += 1;
      });
    } catch (e) {
      console.error('Export fetch failed', e);
    }

    const ordersSheet = XLSX.utils.aoa_to_sheet(ordersRows);
    ordersSheet['!cols'] = [
      { wch: 12 }, // A: Date
      { wch: 10 }, // B: Sr No
      { wch: 10 }, // C: Order ID
      { wch: 16 }, // D: User ID
      { wch: 20 }, // E: Customer
      { wch: 16 }, // F: Phone
      { wch: 24 }, // G: Name
      { wch: 8 },  // H: Op
      { wch: 8 },  // I: In
      { wch: 8 },  // J: Exp
      { wch: 8 },  // K: FOC
      { wch: 12 }, // L: Shop Sold
      { wch: 10 }, // M: Cl
      { wch: 8 },  // N: MSP
      { wch: 10 }, // O: Price
      { wch: 12 }, // P: Amount
      { wch: 20 }, // Q: Promotion Name
      { wch: 16 }  // R: Promotion Discount
    ];

    const ordersLastRow = Math.max(2, ordersRows.length);
    for (let row = 2; row <= ordersLastRow; row += 1) {
      if (ordersSheet[`A${row}`]) ordersSheet[`A${row}`].z = 'yyyy-mm-dd';
      if (ordersSheet[`O${row}`]) ordersSheet[`O${row}`].z = '#,##0.00';
      if (ordersSheet[`P${row}`]) ordersSheet[`P${row}`].z = '#,##0.00';
      if (ordersSheet[`R${row}`]) ordersSheet[`R${row}`].z = '#,##0.00';
    }

    // Amount column = P, Shop Sold = L, Promo Discount = R
    const amtCol = `$P$2:$P$${ordersLastRow}`;
    const dateCol = `$A$2:$A$${ordersLastRow}`;
    const discCol = `$R$2:$R$${ordersLastRow}`;
    const summaryRows = [
      ['Selected Month', monthDate],
      [],
      ['Total Sale Amount', { f: `SUMIFS(Orders!${amtCol},Orders!${dateCol},">="&EOMONTH($B$1,-1)+1,Orders!${dateCol},"<="&EOMONTH($B$1,0))` }],
      ['Total Shop Sold', { f: `SUMIFS(Orders!$L$2:$L$${ordersLastRow},Orders!${dateCol},">="&EOMONTH($B$1,-1)+1,Orders!${dateCol},"<="&EOMONTH($B$1,0))` }],
      ['Total Promotion Discount', { f: `SUMIFS(Orders!${discCol},Orders!${dateCol},">="&EOMONTH($B$1,-1)+1,Orders!${dateCol},"<="&EOMONTH($B$1,0))` }]
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet['!cols'] = [{ wch: 26 }, { wch: 20 }];
    if (summarySheet.B1) summarySheet.B1.z = 'mmmm yyyy';
    ['B3', 'B5'].forEach((cell) => {
      if (summarySheet[cell]) summarySheet[cell].z = '#,##0.00';
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ordersSheet, 'Orders');
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Monthly Summary');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateObj = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      const dateKey = formatDateKey(dateObj);
      const dayItems = ordersByDay.get(dateKey) || [];
      const dayRows = [headers];
      const logItemsForDay = dailyLogsByDate.get(dateKey) || [];
      if (dayItems.length === 0 && logItemsForDay.length === 0) {
        const row = new Array(headers.length).fill('');
        row[0] = dateObj;
        row[1] = 1;
        row[7] = 0;   // H: Op
        row[8] = 0;   // I: In
        row[9] = 0;   // J: Exp
        row[10] = 0;  // K: FOC
        row[12] = { f: 'H2+I2-J2-K2-L2' };  // M: Cl
        row[15] = { f: 'L2*O2-R2' };        // P: Amount
        row[17] = 0;  // R: Promo Discount
        dayRows.push(row);
      } else {
        const seenProducts = new Set();
        let daySrNo = 1;

        // 1) One row per order item
        dayItems.forEach((item) => {
          const rowIndex = dayRows.length + 1;
          const row = new Array(headers.length).fill('');
          row[0] = dateObj;                  // A: Date
          row[1] = daySrNo;                  // B: Sr No
          row[2] = item.orderId;             // C: Order ID
          row[3] = item.userId;              // D: User ID
          row[4] = item.customerName;        // E: Customer
          row[5] = item.customerPhone;       // F: Phone
          row[6] = item.name;               // G: Name
          row[7] = item.op ?? 0;            // H: Op
          row[8] = item.stockIn ?? 0;       // I: In
          row[9] = item.expired ?? 0;       // J: Exp
          row[10] = item.foc ?? 0;          // K: FOC
          row[11] = item.qty;               // L: Shop Sold
          row[12] = { f: `H${rowIndex}+I${rowIndex}-J${rowIndex}-K${rowIndex}-L${rowIndex}` }; // M: Cl
          row[14] = item.price;             // O: Price
          row[15] = { f: `L${rowIndex}*O${rowIndex}-R${rowIndex}` }; // P: Amount
          row[16] = item.promotionName || '';     // Q: Promotion Name
          row[17] = item.promotionDiscount || 0;  // R: Promotion Discount
          dayRows.push(row);
          if (item.productId) seenProducts.add(`id_${item.productId}`);
          seenProducts.add(`name_${normalizeName(item.name)}`);
          daySrNo += 1;
        });

        // 2) Append stock-log-only products
        logItemsForDay.forEach((logItem) => {
          const pid = logItem.product_id;
          const logName = normalizeName(logItem.product_name || logItem.productName);
          if (pid && seenProducts.has(`id_${pid}`)) return;
          if (logName && seenProducts.has(`name_${logName}`)) return;
          if (!pid && !logName) return;
          const rowIndex = dayRows.length + 1;
          const row = new Array(headers.length).fill('');
          row[0] = dateObj;
          row[1] = daySrNo;
          row[6] = logItem.product_name || logItem.productName; // G: Name
          row[7] = Number.isFinite(Number(logItem.opening_stock)) ? Number(logItem.opening_stock) : 0;
          row[8] = Number.isFinite(Number(logItem.stock_in)) ? Number(logItem.stock_in) : 0;
          row[9] = Number.isFinite(Number(logItem.expired)) ? Number(logItem.expired) : 0;
          row[10] = Number.isFinite(Number(logItem.foc)) ? Number(logItem.foc) : 0;
          row[11] = 0; // L: Shop Sold — no delivered orders for this product on this day
          row[12] = { f: `H${rowIndex}+I${rowIndex}-J${rowIndex}-K${rowIndex}-L${rowIndex}` };
          row[15] = { f: `L${rowIndex}*O${rowIndex}-R${rowIndex}` };
          row[17] = 0; // R: no discount
          dayRows.push(row);
          if (pid) seenProducts.add(`id_${pid}`);
          if (logName) seenProducts.add(`name_${logName}`);
          daySrNo += 1;
        });
      }
      const daySheet = XLSX.utils.aoa_to_sheet(dayRows);
      daySheet['!cols'] = ordersSheet['!cols'];
      const dayLastRow = Math.max(2, dayRows.length);
      for (let row = 2; row <= dayLastRow; row += 1) {
        if (daySheet[`A${row}`]) daySheet[`A${row}`].z = 'yyyy-mm-dd';
        if (daySheet[`O${row}`]) daySheet[`O${row}`].z = '#,##0.00';
        if (daySheet[`P${row}`]) daySheet[`P${row}`].z = '#,##0.00';
        if (daySheet[`R${row}`]) daySheet[`R${row}`].z = '#,##0.00';
      }
      XLSX.utils.book_append_sheet(workbook, daySheet, dateKey);
    }
    const fileName = `bakery-order-management_${formatDateKey(now)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }, [API_BASE, buildAuthHeaders]);

  const getRelativeTimeLabel = (timestamp, now) => {
    if (!timestamp) return '—';
    const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (diffSeconds < 60) return 'just now';
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  };

  const getStatusSteps = (currentStatus, deliveryType) => {
    const isDelivery = String(deliveryType || '').toLowerCase() === 'delivery';
    const finalLabel = isDelivery ? t('delivered') : t('pickedUp');
    const finalIcon = isDelivery ? 'truck' : 'bag-check';
    const steps = [
      { key: 'pending', label: t('pending'), icon: 'hourglass-split' },
      { key: 'preparing', label: t('preparing'), icon: 'egg-fried' },
      { key: 'ready', label: t('ready'), icon: 'check-circle' },
      { key: 'delivered', label: finalLabel, icon: finalIcon }
    ];
    const normalized = (currentStatus === 'scheduled' || currentStatus === 'confirmed') ? 'pending' : currentStatus;
    const currentIndex = steps.findIndex(s => s.key === normalized);
    return steps.map((step, idx) => ({
      ...step,
      isActive: idx === currentIndex,
      isCompleted: idx < currentIndex
    }));
  };

  const getNextAction = (status, deliveryType) => {
    const isDelivery = String(deliveryType || '').toLowerCase() === 'delivery';
    const normalized = (status === 'scheduled' || status === 'confirmed') ? 'pending' : status;
    const actions = {
      pending: { label: t('startPreparing'), nextStatus: 'preparing', icon: 'egg-fried', color: 'primary' },
      preparing: { label: t('markAsReady'), nextStatus: 'ready', icon: 'check-circle', color: 'info' },
      ready: {
        label: isDelivery ? t('markAsDelivered') : t('markAsPickedUp'),
        nextStatus: 'delivered',
        icon: isDelivery ? 'truck' : 'bag-check',
        color: 'success'
      }
    };
    return actions[normalized];
  };

  const now = Date.now();
  const viewOrder = viewModal.show ? orders.find(o => o.id === viewModal.orderId) : null;
  const viewOrderItems = viewOrder ? getOrderItems(viewOrder) : [];
  const viewCreatedAtMs = viewOrder?.created_at ? new Date(viewOrder.created_at).getTime() : 0;
  const viewCreatedAtDate = viewCreatedAtMs ? new Date(viewCreatedAtMs) : null;
  const viewCreatedAtLabel = viewCreatedAtDate && !Number.isNaN(viewCreatedAtDate.getTime())
    ? viewCreatedAtDate.toLocaleString()
    : '—';
  const viewRelativeCreatedLabel = getRelativeTimeLabel(viewCreatedAtMs, now);
  const viewLastItemMs = viewOrder?.last_item_at ? new Date(viewOrder.last_item_at).getTime() : 0;
  const viewHasItemUpdate = viewLastItemMs && viewCreatedAtMs && (viewLastItemMs - viewCreatedAtMs) > 120000;
  const viewLastActivityMs = viewLastItemMs > viewCreatedAtMs ? viewLastItemMs : viewCreatedAtMs;
  const viewLastActivityDate = viewLastActivityMs ? new Date(viewLastActivityMs) : null;
  const viewLastActivityLabel = viewLastActivityDate && !Number.isNaN(viewLastActivityDate.getTime())
    ? viewLastActivityDate.toLocaleString()
    : viewCreatedAtLabel;
  const viewLastActivityRelativeLabel = getRelativeTimeLabel(viewLastActivityMs, now);
  const viewLastItemLabel = viewHasItemUpdate ? `Updated ${getRelativeTimeLabel(viewLastItemMs, now)}` : '';
  const viewNormalizedStatus = viewOrder?.status === 'scheduled' ? 'pending' : viewOrder?.status;
  const viewIsOlderPending = viewNormalizedStatus === 'pending' && viewLastActivityMs && (now - viewLastActivityMs) >= 86400000;
  const viewPendingAgeLabel = viewIsOlderPending ? `${t('pending') || 'Pending'} • ${viewLastActivityRelativeLabel}` : '';
  const viewSubtotal = Number(viewOrder?.subtotal) || 0;
  const viewDeliveryFee = Number(viewOrder?.delivery_fee) || 0;
  const viewTotalAmountRaw = Number(viewOrder?.total_amount);
  const viewDiscountRaw = Number(viewOrder?.discount) || 0;
  const viewTotalAmountFromFields = viewSubtotal + viewDeliveryFee - viewDiscountRaw;
  const viewTotalAmount = Number.isFinite(viewTotalAmountRaw) && !(viewTotalAmountRaw === 0 && viewSubtotal > 0)
    ? viewTotalAmountRaw
    : viewTotalAmountFromFields;
  const viewImpliedDiscount = Math.max(0, viewSubtotal + viewDeliveryFee - (Number.isFinite(viewTotalAmountRaw) ? viewTotalAmountRaw : viewTotalAmount));
  const viewDiscount = viewDiscountRaw > 0 ? viewDiscountRaw : viewImpliedDiscount;
  const viewScheduledFor = viewOrder?.scheduled_for ? new Date(viewOrder.scheduled_for) : null;
  const viewIsScheduled = viewOrder ? (viewOrder.status === 'scheduled' || (viewScheduledFor && !Number.isNaN(viewScheduledFor.getTime()) && viewScheduledFor.getTime() > now)) : false;
  const viewIsDelivery = viewOrder ? String(viewOrder.delivery_type || '').toLowerCase() === 'delivery' : false;
  const viewStatusLabel = viewOrder
    ? (viewIsScheduled ? 'SCHEDULED' : (viewOrder.status === 'delivered' && !viewIsDelivery ? 'PICKED UP' : String(viewOrder.status || '').toUpperCase()))
    : '';
  const viewStatusSteps = viewOrder ? getStatusSteps(viewOrder.status, viewOrder.delivery_type) : [];
  const viewNextAction = viewOrder ? getNextAction(viewOrder.status, viewOrder.delivery_type) : null;

  return (
    <>
      <Head>
        <title>BakeFlow Admin - Orders</title>
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
            onMarkAllRead={markAllRead}
            onClearAll={clearAll}
            onNotificationClick={(id) => markAsRead(id)}
            pageTitle={t('ordersLabel') || t('orders')}
            pageSubtitle={t('manageAndUpdateOrders')}
          />
          <div className="flex-grow-1 overflow-auto">
            {/* Preview card notification */}
            <NotificationPreviewCard
              key={previewCard?.orders?.[0]?.id || previewCard?.id || 'preview-none'}
              notification={previewCard}
              onClose={() => setPreviewCard(null)}
              onView={(id) => markAsRead(id)}
            />
            <div className="container-fluid px-4 py-4">

              {/* Notification Toast */}
              {notification.show && (
                <div className={`alert alert-${notification.type} alert-dismissible fade show position-fixed top-0 end-0 m-4`} style={{ zIndex: 9999, maxWidth: '400px' }} role="alert">
                  <strong>{notification.message}</strong>
                  <button type="button" className="btn-close" onClick={() => setNotification({ show: false, message: '', type: '' })}></button>
                </div>
              )}



              <div className="card border-0 shadow-sm mb-4">
                <div className="card-body">
                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                    <h5 className="card-title mb-0"><i className="bi bi-funnel me-2" />{t('filterOrders')}</h5>
                    <button type="button" className="btn btn-outline-success btn-sm" onClick={handleExportExcel}>
                      <i className="bi bi-file-earmark-spreadsheet me-1"></i>Export Excel
                    </button>
                  </div>
                  <div className="d-flex flex-wrap align-items-center gap-3">
                    <div className="btn-group flex-wrap" role="group">
                      {filters.map(f => (
                        <button key={f.key} onClick={() => setFilter(f.key)} className={`btn ${filter === f.key ? 'btn-dark' : 'btn-outline-secondary'}`}>
                          <i className={`bi bi-${f.icon} me-1`} />{t(f.labelKey)}
                        </button>
                      ))}
                    </div>
                    <div className="btn-group flex-wrap" role="group">
                      {paymentFilters.map(f => (
                        <button key={f.key} onClick={() => setPaymentFilter(f.key)} className={`btn ${paymentFilter === f.key ? 'btn-dark' : 'btn-outline-secondary'}`}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <div className="d-flex align-items-center gap-2 px-2 py-2 rounded-pill" style={{ background: '#FFF6EC' }}>
                      <div className="d-flex align-items-center gap-2 px-2">
                        <span className="d-inline-flex align-items-center justify-content-center rounded-circle bg-white shadow-sm" style={{ width: '28px', height: '28px' }}>
                          <i className="bi bi-calendar3 text-primary-bake"></i>
                        </span>
                        <span className="text-muted small fw-semibold">{t('date') || 'Date'}</span>
                      </div>
                      <div className="d-flex flex-wrap align-items-center gap-2">
                        <div className="d-flex gap-2 align-items-center">
                          <input
                            type="date"
                            className="form-control form-control-sm"
                            value={startDate}
                            onChange={(e) => {
                              setStartDate(e.target.value);
                              setDateFilter('custom');
                            }}
                            style={{ maxWidth: '140px' }}
                            placeholder="From"
                          />
                          <span className="text-muted small">to</span>
                          <input
                            type="date"
                            className="form-control form-control-sm"
                            value={endDate}
                            onChange={(e) => {
                              setEndDate(e.target.value);
                              setDateFilter('custom');
                            }}
                            style={{ maxWidth: '140px' }}
                            placeholder="To"
                          />
                          {(startDate || endDate) && (
                            <button
                              type="button"
                              onClick={() => {
                                setStartDate('');
                                setEndDate('');
                                setDateFilter('all');
                              }}
                              className="btn btn-sm btn-link text-muted"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        <div className="d-flex flex-wrap align-items-center gap-2 border-start ps-2">
                          {dateFilters.map(option => (
                            <button
                              key={option.key}
                              type="button"
                              onClick={() => {
                                setDateFilter(option.key);
                                setStartDate('');
                                setEndDate('');
                              }}
                              className={`btn btn-sm rounded-pill px-3 ${dateFilter === option.key && !startDate && !endDate ? 'bg-primary-bake text-white' : 'bg-white border text-dark'}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {error && <div className="alert alert-danger">{error}</div>}
              {loading && <div className="text-center py-5"><div className="spinner-border text-primary" role="status" /><p className="mt-3 text-muted">{t('loadingOrders')}</p></div>}

              {!loading && filteredCount === 0 && !error && (
                <div className="card border-0 shadow-sm"><div className="card-body text-center py-5"><i className="bi bi-inbox fs-1 text-muted mb-3" /><h4 className="text-muted">{t('noOrdersFound')}</h4><p className="text-secondary">{filter !== 'all' ? t('noFilteredOrders').replace('{filter}', t(filter)) : t('waitingForOrders')}</p></div></div>
              )}

              <div className="d-flex flex-column gap-4">
                {groupedOrders.map(group => (
                  <Fragment key={group.key}>
                    <div className="d-flex align-items-center gap-3">
                      <div className="text-uppercase small text-muted fw-semibold">{group.label}</div>
                      <div className="flex-grow-1 border-top"></div>
                    </div>
                    <div className="card border-0 shadow-sm" style={{ borderRadius: '12px' }}>
                      <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                          <thead className="table-light">
                            <tr>
                              <th style={{ width: '100px' }} className="text-start">Order ID</th>
                              <th style={{ maxWidth: '200px' }} className="text-start">Customer</th>
                              <th style={{ width: '120px' }} className="text-center">Type</th>
                              <th style={{ width: '140px' }} className="text-center">Order Status</th>
                              <th style={{ width: '140px' }} className="text-center">Payment Status</th>
                              <th style={{ width: '140px' }} className="text-end">Total</th>
                              <th style={{ width: '160px' }} className="text-center">Date</th>
                              <th className="text-end">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.orders.map(entry => {
                              const order = entry.order;
                              const nextAction = getNextAction(order.status, order.delivery_type);
                              const scheduledFor = order.scheduled_for ? new Date(order.scheduled_for) : null;
                              const isScheduled = order.status === 'scheduled' || (scheduledFor && !Number.isNaN(scheduledFor.getTime()) && scheduledFor.getTime() > now);
                              const isDelivery = String(order.delivery_type || '').toLowerCase() === 'delivery';
                              const statusLabel = isScheduled
                                ? 'SCHEDULED'
                                : order.status === 'pending_payment'
                                  ? 'PENDING PAYMENT'
                                  : order.status === 'pending_verification'
                                    ? 'VERIFYING'
                                    : (order.status === 'delivered' && !isDelivery ? 'PICKED UP' : String(order.status || '').toUpperCase());
                              const subtotal = Number(order.subtotal) || 0;
                              const deliveryFee = Number(order.delivery_fee) || 0;
                              const totalAmountRaw = Number(order.total_amount);
                              const discountRaw = Number(order.discount) || 0;
                              const totalAmountFromFields = subtotal + deliveryFee - discountRaw;
                              const totalAmount = Number.isFinite(totalAmountRaw) && !(totalAmountRaw === 0 && subtotal > 0) ? totalAmountRaw : totalAmountFromFields;
                              const createdAtMs = entry.createdAtMs || 0;
                              const createdAtDate = createdAtMs ? new Date(createdAtMs) : null;
                              const createdAtLabel = createdAtDate && !Number.isNaN(createdAtDate.getTime())
                                ? createdAtDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                                : '—';
                              const paymentStatusRaw = String(order.payment_status || '').trim().toLowerCase();
                              const paymentStatus = paymentStatusRaw || 'unpaid';
                              const paymentBadge = paymentStatus === 'verified' || paymentStatus === 'confirmed' || paymentStatus === 'paid'
                                ? 'success'
                                : paymentStatus === 'collected'
                                  ? 'success'
                                  : paymentStatus === 'pending'
                                    ? 'warning text-dark'
                                    : paymentStatus === 'rejected'
                                      ? 'danger'
                                      : 'secondary';
                              const paymentStatusLabel = paymentStatus === 'collected' ? 'CASH COLLECTED' : paymentStatus.toUpperCase();
                              const customerName = String(order.customer_name || '—');
                              const orderIdLabel = `#${order.id}`;
                              const typeLabel = order.delivery_type === 'delivery' ? (t('deliveryLabel') || 'Delivery') : (t('pickupLabel') || 'Pickup');

                              return (
                                <tr key={order.id} style={{ height: '52px' }}>
                                  <td className="text-start" style={{ maxWidth: '100px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={orderIdLabel}>
                                    {orderIdLabel}
                                  </td>
                                  <td className="text-start" style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={customerName}>
                                    {customerName}
                                  </td>
                                  <td className="text-center" style={{ maxWidth: '120px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={typeLabel}>
                                    {typeLabel}
                                  </td>
                                  <td className="text-center" style={{ maxWidth: '140px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={statusLabel}>
                                    <span className={`badge bg-${statusColor(order.status)} px-3 py-2`}>
                                      {isScheduled && <i className="bi bi-calendar-event me-1" />}
                                      {statusLabel}
                                      {updating === order.id && <span className="ms-2 spinner-border spinner-border-sm" />}
                                    </span>
                                  </td>
                                  <td className="text-center" style={{ maxWidth: '140px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={paymentStatusLabel}>
                                    <span className={`badge bg-${paymentBadge} px-3 py-2`}>
                                      {paymentStatusLabel}
                                    </span>
                                  </td>
                                  <td className="text-end fw-semibold" style={{ maxWidth: '140px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={formatCurrency(totalAmount)}>
                                    {formatCurrency(totalAmount)}
                                  </td>
                                  <td className="text-center" style={{ maxWidth: '160px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={createdAtLabel}>
                                    {createdAtLabel}
                                  </td>
                                  <td className="text-end">
                                    <div className="d-flex justify-content-end align-items-center gap-2">
                                      {(() => {
                                        const isScanPay = String(order.payment_method || '').toLowerCase() === 'scan';
                                        const payVerified = ['verified', 'confirmed', 'paid', 'collected'].includes(paymentStatus);
                                        const showAction = nextAction && (!isScanPay || payVerified);
                                        return showAction ? (
                                        <button
                                          disabled={updating === order.id || cancelling === order.id}
                                          onClick={() => updateOrderStatus(order.id, nextAction.nextStatus)}
                                          className={`btn btn-${nextAction.color} btn-sm d-inline-flex align-items-center gap-1`}
                                        >
                                          {updating === order.id ? (
                                            <span className="spinner-border spinner-border-sm" role="status"></span>
                                          ) : (
                                            <i className={`bi bi-${nextAction.icon}`}></i>
                                          )}
                                          <span>{nextAction.label}</span>
                                        </button>
                                        ) : null;
                                      })()}
                                      <div className="position-relative">
                                        <button
                                          className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center"
                                          type="button"
                                          aria-expanded={actionMenuId === order.id}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setActionMenuId(actionMenuId === order.id ? null : order.id);
                                          }}
                                        >
                                          <i className="bi bi-three-dots-vertical"></i>
                                        </button>
                                        {actionMenuId === order.id && (
                                          <div
                                            className="dropdown-menu dropdown-menu-end show"
                                            style={{ position: 'absolute', right: 0, top: '100%', marginTop: '4px' }}
                                            onClick={(event) => event.stopPropagation()}
                                          >
                                            <button
                                              className="dropdown-item"
                                              type="button"
                                              onClick={() => {
                                                setViewModal({ show: true, orderId: order.id });
                                                setActionMenuId(null);
                                              }}
                                            >
                                              View Details
                                            </button>
                                            {order.status !== 'delivered' && order.status !== 'cancelled' && (
                                              <button
                                                className="dropdown-item text-danger"
                                                type="button"
                                                disabled={updating === order.id || cancelling === order.id}
                                                onClick={() => {
                                                  setCancelModal({ show: true, orderId: order.id });
                                                  setActionMenuId(null);
                                                }}
                                              >
                                                Cancel Order
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </Fragment>
                ))}
              </div>

              {/* Pagination */}
              {!loading && totalPages > 1 && (
                <div className="d-flex justify-content-between align-items-center mt-4">
                  <span className="text-muted" style={{ fontSize: '13px' }}>
                    Showing page {currentPage} of {totalPages} ({totalOrders} total orders)
                  </span>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={currentPage <= 1}
                      onClick={() => { setCurrentPage(p => p - 1); setLoading(true); }}
                    >
                      <i className="bi bi-chevron-left me-1" />Previous
                    </button>
                    {[...Array(Math.min(totalPages, 5))].map((_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          className={`btn btn-sm ${currentPage === pageNum ? 'btn-primary' : 'btn-outline-secondary'}`}
                          onClick={() => { setCurrentPage(pageNum); setLoading(true); }}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={currentPage >= totalPages}
                      onClick={() => { setCurrentPage(p => p + 1); setLoading(true); }}
                    >
                      Next<i className="bi bi-chevron-right ms-1" />
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>

      {/* Cancel Order Modal */}
      {cancelModal.show && (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title text-danger">
                  <i className="bi bi-exclamation-triangle-fill me-2"></i>
                  Cancel Order #{cancelModal.orderId}
                </h5>
                <button type="button" className="btn-close" onClick={() => {
                  setCancelModal({ show: false, orderId: null });
                  setCancelReason('');
                }}></button>
              </div>
              <div className="modal-body">
                <p className="text-muted mb-3">
                  Are you sure you want to cancel this order? The customer will be notified via Messenger.
                </p>
                <div className="mb-3">
                  <label className="form-label fw-semibold">Cancellation Reason (optional)</label>
                  
                  {/* Quick Reason Options */}
                  <div className="mb-3 d-flex flex-wrap gap-2">
                    {[
                      'Out of stock',
                      'Unable to deliver to this area',
                      'Customer request',
                      'Scheduling conflict',
                      'Quality issue',
                      'Payment failed'
                    ].map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        className={`btn btn-sm ${
                          cancelReason === reason
                            ? 'btn-primary'
                            : 'btn-outline-primary'
                        }`}
                        onClick={() => setCancelReason(reason)}
                      >
                        {reason}
                      </button>
                    ))}
                  </div>

                  <textarea
                    className="form-control"
                    rows="3"
                    placeholder="e.g., Out of stock, Unable to deliver to this area..."
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  ></textarea>
                  <small className="text-muted">This reason will be sent to the customer.</small>
                </div>
              </div>
              <div className="modal-footer border-0 pt-0">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setCancelModal({ show: false, orderId: null });
                    setCancelReason('');
                  }}
                >
                  Keep Order
                </button>
                <button
                  type="button"
                  className="btn btn-danger d-flex align-items-center gap-2"
                  disabled={cancelling === cancelModal.orderId}
                  onClick={() => cancelOrder(cancelModal.orderId, cancelReason)}
                >
                  {cancelling === cancelModal.orderId ? (
                    <>
                      <span className="spinner-border spinner-border-sm"></span>
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-x-circle"></i>
                      Cancel Order
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cash Collected Confirmation Modal */}
      {cashCollectModal.show && (() => {
        const cashOrder = orders.find(o => o.id === cashCollectModal.orderId);
        const cashTotal = cashOrder ? (Number(cashOrder.total_amount) || 0) : 0;
        return (
          <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '420px' }}>
              <div className="modal-content border-0 shadow">
                <div className="modal-body text-center p-4">
                  <div className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3" style={{ width: '56px', height: '56px', background: '#ECFDF5' }}>
                    <i className="bi bi-cash-stack fs-3 text-success"></i>
                  </div>
                  <h5 className="fw-bold mb-2">Cash Collected?</h5>
                  <p className="text-muted mb-3" style={{ fontSize: '14px' }}>
                    Confirm that you have collected <strong className="text-dark">{formatCurrency(cashTotal)}</strong> in cash for Order <strong>#{cashCollectModal.orderId}</strong>.
                  </p>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-outline-secondary flex-grow-1"
                      onClick={() => setCashCollectModal({ show: false, orderId: null })}
                    >
                      Not Yet
                    </button>
                    <button
                      className="btn btn-success flex-grow-1 d-flex align-items-center justify-content-center gap-2"
                      onClick={() => {
                        setCashCollectModal({ show: false, orderId: null });
                        updateOrderStatus(cashCollectModal.orderId, 'delivered', true);
                      }}
                    >
                      <i className="bi bi-check-circle"></i>
                      Yes, Cash Collected
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {viewModal.show && viewOrder && (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" style={{ maxWidth: '900px' }}>
            <div className="modal-content">
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title fw-bold">Order #{viewOrder.id}</h5>
                <button type="button" className="btn-close" onClick={() => setViewModal({ show: false, orderId: null })}></button>
              </div>
              <div className="modal-body pt-0" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                <div className={`card ${viewIsScheduled ? 'border-start border-4 border-dark' : 'border-0'} shadow-sm h-100 order-detail-card`}>
                  <div className={`card-header ${viewIsScheduled ? 'bg-light' : 'bg-white'} border-bottom py-3`}>
                    <div className="d-flex justify-content-between align-items-start">
                      <div>
                        <h5 className="mb-1 fw-bold">Order #{viewOrder.id}</h5>
                        {viewIsScheduled && viewOrder.scheduled_for ? (
                          <div>
                            <div className="fw-semibold">
                              <i className="bi bi-calendar-event me-1"></i>
                              Scheduled for: {new Date(viewOrder.scheduled_for).toLocaleString()}
                            </div>
                            <small className="text-muted">Updated {viewLastActivityRelativeLabel} • {viewLastActivityLabel}</small>
                          </div>
                        ) : (
                          <small className="text-muted d-flex align-items-center gap-2">
                            <i className="bi bi-clock me-1"></i>
                            <span className="fw-semibold text-dark">{viewRelativeCreatedLabel}</span>
                            <span className="text-muted">•</span>
                            <span className="text-muted">{viewCreatedAtLabel}</span>
                          </small>
                        )}
                      </div>
                      <div className="d-flex align-items-start flex-wrap justify-content-end gap-2">
                        <span className={`badge bg-${statusColor(viewOrder.status)} px-3 py-2`}>
                          {viewIsScheduled && <i className="bi bi-calendar-event me-1" />}
                          {viewStatusLabel}
                          {updating === viewOrder.id && <span className="ms-2 spinner-border spinner-border-sm" />}
                        </span>
                        {viewHasItemUpdate && (
                          <span className="badge bg-info text-dark px-3 py-2">{viewLastItemLabel}</span>
                        )}
                        {viewPendingAgeLabel && (
                          <span className="badge bg-warning text-dark px-3 py-2">{viewPendingAgeLabel}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="card-body p-4">
                    <div className="status-timeline mb-4">
                      <div className="d-flex justify-content-between align-items-center position-relative">
                        <div className="progress-line position-absolute" style={{ height: '2px', left: '24px', right: '24px', top: '20px', background: '#e9ecef', zIndex: 0 }}>
                          <div style={{ height: '100%', width: `${(viewStatusSteps.filter(s => s.isCompleted).length / (viewStatusSteps.length - 1)) * 100}%`, background: '#D8A35D', transition: 'width 0.3s' }}></div>
                        </div>
                        {viewStatusSteps.map((step) => (
                          <div key={step.key} className="text-center position-relative" style={{ zIndex: 1, flex: 1 }}>
                            <div className={`rounded-circle d-inline-flex align-items-center justify-content-center ${step.isActive ? 'bg-primary-bake text-white' : step.isCompleted ? 'bg-success text-white' : 'bg-light text-muted'}`} style={{ width: '40px', height: '40px', border: '3px solid white', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                              <i className={`bi bi-${step.icon} fs-6`}></i>
                            </div>
                            <div className={`small mt-2 fw-${step.isActive ? 'bold' : 'normal'} ${step.isActive ? 'text-dark' : 'text-muted'}`}>{step.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="row g-3 mb-4">
                      <div className="col-md-6">
                        <div className="info-card p-3 rounded" style={{ background: '#FFF4EA' }}>
                          <div className="d-flex align-items-start gap-3">
                            <div className="rounded-circle bg-white p-2 shadow-sm">
                              <i className="bi bi-person-fill fs-5 text-primary-bake"></i>
                            </div>
                            <div className="flex-grow-1">
                              <small className="text-muted text-uppercase d-block mb-1" style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}>{t('customerLabel')}</small>
                              <strong className="d-block">{viewOrder.customer_name}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="info-card p-3 rounded" style={{ background: '#F8E8D0' }}>
                          <div className="d-flex align-items-start gap-3">
                            <div className="rounded-circle bg-white p-2 shadow-sm">
                              <i className={`bi ${viewOrder.delivery_type === 'delivery' ? 'bi-truck' : 'bi-bag'} fs-5 text-primary-bake`}></i>
                            </div>
                            <div className="flex-grow-1">
                              <small className="text-muted text-uppercase d-block mb-1" style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}>{t('typeLabel')}</small>
                              <strong className="d-block text-capitalize">{viewOrder.delivery_type === 'delivery' ? t('deliveryLabel') : t('pickupLabel')}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    {viewOrder.delivery_type === 'delivery' && viewOrder.address && (
                      <div className="mb-4 p-3 rounded" style={{ background: '#FCE4EC' }}>
                        <div className="d-flex align-items-start gap-3">
                          <i className="bi bi-geo-alt-fill text-danger mt-1"></i>
                          <div>
                            <small className="text-muted text-uppercase d-block mb-1" style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}>{t('deliveryAddress')}</small>
                            <strong>{viewOrder.address}</strong>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="mb-4">
                      <h6 className="fw-bold mb-3 text-uppercase" style={{ fontSize: '0.85rem', letterSpacing: '0.5px' }}>
                        <i className="bi bi-bag-fill me-2 text-primary-bake"></i>{t('orderItems')}
                      </h6>
                      <div className="items-list">
                        {viewOrderItems.map((item, idx) => (
                          <div key={idx} className="py-3 border-bottom">
                            <div className="d-flex align-items-start gap-3">
                              <div className="flex-shrink-0">
                                <Image
                                  src={item.image_url || 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=80&h=80&fit=crop'}
                                  alt={item.product}
                                  width={56}
                                  height={56}
                                  className="rounded"
                                  style={{ objectFit: 'cover', border: '1px solid #eee' }}
                                />
                              </div>
                              <div className="flex-grow-1">
                                <div className="d-flex justify-content-between align-items-start">
                                  <div>
                                    <div className="fw-semibold">{item.product}</div>
                                    <small className="text-muted">{formatCurrency(item.price)} × {item.quantity}</small>
                                  </div>
                                  <div className="fw-bold">{formatCurrency(item.price * item.quantity)}</div>
                                </div>
                                {item.note && (
                                  <div className="mt-2 p-2 rounded" style={{ background: '#FFF9E6', fontSize: '0.85rem' }}>
                                    <i className="bi bi-chat-left-text me-1 text-warning"></i>
                                    <span className="text-dark">{item.note}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="payment-summary p-3 rounded mb-4" style={{ background: '#E8F8F2' }}>
                      <div className="d-flex justify-content-between mb-2">
                        <span className="text-muted">{t('subtotal')}</span>
                        <span className="fw-semibold">{formatCurrency(viewSubtotal)}</span>
                      </div>
                      {viewDiscount > 0 && (
                        <div className="d-flex justify-content-between mb-2">
                          <span className="text-muted">{t('discount') || 'Discount'}</span>
                          <span className="fw-semibold text-success">
                            {formatCurrency(-viewDiscount)}
                          </span>
                        </div>
                      )}
                      <div className="d-flex justify-content-between mb-3 pb-3 border-bottom">
                        <span className="text-muted">{t('deliveryFee')}</span>
                        <span className="fw-semibold">{formatCurrency(viewDeliveryFee)}</span>
                      </div>
                      <div className="d-flex justify-content-between align-items-center">
                        <span className="fw-bold fs-5">{t('totalAmount')}</span>
                        <span className="fw-bold fs-4 text-primary-bake">{formatCurrency(viewTotalAmount)}</span>
                      </div>
                    </div>
                    <div className="d-flex gap-2">
                      {(() => {
                        const vIsScanPay = String(viewOrder?.payment_method || '').toLowerCase() === 'scan';
                        const vPayStatus = String(viewOrder?.payment_status || '').toLowerCase();
                        const vPayVerified = ['verified', 'confirmed', 'paid', 'collected'].includes(vPayStatus);
                        const vShowAction = viewNextAction && (!vIsScanPay || vPayVerified);
                        return vShowAction ? (
                        <button
                          disabled={updating === viewOrder.id || cancelling === viewOrder.id}
                          onClick={() => updateOrderStatus(viewOrder.id, viewNextAction.nextStatus)}
                          className={`btn btn-${viewNextAction.color} btn-lg flex-grow-1 d-flex align-items-center justify-content-center gap-2`}
                          style={{ padding: '0.875rem' }}
                        >
                          {updating === viewOrder.id ? (
                            <>
                              <span className="spinner-border spinner-border-sm" role="status"></span>
                              <span>{t('updating')}</span>
                            </>
                          ) : (
                            <>
                              <i className={`bi bi-${viewNextAction.icon} fs-5`}></i>
                              <span className="fw-semibold">{viewNextAction.label}</span>
                            </>
                          )}
                        </button>
                        ) : null;
                      })()}
                      {viewOrder.status !== 'delivered' && viewOrder.status !== 'cancelled' && (
                        <button
                          disabled={updating === viewOrder.id || cancelling === viewOrder.id}
                          onClick={() => {
                            setViewModal({ show: false, orderId: null });
                            setCancelModal({ show: true, orderId: viewOrder.id });
                          }}
                          className="btn btn-outline-danger btn-lg d-flex align-items-center justify-content-center gap-2"
                          style={{ padding: '0.875rem' }}
                          title="Cancel Order"
                        >
                          {cancelling === viewOrder.id ? (
                            <span className="spinner-border spinner-border-sm" role="status"></span>
                          ) : (
                            <i className="bi bi-x-circle fs-5"></i>
                          )}
                        </button>
                      )}
                    </div>
                    {viewOrder.status === 'delivered' && (
                      <div className="alert alert-success mb-0 d-flex align-items-center gap-2">
                        <i className="bi bi-check-circle-fill fs-5"></i>
                        <span className="fw-semibold">{t('orderCompleted')}</span>
                      </div>
                    )}
                    {viewOrder.status === 'cancelled' && (
                      <div className="alert alert-danger mb-0 d-flex align-items-center gap-2">
                        <i className="bi bi-x-circle-fill fs-5"></i>
                        <span className="fw-semibold">Order Cancelled</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
