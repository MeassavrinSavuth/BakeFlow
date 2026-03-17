import { useEffect, useContext, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { LanguageContext } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/i18n';

// Sidebar with collapse + bootstrap tooltips
export default function Sidebar({ open, toggle }) {
  const router = useRouter();

  useEffect(() => {
    // Init Bootstrap tooltips dynamically (guard for SSR)
    if (typeof window !== 'undefined' && window.bootstrap) {
      const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
      tooltipTriggerList.forEach(el => new window.bootstrap.Tooltip(el));
    }
  }, [open]);

  const { lang, setLang } = useContext(LanguageContext)
  const { t } = useTranslation();

  // use keys so we can translate labels
  const navItems = [
    { href: '/admin', icon: 'speedometer2', key: 'dashboard' },
    { href: '/admin/orders', icon: 'receipt', key: 'orders' },
    { href: '/admin/payments', icon: 'cash-coin', key: 'payments' },
    { href: '/admin/products', icon: 'box-seam', key: 'products' },
    { href: '/admin/promotions', icon: 'tag', key: 'promotions' }
  ];



  return (
    <aside className={`bf-sidebar bg-white border-end ${open ? 'expanded' : 'collapsed'}`}>
      <div className="bf-sidebar-header px-3 py-0 border-bottom d-flex align-items-center justify-content-center">
        {open ? (
          <>
            <div className="d-flex align-items-center gap-2 me-auto">
              <i className="bi bi-shop fs-3 text-primary-bake"></i>
              <span className="fs-4 fw-bold sidebar-brand">BakeFlow</span>
            </div>
            <button className="btn btn-sm btn-outline-secondary" onClick={toggle} aria-label="Toggle sidebar">
              <i className="bi bi-x-lg"></i>
            </button>
          </>
        ) : (
          <button className="btn btn-sm btn-outline-secondary" onClick={toggle} aria-label="Toggle sidebar">
            <i className="bi bi-list"></i>
          </button>
        )}
      </div>
      <nav className="flex-grow-1 p-3">
        <ul className="nav flex-column gap-2">
          {navItems.map(item => (
            <li key={item.href} className="nav-item">
              <Link href={item.href} className={`nav-link text-secondary d-flex align-items-center bf-nav-link ${router.pathname === item.href ? 'active' : ''}`} data-bs-toggle={!open ? 'tooltip' : undefined} data-bs-placement="right" title={!open ? t(item.key) : undefined}>
                <i className={`bi bi-${item.icon} fs-5 me-2`}></i>
                {open && <span>{t(item.key)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="bf-sidebar-footer p-3 border-top">
        <div className="d-flex align-items-center justify-content-between">
          {/* Removed admin profile info per request. Replaced with flag dropdown for language selection. */}
          <div>
            <div className="d-flex align-items-center gap-2">
              {open ? (
                <>
                  <button className={`btn btn-sm d-flex align-items-center ${lang === 'en' ? 'btn-bake' : 'btn-outline-bake'}`} onClick={() => setLang('en')} aria-label={t('english')}>
                    <span style={{ fontSize: '18px', lineHeight: 1 }}>🇬🇧</span>
                    <span className="ms-2 d-none d-md-inline">{t('english')}</span>
                  </button>
                  <button className={`btn btn-sm d-flex align-items-center ${lang === 'my' ? 'btn-bake' : 'btn-outline-bake'}`} onClick={() => setLang('my')} aria-label={t('myanmar')}>
                    <span style={{ fontSize: '18px', lineHeight: 1 }}>🇲🇲</span>
                    <span className="ms-2 d-none d-md-inline">{t('myanmar')}</span>
                  </button>
                </>
              ) : (
                <>
                  <button className={`btn btn-sm btn-link p-0 ${lang === 'en' ? 'text-primary-bake' : 'text-secondary'}`} title={t('english')} onClick={() => setLang('en')} aria-label={t('english')}>
                    <span style={{ fontSize: '18px' }}>🇬🇧</span>
                  </button>
                  <button className={`btn btn-sm btn-link p-0 ${lang === 'my' ? 'text-primary-bake' : 'text-secondary'}`} title={t('myanmar')} onClick={() => setLang('my')} aria-label={t('myanmar')}>
                    <span style={{ fontSize: '18px' }}>🇲🇲</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
