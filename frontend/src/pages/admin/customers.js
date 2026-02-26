import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import Sidebar from '../../components/Sidebar';
import TopNavbar from '../../components/TopNavbar';
import { formatCurrency } from '../../utils/formatCurrency';
import { useTranslation } from '../../utils/i18n';

const storeAverages = {
  avgOrderValue: 30,
  cancellationRate: 0.06,
  promoDependence: 0.35,
  cancellationCount: 1
};

export default function AdminCustomerPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCustomerKey, setSelectedCustomerKey] = useState('');
  const [expandedOrders, setExpandedOrders] = useState({});
  const [deliveryRequirements, setDeliveryRequirements] = useState({
    reconfirmBeforePrep: false,
    manualApproval: false
  });
  const [orderRestrictions, setOrderRestrictions] = useState({
    dailyCodLimit: 2,
    blockSameDayRepeat: false,
    pendingConfirmation: false
  });
  const [selectedAction, setSelectedAction] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const emptyStatus = useMemo(() => ({
    blocked: false,
    blockedReason: '',
    blockedAt: null,
    verified: false,
    verificationMethod: '',
    verifiedAt: null,
    verifiedByAdminId: null,
    pendingVerification: false,
    pendingRequestedAt: null
  }), []);
  const [customerStatus, setCustomerStatus] = useState(emptyStatus);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [verificationReason, setVerificationReason] = useState('');

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

  const API_BASE = (() => {
    const fromEnv = process.env.NEXT_PUBLIC_API_BASE;
    if (fromEnv) return fromEnv;
    return 'https://bakeflow.onrender.com';
  })();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let tok = '';
    try {
      tok = localStorage.getItem('bakeflow_admin_token') || '';
    } catch {
      tok = '';
    }
    if (!tok) {
      const target = router.asPath || '/admin/customers';
      router.replace(`/admin/login?redirect=${encodeURIComponent(target)}`);
    }
  }, [router]);

  const parseResponse = async res => {
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null;
    }
    if (!res.ok) {
      const message = data?.details || data?.error || data?.message || 'Request failed.';
      throw new Error(message);
    }
    return data;
  };

  const loadCustomerStatus = useCallback(async psid => {
    if (!psid) {
      setCustomerStatus(emptyStatus);
      return;
    }
    try {
      setStatusError('');
      setStatusLoading(true);
      const res = await fetch(`${API_BASE}/api/admin/customers/status?psid=${encodeURIComponent(psid)}`, {
        headers: buildAuthHeaders(),
      });
      const data = await parseResponse(res);
      setCustomerStatus({
        blocked: Boolean(data?.blocked),
        blockedReason: data?.blocked_reason || '',
        blockedAt: data?.blocked_at || null,
        verified: Boolean(data?.verified),
        verificationMethod: data?.verification_method || '',
        verifiedAt: data?.verified_at || null,
        verifiedByAdminId: data?.verified_by_admin_id ?? null,
        pendingVerification: Boolean(data?.pending_verification),
        pendingRequestedAt: data?.pending_requested_at || null
      });
    } catch (err) {
      setStatusError(err?.message || 'Failed to load customer status.');
      setCustomerStatus(emptyStatus);
    } finally {
      setStatusLoading(false);
    }
  }, [API_BASE, emptyStatus, buildAuthHeaders]);

  const performAdminAction = useCallback(async (psid, path, payload) => {
    if (!psid) return null;
    try {
      setStatusError('');
      setActionLoading(true);
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      const data = await parseResponse(res);
      await loadCustomerStatus(psid);
      return data;
    } catch (err) {
      setStatusError(err?.message || 'Action failed.');
      return null;
    } finally {
      setActionLoading(false);
    }
  }, [API_BASE, loadCustomerStatus, buildAuthHeaders]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setError(null);
        setLoading(true);
        const [ordersRes] = await Promise.all([
          fetch(`${API_BASE}/api/admin/orders?include_fb_profile=1`, {
            headers: buildAuthHeaders(),
          })
        ]);
        const ordersJson = await ordersRes.json();
        if (!active) return;
        if (ordersJson?.error) {
          throw new Error(ordersJson.details || ordersJson.error);
        }
        setOrders(Array.isArray(ordersJson?.orders) ? ordersJson.orders : []);
      } catch (err) {
        if (!active) return;
        setError(err?.message || 'Failed to load customer data.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [API_BASE, buildAuthHeaders]);


  const normalizedOrders = useMemo(() => {
    return orders.map(order => {
      const subtotal = Number(order.subtotal) || 0;
      const deliveryFee = Number(order.delivery_fee) || 0;
      const discount = Number(order.discount) || 0;
      const rawTotal = Number(order.total_amount);
      const totalAmount = Number.isFinite(rawTotal) && !(rawTotal === 0 && subtotal > 0)
        ? rawTotal
        : Math.max(0, subtotal + deliveryFee - discount);
      return {
        ...order,
        subtotal,
        delivery_fee: deliveryFee,
        discount,
        total_amount: totalAmount
      };
    });
  }, [orders]);

  const buildCustomerProfile = useCallback(ordersForCustomer => {
    if (!ordersForCustomer || ordersForCustomer.length === 0) {
      return {
        key: '',
        phone: '',
        phones: [],
        psid: '',
        maskedPSID: '',
        signupSource: 'Manual',
        displayName: '',
        primaryIdentity: 'CUST-NEW',
        firstOrder: null,
        lastOrder: null,
        riskStatus: 'Watchlist',
        listStatus: 'Watchlist',
        riskBadges: [],
        riskContext: [],
        riskReasons: [],
        qualitySummary: {
          reliability: 'Needs confirmation',
          pros: [],
          concerns: []
        },
        quality: {
          reliability: 'Needs confirmation',
          cancellationBehavior: 'Medium',
          promoAbuseRisk: 'Medium'
        },
        metrics: {
          totalOrders: 0,
          totalSpent: 0,
          avgOrder: 0,
          cancelledCount: 0,
          promoDependence: 0,
          refundRate: 0,
          codRefusals: 0,
          deliveryFailures: 0,
          lastSuccessfulDelivery: null
        }
      };
    }

    const primary = ordersForCustomer[0];
    const nameRaw = String(primary.customer_name || '');
    const match = nameRaw.match(/^(.*)\((.*)\)\s*$/);
    const displayName = match ? match[1].trim() : nameRaw.trim();
    const phone = match ? match[2].trim() : '';
    const phoneSet = new Set();
    ordersForCustomer.forEach(order => {
      const raw = String(order.customer_name || '');
      const parsed = raw.match(/^(.*)\((.*)\)\s*$/);
      const extracted = parsed ? parsed[2].trim() : '';
      if (extracted) {
        phoneSet.add(extracted);
      }
    });
    const phones = Array.from(phoneSet);
    const psid = String(primary.sender_id || '');
    const maskedPSID = psid
      ? `${psid.slice(0, 4)}••••${psid.slice(-4)}`
      : '';
    const systemId = primary.sender_id || `CUST-${primary.id}`;
    const primaryIdentity = psid || systemId;
    const sorted = [...ordersForCustomer].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const firstOrder = sorted[0]?.created_at || null;
    const lastOrder = sorted[sorted.length - 1]?.created_at || null;
    const totalOrders = ordersForCustomer.length;
    const totalSpent = ordersForCustomer.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const cancelledCount = ordersForCustomer.filter(o => {
      const s = String(o.status || '').toLowerCase();
      return s === 'cancelled' || s === 'refunded';
    }).length;
    const promoOrders = ordersForCustomer.filter(o => Number(o.discount) > 0 || o.promotion_id != null).length;
    const promoDependence = totalOrders > 0 ? promoOrders / totalOrders : 0;
    const refundRate = totalOrders > 0 ? cancelledCount / totalOrders : 0;
    const watchlist = refundRate >= 0.15 || cancelledCount >= 2 || promoDependence >= 0.6;
    const reliability = refundRate < 0.05 && cancelledCount === 0
      ? 'Reliable'
      : refundRate < 0.15 && cancelledCount <= 1
        ? 'Needs confirmation'
        : 'High risk';
    const cancellationBehavior = refundRate < 0.05 && cancelledCount === 0 ? 'Low' : refundRate < 0.15 && cancelledCount <= 1 ? 'Medium' : 'High';
    const promoAbuseRisk = promoDependence < 0.3 ? 'Low' : promoDependence < 0.6 ? 'Medium' : 'High';
    const riskStatus = reliability === 'High risk'
      ? 'High Risk'
      : reliability === 'Needs confirmation' || watchlist
        ? 'Watchlist'
        : 'Trusted';
    const listStatus = riskStatus;
    const riskBadges = [];
    const riskContext = [];
    if (cancelledCount > storeAverages.cancellationCount) {
      riskBadges.push(`Repeat cancellations above average (${cancelledCount} vs ${storeAverages.cancellationCount})`);
      riskContext.push(`Repeat cancellations: ${cancelledCount} (avg: ${storeAverages.cancellationCount})`);
    }
    if (refundRate > storeAverages.cancellationRate) {
      riskBadges.push(`Cancellation rate above average (${Math.round(refundRate * 100)}% vs ${Math.round(storeAverages.cancellationRate * 100)}%)`);
      riskContext.push(`Cancellation rate: ${Math.round(refundRate * 100)}% (avg: ${Math.round(storeAverages.cancellationRate * 100)}%)`);
    }
    if (promoDependence > storeAverages.promoDependence) {
      riskBadges.push(`Promo reliance above average (${Math.round(promoDependence * 100)}% vs ${Math.round(storeAverages.promoDependence * 100)}%)`);
      riskContext.push(`Promo reliance: ${Math.round(promoDependence * 100)}% (avg: ${Math.round(storeAverages.promoDependence * 100)}%)`);
    }
    const riskReasons = [];
    if (phones.length > 1) riskReasons.push('Multiple phone numbers linked');
    if (!displayName) riskReasons.push('Unverified name');
    if (cancelledCount > storeAverages.cancellationCount) riskReasons.push('High cancellation count');
    if (refundRate > storeAverages.cancellationRate || promoDependence > storeAverages.promoDependence) {
      riskReasons.push('COD abuse patterns');
    }
    const qualityPros = [];
    const qualityConcerns = [];
    if (refundRate <= storeAverages.cancellationRate) qualityPros.push('Cancellation rate below average');
    if (promoDependence <= storeAverages.promoDependence) qualityPros.push('Promo usage within norms');
    if (totalOrders >= 3) qualityPros.push('Established order history');
    if (refundRate > storeAverages.cancellationRate) qualityConcerns.push('Cancellations above average');
    if (cancelledCount > storeAverages.cancellationCount) qualityConcerns.push('Repeat cancellations');
    if (promoDependence > storeAverages.promoDependence) qualityConcerns.push('Promo reliance above average');

    const codRefusals = cancelledCount;
    const deliveryFailures = ordersForCustomer.filter(o => {
      const status = String(o.status || '').toLowerCase();
      return String(o.delivery_type || '').toLowerCase() === 'delivery' && (status === 'cancelled' || status === 'refunded');
    }).length;
    const lastSuccessfulDelivery = [...ordersForCustomer]
      .filter(o => {
        const status = String(o.status || '').toLowerCase();
        return String(o.delivery_type || '').toLowerCase() === 'delivery' && ['delivered', 'completed', 'success'].includes(status);
      })
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0]?.created_at || null;

    return {
      key: '',
      phone,
      phones,
      psid,
      maskedPSID,
      signupSource: primary.sender_id ? 'Facebook' : 'Manual',
      displayName,
      primaryIdentity,
      firstOrder,
      lastOrder,
      riskStatus,
      listStatus,
      riskBadges,
      riskContext,
      riskReasons,
      qualitySummary: {
        reliability,
        pros: qualityPros,
        concerns: qualityConcerns
      },
      quality: {
        reliability,
        cancellationBehavior,
        promoAbuseRisk
      },
      metrics: {
        totalOrders,
        totalSpent,
        avgOrder: totalOrders > 0 ? totalSpent / totalOrders : 0,
        cancelledCount,
        promoDependence,
        refundRate,
        codRefusals,
        deliveryFailures,
        lastSuccessfulDelivery
      }
    };
  }, []);

  const { customerGroups, customerList } = useMemo(() => {
    const groups = new Map();
    normalizedOrders.forEach(order => {
      const key = order.sender_id ? `psid:${order.sender_id}` : `unknown:${order.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
    });
    const profiles = Array.from(groups.entries()).map(([key, groupOrders]) => {
      const profile = buildCustomerProfile(groupOrders);
      return { ...profile, key };
    });
    return {
      customerGroups: groups,
      customerList: profiles.sort((a, b) => new Date(b.lastOrder || 0).getTime() - new Date(a.lastOrder || 0).getTime())
    };
  }, [buildCustomerProfile, normalizedOrders]);

  useEffect(() => {
    if (customerList.length === 0) {
      if (selectedCustomerKey) setSelectedCustomerKey('');
      return;
    }
    const exists = customerList.some(c => c.key === selectedCustomerKey);
    if (!exists) {
      setSelectedCustomerKey(customerList[0].key);
    }
  }, [customerList, selectedCustomerKey]);

  const customerInfo = useMemo(() => {
    const selected = customerList.find(c => c.key === selectedCustomerKey);
    return selected || buildCustomerProfile([]);
  }, [buildCustomerProfile, customerList, selectedCustomerKey]);

  useEffect(() => {
    if (!customerInfo.psid) {
      setCustomerStatus(emptyStatus);
      return;
    }
    loadCustomerStatus(customerInfo.psid);
  }, [customerInfo.psid, emptyStatus, loadCustomerStatus]);

  useEffect(() => {
    const riskStatus = customerInfo.riskStatus || 'Watchlist';
    const watchlist = riskStatus === 'Watchlist';
    const highRisk = riskStatus === 'High Risk';
    const trusted = riskStatus === 'Trusted';
    setDeliveryRequirements({
      reconfirmBeforePrep: watchlist || highRisk,
      manualApproval: highRisk
    });
    setOrderRestrictions({
      dailyCodLimit: watchlist || highRisk ? 1 : 2,
      blockSameDayRepeat: watchlist || highRisk,
      pendingConfirmation: !trusted
    });
  }, [customerInfo.riskStatus]);

  const recommendedAction = useMemo(() => {
    const status = customerInfo.riskStatus || 'Watchlist';
    if (status === 'High Risk') return 'Disable COD';
    if (status === 'Watchlist') return 'Require phone verification';
    return 'Allow COD';
  }, [customerInfo.riskStatus]);

  useEffect(() => {
    setSelectedAction(recommendedAction);
  }, [recommendedAction]);

  const customerOrders = useMemo(() => {
    if (!selectedCustomerKey) return [];
    return customerGroups.get(selectedCustomerKey) || [];
  }, [customerGroups, selectedCustomerKey]);

  const recentOrders = useMemo(() => {
    return [...customerOrders]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 5);
  }, [customerOrders]);

  const previewOrders = useMemo(() => recentOrders.slice(0, 3), [recentOrders]);
  const accountAgeMonths = customerInfo.firstOrder
    ? Math.max(1, Math.round((Date.now() - new Date(customerInfo.firstOrder).getTime()) / (30 * 24 * 60 * 60 * 1000)))
    : null;

  const toggleOrderExpanded = orderId => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  const statusBadgeClass = status => ({
    Trusted: 'bg-success-subtle text-success border border-success-subtle',
    Watchlist: 'bg-warning-subtle text-warning border border-warning-subtle',
    'High Risk': 'bg-danger-subtle text-danger border border-danger-subtle'
  }[status] || 'bg-secondary-subtle text-secondary border border-secondary-subtle');

  const qualityBadgeClass = level => ({
    Reliable: 'bg-success-subtle text-success border border-success-subtle',
    'Needs confirmation': 'bg-warning-subtle text-warning border border-warning-subtle',
    'High risk': 'bg-danger-subtle text-danger border border-danger-subtle'
  }[level] || 'bg-secondary-subtle text-secondary border border-secondary-subtle');

  const orderStatusClass = status => {
    const normalized = String(status || '').toLowerCase();
    if (['delivered', 'completed', 'success'].includes(normalized)) {
      return 'bg-success-subtle text-success border border-success-subtle';
    }
    if (['cancelled', 'canceled', 'refunded'].includes(normalized)) {
      return 'bg-danger-subtle text-danger border border-danger-subtle';
    }
    if (['pending', 'processing'].includes(normalized)) {
      return 'bg-warning-subtle text-warning border border-warning-subtle';
    }
    return 'bg-secondary-subtle text-secondary border border-secondary-subtle';
  };

  const orderHandlingStatus = orderRestrictions.dailyCodLimit <= 0
    ? 'Orders blocked'
    : deliveryRequirements.manualApproval || deliveryRequirements.reconfirmBeforePrep || orderRestrictions.pendingConfirmation
      ? 'Requires confirmation before preparation'
      : 'Accepted normally';

  const orderHandlingStatusClass = orderHandlingStatus === 'Accepted normally'
    ? 'bg-success-subtle text-success border border-success-subtle'
    : orderHandlingStatus === 'Requires confirmation before preparation'
      ? 'bg-warning-subtle text-warning border border-warning-subtle'
      : 'bg-danger-subtle text-danger border border-danger-subtle';

  const verificationLabel = customerStatus.blocked
    ? 'Blocked'
    : customerStatus.verified
      ? 'Verified'
      : customerStatus.pendingVerification
        ? 'Pending verification'
        : 'Unverified';

  const verificationBadgeClass = status => ({
    Blocked: 'bg-danger-subtle text-danger border border-danger-subtle',
    Verified: 'bg-success-subtle text-success border border-success-subtle',
    'Pending verification': 'bg-warning-subtle text-warning border border-warning-subtle',
    Unverified: 'bg-secondary-subtle text-secondary border border-secondary-subtle'
  }[status] || 'bg-secondary-subtle text-secondary border border-secondary-subtle');

  const formatDateTime = value => (value ? new Date(value).toLocaleString() : '—');

  const handleBlockCustomer = async () => {
    const reason = blockReason.trim();
    if (!reason) {
      setStatusError('Block reason required.');
      return;
    }
    const payload = {
      psid: customerInfo.psid,
      phones: Array.isArray(customerInfo.phones) ? customerInfo.phones : [],
      reason
    };
    const result = await performAdminAction(customerInfo.psid, '/api/admin/customers/block', payload);
    if (result) setBlockReason('');
  };

  const handleUnblockCustomer = async () => {
    const payload = {
      psid: customerInfo.psid,
      reason: blockReason.trim()
    };
    const result = await performAdminAction(customerInfo.psid, '/api/admin/customers/unblock', payload);
    if (result) setBlockReason('');
  };

  const handleVerifyCustomer = async verified => {
    const payload = {
      psid: customerInfo.psid,
      verified,
      method: 'admin_manual',
      reason: verificationReason.trim()
    };
    const result = await performAdminAction(customerInfo.psid, '/api/admin/customers/verify', payload);
    if (result) setVerificationReason('');
  };

  const handleRequestVerification = async () => {
    const payload = {
      psid: customerInfo.psid,
      reason: verificationReason.trim()
    };
    const result = await performAdminAction(customerInfo.psid, '/api/admin/customers/verify/messenger', payload);
    if (result) setVerificationReason('');
  };

  return (
    <>
      <Head>
        <title>BakeFlow Admin - Customer</title>
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
            pageTitle={t('customers')}
            pageSubtitle="Customer profile and behavior summary"
          />
          <div className="flex-grow-1 overflow-auto">
            <div className="container-fluid px-4 py-4">
              {error && <div className="alert alert-danger">{error}</div>}
              {loading && (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary" role="status" />
                </div>
              )}
              {!loading && customerList.length === 0 && !error && (
                <div className="card border-0 shadow-sm">
                  <div className="card-body text-center py-5">
                    <i className="bi bi-people fs-1 text-muted mb-3"></i>
                    <h4 className="text-muted">No customer data yet</h4>
                    <p className="text-secondary mb-0">Place a few orders to see customer profiles here.</p>
                  </div>
                </div>
              )}
              {!loading && customerList.length > 0 && (
                <div className="row g-4">
                  <div className="col-12 col-lg-5">
                    <div className="card border-0 shadow-sm">
                      <div className="card-body">
                        <div className="d-flex align-items-center justify-content-between mb-3">
                          <h5 className="mb-0 fw-semibold">Customers</h5>
                          <span className="text-muted small">{customerList.length} total</span>
                        </div>
                        <div className="table-responsive">
                          <table className="table table-sm align-middle mb-0">
                            <thead className="table-light">
                              <tr>
                                <th>Messenger user</th>
                                <th>Orders</th>
                                <th>Last order</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {customerList.map(customer => (
                                <tr
                                  key={customer.key}
                                  onClick={() => setSelectedCustomerKey(customer.key)}
                                  className={[
                                    selectedCustomerKey === customer.key ? 'table-active' : '',
                                    customer.listStatus === 'Watchlist' ? 'border-start border-3 border-warning-subtle' : ''
                                  ].join(' ').trim()}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <td>
                                    <div className="fw-semibold">{customer.maskedPSID || '—'}</div>
                                    {customer.phones?.length ? (
                                      <div className="text-muted small">
                                        📞 {customer.phones.length} linked phone number{customer.phones.length === 1 ? '' : 's'}
                                      </div>
                                    ) : (
                                      <div className="text-muted small">No phone on file</div>
                                    )}
                                    {customer.riskReasons?.length ? (
                                      <div className="text-warning small">⚠️ Unusual activity</div>
                                    ) : null}
                                  </td>
                                  <td>{customer.metrics?.totalOrders ?? 0}</td>
                                  <td className="text-muted">
                                    {customer.lastOrder ? new Date(customer.lastOrder).toLocaleDateString() : '—'}
                                  </td>
                                  <td>
                                    <span className={`badge ${statusBadgeClass(customer.listStatus)}`}>
                                      {customer.listStatus}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="col-12 col-lg-7">
                    {statusError && <div className="alert alert-danger">{statusError}</div>}
                    <details className="border rounded-3 bg-white shadow-sm mb-4" open>
                      <summary className="px-4 py-3 d-flex align-items-center justify-content-between">
                        <span className="fw-semibold">Identity & Contact</span>
                        <span className={`badge ${statusBadgeClass(customerInfo.listStatus)}`}>
                          {customerInfo.listStatus}
                        </span>
                      </summary>
                      <div className="px-4 pb-4">
                        <div className="row g-3">
                          <div className="col-12 col-md-6">
                            <div className="text-muted small">Messenger User ID</div>
                            <div className="fw-semibold">{customerInfo.maskedPSID || '—'}</div>
                          </div>
                          <div className="col-12 col-md-6">
                            <div className="text-muted small">Linked phone numbers</div>
                            {customerInfo.phones?.length ? (
                              <details className="border rounded-3 bg-light px-3 py-2">
                                <summary className="small fw-semibold text-muted">
                                  📞 {customerInfo.phones.length} linked phone number{customerInfo.phones.length === 1 ? '' : 's'}
                                  <span className="text-primary ms-2">View details</span>
                                </summary>
                                <div className="mt-2 d-flex flex-column gap-1">
                                  {customerInfo.phones.map(phone => (
                                    <span key={phone} className="fw-semibold">{phone}</span>
                                  ))}
                                </div>
                              </details>
                            ) : (
                              <div className="text-muted">—</div>
                            )}
                          </div>
                          <div className="col-12">
                            <div className="text-muted small">User-provided name</div>
                            {customerInfo.displayName ? (
                              <div className="d-flex align-items-center gap-2">
                                <span className="fw-semibold">{customerInfo.displayName}</span>
                                <span className={`badge rounded-pill ${verificationBadgeClass(verificationLabel)}`}>{verificationLabel}</span>
                              </div>
                            ) : (
                              <div className="text-muted">—</div>
                            )}
                          </div>
                          <div className="col-12">
                            <div className="text-muted small">Messenger verification</div>
                            <div className="d-flex align-items-center flex-wrap gap-2">
                              <span className={`badge ${verificationBadgeClass(verificationLabel)}`}>
                                {verificationLabel}
                              </span>
                              {statusLoading && <span className="text-muted small">Loading status…</span>}
                              {!statusLoading && customerStatus.verifiedAt && (
                                <span className="text-muted small">Verified {formatDateTime(customerStatus.verifiedAt)}</span>
                              )}
                              {!statusLoading && !customerStatus.verified && customerStatus.pendingVerification && (
                                <span className="text-muted small">Requested {formatDateTime(customerStatus.pendingRequestedAt)}</span>
                              )}
                              {!statusLoading && customerStatus.verificationMethod && (
                                <span className="text-muted small">Method {customerStatus.verificationMethod}</span>
                              )}
                            </div>
                          </div>
                          <div className="col-12 col-md-6">
                            <div className="text-muted small">Account age</div>
                            <div className="fw-semibold">
                              {customerInfo.firstOrder
                                ? `${Math.max(1, Math.round((Date.now() - new Date(customerInfo.firstOrder).getTime()) / (30 * 24 * 60 * 60 * 1000)))} months`
                                : '—'}
                            </div>
                          </div>
                          <div className="col-12 col-md-6">
                            <div className="text-muted small">Risk status</div>
                            <span className={`badge ${statusBadgeClass(customerInfo.listStatus)}`}>
                              {customerInfo.listStatus}
                            </span>
                          </div>
                          <div className="col-12">
                            <div className="text-muted small mb-2">Trust signals</div>
                            <div className="d-flex flex-wrap gap-2">
                              <span className={`badge bg-light ${customerInfo.phones?.length ? 'text-dark border' : 'text-muted border border-light'}`}>
                                {customerInfo.phones?.length ? 'Phone provided (not verified)' : 'Phone not provided'}
                              </span>
                              <span className="badge bg-light text-dark border">
                                Account age {accountAgeMonths ? `${accountAgeMonths} months` : '—'}
                              </span>
                              <span className="badge bg-light text-dark border">
                                Signup source {customerInfo.signupSource}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </details>

                    <details className="border rounded-3 bg-white shadow-sm mb-4" open>
                      <summary className="px-4 py-3">
                        <span className="fw-semibold">Order Summary</span>
                      </summary>
                      <div className="px-4 pb-4">
                        <div className="row g-3">
                          <div className="col-6 col-lg-3">
                            <div className="text-muted small">Total orders</div>
                            <div className="fw-semibold">{customerInfo.metrics?.totalOrders ?? 0}</div>
                          </div>
                          <div className="col-6 col-lg-3">
                            <div className="text-muted small">Lifetime value</div>
                            <div className="fw-semibold">{formatCurrency(customerInfo.metrics?.totalSpent ?? 0)}</div>
                          </div>
                          <div className="col-6 col-lg-3">
                            <div className="text-muted small">Avg order value</div>
                            <div className="fw-semibold">{formatCurrency(customerInfo.metrics?.avgOrder ?? 0)}</div>
                            {customerInfo.metrics?.avgOrder > storeAverages.avgOrderValue && (
                              <div className="text-muted small">Above store average</div>
                            )}
                          </div>
                          <div className="col-6 col-lg-3">
                            <div className="text-muted small">Cancellation count</div>
                            <div className="fw-semibold">{customerInfo.metrics?.cancelledCount ?? 0}</div>
                            {customerInfo.metrics?.refundRate > storeAverages.cancellationRate && (
                              <div className="text-muted small">Above store average</div>
                            )}
                          </div>
                        </div>
                        <div className="row g-3 mt-1">
                          <div className="col-6 col-lg-4">
                            <div className="text-muted small">COD refusals</div>
                            <div className="fw-semibold">{customerInfo.metrics?.codRefusals ?? 0}</div>
                          </div>
                          <div className="col-6 col-lg-4">
                            <div className="text-muted small">Delivery failures</div>
                            <div className="fw-semibold">{customerInfo.metrics?.deliveryFailures ?? 0}</div>
                          </div>
                          <div className="col-6 col-lg-4">
                            <div className="text-muted small">Last successful delivery</div>
                            <div className="fw-semibold">
                              {customerInfo.metrics?.lastSuccessfulDelivery
                                ? new Date(customerInfo.metrics.lastSuccessfulDelivery).toLocaleDateString()
                                : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </details>

                    <details className="border rounded-3 bg-white shadow-sm mb-4">
                      <summary className="px-4 py-3 d-flex align-items-center justify-content-between">
                        <span className="fw-semibold">Customer Quality</span>
                        <span className={`badge ${qualityBadgeClass(customerInfo.qualitySummary?.reliability)}`}>
                          {customerInfo.qualitySummary?.reliability || 'Needs confirmation'}
                        </span>
                      </summary>
                      <div className="px-4 pb-4">
                        <div className="row g-3">
                          <div className="col-12 col-md-6">
                            <div className="text-muted small mb-2">Pros</div>
                            <ul className="small text-muted mb-0">
                              {customerInfo.qualitySummary?.pros?.length ? customerInfo.qualitySummary.pros.map(item => (
                                <li key={item}>{item}</li>
                              )) : (
                                <li>No positive signals yet</li>
                              )}
                            </ul>
                          </div>
                          <div className="col-12 col-md-6">
                            <div className="text-muted small mb-2">Concerns</div>
                            <ul className="small text-muted mb-0">
                              {customerInfo.qualitySummary?.concerns?.length ? customerInfo.qualitySummary.concerns.map(item => (
                                <li key={item}>{item}</li>
                              )) : (
                                <li>No concerns flagged</li>
                              )}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </details>

                    <details className="border rounded-3 bg-white shadow-sm mb-4">
                      <summary className="px-4 py-3">
                        <span className="fw-semibold">Delivery Requirements</span>
                      </summary>
                      <div className="px-4 pb-4">
                        <div className="row g-3">
                          <div className="col-12 col-md-6">
                            <div className="text-muted small">Phone verification (trust signal)</div>
                            <div className="fw-semibold">{customerInfo.phones?.length ? 'Phone provided' : 'Not provided'}</div>
                          </div>
                          <div className="col-12 col-md-6">
                            <div className="text-muted small">Preparation gate</div>
                            <div className="form-check form-switch m-0">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id="reconfirmBeforePrep"
                                checked={deliveryRequirements.reconfirmBeforePrep}
                                onChange={event =>
                                  setDeliveryRequirements(prev => ({
                                    ...prev,
                                    reconfirmBeforePrep: event.target.checked
                                  }))
                                }
                              />
                              <label className="form-check-label small" htmlFor="reconfirmBeforePrep">
                                Reconfirmation required before preparation
                              </label>
                            </div>
                          </div>
                          <div className="col-12">
                            <div className="form-check form-switch m-0">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id="manualApprovalToggle"
                                checked={deliveryRequirements.manualApproval}
                                onChange={event =>
                                  setDeliveryRequirements(prev => ({
                                    ...prev,
                                    manualApproval: event.target.checked
                                  }))
                                }
                              />
                              <label className="form-check-label small" htmlFor="manualApprovalToggle">
                                Manual approval required
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>
                    </details>

                    <details className="border rounded-3 bg-white shadow-sm mb-4">
                      <summary className="px-4 py-3">
                        <span className="fw-semibold">Order Restrictions</span>
                      </summary>
                      <div className="px-4 pb-4">
                        <div className="d-flex align-items-center justify-content-between border rounded-3 bg-light px-3 py-2 mb-3">
                          <div className="text-muted small">Order Handling Status</div>
                          <span className={`badge ${orderHandlingStatusClass}`}>{orderHandlingStatus}</span>
                        </div>
                        <div className="text-muted small mb-2">Applied restrictions for this customer</div>
                        <div className="row g-3">
                          <div className="col-12 col-md-6">
                            <label className="text-muted small" htmlFor="dailyCodLimit">
                              Orders limited per day (COD only)
                            </label>
                            <input
                              id="dailyCodLimit"
                              type="number"
                              min="0"
                              className="form-control form-control-sm mt-1"
                              value={orderRestrictions.dailyCodLimit}
                              onChange={event =>
                                setOrderRestrictions(prev => ({
                                  ...prev,
                                  dailyCodLimit: Number(event.target.value || 0)
                                }))
                              }
                            />
                          </div>
                          <div className="col-12 col-md-6">
                            <div className="form-check form-switch m-0">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id="blockSameDayRepeat"
                                checked={orderRestrictions.blockSameDayRepeat}
                                onChange={event =>
                                  setOrderRestrictions(prev => ({
                                    ...prev,
                                    blockSameDayRepeat: event.target.checked
                                  }))
                                }
                              />
                              <label className="form-check-label small" htmlFor="blockSameDayRepeat">
                                Repeat same-day orders are blocked
                              </label>
                            </div>
                          </div>
                          <div className="col-12">
                            <div className="form-check form-switch m-0">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id="pendingConfirmationFlag"
                                checked={orderRestrictions.pendingConfirmation}
                                onChange={event =>
                                  setOrderRestrictions(prev => ({
                                    ...prev,
                                    pendingConfirmation: event.target.checked
                                  }))
                                }
                              />
                              <label className="form-check-label small" htmlFor="pendingConfirmationFlag">
                                New orders are flagged as pending confirmation
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>
                    </details>

                    <details className="border rounded-3 bg-white shadow-sm mb-4">
                      <summary className="px-4 py-3 d-flex align-items-center justify-content-between">
                        <span className="fw-semibold">Why flagged?</span>
                        <span className="text-muted small">
                          {customerInfo.riskReasons?.length ? `${customerInfo.riskReasons.length} signals` : 'No risk signals'}
                        </span>
                      </summary>
                      <div className="px-4 pb-4">
                        <div className="d-flex flex-wrap gap-2">
                          {customerInfo.riskReasons?.length ? customerInfo.riskReasons.map(reason => (
                            <span key={reason} className="badge bg-warning-subtle text-warning border border-warning-subtle">{reason}</span>
                          )) : (
                            <span className="badge bg-success-subtle text-success border border-success-subtle">No risk flags detected</span>
                          )}
                        </div>
                        <div className="mt-3 d-flex flex-column gap-1">
                          {customerInfo.riskContext.length > 0 ? customerInfo.riskContext.map(line => (
                            <span key={line} className="text-muted small">{line}</span>
                          )) : (
                            <span className="text-muted small">No abnormal patterns vs store average</span>
                          )}
                        </div>
                      </div>
                    </details>

                    <details className="border rounded-3 bg-white shadow-sm mb-4">
                      <summary className="px-4 py-3">
                        <span className="fw-semibold">Order History</span>
                        <div className="mt-2 d-flex flex-column gap-1">
                          {previewOrders.length === 0 ? (
                            <span className="text-muted small">No recent orders</span>
                          ) : (
                            previewOrders.map(order => (
                              <div key={order.id} className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
                                <button type="button" className="btn btn-link p-0 fw-semibold text-decoration-none" onClick={() => toggleOrderExpanded(order.id)}>
                                  BF-{order.id}
                                </button>
                                <span className="text-muted small">{formatCurrency(order.total_amount || 0)}</span>
                                <span className={`badge ${orderStatusClass(order.status)}`}>
                                  {String(order.status || '—').toUpperCase()}
                                </span>
                                <span className="text-muted small">
                                  {order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </summary>
                      <div className="px-4 pb-4">
                        {recentOrders.length > 3 && (
                          <div className="d-flex flex-column gap-3">
                            {recentOrders.slice(3).map(order => (
                              <div key={order.id} className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
                                <button type="button" className="btn btn-link p-0 fw-semibold text-decoration-none" onClick={() => toggleOrderExpanded(order.id)}>
                                  BF-{order.id}
                                </button>
                                <div className="text-muted">{formatCurrency(order.total_amount || 0)}</div>
                                <span className={`badge ${orderStatusClass(order.status)}`}>
                                  {String(order.status || '—').toUpperCase()}
                                </span>
                                <div className="text-muted small">
                                  {order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {recentOrders.map(order => (
                          expandedOrders[order.id] && (
                            <div key={`${order.id}-details`} className="mt-2 p-2 border rounded-2 bg-light text-muted small">
                              <div className="d-flex flex-wrap gap-3">
                                <span>Subtotal: {formatCurrency(order.subtotal || 0)}</span>
                                <span>Delivery: {formatCurrency(order.delivery_fee || 0)}</span>
                                <span>Discount: {formatCurrency(order.discount || 0)}</span>
                              </div>
                            </div>
                          )
                        ))}
                        <div className="mt-3 d-flex justify-content-end">
                          <Link href="/admin/orders" className="btn btn-outline-secondary btn-sm">
                            View all orders
                          </Link>
                        </div>
                      </div>
                    </details>

                    <div className="border rounded-3 bg-white shadow-sm position-sticky" style={{ top: '1rem' }}>
                      <div className="px-4 py-3 border-bottom d-flex align-items-center justify-content-between">
                        <span className="fw-semibold">Admin Actions</span>
                        <span className={`badge ${statusBadgeClass(customerInfo.listStatus)}`}>
                          {customerInfo.listStatus}
                        </span>
                      </div>
                      <div className="px-4 py-4">
                        <div className="d-flex align-items-center justify-content-between mb-3">
                          <div className="text-muted small">Recommended action</div>
                          <span className="badge bg-primary-subtle text-primary border border-primary-subtle">
                            {recommendedAction}
                          </span>
                        </div>
                        <div className="border rounded-3 bg-light px-3 py-2 mb-3">
                          <div className="d-flex align-items-center justify-content-between">
                            <div className="text-muted small">Verification</div>
                            <span className={`badge ${verificationBadgeClass(verificationLabel)}`}>
                              {verificationLabel}
                            </span>
                          </div>
                          {customerStatus.blocked && (
                            <div className="text-danger small mt-1">
                              Blocked {formatDateTime(customerStatus.blockedAt)}{customerStatus.blockedReason ? ` · ${customerStatus.blockedReason}` : ''}
                            </div>
                          )}
                        </div>
                        <div className="d-grid gap-2">
                          <button
                            className={`btn ${selectedAction === 'Allow COD' ? 'btn-success' : 'btn-outline-success'}`}
                            onClick={() => setSelectedAction('Allow COD')}
                          >
                            ✅ Allow COD
                          </button>
                          <button
                            className={`btn ${selectedAction === 'Require phone verification' ? 'btn-warning' : 'btn-outline-warning'}`}
                            onClick={() => setSelectedAction('Require phone verification')}
                          >
                            ⚠️ Require phone verification on next order
                          </button>
                          <button
                            className={`btn ${selectedAction === 'Disable COD' ? 'btn-danger' : 'btn-outline-danger'}`}
                            onClick={() => setSelectedAction('Disable COD')}
                          >
                            🚫 Disable COD
                          </button>
                        </div>
                        <div className="mt-4">
                          <div className="text-muted small mb-2">Block or unblock</div>
                          <input
                            className="form-control form-control-sm mb-2"
                            placeholder="Reason for block/unblock"
                            value={blockReason}
                            onChange={event => setBlockReason(event.target.value)}
                          />
                          <div className="d-flex gap-2">
                            {customerStatus.blocked ? (
                              <button
                                className="btn btn-outline-secondary btn-sm"
                                onClick={handleUnblockCustomer}
                                disabled={actionLoading || !customerInfo.psid}
                              >
                                Unblock customer
                              </button>
                            ) : (
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={handleBlockCustomer}
                                disabled={actionLoading || !customerInfo.psid || !blockReason.trim()}
                              >
                                Block customer
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mt-4">
                          <div className="text-muted small mb-2">Messenger verification</div>
                          <input
                            className="form-control form-control-sm mb-2"
                            placeholder="Verification note (optional)"
                            value={verificationReason}
                            onChange={event => setVerificationReason(event.target.value)}
                          />
                          <div className="d-flex flex-wrap gap-2">
                            <button
                              className="btn btn-outline-primary btn-sm"
                              onClick={handleRequestVerification}
                              disabled={actionLoading || !customerInfo.psid || customerStatus.pendingVerification}
                            >
                              Request verification
                            </button>
                            <button
                              className={`btn btn-sm ${customerStatus.verified ? 'btn-outline-secondary' : 'btn-success'}`}
                              onClick={() => handleVerifyCustomer(!customerStatus.verified)}
                              disabled={actionLoading || !customerInfo.psid}
                            >
                              {customerStatus.verified ? 'Mark unverified' : 'Mark verified'}
                            </button>
                          </div>
                        </div>
                        <div className="mt-4">
                          <div className="text-muted small mb-2">Internal note</div>
                          <textarea
                            className="form-control form-control-sm"
                            rows={3}
                            placeholder="Add internal note for this customer"
                            value={internalNote}
                            onChange={event => setInternalNote(event.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}